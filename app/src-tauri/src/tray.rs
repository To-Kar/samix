use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager};

/// Brings the main window back (it is hidden, not closed, so the core and the
/// scheduler keep running while the window is away).
pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Menu-bar (macOS) / notification-area (Windows) icon.
///
/// "Update now" is carried out by the UI: the window stays alive when hidden,
/// and the core speaks HTTP to the UI only — no business logic in Rust.
pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Zeitung öffnen", true, None::<&str>)?;
    let run = MenuItem::with_id(app, "run", "Jetzt aktualisieren", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Beenden", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &run, &quit])?;

    let mut builder = TrayIconBuilder::with_id("main")
        .menu(&menu)
        .tooltip("Samix")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main_window(app),
            "run" => {
                show_main_window(app);
                let _ = app.emit("run-now", ());
            }
            "quit" => app.exit(0),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}
