use serde::Serialize;
use std::process::Child;
use std::sync::Mutex;
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
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

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_core_config,
            keychain::set_secret,
            keychain::has_secret,
            keychain::delete_secret,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
