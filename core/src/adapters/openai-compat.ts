import type {
  ModelAdapter,
  ModelId,
  NormalizedMessage,
  NormalizedRequest,
  NormalizedResponse,
  ToolCall,
} from '../types.js';

// The OpenAI chat-completions protocol over plain fetch (no provider SDK),
// shared by DeepSeek and the reader's own endpoint ("custom"). Request and
// response shapes are tested against fakes only.

const DEFAULT_TIMEOUT_MS = 120_000;

interface WireToolCall {
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface ChatCompletionResponse {
  choices?: {
    message?: { content?: string | null; tool_calls?: WireToolCall[] };
    finish_reason?: string;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export interface OpenAICompatConfig {
  name: ModelId;
  /** Shown in errors ("DeepSeek HTTP 401: …"). */
  label: string;
  baseUrl: string;
  model: string;
  pricing: { inputPerMillionTokens: number; outputPerMillionTokens: number };
  supportsTools: boolean;
  /** Where the key comes from; a missing key is an error only if `keyRequired`. */
  keyEnv: string;
  keyRequired: boolean;
}

export class OpenAICompatAdapter implements ModelAdapter {
  readonly name: ModelId;
  readonly supportsTools: boolean;
  readonly supportsSearch = false;
  readonly pricing: { inputPerMillionTokens: number; outputPerMillionTokens: number };

  constructor(protected readonly cfg: OpenAICompatConfig) {
    this.name = cfg.name;
    this.supportsTools = cfg.supportsTools;
    this.pricing = cfg.pricing;
  }

  async generate(req: NormalizedRequest): Promise<NormalizedResponse> {
    const { label, baseUrl, model, keyEnv, keyRequired } = this.cfg;
    const apiKey = process.env[keyEnv];
    if (!apiKey && keyRequired) throw new Error(`${keyEnv} not set`);

    const messages = [
      { role: 'system', content: req.systemPrompt },
      ...req.messages.filter((m) => m.role !== 'system').map(toWireMessage),
    ];
    const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    let res: Response;
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: req.maxTokens,
          temperature: req.temperature,
          stream: false,
          ...(req.tools?.length
            ? {
                tools: req.tools.map((t) => ({
                  type: 'function',
                  function: { name: t.name, description: t.description, parameters: t.inputSchema },
                })),
              }
            : {}),
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') {
        throw new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`);
      }
      throw err;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`${label} HTTP ${res.status}: ${body.slice(0, 500)}`);
    }

    const data = (await res.json()) as ChatCompletionResponse;
    const choice = data.choices?.[0];
    return {
      content: choice?.message?.content ?? '',
      toolCalls: (choice?.message?.tool_calls ?? []).map(fromWireToolCall),
      citations: [],
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
      },
      stopReason: choice?.finish_reason ?? 'unknown',
    };
  }
}

function toWireMessage(m: NormalizedMessage): Record<string, unknown> {
  if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
  if (m.role === 'assistant' && m.toolCalls?.length) {
    return {
      role: 'assistant',
      content: m.content || null,
      tool_calls: m.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: JSON.stringify(tc.input ?? {}) },
      })),
    };
  }
  return { role: m.role, content: m.content };
}

// The provider sends arguments as a JSON *string*, and models do get it wrong.
// A bad one becomes a tool error the model can see, not an exception.
function fromWireToolCall(tc: WireToolCall, index: number): ToolCall {
  const id = tc.id ?? `call_${index}`;
  const name = tc.function?.name ?? '';
  const raw = tc.function?.arguments ?? '{}';
  try {
    return { id, name, input: raw.trim() === '' ? {} : JSON.parse(raw) };
  } catch {
    return { id, name, input: undefined, parseError: 'arguments are not valid JSON' };
  }
}
