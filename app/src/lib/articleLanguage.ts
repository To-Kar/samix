// Which language the agents write articles in. The choice ("follow the app" or
// a fixed language) is a per-device preference; the core only stores the
// resulting language (PUT /settings/article-language) and uses it from the
// next run on. Articles already fetched are not translated.

import type { Locale } from '../i18n/messages';

export const ARTICLE_LANGUAGE_MODES = ['follow', 'de', 'en'] as const;
export type ArticleLanguageMode = (typeof ARTICLE_LANGUAGE_MODES)[number];

const KEY = 'samix.articleLanguage';
const EVENT = 'samix:article-language';

export function effectiveArticleLanguage(mode: ArticleLanguageMode, locale: Locale): 'de' | 'en' {
  return mode === 'follow' ? locale : mode;
}

export function getArticleLanguageMode(): ArticleLanguageMode {
  try {
    const v = localStorage.getItem(KEY);
    return (ARTICLE_LANGUAGE_MODES as readonly string[]).includes(v ?? '') ? (v as ArticleLanguageMode) : 'follow';
  } catch {
    return 'follow';
  }
}

export function setArticleLanguageMode(mode: ArticleLanguageMode): void {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* session-only choice */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function subscribeArticleLanguageMode(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
}
