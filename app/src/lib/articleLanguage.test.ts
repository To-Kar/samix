import { describe, expect, it } from 'vitest';
import { effectiveArticleLanguage } from './articleLanguage';

describe('effectiveArticleLanguage', () => {
  it('follows the interface language or is fixed', () => {
    expect(effectiveArticleLanguage('follow', 'de')).toBe('de');
    expect(effectiveArticleLanguage('follow', 'en')).toBe('en');
    expect(effectiveArticleLanguage('en', 'de')).toBe('en');
    expect(effectiveArticleLanguage('de', 'en')).toBe('de');
  });
});
