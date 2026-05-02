import { useEffect, useState } from 'react';
import { initApi, type ApiClient } from './lib/api';
import { ConnectionBanner } from './components/ConnectionBanner';
import { Settings } from './components/Settings';
import { Newspaper } from './components/Newspaper';
import { Sources } from './components/Sources';
import { Query } from './components/Query';

export default function App() {
  const [api, setApi] = useState<ApiClient | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [showQuery, setShowQuery] = useState(false);

  useEffect(() => {
    initApi()
      .then(setApi)
      .catch((err: unknown) =>
        setInitError(err instanceof Error ? err.message : String(err))
      );
  }, []);

  const closeAll = () => {
    setShowSettings(false);
    setShowSources(false);
    setShowQuery(false);
  };

  if (initError) {
    return (
      <main className="min-h-full bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 p-8">
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
      <main className="min-h-full flex items-center justify-center text-sm text-neutral-500">
        Connecting…
      </main>
    );
  }

  return (
    <main className="min-h-full bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 flex flex-col">
      <ConnectionBanner api={api} />
      <div className="max-w-3xl w-full mx-auto px-6 py-8 flex flex-col gap-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Samix</h1>
            <p className="text-sm text-neutral-500">Today's news, curated locally.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (showQuery) { closeAll(); } else { closeAll(); setShowQuery(true); }
              }}
              className="rounded border border-neutral-300 dark:border-neutral-700 px-3 py-1 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              {showQuery ? 'Close query' : 'Query'}
            </button>
            <button
              onClick={() => {
                if (showSources) { closeAll(); } else { closeAll(); setShowSources(true); }
              }}
              className="rounded border border-neutral-300 dark:border-neutral-700 px-3 py-1 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              {showSources ? 'Close sources' : 'Sources'}
            </button>
            <button
              onClick={() => {
                if (showSettings) { closeAll(); } else { closeAll(); setShowSettings(true); }
              }}
              className="rounded border border-neutral-300 dark:border-neutral-700 px-3 py-1 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              {showSettings ? 'Close settings' : 'Settings'}
            </button>
          </div>
        </header>
        {showSettings ? (
          <section>
            <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500 mb-3">
              Secrets
            </h2>
            <Settings />
          </section>
        ) : showSources ? (
          <section>
            <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500 mb-3">
              Sources
            </h2>
            <Sources api={api} />
          </section>
        ) : showQuery ? (
          <section>
            <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500 mb-3">
              Coding Assistant
            </h2>
            <Query api={api} />
          </section>
        ) : (
          <Newspaper api={api} />
        )}
      </div>
    </main>
  );
}
