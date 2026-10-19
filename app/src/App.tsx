import { useEffect, useState } from 'react';
import { initApi, type ApiClient } from './lib/api';
import { ConnectionBanner } from './components/ConnectionBanner';
import { Settings } from './components/Settings';
import { Appearance } from './components/Appearance';
import { ThemeShare } from './components/ThemeShare';
import { Newspaper } from './components/Newspaper';
import { Sources } from './components/Sources';
import { Segmented } from './components/controls';
import { useI18n } from './i18n/I18nProvider';
import { LOCALE_NAMES, LOCALES } from './i18n/messages';

type View = 'paper' | 'sources' | 'settings';

const VIEWS: [View, 'viewPaper' | 'viewSources' | 'viewSettings'][] = [
  ['paper', 'viewPaper'],
  ['sources', 'viewSources'],
  ['settings', 'viewSettings'],
];

export default function App() {
  const [api, setApi] = useState<ApiClient | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [view, setView] = useState<View>('paper');
  const { t, locale, setLocale } = useI18n();

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
          <div className="font-medium mb-1">
            {t.status.error} {t.app.coreUnavailable}
          </div>
          <div className="font-mono">{initError}</div>
          <div className="mt-2">{t.app.coreHint('pnpm dev:core', 'SAMIX_PORT + SAMIX_TOKEN')}</div>
        </div>
      </main>
    );
  }

  if (!api) {
    return (
      <main className="min-h-full flex items-center justify-center samix-hint">
        {t.app.connecting}
      </main>
    );
  }

  return (
    <main className="min-h-full flex flex-col">
      <ConnectionBanner api={api} />
      <div className="max-w-6xl w-full mx-auto px-6 py-6 flex flex-col gap-6">
        <nav className="flex justify-end gap-2" aria-label={t.app.navLabel}>
          {VIEWS.map(([id, label]) => (
            <button key={id} className="samix-button" aria-pressed={view === id} onClick={() => setView(id)}>
              {t.app[label]}
            </button>
          ))}
        </nav>
        {view === 'settings' ? (
          <div className="max-w-3xl flex flex-col gap-10">
            <section className="flex flex-col gap-2">
              <h2 className="samix-label">{t.app.language}</h2>
              <Segmented value={locale} options={LOCALES.map((l) => [l, LOCALE_NAMES[l]])} onChange={setLocale} />
            </section>
            <section>
              <h2 className="samix-headline text-2xl mb-4">{t.app.appearance}</h2>
              <Appearance />
            </section>
            <section>
              <h2 className="samix-headline text-2xl mb-4">{t.share.title}</h2>
              <ThemeShare />
            </section>
            <section>
              <h2 className="samix-label mb-3">{t.app.secrets}</h2>
              <Settings />
            </section>
          </div>
        ) : view === 'sources' ? (
          <section className="max-w-3xl">
            <h2 className="samix-label mb-3">{t.app.sources}</h2>
            <Sources api={api} />
          </section>
        ) : (
          <Newspaper api={api} />
        )}
      </div>
    </main>
  );
}
