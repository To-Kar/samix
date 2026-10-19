import type { Logger } from 'pino';
import { prisma } from '../db/prisma.js';
import { safeFetch, SafeFetchError } from '../net/safeFetch.js';
import { logger as rootLogger } from '../logger.js';
import { wordCountOf, type ContentBlock } from './blocks.js';
import { extractArticle, type RawBlock } from './extract.js';
import { storeImage } from './media.js';

// Fetches the page behind an article, reduces it to blocks and caches the
// result. Local work only — no model call, so no cost.

const MAX_HTML_BYTES = 3 * 1024 * 1024;
const MAX_IMAGES = 8;
const IMAGE_CONCURRENCY = 3;
const MIN_WORDS = 120;
const WORDS_PER_MINUTE = 200;

export type ContentStatus = 'ok' | 'unsupported' | 'failed';

const inFlight = new Map<string, Promise<void>>();

export interface EnsureOptions {
  // Fetch again even if a result (ok or not) is cached.
  refresh?: boolean;
  logger?: Logger;
}

// Makes sure an ArticleContent row exists for the article. Never throws for
// problems with the remote page — those become `unsupported` / `failed` rows
// so the UI can say so. Concurrent calls for one article share one fetch.
export async function ensureArticleContent(
  articleId: string,
  opts: EnsureOptions = {}
): Promise<void> {
  const running = inFlight.get(articleId);
  if (running) return running;

  const job = (async () => {
    const existing = await prisma.articleContent.findUnique({ where: { articleId } });
    if (existing && !opts.refresh) return;
    await fetchAndStore(articleId, opts.logger ?? rootLogger);
  })().finally(() => inFlight.delete(articleId));
  inFlight.set(articleId, job);
  return job;
}

async function fetchAndStore(articleId: string, log: Logger): Promise<void> {
  const article = await prisma.article.findUnique({ where: { id: articleId } });
  if (!article) throw new Error(`Article ${articleId} not found`);

  const save = (data: {
    status: ContentStatus;
    error?: string;
    finalUrl?: string;
    title?: string;
    byline?: string;
    siteName?: string;
    lang?: string;
    leadImageId?: string;
    blocks?: ContentBlock[];
  }) => {
    const blocks = data.blocks ?? [];
    const wordCount = wordCountOf(blocks);
    const row = {
      status: data.status,
      error: data.error ?? null,
      finalUrl: data.finalUrl ?? null,
      title: data.title ?? null,
      byline: data.byline ?? null,
      siteName: data.siteName ?? null,
      lang: data.lang ?? null,
      leadImageId: data.leadImageId ?? null,
      blocks: JSON.stringify(blocks),
      wordCount,
      readingMinutes: Math.max(1, Math.ceil(wordCount / WORDS_PER_MINUTE)),
      fetchedAt: new Date(),
    };
    return prisma.articleContent.upsert({
      where: { articleId },
      create: { articleId, ...row },
      update: row,
    });
  };

  if (!article.sourceUrl) {
    await save({ status: 'unsupported', error: 'no_source_url' });
    return;
  }

  try {
    const page = await safeFetch(article.sourceUrl, {
      maxBytes: MAX_HTML_BYTES,
      timeoutMs: 15_000,
      accept: 'text/html,application/xhtml+xml',
      contentType: /text\/html|application\/xhtml\+xml/,
    });
    const extracted = extractArticle(page.body.toString('utf8'), page.finalUrl);
    if (!extracted) {
      await save({ status: 'unsupported', error: 'no_article_found', finalUrl: page.finalUrl });
      return;
    }

    const blocks = await resolveImages(extracted.blocks, log);
    const leadImageId = extracted.leadImageSrc
      ? await storeImage(extracted.leadImageSrc).catch(() => undefined)
      : (blocks.find((b) => b.type === 'image') as { mediaId: string } | undefined)?.mediaId;

    const words = wordCountOf(blocks);
    await save({
      // A very short extract is usually a paywall, a login wall or a page that
      // needs JavaScript. We can't tell which, so the UI says "maybe".
      status: words < MIN_WORDS ? 'unsupported' : 'ok',
      error: words < MIN_WORDS ? 'content_too_short' : undefined,
      finalUrl: page.finalUrl,
      title: extracted.title,
      byline: extracted.byline,
      siteName: extracted.siteName,
      lang: extracted.lang,
      leadImageId,
      blocks,
    });
    log.info({ articleId, words, images: blocks.filter((b) => b.type === 'image').length }, 'content_extracted');
  } catch (err) {
    const code =
      err instanceof SafeFetchError
        ? err.code === 'http_error'
          ? `http_${err.status}`
          : err.code
        : 'extract_failed';
    log.warn({ articleId, code, err: err instanceof Error ? err.message : String(err) }, 'content_failed');
    await save({ status: 'failed', error: code });
  }
}

// Downloads up to MAX_IMAGES images; ones that fail are dropped, not fatal.
async function resolveImages(raw: RawBlock[], log: Logger): Promise<ContentBlock[]> {
  const refs = raw.filter((b): b is Extract<RawBlock, { type: 'image-ref' }> => b.type === 'image-ref');
  const wanted = new Set(refs.slice(0, MAX_IMAGES).map((r) => r.src));
  const ids = new Map<string, string>();

  const queue = [...wanted];
  await Promise.all(
    Array.from({ length: IMAGE_CONCURRENCY }, async () => {
      for (let src = queue.shift(); src; src = queue.shift()) {
        try {
          ids.set(src, await storeImage(src));
        } catch (err) {
          log.debug({ src, err: err instanceof Error ? err.message : String(err) }, 'image_skipped');
        }
      }
    })
  );

  const out: ContentBlock[] = [];
  for (const b of raw) {
    if (b.type !== 'image-ref') {
      out.push(b);
      continue;
    }
    const mediaId = ids.get(b.src);
    if (mediaId) out.push({ type: 'image', mediaId, alt: b.alt, caption: b.caption });
  }
  return out;
}
