import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/db/prisma.js';
import { runAgent } from '../src/runner/runner.js';
import { logger } from '../src/logger.js';
import { registerFetcher, resolveFetcher } from '../src/sources/index.js';
import { PerplexitySearchFetcher, parsePerplexityConfig, perplexityDeps } from '../src/sources/perplexity.js';
import { focusOf } from '../src/skills/focus.js';
import { fakeAdapter, llmOutput, makeSkill, respond, seedAgent, useAdapter } from './helpers.js';
import { useFakeNet } from './net.js';

const page = (opts: { date?: string; desc?: string; title?: string } = {}) => ({
  headers: { 'content-type': 'text/html' },
  body: `<html><head><title>${opts.title ?? 'Seite'}</title>${opts.date ? `<meta property="article:published_time" content="${opts.date}">` : ''}${
    opts.desc ? `<meta property="og:description" content="${opts.desc}">` : ''
  }</head><body><article><p>${'Text '.repeat(60)}</p></article></body></html>`,
});

const routes: Record<string, ReturnType<typeof page>> = {
  'https://www.kicker.example/a': page({ date: '2026-10-19T07:00:00Z', desc: 'Der FC gewinnt 2:1.' }),
  'https://sport.example/b': page({ date: '2026-10-19T06:00:00Z' }),
  'https://undated.example/c': page({ desc: 'ohne Datum' }),
  'https://news.example/d': page({ date: '2026-10-18T10:00:00Z', desc: 'Tabelle nach dem Spieltag.' }),
};
const net = useFakeNet(routes);

const searchResponse = (urls: { url: string; title?: string; date?: string }[]) =>
  new Response(JSON.stringify({ search_results: urls }), { status: 200 });

let requests: { body: { messages: { content: string }[]; search_recency_filter?: string } }[];
const savedFetch = perplexityDeps.fetch;
beforeEach(() => {
  requests = [];
  vi.stubEnv('PERPLEXITY_API_KEY', 'pk');
});
afterEach(() => {
  perplexityDeps.fetch = savedFetch;
  vi.unstubAllEnvs();
});

function fakeSearch(responses: Response[]) {
  perplexityDeps.fetch = async (_url, init) => {
    requests.push({ body: JSON.parse(init.body as string) });
    return responses.shift() ?? new Response('{}', { status: 500 });
  };
}

const ctx = (over: Record<string, unknown> = {}) => ({ runId: 'r', logger, ...over });

describe('config', () => {
  it('needs a query or the topic, and rejects unknown keys', () => {
    expect(() => parsePerplexityConfig({})).toThrow(/at least one query/);
    expect(parsePerplexityConfig({ useTopic: true })).toMatchObject({ useTopic: true, queries: [] });
    expect(parsePerplexityConfig({ queries: ['Bundesliga'], recencyHours: 24 })).toMatchObject({ queries: ['Bundesliga'] });
    expect(() => parsePerplexityConfig({ queries: ['x'], model: 'other' })).toThrow();
  });

  it('reads the focus sentence out of a prompt', () => {
    expect(focusOf('Intro <!-- focus -->Fußball,\n  Bundesliga<!-- /focus --> rest')).toBe('Fußball, Bundesliga');
    expect(focusOf('no marker')).toBeUndefined();
  });
});

describe('PerplexitySearchFetcher', () => {
  it('searches the topic and the extra queries, reads each page for date and excerpt, and drops undated results', async () => {
    fakeSearch([
      searchResponse([
        { url: 'https://www.kicker.example/a', title: 'FC gewinnt' },
        { url: 'https://undated.example/c', title: 'Ohne Datum' },
        { url: 'https://sport.example/b', title: 'Pokal', date: '2026-10-17T12:00:00Z' },
      ]),
      searchResponse([{ url: 'https://kicker.example/a/' }, { url: 'https://news.example/d', title: 'Tabelle' }]),
    ]);
    const spent: number[] = [];

    const items = await new PerplexitySearchFetcher().fetch(
      { queries: ['Bundesliga Tabelle'], useTopic: true, recencyHours: 24 },
      ctx({ topic: 'Fußball-Spiele', spend: (usd: number) => spent.push(usd) })
    );

    expect(requests.map((r) => r.body.messages[1]!.content)).toEqual(['Bundesliga Tabelle', 'Fußball-Spiele']);
    expect(requests[0]!.body.search_recency_filter).toBe('day');
    // the same story under a slightly different URL is one item
    expect(items.map((i) => i.url)).toEqual(['https://www.kicker.example/a', 'https://sport.example/b', 'https://news.example/d']);
    expect(items[0]).toMatchObject({
      sourceName: 'kicker.example',
      snippet: 'Der FC gewinnt 2:1.',
      title: 'FC gewinnt',
      sourceType: 'perplexity_search',
      raw: { via: 'perplexity' },
    });
    expect(items[0]!.publishedAt?.toISOString()).toBe('2026-10-19T07:00:00.000Z');
    // Perplexity's own date wins over the page's; a page without any date is dropped
    expect(items[1]!.publishedAt?.toISOString()).toBe('2026-10-17T12:00:00.000Z');
    expect(items.find((i) => i.url.includes('undated'))).toBeUndefined();
    // each search is booked
    expect(spent).toEqual([0.01, 0.01]);
  });

  it('does not search when the budget says no, and fetches nothing', async () => {
    fakeSearch([searchResponse([{ url: 'https://sport.example/b' }])]);
    const items = await new PerplexitySearchFetcher().fetch({ queries: ['a', 'b'] }, ctx({ reserve: async () => false }));
    expect(items).toEqual([]);
    expect(requests).toHaveLength(0);
    expect(net.calls).toEqual([]);
  });

  it('books a search that was answered even if nothing usable came back, and nothing for a failed one', async () => {
    fakeSearch([new Response('rate limited', { status: 429 }), searchResponse([])]);
    const spent: number[] = [];
    await new PerplexitySearchFetcher().fetch({ queries: ['a', 'b'] }, ctx({ spend: (usd: number) => spent.push(usd) }));
    expect(spent).toEqual([0.01]);
  });

  it('uses a configurable price estimate and needs a key', async () => {
    vi.stubEnv('SAMIX_PERPLEXITY_COST_PER_SEARCH', '0.003');
    fakeSearch([searchResponse([])]);
    const spent: number[] = [];
    await new PerplexitySearchFetcher().fetch({ queries: ['a'] }, ctx({ spend: (usd: number) => spent.push(usd) }));
    expect(spent).toEqual([0.003]);
    vi.stubEnv('PERPLEXITY_API_KEY', '');
    await expect(new PerplexitySearchFetcher().fetch({ queries: ['a'] }, ctx())).rejects.toThrow(/PERPLEXITY_API_KEY/);
  });

  it('is registered for the runner', () => {
    expect(resolveFetcher('perplexity_search')).toBeInstanceOf(PerplexitySearchFetcher);
  });
});

describe('a run with a web search', () => {
  const six = Array.from({ length: 6 }, (_, i) => `https://s${i}.example/x`);
  for (const [i, u] of six.entries()) routes[u] = page({ date: `2026-10-19T0${i}:00:00Z`, desc: `Meldung ${i}` });

  function searchSkill(over: { dailyUsdMax?: number } = {}) {
    const s = makeSkill({ withSources: false, dailyUsdMax: over.dailyUsdMax });
    s.manifest.sources = [{ type: 'perplexity_search', config: { useTopic: true } }];
    // a Ressort created from the template stores its topic in the manifest (the prompt has no markers)
    s.manifest.topic = 'Fußball-Spiele';
    s.systemPrompt = 'Prompt matching this focus: "anderes"';
    return s;
  }

  it('books the searches to the ledger and the run next to the model cost, and writes traceable articles', async () => {
    registerFetcher('perplexity_search', () => new PerplexitySearchFetcher());
    fakeSearch([searchResponse(six.map((url) => ({ url, title: `T ${url}` })))]);
    useAdapter(fakeAdapter('claude-haiku-4-5', async () => respond(llmOutput(six.slice(0, 5)))));
    const skill = searchSkill();
    await seedAgent(skill);

    const result = await runAgent({ skill, trigger: 'manual', logger });

    expect(result.status).toBe('success');
    expect(requests[0]!.body.messages[1]!.content).toBe('Fußball-Spiele');
    // model: 1000 in + 500 out at 1/5 per million = 0.0035; one search = 0.01
    expect(result.costUsd).toBeCloseTo(0.0135, 6);
    const run = await prisma.agentRun.findUniqueOrThrow({ where: { id: result.runId } });
    expect(run.costUsd).toBeCloseTo(0.0135, 6);
    const ledger = await prisma.budgetLedger.findFirstOrThrow({ where: { agent: { slug: skill.id } } });
    expect(ledger.costUsd).toBeCloseTo(0.0135, 6);
    const rows = await prisma.article.findMany({ where: { agentRunId: result.runId } });
    expect(rows.map((r) => r.sourceName).sort()).toEqual(six.slice(0, 5).map((u) => new URL(u).hostname).sort());
  });

  it('skips the paid search when it would pass the agent\'s daily cap: no request, no model call, no cost', async () => {
    registerFetcher('perplexity_search', () => new PerplexitySearchFetcher());
    fakeSearch([searchResponse(six.map((url) => ({ url })))]);
    const model = fakeAdapter('claude-haiku-4-5', async () => respond(llmOutput(six.slice(0, 5))));
    useAdapter(model);
    // cap 0.01 $: one search (0.01) plus the model estimate would pass it
    const skill = searchSkill({ dailyUsdMax: 0.01 });
    await seedAgent(skill);

    const result = await runAgent({ skill, trigger: 'manual', logger });

    expect(result).toMatchObject({ status: 'failed', error: 'no_source_items', costUsd: 0 });
    expect(requests).toHaveLength(0);
    expect(model.generate).not.toHaveBeenCalled();
  });

  it('keeps the cost of a search that found nothing usable, on the failed run too', async () => {
    registerFetcher('perplexity_search', () => new PerplexitySearchFetcher());
    fakeSearch([searchResponse([{ url: 'https://undated.example/c' }])]);
    const skill = searchSkill();
    await seedAgent(skill);

    const result = await runAgent({ skill, trigger: 'manual', logger });

    expect(result).toMatchObject({ status: 'failed', error: 'no_source_items' });
    expect(result.costUsd).toBeCloseTo(0.01, 6);
    expect((await prisma.agentRun.findUniqueOrThrow({ where: { id: result.runId } })).costUsd).toBeCloseTo(0.01, 6);
  });
});
