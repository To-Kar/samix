import type { Logger } from 'pino';
import { prisma } from '../db/prisma.js';
import { parseBlocks } from './blocks.js';
import { collectUnreferencedMedia } from './media.js';

// Full texts and images are cached copies of third-party pages, and they are
// what makes the data directory grow. Article rows (title, summary, source
// link) are kept; only the cached copies expire.

export const DEFAULT_CONTENT_RETENTION_DAYS = 90;

export function contentRetentionDays(): number {
  const n = Number(process.env.SAMIX_CONTENT_RETENTION_DAYS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CONTENT_RETENTION_DAYS;
}

export async function applyContentRetention(
  log: Logger,
  now = new Date()
): Promise<{ contents: number; media: number }> {
  const cutoff = new Date(now.getTime() - contentRetentionDays() * 24 * 60 * 60 * 1000);
  const { count: contents } = await prisma.articleContent.deleteMany({
    where: { fetchedAt: { lt: cutoff } },
  });

  const referenced = new Set<string>();
  for (const c of await prisma.articleContent.findMany({ select: { blocks: true, leadImageId: true } })) {
    if (c.leadImageId) referenced.add(c.leadImageId);
    for (const b of parseBlocks(c.blocks)) if (b.type === 'image') referenced.add(b.mediaId);
  }
  const media = await collectUnreferencedMedia(referenced);
  if (contents || media) log.info({ contents, media }, 'content_retention_applied');
  return { contents, media };
}
