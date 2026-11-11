import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ESPLoader, Transport } from 'esptool-js';
import { Button } from './components/ui/button.jsx';
import { Badge } from './components/ui/badge.jsx';
import { Card, CardContent } from './components/ui/card.jsx';
import { Checkbox } from './components/ui/checkbox.jsx';
import { Input } from './components/ui/input.jsx';
import { Label } from './components/ui/label.jsx';
import { Progress } from './components/ui/progress.jsx';
import { ScrollArea } from './components/ui/scroll-area.jsx';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from './components/ui/select.jsx';
import { Separator } from './components/ui/separator.jsx';
import {
  BAUD_RATES, FLASH_FREQS, FLASH_MODES, FLASH_SIZES,
  guessOffset, humanBytes, parseOffset, percent, validateFiles,
} from './util.js';

/* ---------------- 终端行类型 ---------------- */

const TERM_STYLE = {
  in: 'text-emerald-400',
  out: 'text-cyan-300',
  err: 'text-red-400',
  ok: 'text-emerald-400',
  warn: 'text-amber-400',
  dim: 'text-muted-foreground',
};

/* ---------------- 主组件 ---------------- */

export default function App() {
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [chipName, setChipName] = useState('');
  const [chipMac, setChipMac] = useState('');
  const [status, setStatus] = useState({ text: '未连接', kind: '' });
  const [baud, setBaud] = useState('460800');
  const [flashMode, setFlashMode] = useState('dio');
  const [flashFreq, setFlashFreq] = useState('40m');
  const [flashSize, setFlashSize] = useState('4MB');
  const [eraseAll, setEraseAll] = useState(false);
  const [files, setFiles] = useState([]);
  const [progress, setProgress] = useState(0);
  const [progressVisible, setProgressVisible] = useState(false);
  const [logs, setLogs] = useState([]);
  const [firmwareKey, setFirmwareKey] = useState(0);

  const loaderRef = useRef(null);
  const transportRef = useRef(null);
  const filesRef = useRef(files);
  filesRef.current = files;
  const logsEndRef = useRef(null);

  const log = useCallback((text, kind = 'dim') => {
    setLogs((prev) => [...prev, { text, kind }]);
  }, []);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const flashDisabled = !connected || busy || validateFiles(files.map((f) => ({ name: f.name, offset: f.offset, data: f.data }))) !== null;

  /* ---------------- 连接 ---------------- */

  async function connect() {
    if (connected) {
      try { await loaderRef.current?.after?.('hard_reset'); } catch { /* */ }
      try { await transportRef.current?.disconnect(); } catch { /* */ }
      loaderRef.current = null;
      transportRef.current = null;
      setConnected(false);
      setChipName('');
      setChipMac('');
      setStatus({ text: '未连接', kind: '' });
      return;
    }
    if (!('serial' in navigator)) {
      setStatus({ text: '浏览器不支持 Web Serial，请用 Chrome / Edge', kind: 'err' });
      return;
    }
    try {
      let port;
      try {
        port = await navigator.serial.requestPort();
      } catch {
        setStatus({ text: '未选择端口', kind: '' });
        return;
      }
      setStatus({ text: '连接中…', kind: 'busy' });
      const transport = new Transport(port, true);
      const loader = new ESPLoader({
        transport,
        baudrate: Number(baud),
        terminal: {
          clean: () => setLogs([]),
          writeLine: (data) => log(String(data)),
          write: (data) => log(String(data)),
        },
        debugLogging: false,
      });
      const name = await loader.main();
      loaderRef.current = loader;
      transportRef.current = transport;
      setConnected(true);
      setChipName(name);
      try {
        const mac = loader.chip?.getMacAddress?.();
        if (mac) setChipMac(mac);
      } catch { /* 部分芯片不支持 */ }
      log(`已连接：${name}`, 'ok');
      setStatus({ text: `已连接 ${name}`, kind: 'on' });
    } catch (error) {
      log(`连接失败：${error.message || error}`, 'err');
      setStatus({ text: '连接失败', kind: 'err' });
    }
  }

  /* ---------------- 固件文件 ---------------- */

  async function addFiles(fileList) {
    const items = [];
    for (const file of fileList) {
      const data = new Uint8Array(await file.arrayBuffer());
      items.push({ name: file.name, size: data.byteLength, offset: '0x' + guessOffset(file.name).toString(16), data });
    }
    setFiles((prev) => [...prev, ...items]);
    setFirmwareKey((k) => k + 1);
  }

  function updateFileOffset(name, offset) {
    setFiles((prev) => prev.map((f) => (f.name === name ? { ...f, offset } : f)));
  }

  function removeFile(name) {
    setFiles((prev) => prev.filter((f) => f.name !== name));
  }

  /* ---------------- 烧录 / 擦除 ---------------- */

  async function flash() {
    const items = filesRef.current
      .map((f) => ({ name: f.name, offset: parseOffset(f.offset), data: f.data }))
      .filter((f) => f.offset !== null);
    if (!items.length || !connected || busy) return;
    setBusy(true);
    setStatus({ text: '烧录中…', kind: 'busy' });
    setProgressVisible(true);
    setProgress(0);
    try {
      for (const item of items) {
        log(`写入 ${item.name} @ 0x${item.offset.toString(16)}`, 'warn');
      }
      await loaderRef.current.writeFlash({
        fileArray: items.map((f) => ({ data: f.data, address: f.offset })),
        flashMode, flashFreq, flashSize,
        eraseAll,
        compress: true,
        reportProgress: (index, written, total) => setProgress(Number(percent(written, total))),
      });
      log('烧录完成，正在复位设备…', 'ok');
      await loaderRef.current.after('hard_reset');
      await transportRef.current.disconnect();
      loaderRef.current = null;
      transportRef.current = null;
      setConnected(false);
      setChipName('');
      setChipMac('');
      setStatus({ text: '烧录完成', kind: 'on' });
      log('烧录完成，设备已断开，可重新上电使用', 'ok');
    } catch (error) {
      log(`烧录失败：${error.message || error}`, 'err');
      setStatus({ text: '烧录失败', kind: 'err' });
    } finally {
      setBusy(false);
      setProgressVisible(false);
    }
  }

  async function erase() {
    if (!connected || busy) return;
    setBusy(true);
    setStatus({ text: '擦除中…', kind: 'busy' });
    try {
      await loaderRef.current.eraseFlash();
      log('Flash 已擦除', 'ok');
      setStatus({ text: '擦除完成', kind: 'on' });
    } catch (error) {
      log(`擦除失败：${error.message || error}`, 'err');
      setStatus({ text: '擦除失败', kind: 'err' });
    } finally {
      setBusy(false);
    }
  }

  const statusBadge = status.kind === 'on' ? 'success' : status.kind === 'err' ? 'error' : status.kind === 'busy' ? 'warning' : 'outline';

  return (
    <div className="h-screen w-full flex flex-col overflow-hidden bg-background text-foreground">
      {/* 顶栏 */}
      <header className="flex items-center gap-3 px-4 h-[52px] border-b bg-background/85 backdrop-blur">
        <div className="flex items-center gap-2.5 mr-1">
          <div className="h-8 w-8 rounded-lg grid place-items-center shadow-sm"
            style={{ background: 'linear-gradient(135deg, #6ea1ff, #4a7df0, #8b5cf6)', boxShadow: '0 2px 10px rgba(91,140,255,.35)' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <rect x="3" y="6" width="18" height="12" rx="2" />
              <path d="M3 10h18" opacity=".7" />
              <circle cx="7" cy="15" r="1" fill="#fff" stroke="none" />
              <circle cx="17" cy="15" r="1" fill="#fff" stroke="none" />
            </svg>
          </div>
          <a href="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">← 工具目录</a>
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold">ESP32 烧录器</div>
          <div className="font-mono text-[10px] text-muted-foreground">esptool-js · Web Serial</div>
        </div>
        <div className="flex-1" />
        <Badge variant={statusBadge}>{status.text}</Badge>
      </header>

      {/* 主体三栏 */}
      <main className="flex-1 min-h-0 grid grid-cols-[240px_minmax(0,1fr)_minmax(240px,300px)] gap-3.5 p-3.5">

        {/* 左：设备与参数 */}
        <aside className="min-h-0 flex flex-col gap-3 overflow-y-auto">
          <Card className={connected ? 'border-success/60' : ''}>
            <CardContent className="p-4">
              <div className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">设备</div>
              <Button className="w-full h-10" onClick={connect} disabled={busy}>
                {connected ? '断开设备' : '连接设备'}
              </Button>
              <div className="mt-3.5 flex flex-col gap-2 text-xs">
                <div className="flex justify-between gap-2"><span className="text-muted-foreground">芯片</span><b className={"font-mono font-semibold " + (connected ? "text-primary" : "")}>{chipName || '—'}</b></div>
                <div className="flex justify-between gap-2"><span className="text-muted-foreground">MAC</span><b className={"font-mono font-semibold " + (connected ? "text-primary" : "")}>{chipMac || '—'}</b></div>
              </div>
              <div className="mt-3 pt-3 border-t text-[11.5px] text-muted-foreground leading-relaxed">
                连接前按住开发板 <b className="text-foreground">BOOT</b> 键进入下载模式，连接后松开。
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">波特率</div>
              <Select value={baud} onValueChange={setBaud}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {BAUD_RATES.map((rate) => <SelectItem key={rate} value={String(rate)}>{rate}</SelectItem>)}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">Flash 参数</div>
              <div className="flex flex-col gap-3">
                <div>
                  <Label className="mb-1.5 block text-[11.5px] text-muted-foreground">模式</Label>
                  <Select value={flashMode} onValueChange={setFlashMode}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {FLASH_MODES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="mb-1.5 block text-[11.5px] text-muted-foreground">频率</Label>
                  <Select value={flashFreq} onValueChange={setFlashFreq}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {FLASH_FREQS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="mb-1.5 block text-[11.5px] text-muted-foreground">大小</Label>
                  <Select value={flashSize} onValueChange={setFlashSize}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {FLASH_SIZES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                  <Checkbox checked={eraseAll} onCheckedChange={setEraseAll} />
                  烧录前擦除整个 Flash
                </label>
              </div>
            </CardContent>
          </Card>
        </aside>

        {/* 中：固件与操作 */}
        <section className="min-h-0 flex flex-col gap-3">
          <Card className="flex-1 min-h-0">
            <CardContent className="p-4 flex flex-col min-h-0 h-full">
              <div className="flex items-center justify-between mb-3">
                <div className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">固件</div>
                <Button size="sm" variant="outline" onClick={() => document.getElementById('file-input')?.click()}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                  添加固件文件…
                </Button>
                <input key={firmwareKey} id="file-input" type="file" accept=".bin,.hex" multiple hidden
                  onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }} />
              </div>

              <ScrollArea className="flex-1 min-h-0" key={firmwareKey}>
                <div className="flex flex-col gap-2 pr-3">
                  {files.length === 0 && (
                    <div className="flex flex-col items-center justify-center gap-2.5 min-h-[140px] border border-dashed rounded-lg bg-muted/20 text-muted-foreground text-xs text-center">
                      <svg className="text-primary/70" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                      <span>尚无固件文件 · 添加后按偏移写入</span>
                      <span className="font-mono text-[10.5px] opacity-70">bootloader → 0x1000 · partition → 0x8000 · app → 0x10000</span>
                    </div>
                  )}
                  {files.map((f) => (
                    <div key={f.name + f.size} className="flex items-center gap-2 rounded-lg border px-2.5 py-2 bg-muted/10 text-xs">
                      <div className="flex-1 min-w-0 truncate" title={f.name}>{f.name}</div>
                      <div className="font-mono text-[10px] text-muted-foreground">{humanBytes(f.size)}</div>
                      <Input
                        className="w-[92px] h-7 font-mono text-[11px] text-center px-2"
                        defaultValue={f.offset}
                        onBlur={(e) => updateFileOffset(f.name, e.target.value.trim())}
                        aria-label={`${f.name} 写入偏移`}
                      />
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => removeFile(f.name)} aria-label="移除">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                      </Button>
                    </div>
                  ))}
                </div>
              </ScrollArea>

              <div className="flex items-center gap-3 mt-3 text-[10.5px] text-muted-foreground font-mono">
                <span>常用偏移：</span>
                <span><b className="text-foreground">0x1000</b> bootloader</span>
                <span><b className="text-foreground">0x8000</b> partition</span>
                <span><b className="text-foreground">0x10000</b> app</span>
              </div>

              {progressVisible && (
                <div className="flex items-center gap-3 mt-3">
                  <Progress value={progress} className="h-2 flex-1" />
                  <span className="font-mono text-[11.5px] text-muted-foreground min-w-[36px] text-right">{progress}%</span>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-3.5 flex gap-2.5">
              <Button className="flex-[1.4] h-11 text-sm" onClick={flash} disabled={flashDisabled}>烧录固件</Button>
              <Button variant="outline" className="flex-1 h-11 text-sm text-destructive hover:text-destructive border-destructive/40" onClick={erase} disabled={!connected || busy}>擦除 Flash</Button>
            </CardContent>
          </Card>
        </section>

        {/* 右：终端 */}
        <Card className="min-h-0 flex flex-col">
          <CardContent className="p-3.5 flex flex-col min-h-0 h-full">
            <div className="flex items-center justify-between mb-2.5">
              <div className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">终端</div>
              <Button size="sm" variant="ghost" onClick={() => setLogs([])}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                清空
              </Button>
            </div>
            <ScrollArea className="flex-1 min-h-0 rounded-lg border bg-muted/15 p-2.5 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap break-all">
              {logs.length === 0 ? (
                <div className="h-full min-h-[150px] flex flex-col items-center justify-center gap-2 text-muted-foreground text-[11.5px]">
                  <svg className="text-primary/70" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h10" /><circle cx="19" cy="17" r="2.4" /></svg>
                  <span>esptool-js 输出将显示在此</span>
                </div>
              ) : (
                logs.map((entry, i) => (
                  <div key={i} className={TERM_STYLE[entry.kind] || 'text-muted-foreground'}>{entry.text}</div>
                ))
              )}
              <div ref={logsEndRef} />
            </ScrollArea>
          </CardContent>
        </Card>
      </main>

      {/* 状态栏 */}
      <footer className="flex items-center gap-3.5 px-4 h-7 border-t bg-muted/40">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: status.kind === 'on' ? 'var(--success)' : status.kind === 'err' ? 'var(--destructive)' : status.kind === 'busy' ? 'var(--warning)' : 'var(--muted-foreground)', opacity: status.kind ? 1 : 0.5 }} />
        <span className="font-mono text-[10.5px] text-muted-foreground">{status.text}</span>
        <Separator orientation="vertical" className="h-3" />
        <span className="font-mono text-[10.5px] text-muted-foreground">芯片 {chipName || '—'}</span>
        <Separator orientation="vertical" className="h-3" />
        <span className="font-mono text-[10.5px] text-muted-foreground">{baud}</span>
        <div className="flex-1" />
        <span className="font-mono text-[9px] border rounded px-1.5 text-muted-foreground">v1</span>
      </footer>
    </div>
  );
}
