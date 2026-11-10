import type { EspChipInfo } from "./EspDetector";
import type { EspSecuritySummary } from "./espSecurity";
import { recommendPlatformIo } from "./platformioRecommendation";

function parsePsramSize(features: string[]): string | undefined {
  return features.map((feature) => feature.match(/PSRAM\s+([\d.]+\s*(?:KB|MB))/i)?.[1]).find(Boolean);
}

export function buildEspJsonReport(info: EspChipInfo, security?: EspSecuritySummary) {
  const platformIo = recommendPlatformIo(info);
  return {
    schemaVersion: 1,
    reportType: "pc-toolbox.esp-rom-readonly",
    generatedAt: new Date().toISOString(),
    mode: {
      id: "rom-readonly",
      writesFlash: false,
      writesEfuse: false,
      note: "ROM Bootloader 只读检测；未检测字段使用 null，不填充默认数据。",
    },
    chip: {
      name: info.chipName,
      description: info.description,
      revision: info.revision ?? null,
      architecture: info.analysis.architecture ?? null,
      packageName: info.analysis.packageName ?? null,
      features: info.features,
      crystalMhz: info.crystalMhz ?? null,
      macAddress: info.macAddress ?? null,
    },
    memory: {
      flashId: info.flashId ?? null,
      flashManufacturerId: info.flashManufacturerId ?? null,
      flashDeviceId: info.flashDeviceId ?? null,
      flashSize: info.flashSize ?? null,
      psramSize: parsePsramSize(info.features) ?? null,
    },
    communication: info.communication,
    security: security ? {
      source: security.source,
      importedAt: security.importedAt,
      secureBootEnabled: security.secureBootEnabled ?? null,
      flashEncryptionEnabled: security.flashEncryptionEnabled ?? null,
      spiBootCryptCount: security.spiBootCryptCount ?? null,
      downloadManualEncryptionDisabled: security.downloadManualEncryptionDisabled ?? null,
      macAddress: security.macAddress ?? null,
      safeFields: security.fields,
      warnings: security.warnings,
    } : {
      source: null,
      secureBootEnabled: null,
      flashEncryptionEnabled: null,
      note: "浏览器版 esptool-js 不包含完整 espefuse 解码；需导入 espefuse summary --format json 的结果。",
    },
    platformIo: platformIo ? {
      confidence: platformIo.confidence,
      platform: platformIo.platform,
      board: platformIo.board,
      framework: platformIo.framework,
      ini: platformIo.ini,
      reasons: platformIo.reasons,
      warnings: platformIo.warnings,
    } : null,
    boardLevelUnknowns: [
      "摄像头实际 GPIO",
      "TF 卡、麦克风和 LED 的 PCB 走线",
      "排针与芯片 GPIO 的实际连接",
      "开发板品牌和具体硬件版本",
    ],
    detectionWarnings: info.detectionWarnings,
  };
}

export function downloadEspJsonReport(info: EspChipInfo, security?: EspSecuritySummary): void {
  const report = buildEspJsonReport(info, security);
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `esp-rom-report-${info.chipName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}.json`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
