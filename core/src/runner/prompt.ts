import type { Skill } from '../types.js';
import { getArticleLanguage, getInstructions, isAdvanced } from '../settings.js';
import { withArticleLanguage } from './language.js';

/**
 * The system prompt an agent actually runs with: its skill prompt, then the
 * reader's article language (article runs), then the reader's extra
 * instructions (advanced mode only). The skill prompt always comes first and is
 * never replaced; format, source and citation rules are enforced in code, not
 * by this text.
 */
export function composeSystemPrompt(skill: Skill, opts: { articleLanguage?: boolean } = {}): string {
  let prompt = skill.systemPrompt;
  const language = opts.articleLanguage ? getArticleLanguage() : undefined;
  if (language) prompt = withArticleLanguage(prompt, language);
  const extra = isAdvanced() ? getInstructions(skill.id) : undefined;
  if (extra) {
    prompt +=
      '\n\nAdditional instructions from the reader. Follow them where they do not conflict with the ' +
      'required output format, the source rules and the rules above:\n' +
      extra;
  }
  return prompt;
}
