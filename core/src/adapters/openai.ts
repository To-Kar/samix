import OpenAI from 'openai';
import type {
  ModelAdapter,
  ModelId,
  NormalizedRequest,
  NormalizedResponse,
} from '../types.js';

interface OpenAIPricing {
  inputPerMillionTokens: number;
  outputPerMillionTokens: number;
}

// Pricing per million tokens as of 2026-05 (verify before production use).
const PRICING: Record<string, OpenAIPricing> = {
  'gpt-4o-mini': { inputPerMillionTokens: 0.15, outputPerMillionTokens: 0.60 },
  'gpt-4o':      { inputPerMillionTokens: 2.50, outputPerMillionTokens: 10.00 },
};

export class OpenAIAdapter implements ModelAdapter {
  readonly name: ModelId;
  readonly supportsTools = true;
  readonly supportsSearch = false;
  readonly pricing: OpenAIPricing;

  private readonly client: OpenAI;
  private readonly sdkModelId: string;

  constructor(modelId: Extract<ModelId, 'gpt-4o-mini' | 'gpt-4o'>) {
    const pricing = PRICING[modelId];
    if (!pricing) throw new Error(`OpenAIAdapter: unsupported model id "${modelId}"`);
    this.name = modelId;
    this.pricing = pricing;
    this.sdkModelId = modelId;
    this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  async generate(req: NormalizedRequest): Promise<NormalizedResponse> {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: req.systemPrompt },
      ...req.messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    ];

    const response = await this.client.chat.completions.create({
      model: this.sdkModelId,
      max_tokens: req.maxTokens ?? 1024,
      temperature: req.temperature,
      messages,
    });

    const content = response.choices[0]?.message?.content ?? '';
    const usage = response.usage;

    return {
      content,
      toolCalls: [],
      citations: [],
      usage: {
        inputTokens: usage?.prompt_tokens ?? 0,
        outputTokens: usage?.completion_tokens ?? 0,
      },
      stopReason: response.choices[0]?.finish_reason ?? 'unknown',
    };
  }
}
