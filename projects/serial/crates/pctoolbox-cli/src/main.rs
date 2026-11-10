use pctoolbox_ui::ToolboxApp;
use std::process;

const VERSION: &str = env!("CARGO_PKG_VERSION");
const APP_NAME: &str = "PC Toolbox";

fn print_help() {
    println!("{APP_NAME} v{VERSION} — Rust/egui 串口工具平台");
    println!();
    println!("用法: pctoolbox [选项]");
    println!();
    println!("选项:");
    println!("  -h, --help    显示此帮助信息");
    println!("  -v, --version 显示版本信息");
    println!();
    println!("快捷键:");
    println!("  o     连接 / 断开串口");
    println!("  r     刷新端口列表");
    println!("  x     HEX / TEXT 显示切换");
    println!("  c     清空日志");
    println!("  a     自动滚动开关");
    println!("  n     循环追加选项 (无 / \\n / \\r / \\r\\n / \\n\\r)");
    println!("  p     插件管理");
    println!("  f     搜索日志");
    println!("  F10   菜单栏开关");
    println!("  F1/?  本帮助");
    println!("  Ctrl+Q 退出程序");
}

fn print_version() {
    println!("{APP_NAME} v{VERSION}");
    println!("\n架构:");
    println!("  pctoolbox-core v{VERSION}");
    println!("  pctoolbox-serial v{VERSION}");
    println!("  pctoolbox-eventbus v{VERSION}");
    println!("  pctoolbox-storage v{VERSION}");
    println!("  pctoolbox-plugin v{VERSION}");
    println!("  pctoolbox-analyzer v{VERSION}");
    println!("  pctoolbox-esp v{VERSION}");
    println!("  pctoolbox-ui v{VERSION}");
}

fn main() -> eframe::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    for arg in &args[1..] {
        match arg.as_str() {
            "-h" | "--help" => {
                print_help();
                process::exit(0);
            }
            "-v" | "--version" => {
                print_version();
                process::exit(0);
            }
            _ => {
                eprintln!("未知选项: {arg}");
                eprintln!("使用 --help 查看帮助");
                process::exit(1);
            }
        }
    }

    // 输出启动信息
    eprintln!("{APP_NAME} v{VERSION} 启动中...");
    eprintln!("检测中文字体支持...");

    let options = eframe::NativeOptions {
        viewport: eframe::egui::ViewportBuilder::default()
            .with_title(APP_NAME)
            .with_inner_size([980.0, 720.0]),
        ..Default::default()
    };
    eframe::run_native(
        APP_NAME,
        options,
        Box::new(|cc| {
            load_chinese_font(&cc.egui_ctx);
            Ok(Box::new(ToolboxApp::new()))
        }),
    )
}

/// 加载中文字体作为 egui 的默认回退字体。
/// Windows 系统自带微软雅黑（msyh.ttc），无需额外下载。
fn load_chinese_font(ctx: &eframe::egui::Context) {
    // Windows 内置字体路径
    let font_paths = [
        (r"C:\Windows\Fonts\msyh.ttc", "Microsoft YaHei"),
        (r"C:\Windows\Fonts\msyhbd.ttc", "Microsoft YaHei Bold"),
        (r"C:\Windows\Fonts\simsun.ttc", "SimSun"),
        (r"C:\Windows\Fonts\STXIHEI.TTF", "STXihei"),
    ];

    for (path, name) in &font_paths {
        match std::fs::read(path) {
            Ok(data) => {
                // 构建完整的字体定义，用中文字体替换默认字体
                let mut fonts = eframe::egui::FontDefinitions::default();
                fonts.font_data.insert(
                    name.to_string(),
                    std::sync::Arc::new(eframe::egui::FontData::from_owned(data)),
                );
                // 将中文字体设为 Proportional 字族的唯一字体（最高优先级）
                fonts
                    .families
                    .get_mut(&eframe::egui::FontFamily::Proportional)
                    .unwrap()
                    .insert(0, name.to_string());
                fonts
                    .families
                    .get_mut(&eframe::egui::FontFamily::Monospace)
                    .unwrap()
                    .insert(0, name.to_string());
                ctx.set_fonts(fonts);
                eprintln!("使用中文字体: {name}");
                return;
            }
            Err(_) => continue,
        }
    }
    eprintln!("警告：未找到中文字体，仍使用默认字体");
}
