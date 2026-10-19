// Match a model-produced article back to the fetched source item it cites.
// Matching is by URL only, so anything taken from the item (name, image)
// comes from the fetcher, never from the model.

import type { SourceItem } from '../types.js';

/** Comparable form of a URL: no fragment, no trailing slash. */
export function urlKey(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.toString().replace(/\/$/, '');
  } catch {
    return url.trim();
  }
}

/** Source items keyed by `urlKey(item.url)`. First item wins on duplicates. */
export type SourceIndex = Map<string, SourceItem>;

export function indexSourceItems(items: SourceItem[]): SourceIndex {
  const index: SourceIndex = new Map();
  for (const item of items) {
    const key = urlKey(item.url);
    if (!index.has(key)) index.set(key, item);
  }
  return index;
}

export function findSourceItem(index: SourceIndex, sourceUrl: string | null | undefined): SourceItem | undefined {
  return sourceUrl ? index.get(urlKey(sourceUrl)) : undefined;
}
