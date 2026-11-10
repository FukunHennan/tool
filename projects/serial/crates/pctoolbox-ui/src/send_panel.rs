//! 发送区：输入框 + HEX/ASCII 模式 + 行尾追加 + 发送按钮。
//! 对齐 TuiSerial：输入框内 ↑/↓ 切换模式，Enter 发送，Esc 清空。

use crate::app::ToolboxApp;
use eframe::egui;

pub fn show(ui: &mut egui::Ui, app: &mut ToolboxApp) {
    ui.add_space(2.0);
    ui.horizontal(|ui| {
        let mode_label = if app.tx_hex_mode { "HEX" } else { "ASCII" };
        let mode = egui::Button::new(format!("模式: {mode_label} (↑/↓)"));
        let response = ui.add_enabled(app.is_connected(), mode);
        if response.on_hover_text("↑/↓ 切换发送模式").clicked() {
            app.tx_hex_mode = !app.tx_hex_mode;
        }

        ui.label(egui::RichText::new(format!("追加: {}", app.append.label())).weak());
        if ui
            .button(format!("循环 (n)"))
            .on_hover_text("无 / \\n / \\r / \\r\\n / \\n\\r")
            .clicked()
        {
            app.append = app.append.next();
        }

        ui.separator();
        ui.label(
            egui::RichText::new(format!(
                "TX {}B / {}包   RX {}B / {}包",
                app.tx_stats.bytes, app.tx_stats.packets, app.rx_stats.bytes, app.rx_stats.packets
            ))
            .weak(),
        );
    });

    ui.add_space(2.0);
    ui.horizontal(|ui| {
        let connected = app.is_connected();
        let hint = if app.tx_hex_mode {
            "48 65 6C 6C 6F"
        } else {
            "输入数据，Enter 发送，Esc 清空"
        };
        let input = egui::TextEdit::singleline(&mut app.tx_input)
            .hint_text(hint)
            .desired_width(f32::INFINITY);
        let response = ui.add_enabled(connected, input);

        let enter = response.lost_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter));
        let send_clicked = ui
            .add_enabled(connected && !app.tx_input.is_empty(), egui::Button::new("发送 (Enter)"))
            .clicked();

        if send_clicked || enter {
            app.send();
            app.tx_input.clear();
        }
    });
}