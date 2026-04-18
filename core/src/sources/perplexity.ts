import type { FetchContext, SourceFetcher, SourceItem } from '../types.js';

export interface PerplexitySearchConfig {
  queries: string[];
  recencyHours?: number;
}

interface PerplexitySearchResponse {
  search_results?: Array<{ url: string; title?: string; date?: string }>;
  citations?: string[];
}

const ENDPOINT = 'https://api.perplexity.ai/chat/completions';
const MODEL = 'sonar';

const SEARCH_SYSTEM_PROMPT =
  'You are a web search tool. Find recent, credible sources on the user query and ground every statement in citations. Return a brief summary.';

export class PerplexitySearchFetcher implements SourceFetcher<PerplexitySearchConfig> {
  readonly type = 'perplexity_search' as const;

  async fetch(config: PerplexitySearchConfig, ctx: FetchContext): Promise<SourceItem[]> {
    const apiKey = process.env.PERPLEXITY_API_KEY;
    if (!apiKey) {
      throw new Error('PERPLEXITY_API_KEY not set');
    }

    const recencyFilter = recencyToFilter(config.recencyHours);
    const out: SourceItem[] = [];

    for (const query of config.queries) {
      try {
        const body: Record<string, unknown> = {
          model: MODEL,
          messages: [
            { role: 'system', content: SEARCH_SYSTEM_PROMPT },
            { role: 'user', content: query },
          ],
        };
        if (recencyFilter) body.search_recency_filter = recencyFilter;

        const res = await fetch(ENDPOINT, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          ctx.logger.warn(
            { query, status: res.status, body: text },
            'perplexity_search_http_error'
          );
          continue;
        }

        const data = (await res.json()) as PerplexitySearchResponse;
        const accessedAt = new Date();

        if (data.search_results?.length) {
          for (const r of data.search_results) {
            if (!r.url) continue;
            out.push({
              url: r.url,
              title: r.title ?? query,
              publishedAt: parseDate(r.date),
              sourceName: 'perplexity',
              raw: { query, accessedAt: accessedAt.toISOString(), ...r },
            });
          }
        } else if (data.citations?.length) {
          for (const url of data.citations) {
            out.push({
              url,
              title: query,
              sourceName: 'perplexity',
              raw: { query, accessedAt: accessedAt.toISOString() },
            });
          }
        }
      } catch (err) {
        ctx.logger.warn(
          { query, err: err instanceof Error ? err.message : String(err) },
          'perplexity_search_error'
        );
      }
    }

    return out;
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
