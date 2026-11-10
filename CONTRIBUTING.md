# 参与约定

## 目录职责

```text
projects/<tool>/    每个工具自包含：前端、数据模型、测试、README
docs/通用/          跨工具的需求与决策（平台层）
docs/reference/     旧版本研究资料，只读参考，不参与构建
portal/             平台入口页（工具目录）
serve.py            单端口网关，把各工具挂到同一 origin
```

## 新增一个工具（三步）

1. 建 `projects/<name>/`，保证它能**独立运行**，并带上自己的 `README.md` 和测试
2. 在 `serve.py` 的 `TOOLS` 里加一行 `'/name/': 目录`
3. 在 `portal/index.html` 加一张卡片

工具之间不互相 import；共性等出现第三次再抽。

## 提交规范

- 用 Conventional Commits 前缀：`feat` / `fix` / `docs` / `chore` / `test` / `refactor`
- **一次提交一件事**：删除、重命名、重构单独成提交，方便 review 和回滚
- 提交信息写清"为什么"—— diff 里能看到的不要复述，看不到的动机要写出来

## 分支与合并

- `main` 始终保持可用（测试通过）
- 功能用 `feature/<topic>`，修复用 `fix/<topic>`，通过 PR 合并
- 合并后删掉分支，避免分支堆积

## 测试要求

每个工具都必须有能跑的测试。**纯逻辑与 DOM / 浏览器 API 分离**（参考 `projects/serial/web/format.js`），这样逻辑能被 `node --test` 覆盖，不必依赖浏览器。

提交前本地跑一遍：

```powershell
cd projects\travel      ; python -m unittest discover -s tests -v ; node --test tests/storage.test.cjs
cd projects\pcb-cabinet ; npm test
cd projects\serial\web  ; node --test
```

CI（`.github/workflows/tests.yml`）跑的是同样三项，PR 必须绿。

## 不要提交

- 本地数据：`*.sqlite3`、`data/`
- 依赖与产物：`node_modules/`、`pcb-cabinet/dist/`、`target/`
- 任何凭证：高德 Key 只存在浏览器 `localStorage`，不进仓库
- 日志文件

截图是有意保留的（`projects/pcb-cabinet/screenshots/`），用于记录界面状态。

## 文档

- 平台层需求写在 `docs/通用/`
- 每个工具的细节写在该工具自己的 `README.md`
- 重要的取舍写成短 ADR，放 `docs/通用/`，文件名 `NNNN-主题.md`
