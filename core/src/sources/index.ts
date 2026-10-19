import type { FetcherType, SourceFetcher, SourceSpec } from '../types.js';
import { RssFetcher } from './rss.js';
import { PerplexitySearchFetcher, parsePerplexityConfig } from './perplexity.js';
import { ArxivFetcher } from './arxiv.js';
import { WebsiteFetcher, parseWebsiteConfig } from './website.js';

export { RssFetcher, PerplexitySearchFetcher, ArxivFetcher, WebsiteFetcher };
export { parseAndNormalize } from './base.js';

type FetcherFactory = () => SourceFetcher;

const registry = new Map<SourceSpec['type'], FetcherFactory>();
registry.set('rss', () => new RssFetcher());
registry.set('perplexity_search', () => new PerplexitySearchFetcher());
registry.set('arxiv', () => new ArxivFetcher());
registry.set('website', () => new WebsiteFetcher());

// Overrides the fetcher for a type. Used by tests to avoid real network I/O.
export function registerFetcher(type: FetcherType, factory: FetcherFactory): void {
  registry.set(type, factory);
}

// Throws if a source spec can't work, so it is refused when saved rather than
// failing at the next scheduled run.
export function validateSourceSpec(spec: SourceSpec): void {
  if (spec.type === 'website') parseWebsiteConfig(spec.config);
  if (spec.type === 'perplexity_search') parsePerplexityConfig(spec.config);
}

export function resolveFetcher(type: SourceSpec['type']): SourceFetcher | undefined {
  const factory = registry.get(type);
  return factory ? factory() : undefined;
}

export function knownFetcherTypes(): SourceSpec['type'][] {
  return Array.from(registry.keys());
}
