/* 串口助手 · 调试台 v4
 *
 * 数据通道：优先 navigator.serial（Chromium 系 + 安全上下文）；
 * 缺失时自动回退本机桥接（projects/serial/bridge.py，ws://127.0.0.1:8787）。
 * 纯逻辑（十六进制、日志、过滤统计、协议解码）在 format.js，有 node 单测。
 */

import {
  BAUD_RATES, RingLog, applyAppend, decodeFrame, filterEntries,
  humanBytes, padByteCount, parseHex, stamp, statsOf, toHex,
} from './format.js';
import { createTransport } from './transport.js';

const SETTINGS_KEY = 'serial-settings.v1';
const MAX_DOM_LINES = 10_000;
const MAX_FILTERED_RENDER = 3_000;
const transport = createTransport();

const state = {
  port: null,
  deviceName: '',
  devices: [],
  connected: false,
  hexView: false,
  autoScroll: true,
  append: 'none',
  txHex: false,
  query: '',
  decoder: 'none',
  settings: { baudRate: 115200, dataBits: 8, parity: 'none', stopBits: 1, flowControl: 'none' },
  log: new RingLog(MAX_DOM_LINES),
};

const $ = (id) => document.getElementById(id);
const els = {
  status: $('status'),
  chip: $('chip'),
  refreshPorts: $('refresh-ports'),
  devList: $('dev-list'),
  devTarget: $('dev-target'),
  pick: $('pick'),
  portList: $('port-list'),
  count: $('count'),
  viewMode: document.querySelectorAll('#view-mode button'),
  decoder: $('decoder'),
  search: $('search'),
  autoScroll: $('auto-scroll'),
  clear: $('clear'),
  copy: $('copy'),
  log: $('log'),
  empty: $('empty'),
  baud: $('baud'),
  bauds: $('bauds'),
  connect: $('connect'),
  txMode: $('tx-mode'),
  tx: $('tx'),
  send: $('send'),
  repeat: $('repeat'),
  stats: $('stats'),
  statbar: $('statbar'),
  sbStatus: $('sb-status'),
  sbConfig: $('sb-config'),
  sbStats: $('sb-stats'),
  ssTx: $('ss-tx'),
  ssRx: $('ss-rx'),
  ssTotal: $('ss-total'),
};

/* ---------------- 分段控件 ---------------- */

const SEGMENTS = [
  { id: 'data-bits', key: 'dataBits', tokens: [[5, '5'], [6, '6'], [7, '7'], [8, '8']] },
  { id: 'parity', key: 'parity', tokens: [['none', 'N'], ['even', 'E'], ['odd', 'O']] },
  { id: 'stop-bits', key: 'stopBits', tokens: [[1, '1'], [2, '2']] },
  { id: 'flow', key: 'flowControl', tokens: [['none', '无'], ['hardware', '硬件'], ['software', '软件']] },
];

function buildSegments() {
  for (const { id, key, tokens } of SEGMENTS) {
    const host = $(id);
    host.replaceChildren();
    for (const [value, label] of tokens) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.dataset.value = String(value);
      button.addEventListener('click', () => {
        state.settings[key] = value;
        syncSegments();
        saveSettings();
      });
      host.append(button);
    }
  }
  els.bauds.replaceChildren();
  for (const rate of BAUD_RATES) {
    const option = document.createElement('option');
    option.value = String(rate);
    els.bauds.append(option);
  }
}

function syncSegments() {
  for (const { id, key } of SEGMENTS) {
    const current = state.settings[key];
    for (const button of $(id).children) {
      button.setAttribute('aria-pressed', String(button.dataset.value === String(current)));
    }
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
    if (raw.decoder === 'env' || raw.decoder === 'none') state.decoder = raw.decoder;
  } catch {
    /* 配置损坏时用默认值 */
  }
  els.baud.value = String(state.settings.baudRate);
  els.autoScroll.checked = state.autoScroll;
  els.decoder.value = state.decoder;
}

function saveSettings() {
  const payload = {
    ...state.settings, hexView: state.hexView, autoScroll: state.autoScroll,
    append: state.append, decoder: state.decoder,
  };
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

/* ---------------- 设备列表 ---------------- */

function deviceLabel(item) {
  if (!item) return '—';
  if (item.description) return `${item.path} · ${item.description}`;
  return item.path || '已授权串口';
}

function renderDevices() {
  state.devices.forEach((item) => {
    const node = document.createElement('div');
    node.className = 'dev-item' + (item.online ? ' online' : '') + (item === state.port ? ' connected' : '');
    node.setAttribute('role', 'option');
    node.setAttribute('aria-selected', String(item === state.port));
    node.innerHTML =
      `<span class="dev-dot" aria-hidden="true"></span>` +
      `<span class="dev-body"><span class="dev-name">${deviceLabel(item)}</span></span>`;
    node.addEventListener('click', () => {
      state.port = item;
      transport.select(item);
      renderDevices();
      syncUi();
      setStatus(`已选择 ${deviceLabel(item)}，点「连接」`, '');
    });
    els.devList.append(node);
  });
}

async function refreshDevices() {
  try {
    state.devices = await transport.listPorts();
  } catch {
    state.devices = [];
  }
  els.devList.replaceChildren();
  renderDevices();
  els.devTarget.textContent = `目标：${deviceLabel(state.port)}`;
}

/* ---------------- 状态与 UI 同步 ---------------- */

function setStatus(text, kind = '') {
  els.status.textContent = text;
  els.status.className = `status ${kind}`.trim();
}

function syncUi() {
  const locked = state.connected;
  els.connect.textContent = locked ? '断开 (o)' : '连接 (o)';
  els.connect.classList.toggle('on', locked);
  els.connect.disabled = false;
  els.refreshPorts.disabled = locked;
  els.baud.disabled = locked;
  for (const { id } of SEGMENTS) {
    for (const button of $(id).children) button.disabled = locked;
  }
  els.chip.textContent = transport.name;
  els.devTarget.textContent = `目标：${deviceLabel(state.port)}`;
  syncViewMode();
  renderStats();
  syncStatbar();
}

function syncViewMode() {
  for (const button of els.viewMode) {
    const on = (button.dataset.view === 'hex') === state.hexView;
    button.setAttribute('aria-pressed', String(on));
  }
}

function syncStatbar() {
  const s = state.settings;
  const err = els.status.classList.contains('err');
  const kind = state.connected ? 'on' : err ? 'err' : '';
  els.statbar.className = `statbar ${kind}`.trim();
  els.sbStatus.textContent = state.connected
    ? `已连接 ${deviceLabel(state.port)}`
    : err ? '连接异常' : '未连接';
  const flow = s.flowControl === 'hardware' ? ' RTS/CTS' : s.flowControl === 'software' ? ' XON/XOFF' : '';
  els.sbConfig.textContent = `${s.baudRate} ${s.dataBits}${String(s.parity).charAt(0).toUpperCase()}${s.stopBits}${flow}`;
}

/* ---------------- 连接 / 收发 ---------------- */

async function pickPort() {
  try {
    state.port = await transport.pickPort();
    renderDevices();
    syncUi();
    setStatus('端口已选择，点「连接」打开', '');
  } catch (error) {
    setStatus(error.message || '未选择端口', '');
  }
}

async function connect() {
  if (state.connected) return;
  if (!state.port) {
    await pickPort();
    if (!state.port) return;
  }
  const options = { ...readSettingsFromInputs() };
  try {
    await transport.open(options);
  } catch (error) {
    setStatus(`打开失败：${error.message}`, 'err');
    return;
  }
  state.connected = true;
  state.deviceName = deviceLabel(state.port);
  saveSettings();
  syncUi();
  renderDevices();
  setStatus(`已连接 ${state.deviceName} @ ${options.baudRate}`, 'on');
}

async function disconnect() {
  if (!state.connected) return;
  state.connected = false;
  try {
    await transport.close();
  } catch {
    /* 已关闭 */
  }
  syncUi();
  setStatus('未连接', '');
}

async function toggleConnection() {
  if (state.connected) await disconnect();
  else await connect();
}

async function sendOnce() {
  if (!state.connected) {
    setStatus('未连接，无法发送', 'err');
    return false;
  }
  const text = els.tx.value;
  const raw = state.txHex ? parseHex(text) : new TextEncoder().encode(text);
  const suffix = new TextEncoder().encode(applyAppend('', state.append));
  if (!raw.length && !suffix.length) return false;
  const payload = new Uint8Array(raw.length + suffix.length);
  payload.set(raw, 0);
  payload.set(suffix, raw.length);
  try {
    await transport.write(payload);
  } catch (error) {
    setStatus(`发送失败：${error.message}`, 'err');
    return false;
  }
  appendEntry('tx', payload);
  return true;
}

async function send() {
  await sendOnce();
}

async function repeatSend() {
  els.repeat.disabled = true;
  try {
    for (let i = 0; i < 10; i++) {
      if (!state.connected) break;
      await sendOnce();
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } finally {
    els.repeat.disabled = false;
  }
}

/* ---------------- 数据目录 ---------------- */

function renderRow(entry) {
  const row = document.createElement('div');
  row.className = `drow ${entry.dir}`;

  const time = document.createElement('span');
  time.className = 'c-time';
  time.textContent = stamp(entry.time);

  const dev = document.createElement('span');
  dev.className = 'c-dev';
  dev.textContent = entry.dev || state.deviceName || '—';

  const dir = document.createElement('span');
  dir.className = 'c-dir';
  dir.textContent = entry.dir === 'tx' ? 'TX' : 'RX';

  const data = document.createElement('span');
  data.className = 'c-data';
  data.textContent = state.hexView ? toHex(entry.bytes) : new TextDecoder().decode(entry.bytes);

  const parse = document.createElement('span');
  parse.className = 'c-parse';
  const decoded = decodeFrame(state.decoder, entry.bytes);
  if (decoded) parse.textContent = `${decoded.name} ${decoded.value}`;

  row.append(time, dev, dir, data, parse);
  return row;
}

function appendEntry(dir, bytes) {
  const entry = state.log.push({ time: new Date(), dir, bytes: Uint8Array.from(bytes) });
  if (!matchesQuery(entry)) {
    updateCounters();
    return;
  }
  els.log.append(renderRow(entry));
  while (els.log.childElementCount > MAX_DOM_LINES) els.log.firstElementChild.remove();
  if (state.autoScroll) els.log.scrollTop = els.log.scrollHeight;
  updateCounters();
}

function matchesQuery(entry) {
  if (!state.query) return true;
  const needle = state.query.toLowerCase();
  const haystack = state.hexView ? toHex(entry.bytes) : new TextDecoder().decode(entry.bytes);
  return haystack.toLowerCase().includes(needle);
}

function rerenderLog() {
  const visible = filterEntries(state.log.items, state.query, { hex: state.hexView });
  const slice = visible.length > MAX_FILTERED_RENDER ? visible.slice(-MAX_FILTERED_RENDER) : visible;
  const fragment = document.createDocumentFragment();
  for (const entry of slice) fragment.append(renderRow(entry));
  els.log.replaceChildren(fragment);
  if (state.autoScroll) els.log.scrollTop = els.log.scrollHeight;
  updateCounters(visible.length);
}

function updateCounters(visibleCount) {
  const total = state.log.length;
  const shown = visibleCount ?? filterEntries(state.log.items, state.query, { hex: state.hexView }).length;
  els.count.textContent = `${shown} / ${total} 条`;
  els.empty.hidden = total > 0;
  renderStats();
}

function renderStats() {
  const { rxBytes, rxCount, txBytes, txCount } = statsOf(state.log.items);
  els.stats.textContent = `TX ${humanBytes(txBytes)} / ${txCount} · RX ${humanBytes(rxBytes)} / ${rxCount}`;
  els.sbStats.textContent = `TX ${humanBytes(txBytes)} / ${txCount} · RX ${humanBytes(rxBytes)} / ${rxCount}`;
  els.ssTx.textContent = `${humanBytes(txBytes)} / ${txCount}`;
  els.ssRx.textContent = `${humanBytes(rxBytes)} / ${rxCount}`;
  els.ssTotal.textContent = `${state.log.length} 条`;
}

/* ---------------- 事件绑定 ---------------- */

function bindUi() {
  els.refreshPorts.addEventListener('click', () => { void refreshDevices(); });
  els.pick.addEventListener('click', () => { void pickPort(); });
  els.connect.addEventListener('click', () => { void toggleConnection(); });
  els.send.addEventListener('click', () => { void send(); });
  els.repeat.addEventListener('click', () => { void repeatSend(); });

  for (const button of els.viewMode) {
    button.addEventListener('click', () => {
      state.hexView = button.dataset.view === 'hex';
      saveSettings();
      syncViewMode();
      rerenderLog();
    });
  }

  els.decoder.addEventListener('change', () => {
    state.decoder = els.decoder.value;
    saveSettings();
    rerenderLog();
  });

  els.baud.addEventListener('change', () => {
    readSettingsFromInputs();
    saveSettings();
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
    els.txMode.classList.toggle('hex', state.txHex);
    els.txMode.textContent = state.txHex ? 'HEX' : 'ASCII';
  });

  // 桥接模式：transport.pickPort() 通过此钩子弹出端口下拉
  window.__bridgePickPort = (ports) => new Promise((resolve) => {
    if (!ports.length) {
      setStatus('未发现串口设备', 'err');
      resolve(null);
      return;
    }
    els.portList.replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '请选择端口…';
    placeholder.disabled = true;
    placeholder.selected = true;
    els.portList.append(placeholder);
    for (const p of ports) {
      const option = document.createElement('option');
      option.value = p.path;
      option.textContent = p.description ? `${p.path}（${p.description}）` : p.path;
      els.portList.append(option);
    }
    els.portList.hidden = false;
    const onPick = () => {
      els.portList.hidden = true;
      els.portList.removeEventListener('change', onPick);
      resolve(ports.find((p) => p.path === els.portList.value) ?? null);
    };
    els.portList.addEventListener('change', onPick);
  });
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
        state.hexView = !state.hexView;
        saveSettings();
        syncViewMode();
        rerenderLog();
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
      case 'f':
        event.preventDefault();
        els.search.focus();
        break;
      case 'arrowup':
      case 'arrowdown':
        event.preventDefault();
        state.txHex = !state.txHex;
        els.txMode.classList.toggle('hex', state.txHex);
        els.txMode.textContent = state.txHex ? 'HEX' : 'ASCII';
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

  transport.onData((bytes) => appendEntry('rx', bytes));
  transport.onClosed((reason) => {
    if (!state.connected) return;
    state.connected = false;
    syncUi();
    setStatus(`已断开（${reason}）`, 'err');
  });

  if (transport.kind === 'bridge') {
    const ok = await transport.connect();
    if (!ok) {
      els.pick.disabled = true;
      els.refreshPorts.disabled = true;
      els.connect.disabled = true;
      setStatus('桥接服务未运行，无法连接串口', 'err');
      return;
    }
    setStatus('桥接已就绪');
  } else {
    setStatus('未连接');
  }
  await refreshDevices();
  syncUi();
}

void boot();
