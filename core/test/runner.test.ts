import { afterEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/db/prisma.js';
import { runAgent } from '../src/runner/runner.js';
import { recoverInterruptedRuns } from '../src/runner/recovery.js';
import { logger } from '../src/logger.js';
import {
  fakeAdapter,
  llmOutput,
  makeSkill,
  respond,
  seedAgent,
  sourceItems,
  useAdapter,
  useRssItems,
} from './helpers.js';

const UTC_DAY_MS = 24 * 60 * 60 * 1000;
const todayUtc = () => new Date(Math.floor(Date.now() / UTC_DAY_MS) * UTC_DAY_MS);

afterEach(() => {
  vi.unstubAllEnvs();
});

async function runWith(
  skill = makeSkill(),
  trigger: 'manual' | 'schedule' | 'catchup' = 'manual'
) {
  await seedAgent(skill);
  return runAgent({ skill, trigger, logger });
}

const articlesOf = (runId: string) => prisma.article.findMany({ where: { agentRunId: runId } });

describe('traceable output', () => {
  it('writes articles whose URL, source and date come from the fetched items', async () => {
    const items = sourceItems(6);
    useRssItems(items);
    const claude = fakeAdapter('claude-haiku-4-5', async () =>
      respond(llmOutput(items.slice(0, 5).map((i) => i.url), { publishedAt: '1999-01-01T00:00:00Z' }))
    );
    useAdapter(claude);

    const result = await runWith();

    expect(result.status).toBe('success');
    expect(result.articleIds).toHaveLength(5);
    const rows = await articlesOf(result.runId);
    expect(rows).toHaveLength(5);
    for (const r of rows) {
      expect(r.sourceName).toBe('Example Feed');
      // The source's date wins over the model's invented 1999 date.
      expect(r.publishedAt?.toISOString()).toBe('2026-10-18T08:00:00.000Z');
    }
    const snaps = await prisma.sourceSnapshot.findMany({ where: { agentRunId: result.runId } });
    expect(snaps).toHaveLength(6);
    expect(snaps.every((s) => s.sourceType === 'rss')).toBe(true);
  });

  it('marks the run partial and writes nothing when the model invents URLs', async () => {
    const items = sourceItems(6);
    useRssItems(items);
    const urls = [...items.slice(0, 3).map((i) => i.url), 'https://invented.example/a', 'https://invented.example/b'];
    useAdapter(fakeAdapter('claude-haiku-4-5', async () => respond(llmOutput(urls))));

    const result = await runWith();

    expect(result.status).toBe('partial');
    expect(result.error).toMatch(/traceability: 3 of 5/);
    expect(result.articleIds).toEqual([]);
    expect(await articlesOf(result.runId)).toHaveLength(0);
    // The call happened, so the spend is still booked.
    expect(result.costUsd).toBeGreaterThan(0);
  });

  it('rejects articles for which no publication date can be established', async () => {
    const items = sourceItems(6, null); // sources without dates
    useRssItems(items);
    useAdapter(fakeAdapter('claude-haiku-4-5', async () => respond(llmOutput(items.slice(0, 5).map((i) => i.url)))));

    const result = await runWith();

    expect(result.status).toBe('partial');
    expect(result.error).toMatch(/no_publication_date/);
    expect(await articlesOf(result.runId)).toHaveLength(0);
  });

  it('marks the run partial on a schema violation (missing sourceUrl)', async () => {
    useRssItems(sourceItems(6));
    const bad = JSON.stringify({ items: Array.from({ length: 5 }, (_, i) => ({ title: `t${i}`, summary: 's' })) });
    useAdapter(fakeAdapter('claude-haiku-4-5', async () => respond(bad)));

    const result = await runWith();

    expect(result.status).toBe('partial');
    expect(result.error).toMatch(/schema_violation/);
    expect(await articlesOf(result.runId)).toHaveLength(0);
  });
});

describe('no sources, no model call', () => {
  it('fails with no_source_items and never calls the adapter', async () => {
    useRssItems([]);
    const claude = fakeAdapter('claude-haiku-4-5', async () => respond('{}'));
    useAdapter(claude);

    const result = await runWith();

    expect(result.status).toBe('failed');
    expect(result.error).toBe('no_source_items');
    expect(result.costUsd).toBe(0);
    expect(claude.generate).not.toHaveBeenCalled();
    const row = await prisma.agentRun.findUnique({ where: { id: result.runId } });
    expect(row?.status).toBe('failed');
  });

  it('still runs a skill that declares no sources', async () => {
    const claude = fakeAdapter('claude-haiku-4-5', async () => respond('hello'));
    useAdapter(claude);

    const result = await runWith(makeSkill({ withSources: false, withSchema: false }));

    expect(result.status).toBe('success');
    expect(claude.generate).toHaveBeenCalledOnce();
  });
});

describe('budget gates run before any provider call', () => {
  it('per-agent cap', async () => {
    useRssItems(sourceItems(6));
    const claude = fakeAdapter('claude-haiku-4-5', async () => respond('{}'));
    useAdapter(claude);
    const skill = makeSkill({ dailyUsdMax: 0.5 });
    const agentId = await seedAgent(skill);
    await prisma.budgetLedger.create({ data: { agentId, period: todayUtc(), costUsd: 0.5 } });

    const result = await runAgent({ skill, trigger: 'manual', logger });

    expect(result.status).toBe('failed');
    expect(result.error).toBe('budget_exceeded');
    expect(claude.generate).not.toHaveBeenCalled();
  });

  it('global cap, using the pessimistic pre-call estimate', async () => {
    vi.stubEnv('SAMIX_GLOBAL_DAILY_USD_MAX', '0.01');
    useRssItems(sourceItems(6));
    const claude = fakeAdapter('claude-haiku-4-5', async () => respond('{}'));
    useAdapter(claude);

    const result = await runWith();

    expect(result.status).toBe('failed');
    expect(result.error).toBe('global_budget_exceeded');
    expect(claude.generate).not.toHaveBeenCalled();
  });

  it('books the cost of a completed call in the ledger', async () => {
    const items = sourceItems(6);
    useRssItems(items);
    useAdapter(
      fakeAdapter('claude-haiku-4-5', async () => respond(llmOutput(items.slice(0, 5).map((i) => i.url)), { in: 1_000_000, out: 100_000 }))
    );
    const skill = makeSkill();
    const agentId = await seedAgent(skill);

    const result = await runAgent({ skill, trigger: 'manual', logger });

    // 1M in × $1 + 0.1M out × $5
    expect(result.costUsd).toBeCloseTo(1.5);
    const ledger = await prisma.budgetLedger.findFirst({ where: { agentId } });
    expect(ledger?.costUsd).toBeCloseTo(1.5);
  });
});

describe('fallback chain (Phase 1 acceptance criterion 8)', () => {
  const authError = () => {
    throw new Error('401 invalid x-api-key');
  };

  it('serves from the fallback when the primary fails, and prices it as the fallback', async () => {
    const items = sourceItems(6);
    useRssItems(items);
    const claude = fakeAdapter('claude-haiku-4-5', async () => authError());
    const ollama = fakeAdapter(
      'ollama-llama3',
      async () => respond(llmOutput(items.slice(0, 5).map((i) => i.url)), { in: 5000, out: 2000 }),
      { inputPerMillionTokens: 0, outputPerMillionTokens: 0 }
    );
    useAdapter(claude);
    useAdapter(ollama);
    const skill = makeSkill({ fallback: 'ollama-llama3' });
    const agentId = await seedAgent(skill);

    const result = await runAgent({ skill, trigger: 'manual', logger });

    expect(result.status).toBe('success');
    expect(result.articleIds).toHaveLength(5);
    expect(claude.generate).toHaveBeenCalledOnce();
    expect(ollama.generate).toHaveBeenCalledOnce();
    // Local model: zero cost, even though the primary is priced.
    expect(result.costUsd).toBe(0);
    const ledger = await prisma.budgetLedger.findFirst({ where: { agentId } });
    expect(ledger?.costUsd ?? 0).toBe(0);
  });

  it('fails with the primary error when there is no fallback', async () => {
    useRssItems(sourceItems(6));
    useAdapter(fakeAdapter('claude-haiku-4-5', async () => authError()));

    const result = await runWith(makeSkill());

    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/invalid x-api-key/);
  });

  it('fails with the primary error when the fallback fails too', async () => {
    useRssItems(sourceItems(6));
    useAdapter(fakeAdapter('claude-haiku-4-5', async () => authError()));
    useAdapter(fakeAdapter('ollama-llama3', async () => { throw new Error('Ollama unreachable'); }));

    const result = await runWith(makeSkill({ fallback: 'ollama-llama3' }));

    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/invalid x-api-key/);
  });
});

describe('one run per agent at a time', () => {
  it('rejects a second concurrent run instead of double-spending', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const claude = fakeAdapter('claude-haiku-4-5', async () => {
      await gate;
      return respond('done');
    });
    useAdapter(claude);
    const skill = makeSkill({ withSources: false, withSchema: false });
    await seedAgent(skill);

    const first = runAgent({ skill, trigger: 'manual', logger });
    await vi.waitFor(() => expect(claude.generate).toHaveBeenCalledOnce());
    const second = await runAgent({ skill, trigger: 'schedule', logger });
    release();
    const firstResult = await first;

    expect(second.status).toBe('failed');
    expect(second.error).toBe('already_running');
    expect(firstResult.status).toBe('success');
    expect(claude.generate).toHaveBeenCalledOnce();

    // And the lock is released afterwards.
    const third = await runAgent({ skill, trigger: 'manual', logger });
    expect(third.status).toBe('success');
  });
});

describe('recoverInterruptedRuns', () => {
  it('marks runs left in "running" by a dead process as failed/interrupted', async () => {
    const skill = makeSkill();
    const agentId = await seedAgent(skill);
    const stuck = await prisma.agentRun.create({
      data: { agentId, status: 'running', trigger: 'manual' },
    });
    const done = await prisma.agentRun.create({
      data: { agentId, status: 'success', trigger: 'manual' },
    });

    const count = await recoverInterruptedRuns(logger);

    expect(count).toBeGreaterThanOrEqual(1);
    const after = await prisma.agentRun.findUnique({ where: { id: stuck.id } });
    expect(after).toMatchObject({ status: 'failed', error: 'interrupted' });
    expect(after?.completedAt).not.toBeNull();
    expect((await prisma.agentRun.findUnique({ where: { id: done.id } }))?.status).toBe('success');
  });
});
