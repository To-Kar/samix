import type { SourceItem } from '../types.js';

// Source-traceability is enforced here, in code, rather than asked of the
// model in the prompt. An article only reaches the knowledge store if its
// URL is one of the items this run actually fetched (the SourceSnapshots)
// and a publication date can be established.

export interface ArticleCandidate {
  title: string;
  summary: string;
  sourceUrl?: string;
  publishedAt?: string;
  topic?: string;
  importance?: number;
  importanceReason?: string;
  /** Same key = the model says these articles report the same event. */
  story?: string;
}

export interface TraceableArticle {
  title: string;
  summary: string;
  topic?: string;
  // 1..5; 3 when the model gave none.
  importance: number;
  importanceReason?: string;
  // Shared by at least two articles of the run, else undefined.
  storyKey?: string;
  // Taken from the matching source item, not from the model's output.
  sourceUrl: string;
  sourceName: string;
  publishedAt: Date;
}

export type RejectionReason =
  | 'url_missing'
  | 'url_not_in_sources'
  | 'no_publication_date'
  | 'duplicate';

export interface Rejection {
  title: string;
  sourceUrl?: string;
  reason: RejectionReason;
}

export interface TraceabilityResult {
  accepted: TraceableArticle[];
  rejected: Rejection[];
}

// Query parameters that identify a campaign, not a page.
const TRACKING_PARAM = /^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$)/i;

// Canonical comparison key for a URL, or null if it isn't an http(s) URL.
// Deliberately lenient on things that don't change the page (scheme, `www.`,
// trailing slash, fragment, tracking params, parameter order) and strict on
// everything else: a different host or path is a different source.
export function normalizeUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;

  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const port = u.port ? `:${u.port}` : '';
  const path = u.pathname.replace(/\/+$/, '');
  const params = [...u.searchParams.entries()]
    .filter(([k]) => !TRACKING_PARAM.test(k))
    .sort(([a], [b]) => a.localeCompare(b));
  const query = new URLSearchParams(params).toString();
  return `${host}${port}${path}${query ? `?${query}` : ''}`;
}

export const DEFAULT_IMPORTANCE = 3;

const MAX_STORY_KEY = 60;

// Keys are the model's free text: compare them loosely.
function normalizeStory(raw: string | undefined): string | undefined {
  const k = raw?.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, MAX_STORY_KEY);
  return k || undefined;
}

function clampImportance(raw: number | undefined): number {
  if (raw == null || !Number.isFinite(raw)) return DEFAULT_IMPORTANCE;
  return Math.min(5, Math.max(1, Math.round(raw)));
}

function parseDate(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function enforceTraceability(
  candidates: ArticleCandidate[],
  sources: SourceItem[]
): TraceabilityResult {
  const byUrl = new Map<string, SourceItem>();
  for (const item of sources) {
    const key = normalizeUrl(item.url);
    if (key && !byUrl.has(key)) byUrl.set(key, item);
  }

  const accepted: TraceableArticle[] = [];
  const rejected: Rejection[] = [];
  const seen = new Set<string>();

  for (const c of candidates) {
    if (!c.sourceUrl) {
      rejected.push({ title: c.title, reason: 'url_missing' });
      continue;
    }
    const key = normalizeUrl(c.sourceUrl);
    const source = key ? byUrl.get(key) : undefined;
    if (!key || !source) {
      rejected.push({ title: c.title, sourceUrl: c.sourceUrl, reason: 'url_not_in_sources' });
      continue;
    }
    if (seen.has(key)) {
      rejected.push({ title: c.title, sourceUrl: c.sourceUrl, reason: 'duplicate' });
      continue;
    }
    // The source's own date is authoritative; the model's is only a fallback
    // for sources that carry none.
    const publishedAt = source.publishedAt ?? parseDate(c.publishedAt);
    if (!publishedAt) {
      rejected.push({ title: c.title, sourceUrl: c.sourceUrl, reason: 'no_publication_date' });
      continue;
    }
    seen.add(key);
    accepted.push({
      title: c.title,
      summary: c.summary,
      topic: c.topic,
      importance: clampImportance(c.importance),
      importanceReason: c.importanceReason,
      storyKey: normalizeStory(c.story),
      sourceUrl: source.url,
      sourceName: source.sourceName,
      publishedAt,
    });
  }

  // A "story" of one article is no story, and a key that survived only because
  // its other articles were rejected must not dangle.
  const sizes = new Map<string, number>();
  for (const a of accepted) if (a.storyKey) sizes.set(a.storyKey, (sizes.get(a.storyKey) ?? 0) + 1);
  for (const a of accepted) if (a.storyKey && (sizes.get(a.storyKey) ?? 0) < 2) a.storyKey = undefined;

  return { accepted, rejected };
}
