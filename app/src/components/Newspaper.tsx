import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentSummary, ApiClient, Edition, EditionArticle } from '../lib/api';
import { formatLongDate, formatShortDate, formatUsd, hostnameOf } from '../lib/format';
import { layoutEdition, readingOrder } from '../lib/layout';
import { explainFailure, explainPartial, needsSetup as needsSetup_ } from '../lib/explain';
import { getLeadParagraphs, getRessort, isOnboarded, setRessort } from '../lib/prefs';
import { onTrayRunNow } from '../lib/native';
import { Onboarding } from './Onboarding';
import { VoteButtons } from './VoteButtons';
import { AuthImage } from './AuthImage';
import { Blocks } from './Blocks';

const NEWSLETTER_SLUG = 'newsletter-ai';

interface NewspaperProps {
  api: ApiClient;
  onOpen: (articleId: string, order: string[]) => void;
  /** Changes whenever the front page becomes visible again. */
  refreshToken: number;
  /** Opens the Einrichtung page. */
  onOpenSetup: () => void;
}

export function Newspaper({ api, onOpen, refreshToken, onOpenSetup }: NewspaperProps) {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [slug, setSlug] = useState<string | null>(getRessort());
  const [editionId, setEditionId] = useState('latest');
  const [edition, setEdition] = useState<Edition | null>(null);
  const [empty, setEmpty] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runMessage, setRunMessage] = useState<string | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  // The run message points at something the Einrichtung page can fix.
  const [runSetupHint, setRunSetupHint] = useState(false);
  // At least one hosted model has a working key (or nothing is known yet).
  const [keyReady, setKeyReady] = useState(true);

  const load = useCallback(
    async (id: string) => {
      setLoadError(null);
      try {
        setEdition(await api.getEdition(id, getLeadParagraphs(), id === 'latest' ? slug ?? undefined : undefined));
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
    [api, slug]
  );

  // The Ressorts (proactive agents). Remember the chosen one; fall back to
  // the first when the remembered one no longer exists.
  useEffect(() => {
    api
      .listAgents()
      .then((all) => {
        const proactive = all.filter((a) => a.type === 'proactive');
        setAgents(proactive);
        setSlug((cur) => (proactive.some((a) => a.slug === cur) ? cur : proactive[0]?.slug ?? null));
      })
      .catch(() => undefined);
  }, [api, refreshToken]);

  useEffect(() => {
    void load(editionId);
  }, [load, editionId, refreshToken]);

  const chooseRessort = (next: string) => {
    // Already showing it: resetting here would clear the page without a reload.
    if (next === slug) return;
    setRessort(next);
    setSlug(next);
    setEdition(null);
    setEmpty(false);
    setRunMessage(null);
    setEditionId('latest');
  };

  const current = agents.find((a) => a.slug === slug) ?? null;

  const runNewsletter = async () => {
    setRunning(true);
    setRunMessage(null);
    setRunSetupHint(false);
    try {
      const result = await api.runAgent(slug ?? NEWSLETTER_SLUG);
      if (result.status === 'success') {
        const nothingNew = (result.output as { note?: string } | null)?.note === 'no_new_items';
        setRunMessage(nothingNew ? 'Nichts Neues: alle gefundenen Beiträge wurden schon veröffentlicht.' : null);
      } else if (result.status === 'partial') {
        setRunMessage(`Keine Ausgabe: ${explainPartial(result.error)}`);
      } else {
        setRunMessage(`Lauf fehlgeschlagen: ${explainFailure(result.error)}`);
        setRunSetupHint(needsSetup_(result.error));
      }
      setEditionId('latest');
      await load('latest');
    } catch (e) {
      setRunMessage(`Fehler: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRunning(false);
    }
  };

  // First start: no edition in ANY Ressort and no hosted model with a key →
  // offer setup. (An empty Ressort next to ones that have editions is not a
  // first start. Ollama alone doesn't count: whether it is installed can't be
  // known here.)
  useEffect(() => {
    if (!empty) return;
    api
      .listModels()
      .then((models) => setKeyReady(models.some((m) => m.keyEnv && m.keyConfigured) || models.some((m) => !m.keyEnv)))
      .catch(() => setKeyReady(true));
  }, [api, empty, refreshToken]);

  useEffect(() => {
    if (!empty || isOnboarded()) {
      setNeedsSetup(false);
      return;
    }
    Promise.all([api.listModels(), api.listEditions(1)])
      .then(([models, editions]) =>
        setNeedsSetup(editions.length === 0 && !models.some((m) => m.keyEnv && m.keyConfigured))
      )
      .catch(() => setNeedsSetup(false));
  }, [api, empty]);

  // "Jetzt aktualisieren" from the menu-bar / tray icon: every active Ressort,
  // one after the other (each has its own budget).
  const runAll = async () => {
    setRunning(true);
    setRunMessage(null);
    const lines: string[] = [];
    try {
      for (const a of agents.filter((x) => x.enabled)) {
        try {
          const r = await api.runAgent(a.slug);
          const n = r.articleIds?.length ?? 0;
          lines.push(`${a.title}: ${r.status === 'success' ? (n ? `${n} Artikel` : 'nichts Neues') : explainFailure(r.error)}`);
        } catch (e) {
          lines.push(`${a.title}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      setRunMessage(lines.join(' · ') || 'Kein aktives Ressort.');
      setEditionId('latest');
      await load('latest');
    } finally {
      setRunning(false);
    }
  };
  const runAllRef = useRef(runAll);
  runAllRef.current = runAll;
  useEffect(() => onTrayRunNow(() => void runAllRef.current()), []);

  // Optimistic: show the vote at once, put it back if the core refuses.
  const vote = async (articleId: string, value: -1 | 0 | 1) => {
    const set = (v: number | null) =>
      setEdition((e) => (e ? { ...e, articles: e.articles.map((a) => (a.id === articleId ? { ...a, vote: v } : a)) } : e));
    const before = edition?.articles.find((a) => a.id === articleId)?.vote ?? null;
    set(value === 0 ? null : value);
    try {
      await api.vote(articleId, value);
    } catch {
      set(before);
    }
  };

  const layout = useMemo(() => (edition ? layoutEdition(edition.articles) : null), [edition]);
  const order = useMemo(() => (layout ? readingOrder(layout) : []), [layout]);
  const open = (id: string) => onOpen(id, order);

  return (
    <div className="flex flex-col gap-6">
      <Masthead
        edition={edition}
        running={running}
        canRun={current ? current.enabled : true}
        onRun={() => void runNewsletter()}
        onRefresh={() => void load(editionId)}
        onOlder={edition?.olderId ? () => setEditionId(edition.olderId!) : undefined}
        onNewer={edition?.newerId ? () => setEditionId(edition.newerId!) : undefined}
      />

      {agents.length > 1 ? (
        <nav className="flex flex-wrap gap-x-6 gap-y-1 border-b border-rule dark:border-rule-dark pb-2 -mt-2" aria-label="Ressorts">
          {agents.map((a) => (
            <button
              key={a.slug}
              onClick={() => chooseRessort(a.slug)}
              className={`text-sm uppercase tracking-[0.15em] pb-1 ${
                a.slug === slug ? 'font-bold border-b-2 border-ink dark:border-ink-dark' : 'text-ink-soft dark:text-ink-soft-dark hover:underline'
              } ${a.enabled ? '' : 'line-through opacity-60'}`}
            >
              {a.title}
            </button>
          ))}
        </nav>
      ) : null}

      {current && !current.enabled ? (
        <div className="border border-rule dark:border-rule-dark px-3 py-2 text-sm">
          Dieses Ressort ist ausgeschaltet (unter „Ressorts“ wieder einschalten).
        </div>
      ) : null}

      {runMessage ? (
        <div className="border border-rule dark:border-rule-dark px-3 py-2 text-sm flex flex-wrap items-center gap-3">
          <span>{runMessage}</span>
          {runSetupHint ? (
            <button className="uppercase tracking-wider text-xs font-bold hover:underline" onClick={onOpenSetup}>
              Einrichtung öffnen
            </button>
          ) : null}
        </div>
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
        <div className="py-16 text-center text-ink-soft dark:text-ink-soft-dark flex flex-col items-center gap-4">
          <p className="font-serif text-2xl">Noch keine Ausgabe{current ? ` in „${current.title}“` : ''}.</p>
          {keyReady ? (
            <>
              <p className="text-sm max-w-xl">
                Samix holt jetzt die ersten Artikel aus den Quellen des Ressorts und lässt das Modell sie zusammenfassen. Das kostet
                einige Cent; das Tageslimit des Ressorts begrenzt es.
              </p>
              <button className="border border-ink dark:border-ink-dark text-ink dark:text-ink-dark px-4 py-2 text-xs uppercase tracking-wider font-bold hover:underline disabled:opacity-40" onClick={() => void runNewsletter()} disabled={!current?.enabled}>
                Erste Ausgabe holen
              </button>
            </>
          ) : (
            <>
              <p className="text-sm max-w-xl">Zuerst braucht Samix einen API-Schlüssel (oder ein lokales Modell).</p>
              <button className="border border-ink dark:border-ink-dark text-ink dark:text-ink-dark px-4 py-2 text-xs uppercase tracking-wider font-bold hover:underline" onClick={onOpenSetup}>
                Einrichtung öffnen
              </button>
            </>
          )}
        </div>
      ) : null}

      {layout && edition ? (
        <>
          {layout.lead.length > 0 ? (
            <section className="grid gap-8 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] border-b border-rule dark:border-rule-dark pb-8">
              <div className="flex flex-col gap-8">
                {layout.lead.map((a, i) => (
                  <LeadStory key={a.id} api={api} article={a} primary={i === 0} onOpen={open} onVote={vote} />
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
                      <BriefItem key={a.id} article={a} onOpen={open} onVote={vote} />
                    ))}
                  </ul>
                )}
              </aside>
            </section>
          ) : null}

          {layout.main.length > 0 ? (
            <section className="grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
              {layout.main.map((a) => (
                <ArticleBlock key={a.id} article={a} onOpen={open} onVote={vote} />
              ))}
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

// ---- masthead ------------------------------------------------------------

interface MastheadProps {
  edition: Edition | null;
  running: boolean;
  canRun: boolean;
  onRun: () => void;
  onRefresh: () => void;
  onOlder?: () => void;
  onNewer?: () => void;
}

function Masthead({ edition, running, canRun, onRun, onRefresh, onOlder, onNewer }: MastheadProps) {
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
          <button className={btn} onClick={onRefresh} disabled={running} title="Lädt die Seite neu, ruft nichts ab und kostet nichts">
            Neu laden
          </button>
          <button className={btn} onClick={onRun} disabled={running || !canRun} title={canRun ? 'Ruft die Quellen ab und fragt das Modell; kostet einige Cent' : 'Das Ressort ist ausgeschaltet'}>
            {running ? 'Wird geholt …' : 'Neue Artikel holen'}
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
  onVote: (id: string, value: -1 | 0 | 1) => void;
}

function Meta({
  article,
  withReading,
  onVote,
}: {
  article: EditionArticle;
  withReading?: boolean;
  onVote: (id: string, value: -1 | 0 | 1) => void;
}) {
  const parts = [
    article.sourceName ?? hostnameOf(article.sourceUrl),
    formatShortDate(article.publishedAt),
    withReading && article.content?.status === 'ok' ? `${article.content.readingMinutes} Min. Lesezeit` : '',
  ].filter(Boolean);
  return (
    <div className="flex items-center justify-between gap-2 text-xs text-ink-soft dark:text-ink-soft-dark">
      <p>{parts.join(' · ')}</p>
      <VoteButtons vote={article.vote} onVote={(v) => onVote(article.id, v)} />
    </div>
  );
}

function Kicker({ article }: { article: EditionArticle }) {
  if (!article.topic) return null;
  return (
    <p className="text-[0.7rem] font-bold uppercase tracking-[0.2em] text-ink-soft dark:text-ink-soft-dark mb-1">
      {article.topic}
    </p>
  );
}

function LeadStory({ api, article, primary, onOpen, onVote }: StoryProps & { api: ApiClient; primary: boolean }) {
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
      <Meta article={article} withReading onVote={onVote} />

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

function ArticleBlock({ article, onOpen, onVote }: StoryProps) {
  return (
    <article className="border-t-2 border-ink dark:border-ink-dark pt-3">
      <Kicker article={article} />
      <h3 className="font-serif font-bold text-xl leading-tight mb-1">
        <button onClick={() => onOpen(article.id)} className="text-left hover:underline">
          {article.title}
        </button>
      </h3>
      <p className="font-serif text-[0.95rem] leading-snug mb-2">{article.summary}</p>
      <Meta article={article} onVote={onVote} />
    </article>
  );
}

function BriefItem({ article, onOpen, onVote }: StoryProps) {
  return (
    <li className="border-b border-rule dark:border-rule-dark pb-3 last:border-0">
      <button onClick={() => onOpen(article.id)} className="text-left">
        <span className="block font-serif font-bold leading-snug hover:underline">{article.title}</span>
      </button>
      <p className="font-serif text-sm leading-snug mt-1 line-clamp-3">{article.summary}</p>
      <Meta article={article} onVote={onVote} />
    </li>
  );
}
