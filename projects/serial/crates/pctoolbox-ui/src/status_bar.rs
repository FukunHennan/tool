//! 底部状态栏：连接状态、配置格式（8-N-1）、锁定状态、插件数。
//! 对齐 TuiSerial 状态面板。

use crate::app::ToolboxApp;
use eframe::egui;
use pctoolbox_core::session::SessionState;

pub fn show(ui: &mut egui::Ui, app: &mut ToolboxApp) {
    ui.horizontal(|ui| {
        // 连接状态
        match app.session.state() {
            SessionState::Connected => {
                ui.colored_label(egui::Color32::GREEN, "✓ 已连接");
            }
            SessionState::Disconnected => {
                ui.colored_label(egui::Color32::GRAY, "✗ 未连接");
            }
        }

        ui.separator();

        // 配置状态
        if app.session.is_config_locked() {
            ui.colored_label(egui::Color32::from_gray(160), "🔒 配置已锁定");
        } else {
            ui.colored_label(egui::Color32::YELLOW, "🔓 配置可修改");
        }

        ui.separator();

        // 完整配置信息
        let config = app.session.config();
        ui.label(
            egui::RichText::new(format!(
                "{} | {} baud | {}",
                if config.port.is_empty() {
                    "未选择端口"
                } else {
                    &config.port
                },
                config.baud_rate,
                config.format_short()
            ))
            .weak(),
        );

        ui.separator();

        // 插件计数
        ui.label(egui::RichText::new(format!("插件: {}", app.pipeline.len())).weak());

        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            ui.label(egui::RichText::new("F1/? 帮助").weak().small());
        });
    });
}