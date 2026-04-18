import { parseFeed } from 'feedsmith';
import type { SourceItem } from '../types.js';

// feedsmith is pinned to ~2.7 in package.json: 2.8+ bundles transitive deps
// under dist/node_modules/ and tsx (our dev runner) fails to resolve the
// nested path-expression-matcher import, breaking parse at runtime. Plain
// Node handles it fine but we need the tsx-watch dev loop.
export type { SourceFetcher, SourceItem, FetchContext } from '../types.js';

export type ParsedItem = Omit<SourceItem, 'sourceName'>;

export interface ParsedFeed {
  feedTitle?: string;
  items: ParsedItem[];
}

// Parse an RSS/Atom/RDF/JSON feed into canonical items plus the feed's own
// title. Caller decides the `sourceName` (for RSS it's usually the feed
// title; for Arxiv it's `arxiv:<category>`).
// Defensive on every field — feedsmith returns DeepPartial.
export function parseAndNormalize(xml: string): ParsedFeed {
  const parsed = parseFeed(xml);
  const items: ParsedItem[] = [];
  let feedTitle: string | undefined;

  if (parsed.format === 'rss') {
    feedTitle = parsed.feed.title;
    for (const item of parsed.feed.items ?? []) {
      const url = item?.link;
      if (!url) continue;
      items.push({
        url,
        title: item.title ?? '(untitled)',
        snippet: item.description,
        publishedAt: parseDate(item.pubDate),
        raw: item as unknown as Record<string, unknown>,
      });
    }
  } else if (parsed.format === 'rdf') {
    feedTitle = parsed.feed.title;
    for (const item of parsed.feed.items ?? []) {
      const url = item?.link;
      if (!url) continue;
      // RDF doesn't carry a pubDate on items; Dublin Core `dc:date` (item.dc.date)
      // is the usual stand-in but we keep the default-lightweight path for now.
      items.push({
        url,
        title: item.title ?? '(untitled)',
        snippet: item.description,
        raw: item as unknown as Record<string, unknown>,
      });
    }
  } else if (parsed.format === 'atom') {
    feedTitle = parsed.feed.title;
    for (const entry of parsed.feed.entries ?? []) {
      const url =
        entry?.links?.find((l) => !l?.rel || l.rel === 'alternate')?.href ??
        entry?.links?.[0]?.href;
      if (!url) continue;
      items.push({
        url,
        title: entry.title ?? '(untitled)',
        snippet: entry.summary ?? entry.content,
        publishedAt: parseDate(entry.published ?? entry.updated),
        raw: entry as unknown as Record<string, unknown>,
      });
    }
  } else if (parsed.format === 'json') {
    feedTitle = parsed.feed.title;
    for (const item of parsed.feed.items ?? []) {
      const url = item?.url;
      if (!url) continue;
      items.push({
        url,
        title: item.title ?? '(untitled)',
        snippet: item.summary ?? item.content_text,
        publishedAt: parseDate(item.date_published),
        raw: item as unknown as Record<string, unknown>,
      });
    }
  }

  return { feedTitle, items };
}

function parseDate(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
