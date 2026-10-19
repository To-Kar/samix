import { useCallback, useEffect, useState } from 'react';
import type { ApiClient, SourcePreview, SourceSpec } from '../lib/api';

const NEWSLETTER_SLUG = 'newsletter-ai';

interface SourcesProps {
  api: ApiClient;
}

function toLines(arr: unknown[]): string {
  return arr.map((v) => String(v)).join('\n');
}

function fromLines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

interface WebsiteRow {
  url: string;
  keywords: string;
  maxItems: number;
  preview: SourcePreview | null;
  previewing: boolean;
  previewError: string | null;
}

const emptyRow = (): WebsiteRow => ({
  url: '',
  keywords: '',
  maxItems: 10,
  preview: null,
  previewing: false,
  previewError: null,
});

function splitKeywords(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((k) => k.trim())
    .filter(Boolean);
}

function websiteConfig(row: WebsiteRow): Record<string, unknown> {
  const keywords = splitKeywords(row.keywords);
  return {
    url: row.url.trim(),
    maxItems: row.maxItems,
    ...(keywords.length ? { filter: { keywords } } : {}),
  };
}

const METHOD_LABEL: Record<string, string> = {
  feed: 'RSS/Atom feed',
  sitemap: 'sitemap',
  page: 'headline links on the page',
};

export function Sources({ api }: SourcesProps) {
  const [sources, setSources] = useState<SourceSpec[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Editable field state
  const [rssUrls, setRssUrls] = useState('');
  const [arxivCategories, setArxivCategories] = useState('');
  const [arxivQuery, setArxivQuery] = useState('');
  const [perplexityQueries, setPerplexityQueries] = useState('');
  const [websites, setWebsites] = useState<WebsiteRow[]>([]);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const list = await api.getSources(NEWSLETTER_SLUG);
      setSources(list);

      const rss = list.find((s) => s.type === 'rss');
      const arxiv = list.find((s) => s.type === 'arxiv');
      const perplexity = list.find((s) => s.type === 'perplexity_search');

      if (rss) {
        const urls = (rss.config['urls'] as string[] | undefined) ?? [];
        setRssUrls(toLines(urls));
      }
      if (arxiv) {
        const cats = (arxiv.config['categories'] as string[] | undefined) ?? [];
        const q = (arxiv.config['query'] as string | undefined) ?? '';
        setArxivCategories(toLines(cats));
        setArxivQuery(q);
      }
      if (perplexity) {
        const qs = (perplexity.config['queries'] as string[] | undefined) ?? [];
        setPerplexityQueries(toLines(qs));
      }
      setWebsites(
        list
          .filter((s) => s.type === 'website')
          .map((s) => {
            const filter = s.config['filter'] as { keywords?: string[]; topic?: string } | undefined;
            const kw = [...(filter?.keywords ?? []), ...(filter?.topic ? [filter.topic] : [])];
            return {
              ...emptyRow(),
              url: String(s.config['url'] ?? ''),
              keywords: kw.join(', '),
              maxItems: Number(s.config['maxItems'] ?? 10),
            };
          })
      );
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!sources) return;
    setSaving(true);
    setSaveMessage(null);
    try {
      const updated: SourceSpec[] = sources.filter(
        (s) =>
          s.type !== 'rss' &&
          s.type !== 'arxiv' &&
          s.type !== 'perplexity_search' &&
          s.type !== 'website'
      );

      for (const row of websites) {
        if (row.url.trim()) updated.push({ type: 'website', config: websiteConfig(row) });
      }

      const urls = fromLines(rssUrls);
      if (urls.length > 0) {
        const existing = sources.find((s) => s.type === 'rss');
        updated.push({
          type: 'rss',
          config: { ...existing?.config, urls, maxPerFeed: existing?.config['maxPerFeed'] ?? 20 },
        });
      }

      const cats = fromLines(arxivCategories);
      if (cats.length > 0 || arxivQuery.trim()) {
        const existing = sources.find((s) => s.type === 'arxiv');
        updated.push({
          type: 'arxiv',
          config: {
            ...existing?.config,
            categories: cats,
            query: arxivQuery.trim() || undefined,
            maxResults: existing?.config['maxResults'] ?? 10,
          },
        });
      }

      const queries = fromLines(perplexityQueries);
      if (queries.length > 0) {
        const existing = sources.find((s) => s.type === 'perplexity_search');
        updated.push({
          type: 'perplexity_search',
          config: {
            ...existing?.config,
            queries,
            recencyHours: existing?.config['recencyHours'] ?? 24,
          },
        });
      }

      await api.putSources(NEWSLETTER_SLUG, updated);
      setSaveMessage('Sources saved — next run will use the updated config.');
      await load();
    } catch (e) {
      setSaveMessage(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const patchRow = (i: number, patch: Partial<WebsiteRow>) =>
    setWebsites((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const runPreview = async (i: number) => {
    const row = websites[i];
    if (!row || !row.url.trim()) return;
    patchRow(i, { previewing: true, previewError: null, preview: null });
    try {
      const preview = await api.previewSource({ type: 'website', config: websiteConfig(row) });
      patchRow(i, { preview, previewing: false });
    } catch (e) {
      patchRow(i, { previewError: e instanceof Error ? e.message : String(e), previewing: false });
    }
  };

  if (loadError) {
    return (
      <div className="rounded-md border border-red-300 bg-red-50 dark:bg-red-950/30 p-3 text-xs text-red-800 dark:text-red-200 font-mono">
        {loadError}
      </div>
    );
  }

  if (!sources) {
    return <div className="text-sm text-neutral-500">Loading sources…</div>;
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-xs text-neutral-500">
        Edit the sources for <code>newsletter-ai</code>. Saves write directly to{' '}
        <code>manifest.yaml</code> — one entry per line.
      </p>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-1">
          Websites
        </legend>
        <p className="text-xs text-neutral-400">
          Enter a site (e.g. <code>chip.de</code>) to get its newest articles. Add keywords to keep
          only matching ones (whole words, any of them; e.g. <code>KI, AI</code>). Use{' '}
          <em>Preview</em> to see what would be fetched before saving.
        </p>
        {websites.map((row, i) => (
          <div key={i} className="flex flex-col gap-2 rounded border border-neutral-200 dark:border-neutral-800 p-2">
            <div className="flex gap-2">
              <input
                type="text"
                value={row.url}
                onChange={(e) => patchRow(i, { url: e.target.value, preview: null })}
                placeholder="chip.de"
                aria-label="Website"
                className="flex-1 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-neutral-400"
              />
              <input
                type="text"
                value={row.keywords}
                onChange={(e) => patchRow(i, { keywords: e.target.value, preview: null })}
                placeholder="keywords (optional), comma separated"
                aria-label="Keywords"
                className="flex-1 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-neutral-400"
              />
              <input
                type="number"
                min={1}
                max={50}
                value={row.maxItems}
                onChange={(e) => patchRow(i, { maxItems: Number(e.target.value) || 10, preview: null })}
                aria-label="Max articles"
                title="Max. articles"
                className="w-16 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-neutral-400"
              />
              <button
                onClick={() => void runPreview(i)}
                disabled={row.previewing || !row.url.trim()}
                className="rounded border border-neutral-300 dark:border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-40"
              >
                {row.previewing ? 'Checking…' : 'Preview'}
              </button>
              <button
                onClick={() => setWebsites((rows) => rows.filter((_, j) => j !== i))}
                className="rounded border border-neutral-300 dark:border-neutral-700 px-2 py-1 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
              >
                Remove
              </button>
            </div>

            {row.previewError ? (
              <div className="text-xs text-red-600 dark:text-red-400 font-mono">{row.previewError}</div>
            ) : null}

            {row.preview ? (
              <div className="text-xs text-neutral-600 dark:text-neutral-400 flex flex-col gap-1">
                <p>
                  {row.preview.method
                    ? `Found via ${METHOD_LABEL[row.preview.method] ?? row.preview.method}: ${row.preview.candidates} articles, ${row.preview.items.length} kept`
                    : 'Nothing found.'}
                  {row.preview.withoutDate ? ` · ${row.preview.withoutDate} without date skipped` : ''}
                  {row.preview.filteredOut ? ` · ${row.preview.filteredOut} filtered out` : ''}
                </p>
                {row.preview.warnings.map((w) => (
                  <p key={w} className="text-amber-700 dark:text-amber-400">
                    ⚠ {w}
                  </p>
                ))}
                <ul className="list-disc pl-5">
                  {row.preview.items.map((it) => (
                    <li key={it.url}>
                      {it.title}{' '}
                      <span className="text-neutral-400">
                        ({it.publishedAt ? new Date(it.publishedAt).toLocaleDateString('de-DE') : 'no date'})
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ))}
        <button
          onClick={() => setWebsites((rows) => [...rows, emptyRow()])}
          className="self-start rounded border border-neutral-300 dark:border-neutral-700 px-3 py-1 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          + Add website
        </button>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-1">
          RSS Feeds
        </legend>
        <textarea
          value={rssUrls}
          onChange={(e) => setRssUrls(e.target.value)}
          rows={4}
          className="w-full rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-neutral-400"
          placeholder="https://hnrss.org/frontpage&#10;https://feeds.example.com/rss"
        />
        <p className="text-xs text-neutral-400">One URL per line</p>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-1">
          Arxiv
        </legend>
        <label className="text-xs text-neutral-600 dark:text-neutral-400">
          Categories (one per line)
        </label>
        <textarea
          value={arxivCategories}
          onChange={(e) => setArxivCategories(e.target.value)}
          rows={3}
          className="w-full rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-neutral-400"
          placeholder="cs.AI&#10;cs.LG"
        />
        <label className="text-xs text-neutral-600 dark:text-neutral-400">
          Optional keyword filter
        </label>
        <input
          type="text"
          value={arxivQuery}
          onChange={(e) => setArxivQuery(e.target.value)}
          className="w-full rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-neutral-400"
          placeholder="large language models"
        />
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-1">
          Perplexity Search
        </legend>
        <textarea
          value={perplexityQueries}
          onChange={(e) => setPerplexityQueries(e.target.value)}
          rows={3}
          className="w-full rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-neutral-400"
          placeholder="AI agent architectures 2026&#10;open source LLMs"
        />
        <p className="text-xs text-neutral-400">
          One search query per line. Requires a Perplexity API key in Settings.
        </p>
      </fieldset>

      {saveMessage ? (
        <div className="rounded-md border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/50 px-3 py-2 text-xs text-neutral-700 dark:text-neutral-300">
          {saveMessage}
        </div>
      ) : null}

      <button
        onClick={() => void save()}
        disabled={saving}
        className="self-start rounded border border-neutral-300 dark:border-neutral-700 px-4 py-1.5 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-40"
      >
        {saving ? 'Saving…' : 'Save sources'}
      </button>
    </div>
  );
}
