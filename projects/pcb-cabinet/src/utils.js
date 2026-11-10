/* ============================================================
   PCB 物料柜 · 工具函数（无 DOM / 无外部依赖，可单测）
   ============================================================ */
import { ROWS_MAX, COLS_MAX, LEGACY_KEY_RE, CELL_KEY_RE, CATEGORIES } from './constants.js';

export const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

export const clampInt = (v, min, max, def) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

export const round2 = (n) => Math.round(n * 100) / 100;

export const parseQty = (v, def) => {
  const n = Number(String(v == null ? '' : v).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? round2(n) : def;
};

export const fmtNum = (n) => Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 });

export const pad2 = (n) => String(n).padStart(2, '0');

export const fmtTime = (iso) => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
    ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
};

export const rowLabel = (r) => String(r + 1);
export const cellKey = (r, c) => rowLabel(r) + '-' + String(c + 1);
export const labelAt = cellKey;

/* 新旧键统一成「行-列」；无法识别或超出 26 行 / 15 列返回 null（不静默丢弃） */
export const toCellKey = (id) => {
  const s = String(id == null ? '' : id);
  let r = 0;
  let c = 0;
  const legacy = LEGACY_KEY_RE.exec(s);
  if (legacy) {
    r = legacy[1].charCodeAt(0) - 64;
    c = parseInt(legacy[2], 10);
  } else {
    const key = CELL_KEY_RE.exec(s);
    if (!key) return null;
    r = parseInt(key[1], 10);
    c = parseInt(key[2], 10);
  }
  if (r < 1 || r > ROWS_MAX || c < 1 || c > COLS_MAX) return null;
  return String(r) + '-' + String(c);
};

export const totalOf = (counts) => counts.reduce((a, b) => a + b, 0);
export const maxColsOf = (counts) => counts.reduce((m, n) => Math.max(m, n), 0);
export const isUniform = (counts) => counts.every((n) => n === counts[0]);

export const distribute = (total, rows) => {
  const base = Math.floor(total / rows);
  const rem = total % rows;
  return Array.from({ length: rows }, (_, i) => base + (i < rem ? 1 : 0));
};

/* 自动排布：先按接近斐波那契比例的矩形估算排数，再受 26 排 / 15 列上限约束 */
export const autoRowCounts = (total) => {
  let rows = Math.floor(Math.sqrt(total * 1.5) + 0.5);
  rows = Math.min(ROWS_MAX, Math.max(1, rows));
  if (Math.ceil(total / rows) > COLS_MAX) rows = Math.ceil(total / COLS_MAX);
  rows = Math.min(ROWS_MAX, Math.max(1, rows));
  while (rows < ROWS_MAX && Math.ceil(total / rows) > COLS_MAX) rows++;
  return distribute(total, rows);
};

export const normalizeCell = (raw) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const name = String(raw.name == null ? '' : raw.name).trim();
  if (!name) return null;
  return {
    name: name.slice(0, 40),
    category: CATEGORIES.indexOf(raw.category) >= 0 ? raw.category : '其他',
    model: String(raw.model == null ? '' : raw.model).trim().slice(0, 40),
    qty: Number.isFinite(Number(raw.qty)) && Number(raw.qty) >= 0 ? round2(Number(raw.qty)) : 0,
    unit: (String(raw.unit == null ? '' : raw.unit).trim() || 'pcs').slice(0, 6),
    minQty: Number.isFinite(Number(raw.minQty)) && Number(raw.minQty) >= 0 ? round2(Number(raw.minQty)) : 0,
    note: String(raw.note == null ? '' : raw.note).trim().slice(0, 120),
    updatedAt: (typeof raw.updatedAt === 'string' && !isNaN(Date.parse(raw.updatedAt))
      ? raw.updatedAt : new Date().toISOString())
  };
};

export const cellStatus = (cell) => {
  if (!cell || !cell.name) return 'empty';
  if (!(Number(cell.qty) > 0)) return 'out';
  if (Number(cell.minQty) > 0 && Number(cell.qty) < Number(cell.minQty)) return 'low';
  return 'normal';
};
