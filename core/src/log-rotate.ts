import { existsSync, renameSync, rmSync, statSync } from 'node:fs';

// Size-based rotation, done once at startup: core.log → core.log.1 → core.log.2.
// Enough to keep a long-running desktop app from filling the disk, without a
// logging dependency.
export function rotateLog(path: string, maxBytes = 5 * 1024 * 1024, keep = 2): void {
  if (!existsSync(path) || statSync(path).size < maxBytes) return;
  rmSync(`${path}.${keep}`, { force: true });
  for (let i = keep - 1; i >= 1; i--) {
    if (existsSync(`${path}.${i}`)) renameSync(`${path}.${i}`, `${path}.${i + 1}`);
  }
  renameSync(path, `${path}.1`);
}
