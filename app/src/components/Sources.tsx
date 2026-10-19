import { useCallback, useEffect, useState } from 'react';
import type { ApiClient, SourceSpec } from '../lib/api';
import { WebsiteRowsEditor, rowsFromSources, websiteSources, type WebsiteRow } from './WebsiteRows';

interface SourcesProps {
  api: ApiClient;
  /** The agent whose manifest.yaml is edited. */
  slug: string;
}

const toLines = (arr: unknown[]): string => arr.map((v) => String(v)).join('\n');
const fromLines = (text: string): string[] =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

const area =
  'w-full rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-neutral-400';
const legend = 'text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-1';

export function Sources({ api, slug }: SourcesProps) {
  const [sources, setSources] = useState<SourceSpec[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [websites, setWebsites] = useState<WebsiteRow[]>([]);
  const [rssUrls, setRssUrls] = useState('');
  const [arxivCategories, setArxivCategories] = useState('');
  const [arxivQuery, setArxivQuery] = useState('');
  const [perplexityQueries, setPerplexityQueries] = useState('');

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const list = await api.getSources(slug);
      setSources(list);
      const rss = list.find((s) => s.type === 'rss');
      const arxiv = list.find((s) => s.type === 'arxiv');
      const perplexity = list.find((s) => s.type === 'perplexity_search');
      setRssUrls(toLines((rss?.config['urls'] as string[] | undefined) ?? []));
      setArxivCategories(toLines((arxiv?.config['categories'] as string[] | undefined) ?? []));
      setArxivQuery((arxiv?.config['query'] as string | undefined) ?? '');
      setPerplexityQueries(toLines((perplexity?.config['queries'] as string[] | undefined) ?? []));
      setWebsites(rowsFromSources(list));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [api, slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!sources) return;
    setSaving(true);
    setSaveMessage(null);
    try {
      // Keep source types this editor doesn't know (api, custom) untouched.
      const updated: SourceSpec[] = sources.filter(
        (s) => !['rss', 'arxiv', 'perplexity_search', 'website'].includes(s.type)
      );
      updated.push(...websiteSources(websites));

      const urls = fromLines(rssUrls);
      if (urls.length > 0) {
        const existing = sources.find((s) => s.type === 'rss');
        updated.push({ type: 'rss', config: { ...existing?.config, urls, maxPerFeed: existing?.config['maxPerFeed'] ?? 20 } });
      }

      const cats = fromLines(arxivCategories);
      if (cats.length > 0 || arxivQuery.trim()) {
        const existing = sources.find((s) => s.type === 'arxiv');
        updated.push({
          type: 'arxiv',
          config: { ...existing?.config, categories: cats, query: arxivQuery.trim() || undefined, maxResults: existing?.config['maxResults'] ?? 10 },
        });
      }

      const queries = fromLines(perplexityQueries);
      if (queries.length > 0) {
        const existing = sources.find((s) => s.type === 'perplexity_search');
        updated.push({ type: 'perplexity_search', config: { ...existing?.config, queries, recencyHours: existing?.config['recencyHours'] ?? 24 } });
      }

      await api.putSources(slug, updated);
      setSaveMessage('Quellen gespeichert – der nächste Lauf verwendet sie.');
      await load();
    } catch (e) {
      setSaveMessage(`Speichern fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  if (loadError) {
    return (
      <div className="rounded-md border border-red-300 bg-red-50 dark:bg-red-950/30 p-3 text-xs text-red-800 dark:text-red-200 font-mono">
        {loadError}
      </div>
    );
  }
  if (!sources) return <div className="text-sm text-neutral-500">Lädt …</div>;

  return (
    <div className="flex flex-col gap-5">
      <fieldset className="flex flex-col gap-2">
        <legend className={legend}>Webseiten</legend>
        <p className="text-xs text-neutral-400">
          Eine Seite eintragen (z. B. <code>chip.de</code>), um ihre neuesten Artikel zu bekommen. Mit Stichwörtern
          bleiben nur passende (ganze Wörter, eines genügt, z. B. <code>KI, AI</code>). Die <em>Vorschau</em> zeigt vor
          dem Speichern, was geholt würde.
        </p>
        <WebsiteRowsEditor api={api} rows={websites} onChange={setWebsites} />
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className={legend}>RSS-Feeds</legend>
        <textarea value={rssUrls} onChange={(e) => setRssUrls(e.target.value)} rows={3} className={area} placeholder="https://hnrss.org/frontpage" />
        <p className="text-xs text-neutral-400">Eine URL pro Zeile</p>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className={legend}>arXiv</legend>
        <label className="text-xs text-neutral-600 dark:text-neutral-400">Kategorien (eine pro Zeile)</label>
        <textarea value={arxivCategories} onChange={(e) => setArxivCategories(e.target.value)} rows={2} className={area} placeholder="cs.AI" />
        <label className="text-xs text-neutral-600 dark:text-neutral-400">Optionaler Suchbegriff</label>
        <input type="text" value={arxivQuery} onChange={(e) => setArxivQuery(e.target.value)} className={area} placeholder="large language models" />
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className={legend}>Perplexity-Suche</legend>
        <textarea value={perplexityQueries} onChange={(e) => setPerplexityQueries(e.target.value)} rows={2} className={area} placeholder="AI agent architectures 2026" />
        <p className="text-xs text-neutral-400">Eine Suchanfrage pro Zeile. Braucht einen Perplexity-Schlüssel (Einstellungen) und kostet pro Lauf extra.</p>
      </fieldset>

      {saveMessage ? (
        <div className="rounded-md border border-neutral-200 dark:border-neutral-800 px-3 py-2 text-xs">{saveMessage}</div>
      ) : null}
      <button
        onClick={() => void save()}
        disabled={saving}
        className="self-start rounded border border-neutral-300 dark:border-neutral-700 px-4 py-1.5 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-40"
      >
        {saving ? 'Speichert …' : 'Quellen speichern'}
      </button>
    </div>
  );
}
