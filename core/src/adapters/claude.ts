import Anthropic from '@anthropic-ai/sdk';
import type {
  ModelAdapter,
  ModelId,
  NormalizedRequest,
  NormalizedResponse,
} from '../types.js';

// Phase 0: stub. Interface wired, but runtime is not exercised —
// hello-world uses StaticAdapter. Kept here so Phase 1 can enable
// it by changing the skill manifest only.

interface ClaudePricing {
  inputPerMillionTokens: number;
  outputPerMillionTokens: number;
}

// VERIFY: Pricing numbers should be re-checked against the current
// Anthropic pricing page before any real call is enabled in Phase 1.
const PRICING: Record<string, ClaudePricing> = {
  'claude-haiku-4-5': { inputPerMillionTokens: 1.0, outputPerMillionTokens: 5.0 },
  'claude-sonnet-4-5': { inputPerMillionTokens: 3.0, outputPerMillionTokens: 15.0 },
};

const SDK_MODEL_ID: Record<string, string> = {
  'claude-haiku-4-5': 'claude-haiku-4-5',
  'claude-sonnet-4-5': 'claude-sonnet-4-5',
};

export class ClaudeAdapter implements ModelAdapter {
  readonly name: ModelId;
  readonly supportsTools = true;
  readonly supportsSearch = false;
  readonly pricing: ClaudePricing;

  private readonly client: Anthropic;
  private readonly sdkModelId: string;

  constructor(modelId: Extract<ModelId, 'claude-haiku-4-5' | 'claude-sonnet-4-5'>) {
    const pricing = PRICING[modelId];
    const sdkModelId = SDK_MODEL_ID[modelId];
    if (!pricing || !sdkModelId) {
      throw new Error(`ClaudeAdapter: unsupported model id "${modelId}"`);
    }
    this.name = modelId;
    this.pricing = pricing;
    this.sdkModelId = sdkModelId;
    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }

  async generate(req: NormalizedRequest): Promise<NormalizedResponse> {
    const response = await this.client.messages.create({
      model: this.sdkModelId,
      max_tokens: req.maxTokens ?? 1024,
      temperature: req.temperature,
      system: req.systemPrompt,
      messages: req.messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    const content = textBlock && textBlock.type === 'text' ? textBlock.text : '';

    return {
      content,
      toolCalls: [],
      citations: [],
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
      stopReason: response.stop_reason ?? 'unknown',
    };
  }
}
