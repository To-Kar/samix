import { openUrl } from '@tauri-apps/plugin-opener';

// Opens a link in the system browser. Falls back to window.open when running
// in a plain browser (vite dev without Tauri).
export function openExternal(url: string): void {
  openUrl(url).catch(() => {
    window.open(url, '_blank', 'noopener,noreferrer');
  });
}
