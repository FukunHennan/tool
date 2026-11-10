/* ============================================================
   PCB 物料柜 · Store：状态 + 订阅 + 区域/格位操作 + 持久化
   - 每个 mutation 在 persist() 后 emit()，View 通过 on() 订阅切片
   - 数据格式与 coordVersion 迁移逻辑与旧版完全一致（保护存量数据）
   ============================================================ */
import {
  STORAGE_KEY, APP_ID, VERSION, COORD_VERSION,
  ROWS_MAX, COLS_MAX, TOTAL_MAX, CATEGORIES
} from '../constants.js';
import { toCellKey, labelAt, totalOf, cellStatus } from '../utils.js';
import { normalizeZone, makeZone, uid, legacySnapshot, verifyMigration } from './normalize.js';

/* ---------------- 导入校验 ---------------- */
function validateLayoutFields(obj, prefix) {
  if (Array.isArray(obj.rowCounts)) {
    if (!obj.rowCounts.length || obj.rowCounts.length > ROWS_MAX) {
      throw new Error(prefix + '排数无效（应为 1–' + ROWS_MAX + ' 排）');
    }
    obj.rowCounts.forEach((n, i) => {
      if (!Number.isInteger(n) || n < 1 || n > COLS_MAX) {
        throw new Error(prefix + '第 ' + (i + 1) + ' 排格数无效（应为 1–' + COLS_MAX + ' 的整数）');
      }
    });
  } else {
    const rows = Number(obj.rows);
    const cols = Number(obj.cols);
    if (!Number.isInteger(rows) || rows < 1 || rows > ROWS_MAX) {
      throw new Error(prefix + '行数无效（应为 1–' + ROWS_MAX + ' 的整数）');
    }
    if (!Number.isInteger(cols) || cols < 1 || cols > COLS_MAX) {
      throw new Error(prefix + '列数无效（应为 1–' + COLS_MAX + ' 的整数）');
    }
  }
  if (obj.layoutMode != null && obj.layoutMode !== 'total' && obj.layoutMode !== 'custom') {
    throw new Error(prefix + '布局模式无效');
  }
  ['name', 'note', 'location'].forEach((k) => {
    if (obj[k] != null && typeof obj[k] !== 'string') throw new Error(prefix + k + ' 字段格式不正确');
  });
}

function validateCells(cells, prefix) {
  if (!cells || typeof cells !== 'object' || Array.isArray(cells)) {
    throw new Error(prefix + '缺少 cells 格位数据');
  }
  const keys = Object.keys(cells);
  if (keys.length > TOTAL_MAX) throw new Error(prefix + '格位数量异常（超过 ' + TOTAL_MAX + ' 条）');
  keys.forEach((id) => {
    const key = toCellKey(id);
    if (!key) throw new Error(prefix + '格位编号 “' + id + '” 格式不正确（应为「行-列」，如 3-4）');
    const cell = cells[id];
    if (!cell || typeof cell !== 'object' || Array.isArray(cell)) throw new Error(prefix + '格位 ' + id + ' 的数据格式不正确');
    if (typeof cell.name !== 'string' || !cell.name.trim()) throw new Error(prefix + '格位 ' + id + ' 缺少物料名称');
    if (typeof cell.qty !== 'number' || !isFinite(cell.qty) || cell.qty < 0) throw new Error(prefix + '格位 ' + id + ' 的数量无效');
    if (cell.minQty != null && (typeof cell.minQty !== 'number' || !isFinite(cell.minQty) || cell.minQty < 0)) {
      throw new Error(prefix + '格位 ' + id + ' 的预警数量无效');
    }
    ['model', 'category', 'unit', 'note'].forEach((k) => {
      if (cell[k] != null && typeof cell[k] !== 'string') throw new Error(prefix + '格位 ' + id + ' 的 ' + k + ' 字段格式不正确');
    });
  });
}

export function validateBackup(data) {
  const fail = (msg) => { throw new Error(msg); };
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('文件内容不是有效的 JSON 对象');
  if (Array.isArray(data.zones)) {
    if (!data.zones.length) fail('zones 区域列表为空');
    if (data.zones.length > 50) fail('区域数量异常（超过 50 个）');
    data.zones.forEach((z, i) => {
      const prefix = '第 ' + (i + 1) + ' 个区域：';
      if (!z || typeof z !== 'object' || Array.isArray(z)) fail(prefix + '格式不正确');
      validateLayoutFields(z, prefix);
      validateCells(z.cells, prefix);
      if (z.hidden != null && (typeof z.hidden !== 'object' || Array.isArray(z.hidden))) {
        fail(prefix + 'hidden 暂存数据格式不正确');
      }
    });
    if (data.activeZoneId != null && typeof data.activeZoneId !== 'string') fail('activeZoneId 格式不正确');
    return true;
  }

  const cab = data.cabinet;
  if (!cab || typeof cab !== 'object' || Array.isArray(cab)) fail('缺少 zones 区域列表或 cabinet 柜体信息');
  validateLayoutFields(cab, '');
  validateCells(data.cells, '');
  if (data.hidden != null && (typeof data.hidden !== 'object' || Array.isArray(data.hidden))) {
    fail('hidden 暂存数据格式不正确');
  }
  return true;
}

/* ---------------- 示例数据 ---------------- */
function seed() {
  const t = (days) => new Date(Date.now() - days * 86400000).toISOString();
  const cells = {};
  const add = (id, name, category, model, qty, unit, minQty, note, days) => {
    cells[id] = { name, category, model, qty, unit, minQty, note, updatedAt: t(days) };
  };
  add('1-1', '贴片电阻 0603', '电阻', '10kΩ ±1% 1/10W', 1200, 'pcs', 200, '上拉 / 下拉通用，紧邻 0603 盘', 2);
  add('1-2', '贴片电阻 0603', '电阻', '1kΩ ±1% 1/10W', 800, 'pcs', 200, 'LED 限流常用', 3);
  add('1-3', '贴片电容 0603', '电容', '100nF 50V X7R', 1500, 'pcs', 300, '就近去耦电容', 1);
  add('1-4', '贴片电容 0805', '电容', '10µF 25V X5R', 320, 'pcs', 100, '电源入口滤波', 5);
  add('2-1', '功率电感 4.7µH', '电感', 'CD54 绕线 4.7µH', 120, 'pcs', 50, 'DC-DC 输出储能', 3);
  add('2-2', '磁珠 0603', '电感', '600Ω @100MHz', 450, 'pcs', 100, 'USB 差分共模抑制', 6);
  add('2-3', '肖特基二极管', '二极管', 'SS34 SMA 40V/3A', 180, 'pcs', 80, '续流 / 防反接', 4);
  add('2-4', 'ESD 保护管', '二极管', 'ESD5V0S1 SOT-23', 60, 'pcs', 100, 'Type-C 接口静电保护', 7);
  add('3-1', '连接器 XH2.54', '连接器', '4P 直插 2.54mm', 45, '个', 20, '配套端子座', 2);
  add('3-2', 'USB Type-C 母座', '连接器', '16P 贴片 沉板', 28, '个', 10, '主板供电 / 数据', 9);
  add('3-3', '排针 2.54mm', '连接器', '1×40P 单排', 62, '条', 20, '调试口与扩展口', 11);
  add('3-4', '无源晶振', '晶振', '8MHz 3225 ±10ppm', 22, 'pcs', 30, 'MCU 主时钟', 8);
  add('4-1', 'MCU 主控', 'IC', 'STM32F103C8T6 LQFP-48', 16, 'pcs', 10, '主控芯片，注意防潮', 4);
  add('4-2', 'LDO 稳压器', 'IC', 'AMS1117-3.3 SOT-223', 34, 'pcs', 15, '5V → 3.3V 供电', 3);
  add('4-3', '运算放大器', 'IC', 'LM358 SOP-8', 0, 'pcs', 20, '信号调理，需补货', 12);
  add('4-4', 'N-MOS 管', '晶体管', 'AO3400 SOT-23', 210, 'pcs', 60, '低边开关 / 电平转换', 1);
  add('5-1', '精密电阻 0805', '电阻', '4.7kΩ ±0.1%', 90, 'pcs', 60, '采样电阻，精度 0.1%', 5);
  add('5-2', '铝电解电容', '电容', '220µF 25V 6.3×7.7', 18, 'pcs', 10, '电源缓启动', 13);
  return {
    activeZoneId: 'z1',
    zones: [{
      id: 'z1',
      name: 'PCB 物料柜 · A 区',
      note: '阻容与常用 IC 备料',
      location: '实验台左侧 1 号柜',
      rowCounts: [4, 4, 4, 4, 4, 4],
      layoutMode: 'total',
      cells,
      hidden: {}
    }]
  };
}

/* ---------------- Store ---------------- */
const defaultStorage = (typeof localStorage !== 'undefined') ? localStorage : null;

export class Store {
  /* storage 注入：浏览器传 localStorage，测试传内存 fake；缺省用全局 localStorage */
  constructor(storage = defaultStorage) {
    this._storage = storage;
    this.state = null;
    this.migration = null;
    this.migrationError = null;
    this._listeners = new Set();
  }

  /* 订阅：接收 (state, zone)，返回取消函数 */
  on(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  emit(type, extra) {
    const zone = this.zone;
    const ev = Object.assign({ type }, extra || {});
    this._listeners.forEach((fn) => {
      try { fn(ev, this.state, zone); } catch (err) { console.warn('[物料柜] 订阅回调异常', err); }
    });
  }

  get zone() {
    const zones = this.state.zones;
    return zones.find((z) => z.id === this.state.activeZoneId) || zones[0];
  }

  zoneById(id) { return this.state.zones.find((z) => z.id === id) || null; }

  labels() {
    const out = [];
    this.zone.rowCounts.forEach((n, r) => {
      for (let c = 0; c < n; c++) out.push(labelAt(r, c));
    });
    return out;
  }

  inRange(id) {
    const m = /^(\d{1,2})-(\d{1,2})$/.exec(String(id == null ? '' : id));
    if (!m) return false;
    const counts = this.zone.rowCounts;
    const r = parseInt(m[1], 10) - 1;
    const c = parseInt(m[2], 10) - 1;
    return r >= 0 && r < counts.length && c >= 0 && c < counts[r];
  }

  normalize(data) {
    const src = data || {};
    let zones = [];
    if (Array.isArray(src.zones)) {
      zones = src.zones.map((z) => normalizeZone(z)).filter(Boolean);
    } else if (src.cabinet || src.cells) {
      const cab = src.cabinet || {};
      zones = [normalizeZone({
        id: 'z1',
        name: cab.name,
        rows: cab.rows,
        cols: cab.cols,
        rowCounts: cab.rowCounts,
        layoutMode: cab.layoutMode,
        cells: src.cells,
        hidden: src.hidden
      })].filter(Boolean);
    }
    if (!zones.length) {
      zones = [makeZone({ name: 'PCB 物料柜 · A 区', rowCounts: [4, 4, 4, 4, 4, 4], layoutMode: 'total' })];
    }
    const seen = new Set();
    zones.forEach((z) => {
      if (seen.has(z.id)) z.id = uid();
      seen.add(z.id);
    });
    const active = zones.find((z) => z.id === src.activeZoneId) ? src.activeZoneId : zones[0].id;
    return { zones, activeZoneId: active };
  }

  load() {
    let raw = null;
    try { raw = this._storage ? this._storage.getItem(STORAGE_KEY) : null; } catch (err) { /* 隐私模式 / file:// */ }
    this.migration = null;
    this.migrationError = null;
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && (Array.isArray(parsed.zones) || (parsed.cabinet && parsed.cells))) {
          const v = Number(parsed.coordVersion);
          const needMigrate = !(Number.isFinite(v) && v >= COORD_VERSION);
          const before = needMigrate ? legacySnapshot(parsed) : null;
          this.state = this.normalize(parsed);
          if (needMigrate) {
            this.migration = verifyMigration(before, this.state.zones);
            if (!this.migration.ok) {
              throw new Error('迁移校验未通过：' + this.migration.errors.join('；'));
            }
            this.persist();
          }
          return false;
        }
      } catch (err) {
        this.migrationError = err;
        console.error('[物料柜] 本地数据迁移失败，原始数据保持未覆盖', err);
      }
    }
    this.state = seed();
    if (!this.migrationError) this.persist();
    return true;
  }

  persist() {
    try {
      if (this._storage) {
        this._storage.setItem(STORAGE_KEY, JSON.stringify({
          app: APP_ID,
          version: VERSION,
          coordVersion: COORD_VERSION,
          activeZoneId: this.state.activeZoneId,
          zones: this.state.zones
        }));
      }
      return true;
    } catch (err) {
      console.warn('[物料柜] 写入本地存储失败', err);
      return false;
    }
  }

  getCell(id) { return this.zone.cells[id] || null; }

  setCell(id, cell) {
    if (!/^\d{1,2}-\d{1,2}$/.test(id)) return;
    /* 存浅拷贝：外部（如 stepQty）不再持有活引用，订阅者拿到的是值语义 */
    this.zone.cells[id] = Object.assign({}, cell);
    delete this.zone.hidden[id];
    this.persist();
    this.emit('cells', { cellId: id });
  }

  clearCell(id) {
    delete this.zone.cells[id];
    this.persist();
    this.emit('cells', { cellId: id });
  }

  setActiveZone(id) {
    if (!this.zoneById(id)) return false;
    this.state.activeZoneId = id;
    this.persist();
    this.emit('active');
    return true;
  }

  addZone(input) {
    const zone = makeZone(input);
    this.state.zones.push(zone);
    this.state.activeZoneId = zone.id;
    this.persist();
    this.emit('zones');
    return zone;
  }

  updateZone(id, input) {
    const zone = this.zoneById(id);
    if (!zone) return null;
    const prev = new Set(this.zoneLabels(zone));
    zone.name = input.name;
    if (input.note != null) zone.note = input.note;
    if (input.location != null) zone.location = input.location;
    zone.rowCounts = input.rowCounts.slice();
    zone.layoutMode = input.layoutMode === 'total' ? 'total' : 'custom';
    const next = new Set(this.zoneLabels(zone));
    let added = 0;
    next.forEach((label) => { if (!prev.has(label)) added++; });
    let stashed = 0;
    let restored = 0;
    Object.keys(zone.cells).forEach((label) => {
      if (!next.has(label)) {
        zone.hidden[label] = zone.cells[label];
        delete zone.cells[label];
        stashed++;
      }
    });
    Object.keys(zone.hidden).forEach((label) => {
      if (next.has(label)) {
        zone.cells[label] = zone.hidden[label];
        delete zone.hidden[label];
        restored++;
      }
    });
    this.persist();
    this.emit('layout', { zoneId: id, result: { added, stashed, restored, total: next.size, rows: zone.rowCounts.length } });
    return { added, stashed, restored, total: next.size, rows: zone.rowCounts.length };
  }

  removeZone(id) {
    const zones = this.state.zones;
    if (zones.length <= 1) return false;
    const idx = zones.findIndex((z) => z.id === id);
    if (idx < 0) return false;
    zones.splice(idx, 1);
    if (this.state.activeZoneId === id) {
      this.state.activeZoneId = zones[Math.min(idx, zones.length - 1)].id;
    }
    this.persist();
    this.emit('zones');
    return true;
  }

  copyZone(id) {
    const src = this.zoneById(id);
    if (!src) return null;
    const copy = makeZone({
      name: (src.name + ' 副本').slice(0, 30),
      note: src.note,
      location: src.location,
      layoutMode: src.layoutMode,
      rowCounts: src.rowCounts.slice(),
      cells: JSON.parse(JSON.stringify(src.cells)),
      hidden: JSON.parse(JSON.stringify(src.hidden))
    });
    const idx = this.state.zones.findIndex((z) => z.id === id);
    this.state.zones.splice(idx + 1, 0, copy);
    this.state.activeZoneId = copy.id;
    this.persist();
    this.emit('zones');
    return copy;
  }

  moveZone(id, dir) {
    const zones = this.state.zones;
    const idx = zones.findIndex((z) => z.id === id);
    const to = idx + dir;
    if (idx < 0 || to < 0 || to >= zones.length) return false;
    const tmp = zones[idx];
    zones[idx] = zones[to];
    zones[to] = tmp;
    this.persist();
    this.emit('zones');
    return true;
  }

  zoneLabels(zone) {
    const out = [];
    zone.rowCounts.forEach((n, r) => {
      for (let c = 0; c < n; c++) out.push(labelAt(r, c));
    });
    return out;
  }

  zoneStats(zone) {
    const z = zone || this.zone;
    let used = 0; let low = 0; let out = 0; let sum = 0;
    z.rowCounts.forEach((n, r) => {
      for (let c = 0; c < n; c++) {
        const cell = z.cells[labelAt(r, c)];
        if (!cell) continue;
        used++;
        const st = cellStatus(cell);
        if (st === 'low') low++;
        if (st === 'out') out++;
        sum += Number(cell.qty) || 0;
      }
    });
    return { total: totalOf(z.rowCounts), used, low, out, sum };
  }

  stats() { return this.zoneStats(); }

  search(query) {
    const q = String(query == null ? '' : query).trim().toLowerCase();
    if (!q) return [];
    const z = this.zone;
    const hits = [];
    this.zoneLabels(z).forEach((id) => {
      const cell = z.cells[id];
      if (!cell) return;
      const hay = [cell.name, cell.model, cell.category, cell.note].join(' ').toLowerCase();
      if (hay.indexOf(q) >= 0) hits.push({ id, cell });
    });
    return hits;
  }

  searchAll(query) {
    const q = String(query == null ? '' : query).trim().toLowerCase();
    if (!q) return [];
    const hits = [];
    this.state.zones.forEach((z) => {
      this.zoneLabels(z).forEach((id) => {
        const cell = z.cells[id];
        if (!cell) return;
        const hay = [cell.name, cell.model, cell.category, cell.note].join(' ').toLowerCase();
        if (hay.indexOf(q) >= 0) hits.push({ zoneId: z.id, zoneName: z.name, id, cell });
      });
    });
    return hits;
  }

  backup() {
    return {
      app: APP_ID,
      version: VERSION,
      coordVersion: COORD_VERSION,
      exportedAt: new Date().toISOString(),
      activeZoneId: this.state.activeZoneId,
      zones: this.state.zones.map((z) => ({
        id: z.id,
        name: z.name,
        note: z.note,
        location: z.location,
        layoutMode: z.layoutMode,
        rowCounts: z.rowCounts.slice(),
        cells: Object.assign({}, z.cells),
        hidden: Object.assign({}, z.hidden)
      }))
    };
  }

  replaceState(data) {
    const src = data || {};
    const v = Number(src.coordVersion);
    const needMigrate = !(Number.isFinite(v) && v >= COORD_VERSION);
    const before = needMigrate ? legacySnapshot(src) : null;
    const next = this.normalize(src);
    if (needMigrate) {
      this.migration = verifyMigration(before, next.zones);
      if (!this.migration.ok) {
        /* 校验失败：保留原 state，不覆盖、不持久化 */
        throw new Error('导入数据迁移校验未通过：' + this.migration.errors.join('；'));
      }
    }
    this.state = next;
    this.persist();
    this.emit('reset');
  }

  storageAvailable() {
    if (!this._storage) return false;
    try {
      const k = '__cabinet_probe__';
      this._storage.setItem(k, '1');
      this._storage.removeItem(k);
      return true;
    } catch (err) {
      return false;
    }
  }
}

export { CATEGORIES };
