/* ============================================================
   PCB 物料柜 · 视图层：统计 / 格门 / 区域 / 搜索渲染
   - renderGrid 全量重建仅用于「切换区域 / 布局结构变化 / 重置」
   - updateCell 单格增量更新，rAF 批量，300 格不卡顿
   ============================================================ */
import { els, ICON_PLUS } from '../dom.js';
import { ui } from '../session.js';
import {
  cellKey, labelAt, toCellKey, cellStatus, fmtNum, esc,
  totalOf, maxColsOf, isUniform
} from '../utils.js';
import { STATUS_TEXT } from '../constants.js';

const cellNodes = new Map();   // id → 当前 cell 节点

/* ---------------- 统计 ---------------- */
export function renderStats(store) {
  const st = store.stats();
  const warn = st.low + st.out;
  els.stats.innerHTML =
    '<div class="stat"><span class="stat-label">格数</span><b>' + st.total + '</b></div>' +
    '<div class="stat"><span class="stat-label">已用</span><b>' + st.used + '</b></div>' +
    '<div class="stat' + (warn ? ' warn' : '') + '"><span class="stat-label">预警</span><b>' + warn + '</b></div>';
}

/* ---------------- 单格节点 ---------------- */
export function cellNode(id, cell) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.dataset.id = id;
  const status = cellStatus(cell);
  btn.className = 'cell state-' + status;

  if (!cell) {
    btn.setAttribute('aria-label', id + ' 空位，点击入库');
    btn.title = id + ' · 空位';
    btn.innerHTML =
      '<span class="cell-top"><span class="cell-id">' + id + '</span><span class="cell-tag">空位</span></span>' +
      '<span class="cell-empty">' + ICON_PLUS + '<span>点击入库</span></span>' +
      '<span class="cell-level"><i style="width:0"></i></span>';
    return btn;
  }

  const qty = Number(cell.qty) || 0;
  const basis = Number(cell.minQty) > 0 ? Number(cell.minQty) : Math.max(qty, 1);
  const ratio = Math.round(Math.min(1, qty / (basis * 2)) * 100);
  const stateText = status === 'low' ? '低库存' : status === 'out' ? '缺料' : '';

  btn.setAttribute('aria-label',
    id + ' ' + cell.name + '，剩余 ' + fmtNum(qty) + ' ' + cell.unit + '，状态 ' + STATUS_TEXT[status] + '，点击查看');
  btn.title = id + ' · ' + cell.name +
    (cell.model ? ' · ' + cell.model : '') +
    ' · ' + fmtNum(qty) + ' ' + cell.unit + ' · ' + STATUS_TEXT[status];
  btn.innerHTML =
    '<span class="cell-top">' +
      '<span class="cell-id">' + id + '</span>' +
      '<span class="cell-tag">' + esc(cell.category) + '</span>' +
    '</span>' +
    '<span class="cell-main">' +
      '<span class="cell-name">' + esc(cell.name) + '</span>' +
      '<span class="cell-model">' + esc(cell.model || '—') + '</span>' +
    '</span>' +
    '<span class="cell-foot">' +
      '<span class="cell-qty">' + fmtNum(qty) + '<em>' + esc(cell.unit) + '</em></span>' +
      (stateText ? '<span class="cell-state-text">' + stateText + '</span>' : '') +
    '</span>' +
    '<span class="cell-level"><i style="width:' + ratio + '%"></i></span>';
  return btn;
}

/* ---------------- 网格全量重建 ---------------- */
export function renderGrid(store) {
  const zone = store.zone;
  const counts = zone.rowCounts;
  const maxCols = Math.max(1, maxColsOf(counts));
  els.grid.style.setProperty('--cols', maxCols);

  const frag = document.createDocumentFragment();
  cellNodes.clear();

  const corner = document.createElement('span');
  corner.className = 'axis-corner';
  corner.setAttribute('aria-hidden', 'true');
  frag.appendChild(corner);

  for (let c = 0; c < maxCols; c++) {
    const col = document.createElement('span');
    col.className = 'axis-label axis-col';
    col.dataset.col = String(c + 1);
    col.textContent = String(c + 1);
    frag.appendChild(col);
  }

  counts.forEach((n, r) => {
    const row = document.createElement('span');
    row.className = 'axis-label axis-row';
    row.dataset.row = String(r + 1);
    row.textContent = labelAt(r, 0).split('-')[0];
    frag.appendChild(row);
    for (let c = 0; c < maxCols; c++) {
      if (c < n) {
        const id = labelAt(r, c);
        const cell = store.getCell(id);
        const node = cellNode(id, cell);
        cellNodes.set(id, node);
        frag.appendChild(node);
      } else {
        const gap = document.createElement('span');
        gap.className = 'cell-gap';
        gap.setAttribute('aria-hidden', 'true');
        frag.appendChild(gap);
      }
    }
  });

  els.grid.innerHTML = '';
  els.grid.appendChild(frag);
  syncAxisHighlight();
}

/* ---------------- 单格增量更新（rAF 批量） ---------------- */
let pendingCells = new Set();
let rafScheduled = false;
let pendingStore = null;

export function updateCell(store, id) {
  pendingStore = store;
  pendingCells.add(id);
  if (rafScheduled) return;
  rafScheduled = true;
  requestAnimationFrame(() => {
    rafScheduled = false;
    flushCellUpdates(pendingStore);
  });
}

export function flushCellUpdates(store) {
  if (!store) return;
  pendingCells.forEach((id) => {
    const node = cellNodes.get(id);
    if (!node) return;
    const fresh = cellNode(id, store.getCell(id));
    fresh.classList.toggle('hit', node.classList.contains('hit'));
    fresh.classList.toggle('dim', node.classList.contains('dim'));
    fresh.classList.toggle('locate', node.classList.contains('locate'));
    node.replaceWith(fresh);
    cellNodes.set(id, fresh);
  });
  pendingCells.clear();
  syncAxisHighlight();
}

export function rebuildGrid(store) {
  pendingCells.clear();
  renderGrid(store);
}

/* ---------------- 轴高亮 ---------------- */
export function axisOf(id) {
  const key = toCellKey(id);
  if (!key) return null;
  const parts = key.split('-');
  return { row: parseInt(parts[0], 10), col: parseInt(parts[1], 10) };
}

export function cellPosText(id) {
  const pos = axisOf(id);
  return pos ? '（第 ' + pos.row + ' 行第 ' + pos.col + ' 列）' : '';
}

export function syncAxisHighlight() {
  const rows = new Set();
  const cols = new Set();
  els.grid.querySelectorAll('.cell.hit, .cell.locate').forEach(function (node) {
    const pos = axisOf(node.dataset.id);
    if (pos) { rows.add(pos.row); cols.add(pos.col); }
  });
  if (ui.currentId) {
    const pos = axisOf(ui.currentId);
    if (pos) { rows.add(pos.row); cols.add(pos.col); }
  }
  els.grid.querySelectorAll('.axis-row').forEach(function (node) {
    node.classList.toggle('hit', rows.has(parseInt(node.dataset.row, 10)));
  });
  els.grid.querySelectorAll('.axis-col').forEach(function (node) {
    node.classList.toggle('hit', cols.has(parseInt(node.dataset.col, 10)));
  });
}

/* ---------------- 区域侧栏 ---------------- */
export function renderZones(store) {
  els.zonesList.innerHTML = store.state.zones.map((zone, i) => {
    const total = totalOf(zone.rowCounts);
    const used = Object.keys(zone.cells).length;
    const active = zone.id === store.state.activeZoneId;
    return '<div class="zone-item' + (active ? ' active' : '') + '" data-zone="' + esc(zone.id) +
      '" role="option" tabindex="0" aria-selected="' + (active ? 'true' : 'false') +
      '" title="' + esc(zone.name) + '">' +
      '<span class="zone-mark">' + esc(zone.name.slice(0, 1) || '柜') + '</span>' +
      '<span class="zone-body">' +
        '<span class="zone-name">' + esc(zone.name) + '</span>' +
        '<span class="zone-meta">' + total + ' 格 · 已用 ' + used + '</span>' +
      '</span>' +
      '<span class="zone-tools">' +
        '<button type="button" class="zone-act" data-act="up" aria-label="上移" ' + (i ? '' : 'disabled') + '>↑</button>' +
        '<button type="button" class="zone-act" data-act="down" aria-label="下移" ' + (i < store.state.zones.length - 1 ? '' : 'disabled') + '>↓</button>' +
        '<button type="button" class="zone-act" data-act="edit" aria-label="编辑区域">✎</button>' +
      '</span>' +
    '</div>';
  }).join('');
}

/* ---------------- 搜索下拉 ---------------- */
export function hideSearchResults() {
  els.searchResults.classList.remove('show');
  els.searchResults.innerHTML = '';
}

export function renderSearchResults(hits) {
  if (!hits.length) {
    hideSearchResults();
    return;
  }
  els.searchResults.innerHTML = hits.slice(0, 40).map((h) =>
    '<button type="button" class="search-result" data-zone="' + esc(h.zoneId) + '" data-id="' + esc(h.id) + '">' +
      '<span class="sr-zone">' + esc(h.zoneName) + '</span>' +
      '<span class="sr-id">' + esc(h.id) + '</span>' +
      '<span class="sr-name">' + esc(h.cell.name) + '</span>' +
      '<span class="sr-qty">' + fmtNum(h.cell.qty) + ' ' + esc(h.cell.unit) + '</span>' +
    '</button>').join('');
  els.searchResults.classList.add('show');
}

/* ---------------- 顶栏 chrome ---------------- */
export function renderChrome(store) {
  const zone = store.zone;
  const counts = zone.rowCounts;
  const total = totalOf(counts);
  const maxCols = Math.max(1, maxColsOf(counts));
  els.zoneTitle.textContent = zone.name;
  document.title = zone.name + ' · 物料柜管理';
  els.brandMeta.textContent =
    (isUniform(counts)
      ? counts.length + ' × ' + maxCols
      : counts.length + ' 排不等宽 · 最宽 ' + maxCols + ' 格') +
    ' · 共 ' + total + ' 格' + (zone.location ? ' · ' + zone.location : '');
  els.zoneEmpty.hidden = Object.keys(zone.cells).length > 0;
}
