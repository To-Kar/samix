import type { FetchContext, SourceFetcher, SourceItem } from '../types.js';
import { parseAndNormalize } from './base.js';

export interface RssConfig {
  urls: string[];
  maxPerFeed?: number;
}

const UA = 'samix/0.1 (+https://samix.app)';
const DEFAULT_MAX_PER_FEED = 20;

export class RssFetcher implements SourceFetcher<RssConfig> {
  readonly type = 'rss' as const;

  async fetch(config: RssConfig, ctx: FetchContext): Promise<SourceItem[]> {
    const maxPerFeed = config.maxPerFeed ?? DEFAULT_MAX_PER_FEED;
    const out: SourceItem[] = [];

    for (const url of config.urls) {
      try {
        const res = await fetch(url, { headers: { 'User-Agent': UA } });
        if (!res.ok) {
          ctx.logger.warn({ url, status: res.status }, 'rss_fetch_http_error');
          continue;
        }
        const xml = await res.text();
        const { feedTitle, items } = parseAndNormalize(xml);
        const sourceName = feedTitle ?? safeHost(url);
        for (const item of items.slice(0, maxPerFeed)) {
          out.push({ ...item, sourceName });
        }
      } catch (err) {
        ctx.logger.warn(
          { url, err: err instanceof Error ? err.message : String(err) },
          'rss_parse_failed'
        );
      }
    }

    return out;
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
