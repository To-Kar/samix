import Anthropic from '@anthropic-ai/sdk';
import type {
  ModelAdapter,
  ModelId,
  NormalizedMessage,
  NormalizedRequest,
  NormalizedResponse,
  ToolCall,
} from '../types.js';

interface ClaudePricing {
  inputPerMillionTokens: number;
  outputPerMillionTokens: number;
}

// USD per million tokens. Checked against
// https://platform.claude.com/docs/en/about-claude/pricing on 2026-10-19.
// Re-check when adding a model: BudgetLedger trusts these numbers.
const PRICING: Record<string, ClaudePricing> = {
  'claude-haiku-4-5': { inputPerMillionTokens: 1.0, outputPerMillionTokens: 5.0 },
  'claude-sonnet-4-6': { inputPerMillionTokens: 3.0, outputPerMillionTokens: 15.0 },
};

const SDK_MODEL_ID: Record<string, string> = {
  'claude-haiku-4-5': 'claude-haiku-4-5',
  'claude-sonnet-4-6': 'claude-sonnet-4-6',
};

export class ClaudeAdapter implements ModelAdapter {
  readonly name: ModelId;
  readonly supportsTools = true;
  readonly supportsSearch = false;
  readonly pricing: ClaudePricing;

  private readonly client: Pick<Anthropic, 'messages'>;
  private readonly sdkModelId: string;

  // `client` is injectable so tests can check the wire format without a network.
  constructor(
    modelId: Extract<ModelId, 'claude-haiku-4-5' | 'claude-sonnet-4-6'>,
    client?: Pick<Anthropic, 'messages'>
  ) {
    const pricing = PRICING[modelId];
    const sdkModelId = SDK_MODEL_ID[modelId];
    if (!pricing || !sdkModelId) {
      throw new Error(`ClaudeAdapter: unsupported model id "${modelId}"`);
    }
    this.name = modelId;
    this.pricing = pricing;
    this.sdkModelId = sdkModelId;
    this.client =
      client ??
      new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });
  }

  async generate(req: NormalizedRequest): Promise<NormalizedResponse> {
    const response = await this.client.messages.create(
      {
        model: this.sdkModelId,
        max_tokens: req.maxTokens ?? 1024,
        temperature: req.temperature,
        system: req.systemPrompt,
        messages: toAnthropicMessages(req.messages),
        ...(req.tools?.length
          ? {
              tools: req.tools.map((t) => ({
                name: t.name,
                description: t.description,
                input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
              })),
            }
          : {}),
      },
      req.timeoutMs ? { timeout: req.timeoutMs } : undefined
    );

    const content = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    const toolCalls: ToolCall[] = response.content
      .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
      .map((b) => ({ id: b.id, name: b.name, input: b.input }));

    return {
      content,
      toolCalls,
      citations: [],
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
      stopReason: response.stop_reason ?? 'unknown',
    };
  }
}

// Anthropic wants tool results as `tool_result` blocks inside a *user*
// message, and all results answering one assistant turn in the same message.
export function toAnthropicMessages(messages: NormalizedMessage[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue;

    if (m.role === 'tool') {
      const block: Anthropic.ToolResultBlockParam = {
        type: 'tool_result',
        tool_use_id: m.toolCallId,
        content: m.content,
        ...(m.isError ? { is_error: true } : {}),
      };
      const last = out[out.length - 1];
      if (last && last.role === 'user' && Array.isArray(last.content) && last.content.every((b) => b.type === 'tool_result')) {
        last.content.push(block);
      } else {
        out.push({ role: 'user', content: [block] });
      }
    } else if (m.role === 'assistant' && m.toolCalls?.length) {
      out.push({
        role: 'assistant',
        content: [
          ...(m.content ? [{ type: 'text' as const, text: m.content }] : []),
          ...m.toolCalls.map((tc) => ({ type: 'tool_use' as const, id: tc.id, name: tc.name, input: tc.input })),
        ],
      });
    } else {
      out.push({ role: m.role, content: m.content });
    }
  }
  return out;
}
