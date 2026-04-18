import type { SourceFetcher, SourceSpec } from '../types.js';
import { RssFetcher } from './rss.js';
import { PerplexitySearchFetcher } from './perplexity.js';
import { ArxivFetcher } from './arxiv.js';

export { RssFetcher, PerplexitySearchFetcher, ArxivFetcher };
export { parseAndNormalize } from './base.js';

type FetcherType = SourceSpec['type'];
type FetcherFactory = () => SourceFetcher;

const registry = new Map<FetcherType, FetcherFactory>();
registry.set('rss', () => new RssFetcher());
registry.set('perplexity_search', () => new PerplexitySearchFetcher());
registry.set('arxiv', () => new ArxivFetcher());

export function resolveFetcher(type: FetcherType): SourceFetcher | undefined {
  const factory = registry.get(type);
  return factory ? factory() : undefined;
}

export function knownFetcherTypes(): FetcherType[] {
  return Array.from(registry.keys());
}
