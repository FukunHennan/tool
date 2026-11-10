/* PCB 物料柜 · Store 单元测试（内存 fake 存储，无需 DOM） */
import { test, describe, expect } from 'vitest';
import { Store, validateBackup } from '../store/store.js';

const fakeStorage = () => {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k)
  };
};

const mkCell = (over = {}) => Object.assign({
  name: '贴片电阻', category: '电阻', model: '10k', qty: 100,
  unit: 'pcs', minQty: 20, note: '', updatedAt: new Date(0).toISOString()
}, over);

describe('Store.load + seed', () => {
  test('空存储载入示例并持久化', () => {
    const store = new Store(fakeStorage());
    const seeded = store.load();
    expect(seeded).toBe(true);
    expect(store.state.zones.length).toBe(1);
    expect(Object.keys(store.zone.cells).length).toBeGreaterThan(10);
  });

  test('已迁移数据（coordVersion 足够）不写回', () => {
    const storage = fakeStorage();
    const store = new Store(storage);
    store.load();
    const raw = storage.getItem('pcb-material-cabinet.v1');
    expect(JSON.parse(raw).coordVersion).toBe(2);
  });
});

describe('坐标迁移 v1 → v2', () => {
  test('旧版字母行 A1 迁移为 1-1 且校验通过', () => {
    const storage = fakeStorage();
    const store = new Store(storage);
    const legacy = {
      zones: [{
        id: 'z1', name: '旧柜', rowCounts: [2, 2],
        cells: { A1: mkCell(), B2: mkCell({ name: '电容', category: '电容' }) },
        hidden: {}
      }]
    };
    storage.setItem('pcb-material-cabinet.v1', JSON.stringify(legacy));
    const fresh = new Store(storage);
    fresh.load();
    expect(fresh.migration.ok).toBe(true);
    expect(Object.keys(fresh.zone.cells)).toContain('1-1');
    expect(Object.keys(fresh.zone.cells)).toContain('2-2');
  });

  test('无法识别的格位键导致迁移失败且不覆盖原始数据', () => {
    const storage = fakeStorage();
    const legacy = {
      zones: [{ id: 'z1', name: '柜', rowCounts: [4], cells: { 'X99': mkCell() }, hidden: {} }]
    };
    storage.setItem('pcb-material-cabinet.v1', JSON.stringify(legacy));
    const store = new Store(storage);
    store.load();
    expect(store.migrationError).toBeTruthy();
  });
});

describe('格位状态', () => {
  test('cellStatus 四态', () => {
    const store = new Store(fakeStorage());
    store.load();
    expect(store.getCell('5-3')).toBeNull();
    store.setCell('5-3', mkCell({ qty: 0, minQty: 10 }));
    store.setCell('5-4', mkCell({ qty: 5, minQty: 10 }));
    store.setCell('1-1', mkCell({ qty: 100, minQty: 10 }));
    // 重新打开 active zone 的 cells 已变
    expect(store.zone.cells['5-3'].qty).toBe(0);
    const status = (id) => {
      const c = store.zone.cells[id];
      if (!c || !c.name) return 'empty';
      if (!(Number(c.qty) > 0)) return 'out';
      if (Number(c.minQty) > 0 && Number(c.qty) < Number(c.minQty)) return 'low';
      return 'normal';
    };
    expect(status('5-3')).toBe('out');
    expect(status('5-4')).toBe('low');
    expect(status('1-1')).toBe('normal');
  });

  test('setCell 存浅拷贝，外部引用不再影响 Store', () => {
    const store = new Store(fakeStorage());
    store.load();
    const obj = mkCell({ qty: 1 });
    store.setCell('6-1', obj);
    obj.qty = 999;
    expect(store.zone.cells['6-1'].qty).toBe(1);
  });
});

describe('区域操作', () => {
  test('addZone 成为 active 并持久化', () => {
    const store = new Store(fakeStorage());
    store.load();
    const z = store.addZone({ name: '新柜', rowCounts: [3, 3] });
    expect(store.state.activeZoneId).toBe(z.id);
    expect(store.state.zones.length).toBe(2);
  });

  test('removeZone 拒绝删除最后一个', () => {
    const store = new Store(fakeStorage());
    store.load();
    expect(store.removeZone(store.state.activeZoneId)).toBe(false);
  });

  test('updateZone 缩小布局时把溢出格位暂存到 hidden', () => {
    const store = new Store(fakeStorage());
    store.load();
    const id = store.state.activeZoneId;
    store.setCell('6-1', mkCell());
    const result = store.updateZone(id, {
      name: store.zone.name, rowCounts: [4, 4, 4, 4], layoutMode: 'total'
    });
    expect(result.stashed).toBeGreaterThanOrEqual(1);
    expect(store.zone.hidden['6-1']).toBeTruthy();
    expect(store.zone.cells['6-1']).toBeUndefined();
  });

  test('copyZone 深拷贝布局与数据', () => {
    const store = new Store(fakeStorage());
    store.load();
    const src = store.state.activeZoneId;
    store.setCell('1-1', mkCell());
    const copy = store.copyZone(src);
    expect(copy.id).not.toBe(src);
    expect(copy.cells['1-1']).toBeTruthy();
    expect(store.state.activeZoneId).toBe(copy.id);
  });

  test('moveZone 交换区域顺序', () => {
    const store = new Store(fakeStorage());
    store.load();
    const z1 = store.state.zones[0].id;
    const a = store.addZone({ name: 'B', rowCounts: [4] });
    const b = store.addZone({ name: 'C', rowCounts: [4] });
    store.moveZone(b.id, -1);
    expect(store.state.zones.map((z) => z.id)).toEqual([z1, b.id, a.id]);
  });
});

describe('导入校验 validateBackup', () => {
  const base = () => ({
    zones: [{ id: 'z1', name: '柜', rowCounts: [4], cells: { '1-1': mkCell() }, hidden: {} }],
    activeZoneId: 'z1'
  });

  test('合法 zones 通过', () => {
    expect(validateBackup(base())).toBe(true);
  });

  test('非法排数报错', () => {
    const d = base();
    d.zones[0].rowCounts = [99];
    expect(() => validateBackup(d)).toThrow();
  });

  test('格位缺少名称报错', () => {
    const d = base();
    d.zones[0].cells = { '1-1': { name: '', qty: 1 } };
    expect(() => validateBackup(d)).toThrow();
  });

  test('超过 50 区域报错', () => {
    const d = { zones: Array.from({ length: 51 }, (_, i) => base().zones[0]) };
    expect(() => validateBackup(d)).toThrow();
  });

  test('replaceState 迁移失败时抛错且不持久化', () => {
    const storage = fakeStorage();
    const store = new Store(storage);
    store.load();
    const bad = { zones: [{ id: 'z1', name: '柜', rowCounts: [4], cells: { '1-1': { name: '', qty: 1 } }, hidden: {} }] };
    expect(() => store.replaceState(bad)).toThrow();
    expect(store.zone.cells['1-1'].name).toBe('贴片电阻 0603');
  });
});
