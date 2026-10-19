import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { prisma } from '../src/db/prisma.js';
import { ensureArticleContent } from '../src/content/articleContent.js';
import { applyContentRetention } from '../src/content/retention.js';
import { readMedia } from '../src/content/media.js';
import { logger } from '../src/logger.js';
import { PNG, useFakeNet } from './net.js';
import { makeSkill, seedAgent } from './helpers.js';

const FIXTURE = readFileSync(resolve(import.meta.dirname, 'fixtures/article.html'), 'utf8');
const HTML = { 'content-type': 'text/html; charset=utf-8' };
const IMG = { 'content-type': 'image/png' };
const SHORT = `<html lang="en"><head><title>Teaser</title></head><body><article><h1>Teaser</h1><p>${'Subscribe to read the rest of this story. '.repeat(6)}</p></article></body></html>`;

const net = useFakeNet({
  'https://magazin.example/ki/modell': { headers: HTML, body: FIXTURE },
  'https://magazin.example/img/chart.png': { headers: IMG, body: PNG },
  'https://magazin.example/img/hero-large.jpg': { headers: IMG, body: PNG },
  'https://paywall.example/story': { headers: HTML, body: SHORT },
  'https://empty.example/': { headers: HTML, body: '<html><body><nav>x</nav></body></html>' },
  'https://files.example/doc.pdf': { headers: { 'content-type': 'application/pdf' }, body: '%PDF-1.4' },
  'https://forbidden.example/a': { status: 403 },
});

let runId: string | undefined;
async function article(sourceUrl: string | null) {
  const skill = makeSkill();
  const agentId = await seedAgent(skill);
  runId ??= (await prisma.agentRun.create({ data: { agentId, status: 'success', trigger: 'manual' } })).id;
  return prisma.article.create({
    data: { agentRunId: runId, title: 't', summary: 's', sourceUrl, importance: 3 },
  });
}
const contentOf = (articleId: string) => prisma.articleContent.findUniqueOrThrow({ where: { articleId } });

describe('ensureArticleContent', () => {
  it('extracts text, downloads images and stores a lead image', async () => {
    const a = await article('https://magazin.example/ki/modell');
    await ensureArticleContent(a.id, { logger });
    const c = await contentOf(a.id);

    expect(c).toMatchObject({ status: 'ok', error: null, title: 'Neues Sprachmodell schlägt Benchmark', byline: 'Erika Muster', lang: 'de' });
    expect(c.wordCount).toBeGreaterThan(120);
    expect(c.readingMinutes).toBe(1);
    const blocks = JSON.parse(c.blocks) as { type: string; mediaId?: string }[];
    const image = blocks.find((b) => b.type === 'image')!;
    expect((await readMedia(image.mediaId!))?.mime).toBe('image/png');
    expect(c.leadImageId).toMatch(/^[a-f0-9]{64}$/);
    // Blocks never contain raw URLs of the origin for images — only local ids.
    expect(c.blocks).not.toContain('magazin.example/img');
  });

  it('serves the cache: no second fetch, unless refresh is asked for', async () => {
    const a = await article('https://magazin.example/ki/modell');
    await ensureArticleContent(a.id, { logger });
    const after1 = net.calls.length;
    await ensureArticleContent(a.id, { logger });
    expect(net.calls.length).toBe(after1);
    await ensureArticleContent(a.id, { logger, refresh: true });
    expect(net.calls.length).toBeGreaterThan(after1);
  });

  it('shares one fetch between concurrent requests for the same article', async () => {
    const a = await article('https://magazin.example/ki/modell');
    await Promise.all([ensureArticleContent(a.id, { logger }), ensureArticleContent(a.id, { logger }), ensureArticleContent(a.id, { logger })]);
    expect(net.calls.filter((u) => u === 'https://magazin.example/ki/modell')).toHaveLength(1);
  });

  it.each([
    ['a very short extract (paywall / login wall)', 'https://paywall.example/story', 'unsupported', 'content_too_short'],
    ['a page without an article', 'https://empty.example/', 'unsupported', 'no_article_found'],
    ['a non-HTML resource', 'https://files.example/doc.pdf', 'failed', 'bad_content_type'],
    ['an HTTP error', 'https://forbidden.example/a', 'failed', 'http_403'],
    ['a link into the local network', 'http://127.0.0.1:11434/api/tags', 'failed', 'blocked_host'],
    ['a link that resolves nowhere', 'https://unknown.example/', 'failed', 'http_404'],
  ])('records %s as %s/%s instead of throwing', async (_label, url, status, error) => {
    const a = await article(url);
    await ensureArticleContent(a.id, { logger });
    expect(await contentOf(a.id)).toMatchObject({ status, error });
  });

  it('marks an article without a source URL unsupported', async () => {
    const a = await article(null);
    await ensureArticleContent(a.id, { logger });
    expect(await contentOf(a.id)).toMatchObject({ status: 'unsupported', error: 'no_source_url' });
  });

  it('does not request the local network at all for a blocked link', async () => {
    const a = await article('http://169.254.169.254/latest/meta-data/');
    await ensureArticleContent(a.id, { logger });
    expect(net.calls).toEqual([]);
  });
});

describe('applyContentRetention', () => {
  it('expires old cached text but keeps the article, and frees only unreferenced images', async () => {
    const fresh = await article('https://magazin.example/ki/modell');
    await ensureArticleContent(fresh.id, { logger });
    const stale = await article('https://magazin.example/ki/modell');
    await ensureArticleContent(stale.id, { logger });
    const old = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);
    await prisma.articleContent.update({ where: { articleId: stale.id }, data: { fetchedAt: old } });

    const result = await applyContentRetention(logger);

    expect(result.contents).toBeGreaterThanOrEqual(1);
    expect(await prisma.articleContent.findUnique({ where: { articleId: stale.id } })).toBeNull();
    expect(await prisma.article.findUnique({ where: { id: stale.id } })).not.toBeNull();
    // Both used the same images; the fresh one still references them.
    const c = await contentOf(fresh.id);
    expect(await readMedia(c.leadImageId!)).not.toBeNull();
  });
});
