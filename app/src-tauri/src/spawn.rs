use keyring::Entry;
use std::net::TcpListener;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

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

/// Spawn `pnpm --filter samix-core dev` with the generated port/token and any
/// API keys that are already stored in the OS keychain. Missing keys are silently
/// omitted — the adapters will self-disable at core startup.
pub fn spawn_core(port: u16, token: &str) -> Result<Child, std::io::Error> {
    #[cfg(target_os = "windows")]
    let pnpm = "pnpm.cmd";
    #[cfg(not(target_os = "windows"))]
    let pnpm = "pnpm";

    let mut cmd = Command::new(pnpm);
    cmd.args(["--filter", "samix-core", "dev"])
        .env("SAMIX_PORT", port.to_string())
        .env("SAMIX_TOKEN", token)
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());

    for account in &["ANTHROPIC_API_KEY", "PERPLEXITY_API_KEY"] {
        if let Some(value) = read_secret(account) {
            cmd.env(account, value);
        }
    }

    cmd.spawn()
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
