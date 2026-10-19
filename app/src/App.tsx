import { useCallback, useEffect, useRef, useState } from 'react';
import { initApi, type ApiClient } from './lib/api';
import { ConnectionBanner } from './components/ConnectionBanner';
import { Settings } from './components/Settings';
import { Newspaper } from './components/Newspaper';
import { Agents } from './components/Agents';
import { Reader } from './components/Reader';
import { Ask } from './components/Ask';
import { ModelHint } from './components/ModelHint';

type View =
  | { kind: 'paper' }
  | { kind: 'settings' }
  | { kind: 'agents' }
  | { kind: 'ask' }
  // `from`: where the reader returns to (the newspaper unless opened from a cited answer).
  | { kind: 'reader'; id: string; order: string[]; from?: 'ask' };

export default function App() {
  const [api, setApi] = useState<ApiClient | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ kind: 'paper' });
  // Bumped whenever the front page becomes visible again, so it reloads
  // (e.g. a lead story's text was fetched while reading).
  const [paperToken, setPaperToken] = useState(0);

  // The window has one scroll position shared by all views: remember where the
  // front page was when an article is opened, and go back there.
  const paperScroll = useRef(0);

  const fromReader = view.kind === 'reader';
  const fromAsk = view.kind === 'reader' && view.from === 'ask';
  const goPaper = useCallback(() => {
    setView({ kind: 'paper' });
    setPaperToken((t) => t + 1);
    if (fromReader) requestAnimationFrame(() => window.scrollTo({ top: paperScroll.current }));
  }, [fromReader]);
  const closeReader = useCallback(() => {
    if (!fromAsk) return goPaper();
    setView({ kind: 'ask' });
    requestAnimationFrame(() => window.scrollTo({ top: paperScroll.current }));
  }, [fromAsk, goPaper]);

  useEffect(() => {
    initApi()
      .then(setApi)
      .catch((err: unknown) =>
        setInitError(err instanceof Error ? err.message : String(err))
      );
  }, []);

  if (initError) {
    return (
      <main className="min-h-full bg-paper dark:bg-paper-dark text-ink dark:text-ink-dark p-8">
        <h1 className="text-2xl font-semibold mb-2">Samix</h1>
        <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/30 p-4 text-red-800 dark:text-red-200 text-sm">
          <div className="font-medium mb-1">Core config unavailable</div>
          <div className="font-mono text-xs">{initError}</div>
          <div className="mt-2 text-xs">
            Make sure <code>pnpm dev:core</code> is running and that{' '}
            <code>SAMIX_PORT</code> + <code>SAMIX_TOKEN</code> were passed to the
            Tauri process.
          </div>
        </div>
      </main>
    );
  }

  if (!api) {
    return (
      <main className="min-h-full flex items-center justify-center text-sm text-ink-soft dark:text-ink-soft-dark bg-paper dark:bg-paper-dark">
        Connecting…
      </main>
    );
  }

  const topBtn = 'px-2 py-1 text-xs uppercase tracking-wider hover:underline';

  return (
    <main className="min-h-full bg-paper dark:bg-paper-dark text-ink dark:text-ink-dark flex flex-col">
      <ConnectionBanner api={api} />
      <div className="max-w-6xl w-full mx-auto px-6 pt-3 pb-12 flex flex-col gap-4">
        <ModelHint api={api} refreshKey={view.kind} />
        <div className="flex justify-end gap-1">
          <button
            className={topBtn}
            onClick={() => (view.kind === 'ask' ? goPaper() : setView({ kind: 'ask' }))}
          >
            {view.kind === 'ask' ? 'Fragen schließen' : 'Fragen'}
          </button>
          <button
            className={topBtn}
            onClick={() => (view.kind === 'agents' ? goPaper() : setView({ kind: 'agents' }))}
          >
            {view.kind === 'agents' ? 'Ressorts schließen' : 'Ressorts'}
          </button>
          <button
            className={topBtn}
            onClick={() => (view.kind === 'settings' ? goPaper() : setView({ kind: 'settings' }))}
          >
            {view.kind === 'settings' ? 'Einrichtung schließen' : 'Einrichtung'}
          </button>
        </div>

        {view.kind === 'settings' ? (
          <section className="max-w-3xl">
            <h2 className="text-sm font-medium uppercase tracking-wide text-ink-soft dark:text-ink-soft-dark mb-3">
              Einrichtung
            </h2>
            <Settings api={api} />
          </section>
        ) : null}

        {view.kind === 'agents' ? (
          <section>
            <h2 className="text-sm font-medium uppercase tracking-wide text-ink-soft dark:text-ink-soft-dark mb-3">
              Ressorts
            </h2>
            <Agents api={api} onChanged={() => setPaperToken((t) => t + 1)} />
          </section>
        ) : null}

        {view.kind === 'reader' ? (
          <Reader
            api={api}
            articleId={view.id}
            order={view.order}
            onClose={closeReader}
            onNavigate={(id) => setView({ ...view, id })}
          />
        ) : null}

        {/* Stays mounted too, so a conversation survives a visit to a cited article. */}
        <div hidden={view.kind !== 'ask'}>
          <Ask
            api={api}
            onOpenSetup={() => setView({ kind: 'settings' })}
            onOpenSource={(id, order) => {
              paperScroll.current = window.scrollY;
              setView({ kind: 'reader', id, order, from: 'ask' });
            }}
          />
        </div>

        {/* Stays mounted while another view is open, so the loaded edition
            survives a visit to the reader. */}
        <div hidden={view.kind !== 'paper'}>
          <Newspaper
            api={api}
            onOpenSetup={() => setView({ kind: 'settings' })}
            refreshToken={paperToken}
            onOpen={(id, order) => {
              paperScroll.current = window.scrollY;
              setView({ kind: 'reader', id, order });
            }}
          />
        </div>
      </div>
    </main>
  );
}
