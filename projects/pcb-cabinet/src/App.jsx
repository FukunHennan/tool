import React, { useEffect, useRef, useState } from 'react';
import { Badge } from './components/ui/badge.jsx';
import { Button } from './components/ui/button.jsx';
import { Card, CardContent } from './components/ui/card.jsx';
import { Checkbox } from './components/ui/checkbox.jsx';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './components/ui/dialog.jsx';
import { Input } from './components/ui/input.jsx';
import { Label } from './components/ui/label.jsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './components/ui/select.jsx';
import { Separator } from './components/ui/separator.jsx';
import { Sheet, SheetContent } from './components/ui/sheet.jsx';
import { Store } from './store/store.js';
import { CATEGORIES, validateBackup } from './store/store.js';
import {
  cellKey, cellStatus, esc, fmtNum, fmtTime, labelAt, parseQty, rowLabel, toCellKey, totalOf,
} from './utils.js';

const STATUS_TEXT = { empty: '空位', normal: '正常', low: '低库存', out: '缺料' };
const STATUS_DOT = { empty: 'bg-muted-foreground/50', normal: 'bg-success', low: 'bg-warning', out: 'bg-destructive' };

export default function App() {
  const storeRef = useRef(null);
  if (!storeRef.current) storeRef.current = new Store();
  const store = storeRef.current;

  const [, force] = useState(0);
  const refresh = () => force((n) => n + 1);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    store.load();
    setReady(true);
    refresh();
    const off = store.on(() => refresh());
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!ready) return null;
  return <Pcb store={store} />;
}

/* ================= 主界面 ================= */

function Pcb({ store }) {
  const [ui, setUi] = useState({ currentId: null, query: '', cross: false, zoomMode: 'fill', fixedW: 120 });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [zonesOpen, setZonesOpen] = useState(true);
  const [toastMsg, setToastMsg] = useState(null);
  const [draft, setDraft] = useState(null);
  const [sDraft, setSDraft] = useState(null);

  const zone = store.zone;
  const zones = store.state.zones;
  const stats = store.zoneStats();
  const warnCount = stats.low + stats.out;

  function toast(text, kind = 'ok') {
    setToastMsg({ text, kind });
    setTimeout(() => setToastMsg(null), 2400);
  }

  /* ---------- 抽屉（格位详情） ---------- */

  function openDrawer(id) {
    if (!store.inRange(id)) return;
    const cell = store.getCell(id);
    setUi((s) => ({ ...s, currentId: id }));
    setDraft({
      name: cell?.name || '', category: cell?.category || '电阻', model: cell?.model || '',
      qty: cell?.qty ?? '', unit: cell?.unit || 'pcs', minQty: cell?.minQty ?? 0, note: cell?.note || '',
    });
    setDrawerOpen(true);
  }

  function saveForm() {
    const id = ui.currentId;
    if (!id || !draft) return;
    if (!draft.name.trim()) { toast('请先填写物料名称', 'warn'); return; }
    const cell = {
      name: draft.name.trim().slice(0, 40),
      category: draft.category,
      model: draft.model.trim().slice(0, 40),
      qty: parseQty(draft.qty, 0),
      unit: draft.unit.trim().slice(0, 6) || 'pcs',
      minQty: parseQty(draft.minQty, 0),
      note: draft.note.trim().slice(0, 120),
      updatedAt: new Date().toISOString(),
    };
    store.setCell(id, cell);
    store.emit('cell', { id, cell });
    toast(`${id} 已保存 · ${cell.name}`, 'ok');
  }

  function clearCell() {
    const id = ui.currentId;
    if (!id || !store.getCell(id)) return;
    if (!window.confirm(`确认清空 ${id} 格的物料？此操作不可撤销。`)) return;
    store.clearCell(id);
    store.emit('cell', { id, cell: null });
    setDrawerOpen(false);
    toast(`${id} 已清空`, 'ok');
  }

  function stepQty(delta) {
    setDraft((d) => ({ ...d, qty: Math.max(0, (Number(d.qty) || 0) + delta) }));
  }

  /* ---------- 区域操作 ---------- */

  function addZone() {
    const z = store.addZone({ name: `区域 ${zones.length + 1}`, rowCounts: [4, 4, 4, 4], layoutMode: 'total' });
    store.emit('zone', { action: 'add', id: z.id });
    toast('已新增区域', 'ok');
  }

  function moveZone(id, dir) {
    store.moveZone(id, dir);
    store.emit('zone', { action: 'move', id });
  }

  function copyZone() {
    const copy = store.copyZone(store.state.activeZoneId);
    if (copy) { store.emit('zone', { action: 'add', id: copy.id }); toast('已复制区域', 'ok'); }
  }

  function deleteZone() {
    if (zones.length <= 1) { toast('至少保留一个区域', 'warn'); return; }
    if (!window.confirm(`确认删除区域「${zone.name}」？其中物料将一并删除。`)) return;
    store.removeZone(store.state.activeZoneId);
    store.emit('zone', { action: 'remove' });
    toast('区域已删除', 'ok');
  }

  function openSettings() {
    setSDraft({
      name: zone.name, location: zone.location || '', note: zone.note || '',
      layoutMode: zone.layoutMode, rowCounts: zone.rowCounts.slice(),
    });
    setSettingsOpen(true);
  }

  function applySettings() {
    const rowCounts = sDraft.layoutMode === 'total'
      ? Array.from({ length: sDraft.rows || 6 }, () => sDraft.cols || 4)
      : sDraft.rowCounts.slice();
    const res = store.updateZone(store.state.activeZoneId, {
      name: sDraft.name.trim() || zone.name,
      note: sDraft.note, location: sDraft.location,
      layoutMode: sDraft.layoutMode, rowCounts,
    });
    store.emit('zone', { action: 'update' });
    setSettingsOpen(false);
    toast(`布局已应用：共 ${res.total} 格 / ${res.rows} 排${res.stashed ? `，暂存 ${res.stashed} 格` : ''}`, 'ok');
  }

  /* ---------- 搜索 ---------- */

  const searchResults = useRef(null);
  function doSearch(q) {
    setUi((s) => ({ ...s, query: q }));
  }
  const hitIds = new Set(ui.query ? store.search(ui.query).map((h) => h.id) : []);
  const crossHits = ui.cross && ui.query ? store.searchAll(ui.query) : [];

  /* ---------- 导入导出 ---------- */

  function exportBackup() {
    const data = store.backup();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `pcb-cabinet-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function importBackup(file) {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      validateBackup(data);
      store.replaceState(data);
      store.emit('zone', { action: 'import' });
      toast('导入成功', 'ok');
    } catch (error) {
      toast(`导入失败：${error.message}`, 'err');
    }
  }

  /* ---------- 渲染 ---------- */

  return (
    <div className="h-screen w-full flex flex-col overflow-hidden bg-background text-foreground">
      <Topbar
        zone={zone} stats={stats} warnCount={warnCount}
        ui={ui} setUi={setUi} hitCount={hitIds.size} crossHits={crossHits}
        openSettings={openSettings} exportBackup={exportBackup}
        onImport={(e) => { const f = e.target.files?.[0]; if (f) void importBackup(f); e.target.value = ''; }}
      />

      <main className="flex-1 min-h-0 flex">
        {/* 区域栏 */}
        <aside className={"border-r flex flex-col transition-all " + (zonesOpen ? "w-[230px]" : "w-[52px]")}>
          <div className="flex items-center justify-between px-3 py-2.5">
            {zonesOpen && <div className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">区域 / 柜体</div>}
            <Button size="sm" variant="ghost" className="h-7" onClick={() => setZonesOpen((v) => !v)}>{zonesOpen ? '«' : '»'}</Button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto px-2 flex flex-col gap-1.5">
            {zones.map((z, i) => (
              <button key={z.id} type="button"
                onClick={() => { store.setActiveZone(z.id); store.emit('zone', { action: 'switch', id: z.id }); }}
                className={"flex items-center gap-2 rounded-md border px-2 py-2 text-left text-xs transition-colors " +
                  (z.id === store.state.activeZoneId ? "border-primary/60 bg-primary/10" : "border-border bg-muted/20 hover:bg-muted/40")}>
                <span className={"h-7 w-7 rounded-md grid place-items-center font-bold text-[11px] flex-none " + (z.id === store.state.activeZoneId ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground")}>
                  {z.name.slice(0, 1)}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block truncate">{z.name}</span>
                  <span className="block font-mono text-[10px] text-muted-foreground">{totalOf(z.rowCounts)} 格 · 已用 {Object.keys(z.cells).length}</span>
                </span>
                {zonesOpen && (
                  <span className="flex gap-0.5 opacity-0 group-hover:opacity-100">
                    <Button size="icon" variant="ghost" className="h-5 w-5 text-[10px]" disabled={i === 0} onClick={(e) => { e.stopPropagation(); moveZone(z.id, -1); }}>↑</Button>
                    <Button size="icon" variant="ghost" className="h-5 w-5 text-[10px]" disabled={i === zones.length - 1} onClick={(e) => { e.stopPropagation(); moveZone(z.id, 1); }}>↓</Button>
                    <Button size="icon" variant="ghost" className="h-5 w-5 text-[10px]" onClick={(e) => { e.stopPropagation(); store.setActiveZone(z.id); openSettings(); }}>✎</Button>
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="px-2 pb-2.5 flex flex-col gap-1.5">
            <Button className="w-full h-8" onClick={addZone}>＋ 新增区域</Button>
            <div className="text-center text-[9.5px] text-muted-foreground">区域间数据独立保存</div>
          </div>
        </aside>

        {/* 主网格 */}
        <section className="flex-1 min-h-0 flex flex-col p-3">
          <Grid store={store} ui={ui} setUi={setUi} hitIds={hitIds} onCell={openDrawer} />
          <div className="flex items-center gap-3.5 pt-2 text-[11px] text-muted-foreground">
            {['empty', 'normal', 'low', 'out'].map((s) => (
              <span key={s} className="flex items-center gap-1.5"><span className={"h-2 w-2 rounded-full " + STATUS_DOT[s]} />{STATUS_TEXT[s]}</span>
            ))}
          </div>
        </section>
      </main>

      {/* 底部状态栏 */}
      <footer className="flex items-center gap-3.5 px-4 h-7 border-t bg-muted/40">
        <span className="font-mono text-[10.5px] text-muted-foreground truncate">{zone.name}</span>
        <Separator orientation="vertical" className="h-3" />
        <span className="font-mono text-[10.5px] text-muted-foreground">格 {stats.total}</span>
        <Separator orientation="vertical" className="h-3" />
        <span className="font-mono text-[10.5px] text-muted-foreground">已用 {stats.used}</span>
        <Separator orientation="vertical" className="h-3" />
        <span className={"font-mono text-[10.5px] " + (warnCount > 0 ? "text-warning" : "text-muted-foreground")}>预警 {warnCount}</span>
        <div className="flex-1" />
        <span className="font-mono text-[9px] border rounded px-1.5 text-muted-foreground">v3</span>
      </footer>

      {/* 格位详情抽屉 */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent className="w-[400px] p-0 gap-0">
          <div className="p-4 pb-3 border-b flex items-center justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">格位详情</div>
              <div className="text-lg font-semibold font-mono">{zone.name} · {ui.currentId}</div>
            </div>
            <Badge variant="outline" className={draft && store.getCell(ui.currentId) ? 'border-success/40 text-success' : 'text-muted-foreground'}>
              {draft && store.getCell(ui.currentId) ? STATUS_TEXT[cellStatus(store.getCell(ui.currentId))] : '空位'}
            </Badge>
          </div>
          {draft && (
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3.5">
              <div>
                <Label className="mb-1.5 block text-[11.5px] text-muted-foreground">物料名称</Label>
                <Input value={draft.name} maxLength={40} placeholder="如：贴片电阻 0603" onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="mb-1.5 block text-[11.5px] text-muted-foreground">类别</Label>
                  <Select value={draft.category} onValueChange={(v) => setDraft({ ...draft, category: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="mb-1.5 block text-[11.5px] text-muted-foreground">型号 / 规格</Label>
                  <Input value={draft.model} maxLength={40} placeholder="如：10kΩ ±1%" onChange={(e) => setDraft({ ...draft, model: e.target.value })} />
                </div>
              </div>
              <div>
                <Label className="mb-1.5 block text-[11.5px] text-muted-foreground">库存数量</Label>
                <div className="flex items-center gap-2">
                  <Button variant="outline" className="h-10 w-11 text-lg" onClick={() => stepQty(-1)}>−</Button>
                  <Input className="h-10 text-center font-mono text-base font-bold" value={draft.qty} inputMode="decimal" onChange={(e) => setDraft({ ...draft, qty: e.target.value })} />
                  <Button variant="outline" className="h-10 w-11 text-lg" onClick={() => stepQty(1)}>+</Button>
                  <Input className="w-[68px] h-10 text-center" value={draft.unit} maxLength={6} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} />
                </div>
                <div className="mt-1 text-[10.5px] text-muted-foreground">点 − / + 立即出入库；也可直接输入数量后保存</div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="mb-1.5 block text-[11.5px] text-muted-foreground">最低预警数量</Label>
                  <Input type="number" min="0" className="h-9" value={draft.minQty} onChange={(e) => setDraft({ ...draft, minQty: e.target.value })} />
                </div>
                <div>
                  <Label className="mb-1.5 block text-[11.5px] text-muted-foreground">最后更新</Label>
                  <div className="h-9 px-3 rounded-md border border-dashed grid items-center font-mono text-[11px] text-muted-foreground">
                    {store.getCell(ui.currentId) ? fmtTime(store.getCell(ui.currentId).updatedAt) : '尚未入库'}
                  </div>
                </div>
              </div>
              <div>
                <Label className="mb-1.5 block text-[11.5px] text-muted-foreground">存放备注</Label>
                <Input value={draft.note} maxLength={120} placeholder="如：第 3 层左侧" onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
              </div>
            </div>
          )}
          <div className="p-4 border-t flex gap-2.5">
            <Button variant="outline" className="flex-1 h-10 text-destructive hover:text-destructive border-destructive/40" onClick={clearCell}>清空此格</Button>
            <Button className="flex-[1.6] h-10" onClick={saveForm}>保存物料</Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* 设置模态 */}
      {sDraft && (
        <SettingsDialog
          open={settingsOpen} onOpenChange={setSettingsOpen}
          draft={sDraft} setDraft={setSDraft} zoneName={zone.name}
          canDelete={zones.length > 1}
          copyZone={copyZone} deleteZone={deleteZone} applySettings={applySettings}
        />
      )}

      {/* Toast */}
      {toastMsg && (
        <div className="fixed bottom-12 left-1/2 -translate-x-1/2 z-50">
          <Badge variant={toastMsg.kind === 'err' ? 'destructive' : toastMsg.kind === 'warn' ? 'warning' : 'success'} className="px-3 py-1.5 shadow-lg">
            {toastMsg.text}
          </Badge>
        </div>
      )}
    </div>
  );
}

/* ================= 顶栏 ================= */

function Topbar({ zone, stats, warnCount, ui, setUi, hitCount, crossHits, openSettings, exportBackup, onImport }) {
  const fileRef = useRef(null);
  return (
    <header className="flex items-center gap-3 px-4 h-[52px] border-b bg-background/85 backdrop-blur flex-none">
      <div className="flex items-center gap-2.5 mr-1">
        <div className="h-8 w-8 rounded-lg grid place-items-center shadow-sm"
          style={{ background: 'linear-gradient(135deg, #6ea1ff, #4a7df0, #8b5cf6)', boxShadow: '0 2px 10px rgba(91,140,255,.35)' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2.5" opacity=".6" /><path d="M3 9h18M3 15h18M9 3v18M15 3v18" opacity=".5" /></svg>
        </div>
        <a href="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">← 工具目录</a>
      </div>
      <div className="leading-tight min-w-0">
        <div className="text-sm font-semibold truncate">{zone.name}</div>
        <div className="font-mono text-[10px] text-muted-foreground truncate">{zone.rowCounts.length} × {Math.max(...zone.rowCounts)} · 共 {totalOf(zone.rowCounts)} 格{zone.location ? ` · ${zone.location}` : ''}</div>
      </div>
      <div className="flex items-center gap-3.5 px-3 border-x text-xs flex-none">
        <span className="flex items-baseline gap-1 text-muted-foreground">格数<b className="font-mono text-sm text-foreground">{stats.total}</b></span>
        <span className="flex items-baseline gap-1 text-muted-foreground">已用<b className="font-mono text-sm text-foreground">{stats.used}</b></span>
        <span className={"flex items-baseline gap-1 " + (warnCount > 0 ? 'text-warning' : 'text-muted-foreground')}>预警<b className="font-mono text-sm">{warnCount}</b></span>
      </div>
      <div className="flex-1" />
      <Input className="w-[170px] h-8 text-xs" placeholder="搜索名称 / 型号…" value={ui.query}
        onChange={(e) => setUi((s) => ({ ...s, query: e.target.value }))} />
      <label className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground cursor-pointer select-none">
        <Checkbox checked={ui.cross} onCheckedChange={(v) => setUi((s) => ({ ...s, cross: !!v }))} />
        跨区
      </label>
      {hitCount > 0 && <span className="font-mono text-[10.5px] text-primary">{hitCount} 命中</span>}
      {crossHits.length > 0 && (
        <span className="font-mono text-[10.5px] text-primary">跨 {storeZonesCount(crossHits)} 区 {crossHits.length} 项</span>
      )}
      <Button size="sm" variant="ghost" className="h-8" title="柜体布局设置" onClick={openSettings}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3.2" /><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6" /></svg>
      </Button>
      <Button size="sm" variant="ghost" className="h-8" title="导出 JSON 备份" onClick={exportBackup}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M12 3v12M7.5 10.5L12 15l4.5-4.5" /><path d="M4 17v2.5A1.5 1.5 0 0 0 5.5 21h13A1.5 1.5 0 0 0 20 19.5V17" /></svg>
      </Button>
      <Button size="sm" variant="ghost" className="h-8" title="从 JSON 备份恢复" onClick={() => fileRef.current?.click()}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M12 21V9M7.5 13.5L12 9l4.5 4.5" /><path d="M4 7V5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5V7" /></svg>
      </Button>
      <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={onImport} />
    </header>
  );
}

function storeZonesCount(hits) {
  return new Set(hits.map((h) => h.zoneId)).size;
}

/* ================= 网格 ================= */

function Grid({ store, ui, setUi, hitIds, onCell }) {
  const wrapRef = useRef(null);
  const [size, setSize] = useState({ cellW: 96, cellH: 88, band: 'md' });
  const zone = store.zone;
  const maxCols = Math.max(1, zone.rowCounts.reduce((m, n) => Math.max(m, n), 0));

  useEffect(() => {
    function compute() {
      const el = wrapRef.current;
      if (!el) return;
      const availW = el.clientWidth - 36;
      const cols = maxCols;
      const rows = zone.rowCounts.length;
      const cellW = Math.min(120, Math.max(76, Math.floor((availW - 28 - (cols + 1) * 8) / cols)));
      const cellH = Math.max(56, Math.floor(cellW * 1.1));
      const band = cellW >= 108 ? 'lg' : cellW >= 88 ? 'md' : cellW >= 64 ? 'sm' : 'xs';
      setSize({ cellW, cellH, band });
    }
    compute();
    const ro = new ResizeObserver(compute);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [maxCols, zone.rowCounts.length, zone.id]);

  return (
    <div ref={wrapRef} className="flex-1 min-h-0 overflow-auto rounded-lg border bg-muted/10 p-1">
      <div className="inline-grid gap-1.5"
        style={{ gridTemplateColumns: `28px repeat(${maxCols}, ${size.cellW}px)`, gridAutoRows: `${size.cellH}px` }}>
        {/* 角标 */}
        <div className="sticky top-0 left-0 z-10 rounded bg-muted/60" />
        {/* 列标 */}
        {Array.from({ length: maxCols }, (_, c) => (
          <div key={`c${c}`} className={"sticky top-0 z-10 rounded grid place-items-center font-mono text-[11px] font-bold text-muted-foreground bg-muted/80 " + (ui.currentId && Number(ui.currentId.split('-')[1]) === c + 1 ? 'text-primary' : '')}>
            {c + 1}
          </div>
        ))}
        {zone.rowCounts.map((n, r) => (
          <React.Fragment key={`r${r}`}>
            {/* 行标 */}
            <div className={"sticky left-0 z-10 rounded grid place-items-center font-mono text-[11px] font-bold text-muted-foreground bg-muted/80 " + (ui.currentId && Number(ui.currentId.split('-')[0]) === r + 1 ? 'text-primary' : '')}>
              {rowLabel(r)}
            </div>
            {Array.from({ length: maxCols }, (_, c) => {
              if (c >= n) return <div key={`g${r}-${c}`} />;
              const id = labelAt(r, c);
              const cell = store.getCell(id);
              return <CellCard key={id} id={id} cell={cell} size={size} hit={hitIds.has(id)} current={ui.currentId === id} onCell={onCell} />;
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function CellCard({ id, cell, size, hit, current, onCell }) {
  const status = cellStatus(cell);
  const qty = Number(cell?.qty) || 0;
  const ratio = cell ? Math.round(Math.min(1, qty / ((Number(cell.minQty) > 0 ? Number(cell.minQty) : Math.max(qty, 1)) * 2)) * 100) : 0;
  const stateText = status === 'low' ? '低库存' : status === 'out' ? '缺料' : '';

  return (
    <button type="button" className={"cell-card px-2 py-1.5 text-left state-" + status + (hit ? ' border-primary ring-1 ring-primary' : '') + (current ? ' border-primary ring-2 ring-primary/60' : '')}
      style={{ gridColumn: 'auto', width: size.cellW, height: size.cellH }}
      onClick={() => onCell(id)}>
      <span className="cell-bar" aria-hidden="true" />
      <span className="flex items-center justify-between gap-1">
        <span className="font-mono text-[9.5px] font-bold text-muted-foreground">{id}</span>
        {cell && size.band !== 'xs' && <span className="text-[8.5px] text-muted-foreground truncate max-w-[55%]">{cell.category}</span>}
      </span>
      {cell ? (
        <>
          {size.band !== 'xs' && (
            <span className="mt-1 block font-medium text-[11.5px] leading-tight line-clamp-2">{cell.name}</span>
          )}
          {size.band === 'lg' && <span className="block text-[9px] text-muted-foreground truncate">{cell.model || '—'}</span>}
          <span className="mt-auto flex items-end justify-between gap-1">
            <span className={"font-mono text-[15px] font-bold " + (status === 'out' ? 'text-destructive' : status === 'low' ? 'text-warning' : 'text-foreground')}>
              {fmtNum(qty)}<em className="ml-0.5 not-italic text-[8.5px] font-medium text-muted-foreground">{cell.unit}</em>
            </span>
            {stateText && size.band !== 'xs' && <span className={"text-[8.5px] font-bold " + (status === 'out' ? 'text-destructive' : 'text-warning')}>{stateText}</span>}
          </span>
          {size.band !== 'sm' && size.band !== 'xs' && (
            <span className="mt-1 block h-[3px] rounded-full bg-muted overflow-hidden"><i className="block h-full rounded-full bg-success" style={{ width: ratio + '%', background: status === 'out' ? 'var(--destructive)' : status === 'low' ? 'var(--warning)' : undefined }} /></span>
          )}
        </>
      ) : (
        <span className="flex-1 grid place-items-center text-[9.5px] text-muted-foreground gap-1">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          点击入库
        </span>
      )}
    </button>
  );
}

/* ================= 设置模态 ================= */

function SettingsDialog({ open, onOpenChange, draft, setDraft, zoneName, canDelete, copyZone, deleteZone, applySettings }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[620px]">
        <DialogHeader>
          <DialogTitle>柜体布局设置</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3.5">
          <div>
            <Label className="mb-1.5 block text-[11.5px] text-muted-foreground">区域名称</Label>
            <Input value={draft.name} maxLength={30} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="mb-1.5 block text-[11.5px] text-muted-foreground">位置说明</Label>
              <Input value={draft.location} maxLength={60} onChange={(e) => setDraft({ ...draft, location: e.target.value })} />
            </div>
            <div>
              <Label className="mb-1.5 block text-[11.5px] text-muted-foreground">区域备注</Label>
              <Input value={draft.note} maxLength={80} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
            </div>
          </div>
          <div className="flex gap-1.5">
            <Button variant={draft.layoutMode === 'total' ? 'secondary' : 'outline'} className="flex-1 h-9"
              onClick={() => setDraft({ ...draft, layoutMode: 'total' })}>按总格数自动排</Button>
            <Button variant={draft.layoutMode === 'custom' ? 'secondary' : 'outline'} className="flex-1 h-9"
              onClick={() => setDraft({ ...draft, layoutMode: 'custom' })}>逐排自定义</Button>
          </div>
          {draft.layoutMode === 'total' ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="mb-1.5 block text-[11.5px] text-muted-foreground">总格数（1–312）</Label>
                <Input type="number" min="1" max="312" value={draft.total ?? 24} onChange={(e) => setDraft({ ...draft, total: Number(e.target.value) })} />
              </div>
              <div>
                <Label className="mb-1.5 block text-[11.5px] text-muted-foreground">每排最多</Label>
                <Input type="number" min="1" max="15" value={draft.cols ?? 4} onChange={(e) => setDraft({ ...draft, cols: Number(e.target.value) })} />
              </div>
            </div>
          ) : (
            <div className="max-h-[170px] overflow-y-auto rounded-md border p-2 flex flex-col gap-1">
              {(draft.rowCounts || [4]).map((n, i) => (
                <div key={i} className="flex items-center gap-2 py-1 border-b border-dashed last:border-0">
                  <span className="h-6 w-6 rounded grid place-items-center font-mono text-[10px] font-bold bg-primary/10 text-primary">{String.fromCharCode(65 + i)}</span>
                  <span className="flex-1 text-xs text-muted-foreground">第 {i + 1} 排</span>
                  <Input type="number" min="1" max="15" className="w-[64px] h-7 text-center font-mono text-xs"
                    value={n} onChange={(e) => {
                      const rows = draft.rowCounts.slice();
                      rows[i] = Math.max(1, Math.min(15, Number(e.target.value) || 1));
                      setDraft({ ...draft, rowCounts: rows });
                    }} />
                </div>
              ))}
              <Button size="sm" variant="outline" className="mt-1.5 h-7"
                onClick={() => setDraft({ ...draft, rowCounts: [...(draft.rowCounts || []), 4] })}>＋ 添加一排</Button>
            </div>
          )}
        </div>
        <DialogFooter className="flex items-center justify-between sm:justify-between gap-2">
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={copyZone}>复制区域</Button>
            <Button variant="outline" size="sm" className="text-destructive hover:text-destructive border-destructive/40" onClick={deleteZone} disabled={!canDelete}>删除区域</Button>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
            <Button onClick={applySettings}>应用布局</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
