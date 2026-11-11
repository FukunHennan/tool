import { describe, it, expect } from 'vitest';
import {
  DEFAULT_OFFSETS, guessOffset, humanBytes, parseOffset, percent, validateFiles,
} from '../util.js';

describe('parseOffset', () => {
  it('解析十六进制与十进制', () => {
    expect(parseOffset('0x1000')).toBe(4096);
    expect(parseOffset('0X10000')).toBe(65536);
    expect(parseOffset('4096')).toBe(4096);
  });
  it('非法输入返回 null', () => {
    expect(parseOffset('')).toBeNull();
    expect(parseOffset('abc')).toBeNull();
    expect(parseOffset('-1')).toBeNull();
    expect(parseOffset('0x')).toBeNull();
  });
});

describe('guessOffset', () => {
  it('按文件名猜默认偏移', () => {
    expect(guessOffset('bootloader.bin')).toBe(DEFAULT_OFFSETS.bootloader);
    expect(guessOffset('my-partition-table.bin')).toBe(DEFAULT_OFFSETS.partition);
    expect(guessOffset('firmware.bin')).toBe(DEFAULT_OFFSETS.app);
    expect(guessOffset('BOOTLOADER_ESP32.bin')).toBe(DEFAULT_OFFSETS.bootloader);
  });
});

describe('humanBytes', () => {
  it('B/KB/MB 切换', () => {
    expect(humanBytes(512)).toBe('512 B');
    expect(humanBytes(2048)).toBe('2.0 KB');
    expect(humanBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});

describe('percent', () => {
  it('截断到 0–100', () => {
    expect(percent(0, 100)).toBe('0');
    expect(percent(50, 100)).toBe('50');
    expect(percent(150, 100)).toBe('100');
    expect(percent(0, 0)).toBe('0');
  });
});

describe('validateFiles', () => {
  it('校验偏移合法性', () => {
    expect(validateFiles([])).toBe('请先添加固件文件');
    expect(validateFiles([{ name: 'a.bin', data: new Uint8Array(1), offset: '0x1000' }])).toBeNull();
    expect(validateFiles([{ name: 'a.bin', data: new Uint8Array(1), offset: 'xyz' }]))
      .toMatch(/偏移无效/);
    expect(validateFiles([{ name: 'a.bin', data: null, offset: '0x1000' }])).toBe('请先添加固件文件');
  });
});
