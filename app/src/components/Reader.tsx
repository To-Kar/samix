import { useCallback, useEffect, useState } from 'react';
import type { ApiClient, ArticleDetail } from '../lib/api';
import { formatDateTime, formatShortDate, hostnameOf } from '../lib/format';
import { openExternal } from '../lib/external';
import { AuthImage } from './AuthImage';
import { Blocks } from './Blocks';
import { VoteButtons } from './VoteButtons';

interface ReaderProps {
  api: ApiClient;
  articleId: string;
  /** Article ids in front-page order, for next/previous. */
  order: string[];
  onClose: () => void;
  onNavigate: (id: string) => void;
}

type Phase = 'loading' | 'fetching' | 'ready' | 'error';

export function Reader({ api, articleId, order, onClose, onNavigate }: ReaderProps) {
  const [detail, setDetail] = useState<ArticleDetail | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);

  const index = order.indexOf(articleId);
  const prevId = index > 0 ? order[index - 1] : undefined;
  const nextId = index >= 0 && index < order.length - 1 ? order[index + 1] : undefined;

  // "Neu laden": fetch the original page again, ignoring the cache.
  const refetch = useCallback(async () => {
    setError(null);
    setPhase('fetching');
    try {
      setDetail(await api.loadArticleContent(articleId, true));
      setPhase('ready');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('error');
    }
  }, [api, articleId]);

  useEffect(() => {
    let live = true;
    setDetail(null);
    setPhase('loading');
    window.scrollTo({ top: 0 });
    (async () => {
      try {
        let d = await api.getArticle(articleId);
        if (!live) return;
        setDetail(d);
        if (d.content === null) {
          setPhase('fetching');
          d = await api.loadArticleContent(articleId);
          if (!live) return;
          setDetail(d);
        }
        setPhase('ready');
      } catch (e) {
        if (!live) return;
        setError(e instanceof Error ? e.message : String(e));
        setPhase('error');
      }
    })();
    return () => {
      live = false;
    };
  }, [api, articleId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape') onClose();
      else if ((e.key === 'j' || e.key === 'ArrowRight') && nextId) onNavigate(nextId);
      else if ((e.key === 'k' || e.key === 'ArrowLeft') && prevId) onNavigate(prevId);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onNavigate, nextId, prevId]);

  const bar = 'text-xs uppercase tracking-wider hover:underline disabled:opacity-30 disabled:no-underline';
  const content = detail?.content ?? null;
  const blockImageIds = new Set(
    (content?.blocks ?? []).filter((b) => b.type === 'image').map((b) => (b as { mediaId: string }).mediaId)
  );
  const showLeadImage = content?.status === 'ok' && content.leadImageId && !blockImageIds.has(content.leadImageId);

  return (
    <div className="mx-auto max-w-[68ch]">
      <div className="flex items-center justify-between border-b border-rule pb-2 mb-8">
        <button className={bar} onClick={onClose}>
          ← Zur Zeitung <span className="normal-case tracking-normal text-ink-soft">(Esc)</span>
        </button>
        <div className="flex items-center gap-4">
          {index >= 0 ? (
            <span className="text-xs text-ink-soft">
              {index + 1} von {order.length}
            </span>
          ) : null}
          <button className={bar} disabled={!prevId} onClick={() => prevId && onNavigate(prevId)}>
            ‹ Zurück
          </button>
          <button className={bar} disabled={!nextId} onClick={() => nextId && onNavigate(nextId)}>
            Weiter ›
          </button>
        </div>
      </div>

      {phase === 'error' ? (
        <div className="border border-danger bg-danger-paper p-3 text-xs text-danger font-mono">
          {error}
        </div>
      ) : null}

      {!detail && phase !== 'error' ? <p className="text-ink-soft">Lädt …</p> : null}

      {detail ? (
        <article>
          {detail.topic ? (
            <p className="text-[0.7rem] font-bold uppercase tracking-[0.2em] text-accent mb-2">
              {detail.topic}
            </p>
          ) : null}
          <h1 className="font-head font-bold text-4xl leading-[1.15] mb-3">{content?.title ?? detail.title}</h1>
          <p className="text-sm text-ink-soft mb-6">
            {[
              content?.siteName ?? detail.sourceName ?? hostnameOf(detail.sourceUrl),
              content?.byline,
              formatShortDate(detail.publishedAt),
              content?.status === 'ok' ? `${content.readingMinutes} Min. Lesezeit` : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>

          <aside className="mb-8 border-l-4 border-ink pl-4">
            <p className="text-[0.65rem] font-bold uppercase tracking-[0.2em] text-ink-soft mb-1">
              KI-Zusammenfassung{detail.run.model ? ` · ${detail.run.model}` : ''}
            </p>
            <p className="font-body text-lg leading-snug">{detail.summary}</p>
            {detail.importanceReason ? (
              <p className="mt-2 text-xs italic text-ink-soft">
                Warum oben: {detail.importanceReason}
              </p>
            ) : null}
          </aside>

          <div className="mb-6 flex items-center gap-3 text-xs text-ink-soft">
            <span>Mehr oder weniger davon?</span>
            <VoteButtons
              vote={detail.vote}
              onVote={(value) => {
                const before = detail.vote;
                setDetail({ ...detail, vote: value === 0 ? null : value });
                api.vote(detail.id, value).catch(() => setDetail((d) => (d ? { ...d, vote: before } : d)));
              }}
            />
          </div>

          {showLeadImage ? (
            <AuthImage api={api} id={content!.leadImageId!} photo className="w-full h-auto mb-8" />
          ) : null}

          <section className="samix-prose">
            <h2 className="font-ui text-[0.65rem] font-bold uppercase tracking-[0.2em] text-ink-soft mb-4 pb-1 border-b border-rule">
              Originaltext
              {content
                ? ` von ${content.siteName ?? hostnameOf(detail.sourceUrl)} · ${content.status === 'ok' ? 'abgerufen' : 'Abruf'} am ${formatDateTime(content.fetchedAt)}`
                : ''}
            </h2>

            {phase === 'fetching' || (phase === 'loading' && !content) ? (
              <p className="font-ui text-sm text-ink-soft">Originaltext wird geladen …</p>
            ) : null}

            {content?.status === 'ok' ? <Blocks blocks={content.blocks} api={api} variant="reader" /> : null}

            {content && content.status !== 'ok' ? (
              <div className="font-ui text-sm border border-rule p-4">
                <p className="font-bold mb-1">Der Volltext ist hier nicht verfügbar.</p>
                <p className="text-ink-soft">{explainContent(content.status, content.error)}</p>
              </div>
            ) : null}
          </section>

          <div className="font-ui flex flex-wrap gap-3 my-8 text-sm">
            {detail.sourceUrl ? (
              <button
                onClick={() => openExternal(detail.sourceUrl!)}
                className="border border-ink px-3 py-1.5 font-bold hover:bg-ink hover:text-paper"
              >
                Original im Browser öffnen ↗
              </button>
            ) : null}
            <button
              onClick={() => void refetch()}
              disabled={phase === 'fetching'}
              className="border border-rule px-3 py-1.5 hover:bg-ink/5 disabled:opacity-40"
            >
              Neu laden
            </button>
          </div>

          <footer className="font-ui border-t border-rule pt-4 text-xs text-ink-soft">
            <p className="font-bold uppercase tracking-[0.2em] mb-2">Quellennachweis</p>
            {detail.sources.length === 0 ? (
              <p>Keine zugehörige Quelle im Lauf gefunden.</p>
            ) : (
              <ul className="space-y-1">
                {detail.sources.map((s) => (
                  <li key={s.url}>
                    {s.sourceType} · {s.sourceName} · „{s.title}“ · gefunden am {formatDateTime(s.fetchedAt)}
                  </li>
                ))}
              </ul>
            )}
            {detail.sourceUrl ? <p className="mt-2 break-all">{detail.sourceUrl}</p> : null}
          </footer>
        </article>
      ) : null}
    </div>
  );
}

// Plain-language reason, with the uncertainty stated where there is some.
function explainContent(status: string, error: string | null): string {
  switch (error) {
    case 'content_too_short':
      return 'Es konnte nur sehr wenig Text gelesen werden. Möglicherweise steckt der Artikel hinter einer Paywall oder einem Login, oder die Seite braucht JavaScript.';
    case 'no_article_found':
      return 'Auf der Seite wurde kein Artikeltext erkannt.';
    case 'bad_content_type':
      return 'Die Adresse führt nicht zu einer Webseite (z. B. ein PDF).';
    case 'blocked_host':
    case 'bad_url':
      return 'Die Adresse ist nicht abrufbar. Aus Sicherheitsgründen werden nur öffentliche Webadressen geladen.';
    case 'network':
      return 'Die Seite ist nicht erreichbar (Netzwerk, DNS oder falsche Adresse). „Neu laden“ versucht es noch einmal.';
    case 'timeout':
      return 'Die Seite hat nicht rechtzeitig geantwortet. „Neu laden“ versucht es noch einmal.';
    case 'too_large':
      return 'Die Seite ist zu groß.';
    case 'no_source_url':
      return 'Zu diesem Artikel gibt es keine Adresse.';
    case 'http_401':
    case 'http_402':
    case 'http_403':
      return `Die Seite verweigert den automatischen Abruf (${error.replace('http_', 'HTTP ')}). Das kann eine Paywall oder ein Bot-Schutz sein.`;
    default:
      if (error?.startsWith('http_')) return `Die Seite antwortete mit ${error.replace('http_', 'HTTP ')}.`;
      return `Abruf fehlgeschlagen (${error ?? status}).`;
  }
}
