import { useCallback, useEffect, useState } from 'react';
import type { ApiClient, Article } from '../lib/api';

interface Props {
  api: ApiClient;
  onClose: () => void;
}

export function NewspaperPanel({ api, onClose }: Props) {
  const [articles, setArticles] = useState<Article[] | null>(null);

  const refresh = useCallback(async () => {
    try {
      setArticles(await api.listArticles());
    } catch { /* ignore */ }
  }, [api]);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-samix-border">
        <h2 className="text-sm font-medium text-samix-text-primary">Newspaper</h2>
        <button
          onClick={onClose}
          className="text-xs text-samix-text-muted hover:text-samix-text-primary"
        >
          &times;
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {articles == null ? (
          <span className="text-xs text-samix-text-muted">Loading...</span>
        ) : articles.length === 0 ? (
          <span className="text-xs text-samix-text-muted">No articles yet</span>
        ) : (
          groupByDay(articles).map(([day, items]) => (
            <div key={day} className="mb-4">
              <h3 className="text-[10px] uppercase tracking-widest text-samix-text-muted mb-2 border-b border-samix-border pb-1">
                {day}
              </h3>
              <div className="flex flex-col gap-2">
                {items.map((a) => (
                  <div key={a.id} className="flex flex-col gap-0.5">
                    <span className="text-sm text-samix-text-primary leading-tight">{a.title}</span>
                    <span className="text-xs text-samix-text-muted leading-snug">{a.summary}</span>
                    {a.topic && (
                      <span className="text-[10px] text-samix-accent">{a.topic}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function groupByDay(articles: Article[]): [string, Article[]][] {
  const map = new Map<string, Article[]>();
  for (const a of articles) {
    const day = new Date(a.createdAt).toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
    const list = map.get(day);
    if (list) list.push(a);
    else map.set(day, [a]);
  }
  return Array.from(map.entries());
}
