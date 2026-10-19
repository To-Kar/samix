import { useCallback, useEffect, useState } from 'react';
import type { ApiClient, SourceSpec } from '../lib/api';
import { useI18n } from '../i18n/I18nProvider';
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
  'w-full rounded border border-line bg-paper-raised px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-focus';
const legend = 'text-xs font-semibold uppercase tracking-wide text-ink-soft mb-1';

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
  const [webSearch, setWebSearch] = useState(false);
  const [recency, setRecency] = useState(24);
  const [topic, setTopic] = useState<string | null>(null);
  const [searchKey, setSearchKey] = useState(true);
  const { t } = useI18n();
  const s = t.sources;

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
      setWebSearch(perplexity?.config['useTopic'] === true);
      setRecency(Number(perplexity?.config['recencyHours'] ?? 24));
      const [agents, models] = await Promise.all([api.listAgents(), api.listModels()]);
      setTopic(agents.find((a) => a.slug === slug)?.topic ?? null);
      setSearchKey(models.some((m) => m.id === 'perplexity-sonar' && m.keyConfigured));
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
      if (queries.length > 0 || webSearch) {
        const existing = sources.find((s) => s.type === 'perplexity_search');
        updated.push({ type: 'perplexity_search', config: { ...existing?.config, queries, useTopic: webSearch, recencyHours: recency } });
      }

      await api.putSources(slug, updated);
      setSaveMessage(s.saved);
      await load();
    } catch (e) {
      setSaveMessage(s.saveFailed(e instanceof Error ? e.message : String(e)));
    } finally {
      setSaving(false);
    }
  };

  if (loadError) {
    return (
      <div className="rounded-md border border-danger bg-danger-paper p-3 text-xs text-danger font-mono" role="alert">
        {t.status.error} {loadError}
      </div>
    );
  }
  if (!sources) return <div className="text-sm text-ink-soft">{s.loading}</div>;

  return (
    <div className="flex flex-col gap-5">
      <fieldset className="flex flex-col gap-2">
        <legend className={legend}>{s.websites}</legend>
        <p className="text-xs text-ink-soft">
          {s.websitesHint.before}
          <code>chip.de</code>
          {s.websitesHint.middle}
          <code>KI, AI</code>
          {s.websitesHint.andThe}
          <em>{s.websitesHint.preview}</em>
          {s.websitesHint.after}
        </p>
        <WebsiteRowsEditor api={api} rows={websites} onChange={setWebsites} />
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className={legend}>{s.rss}</legend>
        <textarea value={rssUrls} onChange={(e) => setRssUrls(e.target.value)} rows={3} className={area} placeholder="https://hnrss.org/frontpage" />
        <p className="text-xs text-ink-soft">{s.onePerLine}</p>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className={legend}>arXiv</legend>
        <label className="text-xs text-ink-soft">{s.arxivCategories}</label>
        <textarea value={arxivCategories} onChange={(e) => setArxivCategories(e.target.value)} rows={2} className={area} placeholder="cs.AI" />
        <label className="text-xs text-ink-soft">{s.arxivQuery}</label>
        <input type="text" value={arxivQuery} onChange={(e) => setArxivQuery(e.target.value)} className={area} placeholder="large language models" />
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className={legend}>{s.webSearch}</legend>
        <label className="flex items-start gap-2 text-xs">
          <input type="checkbox" className="mt-0.5" checked={webSearch} onChange={(e) => setWebSearch(e.target.checked)} />
          <span>
            {s.webSearchAllow}
            {topic ? (
              <>
                {' '}
                ({s.webSearchTopic} <em>{topic}</em>)
              </>
            ) : (
              <span className="text-ink-soft">{s.webSearchNoTopic}</span>
            )}
          </span>
        </label>
        <label className="flex items-center gap-2 text-xs text-ink-soft">
          {s.recency}
          <select value={recency} onChange={(e) => setRecency(Number(e.target.value))} className={`${area} w-auto`}>
            <option value={24}>{s.hours24}</option>
            <option value={72}>{s.days3}</option>
            <option value={168}>{s.days7}</option>
          </select>
        </label>
        <label className="text-xs text-ink-soft">{s.moreQueries}</label>
        <textarea value={perplexityQueries} onChange={(e) => setPerplexityQueries(e.target.value)} rows={2} className={area} placeholder={s.queryPlaceholder} />
        <p className="text-xs text-ink-soft">
          {s.searchCost}
        </p>
        {(webSearch || perplexityQueries.trim()) && !searchKey ? (
          <p className="text-xs text-warning">
            {s.noSearchKey}
          </p>
        ) : null}
      </fieldset>

      {saveMessage ? (
        <div className="rounded-md border border-rule px-3 py-2 text-xs">{saveMessage}</div>
      ) : null}
      <button
        onClick={() => void save()}
        disabled={saving}
        className="self-start rounded border border-line px-4 py-1.5 text-xs hover:bg-ink/5 disabled:opacity-40"
      >
        {saving ? s.saving : s.save}
      </button>
    </div>
  );
}
