//! 中央消息日志区：HEX/TEXT 双模式、自动/手动滚动、清空、搜索过滤。
//! 消息格式对齐 TuiSerial：`[时间] ◄ RX (  5 B) 48 65 6C 6C 6F`

use crate::app::ToolboxApp;
use eframe::egui;
use pctoolbox_core::message::Direction;

pub fn show(ui: &mut egui::Ui, app: &mut ToolboxApp) {
    ui.horizontal(|ui| {
        let mode = if app.hex_view { "HEX" } else { "TEXT" };
        let visible_count = if app.search_active && !app.search_filter.is_empty() {
            app.log
                .iter()
                .filter(|e| {
                    let text = if app.hex_view {
                        e.to_hex()
                    } else {
                        e.to_text()
                    };
                    text.contains(&app.search_filter)
                })
                .count()
        } else {
            app.log.len()
        };
        ui.label(
            egui::RichText::new(format!("消息 - {mode} | {visible_count} 条")).strong(),
        );
        ui.separator();
        if ui.button("x 切换").clicked() {
            app.hex_view = !app.hex_view;
        }
        if ui.button("c 清空").clicked() {
            app.log.clear();
            app.search_filter.clear();
            app.search_active = false;
        }
        ui.separator();
        if app.auto_scroll {
            ui.colored_label(egui::Color32::YELLOW, "a 自动滚动");
        } else {
            ui.colored_label(egui::Color32::GRAY, "a 手动滚动");
        }
        ui.separator();
        // 搜索框
        let search_resp = egui::TextEdit::singleline(&mut app.search_filter)
            .hint_text("搜索...")
            .desired_width(160.0)
            .show(ui)
            .response;
        if search_resp.changed() {
            app.search_active = !app.search_filter.is_empty();
        }
        if app.search_active && search_resp.lost_focus() && ui.input(|i| i.key_pressed(egui::Key::Escape)) {
            app.search_filter.clear();
            app.search_active = false;
        }
        if ui.button("✕").clicked() {
            app.search_filter.clear();
            app.search_active = false;
        }
    });

    ui.separator();

    if app.log.is_empty() {
        ui.add_space(12.0);
        ui.label(egui::RichText::new("日志为空").weak().size(16.0));
        ui.label(egui::RichText::new("按 o 连接串口后开始收发数据").weak().small());
        ui.label(egui::RichText::new("按 ? 查看全部快捷键").weak().small());
        return;
    }

    let line_count = app.log.len();
    let line_height = 18.0;
    let mut scroll = egui::ScrollArea::vertical()
        .max_height(ui.available_height())
        .auto_shrink(false);
    if app.auto_scroll {
        scroll = scroll.stick_to_bottom(true);
    }
    scroll.show_rows(ui, line_height, line_count, |ui, range| {
        for (i, entry) in app.log.iter().enumerate() {
            if i < range.start || i >= range.end {
                continue;
            }
            // 应用搜索过滤
            if app.search_active && !app.search_filter.is_empty() {
                let text = if app.hex_view {
                    entry.to_hex()
                } else {
                    entry.to_text()
                };
                if !text.contains(&app.search_filter) {
                    continue;
                }
            }
            let color = match entry.direction {
                Direction::Rx => egui::Color32::from_rgb(0x4F, 0xC3, 0xF7),
                Direction::Tx => egui::Color32::from_rgb(0x4C, 0xAF, 0x50),
            };
            let line = if app.hex_view {
                entry.to_hex()
            } else {
                entry.to_text()
            };
            // 高亮搜索关键词
            if app.search_active && !app.search_filter.is_empty() {
                highlight_search(ui, &line, &app.search_filter, color);
            } else {
                ui.colored_label(color, line);
            }
        }
    });
}

/// 在日志行中高亮显示搜索关键词。
fn highlight_search(ui: &mut egui::Ui, line: &str, pattern: &str, base_color: egui::Color32) {
    if let Some(pos) = line.find(pattern) {
        let before = &line[..pos];
        let matched = &line[pos..pos + pattern.len()];
        let after = &line[pos + pattern.len()..];
        if !before.is_empty() {
            ui.colored_label(base_color, before);
        }
        ui.colored_label(egui::Color32::YELLOW, matched);
        if !after.is_empty() {
            ui.colored_label(base_color, after);
        }
    } else {
        ui.colored_label(base_color, line);
    }
}
