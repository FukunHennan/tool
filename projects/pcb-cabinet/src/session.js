/* ============================================================
   PCB 物料柜 · 共享 UI 状态（显式单一来源）
   View / Actions / zoom 都引用同一对象，不再跨模块隐式依赖
   ============================================================ */

export const ui = {
  currentId: null,        // 当前打开抽屉的格位（Actions 驱动，View 用于轴高亮）
  query: '',              // 当前搜索串
  settingsOpen: false,
  zonesCollapsed: false,
  zonesDrawerOpen: false,
  zoomMode: 'fill',       // 'fill' | 'fixed'
  fixedW: 120
};
