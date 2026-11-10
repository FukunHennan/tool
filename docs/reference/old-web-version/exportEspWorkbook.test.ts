import { describe, expect, it } from "vitest";
import type { EspChipInfo } from "./EspDetector";
import { analyzeChip, analyzeCommunication } from "./espAnalysis";
import { createEspWorkbookBytes } from "./exportEspWorkbook";

function sampleInfo(): EspChipInfo {
  const features = ["Wi-Fi", "BLE", "Embedded PSRAM 8MB (AP_3v3)"];
  const macAddress = "AA:BB:CC:11:22:33";
  return {
    chipName: "ESP32-S3",
    description: "ESP32-S3 (QFN56) (revision v0.2)",
    revision: 0,
    features,
    crystalMhz: 40,
    macAddress,
    flashId: "0x184068",
    flashManufacturerId: "0x68",
    flashDeviceId: "0x1840",
    flashSize: "16MB",
    portInfo: "WebSerial VendorID 0x403 ProductID 0x6001",
    baudRate: 115200,
    communication: analyzeCommunication(0x0403, 0x6001, 115200),
    analysis: analyzeChip("ESP32-S3", "ESP32-S3 (QFN56) (revision v0.2)", features, "16MB", 0x68, macAddress),
    detectionWarnings: [],
    detectedAt: "2026-07-21T12:00:00.000Z",
  };
}

describe("ESP workbook export", () => {
  it("creates a non-empty XLSX ZIP with all report worksheets", async () => {
    const bytes = await createEspWorkbookBytes(sampleInfo());
    expect([...bytes.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(bytes.byteLength).toBeGreaterThan(10_000);

    const excelModule = await import("exceljs");
    const ExcelJs = excelModule.default ?? excelModule;
    const workbook = new ExcelJs.Workbook();
    await workbook.xlsx.load(bytes as never);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "检测概览",
      "通讯链路",
      "特性解析",
      "eFuse安全状态",
      "PlatformIO推荐",
      "原始数据",
      "说明与来源",
    ]);
  });
});
