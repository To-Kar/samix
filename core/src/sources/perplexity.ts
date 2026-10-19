import { parseHTML } from 'linkedom';
import { z } from 'zod';
import { extractArticle } from '../content/extract.js';
import { safeFetch } from '../net/safeFetch.js';
import { normalizeUrl } from '../output/traceability.js';
import type { FetchContext, SourceFetcher, SourceItem } from '../types.js';

// "Search the web for this topic" (Perplexity Sonar). Perplexity supplies the
// URLs; everything the model later sees about an item comes from the page
// itself (title, date, a short excerpt), fetched through safeFetch — not from
// Perplexity's generated answer. Traceability then works as for any source.
//
// Searching costs money, unlike feeds: every request is reserved against the
// budget first and its (estimated) cost is reported to the runner.

const configSchema = z
  .object({
    queries: z.array(z.string().trim().min(1).max(200)).max(10).default([]),
    /** Also search for the agent's own topic (the Ressort's focus sentence). */
    useTopic: z.boolean().default(false),
    recencyHours: z.number().positive().optional(),
    maxItems: z.number().int().min(1).max(30).default(15),
  })
  .strict();
export type PerplexitySearchConfig = z.input<typeof configSchema>;

// Throws a readable error; shared with the API that saves sources.
export function parsePerplexityConfig(raw: unknown) {
  const config = configSchema.parse(raw);
  if (config.queries.length === 0 && !config.useTopic) {
    throw new Error('a web search needs at least one query or "use the topic"');
  }
  return config;
}

interface PerplexitySearchResponse {
  search_results?: Array<{ url: string; title?: string; date?: string }>;
  citations?: string[];
}

// Replaceable in tests.
export const perplexityDeps = {
  fetch: (url: string, init: RequestInit): Promise<Response> => fetch(url, init),
};

const ENDPOINT = 'https://api.perplexity.ai/chat/completions';
const MODEL = 'sonar';
const EXCERPT_CHARS = 500;
const EXCERPT_CONCURRENCY = 4;
const EXCERPT_MAX_BYTES = 1_500_000;

// [Unverified] Perplexity bills per request on top of tokens; the exact amount
// is not known here, so each search is booked at this estimate (override with
// SAMIX_PERPLEXITY_COST_PER_SEARCH). The ledger labels it as an estimate in the log.
export function searchCostEstimateUsd(): number {
  const n = Number(process.env.SAMIX_PERPLEXITY_COST_PER_SEARCH);
  return Number.isFinite(n) && n >= 0 && process.env.SAMIX_PERPLEXITY_COST_PER_SEARCH ? n : 0.01;
}

const SEARCH_SYSTEM_PROMPT =
  'You are a web search tool. Find recent, credible news sources on the user query. Return a one-sentence summary.';

export class PerplexitySearchFetcher implements SourceFetcher<PerplexitySearchConfig> {
  readonly type = 'perplexity_search' as const;

  async fetch(rawConfig: PerplexitySearchConfig, ctx: FetchContext): Promise<SourceItem[]> {
    const config = parsePerplexityConfig(rawConfig);
    const apiKey = process.env.PERPLEXITY_API_KEY;
    if (!apiKey) throw new Error('PERPLEXITY_API_KEY not set');

    const queries = [...config.queries];
    if (config.useTopic && ctx.topic) queries.push(ctx.topic);
    if (queries.length === 0) {
      ctx.logger.warn('perplexity_search_no_query');
      return [];
    }

    const recencyFilter = recencyToFilter(config.recencyHours);
    const found = new Map<string, { url: string; title: string; date?: Date; query: string }>();
    const perSearch = searchCostEstimateUsd();

    for (const query of queries) {
      // Never search without room in the budget; the run continues with what other sources gave.
      if (ctx.reserve && !(await ctx.reserve(perSearch))) {
        ctx.logger.warn({ query }, 'perplexity_search_skipped_budget');
        break;
      }
      try {
        const body: Record<string, unknown> = {
          model: MODEL,
          messages: [
            { role: 'system', content: SEARCH_SYSTEM_PROMPT },
            { role: 'user', content: query },
          ],
          max_tokens: 200,
        };
        if (recencyFilter) body.search_recency_filter = recencyFilter;

        const res = await perplexityDeps.fetch(ENDPOINT, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          ctx.logger.warn({ query, status: res.status, body: text.slice(0, 300) }, 'perplexity_search_http_error');
          continue;
        }
        // A request that was answered is billed, whether or not it found anything usable.
        ctx.spend?.(perSearch, `perplexity search (estimate): ${query.slice(0, 60)}`);

        const data = (await res.json()) as PerplexitySearchResponse;
        const results = data.search_results?.length
          ? data.search_results.map((r) => ({ url: r.url, title: r.title, date: r.date }))
          : (data.citations ?? []).map((url) => ({ url, title: undefined, date: undefined }));
        for (const r of results) {
          if (!r.url) continue;
          const key = normalizeUrl(r.url);
          if (!key || found.has(key)) continue;
          found.set(key, { url: r.url, title: r.title ?? '', date: parseDate(r.date), query });
        }
      } catch (err) {
        ctx.logger.warn({ query, err: err instanceof Error ? err.message : String(err) }, 'perplexity_search_error');
      }
    }

    const candidates = [...found.values()].slice(0, config.maxItems);
    return enrich(candidates, ctx);
  }
}

// Opens each result page (safely) for its excerpt and, if Perplexity gave none,
// its publication date. Results that end up without a date are dropped: an
// article without a date cannot be traced.
async function enrich(
  candidates: { url: string; title: string; date?: Date; query: string }[],
  ctx: FetchContext
): Promise<SourceItem[]> {
  const out: SourceItem[] = [];
  let next = 0;
  const worker = async () => {
    for (;;) {
      const c = candidates[next++];
      if (!c) return;
      const page = await readPage(c.url).catch(() => null);
      const publishedAt = c.date ?? page?.publishedAt;
      if (!publishedAt) {
        ctx.logger.info({ url: c.url }, 'perplexity_result_dropped_no_date');
        continue;
      }
      const title = c.title || page?.title;
      if (!title) continue;
      out.push({
        url: c.url,
        title,
        snippet: page?.excerpt,
        publishedAt,
        sourceName: hostOf(c.url),
        sourceType: 'perplexity_search',
        raw: { via: 'perplexity', query: c.query },
      });
    }
  };
  await Promise.all(Array.from({ length: EXCERPT_CONCURRENCY }, worker));
  // Keep the order Perplexity returned them in.
  const rank = new Map(candidates.map((c, i) => [c.url, i]));
  return out.sort((a, b) => (rank.get(a.url) ?? 0) - (rank.get(b.url) ?? 0));
}

async function readPage(url: string): Promise<{ title?: string; excerpt?: string; publishedAt?: Date } | null> {
  const res = await safeFetch(url, { maxBytes: EXCERPT_MAX_BYTES, timeoutMs: 8000, contentType: /html/i, accept: 'text/html' });
  const html = res.body.toString('utf8');
  const { document } = parseHTML(html);
  const meta = (sel: string) => document.querySelector(sel)?.getAttribute('content') ?? undefined;
  const dateRaw =
    meta('meta[property="article:published_time"]') ??
    meta('meta[name="date"]') ??
    meta('meta[itemprop="datePublished"]') ??
    document.querySelector('time[datetime]')?.getAttribute('datetime') ??
    undefined;
  const title = meta('meta[property="og:title"]') ?? document.querySelector('title')?.textContent ?? undefined;

  let excerpt = meta('meta[property="og:description"]') ?? meta('meta[name="description"]');
  if (!excerpt) {
    const article = extractArticle(html, res.finalUrl);
    const first = article?.blocks.find((b) => b.type === 'paragraph');
    excerpt = first && 'text' in first ? first.text : undefined;
  }
  return {
    title: title?.trim() || undefined,
    excerpt: excerpt?.replace(/\s+/g, ' ').trim().slice(0, EXCERPT_CHARS) || undefined,
    publishedAt: parseDate(dateRaw),
  };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'web';
  }
}

function recencyToFilter(hours?: number): string | undefined {
  if (hours == null) return undefined;
  if (hours <= 1) return 'hour';
  if (hours <= 24) return 'day';
  if (hours <= 24 * 7) return 'week';
  return 'month';
}

function parseDate(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
