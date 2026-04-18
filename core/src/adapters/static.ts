import type {
  ModelAdapter,
  NormalizedRequest,
  NormalizedResponse,
} from '../types.js';

export class StaticAdapter implements ModelAdapter {
  readonly name = 'static' as const;
  readonly supportsTools = false;
  readonly supportsSearch = false;
  readonly pricing = { inputPerMillionTokens: 0, outputPerMillionTokens: 0 };

  async generate(req: NormalizedRequest): Promise<NormalizedResponse> {
    return {
      content: req.systemPrompt,
      toolCalls: [],
      citations: [],
      usage: { inputTokens: 0, outputTokens: 0 },
      stopReason: 'static',
    };
  }
}
