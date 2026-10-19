import { describe, expect, it } from 'vitest';
import { prisma } from '../src/db/prisma.js';
import { dropAlreadyPublished } from '../src/runner/dedupe.js';
import { runAgent } from '../src/runner/runner.js';
import { logger } from '../src/logger.js';
import { fakeAdapter, llmOutput, makeSkill, respond, seedAgent, sourceItems, useAdapter, useRssItems } from './helpers.js';
import type { Skill } from '../src/types.js';

async function publish(agentId: string, urls: string[], createdAt = new Date()) {
  const run = await prisma.agentRun.create({ data: { agentId, status: 'success', trigger: 'manual' } });
  for (const url of urls) {
    await prisma.article.create({ data: { agentRunId: run.id, title: 't', summary: 's', sourceUrl: url, createdAt } });
  }
}
const items = (n: number) => sourceItems(n);
const DAY = 24 * 60 * 60 * 1000;

describe('dropAlreadyPublished', () => {
  it('drops items this agent published within the window, matching URL variants', async () => {
    const skill = makeSkill();
    const agentId = await seedAgent(skill);
    await publish(agentId, ['https://www.example.com/post-0/?utm_source=x']);

    const { fresh, skipped } = await dropAlreadyPublished(agentId, items(3), 14);

    expect(skipped).toBe(1);
    expect(fresh.map((i) => i.url)).toEqual(['https://example.com/post-1', 'https://example.com/post-2']);
  });

  it('ignores articles older than the window and articles of other agents', async () => {
    const a = makeSkill();
    const b = makeSkill();
    const idA = await seedAgent(a);
    const idB = await seedAgent(b);
    await publish(idA, ['https://example.com/post-0'], new Date(Date.now() - 20 * DAY));
    await publish(idB, ['https://example.com/post-1']);

    const { fresh, skipped } = await dropAlreadyPublished(idA, items(2), 14);

    expect(skipped).toBe(0);
    expect(fresh).toHaveLength(2);
  });

  it('is off with 0 days', async () => {
    const skill = makeSkill();
    const agentId = await seedAgent(skill);
    await publish(agentId, ['https://example.com/post-0']);
    expect((await dropAlreadyPublished(agentId, items(2), 0)).skipped).toBe(0);
  });
});

describe('runs and dedupe', () => {
  const setup = async (patch: (s: Skill) => void = () => undefined) => {
    const all = sourceItems(7);
    useRssItems(all);
    const claude = fakeAdapter('claude-haiku-4-5', async (req) => {
      const given = (JSON.parse(req.messages[0]!.content) as { items: { url: string }[] }).items.map((i) => i.url);
      return respond(llmOutput(given.slice(0, 5)));
    });
    useAdapter(claude);
    const skill = makeSkill();
    patch(skill);
    await seedAgent(skill);
    return { skill, claude, all };
  };

  it('does not send already-published items to the model, and publishes the rest', async () => {
    const { skill, claude } = await setup();
    const first = await runAgent({ skill, trigger: 'manual', logger });
    expect(first.articleIds).toHaveLength(5);

    // Same feed again plus nothing new: items 0-4 were published; 5-6 are fresh but only 2 → below min_items.
    const second = await runAgent({ skill, trigger: 'manual', logger });
    const sent = (JSON.parse(claude.generate.mock.calls[1]![0].messages[0].content) as { items: unknown[] }).items;
    expect(sent).toHaveLength(2);
    expect(second.status).toBe('partial');
  });

  it('ends a run with nothing new as a cheap success, without calling the model', async () => {
    const { skill, claude } = await setup((s) => {
      s.manifest.output.minItems = 1;
    });
    useRssItems(sourceItems(5));
    await runAgent({ skill, trigger: 'manual', logger }); // publishes all 5
    const calls = claude.generate.mock.calls.length;

    const again = await runAgent({ skill, trigger: 'schedule', logger });

    expect(again).toMatchObject({ status: 'success', costUsd: 0, articleIds: [], output: { note: 'no_new_items', skipped: 5 } });
    expect(claude.generate.mock.calls.length).toBe(calls);
  });

  it('dedupe_days: 0 turns it off', async () => {
    const { skill, claude } = await setup((s) => {
      s.manifest.dedupeDays = 0;
    });
    useRssItems(sourceItems(5));
    await runAgent({ skill, trigger: 'manual', logger });
    const again = await runAgent({ skill, trigger: 'manual', logger });
    expect(claude.generate).toHaveBeenCalledTimes(2);
    expect(again.articleIds).toHaveLength(5);
  });
});

describe('disabled agents', () => {
  it('refuse to run, record why, and never reach the provider', async () => {
    useRssItems(sourceItems(6));
    const claude = fakeAdapter('claude-haiku-4-5', async () => respond('{}'));
    useAdapter(claude);
    const skill = makeSkill();
    const agentId = await seedAgent(skill);
    await prisma.agent.update({ where: { id: agentId }, data: { enabled: false } });

    const result = await runAgent({ skill, trigger: 'schedule', logger });

    expect(result).toMatchObject({ status: 'failed', error: 'agent_disabled' });
    expect(claude.generate).not.toHaveBeenCalled();
    const row = await prisma.agentRun.findUnique({ where: { id: result.runId } });
    expect(row?.error).toBe('agent_disabled');
  });
});
