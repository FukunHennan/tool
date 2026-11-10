const fs = require('node:fs');
const path = require('node:path');
const file = path.resolve('index.html');
const html = fs.readFileSync(file, 'utf8');
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const body = html.match(/<body>([\s\S]*?)<script>/)[1];
const out = path.resolve('src');
fs.mkdirSync(path.join(out, 'actions'), { recursive: true });
fs.mkdirSync(path.join(out, 'view'), { recursive: true });
fs.mkdirSync(path.join(out, 'style'), { recursive: true });

const root = css.match(/:root\{[\s\S]*?\n  \}/)[0];
fs.writeFileSync(path.join(out, 'style', 'tokens.css'), root + '\n');
fs.writeFileSync(path.join(out, 'style', 'app.css'), css.replace(root, ''));
fs.writeFileSync(path.join(out, 'style.css'), '@import "./style/tokens.css";\n@import "./style/app.css";\n');

const stripped = script.replace(/^\s*\/\*[^]*?\*\/\s*\(function \(\) \{\s*'use strict';/, '');
const actionStart = stripped.indexOf('  /* ---------------- 7. 抽屉');
const eventStart = stripped.indexOf('  /* ---------------- 11. 事件绑定 ---------------- */');
const initStart = stripped.indexOf('  /* ---------------- 12. 初始化 ---------------- */');
if (actionStart < 0 || eventStart < 0 || initStart < 0) throw new Error('section boundaries not found');
let actions = stripped.slice(actionStart, eventStart).replace(/\n\s*refresh\(\);/g, '');
const events = stripped.slice(eventStart, initStart);
let init = stripped.slice(initStart);
init = init.replace(/\}\)\(\);\s*\}\)\(\);\s*$/, '');
init = init.replace(/\(function init\(\) \{/, 'function init() {').replace(/\n\s*\}\)\(\);\s*$/, '\n}\ninit();');

let search = stripped.slice(stripped.indexOf('  function hideSearchResults()'), stripped.indexOf('  function renderZones()'));
search = search.replace(/^  /gm, '');
search = search.replace('const nodes = els.grid.querySelectorAll', 'const nodes = els.grid.querySelectorAll');

const actionModule = `/* Actions extracted from the original single-file application. */\nimport { els } from '../dom.js';\nimport { ui } from '../session.js';\nimport { CATEGORIES, STATUS_TEXT, ROWS_MAX, COLS_MAX, TOTAL_MAX, ZOOM_KEY } from '../constants.js';\nimport { clampInt, round2, parseQty, fmtNum, pad2, fmtTime, rowLabel, labelAt, totalOf, maxColsOf, isUniform, distribute, autoRowCounts, cellStatus, esc } from '../utils.js';\nimport { Store as StoreClass, validateBackup } from '../store/store.js';\nimport { cellPosText, syncAxisHighlight, renderStats, renderGrid, renderZones, renderChrome, renderSearchResults, hideSearchResults, rebuildGrid, updateCell } from '../view/render.js';\nimport { applyZoom, bindZoomStore, loadZoomPref, renderZoomCtl, saveZoomPref, setZoomMode, scheduleApplyZoom, settleApplyZoom, cleanupZoom } from '../view/zoom.js';\n\nexport const Store = new StoreClass();\nlet draft = null;\n\nexport function toast(message, kind) {\n  const node = document.createElement('div');\n  node.className = 'toast' + (kind ? ' ' + kind : '');\n  node.textContent = message;\n  els.toasts.appendChild(node);\n  setTimeout(() => {\n    node.style.transition = 'opacity .25s, transform .25s';\n    node.style.opacity = '0';\n    node.style.transform = 'translateY(6px)';\n    setTimeout(() => node.remove(), 260);\n  }, 2600);\n}\n\nexport function updateBodyLock() {\n  const locked = els.drawer.classList.contains('open') || els.settingsMask.classList.contains('show');\n  document.body.classList.toggle('locked', locked);\n}\n\nfunction refresh() {\n  renderChrome(Store);\n  renderStats(Store);\n  rebuildGrid(Store);\n  renderZones(Store);\n  refreshSearch();\n  applyZoom(Store);\n}\n\n${search}\n\nexport function refreshView() { refresh(); }\n\n${actions}\n\n${events}\n\n${init}\n`;
fs.writeFileSync(path.join(out, 'main.js'), actionModule);
fs.writeFileSync(file, html
  .replace(/<style>[\s\S]*?<\/style>/, '<link rel="stylesheet" href="/src/style.css">')
  .replace(/<script>[\s\S]*?<\/script>/, '<script type="module" src="/src/main.js"></script>'));
fs.rmSync(path.resolve('scripts'), { recursive: true, force: true });
console.log('Extracted CSS, markup, and action/event modules.');
