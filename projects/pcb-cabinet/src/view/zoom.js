/* ============================================================
   PCB 物料柜 · 紧凑网格缩放：等比格 + 固定间距 + 左上对齐
   - CSS 变量驱动（--cell-w/h、--cell-gap、data-band），不重建 DOM
   - 暴露 cleanup() 供 beforeunload 取消挂起的 rAF / timer（修复泄漏）
   ============================================================ */
import { els } from '../dom.js';
import { ui } from '../session.js';
import { maxColsOf } from '../utils.js';
import { ZOOM_KEY } from '../constants.js';

const ZOOM_BASE_W = 96;
const ZOOM_BASE_H = 88;
const ZOOM_MIN_W = 76;
const ZOOM_MIN_H = 56;
const ZOOM_MAX_W = 120;
const ZOOM_MAX_H = 110;
const FIXED_MIN_W = 76;
const FIXED_MAX_W = 220;
const ZOOM_MIN_SCALE = Math.max(ZOOM_MIN_W / ZOOM_BASE_W, ZOOM_MIN_H / ZOOM_BASE_H);
const ZOOM_MAX_SCALE = Math.min(ZOOM_MAX_W / ZOOM_BASE_W, ZOOM_MAX_H / ZOOM_BASE_H);

let zoomRaf = 0;
let zoomSettleTimer = 0;
let storeRef = null;   // 由 init 注入，供 schedule/settle/setZoomMode 复用

export function bindZoomStore(store) { storeRef = store; }

export function zoomBandOf(w, h) {
  if (w >= 108 && h >= 100) return 'lg';
  if (w >= 88 && h >= 78) return 'md';
  if (w >= 64 && h >= 52) return 'sm';
  return 'xs';
}

function setZoomTip(on) {
  if (!els.zoomHint) return;
  if (els.zoomHint.classList.contains('show') === on) return;
  els.zoomHint.textContent = on ? '已达最小可读尺寸，可滚动查看' : '';
  els.zoomHint.classList.toggle('show', on);
}

export function applyZoom(store) {
  store = store || storeRef;
  if (!store.state || !els.cabinetInner) return;
  const inner = els.cabinetInner;
  const grid = els.grid;
  const zone = store.zone;
  const cols = Math.max(1, maxColsOf(zone.rowCounts));
  const rows = Math.max(1, zone.rowCounts.length);
  const narrow = window.matchMedia('(max-width: 720px)').matches;
  const labelW = narrow ? 28 : 32;
  const labelH = 22;
  const gap = narrow ? 6 : 12;

  const cs = getComputedStyle(inner);
  const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
  const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
  const availW = Math.max(120, inner.clientWidth - padX);
  const availH = Math.max(120, inner.clientHeight - padY);

  let cellW; let cellH;

  if (ui.zoomMode === 'fixed') {
    cellW = Math.min(FIXED_MAX_W, Math.max(FIXED_MIN_W, Math.floor(ui.fixedW)));
    cellH = Math.max(ZOOM_MIN_H, Math.floor(cellW * ZOOM_BASE_H / ZOOM_BASE_W));
  } else {
    const fitW = (availW - labelW - cols * gap) / (cols * ZOOM_BASE_W);
    const fitH = (availH - labelH - rows * gap) / (rows * ZOOM_BASE_H);
    const s = Math.min(Math.max(ZOOM_MIN_SCALE, Math.min(fitW, fitH)), ZOOM_MAX_SCALE);
    cellW = Math.max(ZOOM_MIN_W, Math.floor(ZOOM_BASE_W * s));
    cellH = Math.max(ZOOM_MIN_H, Math.floor(ZOOM_BASE_H * s));
  }

  inner.style.setProperty('--cell-w', cellW + 'px');
  inner.style.setProperty('--cell-h', cellH + 'px');
  inner.style.setProperty('--cell-gap-x', gap + 'px');
  inner.style.setProperty('--cell-gap-y', gap + 'px');
  inner.style.setProperty('--rlabel', (narrow ? 28 : 32) + 'px');
  inner.style.setProperty('--clabel', labelH + 'px');
  grid.style.marginLeft = '0px';
  grid.style.marginTop = '0px';

  const needW = labelW + cols * cellW + cols * gap;
  const needH = labelH + rows * cellH + rows * gap;
  inner.dataset.band = zoomBandOf(cellW, cellH);
  setZoomTip(needW > availW + 1 || needH > availH + 1);
}

export function renderZoomCtl() {
  els.zoomCtl.dataset.mode = ui.zoomMode;
  els.zoomCtl.querySelectorAll('.zoom-btn').forEach(function (btn) {
    const on = btn.dataset.zoom === ui.zoomMode;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  els.zoomRange.value = String(ui.fixedW);
  els.zoomPct.textContent = ui.fixedW + 'px';
}

export function saveZoomPref() {
  try {
    localStorage.setItem(ZOOM_KEY, JSON.stringify({ mode: ui.zoomMode, w: ui.fixedW }));
  } catch (err) { /* 忽略写入失败 */ }
}

export function loadZoomPref() {
  try {
    const raw = localStorage.getItem(ZOOM_KEY);
    if (!raw) return;
    const pref = JSON.parse(raw) || {};
    const w = Number(pref.w);
    if (Number.isFinite(w)) ui.fixedW = Math.min(FIXED_MAX_W, Math.max(FIXED_MIN_W, Math.round(w)));
    if (pref.mode === 'fixed') {
      ui.zoomMode = 'fixed';
      return;
    }
    ui.zoomMode = 'fill';
    if (pref.mode !== 'fill') saveZoomPref();
  } catch (err) { /* 忽略损坏的本地设置 */ }
}

export function setZoomMode(mode) {
  if (mode !== 'fill' && mode !== 'fixed') return;
  ui.zoomMode = mode;
  saveZoomPref();
  renderZoomCtl();
  applyZoom();
}

export function scheduleApplyZoom() {
  if (zoomRaf) return;
  zoomRaf = requestAnimationFrame(function () {
    zoomRaf = 0;
    applyZoom();
  });
}

/* 窗口/侧边栏尺寸变化结束后再收敛一次 */
export function settleApplyZoom(store) {
  clearTimeout(zoomSettleTimer);
  zoomSettleTimer = setTimeout(function () { applyZoom(store); }, 340);
}

export function cleanupZoom() {
  if (zoomRaf) { cancelAnimationFrame(zoomRaf); zoomRaf = 0; }
  clearTimeout(zoomSettleTimer);
}
