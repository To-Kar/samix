import { describe, expect, it } from 'vitest';
import { enforceTraceability, normalizeUrl } from '../src/output/traceability.js';
import type { SourceItem } from '../src/types.js';

const src = (url: string, publishedAt?: Date): SourceItem => ({
  url,
  title: 't',
  sourceName: 'Feed',
  sourceType: 'rss',
  publishedAt,
});
const cand = (sourceUrl?: string, publishedAt?: string) => ({
  title: 'T',
  summary: 'S',
  sourceUrl,
  publishedAt,
});
const D = new Date('2026-10-18T08:00:00Z');

describe('normalizeUrl', () => {
  it('ignores scheme, www, trailing slash, fragment, tracking params and param order', () => {
    const a = normalizeUrl('https://www.Example.com/a/b/?b=2&a=1&utm_source=x#frag');
    const b = normalizeUrl('http://example.com/a/b?a=1&b=2');
    expect(a).toBe(b);
  });

  it('keeps host, path and meaningful query distinct', () => {
    expect(normalizeUrl('https://example.com/a')).not.toBe(normalizeUrl('https://example.com/b'));
    expect(normalizeUrl('https://example.com/a')).not.toBe(normalizeUrl('https://other.com/a'));
    expect(normalizeUrl('https://example.com/a?id=1')).not.toBe(normalizeUrl('https://example.com/a?id=2'));
  });

  it('rejects non-http(s) and garbage', () => {
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeUrl('not a url')).toBeNull();
    expect(normalizeUrl('ftp://example.com/x')).toBeNull();
  });
});

describe('enforceTraceability', () => {
  it('accepts a URL that was fetched and uses the source URL, name and date', () => {
    const r = enforceTraceability(
      [cand('https://www.example.com/p/?utm_source=nl')],
      [src('https://example.com/p', D)]
    );
    expect(r.rejected).toEqual([]);
    expect(r.accepted).toHaveLength(1);
    expect(r.accepted[0]).toMatchObject({
      sourceUrl: 'https://example.com/p',
      sourceName: 'Feed',
      publishedAt: D,
    });
  });

  it('rejects a URL that was never fetched (invented source)', () => {
    const r = enforceTraceability([cand('https://example.com/invented')], [src('https://example.com/p', D)]);
    expect(r.accepted).toEqual([]);
    expect(r.rejected[0]?.reason).toBe('url_not_in_sources');
  });

  it('rejects a missing URL', () => {
    const r = enforceTraceability([cand(undefined)], [src('https://example.com/p', D)]);
    expect(r.rejected[0]?.reason).toBe('url_missing');
  });

  it("prefers the source's date over the model's", () => {
    const r = enforceTraceability([cand('https://example.com/p', '2020-01-01T00:00:00Z')], [src('https://example.com/p', D)]);
    expect(r.accepted[0]?.publishedAt).toEqual(D);
  });

  it("falls back to the model's date only when the source has none", () => {
    const r = enforceTraceability([cand('https://example.com/p', '2026-10-17T00:00:00Z')], [src('https://example.com/p')]);
    expect(r.accepted[0]?.publishedAt).toEqual(new Date('2026-10-17T00:00:00Z'));
  });

  it('rejects when no date can be established', () => {
    const none = enforceTraceability([cand('https://example.com/p')], [src('https://example.com/p')]);
    expect(none.rejected[0]?.reason).toBe('no_publication_date');
    const garbage = enforceTraceability([cand('https://example.com/p', 'yesterday-ish')], [src('https://example.com/p')]);
    expect(garbage.rejected[0]?.reason).toBe('no_publication_date');
  });

  it('clamps importance to 1..5 and defaults to 3', () => {
    const run = (importance?: number) =>
      enforceTraceability([{ ...cand('https://example.com/p'), importance }], [src('https://example.com/p', D)]).accepted[0]?.importance;
    expect([run(undefined), run(0), run(9), run(4.6), run(Number.NaN)]).toEqual([3, 1, 5, 5, 3]);
  });

  it('keeps the first of two articles about the same URL', () => {
    const r = enforceTraceability(
      [cand('https://example.com/p'), cand('https://example.com/p/')],
      [src('https://example.com/p', D)]
    );
    expect(r.accepted).toHaveLength(1);
    expect(r.rejected[0]?.reason).toBe('duplicate');
  });
});

describe('story keys (same event, several sources)', () => {
  const src = (n: number) => ({ url: `https://s${n}.example/x`, title: `T${n}`, sourceName: `s${n}.example`, sourceType: 'rss' as const, publishedAt: new Date('2026-10-18T08:00:00Z') });
  const cand = (n: number, story?: string) => ({ title: `T${n}`, summary: 's', sourceUrl: `https://s${n}.example/x`, story });

  it('keeps a key shared by at least two accepted articles, compared loosely', () => {
    const { accepted } = enforceTraceability([cand(1, 'FC  Bayern gegen BVB'), cand(2, ' fc bayern gegen bvb '), cand(3)], [src(1), src(2), src(3)]);
    expect(accepted.map((a) => a.storyKey)).toEqual(['fc bayern gegen bvb', 'fc bayern gegen bvb', undefined]);
  });

  it('drops a key that only one article carries, also when its partner was rejected as untraceable', () => {
    const lone = enforceTraceability([cand(1, 'solo'), cand(2)], [src(1), src(2)]);
    expect(lone.accepted.every((a) => a.storyKey === undefined)).toBe(true);
    const partnerInvented = enforceTraceability(
      [cand(1, 'paar'), { title: 'x', summary: 's', sourceUrl: 'https://invented.example/y', story: 'paar' }],
      [src(1)]
    );
    expect(partnerInvented.accepted).toHaveLength(1);
    expect(partnerInvented.accepted[0]!.storyKey).toBeUndefined();
  });

  it('cuts overlong keys and ignores blank ones', () => {
    const long = 'x'.repeat(100);
    const { accepted } = enforceTraceability([cand(1, long), cand(2, long), cand(3, '   ')], [src(1), src(2), src(3)]);
    expect(accepted[0]!.storyKey).toHaveLength(60);
    expect(accepted[2]!.storyKey).toBeUndefined();
  });
});
