import type { EspChipInfo } from "./EspDetector";

export interface PlatformIoRecommendation {
  platform: string;
  board: string;
  boardName: string;
  framework: "arduino" | "espidf";
  confidence: "较高" | "中等" | "需确认";
  reasons: string[];
  warnings: string[];
  sourceUrl: string;
  ini: string;
}

interface BoardChoice {
  board: string;
  boardName: string;
  framework?: PlatformIoRecommendation["framework"];
  confidence: PlatformIoRecommendation["confidence"];
  sourceUrl: string;
  reason: string;
}

const pioDocs = "https://docs.platformio.org/en/latest";

function detectedPsramMb(info: EspChipInfo): number | undefined {
  const match = info.features.join(" ").match(/PSRAM\s*(\d+(?:\.\d+)?)\s*MB/i);
  return match ? Number(match[1]) : undefined;
}

function chooseBoard(info: EspChipInfo): BoardChoice | undefined {
  const chip = info.chipName.toUpperCase();
  const flash = info.analysis.flashSizeBytes;
  const psramMb = detectedPsramMb(info);

  if (chip.includes("ESP8266")) {
    if (flash === 512 * 1024) return { board: "esp01", boardName: "Espressif Generic ESP8266 ESP-01 512k", confidence: "中等", sourceUrl: `${pioDocs}/boards/espressif8266/esp01.html`, reason: "检测到ESP8266和512KB Flash，与该通用模板容量一致" };
    if (flash === 1024 * 1024) return { board: "esp01_1m", boardName: "Espressif Generic ESP8266 ESP-01 1M", confidence: "中等", sourceUrl: `${pioDocs}/boards/espressif8266/esp01_1m.html`, reason: "检测到ESP8266和1MB Flash，与esp01_1m定义一致" };
    return { board: "esp12e", boardName: "Espressif ESP8266 ESP-12E", confidence: "需确认", sourceUrl: `${pioDocs}/boards/espressif8266/esp12e.html`, reason: "检测到ESP8266，但Flash容量不对应ESP-01的512KB/1MB模板" };
  }
  if (/ESP32-S3/.test(chip)) {
    if (flash === 8 * 1024 * 1024 && psramMb === 8) return { board: "freenove_esp32_s3_wroom", boardName: "ESP32-S3 WROOM N8R8配置模板", confidence: "中等", sourceUrl: `${pioDocs}/boards/espressif32/freenove_esp32_s3_wroom.html`, reason: "检测到ESP32-S3、8MB Flash和8MB PSRAM，与N8R8存储配置一致" };
    return { board: "esp32-s3-devkitc-1", boardName: "Espressif ESP32-S3-DevKitC-1", confidence: flash === 8 * 1024 * 1024 && psramMb === undefined ? "较高" : "需确认", sourceUrl: `${pioDocs}/boards/espressif32/esp32-s3-devkitc-1.html`, reason: "使用PlatformIO官方ESP32-S3通用开发板模板" };
  }
  if (/ESP32-S2/.test(chip)) return { board: "esp32-s2-saola-1", boardName: "Espressif ESP32-S2-Saola-1", confidence: "需确认", sourceUrl: `${pioDocs}/boards/espressif32/esp32-s2-saola-1.html`, reason: "芯片系列匹配ESP32-S2，具体PCB仍需核对" };
  if (/ESP32-C3/.test(chip)) return { board: "esp32-c3-devkitm-1", boardName: "Espressif ESP32-C3-DevKitM-1", confidence: "需确认", sourceUrl: `${pioDocs}/boards/espressif32/esp32-c3-devkitm-1.html`, reason: "芯片系列匹配ESP32-C3，具体PCB仍需核对" };
  if (/ESP32-C6/.test(chip)) return { board: "esp32-c6-devkitc-1", boardName: "Espressif ESP32-C6-DevKitC-1", framework: "espidf", confidence: "需确认", sourceUrl: `${pioDocs}/boards/espressif32/esp32-c6-devkitc-1.html`, reason: "芯片系列匹配ESP32-C6；当前官方板定义以ESP-IDF为主" };
  if (/^ESP32(?:\s|$|-D0WD|-PICO)/.test(chip)) return { board: "esp32dev", boardName: "Espressif ESP32 Dev Module", confidence: "需确认", sourceUrl: `${pioDocs}/boards/espressif32/esp32dev.html`, reason: "检测到经典ESP32系列，推荐通用ESP32 Dev Module模板" };
  return undefined;
}

export function recommendPlatformIo(info: EspChipInfo): PlatformIoRecommendation | undefined {
  const choice = chooseBoard(info);
  if (!choice) return undefined;
  const platform = info.chipName.toUpperCase().includes("ESP8266") ? "espressif8266" : "espressif32";
  const framework = choice.framework ?? "arduino";
  const reasons = [choice.reason];
  if (info.flashSize) reasons.push(`实测Flash容量：${info.flashSize}`);
  const psramMb = detectedPsramMb(info);
  if (psramMb !== undefined) reasons.push(`实测PSRAM容量：${psramMb}MB`);
  const warnings = ["ROM检测无法识别开发板品牌、PCB引脚布局、LED和外设连接，烧录前请核对板卡丝印或原理图。"];
  if (choice.board === "freenove_esp32_s3_wroom") warnings.push("这里推荐的是存储配置匹配的N8R8模板，不代表设备品牌一定是Freenove。");
  if (!info.analysis.flashSizeBytes) warnings.push("未读取到Flash容量，因此推荐未进行容量匹配。");
  const ini = [`[env:${choice.board}]`, `platform = ${platform}`, `board = ${choice.board}`, `framework = ${framework}`].join("\n");
  return { platform, board: choice.board, boardName: choice.boardName, framework, confidence: choice.confidence, reasons, warnings, sourceUrl: choice.sourceUrl, ini };
}
