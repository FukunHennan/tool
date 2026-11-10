/* ============================================================
   PCB 物料柜 · DOM 引用收集（由 main.js 在 init 后调用一次）
   ============================================================ */

export const els = {};

export function collectEls() {
  const q = (id) => document.getElementById(id);
  Object.assign(els, {
    grid: q('grid'), zoneEmpty: q('zoneEmpty'), btnZoneEmptyCta: q('btnZoneEmptyCta'),
    stats: q('stats'), zoneTitle: q('zoneTitle'), brandMeta: q('brandMeta'),
    zonesPanel: q('zonesPanel'), zonesList: q('zonesList'), zonesScrim: q('zonesScrim'),
    btnToggleZones: q('btnToggleZones'), btnAddZone: q('btnAddZone'),
    crossSearch: q('crossSearch'), crossToggleWrap: q('crossToggleWrap'),
    searchResults: q('searchResults'), searchHint: q('searchHint'),
    settingsTitle: q('settingsTitle'), zoneDanger: q('zoneDanger'),
    btnCopyZone: q('btnCopyZone'), btnDeleteZone: q('btnDeleteZone'),
    sNote: q('s-note'), sLocation: q('s-location'),
    cabinetInner: q('cabinetInner'), zoomCtl: q('zoomCtl'), zoomRange: q('zoomRange'),
    zoomPct: q('zoomPct'), zoomHint: q('zoomHint'),
    search: q('search'), clearSearch: q('clearSearch'),
    btnSettings: q('btnSettings'), btnExport: q('btnExport'), btnImport: q('btnImport'),
    fileInput: q('fileInput'), scrim: q('scrim'),
    drawer: q('drawer'), drawerTitle: q('drawerTitle'), drawerStatus: q('drawerStatus'),
    btnCloseDrawer: q('btnCloseDrawer'), cellForm: q('cellForm'),
    fName: q('f-name'), fCategory: q('f-category'), fModel: q('f-model'),
    fQty: q('f-qty'), fUnit: q('f-unit'), fMin: q('f-min'), fTime: q('f-time'),
    fNote: q('f-note'), btnMinus: q('btnMinus'), btnPlus: q('btnPlus'),
    btnClear: q('btnClear'), btnSave: q('btnSave'),
    settingsMask: q('settingsMask'), settingsForm: q('settingsForm'),
    btnCloseSettings: q('btnCloseSettings'), btnCancelSettings: q('btnCancelSettings'),
    btnApplySettings: q('btnApplySettings'),
    sName: q('s-name'), sTotal: q('s-total'), sMax: q('s-max'), totalHint: q('totalHint'),
    segBtns: document.querySelectorAll('.seg-btn'),
    panelTotal: q('panelTotal'), panelCustom: q('panelCustom'),
    rowEditor: q('rowEditor'), btnAddRow: q('btnAddRow'),
    previewGrid: q('previewGrid'), previewMeta: q('previewMeta'), previewNote: q('previewNote'),
    toasts: q('toasts')
  });
}

export const ICON_PLUS =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
