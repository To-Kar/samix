import { describe, expect, it } from 'vitest';
import { prisma } from '../src/db/prisma.js';
import { buildApp } from '../src/app.js';
import { dropAlreadyPublished, titlesSimilar } from '../src/runner/dedupe.js';
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

describe('titlesSimilar', () => {
  it('is true for the same headline with filler or case changed, false for a different event or result', () => {
    expect(titlesSimilar('Bayern schlägt Dortmund im Topspiel mit 2:1', 'BAYERN schlägt Dortmund im Topspiel mit 2:1!')).toBe(true);
    expect(titlesSimilar('Neuer KI-Chip doppelt so schnell vorgestellt', 'Neuer KI-Chip: doppelt so schnell vorgestellt')).toBe(true);
    expect(titlesSimilar('Bayern gewinnt gegen Dortmund 2:1', 'Bayern gewinnt gegen Dortmund 3:0')).toBe(false);
    expect(titlesSimilar('Bayern gewinnt das Derby', 'Dortmund verliert das Derby')).toBe(false);
    expect(titlesSimilar('KI', 'KI')).toBe(false); // too little to go on
    expect(titlesSimilar('Neuer Chip', 'Neuer Chip')).toBe(false); // two distinctive words are not enough to call it a repeat
  });
});

describe('same headline under another URL', () => {
  async function publishWithSnapshot(agentId: string, url: string, sourceTitle: string) {
    const run = await prisma.agentRun.create({ data: { agentId, status: 'success', trigger: 'manual' } });
    await prisma.sourceSnapshot.create({ data: { agentRunId: run.id, sourceType: 'rss', sourceName: 'x', url, title: sourceTitle } });
    await prisma.article.create({ data: { agentRunId: run.id, title: 'umgeschrieben', summary: 's', sourceUrl: url } });
  }
  const item = (url: string, title: string) => ({ url, title, sourceName: 's', sourceType: 'rss' as const });

  it('drops a near-identical title from another URL and says what it was taken for', async () => {
    const skill = makeSkill();
    const agentId = await seedAgent(skill);
    await publishWithSnapshot(agentId, 'https://a.example/1', 'Neuer KI-Chip doppelt so schnell vorgestellt');

    const r = await dropAlreadyPublished(
      agentId,
      [item('https://b.example/zzz', 'Neuer KI-Chip: doppelt so schnell vorgestellt'), item('https://b.example/other', 'Ganz andere Meldung über Akkus und Speicher')],
      14,
      new Date(),
      { similar: true }
    );

    expect(r.fresh.map((i) => i.url)).toEqual(['https://b.example/other']);
    expect(r.skipped).toBe(1);
    expect(r.skippedSimilar).toEqual([{ title: 'Neuer KI-Chip: doppelt so schnell vorgestellt', url: 'https://b.example/zzz', similarTo: 'Neuer KI-Chip doppelt so schnell vorgestellt' }]);
  });

  it('is off unless asked for, and ignores other agents and old articles', async () => {
    const a = makeSkill();
    const b = makeSkill();
    const idA = await seedAgent(a);
    const idB = await seedAgent(b);
    await publishWithSnapshot(idB, 'https://a.example/9', 'Neuer Rekordumsatz bei Chipherstellern gemeldet');
    const run = await prisma.agentRun.create({ data: { agentId: idA, status: 'success', trigger: 'manual' } });
    await prisma.sourceSnapshot.create({ data: { agentRunId: run.id, sourceType: 'rss', sourceName: 'x', url: 'https://old.example/1', title: 'Neuer Rekordumsatz bei Chipherstellern gemeldet' } });
    await prisma.article.create({ data: { agentRunId: run.id, title: 't', summary: 's', sourceUrl: 'https://old.example/1', createdAt: new Date(Date.now() - 20 * DAY) } });
    const same = [item('https://c.example/1', 'Neuer Rekordumsatz bei Chipherstellern gemeldet')];

    expect((await dropAlreadyPublished(idA, same, 14, new Date(), { similar: true })).fresh).toHaveLength(1);
    await publishWithSnapshot(idA, 'https://a.example/2', 'Neuer Rekordumsatz bei Chipherstellern gemeldet');
    expect((await dropAlreadyPublished(idA, same, 14, new Date())).fresh).toHaveLength(1); // not asked for
    expect((await dropAlreadyPublished(idA, same, 14, new Date(), { similar: true })).fresh).toHaveLength(0);
  });
});

describe('a run with a repeated headline', () => {
  it('does not send it to the model, records it in the run output and shows it in the runs listing', async () => {
    const skill = makeSkill();
    const agentId = await seedAgent(skill);
    const run = await prisma.agentRun.create({ data: { agentId, status: 'success', trigger: 'manual' } });
    await prisma.sourceSnapshot.create({ data: { agentRunId: run.id, sourceType: 'rss', sourceName: 'x', url: 'https://old.example/1', title: 'Post zwei wurde veröffentlicht heute Morgen ganz neu' } });
    await prisma.article.create({ data: { agentRunId: run.id, title: 't', summary: 's', sourceUrl: 'https://old.example/1' } });

    const list = sourceItems(7);
    list[1] = { ...list[1]!, title: 'Post zwei wurde veröffentlicht heute Morgen ganz neu!' };
    useRssItems(list);
    const model = fakeAdapter('claude-haiku-4-5', async () => respond(llmOutput(list.filter((_, i) => i !== 1).slice(0, 5).map((i) => i.url))));
    useAdapter(model);

    const result = await runAgent({ skill, trigger: 'manual', logger });

    expect(result.status).toBe('success');
    const sent = (JSON.parse(model.generate.mock.calls[0]![0].messages[0].content) as { items: { url: string }[] }).items;
    expect(sent.map((i) => i.url)).not.toContain(list[1]!.url);
    const stored = JSON.parse((await prisma.agentRun.findUniqueOrThrow({ where: { id: result.runId } })).output!) as { skippedSimilar: { similarTo: string }[] };
    expect(stored.skippedSimilar).toHaveLength(1);

    const app = await buildApp({ token: 'tok', logger, getSkills: () => [skill] });
    const runs = (await app.inject({ url: `/runs?agent=${skill.id}`, headers: { authorization: 'Bearer tok' } })).json();
    expect(runs.find((r: { id: string }) => r.id === result.runId).skippedSimilar).toEqual([
      { title: 'Post zwei wurde veröffentlicht heute Morgen ganz neu!', similarTo: 'Post zwei wurde veröffentlicht heute Morgen ganz neu', url: list[1]!.url },
    ]);

    // switched off in the manifest: the model sees it
    const off = makeSkill();
    off.manifest.dedupeSimilar = false;
    const idOff = await seedAgent(off);
    const run2 = await prisma.agentRun.create({ data: { agentId: idOff, status: 'success', trigger: 'manual' } });
    await prisma.sourceSnapshot.create({ data: { agentRunId: run2.id, sourceType: 'rss', sourceName: 'x', url: 'https://old.example/1', title: 'Post zwei wurde veröffentlicht heute Morgen ganz neu' } });
    await prisma.article.create({ data: { agentRunId: run2.id, title: 't', summary: 's', sourceUrl: 'https://old.example/1' } });
    await runAgent({ skill: off, trigger: 'manual', logger });
    const sentOff = (JSON.parse(model.generate.mock.calls[1]![0].messages[0].content) as { items: { url: string }[] }).items;
    expect(sentOff.map((i) => i.url)).toContain(list[1]!.url);
  });
});
