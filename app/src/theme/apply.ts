// Writes a resolved theme onto <html> as CSS custom properties + data
// attributes. Tailwind's colour/font tokens read these (tailwind.config.js),
// so components never branch on the theme.

import { hexToTriplet } from './color';
import { bodyFamily, FONT_STACKS } from './fonts';
import type { ResolvedTheme } from './resolve';
import { COLOR_TOKENS, FONT_SCALES, type ThemeSettings } from './types';

const MEASURE_DELTA = { narrow: -8, medium: 0, wide: 8 } as const;
const DENSITY = { compact: 0.8, normal: 1, airy: 1.35 } as const;

export function applyTheme(root: HTMLElement, resolved: ResolvedTheme, settings: ThemeSettings): void {
  const { theme, mode, palette } = resolved;
  const s = root.style;

  for (const token of COLOR_TOKENS) s.setProperty(`--${token}`, hexToTriplet(palette[token]));

  s.setProperty('--font-head', FONT_STACKS[theme.type.headline.family]);
  s.setProperty('--font-body', FONT_STACKS[bodyFamily(theme, settings.bodyFont)]);
  s.setProperty('--font-ui', FONT_STACKS[theme.type.ui.family]);
  s.setProperty('--head-weight', String(theme.type.headline.weight ?? 700));

  // Root size carries the user's scale upwards only, so UI text (≥ text-sm)
  // never drops below 14px; body text takes the full scale either way.
  const scale = FONT_SCALES[settings.fontScale];
  const rootScale = Math.max(1, scale);
  s.fontSize = `${rootScale * 100}%`;
  s.setProperty('--body-size', `${(theme.type.size * scale) / (16 * rootScale)}rem`);
  s.setProperty('--body-leading', String(theme.type.leading));
  const measure = Math.min(75, Math.max(45, theme.type.measure + MEASURE_DELTA[settings.measure]));
  s.setProperty('--measure', `${measure}ch`);
  s.setProperty('--radius', `${theme.shape.radius ?? 0}px`);
  s.setProperty('--rule-width', `${theme.shape.ruleWidth ?? 1}px`);
  s.setProperty('--density', String(DENSITY[theme.layout.density ?? 'normal'] * DENSITY[settings.density]));
  s.colorScheme = mode;

  const d = root.dataset;
  d.theme = theme.id;
  d.mode = mode;
  d.rule = theme.shape.rule ?? 'hairline';
  d.columnRules = String(theme.shape.columnRules ?? false);
  d.masthead = theme.shape.mastheadRule ?? 'single';
  d.kicker = theme.type.kicker ?? 'normal';
  d.columns = String(theme.layout.columns ?? 1);
  d.paragraph = theme.layout.paragraph ?? 'space';
  d.justify = String(theme.layout.justify ?? false);
  d.hyphens = String(theme.layout.hyphens ?? true);
  d.images = theme.images.show ?? 'always';
  d.imageTreatment = theme.images.treatment ?? 'none';
  d.captions = String(theme.images.captionsAlways ?? false);
}
