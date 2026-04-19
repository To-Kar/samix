import { useCallback, useEffect, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { ApiClient, Article } from '../lib/api';

const NEWSLETTER_SLUG = 'newsletter-ai';

interface NewspaperProps {
  api: ApiClient;
}

export function Newspaper({ api }: NewspaperProps) {
  const [articles, setArticles] = useState<Article[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runMessage, setRunMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const list = await api.listArticles();
      setArticles(list);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runNewsletter = async () => {
    setRunning(true);
    setRunMessage(null);
    try {
      const result = await api.runAgent(NEWSLETTER_SLUG);
      if (result.status === 'success') {
        setRunMessage(`Done — wrote ${(result as { articleIds?: string[] }).articleIds?.length ?? 0} new articles.`);
      } else if (result.status === 'partial') {
        setRunMessage(`Partial — schema violation, no new articles. Check the run's output.`);
      } else {
        setRunMessage(`Failed: ${result.error ?? 'unknown error'}`);
      }
      await refresh();
    } catch (e) {
      setRunMessage(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-neutral-500">
          {articles == null
            ? 'Loading…'
            : articles.length === 0
              ? 'No articles yet — run the newsletter agent to populate.'
              : `${articles.length} ${articles.length === 1 ? 'article' : 'articles'} from the last 7 days`}
        </div>
        <button
          onClick={() => void runNewsletter()}
          disabled={running}
          className="rounded border border-neutral-300 dark:border-neutral-700 px-3 py-1 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-40"
        >
          {running ? 'Running…' : 'Run newsletter-ai'}
        </button>
      </div>

      {runMessage ? (
        <div className="rounded-md border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/50 px-3 py-2 text-xs text-neutral-700 dark:text-neutral-300">
          {runMessage}
        </div>
      ) : null}

      {loadError ? (
        <div className="rounded-md border border-red-300 bg-red-50 dark:bg-red-950/30 p-3 text-xs text-red-800 dark:text-red-200 font-mono">
          {loadError}
        </div>
      ) : null}

      {articles && articles.length > 0
        ? groupByDay(articles).map(([day, items]) => (
            <section key={day} className="flex flex-col gap-3">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-neutral-400 border-b border-neutral-200 dark:border-neutral-800 pb-1">
                {day}
              </h3>
              <div className="flex flex-col gap-3">
                {items.map((a) => (
                  <ArticleCard key={a.id} article={a} />
                ))}
              </div>
            </section>
          ))
        : null}
    </div>
  );
}

function ArticleCard({ article }: { article: Article }) {
  const handleOpen = () => {
    if (article.sourceUrl) void openUrl(article.sourceUrl);
  };
  return (
    <article className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/50 p-4 flex flex-col gap-2">
      <h2 className="text-base font-semibold leading-tight">{article.title}</h2>
      <p className="text-sm text-neutral-700 dark:text-neutral-300 leading-snug">
        {article.summary}
      </p>
      <div className="flex items-center gap-2 mt-1 text-xs">
        {article.topic ? (
          <span className="rounded-full bg-neutral-100 dark:bg-neutral-800 px-2 py-0.5 text-neutral-600 dark:text-neutral-400">
            {article.topic}
          </span>
        ) : null}
        {article.sourceUrl ? (
          <span className="text-neutral-400 truncate max-w-[14rem]">
            {hostnameOf(article.sourceUrl)}
          </span>
        ) : null}
        <button
          onClick={handleOpen}
          disabled={!article.sourceUrl}
          className="ml-auto rounded border border-neutral-300 dark:border-neutral-700 px-2 py-0.5 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-40"
        >
          Open ↗
        </button>
      </div>
    </article>
  );
}

function groupByDay(articles: Article[]): [string, Article[]][] {
  const map = new Map<string, Article[]>();
  for (const a of articles) {
    const day = formatDay(new Date(a.createdAt));
    const list = map.get(day);
    if (list) list.push(a);
    else map.set(day, [a]);
  }
  return Array.from(map.entries());
}

function formatDay(d: Date): string {
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
