import type { Logger } from 'pino';
import { prisma } from '../db/prisma.js';
import { onRunSuccess } from '../runner/hooks.js';
import { ensureArticleContent } from './articleContent.js';

// After a run, pre-load the full text of the stories that will be printed
// largest, so the front page can show their opening right away. Everything
// else is fetched lazily when the reader opens it.
export const PREFETCH_TOP_N = 2;

export function registerContentPrefetch(log: Logger): void {
  onRunSuccess(async (result) => {
    if (result.articleIds.length === 0) return;
    const top = await prisma.article.findMany({
      where: { id: { in: result.articleIds } },
      orderBy: [{ importance: { sort: 'desc', nulls: 'last' } }, { publishedAt: 'desc' }],
      take: PREFETCH_TOP_N,
      select: { id: true },
    });
    // Sequential: polite to the origin servers, and nobody is waiting on it.
    for (const { id } of top) await ensureArticleContent(id, { logger: log });
  });
}
