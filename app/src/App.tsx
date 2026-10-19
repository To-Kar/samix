import { useEffect, useState } from 'react';
import { initApi, type ApiClient } from './lib/api';
import { ConnectionBanner } from './components/ConnectionBanner';
import { Settings } from './components/Settings';
import { Appearance } from './components/Appearance';
import { Newspaper } from './components/Newspaper';
import { Sources } from './components/Sources';

type View = 'paper' | 'sources' | 'settings';

const VIEWS: [View, string][] = [
  ['paper', 'Zeitung'],
  ['sources', 'Quellen'],
  ['settings', 'Einstellungen'],
];

export default function App() {
  const [api, setApi] = useState<ApiClient | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [view, setView] = useState<View>('paper');

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
      <div className="max-w-6xl w-full mx-auto px-6 py-6 flex flex-col gap-6">
        <nav className="flex justify-end gap-2" aria-label="Bereiche">
          {VIEWS.map(([id, label]) => (
            <button key={id} className="samix-button" aria-pressed={view === id} onClick={() => setView(id)}>
              {label}
            </button>
          ))}
        </nav>
        {view === 'settings' ? (
          <div className="max-w-3xl flex flex-col gap-10">
            <section>
              <h2 className="samix-headline text-2xl mb-4">Aussehen</h2>
              <Appearance />
            </section>
            <section>
              <h2 className="samix-label mb-3">Secrets</h2>
              <Settings />
            </section>
          </div>
        ) : view === 'sources' ? (
          <section className="max-w-3xl">
            <h2 className="samix-label mb-3">Quellen</h2>
            <Sources api={api} />
          </section>
        ) : (
          <Newspaper api={api} />
        )}
      </div>
    </main>
  );
}
