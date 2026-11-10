/* 串口助手 · Web Serial
 *
 * 数据通道：navigator.serial（Chromium 系浏览器 + 安全上下文；localhost 满足）。
 * 纯逻辑（十六进制解析、日志格式化、环形缓冲、过滤统计）都在 format.js，有单测覆盖。
 */

import {
  APPEND_MODES, BAUD_RATES, RingLog, applyAppend, filterEntries,
  humanBytes, nextAppend, padByteCount, parseHex, stamp, statsOf, toHex,
} from './format.js';

const SETTINGS_KEY = 'serial-settings.v1';
const MAX_DOM_LINES = 10_000;
const MAX_FILTERED_RENDER = 3_000;
const SERIAL_SUPPORTED = 'serial' in navigator;

const state = {
  port: null,
  reader: null,
  readTask: null,
  connected: false,
  hexView: false,
  autoScroll: true,
  append: 'none',
  txHex: false,
  query: '',
  settings: { baudRate: 115200, dataBits: 8, parity: 'none', stopBits: 1, flowControl: 'none' },
  log: new RingLog(MAX_DOM_LINES),
};

const $ = (id) => document.getElementById(id);
const els = {
  status: $('status'),
  pick: $('pick'),
  portName: $('port-name'),
  baud: $('baud'),
  bauds: $('bauds'),
  connect: $('connect'),
  lock: $('lock'),
  configHint: $('config-hint'),
  hexToggle: $('hex-toggle'),
  count: $('count'),
  search: $('search'),
  autoScroll: $('auto-scroll'),
  clear: $('clear'),
  copy: $('copy'),
  log: $('log'),
  empty: $('empty'),
  append: $('append'),
  txMode: $('tx-mode'),
  tx: $('tx'),
  send: $('send'),
  stats: $('stats'),
};

/* ---------------- 分段控件 ---------------- */

const SEGMENTS = [
  { id: 'data-bits', tokens: [[5, '5'], [6, '6'], [7, '7'], [8, '8']] },
  { id: 'parity', tokens: [['none', 'N'], ['even', 'E'], ['odd', 'O']] },
  { id: 'stop-bits', tokens: [[1, '1'], [2, '2']] },
  { id: 'flow', tokens: [['none', '无'], ['hardware', '硬件'], ['software', '软件']] },
];

const SEGMENT_KEY = { 'data-bits': 'dataBits', parity: 'parity', 'stop-bits': 'stopBits', flow: 'flowControl' };

function buildSegments() {
  for (const { id, tokens } of SEGMENTS) {
    const host = $(id);
    host.replaceChildren();
    for (const [value, label] of tokens) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.dataset.value = String(value);
      button.addEventListener('click', () => {
        state.settings[SEGMENT_KEY[id]] = value;
        syncSegments();
        saveSettings();
      });
      host.append(button);
    }
  }

  els.append.replaceChildren();
  for (const mode of APPEND_MODES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = mode.label;
    button.dataset.value = mode.id;
    button.title = mode.id === 'none' ? '不追加' : `追加 ${mode.label}`;
    button.addEventListener('click', () => {
      state.append = mode.id;
      syncSegments();
      saveSettings();
    });
    els.append.append(button);
  }

  els.bauds.replaceChildren();
  for (const rate of BAUD_RATES) {
    const option = document.createElement('option');
    option.value = String(rate);
    els.bauds.append(option);
  }
}

function syncSegments() {
  for (const { id } of SEGMENTS) {
    const current = state.settings[SEGMENT_KEY[id]];
    for (const button of $(id).children) {
      button.setAttribute('aria-pressed', String(button.dataset.value === String(current)));
    }
  }
  for (const button of els.append.children) {
    button.setAttribute('aria-pressed', String(button.dataset.value === state.append));
  }
}

/* ---------------- 配置读写 ---------------- */

function loadSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    if (Number.isFinite(raw.baudRate)) state.settings.baudRate = raw.baudRate;
    if ([5, 6, 7, 8].includes(raw.dataBits)) state.settings.dataBits = raw.dataBits;
    if (['none', 'even', 'odd'].includes(raw.parity)) state.settings.parity = raw.parity;
    if ([1, 2].includes(raw.stopBits)) state.settings.stopBits = raw.stopBits;
    if (['none', 'hardware', 'software'].includes(raw.flowControl)) state.settings.flowControl = raw.flowControl;
    if (typeof raw.hexView === 'boolean') state.hexView = raw.hexView;
    if (typeof raw.autoScroll === 'boolean') state.autoScroll = raw.autoScroll;
    if (APPEND_MODES.some((mode) => mode.id === raw.append)) state.append = raw.append;
  } catch {
    /* 配置损坏时用默认值 */
  }
  els.baud.value = String(state.settings.baudRate);
  els.autoScroll.checked = state.autoScroll;
}

function saveSettings() {
  const payload = { ...state.settings, hexView: state.hexView, autoScroll: state.autoScroll, append: state.append };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(payload));
  } catch {
    /* 忽略隐私模式下的写入失败 */
  }
}

function readSettingsFromInputs() {
  const baudRate = Number.parseInt(els.baud.value, 10);
  if (Number.isFinite(baudRate) && baudRate >= 300 && baudRate <= 4_000_000) {
    state.settings.baudRate = baudRate;
  } else {
    els.baud.value = String(state.settings.baudRate);
  }
  return state.settings;
}

/* ---------------- 串口 ---------------- */

function describePort(port) {
  if (!port) return '未选择端口';
  const info = port.getInfo ? port.getInfo() : {};
  if (info.usbVendorId) {
    const hex = (value) => value.toString(16).toUpperCase().padStart(4, '0');
    return `USB ${hex(info.usbVendorId)}:${hex(info.usbProductId ?? 0)}`;
  }
  return '已授权串口';
}

function setStatus(text, kind = '') {
  els.status.textContent = text;
  els.status.className = `status ${kind}`.trim();
}

function syncUi() {
  const locked = state.connected;
  els.connect.textContent = locked ? '断开 (o)' : '连接 (o)';
  els.connect.classList.toggle('on', locked);
  els.pick.disabled = locked;
  els.baud.disabled = locked;
  for (const { id } of SEGMENTS) {
    for (const button of $(id).children) button.disabled = locked;
  }
  els.lock.textContent = locked ? '🔒' : '🔓';
  els.configHint.textContent = locked ? '已连接，配置已锁定。' : '连接后配置自动锁定，断开解锁。';
  els.portName.textContent = describePort(state.port);
  els.hexToggle.textContent = state.hexView ? 'HEX' : 'TEXT';
  els.txMode.textContent = state.txHex ? 'HEX' : 'ASCII';
  els.txMode.classList.toggle('hex', state.txHex);
  renderStats();
}

async function pickPort() {
  if (!SERIAL_SUPPORTED) {
    setStatus('浏览器不支持 Web Serial', 'err');
    return;
  }
  try {
    const port = await navigator.serial.requestPort();
    state.port = port;
    setStatus('端口已授权，点「连接」打开', '');
    syncUi();
  } catch {
    setStatus('未选择端口', '');
  }
}

async function connect() {
  if (!SERIAL_SUPPORTED) {
    setStatus('请用 Chrome / Edge 89+ 打开本页', 'err');
    return;
  }
  if (state.connected) return;
  if (!state.port) {
    await pickPort();
    if (!state.port) return;
  }
  const options = { ...readSettingsFromInputs() };
  try {
    await state.port.open(options);
  } catch (error) {
    setStatus(`打开失败：${error.message}`, 'err');
    return;
  }
  state.connected = true;
  saveSettings();
  syncUi();
  setStatus(`已连接 ${describePort(state.port)} @ ${options.baudRate}`, 'on');
  state.readTask = readLoop();
}

async function readLoop() {
  const port = state.port;
  const reader = port.readable.getReader();
  state.reader = reader;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value && value.length) appendEntry('rx', value);
    }
  } catch (error) {
    if (state.connected) setStatus(`读取出错：${error.message}`, 'err');
  } finally {
    reader.releaseLock();
    state.reader = null;
    if (state.connected) {
      state.connected = false;
      await closePort();
      syncUi();
      setStatus('已断开（设备移除或读取结束）', 'err');
    }
  }
}

async function closePort() {
  try {
    await state.port?.close();
  } catch {
    /* 已经关闭 */
  }
}

async function disconnect() {
  if (!state.connected) return;
  state.connected = false;
  try {
    await state.reader?.cancel();
  } catch {
    /* 读取器可能已释放 */
  }
  try {
    await state.readTask;
  } catch {
    /* 读取循环已退出 */
  }
  await closePort();
  syncUi();
  setStatus('未连接', '');
}

async function toggleConnection() {
  if (state.connected) await disconnect();
  else await connect();
}

async function send() {
  if (!state.connected || !state.port?.writable) {
    setStatus('未连接，无法发送', 'err');
    return;
  }
  const text = els.tx.value;
  const raw = state.txHex ? parseHex(text) : new TextEncoder().encode(text);
  const suffix = new TextEncoder().encode(APPEND_MODES.find((m) => m.id === state.append)?.value ?? '');
  if (!raw.length && !suffix.length) return;

  const payload = new Uint8Array(raw.length + suffix.length);
  payload.set(raw, 0);
  payload.set(suffix, raw.length);

  const writer = state.port.writable.getWriter();
  try {
    await writer.write(payload);
  } catch (error) {
    setStatus(`发送失败：${error.message}`, 'err');
    return;
  } finally {
    writer.releaseLock();
  }
  appendEntry('tx', payload);
}

/* ---------------- 日志渲染 ---------------- */

function matchesQuery(entry) {
  if (!state.query) return true;
  const needle = state.query.toLowerCase();
  const haystack = state.hexView ? toHex(entry.bytes) : new TextDecoder().decode(entry.bytes);
  return haystack.toLowerCase().includes(needle);
}

function renderLine(entry) {
  const line = document.createElement('div');
  line.className = `line ${entry.dir}`;

  const meta = document.createElement('span');
  meta.className = 'meta';
  meta.textContent = `[${stamp(entry.time)}] `;

  const arrow = document.createElement('span');
  arrow.className = 'arrow';
  arrow.textContent = entry.dir === 'tx' ? '► TX' : '◄ RX';

  const size = document.createElement('span');
  size.className = 'meta';
  size.textContent = ` (${padByteCount(entry.bytes.length)} B) `;

  const body = document.createElement('span');
  body.className = 'body';
  body.textContent = state.hexView ? toHex(entry.bytes) : new TextDecoder().decode(entry.bytes);

  line.append(meta, arrow, size, body);
  return line;
}

function appendEntry(dir, bytes) {
  const entry = state.log.push({ time: new Date(), dir, bytes: Uint8Array.from(bytes) });
  if (!matchesQuery(entry)) {
    updateCounters();
    return;
  }
  els.log.append(renderLine(entry));
  while (els.log.childElementCount > MAX_DOM_LINES) els.log.firstElementChild.remove();
  if (state.autoScroll) els.log.scrollTop = els.log.scrollHeight;
  updateCounters();
}

function rerenderLog() {
  const visible = filterEntries(state.log.items, state.query, { hex: state.hexView });
  const slice = visible.length > MAX_FILTERED_RENDER ? visible.slice(-MAX_FILTERED_RENDER) : visible;
  const fragment = document.createDocumentFragment();
  for (const entry of slice) fragment.append(renderLine(entry));
  els.log.replaceChildren(fragment);
  if (state.autoScroll) els.log.scrollTop = els.log.scrollHeight;
  updateCounters(visible.length);
}

function updateCounters(visibleCount) {
  const total = state.log.length;
  const shown = visibleCount ?? filterEntries(state.log.items, state.query, { hex: state.hexView }).length;
  els.count.textContent = shown === total ? `${total} 条` : `${shown} / ${total} 条`;
  els.empty.hidden = total > 0;
  renderStats();
}

function renderStats() {
  const { rxBytes, rxCount, txBytes, txCount } = statsOf(state.log.items);
  els.stats.textContent = `TX ${humanBytes(txBytes)} / ${txCount} · RX ${humanBytes(rxBytes)} / ${rxCount}`;
}

/* ---------------- 事件绑定 ---------------- */

function bindUi() {
  els.pick.addEventListener('click', () => { void pickPort(); });
  els.connect.addEventListener('click', () => { void toggleConnection(); });
  els.send.addEventListener('click', () => { void send(); });

  els.baud.addEventListener('change', () => {
    readSettingsFromInputs();
    saveSettings();
  });

  els.hexToggle.addEventListener('click', () => {
    state.hexView = !state.hexView;
    saveSettings();
    syncUi();
    rerenderLog();
  });

  els.autoScroll.addEventListener('change', () => {
    state.autoScroll = els.autoScroll.checked;
    saveSettings();
  });

  els.search.addEventListener('input', () => {
    state.query = els.search.value;
    rerenderLog();
  });

  els.clear.addEventListener('click', () => {
    state.log.clear();
    els.log.replaceChildren();
    updateCounters();
  });

  els.copy.addEventListener('click', async () => {
    const text = filterEntries(state.log.items, state.query, { hex: state.hexView })
      .map((entry) => `${stamp(entry.time)} ${entry.dir === 'tx' ? '► TX' : '◄ RX'} ${state.hexView ? toHex(entry.bytes) : new TextDecoder().decode(entry.bytes)}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setStatus(`已复制 ${text ? text.split('\n').length : 0} 行`, 'on');
    } catch {
      setStatus('复制失败（浏览器拒绝）', 'err');
    }
  });

  els.txMode.addEventListener('click', () => {
    state.txHex = !state.txHex;
    syncUi();
  });

  if (SERIAL_SUPPORTED) {
    navigator.serial.addEventListener('disconnect', (event) => {
      if (event.target === state.port) void disconnect();
    });
  }
}

function bindShortcuts() {
  window.addEventListener('keydown', (event) => {
    const target = event.target;
    const inField = target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);

    if (event.key === 'Enter' && target === els.tx) {
      event.preventDefault();
      void send();
      return;
    }
    if (event.key === 'Escape' && target === els.tx) {
      els.tx.value = '';
      return;
    }
    if (inField || event.ctrlKey || event.metaKey || event.altKey) return;

    switch (event.key.toLowerCase()) {
      case 'o':
        event.preventDefault();
        void toggleConnection();
        break;
      case 'x':
        event.preventDefault();
        els.hexToggle.click();
        break;
      case 'c':
        event.preventDefault();
        els.clear.click();
        break;
      case 'a':
        event.preventDefault();
        els.autoScroll.checked = !els.autoScroll.checked;
        els.autoScroll.dispatchEvent(new Event('change'));
        break;
      case 'n':
        event.preventDefault();
        state.append = nextAppend(state.append);
        saveSettings();
        syncSegments();
        break;
      case 'f':
        event.preventDefault();
        els.search.focus();
        break;
      case 'arrowup':
      case 'arrowdown':
        event.preventDefault();
        state.txHex = !state.txHex;
        syncUi();
        break;
      default:
        break;
    }
  });
}

/* ---------------- 启动 ---------------- */

async function boot() {
  buildSegments();
  loadSettings();
  syncSegments();
  bindUi();
  bindShortcuts();
  syncUi();

  if (!SERIAL_SUPPORTED) {
    els.pick.disabled = true;
    els.connect.disabled = true;
    setStatus('当前浏览器不支持 Web Serial，请用 Chrome / Edge 打开', 'err');
    els.configHint.textContent = 'Web Serial 仅 Chromium 内核浏览器支持；通过 localhost 或 HTTPS 访问。';
    return;
  }

  const granted = await navigator.serial.getPorts();
  if (granted.length) {
    state.port = granted[0];
    syncUi();
    setStatus('已恢复此前授权的端口', '');
  } else {
    setStatus('未连接');
  }
}

void boot();
