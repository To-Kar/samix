import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { registerAdapter, resolveAdapter } from '../src/adapters/index.js';
import { OllamaAdapter } from '../src/adapters/ollama.js';
import { logger } from '../src/logger.js';
import { askAgent } from '../src/runner/converse.js';
import { composeSystemPrompt } from '../src/runner/prompt.js';
import { computeCostUsd } from '../src/runner/budget.js';
import { runAgent } from '../src/runner/runner.js';
import { AI_MODE_KEY, clearCustomModel, clearInstructions, clearPriceOverride, deleteSetting, resetOllama, setSetting } from '../src/settings.js';
import { calling, finalAnswer, fakeAdapter, llmOutput, makeSkill, reactiveSkill, respond, scripted, seedAgent, sourceItems, toolCall, useAdapter, useRssItems } from './helpers.js';

const AUTH = { authorization: 'Bearer tok' };
const app = () => buildApp({ token: 'tok', logger, getSkills: () => [] });
const send = (a: Awaited<ReturnType<typeof app>>, method: 'PUT' | 'DELETE' | 'GET' | 'POST', url: string, payload?: unknown) =>
  a.inject({ method, url, headers: AUTH, ...(payload === undefined ? {} : { payload: payload as object }) });

const CUSTOM = { baseUrl: 'http://127.0.0.1:1234/v1/', model: 'my-model', tools: true, inputPerMillionTokens: 2, outputPerMillionTokens: 8 };

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await deleteSetting(AI_MODE_KEY);
  await clearCustomModel();
  await clearPriceOverride('custom');
  await resetOllama();
});

describe('AI mode', () => {
  it('is simple by default, switchable, and validated', async () => {
    const a = await app();
    expect((await send(a, 'GET', '/settings/ai')).json().mode).toBe('simple');
    expect((await send(a, 'PUT', '/settings/ai', { mode: 'advanced' })).json().mode).toBe('advanced');
    expect((await send(a, 'PUT', '/settings/ai', { mode: 'expert' })).statusCode).toBe(400);
    expect((await send(a, 'GET', '/settings/ai')).json().mode).toBe('advanced');
  });
});

describe('local model', () => {
  it('is set in the app in either mode, wins over the environment, and resets', async () => {
    vi.stubEnv('SAMIX_OLLAMA_URL', 'http://env-host:11434');
    const a = await app();
    expect((await send(a, 'GET', '/settings/ai')).json().ollama).toMatchObject({ url: 'http://env-host:11434', source: 'env' });

    const put = await send(a, 'PUT', '/settings/ollama', { url: 'http://10.0.0.5:11434/', model: 'qwen3:8b' });
    expect(put.json().ollama).toEqual({ url: 'http://10.0.0.5:11434', model: 'qwen3:8b', source: 'app' });

    const calls: { url: string; body: { model: string } }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ message: { content: 'hi' }, done_reason: 'stop' }), { status: 200 });
    });
    await new OllamaAdapter().generate({ systemPrompt: 's', messages: [{ role: 'user', content: 'x' }] });
    expect(calls[0]).toMatchObject({ url: 'http://10.0.0.5:11434/api/chat', body: { model: 'qwen3:8b' } });

    expect((await send(a, 'DELETE', '/settings/ollama')).json().ollama.source).toBe('env');
    expect((await send(a, 'PUT', '/settings/ollama', { url: 'ftp://x', model: 'm' })).statusCode).toBe(400);
    expect((await send(a, 'PUT', '/settings/ollama', { url: 'http://x', model: '' })).statusCode).toBe(400);
  });
});

describe('own model (custom)', () => {
  it('needs advanced mode, an endpoint and a price before it can be chosen or run', async () => {
    const a = await app();
    expect((await send(a, 'GET', '/models')).json().map((m: { id: string }) => m.id)).not.toContain('custom');

    // configured but still simple: remembered, not usable
    await send(a, 'PUT', '/settings/custom-model', CUSTOM);
    expect((await send(a, 'GET', '/models')).json().map((m: { id: string }) => m.id)).not.toContain('custom');
    expect(() => resolveAdapter('custom')).toThrow(/advanced/);
    expect((await send(a, 'GET', '/settings/ai')).json().custom).toMatchObject({ configured: true, usable: false });

    await send(a, 'PUT', '/settings/ai', { mode: 'advanced' });
    expect((await send(a, 'GET', '/models')).json().map((m: { id: string }) => m.id)).toContain('custom');
    expect(resolveAdapter('custom').pricing).toEqual({ inputPerMillionTokens: 2, outputPerMillionTokens: 8 });

    // back to simple: an agent that still points at it fails clearly instead of silently using something else
    await send(a, 'PUT', '/settings/ai', { mode: 'simple' });
    expect(() => resolveAdapter('custom')).toThrow(/advanced/);
  });

  it('refuses to run without a price, since the costs would be wrong', async () => {
    const a = await app();
    await send(a, 'PUT', '/settings/ai', { mode: 'advanced' });
    await send(a, 'PUT', '/settings/custom-model', CUSTOM);
    await send(a, 'DELETE', '/prices/custom');
    expect(() => resolveAdapter('custom')).toThrow(/no price/);
    expect((await send(a, 'GET', '/models')).json().map((m: { id: string }) => m.id)).not.toContain('custom');
  });

  it('rejects a missing price or a bad URL, and a cleared model disappears with its price', async () => {
    const a = await app();
    await send(a, 'PUT', '/settings/ai', { mode: 'advanced' });
    expect((await send(a, 'PUT', '/settings/custom-model', { ...CUSTOM, inputPerMillionTokens: undefined })).statusCode).toBe(400);
    expect((await send(a, 'PUT', '/settings/custom-model', { ...CUSTOM, baseUrl: 'file:///etc/passwd' })).statusCode).toBe(400);
    await send(a, 'PUT', '/settings/custom-model', CUSTOM);
    await send(a, 'DELETE', '/settings/custom-model');
    expect(() => resolveAdapter('custom')).toThrow(/not configured/);
    expect((await send(a, 'GET', '/settings/ai')).json().custom).toMatchObject({ configured: false, inputPerMillionTokens: null });
  });

  it('talks to the configured endpoint with the configured name, sends a key only if one is set, and is billed at the entered price', async () => {
    const a = await app();
    await send(a, 'PUT', '/settings/ai', { mode: 'advanced' });
    await send(a, 'PUT', '/settings/custom-model', CUSTOM);
    const seen: { url: string; headers: Record<string, string>; body: { model: string } }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: { headers: Record<string, string>; body: string }) => {
      seen.push({ url, headers: init.headers, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 } }), { status: 200 });
    });

    const adapter = resolveAdapter('custom');
    const res = await adapter.generate({ systemPrompt: 's', messages: [{ role: 'user', content: 'x' }] });
    expect(seen[0]).toMatchObject({ url: 'http://127.0.0.1:1234/v1/chat/completions', body: { model: 'my-model' } });
    expect(seen[0]!.headers).not.toHaveProperty('Authorization');
    expect(computeCostUsd(adapter, res.usage.inputTokens, res.usage.outputTokens)).toBe(10);

    vi.stubEnv('CUSTOM_API_KEY', 'sekret');
    await adapter.generate({ systemPrompt: 's', messages: [{ role: 'user', content: 'x' }] });
    expect(seen[1]!.headers).toMatchObject({ Authorization: 'Bearer sekret' });
    expect(adapter.supportsTools).toBe(true);
  });

  it('cannot be chosen as an agent model before it is usable', async () => {
    const skill = makeSkill();
    await seedAgent(skill);
    const a = await buildApp({ token: 'tok', logger, getSkills: () => [skill] });
    expect((await send(a, 'PUT', `/agents/${skill.id}/model`, { primary: 'custom' })).statusCode).toBe(400);
    expect((await send(a, 'POST', '/models/use', { primary: 'custom' })).statusCode).toBe(400);
  });
});

describe('extra instructions', () => {
  it('are stored per agent, trimmed, limited, and cleared with empty text', async () => {
    const skill = makeSkill();
    const a = await buildApp({ token: 'tok', logger, getSkills: () => [skill] });
    expect((await send(a, 'GET', `/agents/${skill.id}/instructions`)).json()).toEqual({ text: '', active: false });
    expect((await send(a, 'PUT', `/agents/${skill.id}/instructions`, { text: '  Kurz fassen.  ' })).json()).toEqual({ text: 'Kurz fassen.', active: false });
    expect((await send(a, 'PUT', `/agents/${skill.id}/instructions`, { text: 'x'.repeat(2001) })).statusCode).toBe(400);
    expect((await send(a, 'GET', `/agents/nope/instructions`)).statusCode).toBe(404);
    await send(a, 'PUT', '/settings/ai', { mode: 'advanced' });
    expect((await send(a, 'GET', `/agents/${skill.id}/instructions`)).json().active).toBe(true);
    await send(a, 'PUT', `/agents/${skill.id}/instructions`, { text: '   ' });
    expect((await send(a, 'GET', `/agents/${skill.id}/instructions`)).json()).toEqual({ text: '', active: false });
  });

  it('are appended after the skill prompt in advanced mode only', async () => {
    const skill = makeSkill();
    const a = await buildApp({ token: 'tok', logger, getSkills: () => [skill] });
    await send(a, 'PUT', `/agents/${skill.id}/instructions`, { text: 'Antworte knapp.' });
    expect(composeSystemPrompt(skill)).toBe(skill.systemPrompt);

    await setSetting(AI_MODE_KEY, 'advanced');
    const composed = composeSystemPrompt(skill);
    expect(composed.startsWith(skill.systemPrompt)).toBe(true);
    expect(composed).toContain('Antworte knapp.');
    await clearInstructions(skill.id);
  });

  it('reach the model in article runs and in questions', async () => {
    await setSetting(AI_MODE_KEY, 'advanced');

    const items = sourceItems(6);
    useRssItems(items);
    const claude = fakeAdapter('claude-haiku-4-5', async () => respond(llmOutput(items.slice(0, 5).map((i) => i.url))));
    useAdapter(claude);
    const news = makeSkill();
    news.manifest.dedupeDays = 0;
    await seedAgent(news);
    await setSetting(`instructions:${news.id}`, 'Nur Hardware-Themen.');
    await runAgent({ skill: news, trigger: 'manual', logger });
    expect(claude.generate.mock.calls[0]![0].systemPrompt).toContain('Nur Hardware-Themen.');

    const skill = reactiveSkill();
    await seedAgent(skill);
    await setSetting(`instructions:${skill.id}`, 'Antworte in einem Satz.');
    const { adapter, requests } = scripted([() => calling(toolCall('search_articles', { query: 'x' })), () => finalAnswer('ok', [])]);
    registerAdapter(adapter.name, () => adapter);
    await askAgent({ skill, question: 'Was gibt es?' });
    expect(requests[0]!.systemPrompt).toContain('Antworte in einem Satz.');
    await clearInstructions(news.id);
    await clearInstructions(skill.id);
  });
});
