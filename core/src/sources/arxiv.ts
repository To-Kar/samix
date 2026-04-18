import type { FetchContext, SourceFetcher, SourceItem } from '../types.js';
import { parseAndNormalize } from './base.js';

export interface ArxivConfig {
  categories?: string[];
  query?: string;
  maxResults?: number;
}

const BASE_URL = 'http://export.arxiv.org/api/query';
const UA = 'samix/0.1 (+https://samix.app)';
const DEFAULT_MAX_RESULTS = 15;
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 2000;

export class ArxivFetcher implements SourceFetcher<ArxivConfig> {
  readonly type = 'arxiv' as const;

  async fetch(config: ArxivConfig, ctx: FetchContext): Promise<SourceItem[]> {
    const params = new URLSearchParams({
      search_query: buildQuery(config),
      start: '0',
      max_results: String(config.maxResults ?? DEFAULT_MAX_RESULTS),
      sortBy: 'submittedDate',
      sortOrder: 'descending',
    });
    const url = `${BASE_URL}?${params}`;

    const xml = await fetchWithBackoff(url, ctx);
    const { items } = parseAndNormalize(xml);

    // Tag source by the primary category (first one), else generic "arxiv".
    const sourceName = config.categories?.[0]
      ? `arxiv:${config.categories[0]}`
      : 'arxiv';

    return items.map((i) => ({ ...i, sourceName }));
  }
}

function buildQuery(config: ArxivConfig): string {
  const parts: string[] = [];
  if (config.categories?.length) {
    const cats = config.categories.map((c) => `cat:${c}`).join(' OR ');
    parts.push(`(${cats})`);
  }
  if (config.query) {
    // Quote the user query and escape embedded quotes.
    parts.push(`all:"${config.query.replace(/"/g, '\\"')}"`);
  }
  return parts.length ? parts.join(' AND ') : 'cat:cs.AI';
}

async function fetchWithBackoff(url: string, ctx: FetchContext): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { headers: { 'User-Agent': UA } });
    } catch (err) {
      lastError = err;
      break;
    }
    // Arxiv tightened rate-limits Feb 2026 — 429s show up even when within
    // the published 3 req/s. Exponential backoff is the documented remedy.
    if (res.status === 429) {
      const wait = BACKOFF_BASE_MS * 2 ** (attempt - 1);
      ctx.logger.warn({ attempt, wait }, 'arxiv_429_backoff');
      await sleep(wait);
      continue;
    }
    if (!res.ok) {
      throw new Error(`Arxiv HTTP ${res.status}`);
    }
    return res.text();
  }
  throw new Error(
    `Arxiv fetch failed after ${MAX_RETRIES} attempts${lastError ? `: ${String(lastError)}` : ' (rate-limited)'}`
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
