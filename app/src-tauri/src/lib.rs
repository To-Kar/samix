use serde::Serialize;
use std::process::Child;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Manager, RunEvent, WindowEvent};
use uuid::Uuid;

mod keychain;
mod spawn;
mod tray;

/// Holds the auto-spawned core's connection details and process handle.
/// Managed as Tauri app state so `get_core_config` can read port+token
/// without env-var coupling.
pub struct AppState {
    pub port: u16,
    pub token: String,
    pub child: Mutex<Option<Child>>,
    /// Closing the window only hides it when there is a tray icon to bring it
    /// back from; without one, closing quits (otherwise the app is unreachable).
    pub tray_ok: AtomicBool,
}

impl AppState {
    fn kill_core(&self) {
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

impl Drop for AppState {
    fn drop(&mut self) {
        self.kill_core();
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

#[derive(Serialize)]
struct AppPaths {
    data_dir: String,
    log_dir: String,
    log_file: String,
}

/// Where the installed app keeps its data and logs (for "open logs folder").
#[tauri::command]
fn get_app_paths(app: tauri::AppHandle) -> Result<AppPaths, String> {
    let paths = app.path();
    let data_dir = paths.app_data_dir().map_err(|e| e.to_string())?;
    let log_dir = paths.app_log_dir().map_err(|e| e.to_string())?;
    Ok(AppPaths {
        data_dir: data_dir.to_string_lossy().into_owned(),
        log_file: log_dir.join("core.log").to_string_lossy().into_owned(),
        log_dir: log_dir.to_string_lossy().into_owned(),
    })
}

/// Restarts the core with the same port and token, re-reading the keychain —
/// so a freshly saved API key takes effect without restarting the app.
/// Only for the installed app: a `tauri dev` core runs under pnpm, whose
/// children this process cannot reliably stop.
#[tauri::command]
async fn restart_core(app: tauri::AppHandle) -> Result<(), String> {
    if spawn::is_dev() {
        return Err("restarting the core is only available in the installed app; restart `pnpm dev:app`".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        state.kill_core();
        let child = spawn::spawn_core(&app, state.port, &state.token)?;
        if let Ok(mut guard) = state.child.lock() {
            *guard = Some(child);
        }
        if spawn::wait_for_ready(state.port, Duration::from_secs(20)) {
            Ok(())
        } else {
            Err("the core did not come back within 20 s; see the log folder".to_string())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // Launched at login with --hidden: start in the menu bar, window closed.
        .plugin(tauri_plugin_autostart::Builder::new().args(["--hidden"]).build())
        .setup(|app| {
            let handle = app.handle().clone();
            let port = spawn::free_port()?;
            let token = Uuid::new_v4().to_string();
            let child = spawn::spawn_core(&handle, port, &token)?;

            // Best-effort: wait up to 15 s for the core to accept connections.
            // The ConnectionBanner handles reconnect if startup takes longer
            // (e.g. cold tsx compilation on a slow machine).
            if !spawn::wait_for_ready(port, Duration::from_secs(15)) {
                eprintln!(
                    "[samix] core did not become ready within 15 s on port {port}; \
                     the UI will retry automatically"
                );
            }

            app.manage(AppState {
                port,
                token,
                child: Mutex::new(Some(child)),
                tray_ok: AtomicBool::new(false),
            });

            match tray::create(&handle) {
                Ok(()) => app.state::<AppState>().tray_ok.store(true, Ordering::SeqCst),
                Err(e) => eprintln!("[samix] tray icon unavailable, closing the window will quit: {e}"),
            }

            // The window starts hidden (see tauri.conf.json) so an autostart
            // at login can stay in the menu bar.
            let hidden = std::env::args().any(|a| a == "--hidden")
                && app.state::<AppState>().tray_ok.load(Ordering::SeqCst);
            if !hidden {
                tray::show_main_window(&handle);
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let can_hide = window
                    .try_state::<AppState>()
                    .map(|s| s.tray_ok.load(Ordering::SeqCst))
                    .unwrap_or(false);
                if can_hide {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_core_config,
            get_app_paths,
            restart_core,
            keychain::set_secret,
            keychain::has_secret,
            keychain::delete_secret,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| match event {
        RunEvent::Exit => {
            if let Some(state) = app_handle.try_state::<AppState>() {
                state.kill_core();
            }
        }
        // Clicking the Dock icon while the window is hidden brings it back.
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { has_visible_windows, .. } => {
            if !has_visible_windows {
                tray::show_main_window(app_handle);
            }
        }
        _ => {}
    });
}
