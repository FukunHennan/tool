import { describe, expect, it } from "vitest";
import { analyzeChip, analyzeCommunication } from "./espAnalysis";

describe("analyzeCommunication", () => {
  it("identifies a known USB-to-UART bridge", () => {
    expect(analyzeCommunication(0x0403, 0x6001, 115200)).toMatchObject({
      browserApi: "Web Serial API",
      physicalLink: "USB 转 UART",
      bridgeVendor: "FTDI",
      bridgeModel: "FT232R / FT232B 系列",
      bridgeConfidence: "已识别",
      usbVendorIdHex: "0x0403",
      usbProductIdHex: "0x6001",
      baudRate: 115200,
      serialFormat: "8 data bits · no parity · 1 stop bit（8-N-1）",
    });
  });

  it("falls back to vendor-level information for an unknown product", () => {
    expect(analyzeCommunication(0x1a86, 0xffff, 921600)).toMatchObject({
      physicalLink: "USB 串口设备",
      bridgeVendor: "WCH",
      bridgeModel: "型号未收录",
      bridgeConfidence: "厂商级推断",
      usbVendorIdHex: "0x1A86",
      usbProductIdHex: "0xFFFF",
      baudRate: 921600,
    });
  });

  it("preserves IDs without inventing bridge details for an unknown vendor", () => {
    const communication = analyzeCommunication(0xabcd, 0x0001, 460800);

    expect(communication).toMatchObject({
      usbVendorId: 0xabcd,
      usbProductId: 0x0001,
      usbVendorIdHex: "0xABCD",
      usbProductIdHex: "0x0001",
    });
    expect(communication.bridgeVendor).toBeUndefined();
    expect(communication.bridgeModel).toBeUndefined();
    expect(communication.physicalLink).toBeUndefined();
  });
});

describe("analyzeChip", () => {
  it("classifies ESP32-S3 capabilities and calculates its Flash range", () => {
    const analysis = analyzeChip(
      "ESP32-S3",
      "ESP32-S3 (QFN56) (revision v0.2)",
      ["Wi-Fi", "BLE", "Embedded PSRAM 8MB", "USB OTG"],
      "16MB",
      0xef,
      "aa:bb:cc:11:22:33",
    );

    expect(analysis).toMatchObject({
      family: "ESP32-S3",
      architecture: "Tensilica Xtensa LX7（双核）",
      packageName: "QFN56",
      radioCapabilities: ["Wi-Fi", "BLE"],
      memoryCapabilities: ["Embedded PSRAM 8MB"],
      otherCapabilities: ["USB OTG"],
      flashManufacturer: "Winbond",
      flashSizeBytes: 16 * 1024 * 1024,
      flashAddressRange: "0x00000000 – 0x00FFFFFF",
      macOui: "AA:BB:CC",
    });
    expect(analysis.summary).toContain("ESP32-S3");
    expect(analysis.summary).toContain("16MB Flash");
  });

  it("supports KB sizes and RISC-V chip families", () => {
    const analysis = analyzeChip(
      "ESP32-C6",
      "ESP32-C6 (QFN40)",
      ["802.15.4", "Embedded Flash 4MB", "Temperature sensor"],
      "512 KB",
      0xaa,
      undefined,
    );

    expect(analysis).toMatchObject({
      architecture: "RISC-V",
      packageName: "QFN40",
      radioCapabilities: ["802.15.4"],
      memoryCapabilities: ["Embedded Flash 4MB"],
      otherCapabilities: ["Temperature sensor"],
      flashSizeBytes: 512 * 1024,
      flashAddressRange: "0x00000000 – 0x0007FFFF",
    });
    expect(analysis.flashManufacturer).toBeUndefined();
    expect(analysis.macOui).toBeUndefined();
  });

  it("leaves derived hardware fields undefined when inputs are unknown", () => {
    const analysis = analyzeChip("UNKNOWN", "Unknown device", [], "not reported", undefined, undefined);

    expect(analysis.family).toBe("UNKNOWN");
    expect(analysis.architecture).toBeUndefined();
    expect(analysis.packageName).toBeUndefined();
    expect(analysis.flashManufacturer).toBeUndefined();
    expect(analysis.flashSizeBytes).toBeUndefined();
    expect(analysis.flashAddressRange).toBeUndefined();
  });
});
