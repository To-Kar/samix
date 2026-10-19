import { prisma } from '../db/prisma.js';
import { normalizeUrl } from '../output/traceability.js';
import type { SourceItem } from '../types.js';

export const DEFAULT_DEDUPE_DAYS = 14;

// An agent that runs daily over the same feeds would otherwise publish the
// same story again and again (and pay for summarising it each time). Items
// whose URL this agent already published within the window are dropped before
// the model sees them. Scoped per agent: two agents may legitimately cover
// the same article. Different URLs for the same story are not detected.
export async function dropAlreadyPublished(
  agentId: string,
  items: SourceItem[],
  days: number,
  now = new Date()
): Promise<{ fresh: SourceItem[]; skipped: number }> {
  if (days <= 0 || items.length === 0) return { fresh: items, skipped: 0 };

  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const published = await prisma.article.findMany({
    where: { agentRun: { agentId }, createdAt: { gte: since }, sourceUrl: { not: null } },
    select: { sourceUrl: true },
  });
  const seen = new Set(published.map((a) => normalizeUrl(a.sourceUrl!)).filter(Boolean));

  const fresh = items.filter((i) => {
    const key = normalizeUrl(i.url);
    return !key || !seen.has(key);
  });
  return { fresh, skipped: items.length - fresh.length };
}
