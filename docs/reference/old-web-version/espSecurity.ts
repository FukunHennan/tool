export interface SafeEfuseField {
  name: string;
  value?: boolean | number | string;
  rawValue?: string;
  readable?: boolean;
  writeable?: boolean;
}

export interface EspSecuritySummary {
  source: "espefuse-json";
  importedAt: string;
  secureBootEnabled?: boolean;
  flashEncryptionEnabled?: boolean;
  spiBootCryptCount?: number;
  downloadManualEncryptionDisabled?: boolean;
  macAddress?: string;
  fields: SafeEfuseField[];
  warnings: string[];
}

type EfuseJsonField = {
  name?: unknown;
  value?: unknown;
  raw_value?: unknown;
  readable?: unknown;
  writeable?: unknown;
};

const safeFieldNames = [
  "SECURE_BOOT_EN",
  "SPI_BOOT_CRYPT_CNT",
  "DIS_DOWNLOAD_MANUAL_ENCRYPT",
  "DIS_DOWNLOAD_MODE",
  "DIS_FORCE_DOWNLOAD",
  "DIS_USB_JTAG",
  "HARD_DIS_JTAG",
  "SECURE_VERSION",
  "MAC",
] as const;

function parseNumericValue(field?: EfuseJsonField): number | undefined {
  if (!field) return undefined;
  if (typeof field.value === "number" && Number.isFinite(field.value)) return field.value;
  if (typeof field.value === "boolean") return field.value ? 1 : 0;
  const candidate = typeof field.raw_value === "string" ? field.raw_value : typeof field.value === "string" ? field.value : "";
  const match = candidate.trim().match(/^(?:0x([0-9a-f]+)|0b([01]+)|(\d+))/i);
  if (!match) return undefined;
  const radix = match[1] ? 16 : match[2] ? 2 : 10;
  return Number.parseInt(match[1] ?? match[2] ?? match[3], radix);
}

function parseBooleanValue(field?: EfuseJsonField): boolean | undefined {
  if (!field) return undefined;
  if (typeof field.value === "boolean") return field.value;
  const numeric = parseNumericValue(field);
  return numeric === undefined ? undefined : numeric !== 0;
}

function countSetBits(value: number): number {
  let remaining = value >>> 0;
  let count = 0;
  while (remaining) {
    count += remaining & 1;
    remaining >>>= 1;
  }
  return count;
}

export function parseEspEfuseSummaryJson(text: string): EspSecuritySummary {
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("eFuse JSON 顶层必须是字段对象");
  }

  const source = parsed as Record<string, EfuseJsonField>;
  const byUpperName = new Map(Object.entries(source).map(([key, value]) => [key.toUpperCase(), value]));
  const fields: SafeEfuseField[] = [];

  for (const name of safeFieldNames) {
    const field = byUpperName.get(name);
    if (!field || typeof field !== "object") continue;
    const numeric = parseNumericValue(field);
    const value = typeof field.value === "boolean" || typeof field.value === "number" || typeof field.value === "string"
      ? field.value
      : numeric;
    fields.push({
      name,
      value,
      rawValue: typeof field.raw_value === "string" ? field.raw_value : undefined,
      readable: typeof field.readable === "boolean" ? field.readable : undefined,
      writeable: typeof field.writeable === "boolean" ? field.writeable : undefined,
    });
  }

  const secureBootEnabled = parseBooleanValue(byUpperName.get("SECURE_BOOT_EN"));
  const spiBootCryptCount = parseNumericValue(byUpperName.get("SPI_BOOT_CRYPT_CNT"));
  const flashEncryptionEnabled = spiBootCryptCount === undefined ? undefined : countSetBits(spiBootCryptCount) % 2 === 1;
  const downloadManualEncryptionDisabled = parseBooleanValue(byUpperName.get("DIS_DOWNLOAD_MANUAL_ENCRYPT"));
  const macField = byUpperName.get("MAC");
  const macAddress = typeof macField?.value === "string"
    ? macField.value.match(/(?:[0-9a-f]{2}:){5}[0-9a-f]{2}/i)?.[0]?.toUpperCase()
    : undefined;
  const warnings: string[] = [];

  if (secureBootEnabled === undefined) warnings.push("JSON 中没有可解析的 SECURE_BOOT_EN");
  if (spiBootCryptCount === undefined) warnings.push("JSON 中没有可解析的 SPI_BOOT_CRYPT_CNT");
  if (fields.length === 0) throw new Error("文件中没有识别到 ESP eFuse 摘要字段");

  return {
    source: "espefuse-json",
    importedAt: new Date().toISOString(),
    secureBootEnabled,
    flashEncryptionEnabled,
    spiBootCryptCount,
    downloadManualEncryptionDisabled,
    macAddress,
    fields,
    warnings,
  };
}
