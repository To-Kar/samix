import { useEffect } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { Article } from '../lib/api';
import { useI18n } from '../i18n/I18nProvider';
import { hostnameOf, paragraphs, sourceLabel } from '../lib/articles';

const dateTime = (iso: string, locale: string) =>
  new Date(iso).toLocaleString(locale, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

interface ReaderViewProps {
  article: Article;
  onBack: () => void;
}

/** One article, single column at the theme's measure. Esc returns to the edition. */
export function ReaderView({ article, onBack }: ReaderViewProps) {
  const { t, dateLocale } = useI18n();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onBack();
    };
    window.addEventListener('keydown', onKey);
    window.scrollTo({ top: 0 });
    return () => window.removeEventListener('keydown', onKey);
  }, [article.id, onBack]);

  const source = sourceLabel(article);

  return (
    <article className="samix-reader">
      <button className="samix-button self-start mb-8" onClick={onBack}>
        {t.paper.back}
      </button>
      {article.topic ? <span className="samix-kicker">{article.topic}</span> : null}
      <h1 className="samix-headline text-4xl leading-tight mt-1">{article.title}</h1>
      <p className="samix-hint samix-reader-meta">
        {source ? `${source} · ` : ''}
        {article.publishedAt ? `${t.paper.published(dateTime(article.publishedAt, dateLocale))} · ` : ''}
        {t.paper.collected(dateTime(article.createdAt, dateLocale))}
      </p>
      <div className="samix-prose">
        {paragraphs(article.summary).map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
      <footer className="samix-reader-sources samix-hint">
        <h2 className="samix-label mb-1">{t.paper.source}</h2>
        {article.sourceUrl ? (
          <button className="samix-link text-left break-all" onClick={() => void openUrl(article.sourceUrl!)}>
            {source && source !== hostnameOf(article.sourceUrl) ? `${source} — ` : ''}
            {article.sourceUrl}
          </button>
        ) : (
          <p>
            <b>{t.status.warning}</b> {t.paper.noSource}
          </p>
        )}
      </footer>
    </article>
  );
}
