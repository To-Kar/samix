import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { registerAdapter } from '../src/adapters/index.js';
import { prisma } from '../src/db/prisma.js';
import { logger } from '../src/logger.js';
import { fakeAdapter, makeSkill, respond, seedAgent } from './helpers.js';

const AUTH = { authorization: 'Bearer tok' };
const saved = process.env.DEEPSEEK_API_KEY;
const savedCap = process.env.SAMIX_GLOBAL_DAILY_USD_MAX;
afterEach(() => {
  if (saved === undefined) delete process.env.DEEPSEEK_API_KEY;
  else process.env.DEEPSEEK_API_KEY = saved;
  if (savedCap === undefined) delete process.env.SAMIX_GLOBAL_DAILY_USD_MAX;
  else process.env.SAMIX_GLOBAL_DAILY_USD_MAX = savedCap;
});

const post = (app: Awaited<ReturnType<typeof buildApp>>, model: string) =>
  app.inject({ method: 'POST', url: '/models/test', headers: AUTH, payload: { model } });

describe('POST /models/test', () => {
  it('says "key_missing" without calling the model', async () => {
    delete process.env.DEEPSEEK_API_KEY;
    const a = fakeAdapter('deepseek-chat', async () => respond('ok'));
    registerAdapter('deepseek-chat', () => a);
    const app = await buildApp({ token: 'tok', logger, getSkills: () => [] });
    expect((await post(app, 'deepseek-chat')).json()).toMatchObject({ ok: false, error: 'key_missing' });
    expect(a.generate).not.toHaveBeenCalled();
  });

  it('makes one tiny request, books the cost to an agent that uses the model, and reports ok', async () => {
    process.env.DEEPSEEK_API_KEY = 'k';
    const a = fakeAdapter('deepseek-chat', async () => respond('ok', { in: 20, out: 2 }), { inputPerMillionTokens: 1000, outputPerMillionTokens: 2000 });
    registerAdapter('deepseek-chat', () => a);
    const skill = makeSkill({ primary: 'deepseek-chat' });
    await seedAgent(skill);
    const app = await buildApp({ token: 'tok', logger, getSkills: () => [skill] });

    const r = (await post(app, 'deepseek-chat')).json();

    expect(r).toMatchObject({ ok: true, booked: true });
    expect(r.costUsd).toBeCloseTo(0.024, 6);
    expect(a.generate).toHaveBeenCalledTimes(1);
    expect(a.generate.mock.calls[0]![0]).toMatchObject({ maxTokens: 16 });
    const ledger = await prisma.budgetLedger.findFirstOrThrow({ where: { agent: { slug: skill.id } } });
    expect(ledger.costUsd).toBeCloseTo(0.024, 6);
  });

  it('reports the provider error text instead of throwing', async () => {
    process.env.DEEPSEEK_API_KEY = 'k';
    registerAdapter('deepseek-chat', () =>
      fakeAdapter('deepseek-chat', async () => {
        throw new Error('401 invalid api key');
      })
    );
    const app = await buildApp({ token: 'tok', logger, getSkills: () => [] });
    expect((await post(app, 'deepseek-chat')).json()).toMatchObject({ ok: false, error: '401 invalid api key', booked: false });
  });

  it('respects the global daily cap and rejects unknown models', async () => {
    process.env.DEEPSEEK_API_KEY = 'k';
    process.env.SAMIX_GLOBAL_DAILY_USD_MAX = '0.0000000001';
    const a = fakeAdapter('deepseek-chat', async () => respond('ok'), { inputPerMillionTokens: 1000, outputPerMillionTokens: 1000 });
    registerAdapter('deepseek-chat', () => a);
    const app = await buildApp({ token: 'tok', logger, getSkills: () => [] });
    expect((await post(app, 'deepseek-chat')).json()).toMatchObject({ ok: false, error: 'global_budget_exceeded' });
    expect(a.generate).not.toHaveBeenCalled();
    expect((await post(app, 'gpt-5')).statusCode).toBe(400);
    expect((await post(app, 'static')).statusCode).toBe(400);
  });
});
