// 关闭窗口不等于退出进程：主界面收起来后音频继续在后台播放。
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::WindowEvent;

#[cfg(desktop)]
use tauri::{AppHandle, Manager};

/// 只有走「真退出」这条路才放行窗口销毁，其余关闭请求一律转成隐藏。
static QUITTING: AtomicBool = AtomicBool::new(false);

/// unminimize 只存在于桌面端的 WebviewWindow，移动端没有这个概念。
#[cfg(desktop)]
fn show_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

/// 托盘入口：Windows / Linux 上主界面隐藏后任务栏不再有图标，只能从这里叫回来。
#[cfg(all(desktop, not(target_os = "macos")))]
fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::TrayIconBuilder;

    let show = MenuItem::with_id(app, "show", "显示主界面", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    let mut tray = TrayIconBuilder::with_id("player-tray")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .tooltip("KuGouPlayer")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_main_window(app),
            "quit" => {
                QUITTING.store(true, Ordering::Relaxed);
                app.exit(0);
            }
            _ => {}
        });
    if let Some(icon) = app.handle().default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|_app| {
            #[cfg(all(desktop, not(target_os = "macos")))]
            setup_tray(_app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if QUITTING.load(Ordering::Relaxed) {
                    return;
                }
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app, event| {
        #[cfg(not(target_os = "macos"))]
        let _ = app;

        match event {
            // ⌘Q / exit() / 更新重启都走这里，放行后再销毁窗口
            tauri::RunEvent::ExitRequested { .. } => {
                QUITTING.store(true, Ordering::Relaxed);
            }
            // macOS: 窗口全关后点 Dock 图标把主界面叫回来
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen {
                has_visible_windows,
                ..
            } => {
                if !has_visible_windows {
                    show_main_window(app);
                }
            }
            _ => {}
        }
    });
}
