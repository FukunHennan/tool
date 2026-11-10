//! 插件工作区：钩子管线状态。
//!
//! JS 插件运行时（boa_engine）后续加入；当前展示已注册的 Rust 钩子。

use crate::app::ToolboxApp;
use eframe::egui;

pub fn show(ui: &mut egui::Ui, app: &mut ToolboxApp) {
    ui.horizontal(|ui| {
        ui.heading("插件");
        ui.separator();
        ui.label(
            egui::RichText::new(format!("已注册钩子: {}", app.pipeline.len())).weak(),
        );
    });
    ui.separator();

    ui.label("钩子接口: on_load / on_unload / on_connect / on_disconnect / on_rx / on_tx");
    ui.label("JS 插件运行时（boa_engine）将在后续版本加入。");
    ui.add_space(8.0);

    ui.horizontal(|ui| {
        if ui.button("刷新").clicked() {
            // 重新扫描插件目录（后续实现）
        }
        if ui.button("全部卸载").clicked() {
            app.pipeline.clear();
        }
    });
}