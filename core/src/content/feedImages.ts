import type { Logger } from 'pino';
import { prisma } from '../db/prisma.js';
import { onRunSuccess } from '../runner/hooks.js';
import { storeImage } from './media.js';

// After a run, download the picture each article's source item declared in
// its feed. Goes through the shared media store (safeFetch, size cap, type
// sniffing, content-addressed files), so there is one image system, not two.
// Failures are logged and never touch the run.

const CONCURRENCY = 3;

export function registerFeedImages(log: Logger): void {
  onRunSuccess(async (result) => {
    if (result.articleIds.length === 0) return;
    const articles = await prisma.article.findMany({
      where: { id: { in: result.articleIds }, imageUrl: { not: null }, imageId: null },
      select: { id: true, imageUrl: true },
    });

    const queue = [...articles];
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        for (let a = queue.shift(); a; a = queue.shift()) {
          if (!a.imageUrl) continue;
          try {
            const imageId = await storeImage(a.imageUrl);
            await prisma.article.update({ where: { id: a.id }, data: { imageId } });
          } catch (err) {
            log.debug(
              { articleId: a.id, err: err instanceof Error ? err.message : String(err) },
              'feed_image_skipped'
            );
          }
        }
      })
    );
  });
}
