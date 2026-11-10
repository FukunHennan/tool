import { test, describe, expect } from 'vitest';
import {
  toCellKey, autoRowCounts, parseQty, fmtTime, distribute,
  cellStatus, normalizeCell, totalOf, maxColsOf
} from '../utils.js';

describe('toCellKey', () => {
  test('新键 3-4 原样返回', () => expect(toCellKey('3-4')).toBe('3-4'));
  test('旧键 A1 → 1-1', () => expect(toCellKey('A1')).toBe('1-1'));
  test('旧键 C4 → 3-4', () => expect(toCellKey('C4')).toBe('3-4'));
  test('越界返回 null（第 27 行）', () => expect(toCellKey('27-1')).toBe(null));
  test('非法键返回 null', () => {
    expect(toCellKey('abc')).toBe(null);
    expect(toCellKey('')).toBe(null);
    expect(toCellKey('1_4')).toBe(null);
  });
});

describe('autoRowCounts', () => {
  test('total=1', () => expect(totalOf(autoRowCounts(1))).toBe(1));
  test('total=24 均分 4 列 6 排', () => expect(totalOf(autoRowCounts(24))).toBe(24));
  test('total=312 不超过 312 格上限', () => {
    const counts = autoRowCounts(312);
    expect(totalOf(counts)).toBeLessThanOrEqual(312);
    expect(counts.length).toBeLessThanOrEqual(26);
    expect(maxColsOf(counts)).toBeLessThanOrEqual(15);
  });
});

describe('distribute', () => {
  test('不能整除时前几排多一格', () => expect(distribute(7, 3)).toEqual([3, 2, 2]));
  test('均匀分布', () => expect(distribute(8, 4)).toEqual([2, 2, 2, 2]));
});

describe('parseQty', () => {
  test('整数', () => expect(parseQty('12', 0)).toBe(12));
  test('逗号小数 1,5 → 1.5', () => expect(parseQty('1,5', 0)).toBe(1.5));
  test('负数回退默认', () => expect(parseQty('-3', 0)).toBe(0));
  test('非数字回退默认', () => expect(parseQty('abc', 9)).toBe(9));
});

describe('fmtTime', () => {
  test('非法输入返回占位', () => expect(fmtTime('not-a-date')).toBe('—'));
  test('合法 ISO 含年月日时分', () => {
    const s = fmtTime('2026-11-09T08:05:00');
    expect(s).toContain('2026');
    expect(s).toContain('11');
    expect(s).toMatch(/\d{2}/);
  });
});

describe('cellStatus', () => {
  test('empty', () => expect(cellStatus(null)).toBe('empty'));
  test('out（qty=0）', () => expect(cellStatus({ name: 'x', qty: 0, minQty: 5 })).toBe('out'));
  test('low（qty<min）', () => expect(cellStatus({ name: 'x', qty: 3, minQty: 10 })).toBe('low'));
  test('normal', () => expect(cellStatus({ name: 'x', qty: 100, minQty: 10 })).toBe('normal'));
  test('minQty=0 时不算低库存', () => expect(cellStatus({ name: 'x', qty: 5, minQty: 0 })).toBe('normal'));
});

describe('normalizeCell', () => {
  test('缺少名称返回 null', () => expect(normalizeCell({ qty: 5 })).toBe(null));
  test('未知类别归为 其他', () => {
    const c = normalizeCell({ name: 'x', category: '不存在的类' });
    expect(c.category).toBe('其他');
  });
  test('截断超长名称', () => {
    const c = normalizeCell({ name: 'a'.repeat(100) });
    expect(c.name.length).toBe(40);
  });
});
