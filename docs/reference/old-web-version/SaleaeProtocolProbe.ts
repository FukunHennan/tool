export type SaleaeProbeOrder = "read-only" | "command-then-read" | "read-then-command";

export interface SaleaeProbeStep {
  id: string;
  description: string;
  order: SaleaeProbeOrder;
  command?: number[];
  readEndpoint: number;
  readLength: number;
  readSequence?: number[];
  prequeueAllReads?: boolean;
  timeoutMs: number;
}

export interface SaleaeProbeReadResult {
  index: number;
  requestedLength: number;
  durationMs: number;
  status?: string;
  receivedLength: number;
  first16Hex?: string;
  error?: string;
}

export interface SaleaeProbeResult extends SaleaeProbeStep {
  startedAt: string;
  durationMs: number;
  writeStatus?: string;
  bytesWritten?: number;
  readStatus?: string;
  receivedLength: number;
  dataBase64?: string;
  first64Hex?: string;
  uniqueByteCount?: number;
  bitTransitions?: number[];
  reads?: SaleaeProbeReadResult[];
  error?: string;
}

export interface SaleaeProtocolProbeReport {
  schema: "pc-toolbox.saleae-protocol-probe";
  schemaVersion: 6;
  createdAt: string;
  safety: {
    firmwareWrites: false;
    controlTransfers: false;
    allowedOutEndpoint: 1;
    allowedInEndpoints: number[];
    stateIsolation: string;
    note: string;
  };
  environment: {
    userAgent: string;
    secureContext: boolean;
    platform?: string;
  };
  device: {
    vendorId: number;
    productId: number;
    vendorIdHex: string;
    productIdHex: string;
    manufacturer?: string;
    product?: string;
    configurationValue?: number;
    interfaces: Array<{
      interfaceNumber: number;
      activeAlternate: number;
      alternates: Array<{
        alternateSetting: number;
        endpoints: Array<{ endpointNumber: number; direction: string; type: string }>;
      }>;
    }>;
  };
  summary: {
    total: number;
    responses: number;
    timeouts: number;
    errors: number;
    candidateConclusion: string;
  };
  results: SaleaeProbeResult[];
}

const filter: USBDeviceFilter = { vendorId: 0x0925, productId: 0x3881 };
const delay = (milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
const hex16 = (value: number) => `0x${value.toString(16).padStart(4, "0").toUpperCase()}`;
const errorText = (error: unknown) => error instanceof DOMException
  ? `${error.name}: ${error.message}`
  : error instanceof Error ? error.message : String(error);
const repeatReads = (length: number, count: number) => Array.from({ length: count }, () => length);

const steps: SaleaeProbeStep[] = [
  { id: "baseline-ep1-64", description: "不发送命令，读取 EP1 IN", order: "read-only", readEndpoint: 1, readLength: 64, timeoutMs: 900 },
  { id: "baseline-ep2-512", description: "不发送命令，读取 EP2 IN", order: "read-only", readEndpoint: 2, readLength: 512, timeoutMs: 900 },
  { id: "new-24m-512", description: "新版协议 24MHz，EP2 读取 512", order: "command-then-read", command: [0xd5, 0xe0], readEndpoint: 2, readLength: 512, timeoutMs: 1500 },
  { id: "new-24m-2048", description: "新版协议 24MHz，EP2 首包 2048", order: "command-then-read", command: [0xd5, 0xe0], readEndpoint: 2, readLength: 2048, timeoutMs: 1500 },
  { id: "new-1m-2048", description: "新版协议 1MHz，EP2 首包 2048", order: "command-then-read", command: [0xd5, 0x8e], readEndpoint: 2, readLength: 2048, timeoutMs: 1500 },
  { id: "new-1m-4096", description: "新版协议 1MHz，EP2 读取 4096", order: "command-then-read", command: [0xd5, 0x8e], readEndpoint: 2, readLength: 4096, timeoutMs: 1500 },
  { id: "new-1m-prequeued", description: "先排队 EP2 读取，再发送新版 1MHz 命令", order: "read-then-command", command: [0xd5, 0x8e], readEndpoint: 2, readLength: 2048, timeoutMs: 1500 },
  { id: "new-24m-stream", description: "新版 24MHz，同会话连续读取 512→2048→4096×3", order: "command-then-read", command: [0xd5, 0xe0], readEndpoint: 2, readLength: 512, readSequence: [512, 2048, 4096, 4096, 4096], timeoutMs: 1500 },
  { id: "new-1m-stream", description: "新版 1MHz，同会话连续读取 512→2048→4096×3", order: "command-then-read", command: [0xd5, 0x8e], readEndpoint: 2, readLength: 512, readSequence: [512, 2048, 4096, 4096, 4096], timeoutMs: 1500 },
  { id: "new-2m-sequential-4096x8", description: "新版 2MHz，顺序读取 4096×8", order: "command-then-read", command: [0xd5, 0xe6], readEndpoint: 2, readLength: 4096, readSequence: repeatReads(4096, 8), timeoutMs: 1200 },
  { id: "new-4m-sequential-4096x8", description: "新版 4MHz，顺序读取 4096×8", order: "command-then-read", command: [0xd5, 0xda], readEndpoint: 2, readLength: 4096, readSequence: repeatReads(4096, 8), timeoutMs: 1200 },
  { id: "new-8m-sequential-4096x8", description: "新版 8MHz，顺序读取 4096×8", order: "command-then-read", command: [0xd5, 0xd4], readEndpoint: 2, readLength: 4096, readSequence: repeatReads(4096, 8), timeoutMs: 1200 },
  { id: "new-12m-sequential-4096x8", description: "新版 12MHz，顺序读取 4096×8", order: "command-then-read", command: [0xd5, 0xe2], readEndpoint: 2, readLength: 4096, readSequence: repeatReads(4096, 8), timeoutMs: 1200 },
  { id: "new-16m-sequential-4096x8", description: "新版 16MHz，顺序读取 4096×8", order: "command-then-read", command: [0xd5, 0xd5], readEndpoint: 2, readLength: 4096, readSequence: repeatReads(4096, 8), timeoutMs: 1200 },
  { id: "new-24m-sequential-4096x8", description: "新版 24MHz，顺序读取 4096×8", order: "command-then-read", command: [0xd5, 0xe0], readEndpoint: 2, readLength: 4096, readSequence: repeatReads(4096, 8), timeoutMs: 1200 },
  { id: "new-24m-sequential-512x5", description: "新版 24MHz，同会话顺序读取 512×5", order: "command-then-read", command: [0xd5, 0xe0], readEndpoint: 2, readLength: 512, readSequence: [512, 512, 512, 512, 512], timeoutMs: 1500 },
  { id: "new-24m-prequeue-2x512", description: "预排队 2 个 EP2/512 请求，再发送新版 24MHz 命令", order: "read-then-command", command: [0xd5, 0xe0], readEndpoint: 2, readLength: 512, readSequence: [512, 512], prequeueAllReads: true, timeoutMs: 1500 },
  { id: "new-24m-prequeue-4x512", description: "预排队 4 个 EP2/512 请求，再发送新版 24MHz 命令", order: "read-then-command", command: [0xd5, 0xe0], readEndpoint: 2, readLength: 512, readSequence: [512, 512, 512, 512], prequeueAllReads: true, timeoutMs: 1500 },
  { id: "new-24m-prequeue-8x512", description: "预排队 8 个 EP2/512 请求，验证请求数量边界", order: "read-then-command", command: [0xd5, 0xe0], readEndpoint: 2, readLength: 512, readSequence: repeatReads(512, 8), prequeueAllReads: true, timeoutMs: 1500 },
  { id: "new-24m-prequeue-16x512", description: "预排队 16 个 EP2/512 请求，验证持续全量预队列", order: "read-then-command", command: [0xd5, 0xe0], readEndpoint: 2, readLength: 512, readSequence: repeatReads(512, 16), prequeueAllReads: true, timeoutMs: 1500 },
  { id: "new-24m-prequeue-8x2048", description: "预排队 8 个 EP2/2048 请求，比较传输块长度", order: "read-then-command", command: [0xd5, 0xe0], readEndpoint: 2, readLength: 2048, readSequence: repeatReads(2048, 8), prequeueAllReads: true, timeoutMs: 1500 },
  { id: "new-24m-prequeue-8x4096", description: "预排队 8 个 EP2/4096 请求，比较最大传输块", order: "read-then-command", command: [0xd5, 0xe0], readEndpoint: 2, readLength: 4096, readSequence: repeatReads(4096, 8), prequeueAllReads: true, timeoutMs: 1500 },
  { id: "new-24m-prequeue-64x4096", description: "预排队 64 个 EP2/4096 请求，覆盖默认 250k 样本采集", order: "read-then-command", command: [0xd5, 0xe0], readEndpoint: 2, readLength: 4096, readSequence: repeatReads(4096, 64), prequeueAllReads: true, timeoutMs: 2000 },
  { id: "new-24m-prequeue-mixed", description: "预排队 512→2048→4096×2，再发送新版 24MHz 命令", order: "read-then-command", command: [0xd5, 0xe0], readEndpoint: 2, readLength: 512, readSequence: [512, 2048, 4096, 4096], prequeueAllReads: true, timeoutMs: 1500 },
  { id: "new-1m-ep1-response", description: "新版 1MHz 命令后读取 EP1 IN", order: "command-then-read", command: [0xd5, 0x8e], readEndpoint: 1, readLength: 64, timeoutMs: 1200 },
  { id: "old-24m-2048", description: "旧版协议 24MHz，EP2 首包 2048", order: "command-then-read", command: [0x01, 0x01], readEndpoint: 2, readLength: 2048, timeoutMs: 1500 },
  { id: "old-1m-2048", description: "旧版协议 1MHz，EP2 首包 2048", order: "command-then-read", command: [0x01, 0x2f], readEndpoint: 2, readLength: 2048, timeoutMs: 1500 },
];

const newRecoveryStep: SaleaeProbeStep = { id: "new-recovery-512", description: "恢复新版 24MHz 状态并读取 EP2 512", order: "command-then-read", command: [0xd5, 0xe0], readEndpoint: 2, readLength: 512, timeoutMs: 1500 };
const oldRecoveryStep: SaleaeProbeStep = { id: "old-recovery-2048", description: "恢复旧版 24MHz 状态并读取 EP2 2048", order: "command-then-read", command: [0x01, 0x01], readEndpoint: 2, readLength: 2048, timeoutMs: 1500 };

async function prepareDevice(device: USBDevice): Promise<number> {
  if (!device.opened) await device.open();
  if (!device.configuration) await device.selectConfiguration(device.configurations[0]?.configurationValue ?? 1);
  const usbInterface = device.configuration?.interfaces[0];
  if (!usbInterface) throw new Error("设备没有 USB Interface");
  if (!usbInterface.claimed) await device.claimInterface(usbInterface.interfaceNumber);
  return usbInterface.interfaceNumber;
}

async function closeDevice(device: USBDevice, interfaceNumber?: number): Promise<void> {
  try { if (device.opened && interfaceNumber !== undefined) await device.releaseInterface(interfaceNumber); } catch { /* Continue closing. */ }
  try { if (device.opened) await device.close(); } catch { /* Browser will release it. */ }
}

function readWithTimeout(device: USBDevice, endpoint: number, length: number, timeoutMs: number): Promise<USBInTransferResult> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      void device.close().catch(() => undefined);
      reject(new Error(`TIMEOUT:${timeoutMs}`));
    }, timeoutMs);
    device.transferIn(endpoint, length).then(
      (result) => { window.clearTimeout(timer); resolve(result); },
      (error) => { window.clearTimeout(timer); reject(error); },
    );
  });
}

function analyzeBytes(data: Uint8Array) {
  const uniqueByteCount = new Set(data).size;
  const bitTransitions = Array.from({ length: 8 }, () => 0);
  for (let index = 1; index < data.length; index += 1) {
    const changed = data[index] ^ data[index - 1];
    for (let bit = 0; bit < 8; bit += 1) if (changed & 1 << bit) bitTransitions[bit] += 1;
  }
  return {
    dataBase64: window.btoa(Array.from({ length: Math.ceil(data.length / 0x8000) }, (_, index) =>
      String.fromCharCode(...data.subarray(index * 0x8000, (index + 1) * 0x8000)),
    ).join("")),
    first64Hex: Array.from(data.subarray(0, 64), (value) => value.toString(16).padStart(2, "0")).join(" "),
    uniqueByteCount,
    bitTransitions,
  };
}

function deviceDescriptor(device: USBDevice): SaleaeProtocolProbeReport["device"] {
  return {
    vendorId: device.vendorId,
    productId: device.productId,
    vendorIdHex: hex16(device.vendorId),
    productIdHex: hex16(device.productId),
    manufacturer: device.manufacturerName || undefined,
    product: device.productName || undefined,
    configurationValue: device.configuration?.configurationValue,
    interfaces: device.configuration?.interfaces.map((usbInterface) => ({
      interfaceNumber: usbInterface.interfaceNumber,
      activeAlternate: usbInterface.alternate.alternateSetting,
      alternates: (usbInterface.alternates ?? [usbInterface.alternate]).map((alternate) => ({
        alternateSetting: alternate.alternateSetting,
        endpoints: alternate.endpoints.map((endpoint) => ({ endpointNumber: endpoint.endpointNumber, direction: endpoint.direction, type: endpoint.type })),
      })),
    })) ?? [],
  };
}

async function findAuthorizedDevice(): Promise<USBDevice> {
  const device = (await navigator.usb!.getDevices()).find((candidate) => candidate.vendorId === 0x0925 && candidate.productId === 0x3881);
  if (!device) throw new Error("浏览器授权列表中找不到 0x0925:0x3881；请重新运行探测并选择设备");
  return device;
}

async function runStep(step: SaleaeProbeStep): Promise<SaleaeProbeResult> {
  const started = performance.now();
  const result: SaleaeProbeResult = { ...step, startedAt: new Date().toISOString(), durationMs: 0, receivedLength: 0 };
  const device = await findAuthorizedDevice();
  let interfaceNumber: number | undefined;
  const chunks: Uint8Array[] = [];
  const reads: SaleaeProbeReadResult[] = [];
  try {
    interfaceNumber = await prepareDevice(device);
    let readOperation: Promise<USBInTransferResult>;
    const prequeuedReads = step.prequeueAllReads
      ? (step.readSequence ?? [step.readLength]).map((length) => {
        const queuedAt = performance.now();
        const operation = readWithTimeout(device, step.readEndpoint, length, step.timeoutMs).then(
          (value) => ({ value, durationMs: Math.round(performance.now() - queuedAt) }),
          (error: unknown) => ({ error, durationMs: Math.round(performance.now() - queuedAt) }),
        );
        return { length, operation };
      })
      : undefined;
    if (prequeuedReads) {
      readOperation = Promise.resolve(undefined as never);
      await delay(25);
    } else if (step.order === "read-then-command") {
      readOperation = readWithTimeout(device, step.readEndpoint, step.readLength, step.timeoutMs);
      await delay(25);
    } else {
      readOperation = Promise.resolve(undefined as never);
    }
    if (step.command) {
      const write = await device.transferOut(1, Uint8Array.from(step.command).buffer);
      result.writeStatus = write.status;
      result.bytesWritten = write.bytesWritten;
      if (write.status !== "ok") throw new Error(`Bulk OUT 返回 ${write.status}`);
    }
    if (prequeuedReads) {
      const settledReads = await Promise.all(prequeuedReads.map((queued) => queued.operation));
      let firstReadError: unknown;
      for (let index = 0; index < prequeuedReads.length; index += 1) {
        const settled = settledReads[index];
        if ("error" in settled) {
          firstReadError ??= settled.error;
          reads.push({ index, requestedLength: prequeuedReads[index].length, durationMs: settled.durationMs, receivedLength: 0, error: errorText(settled.error).startsWith("TIMEOUT:") ? `timeout after ${step.timeoutMs}ms` : errorText(settled.error) });
          continue;
        }
        const read = settled.value;
        result.readStatus = read.status;
        if (read.status !== "ok" || !read.data) {
          const readError = new Error(`Bulk IN 返回 ${read.status}`);
          firstReadError ??= readError;
          reads.push({ index, requestedLength: prequeuedReads[index].length, durationMs: settled.durationMs, status: read.status, receivedLength: 0, error: readError.message });
          continue;
        }
        const data = new Uint8Array(read.data.buffer, read.data.byteOffset, read.data.byteLength);
        chunks.push(data);
        reads.push({ index, requestedLength: prequeuedReads[index].length, durationMs: settled.durationMs, status: read.status, receivedLength: data.byteLength, first16Hex: Array.from(data.subarray(0, 16), (value) => value.toString(16).padStart(2, "0")).join(" ") });
      }
      if (firstReadError) throw firstReadError;
    } else if (step.order === "read-then-command") {
      const readStarted = performance.now();
      const read = await readOperation;
      result.readStatus = read.status;
      if (read.status !== "ok" || !read.data) throw new Error(`Bulk IN 返回 ${read.status}`);
      const data = new Uint8Array(read.data.buffer, read.data.byteOffset, read.data.byteLength);
      chunks.push(data);
      reads.push({ index: 0, requestedLength: step.readLength, durationMs: Math.round(performance.now() - readStarted), status: read.status, receivedLength: data.byteLength, first16Hex: Array.from(data.subarray(0, 16), (value) => value.toString(16).padStart(2, "0")).join(" ") });
    } else {
      const sequence = step.readSequence ?? [step.readLength];
      for (let index = 0; index < sequence.length; index += 1) {
        const readStarted = performance.now();
        try {
          const read = await readWithTimeout(device, step.readEndpoint, sequence[index], step.timeoutMs);
          result.readStatus = read.status;
          if (read.status !== "ok" || !read.data) throw new Error(`Bulk IN 返回 ${read.status}`);
          const data = new Uint8Array(read.data.buffer, read.data.byteOffset, read.data.byteLength);
          chunks.push(data);
          reads.push({ index, requestedLength: sequence[index], durationMs: Math.round(performance.now() - readStarted), status: read.status, receivedLength: data.byteLength, first16Hex: Array.from(data.subarray(0, 16), (value) => value.toString(16).padStart(2, "0")).join(" ") });
        } catch (error) {
          reads.push({ index, requestedLength: sequence[index], durationMs: Math.round(performance.now() - readStarted), receivedLength: 0, error: errorText(error).startsWith("TIMEOUT:") ? `timeout after ${step.timeoutMs}ms` : errorText(error) });
          throw error;
        }
      }
    }
    result.reads = reads;
    result.receivedLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
    const data = new Uint8Array(result.receivedLength);
    let dataOffset = 0;
    for (const chunk of chunks) { data.set(chunk, dataOffset); dataOffset += chunk.byteLength; }
    Object.assign(result, analyzeBytes(data));
  } catch (error) {
    const message = errorText(error);
    result.error = message.startsWith("TIMEOUT:") ? `timeout after ${step.timeoutMs}ms` : message;
    if (reads.length) result.reads = reads;
    result.receivedLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
    if (result.receivedLength) {
      const partial = new Uint8Array(result.receivedLength);
      let partialOffset = 0;
      for (const chunk of chunks) { partial.set(chunk, partialOffset); partialOffset += chunk.byteLength; }
      Object.assign(result, analyzeBytes(partial));
    }
  } finally {
    await closeDevice(device, interfaceNumber);
    result.durationMs = Math.round(performance.now() - started);
    await delay(120);
  }
  return result;
}

export async function probeSaleaeProtocol(onProgress: (message: string) => void): Promise<SaleaeProtocolProbeReport> {
  if (!navigator.usb || !window.isSecureContext) throw new Error("当前浏览器环境不支持 WebUSB");
  const authorized = (await navigator.usb.getDevices()).find((candidate) => candidate.vendorId === filter.vendorId && candidate.productId === filter.productId);
  onProgress(authorized ? "正在使用已授权的 0x0925:0x3881 设备；探测不会写入固件" : "请选择 0x0925:0x3881 设备；探测不会写入固件");
  const selected = authorized ?? await navigator.usb.requestDevice({ filters: [filter] });
  let selectedInterface: number | undefined;
  try {
    selectedInterface = await prepareDevice(selected);
  } finally {
    await closeDevice(selected, selectedInterface);
  }
  const descriptorDevice = await findAuthorizedDevice();
  await prepareDevice(descriptorDevice);
  const descriptor = deviceDescriptor(descriptorDevice);
  await closeDevice(descriptorDevice, descriptor.interfaces[0]?.interfaceNumber);

  const activeEndpoints = descriptor.interfaces.flatMap((usbInterface) => usbInterface.alternates.find((alternate) => alternate.alternateSetting === usbInterface.activeAlternate)?.endpoints ?? []);
  const newerFirmware = activeEndpoints.length > 2;
  const applicableSteps = steps.filter((step) => newerFirmware ? !step.id.startsWith("old-") : !step.id.startsWith("new-"));
  applicableSteps.push(newerFirmware ? newRecoveryStep : oldRecoveryStep);
  const results: SaleaeProbeResult[] = [];
  for (let index = 0; index < applicableSteps.length; index += 1) {
    onProgress(`协议探测 ${index + 1}/${applicableSteps.length}：${applicableSteps[index].description}`);
    results.push(await runStep(applicableSteps[index]));
  }
  const responses = results.filter((result) => result.receivedLength > 0).length;
  const timeouts = results.filter((result) => result.error?.startsWith("timeout")).length;
  const errors = results.filter((result) => result.error && !result.error.startsWith("timeout")).length;
  const successful = results.filter((result) => result.receivedLength > 0).map((result) => result.id);
  return {
    schema: "pc-toolbox.saleae-protocol-probe",
    schemaVersion: 6,
    createdAt: new Date().toISOString(),
    safety: {
      firmwareWrites: false,
      controlTransfers: false,
      allowedOutEndpoint: 1,
      allowedInEndpoints: [1, 2],
      stateIsolation: "Each case reopens the USB handle, but firmware runtime state may persist. The final case restores the detected protocol's known-good 24MHz state.",
      note: "Only commands matching the detected old/new endpoint profile are sent. No 0xA0, CPUCS, RAM, EEPROM, EP6, or vendor control writes.",
    },
    environment: {
      userAgent: navigator.userAgent,
      secureContext: window.isSecureContext,
      platform: "userAgentData" in navigator ? String((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? "") : undefined,
    },
    device: descriptor,
    summary: {
      total: applicableSteps.length,
      responses,
      timeouts,
      errors,
      candidateConclusion: successful.length ? `收到数据的测试：${successful.join(", ")}` : "所有已知安全测试均未收到数据；需要结合文件判断驱动层、固件版本或额外握手。",
    },
    results,
  };
}

export function downloadSaleaeProbeReport(report: SaleaeProtocolProbeReport): void {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `saleae-protocol-probe-${report.createdAt.replace(/[:.]/g, "-")}.json`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
