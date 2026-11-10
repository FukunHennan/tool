//! 右侧追加（行尾）选项面板，对齐 TuiSerial。
//! 单击选择，右键循环切换。

use crate::app::{AppendMode, ToolboxApp};
use eframe::egui;

pub fn show(ui: &mut egui::Ui, app: &mut ToolboxApp) {
    ui.label(egui::RichText::new("追加选项").strong());
    ui.add_space(4.0);

    let response = egui::Frame::group(ui.style()).show(ui, |ui| {
        for mode in AppendMode::ALL {
            let selected = app.append == mode;
            if ui.selectable_label(selected, format!("{}", mode.label())).clicked() {
                app.append = mode;
            }
        }
    });
    let _ = response;

    // 右键循环切换
    if ui.input(|i| i.pointer.secondary_clicked()) {
        app.append = app.append.next();
    }

    ui.add_space(8.0);
    ui.label(egui::RichText::new("n 键循环切换").weak().small());
    ui.label(egui::RichText::new("右键循环切换").weak().small());
}