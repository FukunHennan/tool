import { ESPLoader, Transport, type IEspLoaderTerminal } from "esptool-js";
import { serialService } from "../serial/SerialService";
import type { EspChipInfo } from "./EspDetector";

export interface EspFlashBackupManifest {
  schemaVersion: 1;
  chipName: string;
  chipDescription: string;
  macAddress?: string;
  flashSize: string;
  flashSizeBytes: number;
  byteLength: number;
  sha256: string;
  deviceMd5?: string;
  createdAt: string;
  address: 0;
  verification: {
    exactLength: true;
    sha256Calculated: true;
    sameChipModel: true;
    sameMacWhenAvailable: true;
  };
}

export interface EspFlashBackupResult {
  data: Uint8Array;
  manifest: EspFlashBackupManifest;
}

type BackupListener = (message: string, progress?: number) => void;

function parseFlashSizeBytes(value?: string): number | undefined {
  const match = value?.trim().match(/^([\d.]+)\s*(KB|MB)$/i);
  if (!match) return undefined;
  const multiplier = match[2].toUpperCase() === "MB" ? 1024 * 1024 : 1024;
  const bytes = Number(match[1]) * multiplier;
  return Number.isInteger(bytes) && bytes > 0 ? bytes : undefined;
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function backupEspFlash(
  expected: EspChipInfo,
  baudRate: number,
  onStatus: BackupListener = () => undefined,
): Promise<EspFlashBackupResult> {
  if (serialService.connected) throw new Error("请先断开串口终端连接");
  if (!window.isSecureContext || !navigator.serial) throw new Error("当前环境不支持 Web Serial");
  const flashSizeBytes = parseFlashSizeBytes(expected.flashSize);
  if (!flashSizeBytes) throw new Error("Flash 容量未可靠识别，禁止按猜测长度备份");

  let transport: Transport | undefined;
  let loader: ESPLoader | undefined;
  try {
    onStatus("请选择刚才完成 ROM 检测的同一块开发板");
    const port = await navigator.serial.requestPort();
    transport = new Transport(port as never, false);
    const terminal: IEspLoaderTerminal = {
      clean: () => undefined,
      write: (data) => onStatus(data),
      writeLine: (data) => onStatus(data),
    };
    loader = new ESPLoader({ transport, baudrate: baudRate, terminal, debugLogging: false });
    const description = await loader.main("default_reset");
    const chipName = loader.chip.CHIP_NAME;
    if (chipName !== expected.chipName) {
      throw new Error(`芯片不匹配：检测报告为 ${expected.chipName}，当前连接为 ${chipName}`);
    }

    const currentMac = (await loader.chip.readMac(loader)).toUpperCase();
    if (expected.macAddress && currentMac !== expected.macAddress.toUpperCase()) {
      throw new Error(`MAC 不匹配：请连接检测报告对应的设备（当前 ${currentMac}）`);
    }

    onStatus(`开始只读备份 ${expected.flashSize} Flash`, 0);
    const deviceMd5 = await loader.flashMd5sum(0, flashSizeBytes).catch(() => undefined);
    const data = await loader.readFlash(0, flashSizeBytes, (_packet, progress, total) => {
      onStatus(`正在读取 Flash：${(progress / 1024 / 1024).toFixed(2)} / ${(total / 1024 / 1024).toFixed(2)} MB`, progress / total);
    });
    if (data.byteLength !== flashSizeBytes) {
      throw new Error(`备份长度校验失败：期望 ${flashSizeBytes}，实际 ${data.byteLength}`);
    }

    onStatus("正在计算 SHA-256…", 1);
    const sha256 = await sha256Hex(data);
    const manifest: EspFlashBackupManifest = {
      schemaVersion: 1,
      chipName,
      chipDescription: description,
      macAddress: currentMac,
      flashSize: expected.flashSize!,
      flashSizeBytes,
      byteLength: data.byteLength,
      sha256,
      deviceMd5,
      createdAt: new Date().toISOString(),
      address: 0,
      verification: {
        exactLength: true,
        sha256Calculated: true,
        sameChipModel: true,
        sameMacWhenAvailable: true,
      },
    };
    onStatus(`备份完成并通过长度校验 · SHA-256 ${sha256.slice(0, 16)}…`, 1);
    return { data, manifest };
  } finally {
    if (loader) {
      try { await loader.after("hard_reset"); } catch { /* The user can press RESET manually. */ }
    }
    if (transport) {
      try { await transport.disconnect(); } catch { /* Port may disappear during reset. */ }
    }
  }
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadEspFlashBackup(result: EspFlashBackupResult): void {
  const stem = `esp-flash-backup-${result.manifest.macAddress?.replace(/:/g, "").toLowerCase() ?? Date.now()}`;
  const copy = new Uint8Array(result.data.byteLength);
  copy.set(result.data);
  downloadBlob(new Blob([copy.buffer], { type: "application/octet-stream" }), `${stem}.bin`);
  downloadBlob(new Blob([JSON.stringify(result.manifest, null, 2)], { type: "application/json;charset=utf-8" }), `${stem}.manifest.json`);
}
