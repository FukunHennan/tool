//! egui 界面：串口工作区、波形面板、插件状态。
//!
//! 布局对齐 TuiSerial：
//! - 顶部菜单栏（F10）
//! - 左侧配置面板（连接时锁定）
//! - 中央消息日志区
//! - 右侧追加选项面板
//! - 底部发送区 + 状态栏
//! - 全局快捷键（F1/? 查看）
//!
//! 串口读写运行在独立后台线程，通过 channel 与 UI 通信，UI 不阻塞。

pub mod append_panel;
pub mod app;
pub mod config_panel;
pub mod log_panel;
pub mod menu_bar;
pub mod plugin_panel;
pub mod send_panel;
pub mod shortcuts;
pub mod status_bar;
pub mod waveform_panel;

pub use app::{AppendMode, SerialEvent, ToolboxApp, Workspace};
