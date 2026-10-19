import { describe, expect, it } from 'vitest';
import { contrast, shiftTone } from './color';
import { BUILT_IN_THEMES } from './registry';
import { contrastRules, resolveTheme } from './resolve';
import { gateTheme, readThemeFile, serializeTheme, themeFromSettings } from './share';
import { sanitizeSettings } from './store';
import { DEFAULT_SETTINGS, type Mode, type ThemeSettings } from './types';

const ids = BUILT_IN_THEMES.map((t) => t.id);
const zeitung = BUILT_IN_THEMES.find((t) => t.id === 'zeitung')!;
const settings = (patch: Partial<ThemeSettings>): ThemeSettings => ({ ...DEFAULT_SETTINGS, ...patch });

// Deterministic "random" colours so a failure is reproducible.
function* colours(n: number) {
  let x = 0x2545f491;
  for (let i = 0; i < n; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    yield '#' + ((x >>> 0) & 0xffffff).toString(16).padStart(6, '0');
  }
}

describe('built-in themes', () => {
  it.each(BUILT_IN_THEMES.flatMap((t) => (Object.keys(t.modes) as Mode[]).map((m) => [t.id, m] as const)))(
    '%s %s meets every contrast rule as shipped',
    (id, mode) => {
      const theme = BUILT_IN_THEMES.find((t) => t.id === id)!;
      const palette = theme.modes[mode]!;
      for (const r of contrastRules(theme)) expect(contrast(palette[r.fg], palette[r.bg])).toBeGreaterThanOrEqual(r.min);
    }
  );

  it('are never corrected by the gate without user adjustments', () => {
    for (const t of BUILT_IN_THEMES)
      for (const mode of ['light', 'dark'] as const) {
        const r = resolveTheme(BUILT_IN_THEMES, settings({ themeId: t.id, mode }), mode === 'dark');
        expect(r.corrections).toEqual([]);
      }
  });
});

describe('contrast gate', () => {
  it('keeps every theme readable for any accent and paper tone', () => {
    for (const t of BUILT_IN_THEMES)
      for (const mode of ['light', 'dark'] as const)
        for (const tone of [-3, 0, 3])
          for (const accent of [...colours(25), '#000000', '#ffffff', '#ffff00']) {
            const r = resolveTheme(BUILT_IN_THEMES, settings({ themeId: t.id, mode, accent, paperTone: tone }), mode === 'dark');
            expect(r.failures, `${t.id} ${mode} tone ${tone} accent ${accent}`).toEqual([]);
          }
  });

  it('darkens a pale accent on light paper and reports it', () => {
    const r = resolveTheme(BUILT_IN_THEMES, settings({ accent: '#ffe14d', mode: 'light' }), false);
    const fix = r.corrections.find((c) => c.token === 'accent')!;
    expect(fix.from).toBe('#ffe14d');
    expect(fix.after).toBeGreaterThanOrEqual(4.5);
    expect(r.palette.accent).toBe(fix.to);
  });

  it('holds AAA (7:1) for the contrast theme', () => {
    const r = resolveTheme(BUILT_IN_THEMES, settings({ themeId: 'kontrast', mode: 'light', accent: '#ffe14d' }), false);
    expect(contrast(r.palette.accent, r.palette.paper)).toBeGreaterThanOrEqual(7);
  });

  it('paper tone keeps lightness roughly and changes hue', () => {
    const warm = shiftTone('#fafaf9', -3);
    expect(warm).not.toBe('#fafaf9');
    expect(Math.abs(contrast(warm, '#000000') - contrast('#fafaf9', '#000000'))).toBeLessThan(0.6);
  });
});

describe('follow system and light partners', () => {
  it('a dark-only theme hands the light case to its partner', () => {
    expect(resolveTheme(BUILT_IN_THEMES, settings({ themeId: 'nacht', mode: 'system' }), false).theme.id).toBe('zeitung');
    expect(resolveTheme(BUILT_IN_THEMES, settings({ themeId: 'nacht', mode: 'system' }), true).theme.id).toBe('nacht');
    const chosen = settings({ themeId: 'nacht', mode: 'system', lightPartners: { nacht: 'buch' } });
    expect(resolveTheme(BUILT_IN_THEMES, chosen, false).theme.id).toBe('buch');
  });
});

describe('theme files', () => {
  it('a built-in round-trips under a free id', () => {
    const r = readThemeFile(serializeTheme(zeitung), ids, []);
    expect(r).toMatchObject({ kind: 'ok', renamedFrom: 'zeitung', theme: { id: 'zeitung-2' } });
  });

  it.each([
    ['not JSON', '{nope', 'not-json'],
    ['too large', 'x'.repeat(70_000), 'too-large'],
  ])('rejects %s', (_label, text, reason) => {
    expect(readThemeFile(text, ids, [])).toMatchObject({ kind: 'invalid', reason });
  });

  it('rejects files that leave the format', () => {
    const base = JSON.parse(serializeTheme(zeitung));
    const variants = [
      { ...base, script: 'alert(1)' },
      { ...base, type: { ...base.type, body: { family: 'Comic Sans' } } },
      { ...base, modes: { light: { ...base.modes.light, ink: undefined } } },
    ];
    for (const v of variants) expect(readThemeFile(JSON.stringify(v), ids, [])).toMatchObject({ kind: 'invalid', reason: 'schema' });
    expect(readThemeFile('{"__proto__":{"x":1},' + serializeTheme(zeitung).slice(1), ids, []).kind).toBe('invalid');
  });

  it('shows corrections for a low-contrast file instead of fixing it silently', () => {
    const low = JSON.parse(serializeTheme(zeitung));
    low.id = 'grau';
    low.modes.light.ink = '#aaaaaa';
    const r = readThemeFile(JSON.stringify(low), ids, []);
    expect(r.kind).toBe('needs-fix');
    if (r.kind !== 'needs-fix') return;
    expect(r.corrections.some((c) => c.token === 'ink')).toBe(true);
    expect(gateTheme(r.fixed).corrections).toEqual([]);
  });

  it('replaces an own theme with the same id', () => {
    const own = { ...zeitung, id: 'eigen', l10n: undefined };
    expect(readThemeFile(serializeTheme(own), ids, ['eigen'])).toMatchObject({ kind: 'ok', replaces: 'eigen' });
  });

  it.each(BUILT_IN_THEMES.map((t) => [t.id]))('saving %s with adjustments paints the same and re-imports cleanly', (id) => {
    const base = BUILT_IN_THEMES.find((t) => t.id === id)!;
    const s = settings({ themeId: id, accent: '#ffe14d', paperTone: -2, bodyFont: 'readable', measure: 'wide', density: 'compact' });
    const own = themeFromSettings(base, s, 'Mein Gelb', ids);
    expect(readThemeFile(serializeTheme(own), ids, [])).toMatchObject({ kind: 'ok', theme: { id: 'mein-gelb' } });
    for (const mode of ['light', 'dark'] as const) {
      if (!base.modes[mode]) continue;
      const painted = resolveTheme([own], settings({ themeId: own.id, mode }), mode === 'dark').palette;
      expect(painted).toEqual(resolveTheme([base], { ...s, mode }, mode === 'dark').palette);
    }
  });
});

describe('stored settings', () => {
  it('coerce anything into valid settings', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    const s = sanitizeSettings({ mode: 'blau', fontScale: 99, accent: 'f0a', paperTone: 1.5, lightPartners: { nacht: 3 } });
    expect(s).toMatchObject({ mode: 'system', fontScale: DEFAULT_SETTINGS.fontScale, accent: '#ff00aa', paperTone: 0, lightPartners: {} });
  });
});
