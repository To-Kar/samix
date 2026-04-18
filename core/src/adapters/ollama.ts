import type {
  ModelAdapter,
  ModelId,
  NormalizedRequest,
  NormalizedResponse,
} from '../types.js';

export class OllamaUnreachable extends Error {
  constructor(public readonly base: string, cause?: unknown) {
    super(`Ollama unreachable at ${base}`);
    this.name = 'OllamaUnreachable';
    if (cause !== undefined) this.cause = cause;
  }
}

interface OllamaChatResponse {
  message?: { role: string; content: string };
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

export class OllamaAdapter implements ModelAdapter {
  readonly name: ModelId = 'ollama-llama3';
  readonly supportsTools = false;
  readonly supportsSearch = false;
  readonly pricing = { inputPerMillionTokens: 0, outputPerMillionTokens: 0 };

  private readonly base: string;
  // VERIFY: different installs may have different model tags (llama3.2,
  // llama3.1:8b, etc.). Phase 1 hardcodes `llama3`; a future ModelId scheme
  // should parameterize the tag.
  private readonly model = 'llama3';

  constructor(base = 'http://127.0.0.1:11434') {
    this.base = base;
  }

  async generate(req: NormalizedRequest): Promise<NormalizedResponse> {
    const messages = [
      { role: 'system', content: req.systemPrompt },
      ...req.messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    let res: Response;
    try {
      res = await fetch(`${this.base}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages,
          stream: false,
          options: {
            temperature: req.temperature,
            num_predict: req.maxTokens,
          },
        }),
      });
    } catch (err) {
      throw new OllamaUnreachable(this.base, err);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Ollama HTTP ${res.status}: ${body}`);
    }

    const data = (await res.json()) as OllamaChatResponse;
    return {
      content: data.message?.content ?? '',
      toolCalls: [],
      citations: [],
      usage: {
        inputTokens: data.prompt_eval_count ?? 0,
        outputTokens: data.eval_count ?? 0,
      },
      stopReason: data.done_reason ?? 'unknown',
    };
  }
}
