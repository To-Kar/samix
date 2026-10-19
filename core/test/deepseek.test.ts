import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeepSeekAdapter } from '../src/adapters/deepseek.js';
import { resolveAdapter } from '../src/adapters/index.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('DeepSeekAdapter', () => {
  it('is registered under the manifest id', () => {
    expect(resolveAdapter('deepseek-chat').name).toBe('deepseek-chat');
  });

  it('sends an OpenAI-style request and maps the response', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'sk-test');
    const fetchMock = vi.fn(async () =>
      reply({
        choices: [{ message: { content: '{"items":[]}' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 120, completion_tokens: 30 },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const out = await new DeepSeekAdapter().generate({
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 500,
    });

    expect(out).toMatchObject({ content: '{"items":[]}', stopReason: 'stop', usage: { inputTokens: 120, outputTokens: 30 } });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ model: 'deepseek-chat', max_tokens: 500, stream: false });
    expect(body.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
    ]);
  });

  it('fails without a key, before any network call', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(new DeepSeekAdapter().generate({ systemPrompt: 's', messages: [] })).rejects.toThrow(/DEEPSEEK_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces HTTP errors so the fallback chain can react', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'sk-test');
    vi.stubGlobal('fetch', vi.fn(async () => reply({ error: 'Insufficient Balance' }, 402)));
    await expect(new DeepSeekAdapter().generate({ systemPrompt: 's', messages: [] })).rejects.toThrow(/HTTP 402/);
  });

  it('defaults to the conservative price and allows overriding price, model and URL', () => {
    expect(new DeepSeekAdapter().pricing).toEqual({ inputPerMillionTokens: 0.27, outputPerMillionTokens: 1.1 });

    vi.stubEnv('SAMIX_DEEPSEEK_PRICE_IN', '0.14');
    vi.stubEnv('SAMIX_DEEPSEEK_PRICE_OUT', '0.28');
    expect(new DeepSeekAdapter().pricing).toEqual({ inputPerMillionTokens: 0.14, outputPerMillionTokens: 0.28 });

    vi.stubEnv('SAMIX_DEEPSEEK_PRICE_IN', 'abc');
    expect(() => new DeepSeekAdapter()).toThrow(/SAMIX_DEEPSEEK_PRICE_IN/);
  });

  it('honours model and base URL overrides', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'k');
    vi.stubEnv('SAMIX_DEEPSEEK_URL', 'https://example.test/v1/');
    vi.stubEnv('SAMIX_DEEPSEEK_MODEL', 'deepseek-v4-flash');
    const fetchMock = vi.fn(async () => reply({ choices: [{ message: { content: 'x' } }] }));
    vi.stubGlobal('fetch', fetchMock);
    await new DeepSeekAdapter().generate({ systemPrompt: 's', messages: [] });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://example.test/v1/chat/completions');
    expect(JSON.parse(init.body as string).model).toBe('deepseek-v4-flash');
  });
});
