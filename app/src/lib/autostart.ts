import { invoke } from '@tauri-apps/api/core';

export const setAutostart = (enabled: boolean): Promise<void> =>
  invoke('set_autostart', { enabled });

export const isAutostartEnabled = (): Promise<boolean> =>
  invoke('is_autostart_enabled');
