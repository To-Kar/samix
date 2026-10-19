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

const DEFAULT_TIMEOUT_MS = 300_000;

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
  // Installs differ in which tag they pulled (llama3.2, llama3.1:8b, …), so
  // the tag is configurable. The ModelId stays `ollama-llama3`.
  private readonly model: string;

  constructor(
    base = process.env.SAMIX_OLLAMA_URL ?? 'http://127.0.0.1:11434',
    model = process.env.SAMIX_OLLAMA_MODEL ?? 'llama3'
  ) {
    this.base = base;
    this.model = model;
  }

  async generate(req: NormalizedRequest): Promise<NormalizedResponse> {
    const messages = [
      { role: 'system', content: req.systemPrompt },
      ...req.messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    // Cold-starting a local model can take minutes; without a bound a stuck
    // Ollama would hold the run (and the per-agent lock) forever.
    const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    let res: Response;
    try {
      res = await fetch(`${this.base}/api/chat`, {
        method: 'POST',
        signal: AbortSignal.timeout(timeoutMs),
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
      if (err instanceof Error && err.name === 'TimeoutError') {
        throw new Error(`Ollama timed out after ${Math.round(timeoutMs / 1000)}s`);
      }
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
