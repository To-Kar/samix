import { invoke } from '@tauri-apps/api/core';

export interface ScheduleInfo {
  cron: string;
  timezone: string;
  jitterSeconds?: number;
  catchupOnStartup?: boolean;
}

export interface AgentSummary {
  id: string;
  slug: string;
  /** Display name (the Ressort's title). */
  title: string;
  description: string;
  type: string;
  enabled: boolean;
  schedule: ScheduleInfo | null;
  model: string | null;
  personalize: boolean;
  /** What the Ressort is about; null if unknown. */
  topic: string | null;
  lastRun: { startedAt: string; status: string; error: string | null; costUsd: number } | null;
  createdAt: string;
  updatedAt: string;
}

export interface RunSummary {
  id: string;
  agentSlug: string;
  status: 'running' | 'success' | 'failed' | 'partial';
  trigger: string;
  model: string | null;
  costUsd: number;
  tokensInput: number;
  tokensOutput: number;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
  articleCount: number;
  sourceCount: number;
  nothingNew: boolean;
  /** What the sources reported when the run found nothing. */
  sourceNotes?: string[];
}

export interface ReaderProfile {
  liked: { title: string; topic?: string }[];
  disliked: { title: string; topic?: string }[];
}

export interface NewAgent {
  title: string;
  focus: string;
  sources: SourceSpec[];
  schedule?: { cron: string; timezone: string };
}

export interface RunResult {
  runId: string;
  agentSlug: string;
  status: 'success' | 'failed' | 'partial';
  output: unknown;
  tokensInput: number;
  tokensOutput: number;
  costUsd: number;
  error?: string;
  citations: unknown[];
  articleIds?: string[];
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
  /** Articles of one edition with the same key report the same event (the model's judgement). */
  storyKey: string | null;
  /** Set by the layout: the other articles of this story (see lib/layout.ts). */
  related?: EditionArticle[];
  createdAt: string;
  /** +1 liked, -1 disliked, null no vote. */
  vote: number | null;
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

export interface AgentRef {
  slug: string;
  title: string;
}

export interface ModelTestResult {
  ok: boolean;
  /** `key_missing`, `global_budget_exceeded` or the provider's error text. */
  error?: string;
  costUsd: number;
  ms: number;
  booked: boolean;
}

export interface CostAgent {
  slug: string;
  title: string;
  type: string;
  model: string;
  dailyUsdMax: number;
  todayUsd: number;
  /** Of todayUsd: what the web search cost. */
  todaySearchUsd: number;
}

export interface PriceInfo {
  model: string;
  builtIn: { inputPerMillionTokens: number; outputPerMillionTokens: number };
  custom: { inputPerMillionTokens: number; outputPerMillionTokens: number } | null;
}

export interface Costs {
  today: number;
  days: { day: string; costUsd: number }[];
  /** 0 = no global limit. */
  globalCapUsd: number;
  globalCapSource: 'app' | 'env' | 'default';
  agents: CostAgent[];
  prices: PriceInfo[];
}

export interface ModelInfo {
  id: string;
  /** Environment variable / keychain account holding its API key; null = local. */
  keyEnv: string | null;
  keyConfigured: boolean;
}

export interface ModelChoice {
  primary: string;
  fallback?: string;
  timeoutSecs?: number;
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

export interface AnswerCitation {
  number: number;
  /** Absent: an article. `file`: a file of a released project (title = path, sourceName = project). */
  kind?: 'file';
  articleId: string;
  title: string;
  sourceName: string | null;
  publishedAt: string | null;
  url: string | null;
}

export interface TraceStep {
  tool: string;
  input: unknown;
  resultCount: number;
  ms: number;
  isError?: boolean;
}

export interface Proposal {
  kind: 'refresh';
  ressort: string;
  title: string;
}

export interface RouteInfo {
  kind: 'delegate' | 'show_notes' | 'propose_refresh';
  agent?: string;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  allowModelAccess: boolean;
  /** False when the folder is gone or no longer allowed. */
  exists: boolean;
  createdAt: string;
}

export interface Note {
  id: string;
  text: string;
  createdAt: string;
}

export interface AskResult {
  conversationId: string | null;
  runId: string;
  status: 'success' | 'partial' | 'failed';
  error?: string;
  answer?: string;
  citations: AnswerCitation[];
  trace: TraceStep[];
  costUsd: number;
  model: string | null;
  route?: RouteInfo;
  proposals?: Proposal[];
}

export interface ConversationSummary {
  id: string;
  agent: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** ok | partial | failed (assistant only). */
  status: string | null;
  citations: AnswerCitation[];
  createdAt: string;
  // Assistant messages: where the question went and what the reader may confirm.
  route?: RouteInfo | null;
  proposals?: Proposal[];
  // Assistant messages: how the answer came about.
  runId?: string;
  error?: string | null;
  model?: string | null;
  costUsd?: number;
  trace?: TraceStep[];
}

export interface ConversationDetail extends ConversationSummary {
  messages: ConversationMessage[];
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
    if (res.status === 204) return undefined as T;
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

  /** `id` may be "latest"; with `agent` that means the newest edition of that Ressort. */
  getEdition(id: string, leadParagraphs: number, agent?: string): Promise<Edition> {
    const q = new URLSearchParams({ leadParagraphs: String(leadParagraphs) });
    if (agent) q.set('agent', agent);
    return this.request<Edition>(`/editions/${id}?${q}`);
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

  setAgentEnabled(slug: string, enabled: boolean): Promise<{ ok: boolean; enabled: boolean }> {
    return this.json('PUT', `/agents/${slug}/enabled`, { enabled });
  }

  renameAgent(slug: string, title: string): Promise<{ ok: boolean; title: string }> {
    return this.json('PUT', `/agents/${slug}/title`, { title });
  }

  setPersonalize(slug: string, enabled: boolean): Promise<{ ok: boolean }> {
    return this.json('PUT', `/agents/${slug}/personalize`, { enabled });
  }

  putSchedule(slug: string, schedule: { cron: string; timezone: string } | null): Promise<{ ok: boolean }> {
    return this.json('PUT', `/agents/${slug}/schedule`, { schedule });
  }

  createAgent(agent: NewAgent): Promise<{ slug: string; title: string }> {
    return this.json('POST', '/agents', agent);
  }

  vote(articleId: string, value: -1 | 0 | 1): Promise<{ vote: number | null }> {
    return this.json('PUT', `/articles/${articleId}/vote`, { value });
  }

  getProfile(slug: string): Promise<{ agent: string; profile: ReaderProfile | null }> {
    return this.request(`/profile?agent=${encodeURIComponent(slug)}`);
  }

  clearVotes(slug: string): Promise<{ deleted: number }> {
    return this.request(`/votes?agent=${encodeURIComponent(slug)}`, { method: 'DELETE' });
  }

  ask(question: string, conversationId?: string): Promise<AskResult> {
    return this.json<AskResult>('POST', '/ask', { question, conversationId });
  }

  listProjects(): Promise<Project[]> {
    return this.request<Project[]>('/projects');
  }

  addProject(body: { name: string; path: string; allowModelAccess: boolean }): Promise<Project> {
    return this.json<Project>('POST', '/projects', body);
  }

  setProjectAccess(id: string, allowModelAccess: boolean): Promise<Project> {
    return this.json<Project>('PUT', `/projects/${encodeURIComponent(id)}`, { allowModelAccess });
  }

  deleteProject(id: string): Promise<void> {
    return this.request<void>(`/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  getCosts(): Promise<Costs> {
    return this.request<Costs>('/costs');
  }

  setGlobalCap(usd: number): Promise<{ globalCapUsd: number }> {
    return this.json('PUT', '/budget/global', { usd });
  }

  resetGlobalCap(): Promise<{ globalCapUsd: number }> {
    return this.request('/budget/global', { method: 'DELETE' });
  }

  setAgentLimit(slug: string, dailyUsdMax: number): Promise<{ dailyUsdMax: number }> {
    return this.json('PUT', `/agents/${encodeURIComponent(slug)}/budget`, { dailyUsdMax });
  }

  setPrice(model: string, inputPerMillionTokens: number, outputPerMillionTokens: number): Promise<unknown> {
    return this.json('PUT', `/prices/${encodeURIComponent(model)}`, { inputPerMillionTokens, outputPerMillionTokens });
  }

  resetPrice(model: string): Promise<unknown> {
    return this.request(`/prices/${encodeURIComponent(model)}`, { method: 'DELETE' });
  }

  listNotes(): Promise<Note[]> {
    return this.request<Note[]>('/notes');
  }

  addNote(text: string): Promise<Note> {
    return this.json<Note>('POST', '/notes', { text });
  }

  deleteNote(id: string): Promise<void> {
    return this.request<void>(`/notes/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  listConversations(): Promise<ConversationSummary[]> {
    return this.request<ConversationSummary[]>('/conversations');
  }

  getConversation(id: string): Promise<ConversationDetail> {
    return this.request<ConversationDetail>(`/conversations/${encodeURIComponent(id)}`);
  }

  deleteConversation(id: string): Promise<void> {
    return this.request<void>(`/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  listRuns(slug: string, limit = 20): Promise<RunSummary[]> {
    return this.request(`/runs?agent=${encodeURIComponent(slug)}&limit=${limit}`);
  }

  private json<T>(method: string, path: string, body: unknown): Promise<T> {
    return this.request<T>(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  listModels(): Promise<ModelInfo[]> {
    return this.request<ModelInfo[]>('/models');
  }

  /**
   * Switches agents to `primary`. Without `all`, only agents whose model has no
   * API key; with it, every agent that can use the model (tool agents are
   * skipped for a model without tool calling).
   */
  useModel(primary: string, all = false): Promise<{ changed: AgentRef[]; skipped?: AgentRef[] }> {
    return this.json('POST', '/models/use', { primary, all });
  }

  /** One tiny request through the model's adapter: does the key work? */
  testModel(model: string): Promise<ModelTestResult> {
    return this.json('POST', '/models/test', { model });
  }

  getAgentModel(slug: string): Promise<ModelChoice> {
    return this.request<ModelChoice>(`/agents/${slug}/model`);
  }

  putAgentModel(slug: string, choice: { primary: string; fallback: string | null }): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>(`/agents/${slug}/model`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(choice),
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
