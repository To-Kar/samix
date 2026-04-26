use serde::Serialize;
use std::process::Child;
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};
use tauri_plugin_autostart::MacosLauncher;
use uuid::Uuid;

mod keychain;
mod spawn;

/// Holds the auto-spawned core's connection details and process handle.
/// Managed as Tauri app state so `get_core_config` can read port+token
/// without env-var coupling.
pub struct AppState {
    pub port: u16,
    pub token: String,
    pub child: Mutex<Option<Child>>,
}

impl Drop for AppState {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
            }
        }
    }
}

#[derive(Serialize)]
struct CoreConfig {
    port: u16,
    token: String,
}

#[tauri::command]
fn get_core_config(state: tauri::State<AppState>) -> Result<CoreConfig, String> {
    Ok(CoreConfig {
        port: state.port,
        token: state.token.clone(),
    })
}

#[tauri::command]
fn set_autostart(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    if enabled {
        app.autolaunch().enable()
    } else {
        app.autolaunch().disable()
    }
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn is_autostart_enabled(app: tauri::AppHandle) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .setup(|app| {
            let port = spawn::free_port()?;
            let token = Uuid::new_v4().to_string();
            let child = spawn::spawn_core(port, &token)?;

            // Best-effort: wait up to 15 s for the core to accept connections.
            // The ConnectionBanner handles reconnect if startup takes longer
            // (e.g. cold tsx compilation on a slow machine).
            if !spawn::wait_for_ready(port, std::time::Duration::from_secs(15)) {
                eprintln!(
                    "[samix] core did not become ready within 15 s on port {port}; \
                     the UI will retry automatically"
                );
            }

            app.manage(AppState {
                port,
                token,
                child: Mutex::new(Some(child)),
            });

            let show_item = MenuItem::with_id(app, "show", "Show Samix", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Samix")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => {
                        if let Some(state) = app.try_state::<AppState>() {
                            if let Ok(mut g) = state.child.lock() {
                                if let Some(mut c) = g.take() {
                                    let _ = c.kill();
                                }
                            }
                        }
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        if let Some(w) = tray.app_handle().get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_core_config,
            keychain::set_secret,
            keychain::has_secret,
            keychain::delete_secret,
            set_autostart,
            is_autostart_enabled,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
