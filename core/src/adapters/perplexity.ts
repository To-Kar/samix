import type {
  Citation,
  ModelAdapter,
  ModelId,
  NormalizedRequest,
  NormalizedResponse,
} from '../types.js';

interface PerplexityChoice {
  message: { role: string; content: string };
  finish_reason?: string;
}

interface PerplexityUsage {
  prompt_tokens: number;
  completion_tokens: number;
}

interface PerplexitySearchResult {
  url: string;
  title?: string;
  date?: string;
}

interface PerplexityResponse {
  choices: PerplexityChoice[];
  usage: PerplexityUsage;
  // Older Sonar responses returned a bare URL list under `citations`; newer
  // responses also include `search_results` with richer metadata. Handle both.
  citations?: string[];
  search_results?: PerplexitySearchResult[];
}

export class PerplexityAdapter implements ModelAdapter {
  readonly name: ModelId = 'perplexity-sonar';
  readonly supportsTools = false;
  readonly supportsSearch = true;
  // VERIFY: Sonar billing also charges per-search on top of token rates, which
  // this pricing struct doesn't model — cost calculations will undercount by
  // the per-request search fee. Acceptable for Phase 1 single-user budgets.
  readonly pricing = { inputPerMillionTokens: 1.0, outputPerMillionTokens: 1.0 };

  private readonly endpoint = 'https://api.perplexity.ai/chat/completions';
  private readonly model = 'sonar';

  async generate(req: NormalizedRequest): Promise<NormalizedResponse> {
    const apiKey = process.env.PERPLEXITY_API_KEY;
    if (!apiKey) {
      throw new Error('PERPLEXITY_API_KEY not set');
    }

    const messages = [
      { role: 'system', content: req.systemPrompt },
      ...req.messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    const res = await fetch(this.endpoint, {
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
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Perplexity HTTP ${res.status}: ${body}`);
    }

    const data = (await res.json()) as PerplexityResponse;
    const choice = data.choices[0];
    const content = choice?.message.content ?? '';
    const accessedAt = new Date();

    const citations: Citation[] = [];
    if (data.search_results?.length) {
      for (const r of data.search_results) {
        citations.push({
          url: r.url,
          title: r.title,
          publishedAt: r.date ? new Date(r.date) : undefined,
          accessedAt,
        });
      }
    } else if (data.citations?.length) {
      for (const url of data.citations) {
        citations.push({ url, accessedAt });
      }
    }

    return {
      content,
      toolCalls: [],
      citations,
      usage: {
        inputTokens: data.usage.prompt_tokens,
        outputTokens: data.usage.completion_tokens,
      },
      stopReason: choice?.finish_reason ?? 'unknown',
    };
  }
}
