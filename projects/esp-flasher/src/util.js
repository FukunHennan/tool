/* ESP32 烧录器 · 纯逻辑层（不碰 DOM / Web Serial，vitest 单测） */

export const DEFAULT_OFFSETS = {
  bootloader: 0x1000,
  partition: 0x8000,
  app: 0x10000,
};

export const FLASH_SIZES = ['1MB', '2MB', '4MB', '8MB', '16MB'];
export const FLASH_FREQS = ['80m', '40m', '26m', '20m'];
export const FLASH_MODES = ['qio', 'qout', 'dio', 'dout'];
export const BAUD_RATES = [115200, 230400, 460800, 921600];

/** `0x1000` / `4096` / `0X10000` → 十进制整数；非法返回 null。 */
export function parseOffset(input) {
  const text = String(input).trim();
  if (!text) return null;
  const hex = /^0x[0-9a-f]+$/i.exec(text);
  const dec = /^\d+$/.exec(text);
  if (!hex && !dec) return null;
  const value = hex ? parseInt(hex[0], 16) : parseInt(dec[0], 10);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** 按文件名猜测默认偏移（bootloader/partition/app）。 */
export function guessOffset(filename) {
  const name = String(filename).toLowerCase();
  if (name.includes('bootloader')) return DEFAULT_OFFSETS.bootloader;
  if (name.includes('partition')) return DEFAULT_OFFSETS.partition;
  return DEFAULT_OFFSETS.app;
}

/** 字节量 → 人类可读。 */
export function humanBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** 进度 → 百分比字符串，0–100 截断。 */
export function percent(written, total) {
  if (!(total > 0)) return '0';
  return String(Math.min(100, Math.max(0, Math.round((written / total) * 100))));
}

/** 校验文件列表：至少一个有效项、每个偏移合法。返回错误消息或 null。 */
export function validateFiles(files) {
  const items = (files || []).filter((f) => f && f.data);
  if (!items.length) return '请先添加固件文件';
  for (const f of items) {
    if (parseOffset(f.offset) === null) {
      return `文件「${f.name}」的偏移无效（应为 0x1000 或 4096 形式）`;
    }
  }
  return null;
}
