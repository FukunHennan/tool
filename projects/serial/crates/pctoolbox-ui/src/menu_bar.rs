//! 顶部菜单栏：文件 / 会话 / 视图 / 设置 / 插件 / 帮助。
//! 对齐 TuiSerial 的菜单栏（F10 打开）。

use crate::app::ToolboxApp;
use crate::Workspace;
use eframe::egui;

/// 菜单动作。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MenuAction {
    SaveConfig,
    Quit,
    Connect,
    Disconnect,
    RefreshPorts,
    ToggleHex,
    ToggleAutoScroll,
    ToggleLanguage,
    PluginManager,
    Shortcuts,
    About,
}

pub fn show_menu_bar(ui: &mut egui::Ui, app: &mut ToolboxApp) {
    egui::MenuBar::new().ui(ui, |ui| {
        let mut action: Option<MenuAction> = None;

        ui.menu_button("文件", |ui| {
            if ui.button("保存配置").clicked() {
                action = Some(MenuAction::SaveConfig);
            }
            ui.separator();
            if ui.button("退出 (q)").clicked() {
                action = Some(MenuAction::Quit);
            }
        });

        ui.menu_button("会话", |ui| {
            if app.is_connected() {
                if ui.button("断开连接 (o)").clicked() {
                    action = Some(MenuAction::Disconnect);
                }
            } else if ui.button("连接 (o)").clicked() {
                action = Some(MenuAction::Connect);
            }
            if ui.button("刷新端口列表 (r)").clicked() {
                action = Some(MenuAction::RefreshPorts);
            }
        });

        ui.menu_button("视图", |ui| {
            if ui.checkbox(&mut app.hex_view, "HEX 显示模式 (x)").changed() {
                action = Some(MenuAction::ToggleHex);
            }
            if ui
                .checkbox(&mut app.auto_scroll, "自动滚动 (a)")
                .changed()
            {
                action = Some(MenuAction::ToggleAutoScroll);
            }
            ui.separator();
            for (label, ws) in [
                ("串口工作区", Workspace::Serial),
                ("逻辑分析仪", Workspace::Analyzer),
                ("插件管理", Workspace::Plugin),
            ] {
                if ui.selectable_label(app.workspace == ws, label).clicked() {
                    app.workspace = ws;
                }
            }
        });

        ui.menu_button("设置", |ui| {
            if ui.button("切换语言 (中/EN)").clicked() {
                action = Some(MenuAction::ToggleLanguage);
            }
        });

        ui.menu_button("插件", |ui| {
            if ui.button("插件管理 (p)").clicked() {
                action = Some(MenuAction::PluginManager);
            }
            ui.label(format!("已加载: {} 个钩子", app.pipeline.len()));
        });

        ui.menu_button("帮助", |ui| {
            if ui.button("快捷键 (F1 / ?)").clicked() {
                action = Some(MenuAction::Shortcuts);
            }
            ui.separator();
            if ui.button("关于").clicked() {
                action = Some(MenuAction::About);
            }
        });

        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            ui.label(egui::RichText::new("F10 关闭菜单").weak().small());
        });

        if let Some(action) = action {
            apply_action(app, action);
        }
    });
}

pub fn apply_action(app: &mut ToolboxApp, action: MenuAction) {
    match action {
        MenuAction::SaveConfig => app.save_config(),
        MenuAction::Quit => {
            app.save_config();
            app.disconnect();
            std::process::exit(0);
        }
        MenuAction::Connect => app.connect(),
        MenuAction::Disconnect => app.disconnect(),
        MenuAction::RefreshPorts => app.refresh_ports(),
        MenuAction::ToggleHex => {}
        MenuAction::ToggleAutoScroll => {}
        MenuAction::ToggleLanguage => {
            app.error = Some("i18n 切换尚未实现，界面语言固定为中文".into());
        }
        MenuAction::PluginManager => app.workspace = Workspace::Plugin,
        MenuAction::Shortcuts => app.show_shortcuts = true,
        MenuAction::About => {
            app.error = Some(concat!("PC Toolbox v", env!("CARGO_PKG_VERSION"), " — Rust/egui 工具平台").into());
        }
    }
}
