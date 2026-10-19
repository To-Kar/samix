// Shape of a `samix-theme/1` file. The JSON schema next to the built-in
// themes (themes/samix-theme.schema.json) is the normative definition; keep
// both in sync when adding a field.

export const COLOR_TOKENS = [
  'paper',
  'paper-raised',
  'ink',
  'ink-soft',
  'rule',
  'line',
  'accent',
  'on-accent',
  'mark',
  'focus',
  'danger',
  'danger-paper',
  'warning',
  'warning-paper',
] as const;

export type ColorToken = (typeof COLOR_TOKENS)[number];
export type Palette = Record<ColorToken, string>;
export type Mode = 'light' | 'dark';

export const FONT_FAMILIES = [
  'Newsreader',
  'Source Serif 4',
  'Source Sans 3',
  'Literata',
  'EB Garamond',
  'Atkinson Hyperlegible',
] as const;
export type FontFamily = (typeof FONT_FAMILIES)[number];

export interface FontSpec {
  family: FontFamily;
  weight?: number;
  style?: 'normal' | 'italic';
}

export interface SamixTheme {
  format: 'samix-theme/1';
  id: string;
  name: string;
  version: number;
  author?: string;
  stance?: string;
  /** Translations of name/stance keyed by language code; `name` is the default. */
  l10n?: Record<string, { name: string; stance?: string }>;
  /** Text contrast target: AA = 4.5:1 (default), AAA = 7:1. */
  contrast?: 'AA' | 'AAA';
  darkOnly?: boolean;
  /** Theme id used in the light case of "follow system" when darkOnly. */
  lightPartner?: string;
  modes: Partial<Record<Mode, Palette>>;
  type: {
    headline: FontSpec;
    body: FontSpec;
    ui: FontSpec;
    serif?: FontSpec;
    sans?: FontSpec;
    size: number;
    leading: number;
    measure: number;
    headlineCase?: 'normal';
    kicker?: 'normal' | 'uppercase' | 'small-caps';
  };
  shape: {
    radius?: number;
    rule?: 'none' | 'hairline' | 'solid' | 'ornament';
    ruleWidth?: 1 | 2;
    columnRules?: boolean;
    mastheadRule?: 'none' | 'single' | 'double' | 'thick' | 'short';
  };
  layout: {
    density?: Density;
    columns?: 1 | 2 | 3;
    paragraph?: 'space' | 'indent';
    justify?: boolean;
    hyphens?: boolean;
  };
  images: {
    show?: 'always' | 'lead-only' | 'never';
    treatment?: 'none' | 'grayscale' | 'sepia' | 'muted' | 'dimmed';
    captionsAlways?: boolean;
  };
}

export type Density = 'compact' | 'normal' | 'airy';

/** Per-device appearance preferences (persisted locally, see store.ts). */
export interface ThemeSettings {
  themeId: string;
  mode: Mode | 'system';
  /** Light partner chosen per dark-only theme; falls back to the theme's own. */
  lightPartners: Record<string, string>;
  /** Index into FONT_SCALES. */
  fontScale: number;
  bodyFont: 'theme' | 'serif' | 'sans' | 'readable';
  measure: 'narrow' | 'medium' | 'wide';
  density: Density;
  /** User accent as picked (hex), never the contrast-adjusted value. */
  accent: string | null;
  /** -3 (warmer) … 3 (cooler); 0 = the theme's own paper. */
  paperTone: number;
}

export const FONT_SCALES = [0.9, 1, 1.15, 1.25, 1.4] as const;

/** Spacing multiplier per density step; theme and user steps multiply. */
export const DENSITY_FACTOR: Record<Density, number> = { compact: 0.8, normal: 1, airy: 1.35 };

/** Characters added to the theme's measure per user step (result kept in 45–75). */
export const MEASURE_DELTA: Record<ThemeSettings['measure'], number> = { narrow: -8, medium: 0, wide: 8 };

export const DEFAULT_SETTINGS: ThemeSettings = {
  themeId: 'zeitung',
  mode: 'system',
  lightPartners: {},
  fontScale: 1,
  bodyFont: 'theme',
  measure: 'medium',
  density: 'normal',
  accent: null,
  paperTone: 0,
};
