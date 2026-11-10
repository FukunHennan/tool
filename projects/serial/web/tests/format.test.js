import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APPEND_MODES, applyAppend, decodeFrame, filterEntries, formatLogLine, humanBytes,
  nextAppend, padByteCount, parseHex, RingLog, statsOf, stamp, toHex,
} from '../format.js';

test('parseHex 支持空格分隔、连续、小写', () => {
  assert.deepEqual(Array.from(parseHex('48 65 6C')), [0x48, 0x65, 0x6c]);
  assert.deepEqual(Array.from(parseHex('48656C')), [0x48, 0x65, 0x6c]);
  assert.deepEqual(Array.from(parseHex('4f 65 6c')), [0x4f, 0x65, 0x6c]);
  assert.deepEqual(Array.from(parseHex('  48\n65\t6C  ')), [0x48, 0x65, 0x6c]);
});

test('parseHex 遇到非法字符就停止，落单半字节丢弃', () => {
  assert.deepEqual(Array.from(parseHex('48 ZZ 6C')), [0x48]);
  assert.deepEqual(Array.from(parseHex('486')), [0x48]);
  assert.deepEqual(Array.from(parseHex('')), []);
  assert.deepEqual(Array.from(parseHex('zz')), []);
});

test('toHex 输出大写、空格分隔', () => {
  assert.equal(toHex(new Uint8Array([0x48, 0x65, 0x6c])), '48 65 6C');
  assert.equal(toHex(new Uint8Array([0x00, 0x0f, 0xff])), '00 0F FF');
  assert.equal(toHex(new Uint8Array()), '');
});

test('padByteCount 右对齐 5 位', () => {
  assert.equal(padByteCount(5), '    5');
  assert.equal(padByteCount(12345), '12345');
});

test('stamp 输出毫秒三位', () => {
  const date = new Date(2026, 10, 10, 14, 32, 45, 7);
  assert.equal(stamp(date), '14:32:45.007');
});

test('formatLogLine 的 HEX / TEXT / 方向', () => {
  const entry = { time: new Date(2026, 10, 10, 14, 32, 45, 123), dir: 'rx', bytes: new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]) };
  assert.equal(formatLogLine(entry, { hex: true }), '[14:32:45.123] ◄ RX (    5 B) 48 65 6C 6C 6F');
  assert.equal(formatLogLine(entry), '[14:32:45.123] ◄ RX (    5 B) Hello');
  const tx = { ...entry, dir: 'tx' };
  assert.match(formatLogLine(tx), /► TX/);
});

test('applyAppend 覆盖 5 档且未知模式退回“无”', () => {
  assert.equal(applyAppend('A', 'none'), 'A');
  assert.equal(applyAppend('A', 'lf'), 'A\n');
  assert.equal(applyAppend('A', 'cr'), 'A\r');
  assert.equal(applyAppend('A', 'crlf'), 'A\r\n');
  assert.equal(applyAppend('A', 'lfcr'), 'A\n\r');
  assert.equal(applyAppend('A', 'bogus'), 'A');
  assert.equal(APPEND_MODES.length, 5);
});

test('nextAppend 循环回到起点', () => {
  let mode = 'none';
  for (let i = 0; i < APPEND_MODES.length; i += 1) mode = nextAppend(mode);
  assert.equal(mode, 'none');
  assert.equal(nextAppend('none'), 'lf');
});

test('RingLog 超过容量淘汰最旧', () => {
  const log = new RingLog(3);
  for (const n of [1, 2, 3, 4, 5]) log.push({ time: new Date(), dir: 'rx', bytes: new Uint8Array([n]) });
  assert.equal(log.length, 3);
  assert.deepEqual(Array.from(log.items[0].bytes), [3]);
  log.clear();
  assert.equal(log.length, 0);
});

test('RingLog.toText 按行导出', () => {
  const log = new RingLog(10);
  log.push({ time: new Date(2026, 0, 1, 0, 0, 0, 0), dir: 'rx', bytes: new Uint8Array([0x41]) });
  log.push({ time: new Date(2026, 0, 1, 0, 0, 0, 1), dir: 'tx', bytes: new Uint8Array([0x42]) });
  const lines = log.toText({ hex: true }).split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /◄ RX \(    1 B\) 41/);
  assert.match(lines[1], /► TX \(    1 B\) 42/);
});

test('filterEntries 按 HEX 与 TEXT 两种模式匹配', () => {
  const entries = [
    { time: new Date(), dir: 'rx', bytes: new Uint8Array([0x41, 0x42]) },          // "AB"
    { time: new Date(), dir: 'rx', bytes: new Uint8Array([0x43, 0x44]) },          // "CD"
  ];
  assert.equal(filterEntries(entries, '').length, 2);
  assert.equal(filterEntries(entries, '   ').length, 2);
  assert.equal(filterEntries(entries, 'ab').length, 1);
  assert.equal(filterEntries(entries, '42', { hex: true }).length, 1);
  assert.equal(filterEntries(entries, 'zz').length, 0);
});

test('statsOf 分方向统计字节与条数', () => {
  const entries = [
    { time: new Date(), dir: 'rx', bytes: new Uint8Array([1, 2, 3]) },
    { time: new Date(), dir: 'tx', bytes: new Uint8Array([4, 5]) },
    { time: new Date(), dir: 'rx', bytes: new Uint8Array([6]) },
  ];
  assert.deepEqual(statsOf(entries), { rxBytes: 4, rxCount: 2, txBytes: 2, txCount: 1 });
  assert.deepEqual(statsOf([]), { rxBytes: 0, rxCount: 0, txBytes: 0, txCount: 0 });
});

test('humanBytes 在 B/KB/MB 之间切换', () => {
  assert.equal(humanBytes(512), '512 B');
  assert.equal(humanBytes(1536), '1.5 KB');
  assert.equal(humanBytes(2 * 1024 * 1024), '2.0 MB');
});

test('decodeFrame 温湿度协议解析', () => {
  assert.deepEqual(decodeFrame('none', new Uint8Array([2, 2, 1, 25])), null);
  assert.deepEqual(decodeFrame('env', new Uint8Array([2, 2, 1, 25])), { name: '温度', value: '25℃' });
  assert.deepEqual(decodeFrame('env', new Uint8Array([2, 2, 2, 55])), { name: '湿度', value: '55%' });
  assert.equal(decodeFrame('env', new Uint8Array([2, 3, 1, 25])), null);
  assert.equal(decodeFrame('env', new Uint8Array([2, 2])), null);
  assert.equal(decodeFrame('env', new Uint8Array([2, 2, 9, 25])), null);
});
