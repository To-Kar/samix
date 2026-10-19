// The Tauri shell spawns the core through pnpm → tsx → node, and killing the
// first process does not reliably kill the rest; a crashed or force-quit app
// never runs its cleanup at all. So the core watches its parent instead and
// exits when it is gone — same behaviour on macOS and Windows.

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: the process exists but belongs to someone else.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function watchParent(
  pid: number,
  onGone: () => void,
  intervalMs = 2000
): NodeJS.Timeout {
  const timer = setInterval(() => {
    if (!isProcessAlive(pid)) {
      clearInterval(timer);
      onGone();
    }
  }, intervalMs);
  timer.unref();
  return timer;
}
