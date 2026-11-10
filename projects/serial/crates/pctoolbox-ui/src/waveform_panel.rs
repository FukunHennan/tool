use crate::app::ToolboxApp;
use eframe::egui;
use egui_plot::{Line, Plot};

/// 逻辑分析仪工作区：波形显示（egui_plot）。
///
/// 当前为演示数据；后续接入 rusb 采集后替换为真实波形。
pub fn analyzer_workspace(ui: &mut egui::Ui, app: &mut ToolboxApp) {
    ui.horizontal(|ui| {
        ui.heading("逻辑分析仪");
        ui.separator();
        ui.label(egui::RichText::new("采集通道: 8 | 演示模式").weak());
    });
    ui.separator();

    let t: f64 = ui.input(|i| i.time);
    let lines: Vec<Line> = (0..8)
        .map(|ch| {
            let points: Vec<[f64; 2]> = (0..512)
                .map(|i| {
                    let x = i as f64 / 64.0 + t * 0.1 * (ch as f64 * 0.3 + 1.0);
                    let y = if (x * (ch as f64 + 1.0) as f64).rem_euclid(2.0) < 1.0 {
                        1.0
                    } else {
                        0.0
                    };
                    [x, y + ch as f64 * 1.5]
                })
                .collect();
            Line::new(format!("CH{ch}"), points)
        })
        .collect();

    Plot::new("analyzer_plot")
        .height(360.0)
        .show(ui, |plot_ui| {
            for line in lines {
                plot_ui.line(line);
            }
        });

    ui.horizontal(|ui| {
        if ui.button("开始采集").clicked() {
            app.log.push(pctoolbox_core::message::LogEntry::new(
                pctoolbox_core::message::Direction::Tx,
                b"analyzer: start".to_vec(),
            ));
        }
        if ui.button("停止").clicked() {
            app.log.push(pctoolbox_core::message::LogEntry::new(
                pctoolbox_core::message::Direction::Tx,
                b"analyzer: stop".to_vec(),
            ));
        }
        ui.label(egui::RichText::new("（占位：真实采集将在 USB 后端接入后启用）").weak());
    });
}