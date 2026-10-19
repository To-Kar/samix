import { useCallback, useEffect, useState } from 'react';
import type { ApiClient, SourceSpec } from '../lib/api';
import { useI18n } from '../i18n/I18nProvider';

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

export function Sources({ api }: SourcesProps) {
  const { t } = useI18n();
  const [sources, setSources] = useState<SourceSpec[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Editable field state
  const [rssUrls, setRssUrls] = useState('');
  const [arxivCategories, setArxivCategories] = useState('');
  const [arxivQuery, setArxivQuery] = useState('');
  const [perplexityQueries, setPerplexityQueries] = useState('');

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
        (s) => s.type !== 'rss' && s.type !== 'arxiv' && s.type !== 'perplexity_search'
      );

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
      setSaveMessage(t.sources.saved);
      await load();
    } catch (e) {
      setSaveMessage(t.sources.saveFailed(e instanceof Error ? e.message : String(e)));
    } finally {
      setSaving(false);
    }
  };

  if (loadError) {
    return (
      <div className="samix-error" role="alert">
        <b>{t.status.error}</b> <span className="font-mono">{loadError}</span>
      </div>
    );
  }

  if (!sources) {
    return <div className="samix-hint">{t.sources.loading}</div>;
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="samix-hint">
        {t.sources.intro(NEWSLETTER_SLUG, 'manifest.yaml')}
      </p>

      <fieldset className="flex flex-col gap-2">
        <legend className="samix-label mb-1">
          {t.sources.rss}
        </legend>
        <textarea
          value={rssUrls}
          onChange={(e) => setRssUrls(e.target.value)}
          rows={4}
          className="samix-input font-mono"
          placeholder="https://hnrss.org/frontpage&#10;https://feeds.example.com/rss"
        />
        <p className="samix-hint">{t.sources.rssHint}</p>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="samix-label mb-1">
          {t.sources.arxiv}
        </legend>
        <label className="text-sm text-ink-soft">
          {t.sources.arxivCategories}
        </label>
        <textarea
          value={arxivCategories}
          onChange={(e) => setArxivCategories(e.target.value)}
          rows={3}
          className="samix-input font-mono"
          placeholder="cs.AI&#10;cs.LG"
        />
        <label className="text-sm text-ink-soft">
          {t.sources.arxivQuery}
        </label>
        <input
          type="text"
          value={arxivQuery}
          onChange={(e) => setArxivQuery(e.target.value)}
          className="samix-input font-mono"
          placeholder="large language models"
        />
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="samix-label mb-1">
          {t.sources.perplexity}
        </legend>
        <textarea
          value={perplexityQueries}
          onChange={(e) => setPerplexityQueries(e.target.value)}
          rows={3}
          className="samix-input font-mono"
          placeholder="AI agent architectures 2026&#10;open source LLMs"
        />
        <p className="samix-hint">
          {t.sources.perplexityHint}
        </p>
      </fieldset>

      {saveMessage ? (
        <div className="samix-note">
          {saveMessage}
        </div>
      ) : null}

      <button
        onClick={() => void save()}
        disabled={saving}
        className="self-start samix-button-primary"
      >
        {saving ? t.sources.saving : t.sources.save}
      </button>
    </div>
  );
}
