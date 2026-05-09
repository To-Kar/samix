import Anthropic from '@anthropic-ai/sdk';
import type {
  ModelAdapter,
  ModelId,
  NormalizedContentBlock,
  NormalizedRequest,
  NormalizedResponse,
} from '../types.js';

interface ClaudePricing {
  inputPerMillionTokens: number;
  outputPerMillionTokens: number;
}

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

  private readonly client: Anthropic;
  private readonly sdkModelId: string;

  constructor(modelId: Extract<ModelId, 'claude-haiku-4-5' | 'claude-sonnet-4-6'>) {
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
    const apiTools = req.tools?.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool['input_schema'],
    }));

    const messages = req.messages
      .filter((m) => m.role !== 'system')
      .map((m) => {
        if (m.contentBlocks?.length) {
          const content: Anthropic.MessageParam['content'] = m.contentBlocks.map((b) => {
            if (b.type === 'tool_use') {
              return { type: 'tool_use' as const, id: b.id, name: b.name, input: b.input };
            }
            if (b.type === 'tool_result') {
              return { type: 'tool_result' as const, tool_use_id: b.toolUseId, content: b.content, is_error: b.isError };
            }
            return { type: 'text' as const, text: b.text };
          });
          return { role: m.role as 'user' | 'assistant', content };
        }
        if (m.images?.length) {
          const content: Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam> = [
            { type: 'text', text: typeof m.content === 'string' ? m.content : '' },
            ...m.images.map((img): Anthropic.ImageBlockParam => ({
              type: 'image',
              source: {
                type: 'base64',
                media_type: img.mediaType,
                data: img.base64,
              },
            })),
          ];
          return { role: m.role as 'user' | 'assistant', content };
        }
        return {
          role: m.role as 'user' | 'assistant',
          content: m.content,
        };
      });

    const params: Anthropic.MessageCreateParams = {
      model: this.sdkModelId,
      max_tokens: req.maxTokens ?? 1024,
      temperature: req.temperature,
      system: req.systemPrompt,
      messages,
    };
    if (apiTools?.length) {
      params.tools = apiTools;
    }

    const response = await this.client.messages.create(params);

    const contentBlocks: NormalizedContentBlock[] = response.content.map((block) => {
      if (block.type === 'text') return { type: 'text' as const, text: block.text };
      if (block.type === 'tool_use') {
        return {
          type: 'tool_use' as const,
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        };
      }
      return { type: 'text' as const, text: '' };
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    const content = textBlock && textBlock.type === 'text' ? textBlock.text : '';

    return {
      content,
      contentBlocks,
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
