import { useEffect, useSyncExternalStore } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import type { ApiClient } from '../lib/api';
import {
  ARTICLE_LANGUAGE_MODES,
  effectiveArticleLanguage,
  getArticleLanguageMode,
  setArticleLanguageMode,
  subscribeArticleLanguageMode,
  type ArticleLanguageMode,
} from '../lib/articleLanguage';
import { Segmented } from './controls';

const useMode = () => useSyncExternalStore(subscribeArticleLanguageMode, getArticleLanguageMode);

/** Keeps the core's article language in line with the choice and the UI language. Renders nothing. */
export function ArticleLanguageSync({ api }: { api: ApiClient }) {
  const { locale } = useI18n();
  const mode = useMode();
  const language = effectiveArticleLanguage(mode, locale);
  useEffect(() => {
    api.setArticleLanguage(language).catch(() => {
      // Core not reachable: the connection banner says so; the next start syncs again.
    });
  }, [api, language]);
  return null;
}

export function ArticleLanguageSetting() {
  const { t } = useI18n();
  const mode = useMode();
  const labels: Record<ArticleLanguageMode, string> = {
    follow: t.app.articleLanguageFollow,
    de: 'Deutsch',
    en: 'English',
  };
  return (
    <>
      <h3 className="samix-label">{t.app.articleLanguage}</h3>
      <Segmented value={mode} options={ARTICLE_LANGUAGE_MODES.map((m) => [m, labels[m]])} onChange={setArticleLanguageMode} />
      <p className="text-xs text-ink-soft">{t.app.articleLanguageHint}</p>
    </>
  );
}
