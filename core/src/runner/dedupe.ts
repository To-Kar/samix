import { prisma } from '../db/prisma.js';
import { normalizeUrl } from '../output/traceability.js';
import { tokenize } from '../text/keywords.js';
import type { SourceItem } from '../types.js';

export const DEFAULT_DEDUPE_DAYS = 14;

// An agent that runs daily over the same feeds would otherwise publish the
// same story again and again (and pay for summarising it each time). Items
// whose URL this agent already published within the window are dropped before
// the model sees them. Scoped per agent: two agents may legitimately cover
// the same article.
//
// Second, conservative check: the same headline under another URL (syndicated
// copies, moved articles, a source that changed its URL scheme). An item whose
// title is nearly identical to the source title of something this agent
// already published is dropped too, and reported, so the reader can see what
// was skipped. Different outlets reporting the same event in their own words
// are NOT dropped here; the model groups those (story keys).

export interface SimilarSkip {
  title: string;
  url: string;
  /** The earlier title it was taken for a repeat of. */
  similarTo: string;
}

const STOPWORDS = new Set(
  'der die das den dem des ein eine einen einem einer und oder aber mit von für auf aus bei nach über unter vor zum zur ist sind wird werden hat haben nicht auch the and for with from that this are was were has have not its'.split(' ')
);
export const SIMILAR_MIN_SHARED = 3;
export const SIMILAR_MIN_JACCARD = 0.75;

// The distinctive words of a headline: stemmed, no filler, short words only if numbers.
function titleTokens(title: string): Set<string> {
  return new Set(tokenize(title).stems.filter((w) => !STOPWORDS.has(w) && (w.length >= 3 || /^\d+$/.test(w))));
}

export function titlesSimilar(a: string, b: string): boolean {
  const ta = titleTokens(a);
  const tb = titleTokens(b);
  let shared = 0;
  for (const w of ta) if (tb.has(w)) shared++;
  const union = ta.size + tb.size - shared;
  return shared >= SIMILAR_MIN_SHARED && union > 0 && shared / union >= SIMILAR_MIN_JACCARD;
}

export async function dropAlreadyPublished(
  agentId: string,
  items: SourceItem[],
  days: number,
  now = new Date(),
  opts: { similar?: boolean } = {}
): Promise<{ fresh: SourceItem[]; skipped: number; skippedSimilar: SimilarSkip[] }> {
  if (days <= 0 || items.length === 0) return { fresh: items, skipped: 0, skippedSimilar: [] };

  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const published = await prisma.article.findMany({
    where: { agentRun: { agentId }, createdAt: { gte: since }, sourceUrl: { not: null } },
    select: { sourceUrl: true },
  });
  const seen = new Set(published.map((a) => normalizeUrl(a.sourceUrl!)).filter(Boolean));

  const byUrl = items.filter((i) => {
    const key = normalizeUrl(i.url);
    return !key || !seen.has(key);
  });
  const skipped = items.length - byUrl.length;
  if (!opts.similar || byUrl.length === 0 || published.length === 0) return { fresh: byUrl, skipped, skippedSimilar: [] };

  // The titles the sources gave the things that were published.
  const snapshots = await prisma.sourceSnapshot.findMany({
    where: { agentRun: { agentId }, url: { in: published.map((p) => p.sourceUrl!) } },
    select: { title: true },
    distinct: ['url'],
  });
  const known = snapshots.map((s) => s.title);

  const skippedSimilar: SimilarSkip[] = [];
  const fresh = byUrl.filter((i) => {
    const match = known.find((t) => titlesSimilar(i.title, t));
    if (match === undefined) return true;
    skippedSimilar.push({ title: i.title, url: i.url, similarTo: match });
    return false;
  });
  return { fresh, skipped: skipped + skippedSimilar.length, skippedSimilar };
}
