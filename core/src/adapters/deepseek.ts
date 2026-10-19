import type {
  ModelAdapter,
  ModelId,
  NormalizedMessage,
  NormalizedRequest,
  NormalizedResponse,
  ToolCall,
} from '../types.js';

// DeepSeek speaks the OpenAI chat-completions protocol, so this is plain
// fetch like the Ollama and Perplexity adapters — no provider SDK.
//
// UNVERIFIED defaults: when this adapter was written, DeepSeek's own docs
// were unreachable from the build environment, and third-party sources
// disagreed on prices and on which model name `deepseek-chat` maps to. So:
//   - the default price is the HIGHER of the figures seen ($0.27 / $1.10 per
//     million tokens). BudgetLedger and the pre-call budget gate therefore
//     over-estimate rather than under-estimate;
//   - price, model name and base URL are all overridable by environment.
// Check https://api-docs.deepseek.com/quick_start/pricing and set
// SAMIX_DEEPSEEK_PRICE_IN / SAMIX_DEEPSEEK_PRICE_OUT to the real values.
// Cache-hit discounts are not modelled (they only make the real bill lower).

const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-chat';
const DEFAULT_PRICE_IN = 0.27;
const DEFAULT_PRICE_OUT = 1.1;
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

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${name} must be a non-negative number, got "${raw}"`);
  }
  return n;
}

export class DeepSeekAdapter implements ModelAdapter {
  readonly name: ModelId = 'deepseek-chat';
  // Request/response shape follows the OpenAI function-calling format and is
  // tested against fakes. UNVERIFIED against DeepSeek's real API (docs were
  // unreachable): whether and how reliably deepseek-chat calls tools is open.
  readonly supportsTools = true;
  readonly supportsSearch = false;
  readonly pricing: { inputPerMillionTokens: number; outputPerMillionTokens: number };

  private readonly baseUrl: string;
  private readonly model: string;

  constructor() {
    this.baseUrl = (process.env.SAMIX_DEEPSEEK_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.model = process.env.SAMIX_DEEPSEEK_MODEL || DEFAULT_MODEL;
    this.pricing = {
      inputPerMillionTokens: envNumber('SAMIX_DEEPSEEK_PRICE_IN', DEFAULT_PRICE_IN),
      outputPerMillionTokens: envNumber('SAMIX_DEEPSEEK_PRICE_OUT', DEFAULT_PRICE_OUT),
    };
  }

  async generate(req: NormalizedRequest): Promise<NormalizedResponse> {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) throw new Error('DEEPSEEK_API_KEY not set');

    const messages = [
      { role: 'system', content: req.systemPrompt },
      ...req.messages.filter((m) => m.role !== 'system').map(toWireMessage),
    ];
    const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
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
        throw new Error(`DeepSeek timed out after ${Math.round(timeoutMs / 1000)}s`);
      }
      throw err;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`DeepSeek HTTP ${res.status}: ${body.slice(0, 500)}`);
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
