import { parseHTML } from 'linkedom';
import { z } from 'zod';
import { safeFetch, SafeFetchError } from '../net/safeFetch.js';
import type { FetchContext, SourceFetcher, SourceItem } from '../types.js';
import { parseAndNormalize } from './base.js';
import { fetchRobots, type Robots } from './robots.js';

// "Give me the newest articles of this website." Works for any site without
// site-specific code, trying three strategies in order of reliability:
//   1. feed     – a linked or conventionally placed RSS/Atom feed
//   2. sitemap  – sitemap.xml / news sitemap, newest first
//   3. page     – headline links on the page, dated by each article's metadata
// Items without a publication date are dropped (source-traceability needs one).

const configSchema = z.object({
  url: z.string().min(1),
  maxItems: z.number().int().min(1).max(50).default(10),
  filter: z
    .object({
      // Shorthand for a single keyword.
      topic: z.string().min(1).optional(),
      keywords: z.array(z.string().min(1)).optional(),
      mode: z.enum(['keywords', 'semantic']).default('keywords'),
    })
    .optional(),
});
export type WebsiteConfig = z.input<typeof configSchema>;

// Throws a readable error for an invalid config; shared by the fetcher and by
// the API that saves sources, so a bad config is refused up front.
export function parseWebsiteConfig(raw: unknown) {
  const config = configSchema.parse(raw);
  if (config.filter?.mode === 'semantic') {
    throw new Error('filter.mode "semantic" is not implemented yet; use "keywords"');
  }
  return config;
}

export type DiscoveryMethod = 'feed' | 'sitemap' | 'page';

export interface DiscoveryReport {
  method: DiscoveryMethod | null;
  feedUrl?: string;
  /** Candidates found before filtering and capping. */
  candidates: number;
  /** Dropped for lacking a publication date. */
  withoutDate: number;
  /** Dropped by the keyword filter. */
  filteredOut: number;
  items: SourceItem[];
  warnings: string[];
}

// Tests set the delay to 0.
export const timing = { pageDelayMs: 250 };

const FEED_PATHS = ['/feed', '/rss', '/rss.xml', '/feed.xml', '/atom.xml', '/index.xml'];
const MAX_PAGE_BYTES = 1.5 * 1024 * 1024;
const MAX_FEED_BYTES = 3 * 1024 * 1024;
const MAX_SITEMAP_BYTES = 5 * 1024 * 1024;
const MAX_ENRICH = 20;
const PREFETCH_POOL = 60; // candidates to collect so the filter has something to filter

// What worked last time for a site, so later runs skip the search.
const methodCache = new Map<string, { method: DiscoveryMethod; feedUrl?: string }>();

export class WebsiteFetcher implements SourceFetcher<WebsiteConfig> {
  readonly type = 'website' as const;

  async fetch(config: WebsiteConfig, ctx: FetchContext): Promise<SourceItem[]> {
    const report = await this.discover(config, ctx);
    for (const w of report.warnings) ctx.logger.warn({ url: config.url, warning: w }, 'website_warning');
    ctx.logger.info(
      {
        url: config.url,
        method: report.method,
        candidates: report.candidates,
        withoutDate: report.withoutDate,
        filteredOut: report.filteredOut,
        kept: report.items.length,
      },
      'website_discovered'
    );
    return report.items;
  }

  // Also used by the sources editor's preview.
  async discover(rawConfig: WebsiteConfig, ctx: FetchContext): Promise<DiscoveryReport> {
    const config = parseWebsiteConfig(rawConfig);
    const start = normalizeStartUrl(config.url);
    const keywords = [...(config.filter?.keywords ?? []), ...(config.filter?.topic ? [config.filter.topic] : [])];
    const matcher = keywords.length ? keywordMatcher(keywords) : null;

    const report: DiscoveryReport = {
      method: null,
      candidates: 0,
      withoutDate: 0,
      filteredOut: 0,
      items: [],
      warnings: [],
    };

    const origin = new URL(start).origin;
    const robots = await fetchRobots(origin);
    const startPath = pathOf(start);
    if (!robots.allows(startPath)) {
      report.warnings.push('robots.txt disallows this page for crawlers');
      return report;
    }

    let homepage: { html: string; finalUrl: string; contentType: string } | null = null;
    try {
      const res = await safeFetch(start, { maxBytes: MAX_PAGE_BYTES, accept: 'text/html,application/xhtml+xml,application/xml' });
      homepage = { html: res.body.toString('utf8'), finalUrl: res.finalUrl, contentType: res.contentType };
    } catch (err) {
      report.warnings.push(`start page not reachable: ${describe(err)}`);
      return report;
    }
    const base = homepage.finalUrl;
    const siteName = hostName(base);

    const strategies: { method: DiscoveryMethod; run: () => Promise<Candidate[] | null> }[] = [
      { method: 'feed', run: () => this.viaFeed(homepage!, base, ctx, report) },
      { method: 'sitemap', run: () => this.viaSitemap(base, robots, ctx, report) },
      { method: 'page', run: () => this.viaPage(homepage!, base, robots, matcher, ctx, report) },
    ];
    const cached = methodCache.get(origin)?.method;
    if (cached) strategies.sort((a, b) => (a.method === cached ? -1 : b.method === cached ? 1 : 0));

    for (const s of strategies) {
      let found: Candidate[] | null;
      try {
        found = await s.run();
      } catch (err) {
        report.warnings.push(`${s.method} failed: ${describe(err)}`);
        continue;
      }
      if (!found || found.length === 0) continue;

      // Items without a date can't be used. If none has one, this strategy is
      // no help — try the next instead of ending with nothing.
      const dated = found.filter((c) => c.publishedAt);
      if (dated.length === 0) {
        report.warnings.push(`${s.method}: ${found.length} items found, none with a publication date`);
        continue;
      }

      report.method = s.method;
      methodCache.set(origin, { method: s.method, feedUrl: report.feedUrl });
      report.candidates = found.length;
      report.withoutDate = found.length - dated.length;
      const matched = matcher ? dated.filter((c) => matcher(`${c.title} ${c.snippet ?? ''}`)) : dated;
      // `+=`: the page strategy may already have counted headlines it skipped.
      report.filteredOut += dated.length - matched.length;

      matched.sort((a, b) => b.publishedAt!.getTime() - a.publishedAt!.getTime());
      report.items = matched.slice(0, config.maxItems).map((c) => ({
        url: c.url,
        title: c.title,
        snippet: c.snippet,
        publishedAt: c.publishedAt,
        sourceName: c.sourceName ?? siteName,
        sourceType: 'website' as const,
        raw: { method: s.method, ...(report.feedUrl ? { feedUrl: report.feedUrl } : {}) },
      }));
      if (report.items.length === 0 && report.filteredOut > 0) {
        report.warnings.push(`${report.filteredOut} items found, none matched the filter`);
      }
      return report;
    }

    if (report.candidates === 0 && report.filteredOut === 0) {
      report.warnings.push(
        'no feed, sitemap or dated headline links found — the site may need JavaScript or block automated access'
      );
    } else if (report.filteredOut > 0) {
      report.warnings.push(`${report.filteredOut} items found, none matched the filter`);
    }
    return report;
  }

  // ---- 1. feed -----------------------------------------------------------

  private async viaFeed(
    home: { html: string; finalUrl: string; contentType: string },
    base: string,
    ctx: FetchContext,
    report: DiscoveryReport
  ): Promise<Candidate[] | null> {
    const urls: string[] = [];
    // The user may have given the feed URL itself.
    if (/xml|rss|atom/.test(home.contentType)) urls.push(base);

    const { document } = parseHTML(home.html);
    for (const link of document.querySelectorAll('link[rel~="alternate"]')) {
      const type = (link.getAttribute('type') ?? '').toLowerCase();
      const href = link.getAttribute('href');
      if (href && /(rss|atom)\+xml|text\/xml|application\/xml/.test(type)) urls.push(href);
    }
    const cached = methodCache.get(new URL(base).origin)?.feedUrl;
    if (cached) urls.unshift(cached);
    for (const p of FEED_PATHS) urls.push(p);

    const tried = new Set<string>();
    for (const href of urls) {
      const url = absolute(href, base);
      if (!url || tried.has(url)) continue;
      tried.add(url);
      try {
        const res = await safeFetch(url, { maxBytes: MAX_FEED_BYTES, accept: 'application/rss+xml,application/atom+xml,application/xml,text/xml' });
        const { feedTitle, items } = parseAndNormalize(res.body.toString('utf8'));
        if (items.length === 0) continue;
        report.feedUrl = url;
        return items.map((i) => ({
          url: i.url,
          title: i.title,
          snippet: i.snippet,
          publishedAt: i.publishedAt,
          sourceName: feedTitle,
        }));
      } catch (err) {
        ctx.logger.debug({ url, err: describe(err) }, 'feed_candidate_failed');
      }
    }
    return null;
  }

  // ---- 2. sitemap --------------------------------------------------------

  private async viaSitemap(
    base: string,
    robots: Robots,
    ctx: FetchContext,
    report: DiscoveryReport
  ): Promise<Candidate[] | null> {
    const origin = new URL(base).origin;
    const roots = [...robots.sitemaps, `${origin}/news-sitemap.xml`, `${origin}/sitemap.xml`];
    const seen = new Set<string>();
    const entries: SitemapEntry[] = [];

    const visit = async (url: string, depth: number): Promise<void> => {
      if (seen.has(url) || seen.size >= 6) return;
      seen.add(url);
      try {
        const res = await safeFetch(url, { maxBytes: MAX_SITEMAP_BYTES, timeoutMs: 20_000 });
        const xml = res.body.toString('utf8');
        if (/<sitemapindex[\s>]/i.test(xml) && depth < 1) {
          // Newest-looking child maps first.
          const children = parseSitemapIndex(xml).sort((a, b) => (b.lastmod?.getTime() ?? 0) - (a.lastmod?.getTime() ?? 0));
          for (const c of children.slice(0, 2)) await visit(c.loc, depth + 1);
        } else {
          entries.push(...parseSitemap(xml));
        }
      } catch (err) {
        ctx.logger.debug({ url, err: describe(err) }, 'sitemap_failed');
      }
    };
    for (const r of roots) {
      const url = absolute(r, base);
      if (url) await visit(url, 0);
      if (entries.length > 0) break;
    }
    if (entries.length === 0) return null;

    const allowed = entries.filter((e) => sameSite(e.loc, base) && robots.allows(pathOf(e.loc)));
    allowed.sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));

    const out: Candidate[] = [];
    const needPage: SitemapEntry[] = [];
    for (const e of allowed.slice(0, PREFETCH_POOL)) {
      if (e.newsTitle && e.date) out.push({ url: e.loc, title: e.newsTitle, publishedAt: e.date });
      else needPage.push(e);
    }
    // Plain sitemaps have URLs and lastmod only: read the pages for titles.
    const enriched = await enrich(
      needPage.slice(0, MAX_ENRICH).map((e) => ({ url: e.loc, fallbackDate: e.date })),
      robots,
      ctx
    );
    report.warnings.push(...(needPage.length > MAX_ENRICH ? [`sitemap has more entries than read (${MAX_ENRICH})`] : []));
    return [...out, ...enriched];
  }

  // ---- 3. headline links on the page ------------------------------------

  private async viaPage(
    home: { html: string },
    base: string,
    robots: Robots,
    matcher: ((t: string) => boolean) | null,
    ctx: FetchContext,
    report: DiscoveryReport
  ): Promise<Candidate[] | null> {
    const links = headlineLinks(home.html, base).filter((l) => robots.allows(pathOf(l.url)));
    // The anchor text is the headline: filter on it before spending requests.
    const pool = matcher ? links.filter((l) => matcher(l.text)) : links;
    report.filteredOut += links.length - pool.length;
    if (pool.length === 0) return null;
    const enriched = await enrich(
      pool.slice(0, MAX_ENRICH).map((l) => ({ url: l.url, fallbackTitle: l.text })),
      robots,
      ctx
    );
    // Already filtered above; do not count these twice.
    return enriched.length ? enriched : null;
  }
}

// ---- shared helpers ------------------------------------------------------

interface Candidate {
  url: string;
  title: string;
  snippet?: string;
  publishedAt?: Date;
  sourceName?: string;
}

async function enrich(
  targets: { url: string; fallbackTitle?: string; fallbackDate?: Date }[],
  robots: Robots,
  ctx: FetchContext
): Promise<Candidate[]> {
  const out: Candidate[] = [];
  let next = 0;
  const worker = async () => {
    for (;;) {
      const t = targets[next++];
      if (!t) return;
      if (!robots.allows(pathOf(t.url))) continue;
      try {
        const res = await safeFetch(t.url, { maxBytes: MAX_PAGE_BYTES, timeoutMs: 12_000, accept: 'text/html,application/xhtml+xml', contentType: /html/ });
        const meta = pageMeta(res.body.toString('utf8'));
        const title = meta.title ?? t.fallbackTitle;
        if (title) out.push({ url: t.url, title, snippet: meta.description, publishedAt: meta.publishedAt ?? t.fallbackDate });
      } catch (err) {
        ctx.logger.debug({ url: t.url, err: describe(err) }, 'page_enrich_failed');
      }
      if (timing.pageDelayMs) await new Promise((r) => setTimeout(r, timing.pageDelayMs));
    }
  };
  await Promise.all([worker(), worker()]);
  return out;
}

export function pageMeta(html: string): { title?: string; description?: string; publishedAt?: Date } {
  const { document } = parseHTML(html);
  const meta = (sel: string) => document.querySelector(sel)?.getAttribute('content')?.trim() || undefined;

  const title =
    meta('meta[property="og:title"]') ??
    document.querySelector('h1')?.textContent?.replace(/\s+/g, ' ').trim() ??
    document.querySelector('title')?.textContent?.replace(/\s+/g, ' ').trim();
  const description = meta('meta[property="og:description"]') ?? meta('meta[name="description"]');

  const candidates: (string | undefined)[] = [
    meta('meta[property="article:published_time"]'),
    meta('meta[property="og:article:published_time"]'),
    meta('meta[itemprop="datePublished"]'),
    meta('meta[name="date"]'),
    meta('meta[name="pubdate"]'),
    jsonLdDate(document),
    document.querySelector('time[datetime]')?.getAttribute('datetime') ?? undefined,
  ];
  for (const c of candidates) {
    const d = parseSaneDate(c);
    if (d) return { title: title || undefined, description, publishedAt: d };
  }
  return { title: title || undefined, description };
}

function jsonLdDate(document: ReturnType<typeof parseHTML>['document']): string | undefined {
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const found = findKey(JSON.parse(s.textContent ?? ''), 'datePublished');
      if (found) return found;
    } catch {
      /* malformed JSON-LD is common; ignore */
    }
  }
  return undefined;
}

function findKey(node: unknown, key: string, depth = 0): string | undefined {
  if (depth > 6 || node == null || typeof node !== 'object') return undefined;
  if (Array.isArray(node)) {
    for (const n of node) {
      const f = findKey(n, key, depth + 1);
      if (f) return f;
    }
    return undefined;
  }
  const obj = node as Record<string, unknown>;
  if (typeof obj[key] === 'string') return obj[key] as string;
  for (const v of Object.values(obj)) {
    const f = findKey(v, key, depth + 1);
    if (f) return f;
  }
  return undefined;
}

// A date from page metadata, unless it is clearly bogus.
function parseSaneDate(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return undefined;
  if (d.getUTCFullYear() < 2000) return undefined;
  if (d.getTime() > Date.now() + 24 * 60 * 60 * 1000) return undefined;
  return d;
}

const NON_ARTICLE_PATH = /\/(tag|tags|category|categories|kategorie|thema|themen|author|autor|search|suche|login|register|about|impressum|datenschutz|privacy|contact|kontakt|newsletter|feed|rss|page)\b/i;
const FILE_EXT = /\.(jpe?g|png|gif|webp|svg|pdf|zip|mp[34]|css|js|xml|ico)$/i;

export function headlineLinks(html: string, base: string): { url: string; text: string }[] {
  const { document } = parseHTML(html);
  const seen = new Set<string>();
  const out: { url: string; text: string }[] = [];
  for (const a of document.querySelectorAll('a[href]')) {
    const text = (a.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (text.length < 20 || text.length > 220) continue; // headlines, not menu items
    const url = absolute(a.getAttribute('href') ?? '', base);
    if (!url || !sameSite(url, base)) continue;
    const u = new URL(url);
    if (u.pathname === '/' || u.pathname.split('/').filter(Boolean).length < 1) continue;
    if (NON_ARTICLE_PATH.test(u.pathname) || FILE_EXT.test(u.pathname)) continue;
    u.hash = '';
    const key = u.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ url: key, text });
  }
  return out;
}

interface SitemapEntry {
  loc: string;
  date?: Date;
  lastmod?: Date;
  newsTitle?: string;
}

const tag = (block: string, name: string) =>
  block.match(new RegExp(`<${name}[^>]*>\\s*(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?\\s*</${name}>`, 'i'))?.[1]?.trim();

export function parseSitemap(xml: string): SitemapEntry[] {
  const out: SitemapEntry[] = [];
  for (const m of xml.matchAll(/<url[\s>][\s\S]*?<\/url>/gi)) {
    const block = m[0];
    const loc = tag(block, 'loc');
    if (!loc) continue;
    const lastmod = parseSaneDate(tag(block, 'lastmod'));
    const published = parseSaneDate(tag(block, 'news:publication_date'));
    out.push({
      loc: decodeXml(loc),
      lastmod,
      date: published ?? lastmod,
      newsTitle: tag(block, 'news:title') ? decodeXml(tag(block, 'news:title')!) : undefined,
    });
  }
  return out;
}

export function parseSitemapIndex(xml: string): { loc: string; lastmod?: Date }[] {
  const out: { loc: string; lastmod?: Date }[] = [];
  for (const m of xml.matchAll(/<sitemap[\s>][\s\S]*?<\/sitemap>/gi)) {
    const loc = tag(m[0], 'loc');
    if (loc) out.push({ loc: decodeXml(loc), lastmod: parseSaneDate(tag(m[0], 'lastmod')) });
  }
  return out;
}

const decodeXml = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");

// Whole-word, case-insensitive, Unicode-aware: "KI" matches "KI-Modell" but
// not "Skiing" or "Kiel".
export function keywordMatcher(keywords: string[]): (text: string) => boolean {
  const res = keywords.map(
    (k) => new RegExp(`(?<![\\p{L}\\p{N}])${k.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu')
  );
  return (text) => res.some((re) => re.test(text));
}

function normalizeStartUrl(raw: string): string {
  const t = raw.trim();
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

function absolute(href: string, base: string): string | undefined {
  try {
    const u = new URL(href, base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

const bare = (host: string) => host.replace(/^www\./, '').toLowerCase();
const sameSite = (a: string, b: string) => bare(new URL(a).hostname) === bare(new URL(b).hostname);
const pathOf = (url: string) => {
  const u = new URL(url);
  return `${u.pathname}${u.search}`;
};
const hostName = (url: string) => bare(new URL(url).hostname);
const describe = (err: unknown) =>
  err instanceof SafeFetchError ? `${err.code}${err.status ? ` ${err.status}` : ''}` : err instanceof Error ? err.message : String(err);

/** Test hook: forget what worked for which site. */
export function resetWebsiteCache(): void {
  methodCache.clear();
}
