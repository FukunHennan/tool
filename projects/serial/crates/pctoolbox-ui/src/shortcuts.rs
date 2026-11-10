//! 键盘快捷键系统，对齐 TuiSerial：
//! - F10 菜单栏开关，F1/? 快捷键覆盖层
//! - o 连接/断开，r 刷新端口，x HEX 切换，c 清空，a 自动滚动
//! - n 循环追加选项，p 插件管理，f 搜索日志
//! - 输入框内：Enter 发送，↑/↓ 切换 HEX/ASCII 发送模式，Esc 清空

use crate::app::ToolboxApp;
use crate::menu_bar::{apply_action, MenuAction};
use eframe::egui;

pub fn handle_shortcuts(app: &mut ToolboxApp, ui: &mut egui::Ui) {
    let ctx = ui.ctx();
    let input = ctx.input(|i| {
        (
            i.key_pressed(egui::Key::F10),
            i.key_pressed(egui::Key::F1),
            i.key_pressed(egui::Key::Questionmark),
            i.key_pressed(egui::Key::Escape),
            i.key_pressed(egui::Key::O),
            i.key_pressed(egui::Key::R),
            i.key_pressed(egui::Key::X),
            i.key_pressed(egui::Key::C),
            i.key_pressed(egui::Key::A),
            i.key_pressed(egui::Key::N),
            i.key_pressed(egui::Key::P),
            i.key_pressed(egui::Key::ArrowUp),
            i.key_pressed(egui::Key::ArrowDown),
            i.key_pressed(egui::Key::Enter),
            i.key_pressed(egui::Key::F),
            i.key_pressed(egui::Key::Q),
            i.modifiers.ctrl,
        )
    });
    let (
        f10,
        f1,
        questionmark,
        escape,
        key_o,
        key_r,
        key_x,
        key_c,
        key_a,
        key_n,
        key_p,
        arrow_up,
        arrow_down,
        enter,
        key_f,
        key_q,
        ctrl,
    ) = input;

    // 快捷键覆盖层打开时只处理关闭
    if app.show_shortcuts {
        if f1 || questionmark || escape {
            app.show_shortcuts = false;
        }
        return;
    }

    if f10 {
        app.menu_open = !app.menu_open;
    }
    if app.menu_open {
        if escape {
            app.menu_open = false;
        }
        return;
    }

    if f1 || questionmark {
        app.show_shortcuts = true;
        return;
    }
    if ctrl && key_q {
        apply_action(app, MenuAction::Quit);
        return;
    }
    if key_o {
        app.toggle_connection();
        return;
    }
    if key_r {
        app.refresh_ports();
        return;
    }
    if key_x {
        app.hex_view = !app.hex_view;
        return;
    }
    if key_c {
        app.log.clear();
        app.search_filter.clear();
        app.search_active = false;
        return;
    }
    if key_a {
        app.auto_scroll = !app.auto_scroll;
        return;
    }
    if key_n {
        app.append = app.append.next();
        return;
    }
    if key_p {
        app.workspace = crate::Workspace::Plugin;
        return;
    }
    if key_f {
        app.search_active = !app.search_active;
        if !app.search_active {
            app.search_filter.clear();
        }
        return;
    }

    // 输入框焦点相关：↑/↓ 切换发送模式，Esc 清空输入
    let focused = ctx.memory(|m| m.focused().is_some());
    if focused {
        if arrow_up || arrow_down {
            app.tx_hex_mode = !app.tx_hex_mode;
        }
        if escape {
            app.tx_input.clear();
        }
        if enter {
            app.send();
            app.tx_input.clear();
        }
    }
}

/// 快捷键覆盖层（F1 / ?）。
pub fn shortcuts_overlay(ui: &mut egui::Ui, app: &mut ToolboxApp) {
    eframe::egui::CentralPanel::default().show(ui, |ui| {
        ui.heading("快捷键");
        ui.separator();
        ui.label("全局:");
        ui.label("  o     连接 / 断开串口");
        ui.label("  r     刷新端口列表");
        ui.label("  x     HEX / TEXT 显示切换");
        ui.label("  c     清空日志 + 搜索");
        ui.label("  a     自动滚动开关");
        ui.label("  n     循环追加选项 (无 / \\n / \\r / \\r\\n / \\n\\r)");
        ui.label("  p     插件管理");
        ui.label("  f     搜索日志");
        ui.label("  F10   菜单栏开关");
        ui.label("  F1/?  本帮助");
        ui.label("  Ctrl+Q 退出程序");
        ui.separator();
        ui.label("输入框内:");
        ui.label("  Enter 发送数据");
        ui.label("  ↑/↓   切换 HEX / ASCII 发送模式");
        ui.label("  Esc   清空输入");
        ui.separator();
        ui.label(format!(
            "当前: HEX显示={} 自动滚动={} 追加={} 搜索={}",
            if app.hex_view { "开" } else { "关" },
            if app.auto_scroll { "开" } else { "关" },
            app.append.label(),
            if app.search_active { "开" } else { "关" },
        ));
        if ui.button("关闭 (F1 / ? / Esc)").clicked() {
            app.show_shortcuts = false;
        }
    });
}
