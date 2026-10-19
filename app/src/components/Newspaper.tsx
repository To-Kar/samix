import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ApiClient, Edition, EditionArticle } from '../lib/api';
import { formatLongDate, formatShortDate, formatUsd, hostnameOf } from '../lib/format';
import { layoutEdition, readingOrder } from '../lib/layout';
import { getLeadParagraphs, isOnboarded } from '../lib/prefs';
import { onTrayRunNow } from '../lib/native';
import { Onboarding } from './Onboarding';
import { AuthImage } from './AuthImage';
import { Blocks } from './Blocks';

const NEWSLETTER_SLUG = 'newsletter-ai';

interface NewspaperProps {
  api: ApiClient;
  onOpen: (articleId: string, order: string[]) => void;
  /** Changes whenever the front page becomes visible again. */
  refreshToken: number;
}

export function Newspaper({ api, onOpen, refreshToken }: NewspaperProps) {
  const [editionId, setEditionId] = useState('latest');
  const [edition, setEdition] = useState<Edition | null>(null);
  const [empty, setEmpty] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runMessage, setRunMessage] = useState<string | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);

  const load = useCallback(
    async (id: string) => {
      setLoadError(null);
      try {
        setEdition(await api.getEdition(id, getLeadParagraphs()));
        setEmpty(false);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // No edition yet is not an error, it is the first-run state.
        if (id === 'latest' && msg.startsWith('HTTP 404')) {
          setEdition(null);
          setEmpty(true);
        } else {
          setLoadError(msg);
        }
      }
    },
    [api]
  );

  useEffect(() => {
    void load(editionId);
  }, [load, editionId, refreshToken]);

  const runNewsletter = async () => {
    setRunning(true);
    setRunMessage(null);
    try {
      const result = await api.runAgent(NEWSLETTER_SLUG);
      if (result.status === 'success') {
        setRunMessage(null);
      } else if (result.status === 'partial') {
        setRunMessage(`Keine Ausgabe: ${explainPartial(result.error)}`);
      } else {
        setRunMessage(`Lauf fehlgeschlagen: ${explainFailure(result.error)}`);
      }
      setEditionId('latest');
      await load('latest');
    } catch (e) {
      setRunMessage(`Fehler: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRunning(false);
    }
  };

  // First start: no edition and no hosted model with a key → offer setup.
  // (Ollama alone doesn't count: whether it is installed can't be known here.)
  useEffect(() => {
    if (!empty || isOnboarded()) {
      setNeedsSetup(false);
      return;
    }
    api
      .listModels()
      .then((models) => setNeedsSetup(!models.some((m) => m.keyEnv && m.keyConfigured)))
      .catch(() => setNeedsSetup(false));
  }, [api, empty]);

  // "Jetzt aktualisieren" from the menu-bar / tray icon.
  const runRef = useRef(runNewsletter);
  runRef.current = runNewsletter;
  useEffect(() => onTrayRunNow(() => void runRef.current()), []);

  const layout = useMemo(() => (edition ? layoutEdition(edition.articles) : null), [edition]);
  const order = useMemo(() => (layout ? readingOrder(layout) : []), [layout]);
  const open = (id: string) => onOpen(id, order);

  return (
    <div className="flex flex-col gap-6">
      <Masthead
        edition={edition}
        running={running}
        onRun={() => void runNewsletter()}
        onRefresh={() => void load(editionId)}
        onOlder={edition?.olderId ? () => setEditionId(edition.olderId!) : undefined}
        onNewer={edition?.newerId ? () => setEditionId(edition.newerId!) : undefined}
      />

      {runMessage ? (
        <div className="border border-rule dark:border-rule-dark px-3 py-2 text-sm">{runMessage}</div>
      ) : null}

      {loadError ? (
        <div className="border border-red-400 bg-red-50 dark:bg-red-950/30 p-3 text-xs text-red-800 dark:text-red-200 font-mono">
          {loadError}
        </div>
      ) : null}

      {empty && needsSetup ? (
        <Onboarding
          api={api}
          onDone={({ run }) => {
            setNeedsSetup(false);
            if (run) void runNewsletter();
          }}
        />
      ) : null}

      {empty && !running && !needsSetup ? (
        <div className="py-16 text-center text-ink-soft dark:text-ink-soft-dark">
          <p className="font-serif text-2xl mb-2">Noch keine Ausgabe.</p>
          <p className="text-sm">
            Hinterlege in den Einstellungen einen API-Schlüssel und erstelle die erste Ausgabe.
          </p>
        </div>
      ) : null}

      {layout && edition ? (
        <>
          {layout.lead.length > 0 ? (
            <section className="grid gap-8 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] border-b border-rule dark:border-rule-dark pb-8">
              <div className="flex flex-col gap-8">
                {layout.lead.map((a, i) => (
                  <LeadStory key={a.id} api={api} article={a} primary={i === 0} onOpen={open} />
                ))}
              </div>
              <aside className="md:border-l md:pl-8 border-rule dark:border-rule-dark">
                <h2 className="text-xs font-bold uppercase tracking-[0.2em] mb-4 pb-1 border-b-2 border-ink dark:border-ink-dark">
                  Kurz notiert
                </h2>
                {layout.brief.length === 0 ? (
                  <p className="text-sm text-ink-soft dark:text-ink-soft-dark">Heute nichts weiter.</p>
                ) : (
                  <ul className="flex flex-col gap-4">
                    {layout.brief.map((a) => (
                      <BriefItem key={a.id} article={a} onOpen={open} />
                    ))}
                  </ul>
                )}
              </aside>
            </section>
          ) : null}

          {layout.main.length > 0 ? (
            <section className="grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
              {layout.main.map((a) => (
                <ArticleBlock key={a.id} article={a} onOpen={open} />
              ))}
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function explainFailure(error: string | undefined): string {
  switch (error) {
    case 'no_source_items':
      return 'Keine Quelle lieferte Beiträge (Netzwerk oder Quellen prüfen). Es wurde nichts bezahlt.';
    case 'already_running':
      return 'Es läuft bereits ein Lauf.';
    case 'budget_exceeded':
    case 'global_budget_exceeded':
      return 'Tagesbudget erreicht.';
    default:
      return error ?? 'unbekannt';
  }
}

function explainPartial(error: string | undefined): string {
  if (error?.startsWith('traceability')) return 'Das Modell nannte Quellen, die nicht abgerufen wurden. Es wurde nichts veröffentlicht.';
  if (error?.startsWith('schema_violation')) return 'Die Modellantwort war nicht im erwarteten Format.';
  return error ?? 'unbekannt';
}

// ---- masthead ------------------------------------------------------------

interface MastheadProps {
  edition: Edition | null;
  running: boolean;
  onRun: () => void;
  onRefresh: () => void;
  onOlder?: () => void;
  onNewer?: () => void;
}

function Masthead({ edition, running, onRun, onRefresh, onOlder, onNewer }: MastheadProps) {
  const btn =
    'px-2 py-1 text-xs uppercase tracking-wider hover:underline disabled:opacity-30 disabled:no-underline';
  return (
    <header className="border-b-4 border-double border-ink dark:border-ink-dark pb-3">
      <div className="flex items-baseline justify-between gap-4 text-xs uppercase tracking-widest text-ink-soft dark:text-ink-soft-dark">
        <span>{edition ? `Ausgabe Nr. ${edition.number} · ${formatLongDate(new Date(edition.startedAt))}` : formatLongDate(new Date())}</span>
        {edition ? (
          <span className="text-right normal-case tracking-normal">
            {edition.articles.length} Artikel · {edition.sourceCount} Quellen · {formatUsd(edition.costUsd)}
            {edition.model ? ` · ${edition.model}` : ''}
          </span>
        ) : null}
      </div>
      <h1 className="font-serif font-black text-6xl md:text-7xl text-center tracking-tight my-2">Samix</h1>
      <nav className="flex items-center justify-between border-t border-rule dark:border-rule-dark pt-2">
        <div className="flex items-center">
          <button className={btn} onClick={onOlder} disabled={!onOlder}>
            ‹ Vorige Ausgabe
          </button>
          <button className={btn} onClick={onNewer} disabled={!onNewer}>
            Nächste ›
          </button>
        </div>
        <div className="flex items-center">
          <button className={btn} onClick={onRefresh} disabled={running}>
            Aktualisieren
          </button>
          <button className={btn} onClick={onRun} disabled={running}>
            {running ? 'Wird erstellt …' : 'Neue Ausgabe erstellen'}
          </button>
        </div>
      </nav>
    </header>
  );
}

// ---- blocks --------------------------------------------------------------

interface StoryProps {
  article: EditionArticle;
  onOpen: (id: string) => void;
}

function Meta({ article, withReading }: { article: EditionArticle; withReading?: boolean }) {
  const parts = [
    article.sourceName ?? hostnameOf(article.sourceUrl),
    formatShortDate(article.publishedAt),
    withReading && article.content?.status === 'ok' ? `${article.content.readingMinutes} Min. Lesezeit` : '',
  ].filter(Boolean);
  return <p className="text-xs text-ink-soft dark:text-ink-soft-dark">{parts.join(' · ')}</p>;
}

function Kicker({ article }: { article: EditionArticle }) {
  if (!article.topic) return null;
  return (
    <p className="text-[0.7rem] font-bold uppercase tracking-[0.2em] text-ink-soft dark:text-ink-soft-dark mb-1">
      {article.topic}
    </p>
  );
}

function LeadStory({ api, article, primary, onOpen }: StoryProps & { api: ApiClient; primary: boolean }) {
  const imageId = article.content?.leadImageId;
  return (
    <article className={primary ? '' : 'border-t border-rule dark:border-rule-dark pt-8'}>
      <Kicker article={article} />
      <h2
        className={`font-serif font-bold leading-[1.1] mb-2 ${primary ? 'text-4xl md:text-5xl' : 'text-3xl'}`}
      >
        <button onClick={() => onOpen(article.id)} className="text-left hover:underline decoration-2">
          {article.title}
        </button>
      </h2>
      <Meta article={article} withReading />

      {imageId ? (
        <button onClick={() => onOpen(article.id)} className="block w-full my-4">
          <AuthImage api={api} id={imageId} className="w-full aspect-[2.4/1] object-cover" />
        </button>
      ) : null}

      <div className="my-4 border-l-4 border-ink dark:border-ink-dark pl-4">
        <p className="text-[0.65rem] font-bold uppercase tracking-[0.2em] text-ink-soft dark:text-ink-soft-dark mb-1">
          KI-Zusammenfassung
        </p>
        <p className="font-serif text-lg leading-snug">{article.summary}</p>
        {article.importanceReason ? (
          <p className="mt-2 text-xs italic text-ink-soft dark:text-ink-soft-dark">
            Warum oben: {article.importanceReason}
          </p>
        ) : null}
      </div>

      {article.excerpt && article.excerpt.length > 0 ? (
        <div className="relative">
          <div className="font-serif columns-1 lg:columns-2 gap-8 [column-rule:1px_solid_rgba(120,110,90,0.35)]">
            <Blocks blocks={article.excerpt} api={api} variant="excerpt" />
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-paper dark:from-paper-dark to-transparent" />
        </div>
      ) : null}

      <button
        onClick={() => onOpen(article.id)}
        className="mt-3 text-sm font-bold uppercase tracking-wider hover:underline"
      >
        {article.excerpt ? 'Weiterlesen →' : 'Artikel öffnen →'}
      </button>
    </article>
  );
}

function ArticleBlock({ article, onOpen }: StoryProps) {
  return (
    <article className="border-t-2 border-ink dark:border-ink-dark pt-3">
      <Kicker article={article} />
      <h3 className="font-serif font-bold text-xl leading-tight mb-1">
        <button onClick={() => onOpen(article.id)} className="text-left hover:underline">
          {article.title}
        </button>
      </h3>
      <p className="font-serif text-[0.95rem] leading-snug mb-2">{article.summary}</p>
      <Meta article={article} />
    </article>
  );
}

function BriefItem({ article, onOpen }: StoryProps) {
  return (
    <li className="border-b border-rule dark:border-rule-dark pb-3 last:border-0">
      <button onClick={() => onOpen(article.id)} className="text-left">
        <span className="block font-serif font-bold leading-snug hover:underline">{article.title}</span>
      </button>
      <p className="font-serif text-sm leading-snug mt-1 line-clamp-3">{article.summary}</p>
      <Meta article={article} />
    </li>
  );
}
