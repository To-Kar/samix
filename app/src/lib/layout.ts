import type { EditionArticle } from './api';

/**
 * One printed article per story. Articles that share a `storyKey` collapse
 * into the first of them in front-page order (highest importance, then
 * recency); the others hang off it as `related`. The grouping is the model's
 * judgement, so the related articles stay visible and openable.
 */
export function groupStories(articles: EditionArticle[]): EditionArticle[] {
  const heads = new Map<string, EditionArticle>();
  const out: EditionArticle[] = [];
  for (const a of articles) {
    const head = a.storyKey ? heads.get(a.storyKey) : undefined;
    if (head) {
      head.related = [...(head.related ?? []), a];
      continue;
    }
    const copy: EditionArticle = { ...a, related: undefined };
    if (a.storyKey) heads.set(a.storyKey, copy);
    out.push(copy);
  }
  return out;
}

/** Distinct sources reporting a story (the printed article's own included). */
export function storySources(article: EditionArticle): string[] {
  const names = [article, ...(article.related ?? [])].map((a) => a.sourceName ?? a.sourceUrl ?? '');
  return [...new Set(names.filter(Boolean))];
}

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
