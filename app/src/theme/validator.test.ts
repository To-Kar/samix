import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
// @ts-expect-error plain script, no declarations
import { generate, UCS2LENGTH } from '../../scripts/build-theme-validator.mjs';
import ajvUcs2length from 'ajv/dist/runtime/ucs2length.js';
import { BUILT_IN_THEMES, parseTheme, InvalidThemeError } from './registry';

describe('precompiled theme validator', () => {
  // The installed app's CSP forbids eval, so Ajv must never compile at runtime.
  it('is up to date with the schema', () => {
    const committed = readFileSync(new URL('./validateTheme.generated.js', import.meta.url), 'utf8');
    expect(committed).toBe(generate());
  });

  it('inlines a ucs2length that matches Ajv', () => {
    const inlined = new Function(`${UCS2LENGTH}; return ucs2length;`)() as (s: string) => number;
    for (const str of ['', 'abc', 'äöü', '😀', 'a😀b', '\ud83d', '\ude00x']) {
      expect(inlined(str)).toBe((ajvUcs2length as unknown as (s: string) => number)(str));
    }
  });

  it('accepts the built-in themes and rejects a bad colour and extra fields', () => {
    expect(BUILT_IN_THEMES.length).toBeGreaterThan(0);
    const base = JSON.parse(JSON.stringify(BUILT_IN_THEMES[0]));
    base.modes.light.paper = 'red';
    expect(() => parseTheme(base, 't')).toThrow(InvalidThemeError);
    const extra = { ...JSON.parse(JSON.stringify(BUILT_IN_THEMES[0])), backgroundImage: 'http://x/y.png' };
    expect(() => parseTheme(extra, 't')).toThrow(InvalidThemeError);
  });
});

describe('generated validator limits', () => {
  it('enforces maxLength on the name', () => {
    const t = JSON.parse(JSON.stringify(BUILT_IN_THEMES[0]));
    t.name = 'x'.repeat(41);
    expect(() => parseTheme(t, 't')).toThrow(InvalidThemeError);
    t.name = '😀'.repeat(40);
    expect(parseTheme(t, 't').name).toHaveLength(80);
  });
});
