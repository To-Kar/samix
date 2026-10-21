import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentSummary, ApiClient, Edition, EditionArticle } from '../lib/api';
import { hostnameOf } from '../lib/format';
import { useFormat, useI18n } from '../i18n/I18nProvider';
import { groupStories, layoutEdition, readingOrder, storySources } from '../lib/layout';
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
  const { t } = useI18n();

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
        setRunMessage(nothingNew ? t.paper.nothingNew : null);
      } else if (result.status === 'partial') {
        setRunMessage(t.paper.noEdition(explainPartial(t, result.error)));
      } else {
        const notes = (result.output as { sourceNotes?: string[] } | null)?.sourceNotes ?? [];
        setRunMessage(
          t.paper.runFailed(explainFailure(t, result.error)) +
            (notes.length ? `\n${t.paper.sourceNotes}\n${notes.map((n) => `• ${n}`).join('\n')}` : '')
        );
        setRunSetupHint(needsSetup_(result.error));
      }
      setEditionId('latest');
      await load('latest');
    } catch (e) {
      setRunMessage(t.paper.error(e instanceof Error ? e.message : String(e)));
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
          lines.push(`${a.title}: ${r.status === 'success' ? (n ? t.paper.runAllCount(n) : t.paper.runAllNothing) : explainFailure(t, r.error)}`);
        } catch (e) {
          lines.push(`${a.title}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      setRunMessage(lines.join(' · ') || t.paper.noActiveRessort);
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

  const layout = useMemo(() => (edition ? layoutEdition(groupStories(edition.articles)) : null), [edition]);
  const order = useMemo(() => (layout ? readingOrder(layout) : []), [layout]);
  const open = (id: string, readingList?: string[]) => onOpen(id, readingList ?? order);

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
        <nav className="flex flex-wrap gap-x-6 gap-y-1 border-b border-rule pb-2 -mt-2" aria-label={t.paper.ressortsLabel}>
          {agents.map((a) => (
            <button
              key={a.slug}
              onClick={() => chooseRessort(a.slug)}
              className={`text-sm uppercase tracking-[0.15em] pb-1 ${
                a.slug === slug ? 'font-bold border-b-2 border-accent' : 'text-ink-soft hover:underline'
              } ${a.enabled ? '' : 'line-through opacity-60'}`}
            >
              {a.title}
            </button>
          ))}
        </nav>
      ) : null}

      {current && !current.enabled ? (
        <div className="border border-rule px-3 py-2 text-sm">
          {t.paper.ressortOff}
        </div>
      ) : null}

      {runMessage ? (
        <div className="border border-rule px-3 py-2 text-sm flex flex-wrap items-center gap-3">
          <span className="whitespace-pre-line">{runMessage}</span>
          {runSetupHint ? (
            <button className="uppercase tracking-wider text-xs font-bold hover:underline" onClick={onOpenSetup}>
              {t.paper.openSetup}
            </button>
          ) : null}
        </div>
      ) : null}

      {loadError ? (
        <div className="border border-danger bg-danger-paper p-3 text-xs text-danger font-mono" role="alert">
          {t.status.error} {loadError}
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
        <div className="py-16 text-center text-ink-soft flex flex-col items-center gap-4">
          <p className="font-body text-2xl">{t.paper.emptyTitle(current?.title ?? null)}</p>
          {keyReady ? (
            <>
              <p className="text-sm max-w-xl">{t.paper.emptyRun}</p>
              <button className="border border-ink text-ink px-4 py-2 text-xs uppercase tracking-wider font-bold hover:underline disabled:opacity-40" onClick={() => void runNewsletter()} disabled={!current?.enabled}>
                {t.paper.firstEdition}
              </button>
            </>
          ) : (
            <>
              <p className="text-sm max-w-xl">{t.paper.needKey}</p>
              <button className="border border-ink text-ink px-4 py-2 text-xs uppercase tracking-wider font-bold hover:underline" onClick={onOpenSetup}>
                {t.paper.openSetup}
              </button>
            </>
          )}
        </div>
      ) : null}

      {layout && edition ? (
        <>
          {layout.lead.length > 0 ? (
            <section className="grid gap-8 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] border-b border-rule pb-8">
              <div className="flex flex-col gap-8">
                {layout.lead.map((a, i) => (
                  <LeadStory key={a.id} api={api} article={a} primary={i === 0} onOpen={open} onVote={vote} />
                ))}
              </div>
              <aside className="md:border-l md:pl-8 border-rule">
                <h2 className="text-xs font-bold uppercase tracking-[0.2em] mb-4 pb-1 border-b-2 border-ink">
                  {t.paper.brief}
                </h2>
                {layout.brief.length === 0 ? (
                  <p className="text-sm text-ink-soft">{t.paper.briefEmpty}</p>
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
  const { t } = useI18n();
  const f = useFormat();
  const btn =
    'px-2 py-1 text-xs uppercase tracking-wider hover:underline disabled:opacity-30 disabled:no-underline';
  return (
    <header className="border-b-4 border-double border-ink pb-3">
      <div className="flex items-baseline justify-between gap-4 text-xs uppercase tracking-widest text-ink-soft">
        <span>{edition ? t.paper.edition(edition.number, f.longDate(new Date(edition.startedAt))) : f.longDate(new Date())}</span>
        {edition ? (
          <span className="text-right normal-case tracking-normal">
            {t.paper.editionStats(edition.articles.length, edition.sourceCount, f.usd(edition.costUsd))}
            {edition.model ? ` · ${edition.model}` : ''}
          </span>
        ) : null}
      </div>
      <h1 className="font-head font-black text-6xl md:text-7xl text-center tracking-tight my-2">Samix</h1>
      <nav className="flex items-center justify-between border-t border-rule pt-2">
        <div className="flex items-center">
          <button className={btn} onClick={onOlder} disabled={!onOlder}>
            {t.paper.older}
          </button>
          <button className={btn} onClick={onNewer} disabled={!onNewer}>
            {t.paper.newer}
          </button>
        </div>
        <div className="flex items-center">
          <button className={btn} onClick={onRefresh} disabled={running} title={t.paper.reloadTitle}>
            {t.paper.reload}
          </button>
          <button className={btn} onClick={onRun} disabled={running || !canRun} title={canRun ? t.paper.fetchTitle : t.paper.fetchOff}>
            {running ? t.paper.fetching : t.paper.fetch}
          </button>
        </div>
      </nav>
    </header>
  );
}

// ---- blocks --------------------------------------------------------------

interface StoryProps {
  article: EditionArticle;
  onOpen: (id: string, readingList?: string[]) => void;
  onVote: (id: string, value: -1 | 0 | 1) => void;
}

function Meta({
  article,
  withReading,
  onVote,
  onOpen,
}: {
  article: EditionArticle;
  withReading?: boolean;
  onVote: (id: string, value: -1 | 0 | 1) => void;
  onOpen: (id: string, readingList?: string[]) => void;
}) {
  const { t } = useI18n();
  const f = useFormat();
  const parts = [
    article.sourceName ?? hostnameOf(article.sourceUrl),
    f.shortDate(article.publishedAt),
    withReading && article.content?.status === 'ok' ? t.paper.readingMinutes(article.content.readingMinutes) : '',
  ].filter(Boolean);
  const related = article.related ?? [];
  const readingList = [article.id, ...related.map((r) => r.id)];
  return (
    <>
      <div className="flex items-center justify-between gap-2 text-xs text-ink-soft">
        <p>{parts.join(' · ')}</p>
        <VoteButtons vote={article.vote} onVote={(v) => onVote(article.id, v)} />
      </div>
      {related.length > 0 ? (
        <p className="mt-1 text-xs text-ink-soft" title={t.paper.storyJudgement}>
          {storySources(article).length > 1 ? t.paper.storySources(storySources(article).length) : t.paper.storyMore}{' '}
          {related.map((r, i) => (
            <span key={r.id}>
              {i > 0 ? ', ' : ''}
              <button className="underline hover:no-underline" onClick={() => onOpen(r.id, readingList)}>
                {r.sourceName ?? hostnameOf(r.sourceUrl)}
              </button>
            </span>
          ))}
        </p>
      ) : null}
    </>
  );
}

function Kicker({ article }: { article: EditionArticle }) {
  if (!article.topic) return null;
  return (
    <p className="text-[0.7rem] font-bold uppercase tracking-[0.2em] text-accent mb-1">
      {article.topic}
    </p>
  );
}

function LeadStory({ api, article, primary, onOpen, onVote }: StoryProps & { api: ApiClient; primary: boolean }) {
  const { t } = useI18n();
  const imageId = article.content?.leadImageId ?? article.imageId;
  return (
    <article className={primary ? '' : 'border-t border-rule pt-8'}>
      <Kicker article={article} />
      <h2
        className={`font-head font-bold leading-[1.1] mb-2 ${primary ? 'text-4xl md:text-5xl' : 'text-3xl'}`}
      >
        <button onClick={() => onOpen(article.id)} className="text-left hover:underline decoration-2">
          {article.title}
        </button>
      </h2>
      <Meta article={article} withReading onVote={onVote} onOpen={onOpen} />

      {imageId ? (
        <button onClick={() => onOpen(article.id)} className="block w-full my-4">
          <AuthImage api={api} id={imageId} photo className="w-full aspect-[2.4/1] object-cover" />
        </button>
      ) : null}

      <div className="my-4 border-l-4 border-ink pl-4">
        <p className="text-[0.65rem] font-bold uppercase tracking-[0.2em] text-ink-soft mb-1">
          {t.paper.aiSummary}
        </p>
        <p className="font-body text-lg leading-snug">{article.summary}</p>
        {article.importanceReason ? (
          <p className="mt-2 text-xs italic text-ink-soft">
            {t.paper.whyTop(article.importanceReason)}
          </p>
        ) : null}
      </div>

      {article.excerpt && article.excerpt.length > 0 ? (
        <div className="relative">
          <div className="font-body columns-1 lg:columns-2 gap-8 [column-rule:1px_solid_rgb(var(--rule))]">
            <Blocks blocks={article.excerpt} api={api} variant="excerpt" />
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-paper to-transparent" />
        </div>
      ) : null}

      <button
        onClick={() => onOpen(article.id)}
        className="mt-3 text-sm font-bold uppercase tracking-wider hover:underline"
      >
        {article.excerpt ? t.paper.readOn : t.paper.openArticle}
      </button>
    </article>
  );
}

function ArticleBlock({ article, onOpen, onVote }: StoryProps) {
  return (
    <article className="border-t-2 border-ink pt-3">
      <Kicker article={article} />
      <h3 className="font-head font-bold text-xl leading-tight mb-1">
        <button onClick={() => onOpen(article.id)} className="text-left hover:underline">
          {article.title}
        </button>
      </h3>
      <p className="font-body text-[0.95rem] leading-snug mb-2">{article.summary}</p>
      <Meta article={article} onVote={onVote} onOpen={onOpen} />
    </article>
  );
}

function BriefItem({ article, onOpen, onVote }: StoryProps) {
  return (
    <li className="border-b border-rule pb-3 last:border-0">
      <button onClick={() => onOpen(article.id)} className="text-left">
        <span className="block font-head font-bold leading-snug hover:underline">{article.title}</span>
      </button>
      <p className="font-body text-sm leading-snug mt-1 line-clamp-3">{article.summary}</p>
      <Meta article={article} onVote={onVote} onOpen={onOpen} />
    </li>
  );
}
