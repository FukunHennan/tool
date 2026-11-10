# 工具平台

一个入口，多个相对独立的工具。

原则：先把单个工具做真实、可用，平台能力等共性出现后再提炼（见 [docs/通用/01-需求理解.md](docs/通用/01-需求理解.md)）。

## 工具

| 工具 | 目录 | 说明 |
| --- | --- | --- |
| PCB 物料柜 | `projects/pcb-cabinet/` | 区域 / 柜体格位可视化管理，物料计数、低库存与缺料预警。单文件前端 + Vite/Vitest 模块源码 |
| 串口助手 | `projects/serial/web/` | 浏览器串口调试（Web Serial）：参数配置、HEX / 文本收发、行尾追加、日志搜索与统计 |
| 一起出发 · 出游地图 | `projects/travel/` | 景点、住处、同伴位置放在同一张地图上，集合时间与路线估算。原生前端 + Python/SQLite 后端 |

## 启动

### 统一入口（推荐）

```powershell
python serve.py            # 默认 8765，可用 --port 覆盖
```

| 地址 | 内容 |
| --- | --- |
| http://127.0.0.1:8765/ | 工具目录（平台入口页） |
| http://127.0.0.1:8765/pcb/ | PCB 物料柜 |
| http://127.0.0.1:8765/serial/ | 串口助手说明页（程序本身需本机运行） |
| http://127.0.0.1:8765/travel/ | 出游地图，API 仍在根路径 `/api/*` |

单端口、单 origin：无需 CORS，`localStorage` 在工具间共享（键名带工具前缀加以区分）。

串口助手走浏览器 **Web Serial API**，需要 Chrome / Edge 89+ 并通过 `localhost` 或 HTTPS 访问（默认的 `http://127.0.0.1:8765` 满足安全上下文要求）。首次连接点「选择串口…」授权后即可读写；浏览器不暴露 `COM3` 这类端口名，界面只显示 USB VID:PID。

### 单独启动某个工具

```powershell
cd projects\pcb-cabinet ; npm install ; npm run dev    # http://localhost:5173/
cd projects\travel      ; python server.py             # http://127.0.0.1:8765/
```

## 测试

```powershell
cd projects\travel      ; python -m unittest discover -s tests -v ; node --test tests/storage.test.cjs
cd projects\pcb-cabinet ; npm test
cd projects\serial\web  ; node --test
```

## 约定

- 服务只监听 `127.0.0.1`，数据与凭证留在本机，不上传。
- 每个工具自包含（前端、数据模型、测试都在自己的目录里），可独立运行。
- `localStorage` 键统一带工具前缀：`pcb-material-cabinet.*`、`serial-*`、`travel-*`。
- 纯逻辑与 DOM 分离：`format.js` 这类模块不碰浏览器 API，可直接用 `node --test` 覆盖。
- 新增工具：放进 `projects/`，在 `serve.py` 的 `TOOLS` 里加一行挂载，并在 `portal/index.html` 加一张卡片。
