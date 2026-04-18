// OS-keychain access for Samix secrets.
//
// Design invariant: secrets leave Rust only via spawn env for the core
// child process (Phase 1 step 11). There is deliberately no `get_secret`
// command — the UI observes existence via `has_secret` and writes via
// `set_secret`, never reads values back.
//
// Service name is `samix`; account is the env-var name the core expects
// (e.g. `ANTHROPIC_API_KEY`). That symmetry lets the spawn step iterate
// a flat list instead of maintaining a mapping table.

use keyring::Entry;

const SERVICE: &str = "samix";

#[tauri::command]
pub fn set_secret(account: String, value: String) -> Result<(), String> {
    let entry = Entry::new(SERVICE, &account).map_err(|e| e.to_string())?;
    entry.set_password(&value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn has_secret(account: String) -> bool {
    Entry::new(SERVICE, &account)
        .and_then(|e| e.get_password().map(|_| ()))
        .is_ok()
}

#[tauri::command]
pub fn delete_secret(account: String) -> Result<(), String> {
    let entry = Entry::new(SERVICE, &account).map_err(|e| e.to_string())?;
    // VERIFY: keyring v3 method name — was `delete_password` in v2.
    entry.delete_credential().map_err(|e| e.to_string())
}
