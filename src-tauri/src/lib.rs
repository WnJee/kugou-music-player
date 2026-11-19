// 关闭窗口不等于退出进程：主界面收起来后音频继续在后台播放。
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::WindowEvent;

#[cfg(desktop)]
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Listener, Manager,
};

/// 只有走「真退出」这条路才放行窗口销毁，其余关闭请求一律转成隐藏。
static QUITTING: AtomicBool = AtomicBool::new(false);

/// 「关闭窗口即退出」开关，默认关闭：关窗只收进托盘，音频继续播放。
#[cfg(desktop)]
static CLOSE_TO_QUIT: AtomicBool = AtomicBool::new(false);

/// 托盘自身的偏好文件，与前端各自的 store 文件分开，避免互相覆盖。
#[cfg(desktop)]
const PREFS_STORE: &str = "platform-prefs.json";
#[cfg(desktop)]
const CLOSE_TO_QUIT_KEY: &str = "closeToQuit";

/// 托盘 ID，用来在任意位置取回托盘图标改 tooltip。
#[cfg(desktop)]
const TRAY_ID: &str = "player-tray";

/// 还没收到曲目信息时托盘上显示的占位文案。
#[cfg(desktop)]
const NOW_PLAYING_IDLE: &str = "未在播放";

/// 托盘默认 tooltip，收到曲目信息后会被替换，不再固定为产品名。
#[cfg(desktop)]
const TRAY_TOOLTIP_DEFAULT: &str = "酷狗无损播放器";

// ---- 跨端事件契约：事件名逐字固定，不要改名 ----
// 1. Rust -> 前端 `app:media-control`，payload 为字符串 "toggle" | "next" | "prev"。
// 2. 前端 -> Rust `tray:set-now-playing`，payload 为 "歌名 - 歌手"，用于更新托盘 tooltip 与菜单文本。
// 3. `app:back`：Android 上由 Kotlin 直接往前端派发 DOM 事件，Rust 侧不重复发送。
#[cfg(desktop)]
const EVT_MEDIA_CONTROL: &str = "app:media-control";
#[cfg(desktop)]
const EVT_SET_NOW_PLAYING: &str = "tray:set-now-playing";

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

/// 事件 payload 是 JSON 序列化后的字符串（形如 `"歌名 - 歌手"`），这里还原成纯文本。
#[cfg(desktop)]
fn event_text(raw: &str) -> String {
    serde_json::from_str::<String>(raw).unwrap_or_default()
}

/// 读取「关闭即退出」开关，首次运行没有记录时按默认的隐藏到托盘处理。
#[cfg(desktop)]
fn load_close_to_quit(app: &AppHandle) -> bool {
    use tauri_plugin_store::StoreExt;

    app.store(PREFS_STORE)
        .ok()
        .and_then(|store| store.get(CLOSE_TO_QUIT_KEY).and_then(|value| value.as_bool()))
        .unwrap_or(false)
}

#[cfg(desktop)]
fn save_close_to_quit(app: &AppHandle, value: bool) {
    use tauri_plugin_store::StoreExt;

    if let Ok(store) = app.store(PREFS_STORE) {
        store.set(CLOSE_TO_QUIT_KEY, value);
        let _ = store.save();
    }
}

/// 托盘入口：主界面隐藏后从这里叫回来，同时承担播放控制。
/// macOS 也走这套菜单（菜单栏图标），Dock 重开行为见 run() 里的 Reopen。
#[cfg(desktop)]
fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let close_to_quit = load_close_to_quit(&app.handle());
    CLOSE_TO_QUIT.store(close_to_quit, Ordering::Relaxed);

    let now_playing = MenuItem::with_id(app, "now_playing", NOW_PLAYING_IDLE, false, None::<&str>)?;
    let toggle = MenuItem::with_id(app, "toggle", "播放/暂停", true, None::<&str>)?;
    let prev = MenuItem::with_id(app, "prev", "上一首", true, None::<&str>)?;
    let next = MenuItem::with_id(app, "next", "下一首", true, None::<&str>)?;
    let show = MenuItem::with_id(app, "show", "显示主界面", true, None::<&str>)?;
    let close_quit = CheckMenuItem::with_id(
        app,
        "close_quit",
        "关闭窗口时退出程序",
        true,
        close_to_quit,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;

    let sep_playing = PredefinedMenuItem::separator(app)?;
    let sep_window = PredefinedMenuItem::separator(app)?;
    let sep_quit = PredefinedMenuItem::separator(app)?;

    let menu = Menu::new(app)?;
    menu.append_items(&[
        &now_playing,
        &sep_playing,
        &toggle,
        &prev,
        &next,
        &sep_window,
        &show,
        &close_quit,
        &sep_quit,
        &quit,
    ])?;

    let mut tray = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        // macOS 菜单栏图标的惯例是左键弹菜单；Windows / Linux 左键留给「显示主界面」。
        .show_menu_on_left_click(cfg!(target_os = "macos"))
        .tooltip(TRAY_TOOLTIP_DEFAULT)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "show" => show_main_window(app),
            // 播放控制只把动作转给前端，具体播控逻辑在 PlayerContext 里。
            "toggle" | "prev" | "next" => {
                let action = match event.id().as_ref() {
                    "toggle" => "toggle",
                    "prev" => "prev",
                    _ => "next",
                };
                let _ = app.emit(EVT_MEDIA_CONTROL, action);
            }
            "close_quit" => {
                let next = !CLOSE_TO_QUIT.load(Ordering::Relaxed);
                CLOSE_TO_QUIT.store(next, Ordering::Relaxed);
                let _ = close_quit.set_checked(next);
                save_close_to_quit(app, next);
            }
            "quit" => {
                QUITTING.store(true, Ordering::Relaxed);
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| match event {
            TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } => {
                // macOS 上左键已经用来弹菜单，不重复处理。
                if !cfg!(target_os = "macos") {
                    show_main_window(tray.app_handle());
                }
            }
            TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                ..
            } => show_main_window(tray.app_handle()),
            _ => {}
        });

    if let Some(icon) = app.handle().default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;

    // 前端推当前曲目过来，用来更新 tooltip 与菜单里的曲目行。
    let handle = app.handle().clone();
    app.handle().listen(EVT_SET_NOW_PLAYING, move |event| {
        let text = event_text(event.payload());
        let text = text.trim();
        if let Some(tray) = handle.tray_by_id(TRAY_ID) {
            if text.is_empty() {
                let _ = tray.set_tooltip(Some(TRAY_TOOLTIP_DEFAULT));
            } else {
                let _ = tray.set_tooltip(Some(format!("{TRAY_TOOLTIP_DEFAULT} · {text}")));
            }
        }
        let _ = now_playing.set_text(if text.is_empty() {
            NOW_PLAYING_IDLE.to_string()
        } else {
            format!("正在播放：{text}")
        });
    });

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 单实例插件必须最先注册：第二个实例在这里把参数交给已运行的实例后立即退出，
    // 避免两份进程同时出声并互相覆盖 store 文件。
    #[cfg(desktop)]
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_main_window(app)
        }))
        // 窗口尺寸 / 位置 / 最大化状态在重启后恢复，tauri.conf.json 里的 1100x720 只是初始值。
        .plugin(tauri_plugin_window_state::Builder::default().build());
    #[cfg(not(desktop))]
    let builder = tauri::Builder::default();

    let app = builder
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            #[cfg(desktop)]
            setup_tray(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if QUITTING.load(Ordering::Relaxed) {
                    return;
                }
                // 开关打开时「关闭」就是真退出，否则一律收起来继续后台播放。
                #[cfg(desktop)]
                if CLOSE_TO_QUIT.load(Ordering::Relaxed) {
                    QUITTING.store(true, Ordering::Relaxed);
                    window.app_handle().exit(0);
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
