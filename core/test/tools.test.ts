import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { prisma } from '../src/db/prisma.js';
import { executeTool, knownToolNames, resolveTools } from '../src/tools/index.js';
import type { ToolContext } from '../src/tools/types.js';
import { logger } from '../src/logger.js';
import { makeSkill, seedAgent } from './helpers.js';
import { useFakeNet } from './net.js';
import type { Skill } from '../src/types.js';

const HTML = readFileSync(resolve(import.meta.dirname, 'fixtures/article.html'), 'utf8');
const net = useFakeNet({
  'https://magazin.example/ki/modell': { headers: { 'content-type': 'text/html' }, body: HTML },
  'https://magazin.example/img/chart.png': { status: 404 },
  'https://magazin.example/img/hero-large.jpg': { status: 404 },
});

let tech: Skill;
let chip: Skill;
const ids: Record<string, string> = {};

async function article(agentId: string, key: string, data: { title: string; summary: string; topic?: string; at: string; url?: string }) {
  const run = await prisma.agentRun.create({ data: { agentId, status: 'success', trigger: 'manual' } });
  const a = await prisma.article.create({
    data: {
      agentRunId: run.id,
      title: data.title,
      summary: data.summary,
      topic: data.topic,
      sourceUrl: data.url ?? `https://example.com/${key}`,
      sourceName: 'Example',
      publishedAt: new Date(data.at),
      createdAt: new Date(data.at),
    },
  });
  ids[key] = a.id;
  return a;
}

const ctx = (): ToolContext => ({ logger, skills: [tech, chip], allowance: { fullTextFetches: 3 } });
const tools = () => resolveTools(knownToolNames());
const call = (name: string, input: unknown, c = ctx()) =>
  executeTool({ id: 'x', name, input }, tools(), c);
const parse = (r: { content: string }) => JSON.parse(r.content);

beforeAll(async () => {
  tech = makeSkill();
  tech.title = 'Tech & KI';
  chip = makeSkill();
  chip.title = 'Chip';
  const techId = await seedAgent(tech);
  const chipId = await seedAgent(chip);

  await article(techId, 'oss', { title: 'Offenes Sprachmodell schlägt Benchmark', summary: 'Ein Modell mit offenen Gewichten.', topic: 'Forschung', at: '2026-10-18T08:00:00Z' });
  await article(techId, 'ki-chip', { title: 'KI-Chips: Rekordumsatz', summary: 'Rechenzentren treiben das Geschäft.', topic: 'Industrie', at: '2026-10-10T08:00:00Z' });
  await article(techId, 'ski', { title: 'Skiing-Saison beginnt', summary: 'Neuschnee in Kiel erwartet.', at: '2026-10-17T08:00:00Z' });
  await article(chipId, 'phone', { title: 'Smartphone-Kamera mit KI im Test', summary: 'Fünf Tipps für bessere Fotos.', topic: 'Ratgeber', at: '2026-10-16T08:00:00Z' });
  await article(chipId, 'body-only', { title: 'Grafikkarte im Test', summary: 'Neue Chips.', at: '2026-10-15T08:00:00Z', url: 'https://magazin.example/ki/modell' });
  await prisma.articleContent.create({
    data: {
      articleId: ids['body-only']!,
      status: 'ok',
      blocks: JSON.stringify([{ type: 'paragraph', text: 'Der Hersteller setzt auf Quantenkühlung statt Lüfter.' }, { type: 'paragraph', text: 'x'.repeat(6000) }]),
      wordCount: 900,
    },
  });
});

describe('search_articles', () => {
  it('finds whole words only: "KI" matches KI-Chips and the phone test, not Skiing or Kiel', async () => {
    const r = parse(await call('search_articles', { query: 'KI' }));
    expect(r.map((x: { articleId: string }) => x.articleId).sort()).toEqual([ids['ki-chip'], ids['phone']].sort());
  });

  it('ranks title hits above summary hits, all words above one, then newest first', async () => {
    const r = parse(await call('search_articles', { query: 'offenes Modell' }));
    expect(r[0]).toMatchObject({ articleId: ids['oss'], ressort: 'Tech & KI' });
    // title has "offenes", the summary has "Modell": both words found, so it outranks single-word hits
    expect(r[0].matched).toEqual(['offenes', 'modell']);
  });

  it('searches cached full texts too, and says so', async () => {
    const r = parse(await call('search_articles', { query: 'Quantenkühlung' }));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ articleId: ids['body-only'], hasFullText: true });
  });

  it('filters by Ressort and by date', async () => {
    const onlyChip = parse(await call('search_articles', { query: 'Test', ressort: chip.id }));
    expect(onlyChip.every((x: { ressort: string }) => x.ressort === 'Chip')).toBe(true);
    const recent = parse(await call('search_articles', { query: 'KI', since: '2026-10-15' }));
    expect(recent.map((x: { articleId: string }) => x.articleId)).toEqual([ids['phone']]);
  });

  it('caps the number of results', async () => {
    const r = parse(await call('search_articles', { query: 'Test KI Modell Chips Neuschnee', limit: 2 }));
    expect(r).toHaveLength(2);
  });

  it('says plainly when nothing matches', async () => {
    const res = await call('search_articles', { query: 'Raumfahrt' });
    expect(parse(res).note).toMatch(/no matching/);
    expect(res.articleIds).toEqual([]);
  });

  it('reports the surfaced article ids (the only ones an answer may cite)', async () => {
    const res = await call('search_articles', { query: 'KI' });
    expect(res.articleIds.sort()).toEqual([ids['ki-chip'], ids['phone']].sort());
    expect(res.resultCount).toBe(2);
  });

  it('truncates long summaries', async () => {
    const techId = (await prisma.agent.findUniqueOrThrow({ where: { slug: tech.id } })).id;
    await article(techId, 'long', { title: 'Lange Meldung', summary: 'Wort '.repeat(200), at: '2026-10-19T08:00:00Z' });
    const r = parse(await call('search_articles', { query: 'Lange' }));
    expect(r[0].summary.length).toBeLessThanOrEqual(280);
  });
});

describe('get_article', () => {
  it('returns details and never goes online', async () => {
    net.calls.length = 0;
    const r = parse(await call('get_article', { articleId: ids['oss'] }));
    expect(r).toMatchObject({ title: 'Offenes Sprachmodell schlägt Benchmark', source: 'Example', fullText: null, fullTextStatus: 'not fetched yet' });
    expect(net.calls).toEqual([]);
  });

  it('includes the start of a cached full text, truncated to maxChars', async () => {
    const r = parse(await call('get_article', { articleId: ids['body-only'], maxChars: 800 }));
    expect(r.fullText.startsWith('Der Hersteller setzt auf Quantenkühlung')).toBe(true);
    expect(r.fullText.length).toBeLessThanOrEqual(800);
    expect(r.fullTextTruncated).toBe(true);
    expect(r.fullTextStatus).toBe('available');
  });

  it('errors for an unknown id, without throwing', async () => {
    const res = await call('get_article', { articleId: 'nope' });
    expect(res.isError).toBe(true);
    expect(parse(res).error).toMatch(/no article with id/);
  });
});

describe('fetch_full_text', () => {
  it('takes an articleId (never a URL), downloads via the safe fetcher and counts against the allowance', async () => {
    const c = ctx();
    net.calls.length = 0;
    const r = parse(await call('fetch_full_text', { articleId: ids['ski'] }, c)); // https://example.com/ski → 404 in the fake net
    expect(r.fullTextStatus).toMatch(/unavailable/);
    expect(net.calls).toEqual(['https://example.com/ski']);
    expect(c.allowance.fullTextFetches).toBe(2);
  });

  it('stops after the allowance is used up', async () => {
    const c = ctx();
    c.allowance.fullTextFetches = 1;
    await call('fetch_full_text', { articleId: ids['ski'], maxChars: 500 }, c);
    net.calls.length = 0;
    const res = await call('fetch_full_text', { articleId: ids['phone'] }, c);
    expect(res.isError).toBe(true);
    expect(parse(res).error).toMatch(/limit/);
    expect(net.calls).toEqual([]);
  });

  it('does not accept a URL in place of an id', async () => {
    net.calls.length = 0;
    const res = await call('fetch_full_text', { articleId: 'https://evil.example/steal' });
    expect(res.isError).toBe(true);
    expect(net.calls).toEqual([]);
  });
});

describe('list_ressorts', () => {
  it('lists the sections with titles and article counts', async () => {
    const r = parse(await call('list_ressorts', {}));
    const t = r.find((x: { id: string }) => x.id === tech.id);
    expect(t).toMatchObject({ title: 'Tech & KI' });
    expect(t.articles).toBeGreaterThanOrEqual(3);
  });
});

describe('executeTool never throws', () => {
  it('unknown tool, bad arguments, malformed arguments', async () => {
    const unknown = await executeTool({ id: '1', name: 'rm_rf', input: {} }, tools(), ctx());
    expect(parse(unknown).error).toMatch(/unknown tool "rm_rf".*available: .*search_articles/);

    for (const input of [{}, { query: '' }, { query: 'x'.repeat(201) }, { query: 'ok', limit: 99 }, { query: 'ok', since: 'tomorrow-ish' }, 'not an object']) {
      const r = await call('search_articles', input);
      expect(r.isError, JSON.stringify(input)).toBe(true);
      expect(parse(r).error).toMatch(/invalid arguments/);
    }

    const malformed = await executeTool({ id: '2', name: 'search_articles', input: undefined, parseError: 'arguments are not valid JSON' }, tools(), ctx());
    expect(parse(malformed).error).toMatch(/not valid JSON.*JSON object/);
  });

  it('an exception inside a tool becomes an error result, without leaking the message', async () => {
    const boom = {
      spec: { name: 'boom', description: 'always fails', inputSchema: { type: 'object' } },
      input: z.object({}),
      run: async () => {
        throw new Error('secret internal detail: /home/user/db');
      },
    };
    const res = await executeTool({ id: '1', name: 'boom', input: {} }, [boom as never], ctx());
    expect(res.isError).toBe(true);
    expect(res.content).not.toContain('secret internal detail');
    expect(parse(res).error).toMatch(/the tool failed/);
  });

  it('a query without searchable words is an error result', async () => {
    const r = await call('search_articles', { query: '!!! ?' });
    expect(r.isError).toBe(true);
  });

  it('resolveTools rejects names it does not know', () => {
    expect(() => resolveTools(['search_articles', 'delete_everything'])).toThrow(/unknown tool "delete_everything"/);
  });
});
