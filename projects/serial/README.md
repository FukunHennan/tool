# 串口助手（Web Serial）

浏览器里的串口调试工具，作为平台工具运行在 `/serial/` 下。原生 HTML/CSS/JS，没有构建步骤，没有后端。

## 运行

```powershell
# 仓库根目录
python serve.py            # → http://127.0.0.1:8765/serial/
```

要求：**Chrome / Edge 89+**，并且通过 `localhost` 或 HTTPS 访问 —— Web Serial 需要安全上下文，`http://127.0.0.1:8765` 满足。

首次使用时点左侧「选择串口…」授权设备，之后浏览器会记住该端口。

## 结构

```text
web/
├── index.html          三栏布局：配置 / 日志 / 行尾追加 + 底部发送区
├── style.css           深色主题，与平台其他工具同一套色板
├── app.js              Web Serial 接线、日志渲染、快捷键
├── format.js           纯逻辑：十六进制解析、日志格式化、环形缓冲、过滤统计
├── tests/format.test.js  13 个 node 单测（不依赖浏览器）
└── package.json        type: module，让 node 直接跑 ESM 测试
```

`format.js` 刻意不碰 DOM 和 `navigator.serial`，所以能被 `node --test` 完整覆盖；`app.js` 只负责接线。

## 功能

| 区域 | 内容 |
| --- | --- |
| 串口配置 | 端口授权、已授权端口自动恢复、波特率 300–4,000,000、数据位 5–8、校验 N/E/O、停止位 1/2、流控 无/硬件/软件；连接后整块锁定 |
| 消息日志 | `[14:32:45.123] ◄ RX (    5 B) 48 65 6C`，RX 青 / TX 绿，HEX⇄TEXT、环形 10000 条、搜索、自动滚动、复制 |
| 行尾追加 | 无 / `\n` / `\r` / `\r\n` / `\n\r` |
| 发送 | ASCII 或 HEX，`↑↓` 切换，`Enter` 发送，`Esc` 清空，TX/RX 字节数与条数统计 |

配置持久化在 `localStorage` 的 `serial-settings.v1`，键名带工具前缀。

## 快捷键

| 键 | 作用 |
| --- | --- |
| `o` | 连接 / 断开 |
| `x` | HEX / TEXT 显示切换 |
| `c` | 清空日志 |
| `a` | 自动滚动开关 |
| `n` | 循环行尾追加选项 |
| `f` | 聚焦搜索框 |
| `↑` / `↓` | 切换发送模式（HEX / ASCII） |
| `Enter` | 发送（焦点在输入框时） |

## 测试

```powershell
cd projects\serial\web
node --test
```

## 已知限制

- **仅 Chromium 内核**：Firefox / Safari 没有 Web Serial。
- **拿不到 COM 名**：浏览器只暴露 USB VID:PID，界面不显示 `COM3`。
- **生命周期跟随页面**：刷新、关闭标签即断开，无法像桌面程序常驻后台。
- **不做高采样率采集 / ESP 烧录**：这些需要原生 USB 访问，不属于本工具范围。

## 历史

早期存在一版 Rust + egui 原生实现（串口 / 逻辑分析仪 / 插件三工作区），已从仓库移除。相关决策记录与旧 Web 版研究资料保留在 `docs/reference/`：

- `docs/reference/refactor-to-rust.md` —— 当年从 Web 版迁移到 Rust 的决策记录
- `docs/reference/old-web-version/` —— 旧 Web 版的 Saleae / fx2lafw 协议探针、ESP 检测与导出逻辑（ESP 与逻辑分析仪若要做，这是唯一参考）
