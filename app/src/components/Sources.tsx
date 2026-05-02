import { useCallback, useEffect, useState } from 'react';
import type { AgentSummary, ApiClient, SourceSpec } from '../lib/api';

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
  const [agents, setAgents] = useState<AgentSummary[] | null>(null);
  const [selectedSlug, setSelectedSlug] = useState<string>('');
  const [sources, setSources] = useState<SourceSpec[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Editable field state
  const [rssUrls, setRssUrls] = useState('');
  const [arxivCategories, setArxivCategories] = useState('');
  const [arxivQuery, setArxivQuery] = useState('');
  const [perplexityQueries, setPerplexityQueries] = useState('');
  const [workspacePath, setWorkspacePath] = useState('');
  const [workspaceInclude, setWorkspaceInclude] = useState('');

  useEffect(() => {
    api
      .listAgents()
      .then((list) => {
        setAgents(list);
        if (list.length > 0 && list[0]) setSelectedSlug(list[0].slug);
      })
      .catch((e: unknown) =>
        setLoadError(e instanceof Error ? e.message : String(e))
      );
  }, [api]);

  const load = useCallback(
    async (slug: string) => {
      if (!slug) return;
      setLoadError(null);
      setSources(null);
      setSaveMessage(null);
      try {
        const list = await api.getSources(slug);
        setSources(list);

        const rss = list.find((s) => s.type === 'rss');
        const arxiv = list.find((s) => s.type === 'arxiv');
        const perplexity = list.find((s) => s.type === 'perplexity_search');
        const workspace = list.find((s) => s.type === 'workspace');

        setRssUrls(rss ? toLines((rss.config['urls'] as string[] | undefined) ?? []) : '');
        setArxivCategories(
          arxiv ? toLines((arxiv.config['categories'] as string[] | undefined) ?? []) : ''
        );
        setArxivQuery(arxiv ? ((arxiv.config['query'] as string | undefined) ?? '') : '');
        setPerplexityQueries(
          perplexity
            ? toLines((perplexity.config['queries'] as string[] | undefined) ?? [])
            : ''
        );
        setWorkspacePath(
          workspace ? ((workspace.config['path'] as string | undefined) ?? '') : ''
        );
        setWorkspaceInclude(
          workspace
            ? toLines((workspace.config['include'] as string[] | undefined) ?? [])
            : ''
        );
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : String(e));
      }
    },
    [api]
  );

  useEffect(() => {
    if (selectedSlug) void load(selectedSlug);
  }, [selectedSlug, load]);

  const save = async () => {
    if (!sources || !selectedSlug) return;
    setSaving(true);
    setSaveMessage(null);
    try {
      const updated: SourceSpec[] = sources.filter(
        (s) =>
          s.type !== 'rss' &&
          s.type !== 'arxiv' &&
          s.type !== 'perplexity_search' &&
          s.type !== 'workspace'
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

      if (workspacePath.trim()) {
        const existing = sources.find((s) => s.type === 'workspace');
        updated.push({
          type: 'workspace',
          config: {
            ...existing?.config,
            path: workspacePath.trim(),
            include: fromLines(workspaceInclude),
          },
        });
      }

      await api.putSources(selectedSlug, updated);
      setSaveMessage('Sources saved — next run will use the updated config.');
      await load(selectedSlug);
    } catch (e) {
      setSaveMessage(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  if (loadError && !agents) {
    return (
      <div className="rounded-md border border-red-300 bg-red-50 dark:bg-red-950/30 p-3 text-xs text-red-800 dark:text-red-200 font-mono">
        {loadError}
      </div>
    );
  }

  if (!agents) {
    return <div className="text-sm text-neutral-500">Loading agents…</div>;
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <label className="text-xs font-semibold uppercase tracking-wide text-neutral-500 shrink-0">
          Agent
        </label>
        <select
          value={selectedSlug}
          onChange={(e) => setSelectedSlug(e.target.value)}
          className="rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-neutral-400"
        >
          {agents.map((a) => (
            <option key={a.slug} value={a.slug}>
              {a.slug} ({a.type})
            </option>
          ))}
        </select>
      </div>

      {loadError ? (
        <div className="rounded-md border border-red-300 bg-red-50 dark:bg-red-950/30 p-3 text-xs text-red-800 dark:text-red-200 font-mono">
          {loadError}
        </div>
      ) : !sources ? (
        <div className="text-sm text-neutral-500">Loading sources…</div>
      ) : (
        <>
          <p className="text-xs text-neutral-500">
            Editing sources for <code>{selectedSlug}</code>. Saves write directly to{' '}
            <code>manifest.yaml</code> — one entry per line.
          </p>

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

          <fieldset className="flex flex-col gap-2">
            <legend className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-1">
              Workspace
            </legend>
            <label className="text-xs text-neutral-600 dark:text-neutral-400">
              Root path (~ expands to home directory)
            </label>
            <input
              type="text"
              value={workspacePath}
              onChange={(e) => setWorkspacePath(e.target.value)}
              className="w-full rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-neutral-400"
              placeholder="~/my-project"
            />
            <label className="text-xs text-neutral-600 dark:text-neutral-400">
              Include patterns (one per line, e.g. **/*.ts)
            </label>
            <textarea
              value={workspaceInclude}
              onChange={(e) => setWorkspaceInclude(e.target.value)}
              rows={3}
              className="w-full rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-neutral-400"
              placeholder="**/*.ts&#10;**/*.tsx&#10;**/*.md"
            />
            <p className="text-xs text-neutral-400">
              Files are injected as context when querying a reactive agent. Leave path empty to
              disable.
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
        </>
      )}
    </div>
  );
}
