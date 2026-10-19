import type { EditionArticle } from './api';

export interface PageLayout {
  /** Lead stories, printed large (1, at most 2). */
  lead: EditionArticle[];
  /** Regular article blocks. */
  main: EditionArticle[];
  /** Short notices in the narrow column. */
  brief: EditionArticle[];
}

// Importance thresholds of the model's 1-5 rating.
const SECOND_LEAD_MIN = 4;
const BRIEF_MAX = 2;

// Expects articles in front-page order (the core sorts by importance, then
// recency). A newspaper always has a lead, so the first article is one even
// when nothing was rated highly; a second lead needs a high rating.
export function layoutEdition(articles: EditionArticle[]): PageLayout {
  if (articles.length === 0) return { lead: [], main: [], brief: [] };

  const lead = [articles[0]!];
  let rest = articles.slice(1);
  const second = rest[0];
  if (second && second.importance >= SECOND_LEAD_MIN) {
    lead.push(second);
    rest = rest.slice(1);
  }

  return {
    lead,
    main: rest.filter((a) => a.importance > BRIEF_MAX),
    brief: rest.filter((a) => a.importance <= BRIEF_MAX),
  };
}

/** Reading order across the whole page, for next/previous in the reader. */
export function readingOrder(layout: PageLayout): string[] {
  return [...layout.lead, ...layout.main, ...layout.brief].map((a) => a.id);
}
