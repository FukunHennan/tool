import { afterEach, describe, expect, it, vi } from "vitest";
import { parseEspEfuseSummaryJson } from "./espSecurity";

afterEach(() => {
  vi.useRealTimers();
});

describe("parseEspEfuseSummaryJson", () => {
  it("normalizes safe fields and derives the security summary", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-11T12:34:56.000Z"));

    const summary = parseEspEfuseSummaryJson(JSON.stringify({
      secure_boot_en: { value: true, raw_value: "0x1", readable: true, writeable: false },
      SPI_BOOT_CRYPT_CNT: { value: "0b00000111" },
      DIS_DOWNLOAD_MANUAL_ENCRYPT: { raw_value: "0x1" },
      mac: { value: "Factory MAC: aa:bb:cc:11:22:33" },
      BLOCK_KEY0: { value: "must-not-be-exported" },
    }));

    expect(summary).toMatchObject({
      source: "espefuse-json",
      importedAt: "2026-08-11T12:34:56.000Z",
      secureBootEnabled: true,
      spiBootCryptCount: 7,
      flashEncryptionEnabled: true,
      downloadManualEncryptionDisabled: true,
      macAddress: "AA:BB:CC:11:22:33",
      warnings: [],
    });
    expect(summary.fields.map((field) => field.name)).toEqual([
      "SECURE_BOOT_EN",
      "SPI_BOOT_CRYPT_CNT",
      "DIS_DOWNLOAD_MANUAL_ENCRYPT",
      "MAC",
    ]);
    expect(summary.fields).not.toContainEqual(expect.objectContaining({ name: "BLOCK_KEY0" }));
    expect(summary.fields[0]).toMatchObject({ rawValue: "0x1", readable: true, writeable: false });
  });

  it.each([
    ["0b00000000", false],
    ["0b00000011", false],
    ["0b00000111", true],
    ["0x7F", true],
  ])("uses set-bit parity to derive flash encryption from %s", (rawValue, expected) => {
    const summary = parseEspEfuseSummaryJson(JSON.stringify({
      SPI_BOOT_CRYPT_CNT: { raw_value: rawValue },
    }));

    expect(summary.flashEncryptionEnabled).toBe(expected);
  });

  it("keeps a partial safe report and emits warnings for missing security fields", () => {
    const summary = parseEspEfuseSummaryJson(JSON.stringify({
      MAC: { value: "aa:bb:cc:dd:ee:ff" },
    }));

    expect(summary.macAddress).toBe("AA:BB:CC:DD:EE:FF");
    expect(summary.secureBootEnabled).toBeUndefined();
    expect(summary.flashEncryptionEnabled).toBeUndefined();
    expect(summary.warnings).toEqual([
      "JSON 中没有可解析的 SECURE_BOOT_EN",
      "JSON 中没有可解析的 SPI_BOOT_CRYPT_CNT",
    ]);
  });

  it.each(["null", "[]", "42", "\"field\""])("rejects a non-object top level: %s", (text) => {
    expect(() => parseEspEfuseSummaryJson(text)).toThrow("eFuse JSON 顶层必须是字段对象");
  });

  it("rejects an object without recognized safe fields", () => {
    expect(() => parseEspEfuseSummaryJson(JSON.stringify({
      BLOCK_KEY0: { value: "secret" },
    }))).toThrow("文件中没有识别到 ESP eFuse 摘要字段");
  });
});
