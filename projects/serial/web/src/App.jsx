import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Badge } from './components/ui/badge.jsx';
import { Button } from './components/ui/button.jsx';
import { Card, CardContent } from './components/ui/card.jsx';
import { Checkbox } from './components/ui/checkbox.jsx';
import { Input } from './components/ui/input.jsx';
import { Label } from './components/ui/label.jsx';
import { ScrollArea } from './components/ui/scroll-area.jsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './components/ui/select.jsx';
import { Separator } from './components/ui/separator.jsx';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from './components/ui/table.jsx';
import {
  BAUD_RATES, RingLog, applyAppend, decodeFrame, filterEntries,
  humanBytes, parseHex, stamp, statsOf, toHex,
} from './format.js';
import { createTransport } from './transport.js';

const transport = createTransport();
const MAX_DOM_LINES = 10_000;

const SEGMENTS = {
  dataBits: [[5, '5'], [6, '6'], [7, '7'], [8, '8']],
  parity: [['none', 'N'], ['even', 'E'], ['odd', 'O']],
  stopBits: [[1, '1'], [2, '2']],
  flow: [['none', '无'], ['hardware', '硬件'], ['software', '软件']],
};

export default function App() {
  const [settings, setSettings] = useState({ baudRate: 115200, dataBits: 8, parity: 'none', stopBits: 1, flowControl: 'none' });
  const [hexView, setHexView] = useState(false);
  const [decoder, setDecoder] = useState('none');
  const [autoScroll, setAutoScroll] = useState(true);
  const [txHex, setTxHex] = useState(false);
  const [connected, setConnected] = useState(false);
  const [devices, setDevices] = useState([]);
  const [port, setPort] = useState(null);
  const [deviceName, setDeviceName] = useState('');
  const [bridgeOk, setBridgeOk] = useState(true);
  const [query, setQuery] = useState('');
  const [tx, setTx] = useState('');
  const [logs, setLogs] = useState([]);
  const [status, setStatusState] = useState({ text: '未连接', kind: '' });

  const logsRef = useRef([]);
  const portRef = useRef(null);
  const connectedRef = useRef(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const logsEndRef = useRef(null);

  const setStatus = useCallback((text, kind = '') => setStatusState({ text, kind }), []);
  const deviceLabel = (item) => (item ? (item.description ? `${item.path} · ${item.description}` : item.path || '已授权串口') : '—');

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  /* ---------------- 数据行 ---------------- */

  const appendLog = useCallback((dir, bytes) => {
    const entry = { time: new Date(), dir, bytes: Uint8Array.from(bytes), dev: '' };
    logsRef.current = [...logsRef.current.slice(-(MAX_DOM_LINES - 1)), entry];
    setLogs(logsRef.current);
  }, []);

  useEffect(() => {
    transport.onData((bytes) => appendLog('rx', bytes));
    transport.onClosed((reason) => {
      if (!connectedRef.current) return;
      connectedRef.current = false;
      setConnected(false);
      setStatus(`已断开（${reason}）`, 'err');
    });
    async function boot() {
      if (transport.kind === 'bridge') {
        const ok = await transport.connect();
        if (!ok) {
          setBridgeOk(false);
          setStatus('桥接服务未运行，无法连接串口', 'err');
          return;
        }
        setStatus('桥接已就绪');
      } else {
        setStatus('未连接');
      }
      await refreshDevices();
    }
    void boot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------- 设备列表 ---------------- */

  async function refreshDevices() {
    try {
      const list = await transport.listPorts();
      setDevices(list);
    } catch {
      setDevices([]);
    }
  }

  function selectDevice(item) {
    portRef.current = item;
    setPort(item);
    transport.select(item);
    setStatus(`已选择 ${deviceLabel(item)}，点「连接」`);
  }

  /* ---------------- 连接 / 收发 ---------------- */

  async function connect() {
    if (connected) {
      connectedRef.current = false;
      setConnected(false);
      try { await transport.close(); } catch { /* 已关闭 */ }
      setStatus('未连接', '');
      return;
    }
    if (!portRef.current) {
      try {
        const picked = await transport.pickPort();
        if (!picked) return;
        portRef.current = picked;
        setPort(picked);
      } catch (error) {
        setStatus(error.message || '未选择端口', '');
        return;
      }
    }
    try {
      await transport.open({ ...settingsRef.current });
    } catch (error) {
      setStatus(`打开失败：${error.message}`, 'err');
      return;
    }
    connectedRef.current = true;
    setConnected(true);
    setDeviceName(deviceLabel(portRef.current));
    setStatus(`已连接 ${deviceLabel(portRef.current)} @ ${settingsRef.current.baudRate}`, 'on');
  }

  async function sendOnce() {
    if (!connectedRef.current) {
      setStatus('未连接，无法发送', 'err');
      return false;
    }
    const raw = txHex ? parseHex(tx) : new TextEncoder().encode(tx);
    const suffix = new TextEncoder().encode(applyAppend('', 'none'));
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
    const entry = { time: new Date(), dir: 'tx', bytes: payload, dev: '' };
    logsRef.current = [...logsRef.current.slice(-(MAX_DOM_LINES - 1)), entry];
    setLogs(logsRef.current);
    return true;
  }

  async function repeatSend() {
    for (let i = 0; i < 10; i++) {
      if (!connectedRef.current) break;
      await sendOnce();
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /* ---------------- 过滤与统计 ---------------- */

  const visibleLogs = filterEntries(logs, query, { hex: hexView });
  const { rxBytes, rxCount, txBytes, txCount } = statsOf(logs);
  const statusBadge = status.kind === 'on' ? 'success' : status.kind === 'err' ? 'error' : status.kind === 'busy' ? 'warning' : 'outline';

  const upd = (key) => (value) => setSettings((s) => ({ ...s, [key]: value }));

  return (
    <div className="h-screen w-full flex flex-col overflow-hidden bg-background text-foreground">
      {/* 顶栏 */}
      <header className="flex items-center gap-3 px-4 h-[52px] border-b bg-background/85 backdrop-blur">
        <div className="flex items-center gap-2.5 mr-1">
          <div className="h-8 w-8 rounded-lg grid place-items-center shadow-sm"
            style={{ background: 'linear-gradient(135deg, #6ea1ff, #4a7df0, #8b5cf6)', boxShadow: '0 2px 10px rgba(91,140,255,.35)' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M3 5h18v14H3z" opacity=".6" />
              <path d="M3 9h18M3 15h18" opacity=".5" />
              <path d="M6 12h2M10 12h2" />
            </svg>
          </div>
          <a href="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">← 工具目录</a>
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold">串口助手</div>
          <div className="font-mono text-[10px] text-muted-foreground">{transport.name} · 调试台</div>
        </div>
        <div className="flex-1" />
        <Badge variant={statusBadge}>{status.text}</Badge>
      </header>

      {/* 主体三栏 */}
      <main className="flex-1 min-h-0 grid grid-cols-[250px_minmax(0,1fr)_230px] gap-3.5 p-3.5">

        {/* 左：设备 */}
        <aside className="min-h-0 flex flex-col gap-3 overflow-y-auto">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">设备</div>
                <Button size="sm" variant="ghost" onClick={() => void refreshDevices()} disabled={connected}>刷新</Button>
              </div>
              <div className="flex flex-col gap-1.5 max-h-[210px] overflow-y-auto">
                {devices.length === 0 && (
                  <div className="text-xs text-muted-foreground py-3 text-center">未发现设备</div>
                )}
                {devices.map((item, i) => {
                  const active = port && (item.path === port.path || item.port === port.port);
                  return (
                    <button key={i} type="button"
                      onClick={() => selectDevice(item)}
                      className={"flex items-center gap-2.5 rounded-md border px-2.5 py-2 text-left text-xs transition-colors " +
                        (active ? "border-primary/60 bg-primary/10" : "border-border bg-muted/20 hover:bg-muted/40")}>
                      <span className="h-1.5 w-1.5 rounded-full bg-success flex-none" />
                      <span className="font-mono truncate">{deviceLabel(item)}</span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 pt-3 border-t flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground">目标</span>
                <span className="font-mono text-[11px] text-foreground">{deviceLabel(port)}</span>
              </div>
              <Button className="w-full h-9 mt-3" onClick={() => void connect()} disabled={!bridgeOk}>
                {connected ? '断开 (o)' : '连接'}
              </Button>
            </CardContent>
          </Card>

          <Card className={connected ? 'border-success/60' : ''}>
            <CardContent className="p-4">
              <div className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">常规</div>
              <div className="flex flex-col gap-3">
                <div>
                  <Label className="mb-1.5 block text-[11.5px] text-muted-foreground">波特率</Label>
                  <Select value={String(settings.baudRate)} onValueChange={(v) => { upd('baudRate')(Number(v)); }}>
                    <SelectTrigger disabled={connected}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {BAUD_RATES.map((rate) => <SelectItem key={rate} value={String(rate)}>{rate}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {[['dataBits', '数据位', SEGMENTS.dataBits], ['parity', '校验', SEGMENTS.parity], ['stopBits', '停止位', SEGMENTS.stopBits], ['flow', '流控', SEGMENTS.flow]].map(([key, label, tokens]) => (
                  <div key={key}>
                    <Label className="mb-1.5 block text-[11.5px] text-muted-foreground">{label}</Label>
                    <div className="flex gap-1">
                      {tokens.map(([value, text]) => (
                        <Button key={String(value)} size="sm" variant={settings[key] === value ? 'secondary' : 'outline'}
                          className="flex-1 h-8 px-1 text-xs"
                          disabled={connected}
                          onClick={() => upd(key)(value)}>
                          {text}
                        </Button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </aside>

        {/* 中：数据目录 */}
        <Card className="min-h-0 flex flex-col">
          <CardContent className="p-4 flex flex-col min-h-0 h-full">
            <div className="flex items-center gap-2.5 mb-3">
              <div className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">数据目录</div>
              <span className="font-mono text-[11px] text-muted-foreground">{logs.length} 条</span>
              <div className="flex-1" />
              <div className="flex gap-1">
                <Button size="sm" variant={hexView ? 'secondary' : 'outline'} className="h-7 text-[11px]" onClick={() => setHexView(true)}>HEX</Button>
                <Button size="sm" variant={!hexView ? 'secondary' : 'outline'} className="h-7 text-[11px]" onClick={() => setHexView(false)}>ASCII</Button>
              </div>
              <Input className="w-[130px] h-7 text-[11px]" placeholder="搜索…（f）" value={query} onChange={(e) => setQuery(e.target.value)} />
              <Button size="sm" variant="ghost" className="h-7" onClick={() => { logsRef.current = []; setLogs([]); }}>清空</Button>
              <Button size="sm" variant="ghost" className="h-7" onClick={() => {
                const text = visibleLogs.map((e) => `${stamp(e.time)} ${e.dir === 'tx' ? '► TX' : '◄ RX'} ${hexView ? toHex(e.bytes) : new TextDecoder().decode(e.bytes)}`).join('\n');
                void navigator.clipboard?.writeText(text);
              }}>复制</Button>
            </div>

            <ScrollArea className="flex-1 min-h-0 rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-[104px] font-mono text-[10px] uppercase tracking-widest">时间</TableHead>
                    <TableHead className="w-[72px] font-mono text-[10px] uppercase tracking-widest">方向</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-widest">数据</TableHead>
                    <TableHead className="w-[130px] font-mono text-[10px] uppercase tracking-widest">解析</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleLogs.length === 0 && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={4}>
                        <div className="h-[120px] flex flex-col items-center justify-center gap-2 text-muted-foreground text-xs">
                          <svg className="text-primary/70" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h10" /><circle cx="19" cy="17" r="2.4" /></svg>
                          <span>数据目录为空 · 在左侧选择设备后开始接收</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                  {visibleLogs.map((entry, i) => {
                    const decoded = decodeFrame(decoder, entry.bytes);
                    return (
                      <TableRow key={i} className={"font-mono text-[11.5px] " + (entry.dir === 'rx' ? 'text-cyan-300' : 'text-emerald-400')}>
                        <TableCell className="py-1 text-muted-foreground">{stamp(entry.time)}</TableCell>
                        <TableCell className="py-1">{entry.dir === 'tx' ? 'TX' : 'RX'}</TableCell>
                        <TableCell className="py-1 break-all">{hexView ? toHex(entry.bytes) : new TextDecoder().decode(entry.bytes)}</TableCell>
                        <TableCell className="py-1 text-amber-400">{decoded ? `${decoded.name} ${decoded.value}` : ''}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </ScrollArea>
            <div ref={logsEndRef} />
          </CardContent>
        </Card>

        {/* 右：显示/解码/会话 */}
        <aside className="min-h-0 flex flex-col gap-3 overflow-y-auto">
          <Card>
            <CardContent className="p-4">
              <div className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">显示</div>
              <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                <Checkbox checked={autoScroll} onCheckedChange={setAutoScroll} />
                自动滚动
              </label>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">解码</div>
              <Select value={decoder} onValueChange={setDecoder}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">无</SelectItem>
                  <SelectItem value="env">温湿度</SelectItem>
                </SelectContent>
              </Select>
              <div className="mt-2.5 text-[10.5px] text-muted-foreground leading-relaxed">帧：02 02 01 &lt;温度&gt; / 02 02 02 &lt;湿度&gt;</div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">颜色</div>
              <div className="flex flex-col gap-1.5 text-xs">
                <span className="flex items-center gap-2 text-muted-foreground"><span className="h-2 w-2 rounded-full bg-cyan-400" />RX 接收</span>
                <span className="flex items-center gap-2 text-muted-foreground"><span className="h-2 w-2 rounded-full bg-emerald-400" />TX 发送</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">会话</div>
              <div className="flex flex-col gap-1.5 text-xs">
                <div className="flex justify-between"><span className="text-muted-foreground">TX</span><b className="font-mono">{humanBytes(txBytes)} / {txCount}</b></div>
                <div className="flex justify-between"><span className="text-muted-foreground">RX</span><b className="font-mono">{humanBytes(rxBytes)} / {rxCount}</b></div>
                <div className="flex justify-between"><span className="text-muted-foreground">共</span><b className="font-mono">{logs.length} 条</b></div>
              </div>
            </CardContent>
          </Card>
        </aside>
      </main>

      {/* 发送栏 */}
      <footer className="flex items-center gap-2.5 px-4 py-2.5 border-t bg-background">
        <button type="button" onClick={() => setTxHex((v) => !v)}
          className={"font-mono text-[11px] px-2.5 h-7 rounded-md border transition-colors " + (txHex ? "border-warning/50 text-warning" : "border-border text-muted-foreground hover:text-foreground")}>
          {txHex ? 'HEX' : 'ASCII'}
        </button>
        <Input className="flex-1 h-8 font-mono text-xs" placeholder="输入要发送的内容，Enter 发送"
          value={tx} onChange={(e) => setTx(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void sendOnce(); }} />
        <Button className="h-8" onClick={() => void sendOnce()} disabled={!connected}>发送</Button>
        <Button variant="outline" className="h-8" onClick={() => void repeatSend()} disabled={!connected}>重复</Button>
        <span className="font-mono text-[10.5px] text-muted-foreground whitespace-nowrap">TX {humanBytes(txBytes)} · RX {humanBytes(rxBytes)}</span>
      </footer>

      {/* 状态栏 */}
      <footer className="flex items-center gap-3.5 px-4 h-7 border-t bg-muted/40">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: status.kind === 'on' ? 'var(--success)' : status.kind === 'err' ? 'var(--destructive)' : status.kind === 'busy' ? 'var(--warning)' : 'var(--muted-foreground)', opacity: status.kind ? 1 : 0.5 }} />
        <span className="font-mono text-[10.5px] text-muted-foreground">{status.text}</span>
        <Separator orientation="vertical" className="h-3" />
        <span className="font-mono text-[10.5px] text-muted-foreground">{settings.baudRate} {settings.dataBits}{String(settings.parity).charAt(0).toUpperCase()}{settings.stopBits}</span>
        <Separator orientation="vertical" className="h-3" />
        <span className="font-mono text-[10.5px] text-muted-foreground">TX {humanBytes(txBytes)} / {txCount} · RX {humanBytes(rxBytes)} / {rxCount}</span>
        <div className="flex-1" />
        <span className="font-mono text-[9px] border rounded px-1.5 text-muted-foreground">v4</span>
      </footer>
    </div>
  );
}
