//! 左侧配置面板：端口 / 波特率 / 数据位 / 校验 / 停止位 / 流控。
//! 连接后整块锁定（边框变灰 + [Locked] 标记），对齐 TuiSerial。

use crate::app::ToolboxApp;
use eframe::egui;
use pctoolbox_core::config::{DataBits, FlowControl, Parity, StopBits};

pub fn show(ui: &mut egui::Ui, app: &mut ToolboxApp) {
    let locked = app.session.is_config_locked();

    let frame = if locked {
        egui::Frame::group(ui.style()).fill(egui::Color32::from_gray(40))
    } else {
        egui::Frame::group(ui.style())
    };

    frame.show(ui, |ui| {
        ui.horizontal(|ui| {
            ui.label(egui::RichText::new("串口配置").strong());
            if locked {
                ui.colored_label(egui::Color32::from_gray(150), "🔒 [Locked]");
            } else {
                ui.colored_label(egui::Color32::from_gray(150), "🔓");
            }
        });

        ui.add_space(4.0);
        ui.add_enabled_ui(!locked, |ui| {
            // 端口
            ui.label("端口");
            egui::ComboBox::from_id_salt("port_combo")
                .width(180.0)
                .selected_text(if app.session.config().port.is_empty() {
                    "选择端口".to_string()
                } else {
                    app.session.config().port.clone()
                })
                .show_ui(ui, |ui| {
                    for port in &app.ports {
                        if let Ok(config) = app.session.config_mut() {
                            ui.selectable_value(&mut config.port, port.clone(), port);
                        }
                    }
                });

            ui.add_space(4.0);
            ui.horizontal(|ui| {
                ui.label("波特率");
                if let Ok(config) = app.session.config_mut() {
                    let baud = &mut config.baud_rate;
                    let resp = ui.add(egui::DragValue::new(baud).range(300..=4_000_000).speed(10.0));
                    if resp.changed() && !app.baud_history.contains(baud) {
                        app.baud_history.push(*baud);
                        app.baud_history.sort();
                        app.baud_history.truncate(20);
                    }
                }
            });

            ui.add_space(4.0);
            ui.label("数据位");
            ui.horizontal(|ui| {
                for bits in DataBits::all() {
                    if let Ok(config) = app.session.config_mut() {
                        ui.selectable_value(&mut config.data_bits, bits, format!("{}", bits.value()));
                    }
                }
            });

            ui.add_space(4.0);
            ui.label("校验");
            ui.horizontal(|ui| {
                for parity in Parity::all() {
                    if let Ok(config) = app.session.config_mut() {
                        ui.selectable_value(
                            &mut config.parity,
                            parity,
                            match parity {
                                Parity::None => "N",
                                Parity::Even => "E",
                                Parity::Odd => "O",
                            },
                        );
                    }
                }
            });

            ui.add_space(4.0);
            ui.label("停止位");
            ui.horizontal(|ui| {
                for stop in StopBits::all() {
                    if let Ok(config) = app.session.config_mut() {
                        ui.selectable_value(
                            &mut config.stop_bits,
                            stop,
                            match stop {
                                StopBits::One => "1",
                                StopBits::Two => "2",
                            },
                        );
                    }
                }
            });

            ui.add_space(4.0);
            ui.label("流控");
            ui.horizontal(|ui| {
                for flow in FlowControl::all() {
                    if let Ok(config) = app.session.config_mut() {
                        ui.selectable_value(
                            &mut config.flow_control,
                            flow,
                            match flow {
                                FlowControl::None => "无",
                                FlowControl::Hardware => "硬件",
                                FlowControl::Software => "软件",
                            },
                        );
                    }
                }
            });
        });

        ui.add_space(8.0);
        ui.separator();

        // 连接 / 断开按钮（深色底需要浅色文字，否则对比度不足）
        if app.is_connected() {
            if ui
                .add_sized(
                    [180.0, 28.0],
                    egui::Button::new(
                        egui::RichText::new("断开连接 (o)").color(egui::Color32::from_gray(235)),
                    )
                    .fill(egui::Color32::from_rgb(140, 45, 45)),
                )
                .clicked()
            {
                app.disconnect();
            }
        } else if ui
            .add_sized(
                [180.0, 28.0],
                egui::Button::new(
                    egui::RichText::new("连接 (o)").color(egui::Color32::from_gray(235)),
                )
                .fill(egui::Color32::from_rgb(38, 120, 60)),
            )
            .clicked()
        {
            app.connect();
        }

        ui.add_space(4.0);
        if ui
            .add_enabled(!app.is_connected(), egui::Button::new("刷新端口 (r)"))
            .clicked()
        {
            app.refresh_ports();
        }

        // 状态提示
        ui.add_space(8.0);
        ui.separator();
        match app.session.state() {
            pctoolbox_core::session::SessionState::Connected => {
                ui.colored_label(egui::Color32::GREEN, "✓ 已连接");
            }
            pctoolbox_core::session::SessionState::Disconnected => {
                ui.colored_label(egui::Color32::GRAY, "✗ 未连接");
            }
        }
        ui.label(
            egui::RichText::new(format!(
                "{} @ {}",
                app.session.config().port,
                app.session.config().baud_rate
            ))
            .weak()
            .small(),
        );
        if let Some(error) = &app.error {
            ui.colored_label(egui::Color32::RED, error);
        }
    });
}