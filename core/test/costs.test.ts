import { cpSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db/prisma.js';
import { logger } from '../src/logger.js';
import { computeCostUsd, estimateRunCostUsd, readGlobalCap, utcDayStart } from '../src/runner/budget.js';
import { runAgent } from '../src/runner/runner.js';
import { deleteSetting, clearPriceOverride, GLOBAL_CAP_KEY } from '../src/settings.js';
import { loadSkillDir } from '../src/skills/loader.js';
import { fakeAdapter, llmOutput, makeSkill, respond, seedAgent, sourceItems, useAdapter, useRssItems } from './helpers.js';

const AUTH = { authorization: 'Bearer tok' };
const REPO_AGENTS = resolve(import.meta.dirname, '../../agents');

afterEach(async () => {
  vi.unstubAllEnvs();
  await deleteSetting(GLOBAL_CAP_KEY);
  await clearPriceOverride('claude-haiku-4-5');
  await clearPriceOverride('deepseek-chat');
});

const app = () => buildApp({ token: 'tok', logger, getSkills: () => [] });
const put = (a: Awaited<ReturnType<typeof app>>, url: string, payload: unknown) => a.inject({ method: 'PUT', url, headers: AUTH, payload: payload as object });

describe('prices the reader sets', () => {
  it('replace the adapter table in every cost calculation, until removed', async () => {
    const a = await app();
    const adapter = fakeAdapter('claude-haiku-4-5', async () => respond('x'), { inputPerMillionTokens: 1, outputPerMillionTokens: 5 });
    expect(computeCostUsd(adapter, 1_000_000, 1_000_000)).toBe(6);

    expect((await put(a, '/prices/claude-haiku-4-5', { inputPerMillionTokens: 10, outputPerMillionTokens: 20 })).statusCode).toBe(200);
    expect(computeCostUsd(adapter, 1_000_000, 1_000_000)).toBe(30);
    expect(estimateRunCostUsd(adapter, 1_000_000)).toBe(30);

    expect((await a.inject({ method: 'DELETE', url: '/prices/claude-haiku-4-5', headers: AUTH })).statusCode).toBe(200);
    expect(computeCostUsd(adapter, 1_000_000, 1_000_000)).toBe(6);
  });

  it('are used by a real run and booked to the ledger', async () => {
    const a = await app();
    await put(a, '/prices/claude-haiku-4-5', { inputPerMillionTokens: 100, outputPerMillionTokens: 200 });
    const items = sourceItems(6);
    useRssItems(items);
    useAdapter(fakeAdapter('claude-haiku-4-5', async () => respond(llmOutput(items.slice(0, 5).map((i) => i.url)))));
    const skill = makeSkill();
    await seedAgent(skill);

    const r = await runAgent({ skill, trigger: 'manual', logger });

    // 1000 in, 500 out at 100 / 200 per million
    expect(r.costUsd).toBeCloseTo(0.2, 6);
    expect((await prisma.budgetLedger.findFirstOrThrow({ where: { agent: { slug: skill.id } } })).costUsd).toBeCloseTo(0.2, 6);
  });

  it('refuses nonsense and unknown models', async () => {
    const a = await app();
    expect((await put(a, '/prices/claude-haiku-4-5', { inputPerMillionTokens: -1, outputPerMillionTokens: 1 })).statusCode).toBe(400);
    expect((await put(a, '/prices/claude-haiku-4-5', { inputPerMillionTokens: 'x', outputPerMillionTokens: 1 })).statusCode).toBe(400);
    expect((await put(a, '/prices/gpt-5', { inputPerMillionTokens: 1, outputPerMillionTokens: 1 })).statusCode).toBe(400);
    expect((await put(a, '/prices/static', { inputPerMillionTokens: 1, outputPerMillionTokens: 1 })).statusCode).toBe(400);
    expect((await a.inject({ method: 'PUT', url: '/prices/claude-haiku-4-5', payload: {} })).statusCode).toBe(401);
  });
});

describe('global limit', () => {
  it('the app setting beats the environment; removing it falls back; 0 switches it off', async () => {
    vi.stubEnv('SAMIX_GLOBAL_DAILY_USD_MAX', '2');
    const a = await app();
    expect(readGlobalCap()).toBe(2);
    expect((await put(a, '/budget/global', { usd: 7.5 })).json()).toEqual({ globalCapUsd: 7.5 });
    expect(readGlobalCap()).toBe(7.5);
    expect((await put(a, '/budget/global', { usd: 0 })).json()).toEqual({ globalCapUsd: 0 });
    expect((await a.inject({ method: 'DELETE', url: '/budget/global', headers: AUTH })).json()).toEqual({ globalCapUsd: 2 });
    expect((await put(a, '/budget/global', { usd: -3 })).statusCode).toBe(400);
    expect((await put(a, '/budget/global', { usd: 5000 })).statusCode).toBe(400);
  });

  it('is enforced before a run', async () => {
    const a = await app();
    await put(a, '/budget/global', { usd: 0.000001 });
    const items = sourceItems(6);
    useRssItems(items);
    const model = fakeAdapter('claude-haiku-4-5', async () => respond(llmOutput(items.slice(0, 5).map((i) => i.url))));
    useAdapter(model);
    const skill = makeSkill();
    await seedAgent(skill);
    expect(await runAgent({ skill, trigger: 'manual', logger })).toMatchObject({ status: 'failed', error: 'global_budget_exceeded' });
    expect(model.generate).not.toHaveBeenCalled();
  });
});

describe('daily limit of an agent', () => {
  it('is written to the manifest file and applies to the running skill', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'samix-budget-'));
    cpSync(join(REPO_AGENTS, 'newsletter-ai'), join(dir, 'newsletter-ai'), { recursive: true });
    const skill = await loadSkillDir(join(dir, 'newsletter-ai'));
    const a = await buildApp({ token: 'tok', logger, getSkills: () => [skill] });

    expect((await put(a, '/agents/newsletter-ai/budget', { dailyUsdMax: 1.25 })).json()).toEqual({ dailyUsdMax: 1.25 });
    expect(skill.manifest.budget.dailyUsdMax).toBe(1.25);
    const onDisk = parseYaml(readFileSync(join(dir, 'newsletter-ai', 'manifest.yaml'), 'utf8')) as { budget: Record<string, unknown> };
    expect(onDisk.budget['daily_usd_max']).toBe(1.25);
    expect(onDisk.budget['tokens_per_run_max']).toBe(4000); // the rest of the budget is untouched

    expect((await put(a, '/agents/newsletter-ai/budget', { dailyUsdMax: -1 })).statusCode).toBe(400);
    expect((await put(a, '/agents/nope/budget', { dailyUsdMax: 1 })).statusCode).toBe(404);
  });
});

describe('GET /costs', () => {
  it('sums today per agent with the search part, lists seven days, caps and prices', async () => {
    await prisma.budgetLedger.deleteMany(); // spending of the tests above
    const skill = makeSkill({ primary: 'deepseek-chat' });
    const agentId = await seedAgent(skill);
    const today = utcDayStart(new Date());
    await prisma.budgetLedger.create({ data: { agentId, period: today, costUsd: 0.07 } });
    await prisma.budgetLedger.create({ data: { agentId, period: new Date(today.getTime() - 2 * 86_400_000), costUsd: 0.5 } });
    await prisma.budgetLedger.create({ data: { agentId, period: new Date(today.getTime() - 9 * 86_400_000), costUsd: 99 } });
    await prisma.agentRun.create({ data: { agentId, status: 'success', trigger: 'manual', costUsd: 0.07, sourceCostUsd: 0.02 } });
    await put(await app(), '/prices/deepseek-chat', { inputPerMillionTokens: 0.3, outputPerMillionTokens: 1.2 });
    const a = await buildApp({ token: 'tok', logger, getSkills: () => [skill] });

    const res = (await a.inject({ url: '/costs', headers: AUTH })).json();

    expect(res.today).toBeCloseTo(0.07, 6);
    expect(res.days).toHaveLength(7);
    expect(res.days.at(-1).day).toBe(today.toISOString().slice(0, 10));
    expect(res.days.reduce((s: number, d: { costUsd: number }) => s + d.costUsd, 0)).toBeCloseTo(0.57, 6); // the 9-day-old row is not in the week
    expect(res.agents).toEqual([
      expect.objectContaining({ slug: skill.id, model: 'deepseek-chat', dailyUsdMax: 0.5, todayUsd: 0.07, todaySearchUsd: 0.02 }),
    ]);
    expect(res.globalCapSource).toMatch(/default|env/);
    const ds = res.prices.find((p: { model: string }) => p.model === 'deepseek-chat');
    expect(ds.custom).toEqual({ inputPerMillionTokens: 0.3, outputPerMillionTokens: 1.2 });
    expect(ds.builtIn.inputPerMillionTokens).toBeGreaterThan(0);
    expect(res.prices.map((p: { model: string }) => p.model)).not.toContain('static');
    expect((await a.inject({ url: '/costs' })).statusCode).toBe(401);
  });
});
