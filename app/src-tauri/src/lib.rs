use serde::Serialize;
use std::process::Child;
use std::sync::Mutex;
use uuid::Uuid;
use tauri::{Manager, Emitter, tray::{TrayIconBuilder, TrayIconEvent}};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

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

#[tauri::command]
fn capture_screen() -> Result<String, String> {
    let tmp = std::env::temp_dir().join("samix-screenshot.png");
    let tmp_str = tmp.to_str().ok_or("invalid temp path")?;

    #[cfg(target_os = "macos")]
    {
        let status = std::process::Command::new("screencapture")
            .args(["-x", "-t", "png", tmp_str])
            .status()
            .map_err(|e| e.to_string())?;
        if !status.success() {
            return Err("screencapture failed".into());
        }
    }

    #[cfg(target_os = "windows")]
    {
        let ps_script = format!(
            "Add-Type -AssemblyName System.Windows.Forms; \
             [System.Windows.Forms.Screen]::PrimaryScreen | ForEach-Object {{ \
               $bmp = New-Object System.Drawing.Bitmap($_.Bounds.Width, $_.Bounds.Height); \
               $g = [System.Drawing.Graphics]::FromImage($bmp); \
               $g.CopyFromScreen($_.Bounds.Location, [System.Drawing.Point]::Empty, $_.Bounds.Size); \
               $bmp.Save('{}'); \
             }}",
            tmp_str.replace('\\', "\\\\")
        );
        let status = std::process::Command::new("powershell")
            .args(["-NoProfile", "-Command", &ps_script])
            .status()
            .map_err(|e| e.to_string())?;
        if !status.success() {
            return Err("screenshot failed".into());
        }
    }

    let data = std::fs::read(&tmp).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&tmp);

    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
    Ok(format!("data:image/png;base64,{}", b64))
}

#[tauri::command]
fn toggle_hud(app: tauri::AppHandle) -> Result<bool, String> {
    if let Some(win) = app.get_webview_window("hud") {
        let visible = win.is_visible().unwrap_or(false);
        if visible {
            win.hide().map_err(|e| e.to_string())?;
        } else {
            win.show().map_err(|e| e.to_string())?;
        }
        Ok(!visible)
    } else {
        Err("HUD window not found".into())
    }
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

            // Global hotkey: CmdOrCtrl+Shift+J — show window + trigger screenshot
            app.global_shortcut().on_shortcut("CmdOrCtrl+Shift+J", |app, _shortcut, event| {
                if event.state() != ShortcutState::Pressed { return; }
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
                let _ = app.emit("screenshot:requested", ());
            })?;

            // Global hotkey: CmdOrCtrl+Shift+H — toggle HUD overlay
            app.global_shortcut().on_shortcut("CmdOrCtrl+Shift+H", |app, _shortcut, event| {
                if event.state() != ShortcutState::Pressed { return; }
                if let Some(win) = app.get_webview_window("hud") {
                    let visible = win.is_visible().unwrap_or(false);
                    if visible {
                        let _ = win.hide();
                    } else {
                        let _ = win.show();
                    }
                }
            })?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_core_config,
            set_autostart,
            get_autostart,
            capture_screen,
            toggle_hud,
            keychain::set_secret,
            keychain::has_secret,
            keychain::delete_secret,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
