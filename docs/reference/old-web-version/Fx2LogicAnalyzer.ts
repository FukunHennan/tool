export type LogicProtocol = "fx2lafw" | "saleae-original-old" | "saleae-original-new";

export interface LogicDeviceInfo {
  vendorId: number;
  productId: number;
  vendorIdHex: string;
  productIdHex: string;
  manufacturer?: string;
  product?: string;
  serialNumber?: string;
  firmwareVersion?: string;
  firmwareSource: "设备现有固件（未修改）";
  protocol: LogicProtocol;
  protocolLabel: string;
  siliconRevision?: number;
  interfaceNumber: number;
  endpointNumber: number;
  commandEndpointNumber?: number;
}

export interface LogicFirmwareDiagnostic {
  checkedAt: string;
  vendorIdHex: string;
  productIdHex: string;
  manufacturer?: string;
  product?: string;
  serialNumber?: string;
  configurationValue?: number;
  interfaceCount: number;
  endpointSummary?: string;
  availableAlternateSummary?: string;
  detectedProtocol?: string;
  fx2lafwState: "运行中" | "原厂固件就绪" | "未检测到" | "读取失败" | "启动加载器";
  firmwareVersion?: string;
  versionTransferStatus?: "ok" | "stall" | "babble";
  versionError?: string;
  probeNote?: string;
  conclusion: string;
}

export interface ChannelMeasurement {
  channel: number;
  risingEdges: number;
  fallingEdges: number;
  frequencyHz?: number;
  dutyCycle?: number;
}

export interface LogicCapture {
  samples: Uint8Array;
  sampleRate: number;
  capturedAt: string;
  durationSeconds: number;
  measurements: ChannelMeasurement[];
}

const filters: USBDeviceFilter[] = [
  { vendorId: 0x1d50, productId: 0x608c },
  { vendorId: 0x0925, productId: 0x3881 },
  { vendorId: 0x08a9, productId: 0x0014 },
  { vendorId: 0x04b4, productId: 0x8613 },
];

const newerSaleaeDividers = new Map<number, number>([
  [200_000, 0x4e], [250_000, 0x9e], [500_000, 0xfe], [1_000_000, 0x8e],
  [2_000_000, 0xe6], [4_000_000, 0xda], [8_000_000, 0xd4], [12_000_000, 0xe2],
  [16_000_000, 0xd5], [24_000_000, 0xe0],
]);

const reverseBits = Uint8Array.from({ length: 256 }, (_, value) => {
  let input = value;
  let output = 0;
  for (let bit = 0; bit < 8; bit += 1) { output = output << 1 | input & 1; input >>= 1; }
  return output;
});

const hex16 = (value: number) => `0x${value.toString(16).padStart(4, "0").toUpperCase()}`;
const errorText = (error: unknown) => error instanceof DOMException
  ? `${error.name}: ${error.message}`
  : error instanceof Error ? error.message : String(error);

async function selectConfiguration(device: USBDevice): Promise<void> {
  if (!device.opened) await device.open();
  if (!device.configuration) await device.selectConfiguration(device.configurations[0]?.configurationValue ?? 1);
}

async function readFirmwareVersion(device: USBDevice): Promise<USBInTransferResult | undefined> {
  const result = await device.controlTransferIn(
    { requestType: "vendor", recipient: "device", request: 0xb0, value: 0, index: 0 },
    2,
  ).catch(() => undefined);
  return result?.status === "ok" && result.data && result.data.byteLength >= 2 ? result : undefined;
}

function endpointSummary(device: USBDevice): string {
  return device.configuration?.interfaces.flatMap((usbInterface) => usbInterface.alternate.endpoints.map((endpoint) =>
    `EP${endpoint.endpointNumber} ${endpoint.direction.toUpperCase()} ${endpoint.type}`,
  )).join(" · ") ?? "无活动端点";
}

function availableAlternateSummary(device: USBDevice): string {
  return device.configuration?.interfaces.flatMap((usbInterface) => (usbInterface.alternates ?? [usbInterface.alternate]).map((alternate) => {
    const endpoints = alternate.endpoints.map((endpoint) => `EP${endpoint.endpointNumber} ${endpoint.direction.toUpperCase()} ${endpoint.type}`).join(", ");
    return `Interface ${usbInterface.interfaceNumber} Alt ${alternate.alternateSetting}: ${endpoints || "无端点"}`;
  })).join(" · ") ?? "无法读取备用设置";
}

function isSaleaeBootloader(device: USBDevice): boolean {
  if (device.vendorId !== 0x0925 || device.productId !== 0x3881) return false;
  const activeEndpoints = device.configuration?.interfaces.flatMap((usbInterface) => usbInterface.alternate.endpoints) ?? [];
  return activeEndpoints.length === 0;
}

function activeCaptureInterface(device: USBDevice) {
  return device.configuration?.interfaces.find((usbInterface) =>
    usbInterface.alternate.endpoints.some((endpoint) => endpoint.direction === "in" && endpoint.type === "bulk"),
  );
}

function withUsbTimeout<T>(device: USBDevice, operation: Promise<T>, milliseconds: number, stage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      void device.close().catch(() => undefined);
      reject(new Error(`${stage}超时（${milliseconds / 1000} 秒），已关闭设备以取消挂起的 USB 传输`));
    }, milliseconds);
    operation.then(
      (value) => { window.clearTimeout(timer); resolve(value); },
      (error) => { window.clearTimeout(timer); reject(error); },
    );
  });
}

export function measureLogicChannels(samples: Uint8Array, sampleRate: number): ChannelMeasurement[] {
  return Array.from({ length: 8 }, (_, channel) => {
    const mask = 1 << channel;
    let risingEdges = 0;
    let fallingEdges = 0;
    let highSamples = samples.length && (samples[0] & mask) !== 0 ? 1 : 0;
    for (let index = 1; index < samples.length; index += 1) {
      const previous = (samples[index - 1] & mask) !== 0;
      const current = (samples[index] & mask) !== 0;
      if (current) highSamples += 1;
      if (!previous && current) risingEdges += 1;
      if (previous && !current) fallingEdges += 1;
    }
    const periods = Math.min(risingEdges, fallingEdges);
    return {
      channel,
      risingEdges,
      fallingEdges,
      frequencyHz: periods > 0 ? periods / (samples.length / sampleRate) : undefined,
      dutyCycle: samples.length ? highSamples / samples.length * 100 : undefined,
    };
  });
}

class Fx2LogicAnalyzer {
  private device?: USBDevice;
  private info?: LogicDeviceInfo;
  private capturing = false;

  // connect() deliberately closes the WebUSB handle after identification. A
  // retained device object plus its matching protocol info therefore means
  // "ready for capture", even though the underlying handle is not open yet.
  get connected(): boolean { return Boolean(this.device && this.info); }
  get deviceInfo(): LogicDeviceInfo | undefined { return this.info; }
  get busy(): boolean { return this.capturing; }
  isSupported(): boolean { return window.isSecureContext && Boolean(navigator.usb); }

  async inspectFirmware(): Promise<LogicFirmwareDiagnostic> {
    if (!navigator.usb || !window.isSecureContext) throw new Error("当前浏览器环境不支持 WebUSB");
    if (this.capturing) throw new Error("采集正在进行中，无法读取固件状态");
    await this.disconnect();
    const device = await navigator.usb.requestDevice({ filters });
    const diagnostic: LogicFirmwareDiagnostic = {
      checkedAt: new Date().toISOString(),
      vendorIdHex: hex16(device.vendorId), productIdHex: hex16(device.productId),
      manufacturer: device.manufacturerName || undefined, product: device.productName || undefined,
      serialNumber: device.serialNumber || undefined, interfaceCount: 0,
      fx2lafwState: "未检测到", conclusion: "尚未完成固件状态读取",
    };
    try {
      await selectConfiguration(device);
      diagnostic.configurationValue = device.configuration?.configurationValue;
      diagnostic.interfaceCount = device.configuration?.interfaces.length ?? 0;
      diagnostic.endpointSummary = endpointSummary(device);
      diagnostic.availableAlternateSummary = availableAlternateSummary(device);
      try {
        const version = await device.controlTransferIn(
          { requestType: "vendor", recipient: "device", request: 0xb0, value: 0, index: 0 }, 2,
        );
        diagnostic.versionTransferStatus = version.status;
        if (version.status === "ok" && version.data && version.data.byteLength >= 2) {
          diagnostic.fx2lafwState = "运行中";
          diagnostic.firmwareVersion = `${version.data.getUint8(0)}.${version.data.getUint8(1)}`;
          diagnostic.detectedProtocol = "fx2lafw";
          diagnostic.conclusion = "设备已运行 fx2lafw；PC Toolbox 只使用现有固件，不执行上传";
        }
      } catch (error) {
        diagnostic.fx2lafwState = "读取失败";
        diagnostic.versionError = errorText(error);
      }
      if (diagnostic.fx2lafwState !== "运行中") {
        const usbInterface = activeCaptureInterface(device);
        const endpoints = usbInterface?.alternate.endpoints ?? [];
        const nativeOut = endpoints.find((endpoint) => endpoint.type === "bulk" && endpoint.direction === "out" && endpoint.endpointNumber === 1);
        const nativeIn = endpoints.find((endpoint) => endpoint.type === "bulk" && endpoint.direction === "in" && endpoint.endpointNumber === 2);
        if (isSaleaeBootloader(device)) {
          diagnostic.fx2lafwState = "启动加载器";
          diagnostic.detectedProtocol = "Cypress FX2 / Saleae Bootloader";
          diagnostic.conclusion = "设备当前只有上电加载器，没有运行采集程序和活动采集端点；已保持只读，未写入 RAM 或 EEPROM";
        } else if (device.vendorId === 0x0925 && device.productId === 0x3881 && nativeOut && nativeIn) {
          const newer = endpoints.length > 2;
          diagnostic.fx2lafwState = "原厂固件就绪";
          diagnostic.detectedProtocol = newer ? "Saleae 原厂协议（新版）" : "Saleae 原厂协议（旧版）";
          diagnostic.probeNote = diagnostic.versionError
            ? "0xB0 是 fx2lafw 专用命令；端点布局已匹配历史原厂驱动，实际流式握手将在首次采集时验证"
            : "设备按原厂 Saleae Bulk 端点协议工作";
          diagnostic.versionError = undefined;
          diagnostic.versionTransferStatus = undefined;
          diagnostic.conclusion = "检测到原厂 Saleae Bulk 端点；将按历史驱动的流式队列采集，设备固件不会被修改";
        } else {
          diagnostic.conclusion = "当前活动 USB 端点不符合 fx2lafw 或 Saleae 原厂采集协议；不会尝试写入设备固件";
        }
      }
      return diagnostic;
    } finally {
      try { if (device.opened) await device.close(); } catch { /* Browser will release it. */ }
    }
  }

  async connect(onProgress: (message: string) => void = () => undefined): Promise<LogicDeviceInfo> {
    if (!navigator.usb || !window.isSecureContext) throw new Error("当前浏览器环境不支持 WebUSB");
    if (this.capturing) throw new Error("采集正在进行中，无法重新连接设备");
    await this.disconnect();
    const device = await navigator.usb.requestDevice({ filters });
    try {
      await selectConfiguration(device);
      onProgress("正在只读识别设备现有协议…");
      const usbInterface = activeCaptureInterface(device);
      if (!usbInterface) {
        if (isSaleaeBootloader(device)) throw new Error("检测到 Cypress FX2 / Saleae Bootloader：设备当前没有运行采集程序。严格无固件写入模式下无法开始采集");
        throw new Error("设备没有活动的 Bulk IN 采集端点；PC Toolbox 不会通过写入固件改变设备状态");
      }
      const endpoints = usbInterface.alternate.endpoints;
      const bulkIn = endpoints.find((endpoint) => endpoint.direction === "in" && endpoint.type === "bulk");
      if (!bulkIn) throw new Error("设备没有可用的 Bulk IN 端点");

      const nativeOut = endpoints.find((endpoint) => endpoint.direction === "out" && endpoint.type === "bulk" && endpoint.endpointNumber === 1);
      const nativeIn = endpoints.find((endpoint) => endpoint.direction === "in" && endpoint.type === "bulk" && endpoint.endpointNumber === 2);
      const saleaeProfile = device.vendorId === 0x0925 && device.productId === 0x3881 && nativeOut !== undefined && nativeIn !== undefined;

      let protocol: LogicProtocol;
      let protocolLabel: string;
      let commandEndpointNumber: number | undefined;
      let firmwareVersion: string | undefined;
      let siliconRevision: number | undefined;
      if (saleaeProfile) {
        // 端点布局已匹配 Saleae 原厂协议：跳过 0xB0 探测。原厂固件不响应 0xB0，
        // 该被忽略的控制传输在 Chrome/WinUSB 上会破坏同会话后续 Bulk IN（实测：
        // 协议探测不发 0xB0 时 1MHz 顺序读全部成功，采集流程发 0xB0 时首包超时）。
        protocol = endpoints.length > 2 ? "saleae-original-new" : "saleae-original-old";
        protocolLabel = protocol === "saleae-original-new" ? "WebUSB · Saleae 原厂协议（新版）" : "WebUSB · Saleae 原厂协议（旧版）";
        commandEndpointNumber = nativeOut.endpointNumber;
      } else {
        const firmware = await readFirmwareVersion(device);
        if (firmware?.data && firmware.data.byteLength >= 2) {
          protocol = "fx2lafw";
          protocolLabel = "WebUSB · fx2lafw（现有固件）";
          firmwareVersion = `${firmware.data.getUint8(0)}.${firmware.data.getUint8(1)}`;
          const revid = await device.controlTransferIn(
            { requestType: "vendor", recipient: "device", request: 0xb2, value: 0, index: 0 }, 1,
          ).catch(() => undefined);
          siliconRevision = revid?.status === "ok" && revid.data?.byteLength ? revid.data.getUint8(0) : undefined;
        } else {
          throw new Error(`无法识别设备现有采集协议（${endpointSummary(device)}）；为保护设备，未执行任何固件写入`);
        }
      }

      await device.claimInterface(usbInterface.interfaceNumber);
      const info: LogicDeviceInfo = {
        vendorId: device.vendorId, productId: device.productId,
        vendorIdHex: hex16(device.vendorId), productIdHex: hex16(device.productId),
        manufacturer: device.manufacturerName || undefined, product: device.productName || undefined,
        serialNumber: device.serialNumber || undefined, firmwareVersion,
        firmwareSource: "设备现有固件（未修改）",
        protocol, protocolLabel, siliconRevision,
        interfaceNumber: usbInterface.interfaceNumber,
        endpointNumber: protocol === "fx2lafw" ? bulkIn.endpointNumber : 2,
        commandEndpointNumber,
      };
      await device.close();
      this.device = device;
      this.info = info;
      return info;
    } catch (error) {
      try { if (device.opened) await device.close(); } catch { /* Browser will release it. */ }
      this.device = undefined;
      this.info = undefined;
      throw error;
    }
  }

  private async captureFx2(device: USBDevice, info: LogicDeviceInfo, sampleRate: number, total: number, onProgress: (message: string) => void): Promise<Uint8Array> {
    const delay48 = 48_000_000 % sampleRate === 0 ? 48_000_000 / sampleRate - 1 : -1;
    const delay30 = 30_000_000 % sampleRate === 0 ? 30_000_000 / sampleRate - 1 : -1;
    const use48 = delay48 >= 0 && delay48 <= 1536;
    const delay = use48 ? delay48 : delay30;
    if (delay < 0 || delay > 1536 || sampleRate > 24_000_000) throw new Error("fx2lafw 不支持该采样率");
    const command = new Uint8Array([use48 ? 0x40 : 0x00, delay >> 8 & 0xff, delay & 0xff]);
    const started = await device.controlTransferOut(
      { requestType: "vendor", recipient: "device", request: 0xb1, value: 0, index: 0 }, command,
    );
    if (started.status !== "ok") throw new Error(`设备拒绝开始采集：${started.status}`);
    const samples = new Uint8Array(total);
    let offset = 0;
    while (offset < total) {
      onProgress(`正在采集… ${Math.round(offset / total * 100)}%`);
      const result = await withUsbTimeout(device, device.transferIn(info.endpointNumber, Math.min(65_536, total - offset)), 5000, "fx2lafw 数据读取");
      if (result.status !== "ok" || !result.data?.byteLength) throw new Error(`fx2lafw 数据中断：${result.status}`);
      const chunk = new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength);
      const length = Math.min(chunk.byteLength, total - offset);
      samples.set(chunk.subarray(0, length), offset);
      offset += length;
    }
    return samples;
  }

  private async captureSaleae(device: USBDevice, info: LogicDeviceInfo, sampleRate: number, total: number, onProgress: (message: string) => void): Promise<Uint8Array> {
    const decimation = sampleRate < 200_000 ? Math.round(200_000 / sampleRate) : 1;
    const hardwareRate = sampleRate * decimation;
    const divider = info.protocol === "saleae-original-new"
      ? newerSaleaeDividers.get(hardwareRate)
      : 48_000_000 % hardwareRate === 0 ? 48_000_000 / hardwareRate - 1 : undefined;
    if (divider === undefined || divider < 0 || divider > 255) throw new Error(`Saleae 原厂协议不支持 ${sampleRate}Hz 采样率`);
    if (info.commandEndpointNumber === undefined) throw new Error("缺少 Saleae 命令端点");
    const opcode = info.protocol === "saleae-original-new" ? 0xd5 : 0x01;

    if (info.protocol === "saleae-original-new" && hardwareRate === 24_000_000) {
      throw new Error("24MHz 四槽滚动方案已被实机 v4 报告否定。请断开设备后运行 v5 协议探测；正式采集暂不发送未经验证的高速命令");
    }

    const started = await device.transferOut(info.commandEndpointNumber, new Uint8Array([opcode, divider]));
    if (started.status !== "ok" || (started.bytesWritten !== undefined && started.bytesWritten !== 2)) throw new Error(`Saleae 采集命令被拒绝：${started.status}`);

    const samples = new Uint8Array(total);
    const rawTarget = total * decimation;
    let rawOffset = 0;
    let outputOffset = 0;
    let transferIndex = 0;
    const newFirmware = info.protocol === "saleae-original-new";
    const streamStage = `Saleae 顺序数据读取（EP${info.endpointNumber}，命令 0x${opcode.toString(16).toUpperCase()} 0x${divider.toString(16).toUpperCase()}，${newFirmware ? "512→2048→4096" : "2048→4096"}）`;
    while (rawOffset < rawTarget) {
      onProgress(`正在采集… ${Math.round(outputOffset / total * 100)}%`);
      const preferredLength = newFirmware && transferIndex === 0 ? 512 : transferIndex === 0 || newFirmware && transferIndex === 1 ? 2048 : 4096;
      const requestLength = Math.min(preferredLength, rawTarget - rawOffset);
      transferIndex += 1;
      const result = await withUsbTimeout(device, device.transferIn(info.endpointNumber, requestLength), 1500, streamStage);
      if (result.status !== "ok" || !result.data?.byteLength) throw new Error(`Saleae 数据中断：${result.status}`);
      const chunk = new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength);
      for (let index = 0; index < chunk.length && rawOffset < rawTarget; index += 1, rawOffset += 1) {
        if (rawOffset % decimation === 0 && outputOffset < total) samples[outputOffset++] = reverseBits[chunk[index]];
      }
    }
    if (outputOffset !== total) throw new Error(`Saleae 样本数量不足：预期 ${total}，实际 ${outputOffset}`);
    return samples;
  }

  async capture(sampleRate: number, sampleCount: number, onProgress: (message: string) => void = () => undefined): Promise<LogicCapture> {
    if (!navigator.usb || !window.isSecureContext) throw new Error("当前浏览器环境不支持 WebUSB");
    const info = this.info;
    const selectedDevice = this.device;
    if (!info || !selectedDevice) throw new Error("请先连接逻辑分析仪（识别完成后 USB 句柄已释放，采集时会重新打开）");
    if (this.capturing) throw new Error("采集正在进行中");
    const sameDevice = selectedDevice.vendorId === info.vendorId
      && selectedDevice.productId === info.productId
      && (!info.serialNumber || selectedDevice.serialNumber === info.serialNumber);
    if (!sameDevice) {
      await this.disconnect();
      throw new Error("已选择的逻辑分析仪身份发生变化，请重新连接设备");
    }
    const total = Math.max(1_024, Math.min(8_000_000, Math.floor(sampleCount)));
    this.capturing = true;
    try {
      await selectConfiguration(selectedDevice);
      await selectedDevice.claimInterface(info.interfaceNumber);
      const samples = info.protocol === "fx2lafw"
        ? await this.captureFx2(selectedDevice, info, sampleRate, total, onProgress)
        : await this.captureSaleae(selectedDevice, info, sampleRate, total, onProgress);
      onProgress("采集完成");
      return { samples, sampleRate, capturedAt: new Date().toISOString(), durationSeconds: total / sampleRate, measurements: measureLogicChannels(samples, sampleRate) };
    } finally {
      this.capturing = false;
      await this.disconnect();
    }
  }

  async disconnect(): Promise<void> {
    const device = this.device;
    const info = this.info;
    this.device = undefined;
    this.info = undefined;
    if (!device?.opened) return;
    try { if (info) await device.releaseInterface(info.interfaceNumber); } catch { /* Device may already be gone. */ }
    try { await device.close(); } catch { /* Browser will release it. */ }
  }
}

export const fx2LogicAnalyzer = new Fx2LogicAnalyzer();
