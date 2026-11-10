/* ============================================================
   PCB 物料柜 · 常量
   ============================================================ */
export const APP_ID = 'pcb-material-cabinet';
export const VERSION = 2;
export const STORAGE_KEY = 'pcb-material-cabinet.v1';
export const ZOOM_KEY = 'pcb-material-cabinet.zoom.v1';

export const ROWS_MAX = 26;
export const COLS_MAX = 15;
export const TOTAL_MAX = ROWS_MAX * COLS_MAX;

export const CATEGORIES = ['电阻', '电容', '电感', '连接器', 'IC', '二极管', '晶体管', '晶振', '其他'];
export const STATUS_TEXT = { empty: '空位', normal: '正常', low: '低库存', out: '缺料' };

/* 坐标制式：行列全部用数字，格位编号为「行-列」，如第 3 行第 4 列 → 3-4 */
export const COORD_VERSION = 2;
export const LEGACY_KEY_RE = /^([A-Z])(\d{1,2})$/;   // 旧版：字母行 + 数字列（A1 / C4）
export const CELL_KEY_RE = /^(\d{1,2})-(\d{1,2})$/;   // 新版：数字行 + 连字符 + 数字列
