import { beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { registerAdapter } from '../src/adapters/index.js';
import { prisma } from '../src/db/prisma.js';
import { logger } from '../src/logger.js';
import {
  MAX_MODEL_CALLS,
  MAX_TOOL_CALLS_PER_STEP,
  NOTHING_FOUND_ANSWER,
  askAgent,
} from '../src/runner/converse.js';
import type { ModelAdapter, ModelId, NormalizedRequest, NormalizedResponse, Skill, ToolCall } from '../src/types.js';
import { fakeAdapter, makeSkill, respond, seedAgent } from './helpers.js';

const AUTH = { authorization: 'Bearer tok' };
const ids: Record<string, string> = {};
let newsAgentId: string;

type Step = (req: NormalizedRequest, callNo: number) => NormalizedResponse | Promise<NormalizedResponse>;

const toolCall = (name: string, input: unknown, id = `c${Math.random()}`): ToolCall => ({ id, name, input });
const calling = (...calls: ToolCall[]): NormalizedResponse => ({ ...respond(''), toolCalls: calls, stopReason: 'tool_use' });
const final = (answer: string, sources: string[]) => respond(JSON.stringify({ answer, sources }));

// A model that plays back `steps` in order (the last one repeats).
function scripted(steps: Step[], opts: { tools?: boolean; name?: ModelId } = {}) {
  const requests: NormalizedRequest[] = [];
  let n = 0;
  const adapter = fakeAdapter(opts.name ?? 'claude-haiku-4-5', async (req) => {
    // Snapshot: the loop keeps appending to the same messages array.
    requests.push({ ...req, messages: [...req.messages] });
    const step = steps[Math.min(n, steps.length - 1)]!;
    return step(req, n++);
  });
  adapter.supportsTools = opts.tools ?? true;
  return { adapter, requests };
}

function reactive(over: { dailyUsdMax?: number; fallback?: ModelId } = {}): Skill {
  const s = makeSkill({ withSources: false, withSchema: false, dailyUsdMax: over.dailyUsdMax, fallback: over.fallback });
  s.type = 'reactive';
  s.manifest.type = 'reactive';
  s.manifest.sources = undefined;
  s.manifest.tools = ['list_ressorts', 'search_articles', 'get_article', 'fetch_full_text'];
  s.manifest.output = { format: 'answer' };
  return s;
}

async function setup(skill: Skill, adapter: ModelAdapter) {
  await seedAgent(skill);
  registerAdapter(adapter.name, () => adapter);
}

const search = (query: string) => toolCall('search_articles', { query });

beforeAll(async () => {
  const news = makeSkill();
  newsAgentId = await seedAgent(news);
  const run = await prisma.agentRun.create({ data: { agentId: newsAgentId, status: 'success', trigger: 'manual' } });
  for (const [key, title, summary] of [
    ['chip', 'Neuer KI-Chip vorgestellt', 'Der Chip ist doppelt so schnell.'],
    ['akku', 'Akkus mit Feststoff-Elektrolyt', 'Hersteller kündigen Serienfertigung an.'],
  ] as const) {
    const a = await prisma.article.create({
      data: { agentRunId: run.id, title, summary, sourceUrl: `https://example.com/${key}`, sourceName: 'Example', publishedAt: new Date('2026-10-18T08:00:00Z') },
    });
    ids[key] = a.id;
  }
});

describe('askAgent: grounded answers', () => {
  it('runs the tools, returns their results to the model, and stores a numbered, checked answer', async () => {
    const skill = reactive();
    const { adapter, requests } = scripted([
      () => calling(search('Chip')),
      () => final('Ein neuer Chip ist doppelt so schnell [1].', [ids.chip!]),
    ]);
    await setup(skill, adapter);

    const r = await askAgent({ skill, question: 'Was gibt es Neues bei Chips?' });

    expect(r.status).toBe('success');
    expect(r.answer).toBe('Ein neuer Chip ist doppelt so schnell [1].');
    expect(r.citations).toMatchObject([{ number: 1, articleId: ids.chip, title: 'Neuer KI-Chip vorgestellt', url: 'https://example.com/chip' }]);
    expect(r.trace).toMatchObject([{ tool: 'search_articles', resultCount: 1 }]);
    expect(adapter.generate).toHaveBeenCalledTimes(2);

    // the second request carries the assistant's tool call and the tool's result
    const second = requests[1]!.messages;
    expect(second.at(-2)).toMatchObject({ role: 'assistant' });
    const toolMsg = second.at(-1)!;
    expect(toolMsg.role).toBe('tool');
    expect(toolMsg.content).toContain(ids.chip);
    expect(requests[0]!.tools?.map((t) => t.name)).toContain('search_articles');

    const msgs = await prisma.conversationMessage.findMany({ where: { conversationId: r.conversationId! }, orderBy: { createdAt: 'asc' } });
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant']);
    const run = await prisma.agentRun.findUniqueOrThrow({ where: { id: r.runId } });
    expect(run).toMatchObject({ status: 'success', model: 'claude-haiku-4-5' });
    expect(run.costUsd).toBeCloseTo(2 * 0.0035, 6);
  });

  it('discards invented article ids, renumbers the rest and removes dangling [n] markers', async () => {
    const skill = reactive();
    const { adapter } = scripted([
      () => calling(search('Chip Akkus')),
      () => final('Erst [1] erfunden, dann [2] echt, dann [3] echt.', ['invented', ids.chip!, ids.akku!]),
    ]);
    await setup(skill, adapter);

    const r = await askAgent({ skill, question: 'Chips und Akkus?' });

    expect(r.status).toBe('success');
    expect(r.citations.map((c) => [c.number, c.articleId])).toEqual([[1, ids.chip], [2, ids.akku]]);
    expect(r.answer).toBe('Erst erfunden, dann [1] echt, dann [2] echt.');
  });

  it('does not accept an article that exists but no tool returned in this question', async () => {
    const skill = reactive();
    // the search surfaces only the chip article; the model also cites the akku article from "memory"
    const { adapter } = scripted([
      () => calling(search('Chip')),
      () => final('Beides [1] [2].', [ids.chip!, ids.akku!]),
    ]);
    await setup(skill, adapter);

    const r = await askAgent({ skill, question: 'Chips?' });

    expect(r.citations.map((c) => c.articleId)).toEqual([ids.chip]);
    expect(r.answer).toBe('Beides [1].');
  });

  it('is partial (no answer shown) when nothing citable is left although articles were found', async () => {
    const skill = reactive();
    const { adapter } = scripted([() => calling(search('Chip')), () => final('Aus dem Kopf.', ['invented'])]);
    await setup(skill, adapter);

    const r = await askAgent({ skill, question: 'Chips?' });

    expect(r).toMatchObject({ status: 'partial', error: 'no_valid_citations' });
    expect(r.answer).toBeUndefined();
    const stored = await prisma.conversationMessage.findFirstOrThrow({ where: { conversationId: r.conversationId!, role: 'assistant' } });
    expect(stored).toMatchObject({ content: '', status: 'partial' });
  });

  it('shows a fixed "nothing found" text when no article was surfaced, whatever the model wrote', async () => {
    const skill = reactive();
    const { adapter } = scripted([
      () => calling(search('Quantenkartoffeln')),
      () => final('Quantenkartoffeln wurden 2031 erfunden.', []),
    ]);
    await setup(skill, adapter);

    const r = await askAgent({ skill, question: 'Quantenkartoffeln?' });

    expect(r).toMatchObject({ status: 'success', answer: NOTHING_FOUND_ANSWER, citations: [] });
  });

  it('accepts JSON in a code fence', async () => {
    const skill = reactive();
    const { adapter } = scripted([
      () => calling(search('Chip')),
      () => respond('```json\n' + JSON.stringify({ answer: 'Ja [1].', sources: [ids.chip] }) + '\n```'),
    ]);
    await setup(skill, adapter);
    expect((await askAgent({ skill, question: 'Chips?' })).status).toBe('success');
  });
});

describe('askAgent: search first, output repair', () => {
  it('reminds a model that answers without searching once, then accepts a search', async () => {
    const skill = reactive();
    const { adapter, requests } = scripted([
      () => final('Aus Allgemeinwissen.', []),
      () => calling(search('Chip')),
      () => final('Belegt [1].', [ids.chip!]),
    ]);
    await setup(skill, adapter);

    const r = await askAgent({ skill, question: 'Chips?' });

    expect(r.status).toBe('success');
    expect(requests[1]!.messages.at(-1)).toMatchObject({ role: 'user', content: expect.stringContaining('search_articles') });
  });

  it('does not show an answer when the model still skips the search', async () => {
    const skill = reactive();
    const { adapter } = scripted([() => final('Aus Allgemeinwissen.', [])]);
    await setup(skill, adapter);

    const r = await askAgent({ skill, question: 'Chips?' });

    expect(r).toMatchObject({ status: 'partial', error: 'ungrounded' });
    expect(r.answer).toBeUndefined();
    expect(adapter.generate).toHaveBeenCalledTimes(2);
  });

  it('asks once for valid JSON, then gives up as invalid_output', async () => {
    const skill = reactive();
    const ok = scripted([() => calling(search('Chip')), () => respond('Hier ist die Antwort ohne JSON'), () => final('Jetzt [1].', [ids.chip!])]);
    await setup(skill, ok.adapter);
    expect((await askAgent({ skill, question: 'Chips?' })).status).toBe('success');

    const skill2 = reactive();
    const bad = scripted([() => calling(search('Chip')), () => respond('kein json'), () => respond('immer noch nicht')]);
    await setup(skill2, bad.adapter);
    expect(await askAgent({ skill: skill2, question: 'Chips?' })).toMatchObject({ status: 'partial', error: 'invalid_output' });
  });
});

describe('askAgent: limits and gates', () => {
  it('stops after MAX_MODEL_CALLS model calls', async () => {
    const skill = reactive();
    const { adapter } = scripted([() => calling(search('Chip'))]);
    await setup(skill, adapter);

    const r = await askAgent({ skill, question: 'Chips?' });

    expect(r).toMatchObject({ status: 'partial', error: 'step_limit' });
    expect(adapter.generate).toHaveBeenCalledTimes(MAX_MODEL_CALLS);
    expect(r.costUsd).toBeCloseTo(MAX_MODEL_CALLS * 0.0035, 6);
  });

  it('checks the daily budget before every call and books what was spent', async () => {
    // one call costs 0.0035; the cap is reached after the first
    const skill = reactive({ dailyUsdMax: 0.003 });
    const { adapter } = scripted([() => calling(search('Chip')), () => final('x [1]', [ids.chip!])]);
    await setup(skill, adapter);

    const r = await askAgent({ skill, question: 'Chips?' });

    expect(r).toMatchObject({ status: 'failed', error: 'budget_exceeded' });
    expect(adapter.generate).toHaveBeenCalledTimes(1);
    const ledger = await prisma.budgetLedger.findFirstOrThrow({ where: { agent: { slug: skill.id } } });
    expect(ledger.costUsd).toBeCloseTo(0.0035, 6);
    expect(r.costUsd).toBeCloseTo(0.0035, 6);
  });

  it('checks the global budget before a call', async () => {
    const prev = process.env.SAMIX_GLOBAL_DAILY_USD_MAX;
    process.env.SAMIX_GLOBAL_DAILY_USD_MAX = '0.0000001';
    try {
      const skill = reactive();
      const { adapter } = scripted([() => final('x', [])]);
      await setup(skill, adapter);
      const r = await askAgent({ skill, question: 'Chips?' });
      expect(r).toMatchObject({ status: 'failed', error: 'global_budget_exceeded' });
      expect(adapter.generate).not.toHaveBeenCalled();
    } finally {
      if (prev === undefined) delete process.env.SAMIX_GLOBAL_DAILY_USD_MAX;
      else process.env.SAMIX_GLOBAL_DAILY_USD_MAX = prev;
    }
  });

  it('answers every tool call of a step but runs at most MAX_TOOL_CALLS_PER_STEP', async () => {
    const skill = reactive();
    const many = Array.from({ length: MAX_TOOL_CALLS_PER_STEP + 2 }, (_, i) => toolCall('search_articles', { query: 'Chip' }, `id${i}`));
    const { adapter, requests } = scripted([() => calling(...many), () => final('ok [1]', [ids.chip!])]);
    await setup(skill, adapter);

    const r = await askAgent({ skill, question: 'Chips?' });

    expect(r.trace).toHaveLength(MAX_TOOL_CALLS_PER_STEP);
    const answered = requests[1]!.messages.filter((m) => m.role === 'tool').map((m) => (m as { toolCallId: string }).toolCallId);
    expect(answered).toEqual(many.map((c) => c.id));
  });

  it('rejects a model without tool calling before any call, and does not fall back to one either', async () => {
    const noTools = scripted([() => final('x', [])], { tools: false });
    const skill = reactive();
    await setup(skill, noTools.adapter);
    expect(await askAgent({ skill, question: 'Chips?' })).toMatchObject({ status: 'failed', error: 'model_without_tools' });
    expect(noTools.adapter.generate).not.toHaveBeenCalled();
    // refused up front: no conversation is started for it
    expect(await prisma.conversation.count({ where: { agent: { slug: skill.id } } })).toBe(0);

    // tool-capable primary fails; the declared fallback cannot call tools, so it is not tried
    const broken = fakeAdapter('claude-haiku-4-5', async () => {
      throw new Error('provider down');
    });
    broken.supportsTools = true;
    const local = scripted([() => final('Aus dem Kopf', [])], { tools: false, name: 'ollama-llama3' });
    const skill2 = reactive({ fallback: 'ollama-llama3' });
    await setup(skill2, broken);
    registerAdapter('ollama-llama3', () => local.adapter);
    const r = await askAgent({ skill: skill2, question: 'Chips?' });
    expect(r).toMatchObject({ status: 'failed', error: 'provider down' });
    expect(local.adapter.generate).not.toHaveBeenCalled();
  });

  it('refuses a disabled agent and a second question while one is running', async () => {
    const off = reactive();
    const { adapter } = scripted([() => final('x', [])]);
    await setup(off, adapter);
    await prisma.agent.update({ where: { slug: off.id }, data: { enabled: false } });
    expect(await askAgent({ skill: off, question: 'Chips?' })).toMatchObject({ status: 'failed', error: 'agent_disabled' });

    const skill = reactive();
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    const slow = scripted([async () => { await gate; return calling(search('Chip')); }, () => final('ok [1]', [ids.chip!])]);
    await setup(skill, slow.adapter);
    const first = askAgent({ skill, question: 'Chips?' });
    await new Promise((r) => setTimeout(r, 20));
    expect(await askAgent({ skill, question: 'Und noch eine?' })).toMatchObject({ status: 'failed', error: 'already_running' });
    release();
    expect((await first).status).toBe('success');
  });

  it('rejects an empty or too long question', async () => {
    const skill = reactive();
    const { adapter } = scripted([() => final('x', [])]);
    await setup(skill, adapter);
    expect(await askAgent({ skill, question: '   ' })).toMatchObject({ error: 'invalid_question' });
    expect(await askAgent({ skill, question: 'x'.repeat(2001) })).toMatchObject({ error: 'invalid_question' });
    expect(adapter.generate).not.toHaveBeenCalled();
  });
});

describe('askAgent: conversation history', () => {
  it('gives a follow-up question the previous successful turns as plain text, at most the last 6', async () => {
    const skill = reactive();
    const { adapter, requests } = scripted([() => calling(search('Chip')), () => final('Antwort [1].', [ids.chip!])]);
    await setup(skill, adapter);
    const first = await askAgent({ skill, question: 'Erste Frage' });
    const convId = first.conversationId!;

    // pad with older turns and one failed turn that must not be replayed
    const base = Date.now() - 100_000;
    let t = base;
    const add = (role: string, content: string, status?: string) =>
      prisma.conversationMessage.create({ data: { conversationId: convId, role, content, status, createdAt: new Date((t += 10)) } });
    for (let i = 0; i < 8; i++) {
      await add('user', `alte Frage ${i}`);
      await add('assistant', `alte Antwort ${i}`, 'ok');
    }
    await add('user', 'gescheiterte Frage');
    await add('assistant', '', 'partial');
    // Move the real first turn behind the padding: only the newest 6 pairs count.
    await prisma.conversationMessage.updateMany({ where: { conversationId: convId, content: { in: ['Erste Frage', 'Antwort [1].'] } }, data: { createdAt: new Date(base - 1000) } });

    const before = requests.length;
    await askAgent({ skill, question: 'Zweite Frage', conversationId: convId });

    const messages = requests[before]!.messages;
    const texts = messages.map((m) => m.content);
    expect(messages).toHaveLength(6 * 2 + 1);
    expect(texts.at(-1)).toBe('Zweite Frage');
    expect(texts).toContain('alte Frage 7');
    expect(texts).not.toContain('alte Frage 1');
    expect(texts).not.toContain('gescheiterte Frage');
    expect(messages.some((m) => m.role === 'tool')).toBe(false);
  });

  it('refuses a conversation that belongs to another agent', async () => {
    const a = reactive();
    const b = reactive();
    const { adapter } = scripted([() => calling(search('Chip')), () => final('ok [1]', [ids.chip!])]);
    await setup(a, adapter);
    await seedAgent(b);
    const r = await askAgent({ skill: a, question: 'Chips?' });
    expect(await askAgent({ skill: b, question: 'Weiter', conversationId: r.conversationId })).toMatchObject({ error: 'conversation_not_found' });
  });
});

describe('askAgent: ephemeral with caller-supplied history', () => {
  it('keeps no conversation, but records the run and uses the supplied history', async () => {
    const skill = reactive();
    const { adapter, requests } = scripted([() => calling(search('Chip')), () => final('ok [1]', [ids.chip!])]);
    await setup(skill, adapter);

    const r = await askAgent({
      skill,
      question: 'Und die Akkus?',
      ephemeral: true,
      history: [{ role: 'user', content: 'Chips?' }, { role: 'assistant', content: 'Doppelt so schnell.' }],
    });

    expect(r).toMatchObject({ status: 'success', conversationId: null });
    expect(requests[0]!.messages.map((m) => m.content)).toEqual(['Chips?', 'Doppelt so schnell.', 'Und die Akkus?']);
    expect(await prisma.conversation.count({ where: { agent: { slug: skill.id } } })).toBe(0);
    expect(await prisma.agentRun.count({ where: { id: r.runId, status: 'success' } })).toBe(1);
  });
});

describe('POST /ask and conversations', () => {
  it('asks, lists, reads and deletes; the runs that paid for the answers stay', async () => {
    const skill = reactive();
    skill.id = 'frag-die-zeitung';
    skill.manifest.id = 'frag-die-zeitung';
    const { adapter } = scripted([() => calling(search('Chip')), () => final('Doppelt so schnell [1].', [ids.chip!])]);
    await setup(skill, adapter);
    const app = await buildApp({ token: 'tok', logger, getSkills: () => [skill] });

    expect((await app.inject({ method: 'POST', url: '/ask', payload: { question: 'Chips?' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/ask', headers: AUTH, payload: { question: '' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/ask', headers: AUTH, payload: { question: 'x', agent: 'nope' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/ask', headers: AUTH, payload: { question: 'x', conversationId: 'nope' } })).statusCode).toBe(404);

    const res = await app.inject({ method: 'POST', url: '/ask', headers: AUTH, payload: { question: 'Chips?' } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ status: 'success', answer: 'Doppelt so schnell [1].' });
    expect(body.citations[0]).toMatchObject({ number: 1, articleId: ids.chip });

    const list = (await app.inject({ method: 'GET', url: '/conversations?agent=frag-die-zeitung', headers: AUTH })).json();
    expect(list.map((c: { id: string }) => c.id)).toContain(body.conversationId);

    const conv = (await app.inject({ method: 'GET', url: `/conversations/${body.conversationId}`, headers: AUTH })).json();
    expect(conv.messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant']);
    expect(conv.messages[1]).toMatchObject({ status: 'ok', runId: body.runId, citations: [{ number: 1 }] });
    expect(conv.messages[1].trace[0]).toMatchObject({ tool: 'search_articles' });

    expect((await app.inject({ method: 'DELETE', url: `/conversations/${body.conversationId}`, headers: AUTH })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: `/conversations/${body.conversationId}`, headers: AUTH })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/conversations/${body.conversationId}`, headers: AUTH })).statusCode).toBe(404);
    expect(await prisma.conversationMessage.count({ where: { conversationId: body.conversationId } })).toBe(0);
    expect(await prisma.agentRun.count({ where: { id: body.runId } })).toBe(1);
  });
});
