import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ApiClient, Article } from '../lib/api';
import { useI18n } from '../i18n/I18nProvider';
import { FrontPage } from './FrontPage';
import { ReaderView } from './ReaderView';

const NEWSLETTER_SLUG = 'newsletter-ai';

interface NewspaperProps {
  api: ApiClient;
}

/** Data + navigation for the newspaper: front page, or one article in the reader. */
export function Newspaper({ api }: NewspaperProps) {
  const [articles, setArticles] = useState<Article[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runMessage, setRunMessage] = useState<string | null>(null);
  const [ressort, setRessort] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const { t } = useI18n();

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const list = await api.listArticles();
      setArticles(list);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runNewsletter = async () => {
    setRunning(true);
    setRunMessage(null);
    try {
      const result = await api.runAgent(NEWSLETTER_SLUG);
      if (result.status === 'success') {
        setRunMessage(t.paper.runDone((result as { articleIds?: string[] }).articleIds?.length ?? 0));
      } else if (result.status === 'partial') {
        setRunMessage(t.paper.runPartial);
      } else {
        setRunMessage(t.paper.runFailed(result.error ?? t.paper.unknownError));
      }
      await refresh();
    } catch (e) {
      setRunMessage(t.paper.runFailed(e instanceof Error ? e.message : String(e)));
    } finally {
      setRunning(false);
    }
  };

  const closeReader = useCallback(() => setOpenId(null), []);
  const open = useMemo(() => articles?.find((a) => a.id === openId) ?? null, [articles, openId]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button onClick={() => void refresh()} disabled={running} className="samix-button">
          {t.paper.refresh}
        </button>
        <button onClick={() => void runNewsletter()} disabled={running} className="samix-button">
          {running ? t.paper.running : t.paper.run}
        </button>
      </div>

      {runMessage ? (
        <div className="samix-note" role="status">
          <b>{t.status.notice}</b> {runMessage}
        </div>
      ) : null}

      {loadError ? (
        <div className="samix-error" role="alert">
          <b>{t.status.error}</b> <span className="font-mono">{loadError}</span>
        </div>
      ) : null}

      {articles == null ? (
        <p className="samix-hint">{t.paper.loading}</p>
      ) : open ? (
        <ReaderView article={open} onBack={closeReader} />
      ) : (
        <FrontPage articles={articles} ressort={ressort} onRessort={setRessort} onOpen={setOpenId} />
      )}
    </div>
  );
}
