// After a run created its articles: give each article the image its source
// item declared. Matching is by the article's sourceUrl, so the model never
// picks (or invents) an image. Best-effort: a missing image never fails a run.

import type { Logger } from 'pino';
import { prisma } from '../db/prisma.js';
import { findSourceItem, type SourceIndex } from '../sources/match.js';
import { fetchImage } from './fetchImage.js';

const CONCURRENCY = 4;

export interface CreatedArticle {
  id: string;
  sourceUrl?: string | null;
}

export async function attachImages(articles: CreatedArticle[], sources: SourceIndex, log: Logger): Promise<number> {
  const jobs = articles.flatMap((a) => {
    const imageUrl = findSourceItem(sources, a.sourceUrl)?.imageUrl;
    return imageUrl ? [{ articleId: a.id, imageUrl }] : [];
  });

  let stored = 0;
  for (let i = 0; i < jobs.length; i += CONCURRENCY) {
    await Promise.all(
      jobs.slice(i, i + CONCURRENCY).map(async ({ articleId, imageUrl }) => {
        const image = await fetchImage(imageUrl, log);
        if (!image) return;
        try {
          await prisma.articleImage.create({
            data: { articleId, sourceUrl: imageUrl, mimeType: image.mimeType, bytes: Buffer.from(image.bytes) },
          });
          stored++;
        } catch (err) {
          log.warn({ articleId, err: err instanceof Error ? err.message : String(err) }, 'image_store_failed');
        }
      })
    );
  }
  log.info({ candidates: jobs.length, stored }, 'article_images');
  return stored;
}
