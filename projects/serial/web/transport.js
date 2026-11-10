/* 串口助手 · 传输层
 *
 * 统一「选端口 / 打开 / 读写 / 关闭」接口，两种实现：
 * - WebSerialTransport：原生 Web Serial（Chrome/Edge 89+，localhost/HTTPS）
 * - BridgeTransport：本机桥接服务 ws://127.0.0.1:8787（无 Web Serial 的环境，
 *   如 MiMo Desktop 内置浏览器；服务端 projects/serial/bridge.py）
 *
 * 检测到 Web Serial 时永远优先原生通道，桥接只是降级路径。
 */

const BRIDGE_URL = 'ws://127.0.0.1:8787/';

export function createTransport() {
  return 'serial' in navigator ? new WebSerialTransport() : new BridgeTransport();
}

/* ---------------- Web Serial ---------------- */

class WebSerialTransport {
  kind = 'serial';
  name = 'Web Serial';

  constructor() {
    this._onData = null;
    this._onClosed = null;
    this._reader = null;
    this._readTask = null;
    this._port = null;
    if ('serial' in navigator) {
      navigator.serial.addEventListener('disconnect', (event) => {
        if (event.target === this._port) this._emitClosed('设备移除');
      });
    }
  }

  onData(cb) { this._onData = cb; }
  onClosed(cb) { this._onClosed = cb; }

  describe(port) {
    if (!port) return '未选择端口';
    const info = port.getInfo ? port.getInfo() : {};
    if (info.usbVendorId) {
      const hex = (value) => value.toString(16).toUpperCase().padStart(4, '0');
      return `USB ${hex(info.usbVendorId)}:${hex(info.usbProductId ?? 0)}`;
    }
    return '已授权串口';
  }

  async pickPort() {
    this._port = await navigator.serial.requestPort();
    return { port: this._port, path: '', description: this.describe(this._port), online: true };
  }

  async listPorts() {
    const granted = await navigator.serial.getPorts();
    return granted.map((port) => ({
      port,
      path: '',
      description: this.describe(port),
      online: true,
    }));
  }

  select(item) {
    this._port = item?.port ?? null;
  }

  async restore() {
    const granted = await navigator.serial.getPorts();
    this._port = granted[0] ?? null;
    return this._port;
  }

  async open(options) {
    await this._port.open(options);
    this._readTask = this._readLoop();
  }

  async _readLoop() {
    const reader = this._port.readable.getReader();
    this._reader = reader;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value && value.length) this._onData?.(value);
      }
    } catch {
      /* 断开时读取循环退出 */
    } finally {
      reader.releaseLock();
      this._reader = null;
      this._emitClosed('设备移除或读取结束');
    }
  }

  async write(bytes) {
    const writer = this._port.writable.getWriter();
    try {
      await writer.write(bytes);
    } finally {
      writer.releaseLock();
    }
  }

  async close() {
    try { await this._reader?.cancel(); } catch { /* 已释放 */ }
    try { await this._readTask; } catch { /* 已退出 */ }
    try { await this._port?.close(); } catch { /* 已关闭 */ }
  }

  _emitClosed(reason) {
    this._onClosed?.(reason);
  }
}

/* ---------------- 桥接（WebSocket） ---------------- */

class BridgeTransport {
  kind = 'bridge';
  name = '本机桥接';

  constructor() {
    this._ws = null;
    this._port = null;
    this._onData = null;
    this._onClosed = null;
    this._pending = null; // { expect: string[], resolve }
  }

  async connect() {
    return new Promise((resolve) => {
      const ws = new WebSocket(BRIDGE_URL);
      ws.addEventListener('open', () => {
        this._ws = ws;
        ws.addEventListener('message', (event) => this._dispatch(event.data));
        ws.addEventListener('close', () => this._emitClosed('桥接连接断开'));
        ws.addEventListener('error', () => {});
        resolve(true);
      });
      ws.addEventListener('error', () => resolve(false));
    });
  }

  _send(obj) {
    this._ws?.send(JSON.stringify(obj));
  }

  _request(expect, sendObj) {
    return new Promise((resolve) => {
      this._pending = { expect, resolve };
      this._send(sendObj);
    });
  }

  _dispatch(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (this._pending && this._pending.expect.includes(msg.type)) {
      const { resolve } = this._pending;
      this._pending = null;
      resolve(msg);
      return;
    }
    if (msg.type === 'data') {
      const bytes = new Uint8Array(msg.data.match(/.{1,2}/g)?.map((h) => parseInt(h, 16)) ?? []);
      this._onData?.(bytes);
      return;
    }
    if (msg.type === 'closed') {
      this._emitClosed(msg.reason === 'device-gone' ? '设备移除' : '已断开');
      return;
    }
    if (msg.type === 'error') {
      this._emitClosed?.(msg.message);
      this._lastError = msg.message;
    }
  }

  describe(port) {
    if (!port) return '未选择端口';
    return port.description ? `${port.path}（${port.description}）` : port.path;
  }

  async listPorts() {
    const reply = await this._request(['ports', 'error'], { type: 'list' });
    if (reply.type === 'error') throw new Error(reply.message);
    return (reply.ports ?? []).map((p) => ({ ...p, online: true }));
  }

  select(item) {
    this._port = item ?? null;
  }

  async pickPort() {
    const reply = await this._request(['ports', 'error'], { type: 'list' });
    if (reply.type === 'error') throw new Error(reply.message);
    const choose = await window.__bridgePickPort?.(reply.ports ?? []);
    if (!choose) throw new Error('未选择端口');
    this._port = choose;
    return { ...choose, online: true };
  }

  async restore() {
    return null;
  }

  async open(options) {
    if (!this._port) return;
    const reply = await this._request(['opened', 'error'], {
      type: 'open', path: this._port.path, options,
    });
    if (reply.type === 'error') throw new Error(reply.message);
  }

  async write(bytes) {
    let hex = '';
    for (const b of bytes) hex += b.toString(16).padStart(2, '0') + ' ';
    this._send({ type: 'write', data: hex.trim() });
  }

  async close() {
    this._send({ type: 'close' });
  }
}

export { WebSerialTransport, BridgeTransport };
