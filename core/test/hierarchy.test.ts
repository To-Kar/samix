import { beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { registerAdapter } from '../src/adapters/index.js';
import { prisma } from '../src/db/prisma.js';
import { logger } from '../src/logger.js';
import { BudgetEnvelope, envelopeFor } from '../src/runner/budget.js';
import { routeQuestion } from '../src/runner/orchestrate.js';
import { MAX_DELEGATION_DEPTH, validateDelegation } from '../src/skills/hierarchy.js';
import type { ModelId, Skill } from '../src/types.js';
import { calling, finalAnswer, makeSkill, reactiveSkill, scripted, seedAgent, toolCall } from './helpers.js';

const AUTH = { authorization: 'Bearer tok' };
const ids: Record<string, string> = {};

// One call at the fake price (1 in, 5 out per million) with 1000 in / 500 out tokens.
const CALL = 0.0035;

function router(primary: ModelId, delegates: string[], routes: ('delegate' | 'show_notes' | 'propose_refresh')[] = ['delegate']): Skill {
  const s = makeSkill({ withSources: false, withSchema: false, primary });
  s.type = 'reactive';
  s.manifest.type = 'reactive';
  s.manifest.sources = undefined;
  s.manifest.routes = routes;
  s.manifest.delegates = delegates;
  s.manifest.output = { format: 'route' };
  s.manifest.budget.tokensPerRunMax = 600;
  return s;
}

function leaf(): Skill {
  const s = reactiveSkill();
  s.manifest.budget.tokensPerRunMax = 2000;
  return s;
}

interface Tree {
  root: Skill;
  desk: Skill;
  qa: Skill;
  skills: Skill[];
  rootModel: ReturnType<typeof scripted>;
  deskModel: ReturnType<typeof scripted>;
  qaModel: ReturnType<typeof scripted>;
}

// root (Eingang) → desk (Wissens-Desk) → qa (Frag deine Zeitung), each with its own scripted model.
async function tree(over: { rootCap?: number; deskCap?: number } = {}): Promise<Tree> {
  const qa = leaf();
  const desk = router('gpt-4o-mini', [qa.id]);
  const root = router('deepseek-chat', [desk.id], ['delegate', 'propose_refresh']);
  root.manifest.budget.questionUsdMax = over.rootCap;
  desk.manifest.budget.questionUsdMax = over.deskCap;
  const rootModel = scripted([() => calling(toolCall('delegate', { agent: desk.id, question: 'Was gab es zu Chips?' }))], { name: 'deepseek-chat' });
  const deskModel = scripted([() => calling(toolCall('delegate', { agent: qa.id, question: 'Chips?' }))], { name: 'gpt-4o-mini' });
  const qaModel = scripted([() => calling(toolCall('search_articles', { query: 'Chip' })), () => finalAnswer('Doppelt so schnell [1].', [ids.chip!])]);
  for (const s of [root, desk, qa]) await seedAgent(s);
  registerAdapter('deepseek-chat', () => rootModel.adapter);
  registerAdapter('gpt-4o-mini', () => deskModel.adapter);
  registerAdapter('claude-haiku-4-5', () => qaModel.adapter);
  return { root, desk, qa, skills: [root, desk, qa], rootModel, deskModel, qaModel };
}

const ask = (t: Tree, question = 'Chips?') => routeQuestion({ skill: t.root, question, skills: t.skills });

beforeAll(async () => {
  const agentId = await seedAgent(makeSkill());
  const run = await prisma.agentRun.create({ data: { agentId, status: 'success', trigger: 'manual' } });
  const a = await prisma.article.create({
    data: { agentRunId: run.id, title: 'Neuer KI-Chip vorgestellt', summary: 'Der Chip ist doppelt so schnell.', sourceUrl: 'https://example.com/chip', sourceName: 'Example', publishedAt: new Date('2026-10-18T08:00:00Z') },
  });
  ids.chip = a.id;
});

describe('three levels', () => {
  it('passes the question down two routers and shows the checked answer of the one at the bottom', async () => {
    const t = await tree();

    const r = await ask(t);

    expect(r).toMatchObject({ status: 'success', answer: 'Doppelt so schnell [1].', route: { kind: 'delegate', agent: t.desk.id, path: [t.desk.id, t.qa.id] } });
    expect(r.citations).toMatchObject([{ number: 1, articleId: ids.chip }]);
    expect(t.rootModel.adapter.generate).toHaveBeenCalledTimes(1);
    expect(t.deskModel.adapter.generate).toHaveBeenCalledTimes(1);
    expect(t.qaModel.adapter.generate).toHaveBeenCalledTimes(2);
    // each router saw the self-contained question its parent wrote, not the reader's words
    expect(t.deskModel.requests[0]!.messages.at(-1)).toMatchObject({ content: 'Was gab es zu Chips?' });
    expect(t.qaModel.requests[0]!.messages.at(-1)).toMatchObject({ content: 'Chips?' });

    // runs hang under each other
    const runs = await prisma.agentRun.findMany({ where: { agent: { slug: { in: [t.root.id, t.desk.id, t.qa.id] } } }, include: { agent: true } });
    const by = Object.fromEntries(runs.map((x) => [x.agent.slug, x]));
    expect(by[t.root.id]!.parentRunId).toBeNull();
    expect(by[t.desk.id]!.parentRunId).toBe(by[t.root.id]!.id);
    expect(by[t.qa.id]!.parentRunId).toBe(by[t.desk.id]!.id);

    // costs add up to the root; the tree carries each agent's own share
    expect(r.costUsd).toBeCloseTo(4 * CALL, 6);
    expect(r.delegation).toMatchObject({
      agent: t.root.id,
      costUsd: expect.closeTo(CALL, 6),
      children: [{ agent: t.desk.id, costUsd: expect.closeTo(CALL, 6), children: [{ agent: t.qa.id, status: 'success', costUsd: expect.closeTo(2 * CALL, 6), children: [] }] }],
    });
    expect(r.trace.map((s) => s.tool)).toEqual([
      'route:delegate',
      `${t.desk.id} › route:delegate`,
      `${t.desk.id} › ${t.qa.id} › search_articles`,
    ]);

    // only the entry point keeps a conversation
    expect(await prisma.conversation.count({ where: { agent: { slug: { in: [t.desk.id, t.qa.id] } } } })).toBe(0);
    expect(await prisma.conversation.count({ where: { agent: { slug: t.root.id } } })).toBe(1);
  });

  it('exposes the tree over the API: the conversation message and the run with its children', async () => {
    const t = await tree();
    t.root.id = 'orchestrator';
    t.root.manifest.id = 'orchestrator';
    await seedAgent(t.root);
    const app = await buildApp({ token: 'tok', logger, getSkills: () => t.skills });

    const body = (await app.inject({ method: 'POST', url: '/ask', headers: AUTH, payload: { question: 'Chips?' } })).json();
    expect(body.delegation).toMatchObject({ agent: 'orchestrator', children: [{ agent: t.desk.id, children: [{ agent: t.qa.id }] }] });

    const conv = (await app.inject({ method: 'GET', url: `/conversations/${body.conversationId}`, headers: AUTH })).json();
    expect(conv.messages[1].delegation).toMatchObject({ agent: 'orchestrator', children: [{ agent: t.desk.id }] });
    expect(conv.messages[1].route.path).toEqual([t.desk.id, t.qa.id]);

    const run = (await app.inject({ method: 'GET', url: `/runs/${body.runId}`, headers: AUTH })).json();
    expect(run.parentRunId).toBeNull();
    expect(run.children).toMatchObject([{ agentSlug: t.desk.id, status: 'success' }]);
    const deskRun = (await app.inject({ method: 'GET', url: `/runs/${run.children[0].id}`, headers: AUTH })).json();
    expect(deskRun.parentRunId).toBe(body.runId);
    expect(deskRun.children).toMatchObject([{ agentSlug: t.qa.id }]);
  });
});

describe('the question budget cascades down', () => {
  it('refuses a call that would pass what the whole tree has left, before the model is called', async () => {
    // root + desk spend 2 × CALL; the leaf's pre-call estimate (2000 tokens ≈ 0.012) no longer fits in 0.015
    const t = await tree({ rootCap: 0.015 });

    const r = await ask(t);

    expect(r).toMatchObject({ status: 'failed', error: 'question_budget_exceeded' });
    expect(t.qaModel.adapter.generate).not.toHaveBeenCalled();
    // the money already spent stays booked, and the refused agent has a run of its own under the desk
    expect(r.costUsd).toBeCloseTo(2 * CALL, 6);
    const qaRun = await prisma.agentRun.findFirstOrThrow({ where: { agent: { slug: t.qa.id } }, orderBy: { startedAt: 'desc' } });
    expect(qaRun).toMatchObject({ status: 'failed', error: 'question_budget_exceeded' });
    expect(qaRun.parentRunId).not.toBeNull();
  });

  it('stops a later call of the same question once the tree is used up', async () => {
    // 0.02: the leaf's first call fits (0.0165 left after the routers), its second (≈ 0.012 needed, 0.0095 left) does not
    const t = await tree({ rootCap: 0.02 });

    const r = await ask(t);

    expect(r).toMatchObject({ status: 'failed', error: 'question_budget_exceeded' });
    expect(t.qaModel.adapter.generate).toHaveBeenCalledTimes(1);
  });

  it("applies a child's own smaller cap even when the entry point has none", async () => {
    // the desk caps its subtree at 0.004: its own call fits, the leaf below it does not
    const t = await tree({ deskCap: 0.004 });

    const r = await ask(t);

    expect(r).toMatchObject({ status: 'failed', error: 'question_budget_exceeded' });
    expect(t.deskModel.adapter.generate).toHaveBeenCalledTimes(1);
    expect(t.qaModel.adapter.generate).not.toHaveBeenCalled();
  });

  it('changes nothing for agents without a cap', async () => {
    const t = await tree();
    expect(await ask(t)).toMatchObject({ status: 'success' });
    expect(envelopeFor(undefined)).toBeUndefined();
    expect(envelopeFor(0)).toBeUndefined();
  });

  it("BudgetEnvelope: a child shares the parent's money and books into every level", () => {
    const root = new BudgetEnvelope(1);
    const capped = root.child(0.3);
    const free = root.child();
    capped.add(0.2);
    expect(root.remaining()).toBeCloseTo(0.8);
    expect(capped.remaining()).toBeCloseTo(0.1);
    // an uncapped child can only spend what the parent has left
    expect(free.remaining()).toBeCloseTo(0.8);
    free.add(0.7);
    expect(root.remaining()).toBeCloseTo(0.1);
    // a generous own cap never beats the parent's remainder
    expect(root.child(0.5).remaining()).toBeCloseTo(0.1);
    expect(envelopeFor(0.5, root)!.remaining()).toBeCloseTo(0.1);
  });
});

describe('run-time guards', () => {
  it('stops a manifest cycle that got past the loader, without another model call', async () => {
    const t = await tree();
    t.desk.manifest.delegates = [t.root.id];
    const deskLoop = scripted([() => calling(toolCall('delegate', { agent: t.root.id, question: 'Chips?' }))], { name: 'gpt-4o-mini' });
    registerAdapter('gpt-4o-mini', () => deskLoop.adapter);

    const r = await ask(t);

    expect(r).toMatchObject({ status: 'failed', error: 'delegation_cycle' });
    expect(t.rootModel.adapter.generate).toHaveBeenCalledTimes(1);
    expect(t.qaModel.adapter.generate).not.toHaveBeenCalled();
  });

  it(`stops a chain of more than ${MAX_DELEGATION_DEPTH} agents`, async () => {
    const [a, b, c, d] = [0, 1, 2, 3].map(() => router('deepseek-chat', []));
    a!.manifest.delegates = [b!.id];
    b!.manifest.delegates = [c!.id];
    c!.manifest.delegates = [d!.id];
    for (const s of [a!, b!, c!, d!]) await seedAgent(s);
    const model = scripted(
      [
        () => calling(toolCall('delegate', { agent: b!.id, question: 'x' })),
        () => calling(toolCall('delegate', { agent: c!.id, question: 'x' })),
        () => calling(toolCall('delegate', { agent: d!.id, question: 'x' })),
      ],
      { name: 'deepseek-chat' }
    );
    registerAdapter('deepseek-chat', () => model.adapter);

    const r = await routeQuestion({ skill: a!, question: 'Chips?', skills: [a!, b!, c!, d!] });

    expect(r).toMatchObject({ status: 'failed', error: 'delegation_too_deep' });
    expect(model.adapter.generate).toHaveBeenCalledTimes(3);
  });
});

describe('validateDelegation', () => {
  const agent = (id: string, delegates: string[] = [], type: 'reactive' | 'proactive' = 'reactive'): Skill => {
    const s = type === 'reactive' ? router('deepseek-chat', delegates) : makeSkill();
    s.id = id;
    s.manifest.id = id;
    return s;
  };
  const delegatesOf = (skills: Skill[]) => Object.fromEntries(skills.map((s) => [s.id, s.manifest.delegates ?? []]));

  it('keeps a valid tree untouched', () => {
    const skills = [agent('a', ['b', 'c']), agent('b', ['d']), agent('c'), agent('d')];
    expect(validateDelegation(skills)).toEqual([]);
    expect(delegatesOf(skills)).toEqual({ a: ['b', 'c'], b: ['d'], c: [], d: [] });
  });

  it('drops edges to unknown agents and to proactive agents (Ressorts), keeping the rest', () => {
    const skills = [agent('a', ['ghost', 'b', 'ressort']), agent('b'), agent('ressort', [], 'proactive')];
    expect(validateDelegation(skills)).toEqual([
      { agent: 'a', delegate: 'ghost', problem: 'unknown_agent' },
      { agent: 'a', delegate: 'ressort', problem: 'not_reactive' },
    ]);
    expect(delegatesOf(skills).a).toEqual(['b']);
  });

  it('drops the edge that closes a cycle, including an agent pointing at itself', () => {
    const skills = [agent('a', ['b', 'a']), agent('b', ['c']), agent('c', ['a'])];
    const issues = validateDelegation(skills);
    expect(issues).toEqual(
      expect.arrayContaining([
        { agent: 'a', delegate: 'a', problem: 'cycle' },
        { agent: 'c', delegate: 'a', problem: 'cycle' },
      ])
    );
    expect(delegatesOf(skills)).toEqual({ a: ['b'], b: ['c'], c: [] });
  });

  it(`drops an edge that would make a chain longer than ${MAX_DELEGATION_DEPTH} agents`, () => {
    const skills = [agent('a', ['b']), agent('b', ['c']), agent('c', ['d']), agent('d')];
    expect(validateDelegation(skills)).toEqual([{ agent: 'c', delegate: 'd', problem: 'too_deep' }]);
    expect(delegatesOf(skills)).toEqual({ a: ['b'], b: ['c'], c: [], d: [] });
  });
});
