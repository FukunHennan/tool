//! 应用主状态机与 eframe::App 实现。
//!
//! 核心设计：
//! - 所有状态由 `pctoolbox-core` 的 `Session` + `LogBuffer` 持有
//! - 串口读写运行在独立后台线程，通过 `mpsc` channel 向 UI 投递事件
//! - UI 指令（shutdown）通过 `mpsc` channel 向后台线程发送
//! - 插件钩子管线由 `HookPipeline` 持有，负责 RX/TX 数据拦截
//! - 进程内 UI 事件（如配置变更通知）通过 `EventBus` 分发
//!
//! 布局对齐 TuiSerial：菜单栏(F10) / 左侧配置 / 中央日志 / 右侧追加 / 底部发送+状态栏

use pctoolbox_core::message::{Direction, LogBuffer, LogEntry};
use pctoolbox_core::session::{Session, SessionEvent, SessionState};
use pctoolbox_eventbus::{ConfigChanged, ConfigField, EventBus};
use pctoolbox_plugin::HookPipeline;
use pctoolbox_serial::DeviceTransport;

pub use pctoolbox_core::config::SerialConfig;

/// 后台线程 → UI 的事件类型。
#[derive(Debug, Clone)]
pub enum SerialEvent {
    /// 收到数据（RX）或发送数据（TX）。
    Data(Direction, Vec<u8>),
    /// 连接断开（携带错误信息）。
    Disconnected(String),
}

/// 工作区切换：串口 / 逻辑分析仪 / 插件。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Workspace {
    Serial,
    Analyzer,
    Plugin,
}

/// 追加（行尾）选项，对齐 TuiSerial。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AppendMode {
    None,
    Lf,
    Cr,
    CrLf,
    LfCr,
}

impl AppendMode {
    pub const ALL: [AppendMode; 5] = [
        AppendMode::None,
        AppendMode::Lf,
        AppendMode::Cr,
        AppendMode::CrLf,
        AppendMode::LfCr,
    ];

    pub fn label(self) -> &'static str {
        match self {
            AppendMode::None => "无",
            AppendMode::Lf => "\\n",
            AppendMode::Cr => "\\r",
            AppendMode::CrLf => "\\r\\n",
            AppendMode::LfCr => "\\n\\r",
        }
    }

    pub fn bytes(self) -> &'static [u8] {
        match self {
            AppendMode::None => &[],
            AppendMode::Lf => b"\n",
            AppendMode::Cr => b"\r",
            AppendMode::CrLf => b"\r\n",
            AppendMode::LfCr => b"\n\r",
        }
    }

    pub fn next(self) -> Self {
        let all = Self::ALL;
        all[(all.iter().position(|m| *m == self).unwrap() + 1) % all.len()]
    }
}

/// 应用状态：核心状态全部由 `pctoolbox-core` 持有，UI 只做渲染。
pub struct ToolboxApp {
    pub session: Session,
    pub log: LogBuffer,
    pub pipeline: HookPipeline,
    pub workspace: Workspace,
    pub hex_view: bool,
    pub auto_scroll: bool,
    pub tx_hex_mode: bool,
    pub append: AppendMode,
    pub tx_input: String,
    pub ports: Vec<String>,
    pub error: Option<String>,
    pub menu_open: bool,
    pub show_shortcuts: bool,
    pub tx_stats: Stats,
    pub rx_stats: Stats,

    /// 后台线程 → UI 的事件通道。
    rx: Option<std::sync::mpsc::Receiver<SerialEvent>>,
    /// UI → 后台线程的数据发送通道。
    tx: Option<std::sync::mpsc::Sender<Vec<u8>>>,
    /// UI → 后台线程的关闭信号通道。
    shutdown: Option<std::sync::mpsc::Sender<()>>,
    /// 后台线程句柄。
    worker: Option<std::thread::JoinHandle<()>>,
    /// 进程内 UI 事件总线（配置变更通知等）。
    ui_events: EventBus<ConfigChanged>,

    /// 已连接的波特率历史记录（用于下拉选择）。
    pub baud_history: Vec<u32>,
    /// 日志搜索关键字。
    pub search_filter: String,
    /// 是否启用日志搜索。
    pub search_active: bool,
}

#[derive(Debug, Default, Clone, Copy)]
pub struct Stats {
    pub bytes: usize,
    pub packets: usize,
}

impl Default for ToolboxApp {
    fn default() -> Self {
        let config_path = pctoolbox_core::AppConfig::default_path();
        let app_config = pctoolbox_core::AppConfig::load_or_default(&config_path);
        Self {
            session: Session::new(app_config.serial.clone()),
            log: LogBuffer::new(10_000),
            pipeline: HookPipeline::new(),
            workspace: Workspace::Serial,
            hex_view: false,
            auto_scroll: true,
            tx_hex_mode: false,
            append: AppendMode::None,
            tx_input: String::new(),
            ports: pctoolbox_serial::SerialPortTransport::list_ports(),
            error: None,
            menu_open: false,
            show_shortcuts: false,
            tx_stats: Stats::default(),
            rx_stats: Stats::default(),
            rx: None,
            tx: None,
            shutdown: None,
            worker: None,
            ui_events: EventBus::new(),
            baud_history: vec![
                300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200,
                230400, 460800, 921600, 1000000, 1500000, 2000000, 4000000,
            ],
            search_filter: String::new(),
            search_active: false,
        }
    }
}

impl ToolboxApp {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn is_connected(&self) -> bool {
        self.session.state() == SessionState::Connected
    }

    /// 订阅配置变更事件。
    pub fn subscribe_config_changed(&mut self, handler: impl Fn(&ConfigChanged) + 'static) {
        self.ui_events.subscribe(handler);
    }

    /// 通知配置字段已变更。
    pub fn notify_config_changed(&mut self, field: ConfigField) {
        self.ui_events.emit(&ConfigChanged::new(field));
    }

    /// 连接/断开切换（快捷键 o）。
    pub fn toggle_connection(&mut self) {
        if self.is_connected() {
            self.disconnect();
        } else {
            self.connect();
        }
    }

    /// 连接：启动后台读写线程，通过 mpsc channel 与 UI 通信。
    pub fn connect(&mut self) {
        let config = self.session.config().clone();
        let (tx_data, rx_data) = std::sync::mpsc::channel::<Vec<u8>>();
        let (tx_event, rx_event) = std::sync::mpsc::channel::<SerialEvent>();
        let (tx_shutdown, rx_shutdown) = std::sync::mpsc::channel::<()>();

        let mut transport = match pctoolbox_serial::SerialPortTransport::connect(&config) {
            Ok(t) => t,
            Err(e) => {
                self.error = Some(e.to_string());
                self.session.apply(SessionEvent::Error(e.to_string()));
                return;
            }
        };

        self.session.apply(SessionEvent::Connected);
        self.pipeline.notify(pctoolbox_plugin::HookEvent::Connect);

        let handle = std::thread::spawn(move || {
            loop {
                if rx_shutdown.try_recv().is_ok() {
                    break;
                }
                match transport.read() {
                    Ok(chunk) if !chunk.is_empty() => {
                        let _ = tx_event.send(SerialEvent::Data(Direction::Rx, chunk));
                    }
                    Ok(_) => {}
                    Err(e) => {
                        let _ = tx_event.send(SerialEvent::Disconnected(e.to_string()));
                        break;
                    }
                }
                if let Ok(data) = rx_data.try_recv() {
                    if transport.write(&data).is_ok() {
                        let _ = tx_event.send(SerialEvent::Data(Direction::Tx, data));
                    }
                }
            }
            let _ = transport.disconnect();
        });

        self.tx = Some(tx_data);
        self.rx = Some(rx_event);
        self.worker = Some(handle);
        self.shutdown = Some(tx_shutdown);
    }

    /// 断开：停线程、解锁配置。
    pub fn disconnect(&mut self) {
        if let Some(tx) = self.shutdown.take() {
            let _ = tx.send(());
        }
        if let Some(handle) = self.worker.take() {
            let _ = handle.join();
        }
        self.tx = None;
        self.rx = None;
        self.session.apply(SessionEvent::Disconnected);
        self.pipeline.notify(pctoolbox_plugin::HookEvent::Disconnect);
    }

    /// 发送：经过插件 TX 钩子，带行尾追加。
    pub fn send(&mut self) {
        if self.tx_input.is_empty() {
            return;
        }
        let raw = if self.tx_hex_mode {
            parse_hex(&self.tx_input)
        } else {
            self.tx_input.as_bytes().to_vec()
        };
        let mut data = raw;
        data.extend_from_slice(self.append.bytes());

        if let Some(processed) = self.pipeline.process_tx(data) {
            if let Some(tx) = &self.tx {
                let _ = tx.send(processed);
            }
        }
    }

    /// 从后台线程收事件，投递到日志缓冲。
    pub fn poll_events(&mut self) {
        let Some(rx) = self.rx.take() else { return };
        let mut pending = Vec::new();
        while let Ok(event) = rx.try_recv() {
            pending.push(event);
        }
        self.rx = Some(rx);
        for event in pending {
            match event {
                SerialEvent::Data(dir, raw) => {
                    let data = if dir == Direction::Rx {
                        self.pipeline.process_rx(raw)
                    } else {
                        raw
                    };
                    let bytes = data.len();
                    self.log.push(LogEntry::new(dir, data));
                    match dir {
                        Direction::Rx => {
                            self.rx_stats.bytes += bytes;
                            self.rx_stats.packets += 1;
                        }
                        Direction::Tx => {
                            self.tx_stats.bytes += bytes;
                            self.tx_stats.packets += 1;
                        }
                    }
                }
                SerialEvent::Disconnected(msg) => {
                    self.error = Some(msg);
                    self.disconnect();
                }
            }
        }
    }

    /// 刷新串口列表（未连接时可操作）。
    pub fn refresh_ports(&mut self) {
        if !self.is_connected() {
            self.ports = pctoolbox_serial::SerialPortTransport::list_ports();
        }
    }

    /// 保存配置到默认路径。
    pub fn save_config(&self) {
        let config = pctoolbox_core::AppConfig {
            serial: self.session.config().clone(),
        };
        let path = pctoolbox_core::AppConfig::default_path();
        if let Err(e) = config.save(&path) {
            eprintln!("配置保存失败: {e}");
        }
    }
}

/// 解析 `48 65 6C` / `48656C` 形式的十六进制输入。
pub fn parse_hex(input: &str) -> Vec<u8> {
    let compact: String = input.chars().filter(|c| !c.is_whitespace()).collect();
    let mut bytes = Vec::with_capacity(compact.len() / 2);
    let mut iter = compact.chars();
    while let (Some(hi), Some(lo)) = (iter.next(), iter.next()) {
        let hi = hi.to_digit(16);
        let lo = lo.to_digit(16);
        if let (Some(hi), Some(lo)) = (hi, lo) {
            bytes.push((hi * 16 + lo) as u8);
        } else {
            break;
        }
    }
    bytes
}

impl eframe::App for ToolboxApp {
    fn ui(&mut self, ui: &mut eframe::egui::Ui, _frame: &mut eframe::Frame) {
        self.poll_events();
        crate::shortcuts::handle_shortcuts(self, ui);

        if self.show_shortcuts {
            crate::shortcuts::shortcuts_overlay(ui, self);
            return;
        }

        if self.menu_open {
            crate::menu_bar::show_menu_bar(ui, self);
        }

        // 工作区切换栏：常驻可见，避免功能藏在 F10 菜单后面。
        eframe::egui::Panel::top("workspace_tabs").show(ui, |ui| {
            ui.horizontal(|ui| {
                for (label, workspace) in [
                    ("串口", Workspace::Serial),
                    ("逻辑分析仪", Workspace::Analyzer),
                    ("插件", Workspace::Plugin),
                ] {
                    if ui
                        .selectable_label(self.workspace == workspace, label)
                        .clicked()
                    {
                        self.workspace = workspace;
                    }
                }
                ui.with_layout(
                    eframe::egui::Layout::right_to_left(eframe::egui::Align::Center),
                    |ui| {
                        ui.label(
                            eframe::egui::RichText::new("F10 菜单 · F1 快捷键")
                                .weak()
                                .small(),
                        );
                    },
                );
            });
        });

        eframe::egui::Panel::left("config_panel")
            .exact_size(220.0)
            .show(ui, |ui| crate::config_panel::show(ui, self));
        eframe::egui::Panel::right("append_panel")
            .exact_size(120.0)
            .show(ui, |ui| crate::append_panel::show(ui, self));
        eframe::egui::Panel::bottom("status_bar").show(ui, |ui| crate::status_bar::show(ui, self));
        eframe::egui::Panel::bottom("send_panel").show(ui, |ui| crate::send_panel::show(ui, self));
        eframe::egui::CentralPanel::default().show(ui, |ui| {
            match self.workspace {
                Workspace::Serial => crate::log_panel::show(ui, self),
                Workspace::Analyzer => crate::waveform_panel::analyzer_workspace(ui, self),
                Workspace::Plugin => crate::plugin_panel::show(ui, self),
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_hex_with_spaces() {
        assert_eq!(parse_hex("48 65 6C"), vec![0x48, 0x65, 0x6C]);
    }

    #[test]
    fn parse_hex_without_spaces() {
        assert_eq!(parse_hex("48656C"), vec![0x48, 0x65, 0x6C]);
    }

    #[test]
    fn parse_hex_mixed_case() {
        assert_eq!(parse_hex("4f 65 6c"), vec![0x4F, 0x65, 0x6C]);
    }

    #[test]
    fn append_mode_cycle() {
        let modes = AppendMode::ALL;
        let mut current = AppendMode::None;
        for _ in 0..modes.len() {
            current = current.next();
        }
        assert_eq!(current, AppendMode::None);
    }

    #[test]
    fn append_mode_bytes() {
        assert_eq!(AppendMode::Lf.bytes(), b"\n");
        assert_eq!(AppendMode::Cr.bytes(), b"\r");
        assert_eq!(AppendMode::CrLf.bytes(), b"\r\n");
        assert_eq!(AppendMode::LfCr.bytes(), b"\n\r");
        assert_eq!(AppendMode::None.bytes(), &[] as &[u8]);
    }
}
