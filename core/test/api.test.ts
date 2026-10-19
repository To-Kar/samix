import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db/prisma.js';
import { logger } from '../src/logger.js';
import { makeSkill, seedAgent } from './helpers.js';
import { PNG, useFakeNet } from './net.js';

const AUTH = { authorization: 'Bearer tok' };
let app: Awaited<ReturnType<typeof buildApp>>;
let agentId: string;
let slug: string;
const editionIds: string[] = [];

async function makeEdition(startedAt: string, articles: { title: string; importance?: number; publishedAt: string }[]) {
  const run = await prisma.agentRun.create({
    data: { agentId, status: 'success', trigger: 'manual', startedAt: new Date(startedAt), model: 'claude-haiku-4-5', costUsd: 0.01 },
  });
  for (const a of articles) {
    await prisma.article.create({
      data: {
        agentRunId: run.id,
        title: a.title,
        summary: `summary of ${a.title}`,
        sourceUrl: `https://example.com/${encodeURIComponent(a.title)}`,
        sourceName: 'Example',
        publishedAt: new Date(a.publishedAt),
        importance: a.importance,
      },
    });
  }
  editionIds.push(run.id);
  return run.id;
}

beforeAll(async () => {
  const skill = makeSkill();
  slug = skill.id;
  agentId = await seedAgent(skill);
  app = await buildApp({ token: 'tok', logger, getSkills: () => [skill] });

  await makeEdition('2026-10-17T06:00:00Z', [{ title: 'old', importance: 3, publishedAt: '2026-10-16T00:00:00Z' }]);
  await makeEdition('2026-10-18T06:00:00Z', [
    { title: 'filler', importance: 1, publishedAt: '2026-10-18T05:00:00Z' },
    { title: 'lead', importance: 5, publishedAt: '2026-10-17T05:00:00Z' },
    { title: 'normal-new', importance: 3, publishedAt: '2026-10-18T04:00:00Z' },
    { title: 'normal-old', importance: 3, publishedAt: '2026-10-17T04:00:00Z' },
    { title: 'unrated', publishedAt: '2026-10-18T03:00:00Z' },
  ]);
  // A run that produced nothing is not an edition.
  await prisma.agentRun.create({ data: { agentId, status: 'failed', trigger: 'manual', startedAt: new Date('2026-10-19T06:00:00Z') } });
});

describe('auth and validation', () => {
  it('requires the bearer token everywhere except /health', async () => {
    expect((await app.inject('/health')).statusCode).toBe(200);
    expect((await app.inject('/editions')).statusCode).toBe(401);
    expect((await app.inject({ url: '/editions', headers: { authorization: 'Bearer nope' } })).statusCode).toBe(401);
  });

  it('rejects malformed queries with 400', async () => {
    for (const url of ['/articles?since=garbage', '/articles?limit=abc', '/editions?limit=0', '/editions/latest?leadParagraphs=99']) {
      expect((await app.inject({ url, headers: AUTH })).statusCode, url).toBe(400);
    }
  });
});

describe('editions', () => {
  it('lists only runs that produced articles, newest first, with running numbers', async () => {
    const res = await app.inject({ url: `/editions?agent=${slug}`, headers: AUTH });
    const list = res.json() as { id: string; number: number; articleCount: number; model: string }[];
    expect(list.map((e) => e.id)).toEqual([editionIds[1], editionIds[0]]);
    expect(list.map((e) => e.number)).toEqual([2, 1]);
    expect(list[0]).toMatchObject({ articleCount: 5, model: 'claude-haiku-4-5' });
  });

  it('orders articles by importance, then recency; unrated counts as 3', async () => {
    const res = await app.inject({ url: `/editions/${editionIds[1]}`, headers: AUTH });
    const ed = res.json();
    expect(ed.articles.map((a: { title: string }) => a.title)).toEqual(['lead', 'normal-new', 'unrated', 'normal-old', 'filler']);
    expect(ed.articles.find((a: { title: string }) => a.title === 'unrated').importance).toBe(3);
  });

  it('links to older and newer editions', async () => {
    const mid = (await app.inject({ url: `/editions/${editionIds[1]}`, headers: AUTH })).json();
    expect(mid).toMatchObject({ number: 2, olderId: editionIds[0], newerId: null });
    const first = (await app.inject({ url: `/editions/${editionIds[0]}`, headers: AUTH })).json();
    expect(first).toMatchObject({ number: 1, olderId: null, newerId: editionIds[1] });
  });

  it('"latest" resolves to the newest edition with articles, not a later failed run', async () => {
    const res = await app.inject({ url: '/editions/latest', headers: AUTH });
    expect(res.json().id).toBe(editionIds[1]);
  });

  it('404s on unknown ids', async () => {
    expect((await app.inject({ url: '/editions/nope', headers: AUTH })).statusCode).toBe(404);
    expect((await app.inject({ url: '/articles/nope', headers: AUTH })).statusCode).toBe(404);
  });

  it('adds an excerpt for articles whose text is cached (and only those)', async () => {
    const lead = await prisma.article.findFirstOrThrow({ where: { title: 'lead' } });
    const blocks = [
      { type: 'paragraph', text: 'One.' },
      { type: 'image', mediaId: 'a'.repeat(64) },
      { type: 'heading', level: 2, text: 'Sub' },
      { type: 'paragraph', text: 'Two.' },
      { type: 'paragraph', text: 'Three.' },
    ];
    await prisma.articleContent.create({
      data: { articleId: lead.id, status: 'ok', blocks: JSON.stringify(blocks), wordCount: 3, readingMinutes: 1 },
    });

    const ed = (await app.inject({ url: `/editions/${editionIds[1]}?leadParagraphs=2`, headers: AUTH })).json();
    const l = ed.articles.find((a: { title: string }) => a.title === 'lead');
    // Images are dropped from the excerpt; the cut is by paragraph count.
    expect(l.excerpt).toEqual([
      { type: 'paragraph', text: 'One.' },
      { type: 'heading', level: 2, text: 'Sub' },
      { type: 'paragraph', text: 'Two.' },
    ]);
    expect(ed.articles.filter((a: { excerpt: unknown }) => a.excerpt).length).toBe(1);
  });

  it('GET /articles/:id returns the full content and the matching source snapshot', async () => {
    const lead = await prisma.article.findFirstOrThrow({ where: { title: 'lead' } });
    await prisma.sourceSnapshot.create({
      data: {
        agentRunId: lead.agentRunId,
        sourceType: 'rss',
        sourceName: 'Example',
        url: 'https://www.example.com/lead/',
        title: 'Original title',
        publishedAt: new Date('2026-10-17T05:00:00Z'),
      },
    });
    const a = (await app.inject({ url: `/articles/${lead.id}`, headers: AUTH })).json();
    expect(a.content.blocks).toHaveLength(5);
    expect(a.run.model).toBe('claude-haiku-4-5');
    expect(a.sources).toHaveLength(1);
    expect(a.sources[0]).toMatchObject({ title: 'Original title', sourceType: 'rss' });
  });
});

describe('on-demand content and media', () => {
  const net = useFakeNet({
    'https://magazin.example/ki/modell': { headers: { 'content-type': 'text/html' }, body: readFileSync(resolve(import.meta.dirname, 'fixtures/article.html'), 'utf8') },
    'https://magazin.example/img/chart.png': { headers: { 'content-type': 'image/png' }, body: PNG },
    'https://magazin.example/img/hero-large.jpg': { headers: { 'content-type': 'image/png' }, body: PNG },
  });

  it('POST /articles/:id/content fetches lazily, caches, and returns blocks', async () => {
    const a = await prisma.article.create({
      data: { agentRunId: editionIds[0]!, title: 'lazy', summary: 's', sourceUrl: 'https://magazin.example/ki/modell', importance: 3 },
    });
    expect((await app.inject({ method: 'POST', url: `/articles/${a.id}/content` })).statusCode).toBe(401);

    const res = await app.inject({ method: 'POST', url: `/articles/${a.id}/content`, headers: AUTH });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.content.status).toBe('ok');
    expect(body.content.blocks.length).toBeGreaterThan(5);

    const calls = net.calls.length;
    await app.inject({ method: 'POST', url: `/articles/${a.id}/content`, headers: AUTH });
    expect(net.calls.length).toBe(calls);

    // Images are reachable through the API, with the token.
    const image = body.content.blocks.find((b: { type: string }) => b.type === 'image');
    expect((await app.inject({ url: `/media/${image.mediaId}` })).statusCode).toBe(401);
    const img = await app.inject({ url: `/media/${image.mediaId}`, headers: AUTH });
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect(img.rawPayload.equals(PNG)).toBe(true);
  });

  it('404s for unknown articles and malformed media ids', async () => {
    expect((await app.inject({ method: 'POST', url: '/articles/nope/content', headers: AUTH })).statusCode).toBe(404);
    expect((await app.inject({ url: '/media/..%2F..%2Fetc%2Fpasswd', headers: AUTH })).statusCode).toBe(404);
    expect((await app.inject({ url: `/media/${'f'.repeat(64)}`, headers: AUTH })).statusCode).toBe(404);
  });
});

describe('sources: preview and validation', () => {
  const feed = readFileSync(resolve(import.meta.dirname, 'fixtures/site/feed.xml'), 'utf8');
  const home = readFileSync(resolve(import.meta.dirname, 'fixtures/site/home-with-feed.html'), 'utf8');
  useFakeNet({
    'https://tech.example/robots.txt': { status: 404 },
    'https://tech.example/': { headers: { 'content-type': 'text/html' }, body: home },
    'https://tech.example/rss/alle.xml': { headers: { 'content-type': 'application/xml' }, body: feed },
  });

  const post = (url: string, payload: unknown) =>
    app.inject({ method: 'POST', url, headers: AUTH, payload: payload as object });

  it('previews a website source with method, counts and items', async () => {
    const res = await post('/sources/preview', {
      type: 'website',
      config: { url: 'tech.example', filter: { topic: 'KI' } },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ method: 'feed', candidates: 5, withoutDate: 1, filteredOut: 3 });
    expect(body.items).toEqual([
      expect.objectContaining({ title: 'Neues KI-Modell schlägt Konkurrenz', url: 'https://tech.example/artikel/ki-modell' }),
    ]);
  });

  it('rejects invalid configs with a readable message', async () => {
    const bad = await post('/sources/preview', { type: 'website', config: { url: 'tech.example', maxItems: 0 } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().message).toMatch(/maxItems/);
    const semantic = await post('/sources/preview', { type: 'website', config: { url: 'x', filter: { topic: 'KI', mode: 'semantic' } } });
    expect(semantic.json().message).toMatch(/semantic/);
  });

  it('does not preview paid sources', async () => {
    const res = await post('/sources/preview', { type: 'perplexity_search', config: { queries: ['x'] } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('preview_not_available');
  });

  it('requires auth', async () => {
    const res = await app.inject({ method: 'POST', url: '/sources/preview', payload: { type: 'website', config: { url: 'x' } } });
    expect(res.statusCode).toBe(401);
  });

  describe('PUT /agents/:slug/sources', () => {
    it('refuses an invalid website config and leaves the manifest untouched; saves a valid one', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'samix-agent-'));
      const manifest = 'id: x\nsources: []\n';
      writeFileSync(join(dir, 'manifest.yaml'), manifest);
      const skill = makeSkill();
      skill.skillMdPath = join(dir, 'SKILL.md');
      const local = await buildApp({ token: 'tok', logger, getSkills: () => [skill] });
      const put = (sources: unknown) =>
        local.inject({ method: 'PUT', url: `/agents/${skill.id}/sources`, headers: AUTH, payload: { sources } });

      const bad = await put([{ type: 'website', config: { url: 'tech.example', maxItems: 999 } }]);
      expect(bad.statusCode).toBe(400);
      expect(readFileSync(join(dir, 'manifest.yaml'), 'utf8')).toBe(manifest);

      const ok = await put([{ type: 'website', config: { url: 'tech.example', filter: { topic: 'KI' } } }]);
      expect(ok.statusCode).toBe(200);
      expect(readFileSync(join(dir, 'manifest.yaml'), 'utf8')).toContain('tech.example');
      expect(skill.manifest.sources?.[0]?.type).toBe('website');
    });
  });
});

describe('model choice', () => {
  const setup = async () => {
    const dir = mkdtempSync(join(tmpdir(), 'samix-model-'));
    writeFileSync(join(dir, 'manifest.yaml'), 'id: x\nmodel:\n  primary: claude-haiku-4-5\n  fallback: ollama-llama3\n');
    const skill = makeSkill();
    skill.skillMdPath = join(dir, 'SKILL.md');
    const local = await buildApp({ token: 'tok', logger, getSkills: () => [skill] });
    const put = (payload: unknown) =>
      local.inject({ method: 'PUT', url: `/agents/${skill.id}/model`, headers: AUTH, payload: payload as object });
    return { dir, skill, local, put };
  };

  it('lists usable models with key status, without the static test model', async () => {
    const prior = process.env.DEEPSEEK_API_KEY;
    process.env.DEEPSEEK_API_KEY = 'sk-x';
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const res = await app.inject({ url: '/models', headers: AUTH });
      const models = res.json() as { id: string; keyEnv: string | null; keyConfigured: boolean }[];
      const by = Object.fromEntries(models.map((m) => [m.id, m]));
      expect(by['static']).toBeUndefined();
      expect(by['deepseek-chat']).toMatchObject({ keyEnv: 'DEEPSEEK_API_KEY', keyConfigured: true });
      expect(by['claude-haiku-4-5']).toMatchObject({ keyEnv: 'ANTHROPIC_API_KEY', keyConfigured: false });
      expect(by['ollama-llama3']).toMatchObject({ keyEnv: null, keyConfigured: true });
    } finally {
      if (prior === undefined) delete process.env.DEEPSEEK_API_KEY;
      else process.env.DEEPSEEK_API_KEY = prior;
    }
  });

  it('switches the primary model, writes the manifest, and updates the running skill', async () => {
    const { dir, skill, put } = await setup();
    const res = await put({ primary: 'deepseek-chat', fallback: 'ollama-llama3' });
    expect(res.statusCode).toBe(200);
    const yaml = readFileSync(join(dir, 'manifest.yaml'), 'utf8');
    expect(yaml).toContain('primary: deepseek-chat');
    expect(yaml).toContain('id: x'); // untouched content survives
    expect(skill.manifest.model).toMatchObject({ primary: 'deepseek-chat', fallback: 'ollama-llama3' });
  });

  it('removes the fallback when null', async () => {
    const { dir, skill, put } = await setup();
    expect((await put({ primary: 'claude-haiku-4-5', fallback: null })).statusCode).toBe(200);
    expect(readFileSync(join(dir, 'manifest.yaml'), 'utf8')).not.toContain('fallback');
    expect(skill.manifest.model.fallback).toBeUndefined();
  });

  it('rejects unknown ids, ids without an adapter, and the test model — leaving the manifest alone', async () => {
    const { dir, put } = await setup();
    const before = readFileSync(join(dir, 'manifest.yaml'), 'utf8');
    for (const body of [{ primary: 'nonsense' }, { primary: 'gpt-4o-mini' }, { primary: 'static' }, { primary: 'deepseek-chat', fallback: 'gpt-4o-mini' }, {}]) {
      const res = await put(body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
    }
    expect(readFileSync(join(dir, 'manifest.yaml'), 'utf8')).toBe(before);
  });

  it('GET returns the current choice; 404 for unknown agents', async () => {
    const { skill, local } = await setup();
    const res = await local.inject({ url: `/agents/${skill.id}/model`, headers: AUTH });
    expect(res.json()).toMatchObject({ primary: 'claude-haiku-4-5' });
    expect((await local.inject({ url: '/agents/nope/model', headers: AUTH })).statusCode).toBe(404);
  });
});
