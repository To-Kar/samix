use serde::Serialize;
use std::env;

mod keychain;

// Phase 0: the Rust shell does NOT auto-spawn the Node core.
// Tom starts `pnpm dev:core` manually in a separate terminal and
// passes SAMIX_PORT + SAMIX_TOKEN into the Tauri dev environment.
// Auto-spawn is a Phase 0.5 polish item — see docs/SAMIX_PHASE_0_CLAUDE_CODE_HANDOFF.md §3.3.

#[derive(Serialize)]
struct CoreConfig {
    port: u16,
    token: String,
}

#[tauri::command]
fn get_core_config() -> Result<CoreConfig, String> {
    let port_str = env::var("SAMIX_PORT")
        .map_err(|_| "SAMIX_PORT env var not set for the Tauri process".to_string())?;
    let port: u16 = port_str
        .parse()
        .map_err(|_| format!("SAMIX_PORT is not a valid u16: {port_str}"))?;
    let token = env::var("SAMIX_TOKEN")
        .map_err(|_| "SAMIX_TOKEN env var not set for the Tauri process".to_string())?;

    Ok(CoreConfig { port, token })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_core_config,
            keychain::set_secret,
            keychain::has_secret,
            keychain::delete_secret,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
