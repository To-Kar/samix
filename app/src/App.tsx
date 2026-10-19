import { useEffect, useState } from 'react';
import { initApi, type ApiClient } from './lib/api';
import { ConnectionBanner } from './components/ConnectionBanner';
import { Settings } from './components/Settings';
import { Appearance } from './components/Appearance';
import { Newspaper } from './components/Newspaper';
import { Sources } from './components/Sources';

export default function App() {
  const [api, setApi] = useState<ApiClient | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showSources, setShowSources] = useState(false);

  useEffect(() => {
    initApi()
      .then(setApi)
      .catch((err: unknown) =>
        setInitError(err instanceof Error ? err.message : String(err))
      );
  }, []);

  if (initError) {
    return (
      <main className="min-h-full p-8">
        <h1 className="samix-headline text-3xl mb-2">Samix</h1>
        <div className="samix-error">
          <div className="font-medium mb-1">Core config unavailable</div>
          <div className="font-mono">{initError}</div>
          <div className="mt-2">
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
      <main className="min-h-full flex items-center justify-center samix-hint">
        Connecting…
      </main>
    );
  }

  return (
    <main className="min-h-full flex flex-col">
      <ConnectionBanner api={api} />
      <div className="max-w-3xl w-full mx-auto px-6 py-8 flex flex-col gap-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="samix-headline text-3xl">Samix</h1>
            <p className="samix-hint">Today's news, curated locally.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setShowSources((v) => !v);
                setShowSettings(false);
              }}
              className="samix-button"
            >
              {showSources ? 'Close sources' : 'Sources'}
            </button>
            <button
              onClick={() => {
                setShowSettings((v) => !v);
                setShowSources(false);
              }}
              className="samix-button"
            >
              {showSettings ? 'Close settings' : 'Settings'}
            </button>
          </div>
        </header>
        {showSettings ? (
          <div className="flex flex-col gap-10">
            <section>
              <h2 className="samix-headline text-2xl mb-4">Aussehen</h2>
              <Appearance />
            </section>
            <section>
              <h2 className="samix-label mb-3">Secrets</h2>
              <Settings />
            </section>
          </div>
        ) : showSources ? (
          <section>
            <h2 className="samix-label mb-3">
              Sources
            </h2>
            <Sources api={api} />
          </section>
        ) : (
          <Newspaper api={api} />
        )}
      </div>
    </main>
  );
}
