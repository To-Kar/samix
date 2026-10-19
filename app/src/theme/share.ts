// Theme files in and out. A theme file is plain data, so importing one is:
// size check → JSON → schema (Ajv) → contrast gate. A palette that fails the
// gate is never repaired silently: the caller gets the failing pairs and can
// ask for the gated version explicitly.

import { InvalidThemeError, parseTheme } from './registry';
import { bodyFamily } from './fonts';
import { gatePalette, resolveTheme, type Correction } from './resolve';
import { DENSITY_FACTOR, MEASURE_DELTA, type Density, type SamixTheme, type ThemeSettings } from './types';

export const MAX_THEME_BYTES = 64 * 1024;

export type ImportResult =
  | { kind: 'ok'; theme: SamixTheme; renamedFrom?: string; replaces?: string }
  /** The file misses the contrast rules; `fixed` is the gated version, `corrections` what it changes. */
  | { kind: 'needs-fix'; fixed: SamixTheme; corrections: Correction[]; renamedFrom?: string; replaces?: string }
  | { kind: 'invalid'; reason: 'too-large' | 'not-json' | 'schema'; details: string[] };

/**
 * Checks a theme file's text. `builtInIds` are reserved: a file reusing one is
 * imported under a free id. A file reusing an own theme's id replaces it.
 */
export function readThemeFile(text: string, builtInIds: string[], ownIds: string[]): ImportResult {
  if (new TextEncoder().encode(text).length > MAX_THEME_BYTES) return { kind: 'invalid', reason: 'too-large', details: [] };

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { kind: 'invalid', reason: 'not-json', details: [e instanceof Error ? e.message : String(e)] };
  }

  let theme: SamixTheme;
  try {
    theme = parseTheme(data, 'import');
  } catch (e) {
    if (e instanceof InvalidThemeError) {
      return { kind: 'invalid', reason: 'schema', details: e.errors.map((err) => `${err.instancePath || '/'} ${err.message}`) };
    }
    throw e;
  }

  let renamedFrom: string | undefined;
  if (builtInIds.includes(theme.id)) {
    renamedFrom = theme.id;
    theme = { ...theme, id: freeId(theme.id, [...builtInIds, ...ownIds]) };
  }

  const replaces = ownIds.includes(theme.id) ? theme.id : undefined;
  const gated = gateTheme(theme);
  if (gated.corrections.length > 0) {
    return { kind: 'needs-fix', fixed: gated.theme, corrections: gated.corrections, renamedFrom, replaces };
  }
  return { kind: 'ok', theme, renamedFrom, replaces };
}

/** Runs every palette of a theme through the gate. */
export function gateTheme(theme: SamixTheme): { theme: SamixTheme; corrections: Correction[] } {
  const modes: SamixTheme['modes'] = {};
  const corrections: Correction[] = [];
  for (const mode of ['light', 'dark'] as const) {
    const palette = theme.modes[mode];
    if (!palette) continue;
    const gated = gatePalette(theme, mode, palette);
    corrections.push(...gated.corrections);
    modes[mode] = gated.palette;
  }
  return { theme: { ...theme, modes }, corrections };
}

export function freeId(base: string, taken: string[]): string {
  const stem = base.replace(/-\d+$/, '').slice(0, 28) || 'theme';
  for (let n = 2; ; n++) {
    const id = `${stem}-${n}`;
    if (!taken.includes(id)) return id;
  }
}

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/ß/g, 'ss')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'theme'
  );
}

/**
 * Bakes the current adjustments (accent, paper tone, body font, measure,
 * density) into a new theme based on `base`. Text size stays a device setting.
 */
export function themeFromSettings(
  base: SamixTheme,
  settings: ThemeSettings,
  name: string,
  takenIds: string[]
): SamixTheme {
  const modes: SamixTheme['modes'] = {};
  for (const mode of ['light', 'dark'] as const) {
    if (!base.modes[mode]) continue;
    // Resolve against the base theme itself, never its light partner.
    modes[mode] = resolveTheme([base], { ...settings, themeId: base.id, mode }, mode === 'dark').palette;
  }
  const slug = slugify(name);
  const id = takenIds.includes(slug) ? freeId(slug, takenIds) : slug;
  const { l10n: _l10n, ...rest } = base;
  return {
    ...rest,
    id,
    name: name.trim().slice(0, 40),
    version: 1,
    stance: base.stance,
    modes,
    type: {
      ...base.type,
      body: { family: bodyFamily(base, settings.bodyFont) },
      measure: Math.min(75, Math.max(45, base.type.measure + MEASURE_DELTA[settings.measure])),
    },
    layout: { ...base.layout, density: combinedDensity(base.layout.density ?? 'normal', settings.density) },
  };
}

/** Theme density × user density, rounded to the nearest step a theme can store. */
function combinedDensity(theme: Density, user: Density): Density {
  const target = DENSITY_FACTOR[theme] * DENSITY_FACTOR[user];
  return (Object.keys(DENSITY_FACTOR) as Density[]).reduce((best, d) =>
    Math.abs(DENSITY_FACTOR[d] - target) < Math.abs(DENSITY_FACTOR[best] - target) ? d : best
  );
}

/** Pretty JSON without undefined fields, ready to save or share. */
export function serializeTheme(theme: SamixTheme): string {
  return JSON.stringify(theme, null, 2) + '\n';
}
