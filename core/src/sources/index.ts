import type { SourceFetcher, SourceSpec } from '../types.js';
import { RssFetcher } from './rss.js';
import { PerplexitySearchFetcher } from './perplexity.js';
import { ArxivFetcher } from './arxiv.js';
import { DbArticlesFetcher } from './db-articles.js';
import { UrlFetchFetcher } from './url.js';

export { RssFetcher, PerplexitySearchFetcher, ArxivFetcher, DbArticlesFetcher, UrlFetchFetcher };
export { parseAndNormalize } from './base.js';

type FetcherType = SourceSpec['type'];
type FetcherFactory = () => SourceFetcher;

const registry = new Map<FetcherType, FetcherFactory>();
registry.set('rss', () => new RssFetcher());
registry.set('perplexity_search', () => new PerplexitySearchFetcher());
registry.set('arxiv', () => new ArxivFetcher());
registry.set('db_articles', () => new DbArticlesFetcher() as unknown as SourceFetcher);
registry.set('url_fetch', () => new UrlFetchFetcher() as unknown as SourceFetcher);

export function resolveFetcher(type: FetcherType): SourceFetcher | undefined {
  const factory = registry.get(type);
  return factory ? factory() : undefined;
}

export function knownFetcherTypes(): FetcherType[] {
  return Array.from(registry.keys());
}
