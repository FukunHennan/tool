# 重构文档：Web 串口平台 → Rust 原生桌面应用

- 日期：2026-08-18
- 状态：已执行（UI 对齐阶段完成）

## 背景与动机

原项目（`PC-Toolbox`，React + TypeScript + Vite）是部署在 EdgeOne 的 Web 串口工具平台，
在使用中暴露出架构层面的根本问题：

1. **Web Serial 平台限制**：必须 HTTPS、仅 Chrome/Edge、用户手势授权、刷新/休眠断连，
   属于浏览器沙箱的固有约束，无法通过应用层代码解决。
2. **性能瓶颈**：24MHz / 8CH 逻辑分析仪在 WebUSB 下无法稳定连续采集，被迫引入
   Python 原生桥（`saleae_bridge.py`，独立端口 43127），架构被割裂。
3. **分发价值为零**：串口连接始终发生在用户本机，EdgeOne 静态托管只带来 HTTPS 限制，
   没有带来任何分发收益。
4. **模块划分按功能而非依赖方向**：core 混入 UI、serial 混入浏览器 API、
   workflow 直接依赖 serialService，纯逻辑不可独立测试。

## 决策

参照 [TuiSerial](https://github.com/Horldsence/tuiserial)（Rust + Ratatui 串口调试工具，
MIT License）的架构模式，重写为 **Rust 原生桌面应用（egui）**：

- 技术栈：Rust + cargo workspace + eframe/egui + egui_plot + serialport
- 布局与交互对齐 TuiSerial：菜单栏 / 配置面板（连接时锁定）/ 消息日志 / 追加选项 /
  状态栏 / 全局快捷键
- 工作流编排（Node-RED 式拖图）替换为**插件钩子管线**（on_rx / on_tx），更轻量
- 逻辑分析仪波形必须保留界面内查看 → 选择 egui_plot 而非 TUI

## 目标架构（对齐 TuiSerial 6-crate 模式）

```
crates/
├── pctoolbox-core       # 数据模型、会话状态机、消息日志、配置持久化（纯逻辑，零 UI 依赖）
├── pctoolbox-serial     # DeviceTransport 抽象 + serialport 实现 + Mock
├── pctoolbox-esp        # ESP 芯片检测接口（esptool-rs 协议待接入）
├── pctoolbox-analyzer   # 逻辑分析仪波形数据模型（rusb 采集待接入）
├── pctoolbox-plugin     # 数据拦截钩子管线（on_rx/on_tx/on_connect/on_disconnect）
├── pctoolbox-ui         # egui 界面（菜单栏/配置/日志/发送/状态栏/快捷键）
└── pctoolbox-cli        # 主程序入口（二进制 pctoolbox）
```

**依赖方向**：`ui → plugin/analyzer/serial → core`，禁止反向依赖。
核心 crate（core）不依赖任何 UI 或硬件库，可独立测试。

## UI 布局（对齐 TuiSerial）

```
┌──────────────────────────────────────────────────────────┐
│ 菜单栏: 文件 会话 视图 设置 插件 帮助          (F10)      │
├──────────────┬──────────────────────────┬────────────────┤
│ 配置面板      │ 消息日志                  │ 追加选项        │
│ 端口/波特率   │ [消息 - HEX|123条]        │ 无/\n/\r/      │
│ 数据位/校验   │ [时间] ◄ RX (5B) ...     │ \r\n/\n\r     │
│ 停止位/流控   │ (x 切换, c 清空)          │ (n 循环)       │
│ [连接 o]     │                          │                │
├──────────────┴──────────────────────────┴────────────────┤
│ 发送区: [输入] [模式↑↓] [追加] [发送 Enter]  TX/RX 统计    │
├──────────────────────────────────────────────────────────┤
│ 状态栏: ✓/✗ 连接 | 🔒/🔓 配置 | 端口@波特率 8-N-1 | 插件数 │
└──────────────────────────────────────────────────────────┘
```

## 关键设计（对齐 TuiSerial）

| 特性 | 实现位置 | 说明 |
|---|---|---|
| 配置锁定 | `core::session::Session` | 连接后配置修改被拒绝（`SessionError::ConfigLocked`），UI 变灰 + 🔒 |
| 消息格式 | `core::message::LogEntry` | `[14:32:45.123] ◄ RX (   5 B) 48 65 6C 6C 6F`，RX 青/TX 绿 |
| 环形日志 | `core::message::LogBuffer` | 上限 10000 条，自动淘汰最旧 |
| 配置持久化 | `core::config::AppConfig` | `%APPDATA%/pctoolbox/config.json`，损坏回退默认值 |
| 快捷键 | `ui::shortcuts` | F10 菜单、F1/? 帮助、o/r/x/c/a/n/p、输入框内 Enter/↑↓/Esc |
| 插件钩子 | `plugin::HookPipeline` | on_rx 可改写数据、on_tx 可取消发送（返回 None） |

## 与旧架构的差异

| 维度 | 旧 Web 版 | 新 Rust 版 |
|---|---|---|
| 语言/框架 | TypeScript / React / Vite | Rust / egui |
| 串口访问 | Web Serial（沙箱限制） | serialport crate（原生） |
| 逻辑分析仪 | WebUSB + Python 桥 | rusb 直连（待接入，无需桥） |
| 工作流编排 | @xyflow 可视化拖图 | 插件钩子管线（JS 运行时待接入） |
| 报表 | ExcelJS（浏览器） | rust_xlsxwriter（待接入） |
| 部署 | EdgeOne 静态托管 | 单二进制，`cargo build --release` |
| 配置存储 | IndexedDB（文档声明） | 本地 JSON 文件 |

## 移植进度

| 模块 | 状态 |
|---|---|
| core（配置/会话/日志） | ✅ 完成，11 个单元测试通过 |
| serial（传输抽象） | ✅ 完成（Mock 待补充测试） |
| plugin（钩子管线） | ✅ Rust 钩子完成；boa_engine JS 运行时待接入 |
| ui（TuiSerial 布局） | ✅ 完成 |
| analyzer（波形模型） | ✅ 数据模型完成；rusb 采集待接入 |
| esp（芯片检测） | ⏳ 接口占位，esptool-rs 协议待接入 |
| cli（入口） | ✅ 完成 |

## 技术参考

- TuiSerial 架构：[github.com/Horldsence/tuiserial](https://github.com/Horldsence/tuiserial)（MIT）
- egui：github.com/emilk/egui
- esptool-rs：github.com/esp-rs/esptool-rs
- 旧 Web 版研究资料：`research/`（Saleae/fx2lafw 协议、ESP 检测逻辑、Python 桥）