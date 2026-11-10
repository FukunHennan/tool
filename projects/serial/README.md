# PC Toolbox (Rust)

> **当前平台工具是浏览器版**：`web/`（Web Serial），挂在 `http://127.0.0.1:8765/serial/`，与平台其他工具同一套技术栈（原生 HTML/CSS/JS）。
>
> 本 README 描述的是**原生 Rust 版**（`crates/`），作为早期实现保留：功能更完整（串口 / 逻辑分析仪 / 插件三工作区），但需要 Rust + MSVC 工具链才能构建，且无法在浏览器里运行。

PC Toolbox 的 Rust 原生重写：串口调试 + ESP 检测 + 逻辑分析仪，基于 egui 桌面 GUI。
架构参照 TuiSerial（cargo workspace 多 crate 分层），核心逻辑与 UI/硬件解耦。

## 架构

```
crates/
├── pctoolbox-core       # 数据模型、会话状态机、消息日志、配置持久化（纯逻辑）
├── pctoolbox-serial     # 传输抽象（DeviceTransport）+ serialport 实现 + Mock
├── pctoolbox-esp        # ESP 芯片检测接口（协议实现待接入）
├── pctoolbox-analyzer   # 逻辑分析仪波形数据模型（采集待接入）
├── pctoolbox-plugin     # 数据拦截钩子管线（on_rx/on_tx/on_connect...）
├── pctoolbox-ui         # egui 界面：串口 / 逻辑分析仪 / 插件工作区
├── pctoolbox-cli        # 主程序入口（二进制名 pctoolbox）
├── pctoolbox-eventbus   # 类型安全的事件总线（TypedEvent pub/sub）
└── pctoolbox-storage    # 二进制配置存储（bincode）
```

**依赖方向**：`ui → plugin/analyzer/serial/eventbus/storage → core`，禁止反向依赖。

## 运行

```powershell
cargo run -p pctoolbox-cli
```

测试：`cargo test --workspace`

## 关键设计（对齐 TuiSerial）

- 配置锁定：连接后串口参数自动锁定，断开解锁（`core::session`）
- 消息格式：`[时间] ◄ RX (  5 B) 48 65 6C 6C 6F`
- 配置持久化：`%APPDATA%/pctoolbox/config.bin`（bincode 格式），启动自动加载
- 日志环形缓冲：上限 10000 条
- 事件总线：`EventBus<T>` 类型安全订阅/发布，用于进程内 UI 事件分发
- 存储层：`BincodeStorage` 提供紧凑快速的二进制序列化

## 新增特性

| 模块 | 说明 |
|---|---|
| `pctoolbox-eventbus` | 泛型事件总线，支持任意类型的事件订阅和广播 |
| `pctoolbox-storage` | 基于 bincode 的配置存储，替代原 JSON 格式 |
| 测试覆盖 | 所有核心模块均有单元测试，总计 37 个测试通过 |

## 后续计划

- pctoolbox-esp：接入 esptool-rs 协议，实现 ROM Bootloader 只读识别
- pctoolbox-analyzer：接入 rusb 采集（fx2lafw / Saleae 协议，24MHz 8CH）
- pctoolbox-plugin：boa_engine JS 插件运行时
- UI：多会话标签页、插件管理界面
