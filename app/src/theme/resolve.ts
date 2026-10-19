// Turns a theme + the user's settings into the palette that is actually
// painted. Every user-influenced colour passes the contrast gate here; each
// adjustment is returned as a Correction so the UI can report it.

import { bestOn, contrast, fitLightness, shiftTone } from './color';
import type { ColorToken, Mode, Palette, SamixTheme, ThemeSettings } from './types';

export interface ContrastRule {
  fg: ColorToken;
  bg: ColorToken;
  min: number;
}

export function contrastRules(theme: SamixTheme): ContrastRule[] {
  const text = theme.contrast === 'AAA' ? 7 : 4.5;
  return [
    { fg: 'ink', bg: 'paper', min: text },
    { fg: 'ink', bg: 'paper-raised', min: text },
    { fg: 'ink', bg: 'mark', min: text },
    { fg: 'ink-soft', bg: 'paper', min: text },
    { fg: 'ink-soft', bg: 'paper-raised', min: text },
    { fg: 'accent', bg: 'paper', min: text },
    { fg: 'accent', bg: 'paper-raised', min: text },
    { fg: 'on-accent', bg: 'accent', min: text },
    { fg: 'danger', bg: 'danger-paper', min: text },
    { fg: 'warning', bg: 'warning-paper', min: text },
    { fg: 'line', bg: 'paper', min: 3 },
    { fg: 'focus', bg: 'paper', min: 3 },
    { fg: 'focus', bg: 'paper-raised', min: 3 },
  ];
}

export interface Correction {
  token: ColorToken;
  mode: Mode;
  from: string;
  to: string;
  /** Lowest ratio against the token's grounds, before and after. */
  before: number;
  after: number;
}

export interface Failure extends ContrastRule {
  ratio: number;
}

export interface ResolvedTheme {
  /** The theme whose palette is painted (the light partner, if one stepped in). */
  theme: SamixTheme;
  /** The theme the user selected. */
  selected: SamixTheme;
  mode: Mode;
  palette: Palette;
  corrections: Correction[];
  /** Rules still failing after the gate. Empty for every valid theme. */
  failures: Failure[];
}

export function findTheme(themes: SamixTheme[], id: string): SamixTheme {
  return themes.find((t) => t.id === id) ?? themes[0];
}

/** Which theme and mode apply, honouring "follow system" and light partners. */
export function pickTheme(
  themes: SamixTheme[],
  settings: ThemeSettings,
  systemDark: boolean
): { theme: SamixTheme; selected: SamixTheme; mode: Mode } {
  const selected = findTheme(themes, settings.themeId);
  const wanted: Mode = settings.mode === 'system' ? (systemDark ? 'dark' : 'light') : settings.mode;
  if (selected.modes[wanted]) return { theme: selected, selected, mode: wanted };
  if (wanted === 'light') {
    const partnerId = settings.lightPartners[selected.id] ?? selected.lightPartner;
    const partner = themes.find((t) => t.id === partnerId && t.modes.light) ?? themes.find((t) => t.modes.light);
    if (partner) return { theme: partner, selected, mode: 'light' };
  }
  // A theme without the wanted mode and no partner: use the mode it has.
  return { theme: selected, selected, mode: selected.modes.light ? 'light' : 'dark' };
}

const minAgainst = (fg: string, grounds: string[]) => Math.min(...grounds.map((g) => contrast(fg, g)));

export interface GateResult {
  palette: Palette;
  corrections: Correction[];
  failures: Failure[];
}

/**
 * The contrast gate. Every foreground that misses one of its rules is moved
 * in OKLCH lightness until it passes on all its grounds; `on-accent` becomes
 * black or white. `accentDrivesFocus` makes the focus ring follow the accent
 * (used when the user picked the accent).
 */
export function gatePalette(theme: SamixTheme, mode: Mode, input: Palette, accentDrivesFocus = false): GateResult {
  const palette: Palette = { ...input };
  const corrections: Correction[] = [];
  const rules = contrastRules(theme);
  const textMin = rules.find((r) => r.fg === 'on-accent')!.min;

  const fit = (fg: ColorToken, extra: (c: string) => boolean = () => true) => {
    const own = rules.filter((r) => r.fg === fg);
    const grounds = own.map((r) => palette[r.bg]);
    const ok = (c: string) => own.every((r) => contrast(c, palette[r.bg]) >= r.min) && extra(c);
    const from = palette[fg];
    const to = fitLightness(from, grounds, ok);
    if (to !== from) {
      corrections.push({ token: fg, mode, from, to, before: minAgainst(from, grounds), after: minAgainst(to, grounds) });
      palette[fg] = to;
    }
  };

  for (const fg of ['ink', 'ink-soft', 'line', 'danger', 'warning'] as const) fit(fg);
  // Accent must also carry readable text on itself (primary buttons).
  fit('accent', (c) => contrast(bestOn(c), c) >= textMin);

  if (contrast(palette['on-accent'], palette.accent) < textMin) {
    const from = palette['on-accent'];
    palette['on-accent'] = bestOn(palette.accent);
    corrections.push({
      token: 'on-accent',
      mode,
      from,
      to: palette['on-accent'],
      before: contrast(from, palette.accent),
      after: contrast(palette['on-accent'], palette.accent),
    });
  }

  if (accentDrivesFocus) palette.focus = palette.accent;
  else fit('focus');

  const failures = rules
    .map((r) => ({ ...r, ratio: contrast(palette[r.fg], palette[r.bg]) }))
    .filter((r) => r.ratio < r.min);

  return { palette, corrections, failures };
}

export function resolveTheme(
  themes: SamixTheme[],
  settings: ThemeSettings,
  systemDark: boolean
): ResolvedTheme {
  const { theme, selected, mode } = pickTheme(themes, settings, systemDark);
  const base = theme.modes[mode];
  if (!base) throw new Error(`theme ${theme.id} has no ${mode} palette`);
  const palette: Palette = { ...base };

  if (settings.paperTone !== 0) {
    for (const token of ['paper', 'paper-raised', 'rule'] as const) {
      palette[token] = shiftTone(palette[token], settings.paperTone);
    }
  }
  if (settings.accent) {
    palette.accent = settings.accent;
    palette['on-accent'] = bestOn(settings.accent);
  }

  return { theme, selected, mode, ...gatePalette(theme, mode, palette, settings.accent !== null) };
}
