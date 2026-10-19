import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { logger } from '../src/logger.js';
import { knownFetcherTypes } from '../src/sources/index.js';
import { parseRobots } from '../src/sources/robots.js';
import {
  WebsiteFetcher,
  headlineLinks,
  keywordMatcher,
  parseSitemap,
  resetWebsiteCache,
  timing,
} from '../src/sources/website.js';
import { useFakeNet } from './net.js';

const fx = (name: string) => readFileSync(resolve(import.meta.dirname, 'fixtures/site', name), 'utf8');
const HTML = { 'content-type': 'text/html; charset=utf-8' };
const XML = { 'content-type': 'application/xml' };
const ctx = { runId: 'r', logger };
const fetcher = new WebsiteFetcher();
const titles = (items: { title: string }[]) => items.map((i) => i.title);

beforeEach(() => {
  resetWebsiteCache();
  timing.pageDelayMs = 0;
});

describe('strategy 1: feed', () => {
  const net = useFakeNet({
    'https://tech.example/robots.txt': { body: 'User-agent: *\nDisallow: /intern/' },
    'https://tech.example/': { headers: HTML, body: fx('home-with-feed.html') },
    'https://tech.example/rss/alle.xml': { headers: XML, body: fx('feed.xml') },
    'https://nofeedlink.example/': { headers: HTML, body: '<html><body><h1>x</h1></body></html>' },
    'https://nofeedlink.example/feed': { headers: XML, body: fx('feed.xml') },
    'https://direct.example/rss/alle.xml': { headers: XML, body: fx('feed.xml') },
  });

  it('follows the feed link on the page; newest first; undated items dropped', async () => {
    const r = await fetcher.discover({ url: 'tech.example' }, ctx);
    expect(r.method).toBe('feed');
    expect(r.feedUrl).toBe('https://tech.example/rss/alle.xml');
    expect(titles(r.items)).toEqual([
      'Neues KI-Modell schlägt Konkurrenz',
      'Test: Skiing-Jacke im Alltag',
      'Grafikkarte im Test',
      'Ältester Artikel zur künstlichen Intelligenz',
    ]);
    expect(r).toMatchObject({ candidates: 5, withoutDate: 1, filteredOut: 0 });
    expect(r.items[0]).toMatchObject({ sourceType: 'website', sourceName: 'Beispiel Tech Feed' });
    expect(r.items[0]!.publishedAt).toEqual(new Date('2026-10-18T09:00:00Z'));
  });

  it('caps the result at maxItems', async () => {
    const r = await fetcher.discover({ url: 'https://tech.example', maxItems: 2 }, ctx);
    expect(r.items).toHaveLength(2);
    expect(r.items[0]!.title).toContain('KI-Modell');
  });

  it('matches whole words only: "KI" finds "KI-Modell" but not Skiing or Kiel', async () => {
    const r = await fetcher.discover({ url: 'tech.example', filter: { topic: 'KI' } }, ctx);
    expect(titles(r.items)).toEqual(['Neues KI-Modell schlägt Konkurrenz']);
    expect(r.filteredOut).toBe(3);
  });

  it('accepts several keywords, including phrases', async () => {
    const r = await fetcher.discover({ url: 'tech.example', filter: { keywords: ['KI', 'künstlichen Intelligenz'] } }, ctx);
    expect(titles(r.items)).toEqual(['Neues KI-Modell schlägt Konkurrenz', 'Ältester Artikel zur künstlichen Intelligenz']);
  });

  it('reports an empty result caused by the filter, without blaming the site', async () => {
    const r = await fetcher.discover({ url: 'tech.example', filter: { topic: 'Quantencomputer' } }, ctx);
    expect(r.items).toEqual([]);
    expect(r.method).toBe('feed');
    expect(r.warnings.join(' ')).toMatch(/none matched the filter/);
    expect(r.warnings.join(' ')).not.toMatch(/JavaScript/);
  });

  it('probes conventional feed paths when the page links none', async () => {
    const r = await fetcher.discover({ url: 'https://nofeedlink.example' }, ctx);
    expect(r.method).toBe('feed');
    expect(r.feedUrl).toBe('https://nofeedlink.example/feed');
  });

  it('accepts the feed URL itself', async () => {
    const r = await fetcher.discover({ url: 'https://direct.example/rss/alle.xml' }, ctx);
    expect(r.method).toBe('feed');
    expect(r.items.length).toBeGreaterThan(0);
  });

  it('fetch() returns the same items as SourceItems', async () => {
    const items = await fetcher.fetch({ url: 'tech.example', maxItems: 1 }, ctx);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ sourceType: 'website', url: 'https://tech.example/artikel/ki-modell' });
    expect(net.calls.length).toBeGreaterThan(0);
  });
});

describe('strategy 2: sitemap', () => {
  useFakeNet({
    'https://news.example/robots.txt': { body: 'User-agent: *\nDisallow:\nSitemap: https://news.example/sitemap-index.xml' },
    'https://news.example/': { headers: HTML, body: '<html><body><h1>Nachrichten</h1></body></html>' },
    'https://news.example/sitemap-index.xml': { headers: XML, body: fx('sitemap-index.xml') },
    'https://news.example/sm-new.xml': { headers: XML, body: fx('sitemap-news.xml') },
    // sm-old.xml → 404, must not matter

    'https://plain.example/robots.txt': { body: 'User-agent: *\nDisallow: /privat/' },
    'https://plain.example/': { headers: HTML, body: '<html><body>Hallo</body></html>' },
    'https://plain.example/sitemap.xml': { headers: XML, body: fx('sitemap-plain.xml') },
    'https://plain.example/blog/zweiter-beitrag': { headers: HTML, body: fx('article-politik.html').replaceAll('Wahlergebnis fällt überraschend deutlich aus', 'Zweiter Beitrag') },
    'https://plain.example/blog/erster-beitrag': { headers: HTML, body: '<html><head><title>Erster Beitrag</title></head><body>kein Datum im Seitenkopf</body></html>' },
    'https://plain.example/privat/geheim': { headers: HTML, body: fx('article-politik.html') },
  });

  it('reads a news sitemap through a sitemap index, using its titles and dates without fetching pages', async () => {
    const r = await fetcher.discover({ url: 'https://news.example' }, ctx);
    expect(r.method).toBe('sitemap');
    expect(r.items.map((i) => [i.title, i.url])).toEqual([
      ['KI-Regulierung: Was jetzt gilt', 'https://news.example/a/ki-regulierung?x=1&y=2'],
      ['Börse schließt höher', 'https://news.example/a/boerse'],
    ]);
    // Entry for another host is ignored.
    expect(r.candidates).toBe(2);
  });

  it('reads titles from the pages when the sitemap only has URLs; falls back to lastmod for the date', async () => {
    const r = await fetcher.discover({ url: 'plain.example' }, ctx);
    expect(r.method).toBe('sitemap');
    expect(r.items.map((i) => i.title)).toEqual(['Zweiter Beitrag', 'Erster Beitrag']);
    // Page has no date → sitemap lastmod is used.
    expect(r.items[1]!.publishedAt).toEqual(new Date('2026-10-10'));
  });

  it('skips pages robots.txt disallows', async () => {
    const r = await fetcher.discover({ url: 'plain.example' }, ctx);
    expect(r.items.some((i) => i.url.includes('/privat/'))).toBe(false);
  });
});

describe('strategy 3: headline links', () => {
  const net = useFakeNet({
    'https://magazin.example/robots.txt': { status: 404 },
    'https://magazin.example/': { headers: HTML, body: fx('home-no-feed.html') },
    'https://magazin.example/politik/wahl-ergebnis-ueberraschend-deutlich': { headers: HTML, body: fx('article-politik.html') },
    'https://magazin.example/tech/ki-chip-hersteller-meldet-rekord': { headers: HTML, body: fx('article-chip.html') },
    'https://magazin.example/tech/neue-smartphones-im-vergleich': { headers: HTML, body: fx('article-phones-nodate.html') },
  });

  it('dates each article by its own metadata (meta tag, JSON-LD); drops undated; newest first', async () => {
    const r = await fetcher.discover({ url: 'https://magazin.example' }, ctx);
    expect(r.method).toBe('page');
    expect(r.items.map((i) => [i.title, i.publishedAt!.toISOString()])).toEqual([
      ['KI-Chip-Hersteller meldet Rekordumsatz', '2026-10-18T10:30:00.000Z'],
      ['Wahlergebnis fällt überraschend deutlich aus', '2026-10-18T05:00:00.000Z'],
    ]);
    expect(r.withoutDate).toBe(1);
  });

  it('ignores menu items, tag pages, files and other domains', () => {
    const links = headlineLinks(fx('home-no-feed.html'), 'https://magazin.example/');
    expect(links.map((l) => l.url)).toEqual([
      'https://magazin.example/politik/wahl-ergebnis-ueberraschend-deutlich',
      'https://magazin.example/tech/ki-chip-hersteller-meldet-rekord',
      'https://magazin.example/tech/neue-smartphones-im-vergleich',
    ]);
  });

  it('applies the filter to headlines before fetching any article page', async () => {
    net.calls.length = 0;
    const r = await fetcher.discover({ url: 'https://magazin.example', filter: { keywords: ['KI'] } }, ctx);
    expect(titles(r.items)).toEqual(['KI-Chip-Hersteller meldet Rekordumsatz']);
    expect(r.filteredOut).toBe(2);
    const pagesFetched = net.calls.filter((u) => /\/(politik|tech)\//.test(u));
    expect(pagesFetched).toEqual(['https://magazin.example/tech/ki-chip-hersteller-meldet-rekord']);
  });
});

describe('failure modes and safety', () => {
  const net = useFakeNet({
    'https://closed.example/robots.txt': { body: 'User-agent: *\nDisallow: /' },
    'https://closed.example/': { headers: HTML, body: '<html></html>' },
    'https://gone.example/robots.txt': { status: 404 },
    'https://empty.example/robots.txt': { status: 404 },
    'https://empty.example/': { headers: HTML, body: '<html><body><p>Nur ein Absatz.</p></body></html>' },
  });

  it('respects robots.txt for the start page and fetches nothing else', async () => {
    const r = await fetcher.discover({ url: 'https://closed.example' }, ctx);
    expect(r.items).toEqual([]);
    expect(r.warnings.join(' ')).toMatch(/robots\.txt/);
    expect(net.calls).toEqual(['https://closed.example/robots.txt']);
  });

  it('says so when the start page is unreachable', async () => {
    const r = await fetcher.discover({ url: 'https://gone.example' }, ctx);
    expect(r.items).toEqual([]);
    expect(r.warnings[0]).toMatch(/start page not reachable: http_error 404/);
  });

  it('says so when nothing usable is found (e.g. a JavaScript-only site)', async () => {
    const r = await fetcher.discover({ url: 'https://empty.example' }, ctx);
    expect(r.method).toBeNull();
    expect(r.warnings.join(' ')).toMatch(/JavaScript/);
  });

  it('never touches the local network', async () => {
    net.length = 0;
    const r = await fetcher.discover({ url: 'http://127.0.0.1:11434' }, ctx);
    expect(r.items).toEqual([]);
    expect(net.calls.every((u) => !u.includes('127.0.0.1'))).toBe(true);
  });

  it('rejects the unimplemented semantic mode loudly instead of ignoring it', async () => {
    await expect(fetcher.discover({ url: 'x.example', filter: { topic: 'KI', mode: 'semantic' } }, ctx)).rejects.toThrow(/semantic/);
  });

  it('rejects invalid config', async () => {
    await expect(fetcher.discover({ url: 'x.example', maxItems: 0 }, ctx)).rejects.toThrow();
    await expect(fetcher.discover({ url: '' }, ctx)).rejects.toThrow();
  });

  it('is registered', () => {
    expect(knownFetcherTypes()).toContain('website');
  });
});

describe('parseRobots', () => {
  it('uses the most specific matching rule; Allow wins a tie', () => {
    const r = parseRobots('User-agent: *\nDisallow: /a/\nAllow: /a/public/\nDisallow: /b\nAllow: /b');
    expect(r.allows('/a/secret')).toBe(false);
    expect(r.allows('/a/public/page')).toBe(true);
    expect(r.allows('/b')).toBe(true);
    expect(r.allows('/other')).toBe(true);
  });

  it('supports * and $ and ignores comments and empty Disallow', () => {
    const r = parseRobots('# hi\nUser-agent: *\nDisallow: /*.pdf$ # no pdfs\nDisallow:\nDisallow: /tmp*');
    expect(r.allows('/doc.pdf')).toBe(false);
    expect(r.allows('/doc.pdf?x=1')).toBe(true);
    expect(r.allows('/tmpfile')).toBe(false);
  });

  it('prefers a samix-specific group over *, and collects sitemaps', () => {
    const r = parseRobots('User-agent: *\nDisallow: /\n\nUser-agent: samix\nDisallow: /x/\nSitemap: https://a.example/s.xml');
    expect(r.allows('/page')).toBe(true);
    expect(r.allows('/x/y')).toBe(false);
    expect(r.sitemaps).toEqual(['https://a.example/s.xml']);
  });

  it('allows everything without rules', () => {
    expect(parseRobots('').allows('/anything')).toBe(true);
  });
});

describe('helpers', () => {
  it('keywordMatcher is case-insensitive, Unicode-aware and whole-word', () => {
    const m = keywordMatcher(['KI', 'Müll (alt)']);
    expect(m('Die KI gewinnt')).toBe(true);
    expect(m('ki-modell')).toBe(true);
    expect(m('Skiing in Kiel')).toBe(false);
    expect(m('Müll (alt) im Hof')).toBe(true); // regex characters are escaped
    expect(m('')).toBe(false);
  });

  it('parseSitemap decodes entities and CDATA and ignores bogus dates', () => {
    const e = parseSitemap(
      '<urlset><url><loc>https://a.example/x?a=1&amp;b=2</loc><lastmod>1970-01-01</lastmod><news:news><news:title><![CDATA[Titel <1>]]></news:title><news:publication_date>2999-01-01</news:publication_date></news:news></url></urlset>'
    );
    expect(e[0]).toMatchObject({ loc: 'https://a.example/x?a=1&b=2', newsTitle: 'Titel <1>' });
    expect(e[0]!.date).toBeUndefined();
  });
});
