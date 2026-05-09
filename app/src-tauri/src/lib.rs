use serde::Serialize;
use std::process::Child;
use std::sync::Mutex;
use uuid::Uuid;
use tauri::{Manager, tray::{TrayIconBuilder, TrayIconEvent}};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_global_shortcut::GlobalShortcutExt;

mod keychain;
mod spawn;

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
    let manager = app.autolaunch();
    if enabled {
        manager.enable().map_err(|e| e.to_string())?;
    } else {
        manager.disable().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn get_autostart(app: tauri::AppHandle) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec![])))
        .setup(|app| {
            let port = spawn::free_port()?;
            let token = Uuid::new_v4().to_string();
            let child = spawn::spawn_core(port, &token)?;

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

            // System tray
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Samix")
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { .. } = event {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            // Global hotkey: CmdOrCtrl+Shift+J
            app.global_shortcut().on_shortcut("CmdOrCtrl+Shift+J", |app, _shortcut, _event| {
                if let Some(window) = app.get_webview_window("main") {
                    if window.is_visible().unwrap_or(false) {
                        let _ = window.hide();
                    } else {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            })?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_core_config,
            set_autostart,
            get_autostart,
            keychain::set_secret,
            keychain::has_secret,
            keychain::delete_secret,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
