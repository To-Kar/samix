import type { FetchContext, SourceItem } from '../types.js';

export interface UrlFetchConfig {}

function extractUrl(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null;
  const msg = (input as { message?: string }).message;
  if (typeof msg !== 'string') return null;
  const match = msg.match(/https?:\/\/[^\s<>"{}|\\^`[\]]+/);
  return match ? match[0] : null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export class UrlFetchFetcher {
  readonly type = 'url_fetch' as const;

  async fetch(config: UrlFetchConfig, ctx: FetchContext): Promise<SourceItem[]> {
    const url = extractUrl((ctx as unknown as { input?: unknown }).input);
    if (!url) return [];

    const res = await fetch(url, {
      headers: { 'User-Agent': 'Samix/1.0' },
      signal: AbortSignal.timeout(10_000),
    });
    const html = await res.text();
    const text = stripHtml(html).slice(0, 8000);

    return [{ url, title: url, snippet: text, sourceName: 'url_fetch' }];
  }
}
