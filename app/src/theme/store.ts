// Appearance is a per-device preference (a phone client may want another
// theme than the desktop), so it lives in the WebView's storage rather than
// in the core DB. Shared theme *files* are a separate concern.

import { normalizeHex } from './color';
import { DEFAULT_SETTINGS, FONT_SCALES, type ThemeSettings } from './types';

const KEY = 'samix.appearance.v1';

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;

const intIn = (value: unknown, min: number, max: number, fallback: number): number =>
  Number.isInteger(value) && (value as number) >= min && (value as number) <= max ? (value as number) : fallback;

/** Coerces anything (old versions, hand edits) into valid settings. */
export function sanitizeSettings(raw: unknown): ThemeSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  const partners = r.lightPartners && typeof r.lightPartners === 'object' ? r.lightPartners : {};
  return {
    themeId: typeof r.themeId === 'string' ? r.themeId : d.themeId,
    mode: oneOf(r.mode, ['light', 'dark', 'system'] as const, d.mode),
    lightPartners: Object.fromEntries(
      Object.entries(partners).filter((e): e is [string, string] => typeof e[1] === 'string')
    ),
    fontScale: intIn(r.fontScale, 0, FONT_SCALES.length - 1, d.fontScale),
    bodyFont: oneOf(r.bodyFont, ['theme', 'serif', 'sans', 'readable'] as const, d.bodyFont),
    measure: oneOf(r.measure, ['narrow', 'medium', 'wide'] as const, d.measure),
    density: oneOf(r.density, ['compact', 'normal', 'airy'] as const, d.density),
    accent: typeof r.accent === 'string' ? normalizeHex(r.accent) : null,
    paperTone: intIn(r.paperTone, -3, 3, d.paperTone),
  };
}

export function loadSettings(): ThemeSettings {
  try {
    const raw = localStorage.getItem(KEY);
    return sanitizeSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: ThemeSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable: the choice holds for this session only.
  }
}
