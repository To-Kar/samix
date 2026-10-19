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
        <div className="samix-hint">
          {articles == null
            ? 'Loading…'
            : articles.length === 0
              ? 'No articles yet — run the newsletter agent to populate.'
              : `${articles.length} ${articles.length === 1 ? 'article' : 'articles'} from the last 7 days`}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void refresh()}
            disabled={running}
            className="samix-button"
          >
            Refresh
          </button>
          <button
            onClick={() => void runNewsletter()}
            disabled={running}
            className="samix-button"
          >
            {running ? 'Running…' : 'Run newsletter-ai'}
          </button>
        </div>
      </div>

      {runMessage ? (
        <div className="samix-note">
          {runMessage}
        </div>
      ) : null}

      {loadError ? (
        <div className="samix-error font-mono">
          {loadError}
        </div>
      ) : null}

      {articles && articles.length > 0
        ? groupByDay(articles).map(([day, items]) => (
            <section key={day} className="flex flex-col gap-3">
              <h3 className="samix-label border-b border-rule pb-1">
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
    <article className="border-b border-rule pb-4 flex flex-col gap-2">
      <h2 className="samix-headline text-xl leading-tight">{article.title}</h2>
      <p className="samix-prose">
        {article.summary}
      </p>
      <div className="flex items-center gap-2 mt-1 text-sm">
        {article.topic ? (
          <span className="samix-kicker">
            {article.topic}
          </span>
        ) : null}
        {article.sourceUrl ? (
          <span className="text-ink-soft truncate max-w-[14rem]">
            {hostnameOf(article.sourceUrl)}
          </span>
        ) : null}
        <button
          onClick={handleOpen}
          disabled={!article.sourceUrl}
          className="ml-auto samix-button"
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
