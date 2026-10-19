use keyring::Entry;
use std::fs::{self, File};
use std::net::TcpListener;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

/// Keychain accounts whose values are handed to the core as environment
/// variables of the same name. A missing key is simply left out: the core's
/// adapters then report themselves as unavailable.
const SECRET_ACCOUNTS: &[&str] = &["ANTHROPIC_API_KEY", "PERPLEXITY_API_KEY", "DEEPSEEK_API_KEY"];

fn read_secret(account: &str) -> Option<String> {
    Entry::new("samix", account).ok()?.get_password().ok()
}

/// Bind to port 0 so the OS assigns a free port, read it, then close the
/// listener. There is a small TOCTOU race window (documented in ADR-004) but
/// it is acceptable for dev-mode localhost use.
pub fn free_port() -> Result<u16, std::io::Error> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    Ok(listener.local_addr()?.port())
}

/// True when running from `tauri dev` (the core is started through pnpm);
/// false in an installed app (the core is the bundled one).
pub fn is_dev() -> bool {
    cfg!(debug_assertions)
}

/// Starts the core with the given port/token and any API keys from the OS
/// keychain.
pub fn spawn_core(app: &AppHandle, port: u16, token: &str) -> Result<Child, String> {
    let mut cmd = if is_dev() { dev_command() } else { release_command(app)? };

    cmd.env("SAMIX_PORT", port.to_string())
        .env("SAMIX_TOKEN", token)
        // The core exits when this process is gone, so it never outlives the app.
        .env("SAMIX_PARENT_PID", std::process::id().to_string())
        .stdin(Stdio::null());

    for account in SECRET_ACCOUNTS {
        if let Some(value) = read_secret(account) {
            cmd.env(account, value);
        }
    }

    // A GUI app must not flash a console window for the core on Windows.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    cmd.spawn().map_err(|e| format!("could not start the core: {e}"))
}

/// `tauri dev`: run the core from the repo through pnpm (tsx watch).
fn dev_command() -> Command {
    #[cfg(target_os = "windows")]
    let pnpm = "pnpm.cmd";
    #[cfg(not(target_os = "windows"))]
    let pnpm = "pnpm";

    let mut cmd = Command::new(pnpm);
    cmd.args(["--filter", "samix-core", "dev"])
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());
    cmd
}

/// Installed app: the Node binary shipped next to the executable (Tauri
/// sidecar) runs the bundled core from the resource directory. Data (database,
/// cached images, editable agents) lives in the per-user app data folder, the
/// log in the OS log folder.
fn release_command(app: &AppHandle) -> Result<Command, String> {
    let paths = app.path();
    let core_dir = paths.resource_dir().map_err(|e| e.to_string())?.join("core");
    let server = core_dir.join("server.mjs");
    if !server.exists() {
        return Err(format!("core bundle not found: {}", server.display()));
    }

    let exe_dir = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .parent()
        .map(Path::to_path_buf)
        .ok_or("cannot locate the executable's folder")?;
    let node = exe_dir.join(if cfg!(windows) { "node.exe" } else { "node" });
    if !node.exists() {
        return Err(format!("bundled Node.js not found: {}", node.display()));
    }

    let data_dir = paths.app_data_dir().map_err(|e| e.to_string())?;
    let log_dir = paths.app_log_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(&log_dir).map_err(|e| e.to_string())?;

    // The core logs to its own file; whatever Node itself prints before that
    // (a missing module, a crash at startup) would be lost, so keep it too.
    let stderr = File::create(log_dir.join("core-stderr.log")).map_err(|e| e.to_string())?;

    let mut cmd = Command::new(node);
    cmd.arg("--disable-warning=ExperimentalWarning")
        .arg(&server)
        .current_dir(&core_dir)
        .env("NODE_ENV", "production")
        .env("DATABASE_URL", format!("file:{}", env_path(&data_dir.join("samix.db"))))
        .env("SAMIX_AGENTS_DIR", env_path(&data_dir.join("agents")))
        .env("SAMIX_BUNDLED_AGENTS_DIR", env_path(&core_dir.join("agents")))
        .env("SAMIX_MIGRATIONS_DIR", env_path(&core_dir.join("prisma").join("migrations")))
        .env("SAMIX_LOG_FILE", env_path(&log_dir.join("core.log")))
        .stdout(Stdio::null())
        .stderr(Stdio::from(stderr));
    Ok(cmd)
}

/// A path as the core should see it: forward slashes (Prisma wants them in
/// `file:` URLs) and without Windows' `\\?\` verbatim prefix.
fn env_path(p: &Path) -> String {
    let s = p.to_string_lossy().replace('\\', "/");
    s.strip_prefix("//?/").map(str::to_string).unwrap_or(s)
}

/// Poll TCP connect until the port accepts connections or the timeout expires.
/// Returns true when ready, false on timeout.
pub fn wait_for_ready(port: u16, timeout: Duration) -> bool {
    let addr = format!("127.0.0.1:{port}");
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if std::net::TcpStream::connect(&addr).is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(300));
    }
    false
}

#[cfg(test)]
mod tests {
    use super::env_path;
    use std::path::Path;

    #[test]
    fn unix_paths_are_unchanged() {
        assert_eq!(
            env_path(Path::new("/Users/tom/Library/Application Support/app.samix/samix.db")),
            "/Users/tom/Library/Application Support/app.samix/samix.db"
        );
    }

    #[test]
    fn windows_backslashes_become_forward_slashes() {
        assert_eq!(
            env_path(Path::new(r"C:\Users\Tom\AppData\Roaming\app.samix\samix.db")),
            "C:/Users/Tom/AppData/Roaming/app.samix/samix.db"
        );
    }

    #[test]
    fn windows_verbatim_prefix_is_removed() {
        assert_eq!(
            env_path(Path::new(r"\\?\C:\Program Files\Samix\core")),
            "C:/Program Files/Samix/core"
        );
    }
}
