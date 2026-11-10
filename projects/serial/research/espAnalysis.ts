export interface EspCommunicationInfo {
  browserApi: string;
  physicalLink?: string;
  transportProtocol: string;
  bridgeVendor?: string;
  bridgeModel?: string;
  bridgeConfidence?: "已识别" | "厂商级推断";
  usbVendorId?: number;
  usbProductId?: number;
  usbVendorIdHex?: string;
  usbProductIdHex?: string;
  baudRate: number;
  serialFormat: string;
  resetStrategy: string;
  loaderPath: string;
}

export interface EspParsedInfo {
  family: string;
  architecture?: string;
  packageName?: string;
  radioCapabilities: string[];
  memoryCapabilities: string[];
  otherCapabilities: string[];
  flashManufacturer?: string;
  flashSizeBytes?: number;
  flashAddressRange?: string;
  macOui?: string;
  summary?: string;
  notes: string[];
}

interface UsbBridgeDefinition {
  vendor: string;
  model: string;
  physicalLink: string;
  confidence: EspCommunicationInfo["bridgeConfidence"];
}

const usbBridgeMap = new Map<string, UsbBridgeDefinition>([
  ["0403:6001", { vendor: "FTDI", model: "FT232R / FT232B 系列", physicalLink: "USB 转 UART", confidence: "已识别" }],
  ["10C4:EA60", { vendor: "Silicon Labs", model: "CP210x 系列", physicalLink: "USB 转 UART", confidence: "已识别" }],
  ["1A86:7523", { vendor: "WCH", model: "CH340 / CH341 系列", physicalLink: "USB 转 UART", confidence: "已识别" }],
  ["1A86:55D4", { vendor: "WCH", model: "CH9102 系列", physicalLink: "USB 转 UART", confidence: "已识别" }],
  ["067B:2303", { vendor: "Prolific", model: "PL2303 系列", physicalLink: "USB 转 UART", confidence: "已识别" }],
  ["303A:1001", { vendor: "Espressif", model: "USB Serial/JTAG Controller", physicalLink: "芯片原生 USB Serial/JTAG", confidence: "已识别" }],
  ["303A:0002", { vendor: "Espressif", model: "USB OTG / CDC", physicalLink: "芯片原生 USB", confidence: "已识别" }],
]);

const usbVendorMap = new Map<number, string>([
  [0x0403, "FTDI"], [0x10c4, "Silicon Labs"], [0x1a86, "WCH"],
  [0x067b, "Prolific"], [0x303a, "Espressif"], [0x2341, "Arduino"],
]);

const flashVendors = new Map<number, string>([
  [0xef, "Winbond"], [0xc8, "GigaDevice"], [0xc2, "Macronix"],
  [0x1c, "EON"], [0x0b, "XTX"], [0x9d, "ISSI"], [0x20, "Micron / XMC"],
]);

const architectureMap: Array<[RegExp, string]> = [
  [/ESP8266/i, "Tensilica Xtensa L106（单核）"],
  [/ESP32-S3/i, "Tensilica Xtensa LX7（双核）"],
  [/ESP32-S2/i, "Tensilica Xtensa LX7（单核）"],
  [/^ESP32$/i, "Tensilica Xtensa LX6（双核）"],
  [/ESP32-P4/i, "RISC-V（双核高性能）"],
  [/ESP32-(C2|C3|C5|C6|C61|H2)/i, "RISC-V"],
];

function hex16(value?: number): string | undefined {
  return value === undefined ? undefined : `0x${value.toString(16).padStart(4, "0").toUpperCase()}`;
}

function bridgeInfo(vendorId?: number, productId?: number): UsbBridgeDefinition | undefined {
  if (vendorId !== undefined && productId !== undefined) {
    const exact = usbBridgeMap.get(`${vendorId.toString(16).padStart(4, "0").toUpperCase()}:${productId.toString(16).padStart(4, "0").toUpperCase()}`);
    if (exact) return exact;
  }
  if (vendorId !== undefined && usbVendorMap.has(vendorId)) {
    const vendor = usbVendorMap.get(vendorId)!;
    return { vendor, model: "型号未收录", physicalLink: vendor === "Espressif" ? "Espressif USB 接口" : "USB 串口设备", confidence: "厂商级推断" };
  }
  return undefined;
}

export function analyzeCommunication(vendorId: number | undefined, productId: number | undefined, baudRate: number): EspCommunicationInfo {
  const bridge = bridgeInfo(vendorId, productId);
  return {
    browserApi: "Web Serial API",
    physicalLink: bridge?.physicalLink,
    transportProtocol: "Espressif ROM 串行协议（SLIP 帧）",
    bridgeVendor: bridge?.vendor,
    bridgeModel: bridge?.model,
    bridgeConfidence: bridge?.confidence,
    usbVendorId: vendorId,
    usbProductId: productId,
    usbVendorIdHex: hex16(vendorId),
    usbProductIdHex: hex16(productId),
    baudRate,
    serialFormat: "8 data bits · no parity · 1 stop bit（8-N-1）",
    resetStrategy: "DTR/RTS 自动下载复位（default_reset）",
    loaderPath: "ROM Bootloader → RAM Stub Loader → 芯片查询 → Hard Reset",
  };
}

function parseFlashSize(size: string): number | undefined {
  const match = size.match(/^\s*(\d+(?:\.\d+)?)\s*(KB|MB)\s*$/i);
  if (!match) return undefined;
  const unit = match[2].toUpperCase() === "MB" ? 1024 * 1024 : 1024;
  return Math.round(Number(match[1]) * unit);
}

export function analyzeChip(
  chipName: string,
  description: string,
  features: string[],
  flashSize: string | undefined,
  flashManufacturerId: number | undefined,
  macAddress: string | undefined,
): EspParsedInfo {
  const architecture = architectureMap.find(([pattern]) => pattern.test(chipName))?.[1];
  const packageName = description.match(/\((QFN\d+|BGA\d*|WLCSP\d*)\)/i)?.[1];
  const radioCapabilities = features.filter((feature) => /wi-?fi|bluetooth|\bble\b|802\.15\.4|zigbee|thread/i.test(feature));
  const memoryCapabilities = features.filter((feature) => /psram|flash|ram|embedded/i.test(feature) && !radioCapabilities.includes(feature));
  const otherCapabilities = features.filter((feature) => !radioCapabilities.includes(feature) && !memoryCapabilities.includes(feature));
  const flashSizeBytes = flashSize ? parseFlashSize(flashSize) : undefined;
  const flashManufacturer = flashManufacturerId === undefined ? undefined : flashVendors.get(flashManufacturerId);
  const notes = [
    "芯片型号和 Revision 来自 ROM/eFuse 只读信息。",
    "Flash 容量由 JEDEC ID 推断，外部 Flash 被替换后结果会随之改变。",
    "通讯桥接型号根据 USB VID/PID 推断，不代表开发板品牌或具体板型。",
    "MAC 地址是设备标识，导出和分享报告时应注意隐私。",
  ];
  return {
    family: chipName.replace(/\s.*/, ""),
    architecture,
    packageName,
    radioCapabilities,
    memoryCapabilities,
    otherCapabilities,
    flashManufacturer,
    flashSizeBytes,
    flashAddressRange: flashSizeBytes ? `0x00000000 – 0x${(flashSizeBytes - 1).toString(16).padStart(8, "0").toUpperCase()}` : undefined,
    macOui: macAddress ? macAddress.split(":").slice(0, 3).join(":").toUpperCase() : undefined,
    summary: [chipName, architecture, flashSize ? `${flashSize} Flash` : undefined, radioCapabilities.length ? `支持 ${radioCapabilities.join(" / ")}` : undefined].filter(Boolean).join("，"),
    notes,
  };
}
