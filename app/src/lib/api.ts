import { invoke } from '@tauri-apps/api/core';

export interface AgentSummary {
  id: string;
  slug: string;
  type: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RunResult {
  runId: string;
  agentSlug: string;
  status: 'success' | 'failed' | 'partial';
  output: { content: string; stopReason: string } | null;
  tokensInput: number;
  tokensOutput: number;
  costUsd: number;
  error?: string;
  citations: unknown[];
  startedAt: string;
  completedAt: string;
}

export interface HealthResponse {
  status: 'ok';
  uptime: number;
  version: string;
}

export interface Article {
  id: string;
  title: string;
  summary: string;
  sourceUrl: string | null;
  sourceName: string | null;
  publishedAt: string | null;
  topic: string | null;
  createdAt: string;
  agentSlug: string;
}

export interface SourceSpec {
  type: 'rss' | 'arxiv' | 'perplexity_search' | 'db_articles' | 'url_fetch' | 'api' | 'custom';
  config: Record<string, unknown>;
}

export interface ListArticlesQuery {
  since?: string;
  topic?: string;
  agent?: string;
  limit?: number;
}

export class ApiClient {
  constructor(
    private readonly port: number,
    private readonly token: string
  ) {}

  baseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl()}${path}`, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        Authorization: `Bearer ${this.token}`,
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${path}: ${body}`);
    }
    return (await res.json()) as T;
  }

  async health(): Promise<HealthResponse> {
    const res = await fetch(`${this.baseUrl()}/health`);
    if (!res.ok) throw new Error(`HTTP ${res.status} /health`);
    return (await res.json()) as HealthResponse;
  }

  listAgents(): Promise<AgentSummary[]> {
    return this.request<AgentSummary[]>('/agents');
  }

  runAgent(slug: string): Promise<RunResult> {
    return this.request<RunResult>(`/agents/${slug}/run`, { method: 'POST' });
  }

  askAgent(
    slug: string,
    message: string,
    history?: Array<{ role: 'user' | 'assistant'; content: string }>
  ): Promise<RunResult> {
    return this.request<RunResult>(`/agents/${slug}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: { message }, history }),
    });
  }

  subscribeEvents(onEvent: (event: { agentSlug: string; articleCount: number; costUsd: number }) => void): () => void {
    const es = new EventSource(`${this.baseUrl()}/events`);
    es.onmessage = (e) => {
      try {
        onEvent(JSON.parse(e.data));
      } catch { /* ignore malformed */ }
    };
    return () => es.close();
  }

  getRun(id: string): Promise<RunResult> {
    return this.request<RunResult>(`/runs/${id}`);
  }

  listArticles(query: ListArticlesQuery = {}): Promise<Article[]> {
    const params = new URLSearchParams();
    if (query.since) params.set('since', query.since);
    if (query.topic) params.set('topic', query.topic);
    if (query.agent) params.set('agent', query.agent);
    if (query.limit != null) params.set('limit', String(query.limit));
    const qs = params.toString();
    return this.request<Article[]>(`/articles${qs ? `?${qs}` : ''}`);
  }

  getSources(slug: string): Promise<SourceSpec[]> {
    return this.request<SourceSpec[]>(`/agents/${slug}/sources`);
  }

  putSources(slug: string, sources: SourceSpec[]): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>(`/agents/${slug}/sources`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sources }),
    });
  }
}

interface CoreConfig {
  port: number;
  token: string;
}

let apiPromise: Promise<ApiClient> | null = null;

export function initApi(): Promise<ApiClient> {
  if (!apiPromise) {
    apiPromise = invoke<CoreConfig>('get_core_config').then(
      (cfg) => new ApiClient(cfg.port, cfg.token)
    );
  }
  return apiPromise;
}
