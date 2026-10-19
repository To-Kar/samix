import { beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { registerAdapter } from '../src/adapters/index.js';
import { prisma } from '../src/db/prisma.js';
import { logger } from '../src/logger.js';
import { routeQuestion } from '../src/runner/orchestrate.js';
import type { ModelAdapter, Skill } from '../src/types.js';
import { calling, fakeAdapter, finalAnswer, makeSkill, reactiveSkill, respond, scripted, seedAgent, toolCall } from './helpers.js';

const AUTH = { authorization: 'Bearer tok' };
const ids: Record<string, string> = {};

// The orchestrator's model is 'deepseek-chat'; the delegate answers with 'claude-haiku-4-5'.
function orchestrator(over: { dailyUsdMax?: number; routes?: ('delegate' | 'show_notes' | 'propose_refresh')[] } = {}): Skill {
  const s = makeSkill({ withSources: false, withSchema: false, primary: 'deepseek-chat', dailyUsdMax: over.dailyUsdMax });
  s.type = 'reactive';
  s.manifest.type = 'reactive';
  s.manifest.sources = undefined;
  s.manifest.routes = over.routes ?? ['delegate', 'show_notes', 'propose_refresh'];
  s.manifest.output = { format: 'route' };
  return s;
}

interface World {
  orch: Skill;
  qa: Skill;
  news: Skill;
  skills: Skill[];
  router: ReturnType<typeof scripted>;
  qaModel: ReturnType<typeof scripted>;
  newsModel: ReturnType<typeof scripted>;
}

type Steps = Parameters<typeof scripted>[0];

// `routerSteps` may be a function of the world, for steps that need the agents' generated ids.
async function world(
  routerSteps: Steps | ((w: World) => Steps),
  qaSteps: Parameters<typeof scripted>[0] = [() => calling(toolCall('search_articles', { query: 'Chip' })), () => finalAnswer('Doppelt so schnell [1].', [ids.chip!])],
  over: Parameters<typeof orchestrator>[0] = {}
): Promise<World> {
  const orch = orchestrator(over);
  const qa = reactiveSkill();
  const news = makeSkill();
  news.title = 'Chip';
  orch.manifest.delegates = [qa.id];
  const ref = {} as World;
  const router = scripted(typeof routerSteps === 'function' ? routerSteps(ref) : routerSteps, { name: 'deepseek-chat' });
  const qaModel = scripted(qaSteps);
  // a proactive Ressort whose model must never be called by routing
  const newsModel = scripted([() => respond('{}')], { name: 'claude-haiku-4-5' });
  for (const s of [orch, qa, news]) await seedAgent(s);
  registerAdapter('deepseek-chat', () => router.adapter);
  registerAdapter('claude-haiku-4-5', () => qaModel.adapter);
  return Object.assign(ref, { orch, qa, news, skills: [orch, qa, news], router, qaModel, newsModel });
}

const ask = (w: World, question: string, conversationId?: string) =>
  routeQuestion({ skill: w.orch, question, conversationId, skills: w.skills });
const route = (name: string, input: unknown) => () => calling(toolCall(name, input));

beforeAll(async () => {
  const seed = makeSkill();
  const agentId = await seedAgent(seed);
  const run = await prisma.agentRun.create({ data: { agentId, status: 'success', trigger: 'manual' } });
  const a = await prisma.article.create({
    data: { agentRunId: run.id, title: 'Neuer KI-Chip vorgestellt', summary: 'Der Chip ist doppelt so schnell.', sourceUrl: 'https://example.com/chip', sourceName: 'Example', publishedAt: new Date('2026-10-18T08:00:00Z') },
  });
  ids.chip = a.id;
});

describe('routeQuestion: delegate', () => {
  it('hands the question to the delegate and shows its checked answer; the router speaks once', async () => {
    const w = await world((w) => [() => calling(toolCall('delegate', { agent: w.qa.id, question: 'Was gab es zu Chips?' }))]);

    const r = await ask(w, 'Chips?');

    expect(r).toMatchObject({ status: 'success', answer: 'Doppelt so schnell [1].', route: { kind: 'delegate', agent: w.qa.id }, proposals: [] });
    expect(r.citations).toMatchObject([{ number: 1, articleId: ids.chip }]);
    expect(w.router.adapter.generate).toHaveBeenCalledTimes(1);
    expect(w.router.requests[0]!.tools?.map((t) => t.name)).toEqual(['delegate', 'show_notes', 'propose_refresh']);

    // the delegate asked the model-formulated question, in its own AgentRun, without its own conversation
    expect(w.qaModel.requests[0]!.messages.at(0)).toMatchObject({ role: 'user', content: 'Was gab es zu Chips?' });
    const subRun = await prisma.agentRun.findUniqueOrThrow({ where: { id: r.delegateRunId! }, include: { agent: true } });
    expect(subRun.agent.slug).toBe(w.qa.id);
    expect(await prisma.conversation.count({ where: { agent: { slug: w.qa.id } } })).toBe(0);

    // costs: each agent's own ledger, the answer shows the sum
    const own = await prisma.agentRun.findUniqueOrThrow({ where: { id: r.runId } });
    expect(own.costUsd).toBeCloseTo(0.0035, 6);
    expect(subRun.costUsd).toBeCloseTo(2 * 0.0035, 6);
    expect(r.costUsd).toBeCloseTo(3 * 0.0035, 6);
    const orchLedger = await prisma.budgetLedger.findFirstOrThrow({ where: { agent: { slug: w.orch.id } } });
    expect(orchLedger.costUsd).toBeCloseTo(0.0035, 6);

    // the conversation belongs to the orchestrator and carries the delegate's steps in the trace
    const msgs = await prisma.conversationMessage.findMany({ where: { conversationId: r.conversationId! }, orderBy: { createdAt: 'asc' } });
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(r.trace.map((t) => t.tool)).toEqual(['route:delegate', `${w.qa.id} › search_articles`]);
  });

  it('only delegates to agents the manifest lists; a wrong pick is sent back to the model once', async () => {
    const w = await world((w) => [
      () => calling(toolCall('delegate', { agent: 'some-other-agent', question: 'x' })),
      () => calling(toolCall('delegate', { agent: w.qa.id, question: 'Chips?' })),
    ]);

    const r = await ask(w, 'Chips?');

    expect(r.status).toBe('success');
    expect(w.router.adapter.generate).toHaveBeenCalledTimes(2);
    const retry = w.router.requests[1]!.messages.at(-1);
    expect(retry).toMatchObject({ role: 'tool', isError: true, content: expect.stringContaining('not allowed') });

    // ... and a router that keeps picking wrongly ends without an action
    const w2 = await world([route('delegate', { agent: 'some-other-agent', question: 'x' })]);
    expect(await ask(w2, 'Chips?')).toMatchObject({ status: 'partial', error: 'no_route' });
    expect(w2.qaModel.adapter.generate).not.toHaveBeenCalled();
  });

  it("passes the conversation's earlier turns to the delegate and keeps the delegate's failure as it is", async () => {
    const w = await world(
      (w) => [() => calling(toolCall('delegate', { agent: w.qa.id, question: 'Und die Akkus?' }))],
      [() => calling(toolCall('search_articles', { query: 'Chip' })), () => finalAnswer('Erste Antwort [1].', [ids.chip!]), () => calling(toolCall('search_articles', { query: 'Chip' })), () => finalAnswer('Aus dem Kopf.', ['invented'])]
    );

    const first = await ask(w, 'Was gab es zu Chips?');
    expect(first.status).toBe('success');
    const second = await ask(w, 'Und die Akkus?', first.conversationId!);

    // second routing call saw the first turn; so did the delegate
    expect(w.router.requests[1]!.messages.map((m) => m.content)).toEqual(['Was gab es zu Chips?', 'Erste Antwort [1].', 'Und die Akkus?']);
    expect(w.qaModel.requests[2]!.messages.map((m) => m.content)).toEqual(['Was gab es zu Chips?', 'Erste Antwort [1].', 'Und die Akkus?']);
    // the delegate's own refusal to show an unbacked answer passes through
    expect(second).toMatchObject({ status: 'partial', error: 'no_valid_citations' });
    expect(second.answer).toBeUndefined();
  });

  it('a delegate that is over its own budget fails the question, the routing call is still booked', async () => {
    const w = await world((w) => [() => calling(toolCall('delegate', { agent: w.qa.id, question: 'Chips?' }))]);
    const qaRow = await prisma.agent.findUniqueOrThrow({ where: { slug: w.qa.id } });
    await prisma.budgetLedger.create({ data: { agentId: qaRow.id, period: new Date(Math.floor(Date.now() / 86_400_000) * 86_400_000), costUsd: 0.6 } });

    const r = await ask(w, 'Chips?');

    expect(r).toMatchObject({ status: 'failed', error: 'budget_exceeded' });
    expect(w.qaModel.adapter.generate).not.toHaveBeenCalled();
    expect(r.costUsd).toBeCloseTo(0.0035, 6);
  });
});

describe('routeQuestion: choosing exactly one action', () => {
  it('reminds a router that answers with text once, then ends without an action and without showing its text', async () => {
    const w = await world([() => respond('Das mache ich gern!')]);
    const r = await ask(w, 'Hallo?');
    expect(r).toMatchObject({ status: 'partial', error: 'no_route' });
    expect(r.answer).toBeUndefined();
    expect(w.router.adapter.generate).toHaveBeenCalledTimes(2);
    expect(w.router.requests[1]!.messages.at(-1)).toMatchObject({ role: 'user', content: expect.stringContaining('genau eine Aktion') });

    const ok = await world([() => respond('Moment'), route('show_notes', {})]);
    expect((await ask(ok, 'Notizen?')).status).toBe('success');
  });

  it('runs only the first of several actions', async () => {
    await prisma.memoryNote.deleteMany();
    const w = await world([() => calling(toolCall('show_notes', {}), toolCall('propose_refresh', { ressort: 'x' }))]);
    const r = await ask(w, 'Notizen und Update?');
    expect(r.route).toEqual({ kind: 'show_notes' });
    expect(r.proposals).toEqual([]);
    expect(r.trace.map((t) => t.tool)).toEqual(['route:show_notes', 'route:ignored']);
  });

  it('offers only the actions the manifest allows', async () => {
    const w = await world([route('show_notes', {})], undefined, { routes: ['show_notes'] });
    await ask(w, 'Notizen?');
    expect(w.router.requests[0]!.tools?.map((t) => t.name)).toEqual(['show_notes']);
    // a call to an action that was not offered is rejected
    const w2 = await world([route('propose_refresh', { ressort: 'x' })], undefined, { routes: ['show_notes'] });
    expect(await ask(w2, 'Update?')).toMatchObject({ status: 'partial', error: 'no_route' });
  });
});

describe('routeQuestion: notes and refresh proposals', () => {
  it('show_notes lists the notes from the core, with no second model call', async () => {
    await prisma.memoryNote.deleteMany();
    await prisma.memoryNote.createMany({ data: [{ text: 'Ich verfolge Rust' }, { text: 'Keine Krypto' }] });
    const w = await world([route('show_notes', {})]);
    const r = await ask(w, 'Was hast du dir gemerkt?');
    expect(r.answer).toContain('• Ich verfolge Rust');
    expect(r.answer).toContain('• Keine Krypto');
    expect(w.router.adapter.generate).toHaveBeenCalledTimes(1);
    expect(w.qaModel.adapter.generate).not.toHaveBeenCalled();

    await prisma.memoryNote.deleteMany();
    expect((await ask(await world([route('show_notes', {})]), 'Notizen?')).answer).toBe('Es sind noch keine Notizen gespeichert.');
  });

  it('propose_refresh only proposes: no run of the Ressort starts', async () => {
    const w = await world((w) => [() => calling(toolCall('propose_refresh', { ressort: w.news.id }))]);
    const before = await prisma.agentRun.count({ where: { agent: { slug: w.news.id } } });

    const r = await ask(w, 'Aktualisiere Chip');

    expect(r).toMatchObject({ status: 'success', route: { kind: 'propose_refresh' }, proposals: [{ kind: 'refresh', ressort: w.news.id, title: 'Chip' }] });
    expect(await prisma.agentRun.count({ where: { agent: { slug: w.news.id } } })).toBe(before);
    expect(w.newsModel.adapter.generate).not.toHaveBeenCalled();
  });

  it('an unknown or switched-off Ressort is an error, not a proposal', async () => {
    const w = await world([route('propose_refresh', { ressort: 'gibt-es-nicht' })]);
    expect(await ask(w, 'Aktualisiere')).toMatchObject({ status: 'failed', error: 'unknown_ressort', proposals: [] });

    const w2 = await world((w) => [() => calling(toolCall('propose_refresh', { ressort: w.news.id }))]);
    await prisma.agent.update({ where: { slug: w2.news.id }, data: { enabled: false } });
    expect(await ask(w2, 'Aktualisiere')).toMatchObject({ status: 'failed', error: 'unknown_ressort' });
  });
});

describe('routeQuestion: gates', () => {
  it('checks the budget before the routing call', async () => {
    const w = await world([route('show_notes', {})], undefined, { dailyUsdMax: 0.001 });
    const row = await prisma.agent.findUniqueOrThrow({ where: { slug: w.orch.id } });
    await prisma.budgetLedger.create({ data: { agentId: row.id, period: new Date(Math.floor(Date.now() / 86_400_000) * 86_400_000), costUsd: 0.5 } });
    expect(await ask(w, 'Notizen?')).toMatchObject({ status: 'failed', error: 'budget_exceeded' });
    expect(w.router.adapter.generate).not.toHaveBeenCalled();
  });

  it('refuses a model without tools, a disabled orchestrator and a second question at once', async () => {
    const w = await world([route('show_notes', {})]);
    w.router.adapter.supportsTools = false;
    expect(await ask(w, 'Notizen?')).toMatchObject({ status: 'failed', error: 'model_without_tools' });
    expect(w.router.adapter.generate).not.toHaveBeenCalled();
    expect(await prisma.conversation.count({ where: { agent: { slug: w.orch.id } } })).toBe(0);

    w.router.adapter.supportsTools = true;
    await prisma.agent.update({ where: { slug: w.orch.id }, data: { enabled: false } });
    expect(await ask(w, 'Notizen?')).toMatchObject({ status: 'failed', error: 'agent_disabled' });
    await prisma.agent.update({ where: { slug: w.orch.id }, data: { enabled: true } });

    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    w.router.adapter.generate.mockImplementation(async () => {
      await gate;
      return calling(toolCall('show_notes', {}));
    });
    const first = ask(w, 'Notizen?');
    await new Promise((r) => setTimeout(r, 20));
    expect(await ask(w, 'Noch eine')).toMatchObject({ error: 'already_running' });
    release();
    expect((await first).status).toBe('success');
  });

  it('refuses an orchestrator that offers no action', async () => {
    const w = await world([route('show_notes', {})], undefined, { routes: ['delegate'] });
    w.orch.manifest.delegates = ['nobody'];
    expect(await ask(w, 'Hallo')).toMatchObject({ status: 'failed', error: 'invalid_routes' });
  });
});

describe('POST /ask goes through the orchestrator', () => {
  it('uses it by default and reports route and total cost; falls back to the Q&A agent when there is none', async () => {
    const w = await world((w) => [() => calling(toolCall('delegate', { agent: w.qa.id, question: 'Chips?' }))]);
    w.orch.id = 'orchestrator';
    w.orch.manifest.id = 'orchestrator';
    await seedAgent(w.orch);
    const app = await buildApp({ token: 'tok', logger, getSkills: () => w.skills });

    const res = await app.inject({ method: 'POST', url: '/ask', headers: AUTH, payload: { question: 'Chips?' } });
    const body = res.json();
    expect(body).toMatchObject({ status: 'success', route: { kind: 'delegate', agent: w.qa.id } });

    const conv = (await app.inject({ method: 'GET', url: `/conversations/${body.conversationId}`, headers: AUTH })).json();
    expect(conv.agent).toBe('orchestrator');
    expect(conv.messages[1]).toMatchObject({ route: { kind: 'delegate' }, proposals: [], citations: [{ number: 1 }] });
    expect(conv.messages[1].costUsd).toBeCloseTo(body.costUsd, 6);
    expect(conv.messages[1].trace.map((t: { tool: string }) => t.tool)).toContain(`${w.qa.id} › search_articles`);

    // no orchestrator among the skills: the question goes straight to the Q&A agent
    const direct = await buildApp({ token: 'tok', logger, getSkills: () => [w.qa] });
    w.qa.id = 'frag-die-zeitung';
    w.qa.manifest.id = 'frag-die-zeitung';
    await seedAgent(w.qa);
    const fresh = scripted([() => calling(toolCall('search_articles', { query: 'Chip' })), () => finalAnswer('Direkt [1].', [ids.chip!])]);
    registerAdapter('claude-haiku-4-5', () => fresh.adapter);
    const res2 = await direct.inject({ method: 'POST', url: '/ask', headers: AUTH, payload: { question: 'Chips?' } });
    expect(res2.json()).toMatchObject({ status: 'success' });
    expect(res2.json().route).toBeUndefined();
  });
});
