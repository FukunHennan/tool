/* ============================================================
   PCB 物料柜 · 区域归一化 / 迁移
   ============================================================ */
import { ROWS_MAX, COLS_MAX } from '../constants.js';
import {
  clampInt, toCellKey, labelAt, totalOf, maxColsOf, isUniform, normalizeCell
} from '../utils.js';

let uidSeq = 0;
export const uid = () => 'z' + Date.now().toString(36) + (++uidSeq).toString(36) + Math.random().toString(36).slice(2, 5);

export const absorbCells = (src, dest, prefix) => {
  if (!src || typeof src !== 'object' || Array.isArray(src)) return;
  const bad = [];
  const dup = [];
  Object.keys(src).forEach((id) => {
    const key = toCellKey(id);
    if (!key) { bad.push(id); return; }
    if (dest[key]) { dup.push('“' + id + '” → ' + key); return; }
    const cell = normalizeCell(src[id]);
    if (cell) dest[key] = cell;
  });
  if (bad.length) {
    throw new Error((prefix || '') + '格位编号 “' + bad.slice(0, 5).join('”, “') + '” 无法识别' +
      '（应为「行-列」如 3-4，旧版如 C4 会自动转换）');
  }
  if (dup.length) {
    throw new Error((prefix || '') + '迁移后出现重复格位编号：' + dup.slice(0, 5).join('、'));
  }
};

export const normalizeZone = (raw) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  let rowCounts;
  if (Array.isArray(raw.rowCounts) && raw.rowCounts.length) {
    rowCounts = raw.rowCounts.slice(0, ROWS_MAX).map((n) => clampInt(n, 1, COLS_MAX, 4));
  } else {
    const rows = clampInt(raw.rows, 1, ROWS_MAX, 6);
    rowCounts = new Array(rows).fill(clampInt(raw.cols, 1, COLS_MAX, 4));
  }
  if (!rowCounts.length) rowCounts = [4];
  const name = (typeof raw.name === 'string' && raw.name.trim())
    ? raw.name.trim().slice(0, 30)
    : '物料柜';
  const cells = {};
  const hidden = {};
  const prefix = '区域「' + name + '」';
  absorbCells(raw.cells, cells, prefix);
  absorbCells(raw.hidden, hidden, prefix);
  const valid = new Set();
  rowCounts.forEach((n, r) => {
    for (let c = 0; c < n; c++) valid.add(labelAt(r, c));
  });
  Object.keys(cells).forEach((id) => {
    if (!valid.has(id)) {
      hidden[id] = cells[id];
      delete cells[id];
    }
  });
  Object.keys(hidden).forEach((id) => {
    if (valid.has(id) && !cells[id]) {
      cells[id] = hidden[id];
      delete hidden[id];
    }
  });
  const layoutMode = (raw.layoutMode === 'total' || raw.layoutMode === 'custom')
    ? raw.layoutMode
    : (isUniform(rowCounts) ? 'total' : 'custom');
  const idOk = typeof raw.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(raw.id);
  return {
    id: idOk ? raw.id : uid(),
    name,
    note: String(raw.note == null ? '' : raw.note).trim().slice(0, 80),
    location: String(raw.location == null ? '' : raw.location).trim().slice(0, 60),
    rowCounts, layoutMode, cells, hidden
  };
};

export const makeZone = (input) => normalizeZone(Object.assign({}, input || {}, {
  id: uid(),
  cells: (input && input.cells) || {},
  hidden: (input && input.hidden) || {}
}));

/* 迁移前快照：按区域顺序记录旧键与格位内容，用于迁移后逐项校验 */
export function legacySnapshot(data) {
  const src = data || {};
  const zones = Array.isArray(src.zones) ? src.zones : [{ cells: src.cells, hidden: src.hidden }];
  return zones.map((z) => ({
    cells: Object.assign({}, (z && z.cells) || {}),
    hidden: Object.assign({}, (z && z.hidden) || {})
  }));
}

/* 迁移校验：区域数、格子数、逐字段（名称/型号/数量/单位/预警值/备注）、丢失键 */
export function verifyMigration(before, zones) {
  const errors = [];
  const rows = [];
  if (before.length !== zones.length) {
    errors.push('区域数量不一致（' + before.length + ' → ' + zones.length + '）');
  }
  before.forEach((src, i) => {
    const zone = zones[i];
    if (!zone) { errors.push('第 ' + (i + 1) + ' 个区域迁移后丢失'); return; }
    const oldIds = Object.keys(src.cells);
    const mapped = {};
    const samples = [];
    oldIds.forEach((oldId) => {
      const key = toCellKey(oldId);
      if (!key) { errors.push('区域「' + zone.name + '」旧键 ' + oldId + ' 无法迁移'); return; }
      mapped[key] = src.cells[oldId];
      if (samples.length < 3) samples.push({ from: oldId, to: key });
    });
    const kept = Object.keys(zone.cells).length + Object.keys(zone.hidden).length;
    const expect = oldIds.length + Object.keys(src.hidden).length;
    if (kept !== expect) {
      errors.push('区域「' + zone.name + '」格子数量不一致（' + expect + ' → ' + kept + '）');
    }
    Object.keys(mapped).forEach((key) => {
      const a = mapped[key];
      const b = zone.cells[key] || zone.hidden[key];
      if (!b) { errors.push('区域「' + zone.name + '」格位 ' + key + ' 丢失'); return; }
      ['name', 'model', 'qty', 'unit', 'minQty', 'note'].forEach((f) => {
        const av = String(a[f] == null ? '' : a[f]);
        const bv = String(b[f] == null ? '' : b[f]);
        if (av !== bv && errors.length < 12) {
          errors.push('区域「' + zone.name + '」格位 ' + key + ' 的 ' + f + ' 不一致');
        }
      });
    });
    rows.push({ zone: zone.name, legacy: oldIds.length, migrated: kept, samples });
  });
  return { ok: !errors.length, errors, rows };
}

export { totalOf, maxColsOf };
