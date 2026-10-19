import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { isProcessAlive } from '../src/watchdog.js';

describe('isProcessAlive', () => {
  it('is true for this process', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it('is false for a process that has exited', () => {
    // spawnSync waits for exit, so the child is certainly gone afterwards.
    const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))']);
    const pid = Number(child.stdout.toString());
    expect(pid).toBeGreaterThan(0);
    expect(isProcessAlive(pid)).toBe(false);
  });
});
