import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClaudeAdapter, toAnthropicMessages } from '../src/adapters/claude.js';
import { DeepSeekAdapter } from '../src/adapters/deepseek.js';
import { OllamaAdapter } from '../src/adapters/ollama.js';
import { PerplexityAdapter } from '../src/adapters/perplexity.js';
import { StaticAdapter } from '../src/adapters/static.js';
import type { NormalizedMessage, ToolSpec } from '../src/types.js';

const SEARCH: ToolSpec = {
  name: 'search_articles',
  description: 'Search the collected articles',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
};

const conversation: NormalizedMessage[] = [
  { role: 'user', content: 'Was gab es zu Sprachmodellen?' },
  {
    role: 'assistant',
    content: 'Ich suche.',
    toolCalls: [
      { id: 't1', name: 'search_articles', input: { query: 'Sprachmodell' } },
      { id: 't2', name: 'search_articles', input: { query: 'LLM' } },
    ],
  },
  { role: 'tool', toolCallId: 't1', content: '[{"articleId":"a1"}]' },
  { role: 'tool', toolCallId: 't2', content: 'boom', isError: true },
];

describe('ClaudeAdapter tool use', () => {
  it('merges consecutive tool results into one user message, with tool_use blocks on the assistant turn', () => {
    expect(toAnthropicMessages(conversation)).toEqual([
      { role: 'user', content: 'Was gab es zu Sprachmodellen?' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Ich suche.' },
          { type: 'tool_use', id: 't1', name: 'search_articles', input: { query: 'Sprachmodell' } },
          { type: 'tool_use', id: 't2', name: 'search_articles', input: { query: 'LLM' } },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 't1', content: '[{"articleId":"a1"}]' },
          { type: 'tool_result', tool_use_id: 't2', content: 'boom', is_error: true },
        ],
      },
    ]);
  });

  it('leaves plain conversations as they were, and drops system messages', () => {
    expect(toAnthropicMessages([{ role: 'system', content: 's' }, { role: 'user', content: 'hi' }, { role: 'assistant', content: 'yo' }])).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'yo' },
    ]);
  });

  it('sends tools as input_schema and maps tool_use blocks back', async () => {
    const create = vi.fn(async () => ({
      content: [
        { type: 'text', text: 'Moment.' },
        { type: 'tool_use', id: 'toolu_1', name: 'search_articles', input: { query: 'KI' } },
      ],
      usage: { input_tokens: 100, output_tokens: 20 },
      stop_reason: 'tool_use',
    }));
    const adapter = new ClaudeAdapter('claude-haiku-4-5', { messages: { create } } as never);

    const res = await adapter.generate({ systemPrompt: 'sys', messages: conversation.slice(0, 1), tools: [SEARCH], maxTokens: 500 });

    const [params] = create.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(params.tools).toEqual([{ name: 'search_articles', description: SEARCH.description, input_schema: SEARCH.inputSchema }]);
    expect(res).toMatchObject({
      content: 'Moment.',
      stopReason: 'tool_use',
      usage: { inputTokens: 100, outputTokens: 20 },
      toolCalls: [{ id: 'toolu_1', name: 'search_articles', input: { query: 'KI' } }],
    });
  });

  it('omits the tools field when there are none (requests without tools are unchanged)', async () => {
    const create = vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn' }));
    await new ClaudeAdapter('claude-haiku-4-5', { messages: { create } } as never).generate({ systemPrompt: 's', messages: [{ role: 'user', content: 'x' }] });
    expect(create.mock.calls[0]![0]).not.toHaveProperty('tools');
  });

  it('declares tool support', () => {
    expect(new ClaudeAdapter('claude-haiku-4-5', { messages: { create: vi.fn() } } as never).supportsTools).toBe(true);
  });
});

describe('DeepSeekAdapter tool use', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  const reply = (message: unknown, finish = 'tool_calls') =>
    new Response(JSON.stringify({ choices: [{ message, finish_reason: finish }], usage: { prompt_tokens: 50, completion_tokens: 10 } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  const run = async (message: unknown) => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'k');
    const fetchMock = vi.fn(async () => reply(message));
    vi.stubGlobal('fetch', fetchMock);
    const out = await new DeepSeekAdapter().generate({ systemPrompt: 'sys', messages: conversation, tools: [SEARCH] });
    return { out, body: JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string) };
  };

  it('sends OpenAI-style tools, tool_calls and tool messages', async () => {
    const { body } = await run({ content: 'x' });
    expect(body.tools).toEqual([{ type: 'function', function: { name: 'search_articles', description: SEARCH.description, parameters: SEARCH.inputSchema } }]);
    expect(body.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'Was gab es zu Sprachmodellen?' },
      {
        role: 'assistant',
        content: 'Ich suche.',
        tool_calls: [
          { id: 't1', type: 'function', function: { name: 'search_articles', arguments: '{"query":"Sprachmodell"}' } },
          { id: 't2', type: 'function', function: { name: 'search_articles', arguments: '{"query":"LLM"}' } },
        ],
      },
      { role: 'tool', tool_call_id: 't1', content: '[{"articleId":"a1"}]' },
      { role: 'tool', tool_call_id: 't2', content: 'boom' },
    ]);
  });

  it('parses tool_calls from the response, including a call without text content', async () => {
    const { out } = await run({
      content: null,
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search_articles', arguments: '{"query":"KI","limit":3}' } }],
    });
    expect(out.content).toBe('');
    expect(out.stopReason).toBe('tool_calls');
    expect(out.toolCalls).toEqual([{ id: 'c1', name: 'search_articles', input: { query: 'KI', limit: 3 } }]);
  });

  it('flags malformed arguments instead of throwing; empty arguments mean {}', async () => {
    const { out } = await run({
      tool_calls: [
        { id: 'c1', function: { name: 'search_articles', arguments: '{"query": ' } },
        { id: 'c2', function: { name: 'list_ressorts', arguments: '' } },
        { function: { name: 'list_ressorts', arguments: '{}' } },
      ],
    });
    expect(out.toolCalls[0]).toMatchObject({ id: 'c1', parseError: expect.stringContaining('not valid JSON') });
    expect(out.toolCalls[1]).toEqual({ id: 'c2', name: 'list_ressorts', input: {} });
    expect(out.toolCalls[2]!.id).toBe('call_2'); // generated when the provider sent none
  });

  it('leaves requests without tools unchanged', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'k');
    const fetchMock = vi.fn(async () => reply({ content: 'ok' }, 'stop'));
    vi.stubGlobal('fetch', fetchMock);
    await new DeepSeekAdapter().generate({ systemPrompt: 's', messages: [{ role: 'user', content: 'x' }] });
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).not.toHaveProperty('tools');
  });
});

describe('adapters without tool support refuse tools', () => {
  it.each([
    ['ollama', () => new OllamaAdapter()],
    ['perplexity', () => new PerplexityAdapter()],
    ['static', () => new StaticAdapter()],
  ])('%s', async (_name, make) => {
    const adapter = make();
    expect(adapter.supportsTools).toBe(false);
    await expect(adapter.generate({ systemPrompt: 's', messages: [{ role: 'user', content: 'x' }], tools: [SEARCH] })).rejects.toThrow(/does not support tool use/);
    await expect(adapter.generate({ systemPrompt: 's', messages: [{ role: 'tool', toolCallId: 'x', content: 'y' }] })).rejects.toThrow(/does not support tool use/);
  });
});
