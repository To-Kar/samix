import type { ArticleLanguage } from '../settings.js';

const NAME: Record<ArticleLanguage, string> = { de: 'German', en: 'English' };

/**
 * The reader's article language, appended to the skill's system prompt so no
 * agent file has to change. A model instruction only: whether a model follows
 * it is not checked in code (the text it writes is checked against the schema
 * and the sources like any other).
 */
export function withArticleLanguage(systemPrompt: string, language: ArticleLanguage): string {
  return (
    `${systemPrompt}\n\n` +
    `Output language: write every reader-facing text field of your output (such as title, summary and ` +
    `the reason for the importance rating) in ${NAME[language]}, whatever language the source is in. ` +
    `Translate faithfully; keep names, numbers, quotations and URLs as they are, and add nothing the source does not say.`
  );
}
