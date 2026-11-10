/* 串口助手 · 纯逻辑层（不碰 DOM / Web Serial，便于 node --test 单测） */

/** 行尾追加模式，对齐原桌面版的 5 档。 */
export const APPEND_MODES = [
  { id: 'none', label: '无', value: '' },
  { id: 'lf', label: '\\n', value: '\n' },
  { id: 'cr', label: '\\r', value: '\r' },
  { id: 'crlf', label: '\\r\\n', value: '\r\n' },
  { id: 'lfcr', label: '\\n\\r', value: '\n\r' },
];

export const BAUD_RATES = [
  300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200,
  230400, 460800, 921600, 1000000, 1500000, 2000000, 4000000,
];

/**
 * 解析 `48 65 6C` / `48656C` / `4f 65 6c` 形式的十六进制输入。
 * 遇到非法字符或落单的半个字节即停止，返回已解析出的部分。
 */
export function parseHex(input) {
  const compact = String(input).replace(/\s+/g, '');
  const out = new Uint8Array(Math.floor(compact.length / 2));
  let n = 0;
  for (let i = 0; i + 1 < compact.length; i += 2) {
    const byte = Number.parseInt(compact.slice(i, i + 2), 16);
    if (Number.isNaN(byte)) break;
    out[n++] = byte;
  }
  return out.slice(0, n);
}

/** `Uint8Array` → `48 65 6C`（大写、空格分隔）。 */
export function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
}

/** 字节数右对齐到 5 位，与 `[..] ◄ RX (    5 B)` 的列对齐一致。 */
export function padByteCount(n) {
  return String(n).padStart(5, ' ');
}

/** 本地时间 `HH:MM:SS.mmm`。 */
export function stamp(date = new Date()) {
  const p = (v, width = 2) => String(v).padStart(width, '0');
  return `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}.${p(date.getMilliseconds(), 3)}`;
}

/**
 * 一条日志的显示文本：`[14:32:45.123] ◄ RX (    5 B) 48 65 6C`
 * `entry` 形如 `{ time: Date, dir: 'rx'|'tx', bytes: Uint8Array }`。
 */
export function formatLogLine(entry, { hex = false } = {}) {
  const arrow = entry.dir === 'tx' ? '► TX' : '◄ RX';
  const body = hex ? toHex(entry.bytes) : new TextDecoder('utf-8', { fatal: false }).decode(entry.bytes);
  return `[${stamp(entry.time)}] ${arrow} (${padByteCount(entry.bytes.length)} B) ${body}`;
}

/** 追加行尾：模式 id 无效时按“无”处理。 */
export function applyAppend(text, modeId) {
  const mode = APPEND_MODES.find((m) => m.id === modeId) || APPEND_MODES[0];
  return text + mode.value;
}

/** 下一个追加模式（`n` 键循环）。 */
export function nextAppend(modeId) {
  const index = APPEND_MODES.findIndex((m) => m.id === modeId);
  return APPEND_MODES[(index + 1) % APPEND_MODES.length].id;
}

/** 环形日志缓冲：超过容量淘汰最旧的一条。 */
export class RingLog {
  constructor(capacity = 10_000) {
    this.capacity = capacity;
    this.items = [];
  }

  push(entry) {
    if (this.items.length === this.capacity) this.items.shift();
    this.items.push(entry);
    return entry;
  }

  clear() {
    this.items.length = 0;
  }

  get length() {
    return this.items.length;
  }

  /** 转成纯文本（用于导出 / 复制）。 */
  toText(options = {}) {
    return this.items.map((entry) => formatLogLine(entry, options)).join('\n');
  }
}

/**
 * 日志过滤：查询串按当前显示模式匹配。
 * HEX 模式匹配十六进制串，TEXT 模式匹配解码后的文本；空查询返回全部。
 */
export function filterEntries(entries, query, { hex = false } = {}) {
  const needle = String(query || '').trim();
  if (!needle) return entries;
  const lowered = needle.toLowerCase();
  return entries.filter((entry) => {
    const haystack = hex ? toHex(entry.bytes) : new TextDecoder().decode(entry.bytes);
    return haystack.toLowerCase().includes(lowered);
  });
}

/** 统计：`（rx 字节, rx 条数, tx 字节, tx 条数）`。 */
export function statsOf(entries) {
  let rxBytes = 0;
  let rxCount = 0;
  let txBytes = 0;
  let txCount = 0;
  for (const entry of entries) {
    if (entry.dir === 'tx') {
      txBytes += entry.bytes.length;
      txCount += 1;
    } else {
      rxBytes += entry.bytes.length;
      rxCount += 1;
    }
  }
  return { rxBytes, rxCount, txBytes, txCount };
}

/** 人类可读的字节量：`512 B` / `1.5 KB` / `2.0 MB`。 */
export function humanBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
