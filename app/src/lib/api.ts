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
  type: 'rss' | 'arxiv' | 'perplexity_search' | 'website' | 'api' | 'custom';
  config: Record<string, unknown>;
}

// Structured article text. The core reduces web pages to these blocks; the UI
// renders them as React elements and never handles HTML from the web.
export type ContentBlock =
  | { type: 'heading'; level: 2 | 3 | 4; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'quote'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'code'; text: string }
  | { type: 'image'; mediaId: string; alt?: string; caption?: string };

export interface EditionSummary {
  id: string;
  number: number;
  agentSlug: string;
  startedAt: string;
  articleCount: number;
  sourceCount: number;
  costUsd: number;
  model: string | null;
}

export interface EditionArticle {
  id: string;
  title: string;
  summary: string;
  sourceUrl: string | null;
  sourceName: string | null;
  publishedAt: string | null;
  topic: string | null;
  importance: number;
  importanceReason: string | null;
  createdAt: string;
  content: { status: ContentStatus; readingMinutes: number; leadImageId: string | null } | null;
  excerpt: ContentBlock[] | null;
}

export type ContentStatus = 'ok' | 'unsupported' | 'failed';

export interface Edition {
  id: string;
  number: number;
  agentSlug: string | null;
  startedAt: string;
  costUsd: number;
  model: string | null;
  sourceCount: number;
  olderId: string | null;
  newerId: string | null;
  articles: EditionArticle[];
}

export interface ArticleDetail extends Omit<EditionArticle, 'content' | 'excerpt'> {
  run: { id: string; model: string | null; startedAt: string };
  content: {
    status: ContentStatus;
    error: string | null;
    finalUrl: string | null;
    title: string | null;
    byline: string | null;
    siteName: string | null;
    lang: string | null;
    fetchedAt: string;
    wordCount: number;
    readingMinutes: number;
    leadImageId: string | null;
    blocks: ContentBlock[];
  } | null;
  sources: {
    sourceType: string;
    sourceName: string;
    url: string;
    title: string;
    publishedAt: string | null;
    fetchedAt: string;
  }[];
}

export interface SourcePreview {
  method: string | null;
  feedUrl?: string;
  candidates: number;
  withoutDate?: number;
  filteredOut?: number;
  warnings: string[];
  items: { title: string; url: string; publishedAt: string | null; sourceName: string }[];
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

  private baseUrl(): string {
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
      let detail = body;
      try {
        const j = JSON.parse(body) as { message?: string };
        if (j.message) detail = j.message;
      } catch {
        /* not JSON */
      }
      throw new Error(`HTTP ${res.status} ${path}: ${detail}`);
    }
    return (await res.json()) as T;
  }

  private async requestBlob(path: string): Promise<Blob> {
    const res = await fetch(`${this.baseUrl()}${path}`, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${path}`);
    return res.blob();
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

  getEdition(id: string, leadParagraphs: number): Promise<Edition> {
    return this.request<Edition>(`/editions/${id}?leadParagraphs=${leadParagraphs}`);
  }

  listEditions(limit = 30): Promise<EditionSummary[]> {
    return this.request<EditionSummary[]>(`/editions?limit=${limit}`);
  }

  getArticle(id: string): Promise<ArticleDetail> {
    return this.request<ArticleDetail>(`/articles/${id}`);
  }

  // Fetches (or re-fetches) the original page's text in the core.
  loadArticleContent(id: string, refresh = false): Promise<ArticleDetail> {
    return this.request<ArticleDetail>(`/articles/${id}/content`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh }),
    });
  }

  // Images need the bearer token, which <img src> cannot send: fetch the
  // bytes and show them through a blob: URL (see AuthImage).
  fetchMedia(id: string): Promise<Blob> {
    return this.requestBlob(`/media/${id}`);
  }

  previewSource(spec: SourceSpec): Promise<SourcePreview> {
    return this.request<SourcePreview>('/sources/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(spec),
    });
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

// `vite dev` in a plain browser (no Tauri) can point at a running core with
// VITE_SAMIX_PORT / VITE_SAMIX_TOKEN. Never active in a Tauri window.
function browserDevConfig(): CoreConfig | null {
  const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  const port = Number(import.meta.env.VITE_SAMIX_PORT);
  const token = import.meta.env.VITE_SAMIX_TOKEN as string | undefined;
  return !inTauri && import.meta.env.DEV && port && token ? { port, token } : null;
}

export function initApi(): Promise<ApiClient> {
  if (!apiPromise) {
    const dev = browserDevConfig();
    if (dev) {
      apiPromise = Promise.resolve(new ApiClient(dev.port, dev.token));
      return apiPromise;
    }
    apiPromise = invoke<CoreConfig>('get_core_config').then(
      (cfg) => new ApiClient(cfg.port, cfg.token)
    );
  }
  return apiPromise;
}
