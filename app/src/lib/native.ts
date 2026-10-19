import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart';
import { revealItemInDir } from '@tauri-apps/plugin-opener';

// Everything that talks to the Tauri shell lives here. Each function also
// works in a plain browser (`vite dev` without Tauri) by saying "unavailable"
// instead of throwing, so the UI can be developed and checked there.

export const inTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** An installed build, as opposed to `tauri dev` / a plain browser. */
export const isInstalledApp = (): boolean => inTauri() && !import.meta.env.DEV;

export type RestartResult = { restarted: true } | { restarted: false; reason: string };

// Restarts the core so a changed API key takes effect (see restart_core in Rust).
export async function restartCore(): Promise<RestartResult> {
  if (!inTauri()) return { restarted: false, reason: 'not running inside the app' };
  try {
    await invoke('restart_core');
    return { restarted: true };
  } catch (e) {
    return { restarted: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

export async function revealLogFile(): Promise<void> {
  const paths = await invoke<{ log_file: string }>('get_app_paths');
  await revealItemInDir(paths.log_file);
}

export const autostart = {
  async isEnabled(): Promise<boolean> {
    return isInstalledApp() ? isEnabled() : false;
  },
  async set(on: boolean): Promise<void> {
    if (!isInstalledApp()) throw new Error('autostart is only available in the installed app');
    await (on ? enable() : disable());
  },
};

// The tray menu's "Jetzt aktualisieren" arrives as an event; the (possibly
// hidden) window is what talks to the core.
export function onTrayRunNow(handler: () => void): () => void {
  if (!inTauri()) return () => undefined;
  let stop: (() => void) | undefined;
  let cancelled = false;
  void listen('run-now', handler).then((un) => {
    if (cancelled) un();
    else stop = un;
  });
  return () => {
    cancelled = true;
    stop?.();
  };
}

// Opens the system's folder picker. Only inside the app (a plain browser has
// none); returns null if the reader cancels or there is no dialog.
export async function pickFolder(title: string): Promise<string | null> {
  if (!inTauri()) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const chosen = await open({ directory: true, multiple: false, title });
  return typeof chosen === 'string' ? chosen : null;
}

// "Mein Projekt" from "/Users/me/Projekte/Mein Projekt/".
export function folderName(path: string): string {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '';
}
