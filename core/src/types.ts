import type { Logger } from 'pino';

export type AgentType = 'reactive' | 'proactive';

export type ModelId =
  | 'static'
  | 'claude-haiku-4-5'
  | 'claude-sonnet-4-6'
  | 'gpt-4o-mini'
  | 'perplexity-sonar'
  | 'ollama-llama3';

export interface Skill {
  id: string;
  type: AgentType;
  version: string;
  skillMdPath: string;
  manifest: Manifest;
  systemPrompt: string;
}

export interface ContextSpec {
  injectAmbient?: boolean;
}

export interface Manifest {
  id: string;
  type: AgentType;
  version: string;
  model: ModelPreference;
  budget: BudgetSpec;
  schedule?: ScheduleSpec;
  sources?: SourceSpec[];
  output: OutputSpec;
  context?: ContextSpec;
  tools?: string[];
}

export interface ModelPreference {
  primary: ModelId;
  fallback?: ModelId;
  routing?: Record<string, ModelId>;
}

export interface BudgetSpec {
  dailyUsdMax: number;
  tokensPerRunMax: number;
  haltOnBudgetExceeded: boolean;
}

export interface ScheduleSpec {
  cron: string;
  timezone: string;
  jitterSeconds?: number;
  catchupOnStartup?: boolean;
}

export interface SourceSpec {
  type: 'rss' | 'perplexity_search' | 'arxiv' | 'db_articles' | 'url_fetch' | 'api' | 'custom';
  config: Record<string, unknown>;
}

export interface OutputSpec {
  format: string;
  schemaPath?: string;
  minItems?: number;
  maxItems?: number;
}

export type RunTrigger = 'manual' | 'schedule' | 'catchup' | 'orchestrator';

export interface RunContext {
  runId: string;
  triggeredBy: RunTrigger;
  input?: unknown;
  now: Date;
}

export type RunStatus = 'running' | 'success' | 'failed' | 'partial';

export interface RunResult {
  runId: string;
  agentSlug: string;
  status: RunStatus;
  output: unknown;
  tokensInput: number;
  tokensOutput: number;
  costUsd: number;
  error?: string;
  citations: Citation[];
  articleIds: string[];
  startedAt: Date;
  completedAt: Date;
}

export interface Citation {
  url: string;
  title?: string;
  publishedAt?: Date;
  accessedAt: Date;
}

export interface ImageAttachment {
  mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
  base64: string;
}

export interface NormalizedMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  images?: ImageAttachment[];
  contentBlocks?: NormalizedContentBlock[];
}

export type NormalizedContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean };

export interface NormalizedRequest {
  systemPrompt: string;
  messages: NormalizedMessage[];
  maxTokens?: number;
  temperature?: number;
  tools?: ToolDefinition[];
}

export interface NormalizedResponse {
  content: string;
  contentBlocks: NormalizedContentBlock[];
  toolCalls: unknown[];
  citations: Citation[];
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  stopReason: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (input: Record<string, unknown>, ctx: ToolContext) => Promise<string>;
}

export interface ToolContext {
  runId: string;
  logger: Logger;
  agentSlug: string;
}

export interface ModelAdapter {
  readonly name: ModelId;
  readonly supportsTools: boolean;
  readonly supportsSearch: boolean;
  readonly pricing: {
    inputPerMillionTokens: number;
    outputPerMillionTokens: number;
  };
  generate(req: NormalizedRequest): Promise<NormalizedResponse>;
}

export interface SourceItem {
  url: string;
  title: string;
  snippet?: string;
  publishedAt?: Date;
  sourceName: string;
  raw?: Record<string, unknown>;
}

export interface FetchContext {
  runId: string;
  logger: Logger;
  since?: Date;
  input?: unknown;
}

export interface SourceFetcher<C = unknown> {
  readonly type: 'rss' | 'perplexity_search' | 'arxiv' | 'db_articles' | 'url_fetch';
  fetch(config: C, ctx: FetchContext): Promise<SourceItem[]>;
}

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
  parsed?: unknown;
}

export interface OutputValidator {
  validate(raw: unknown, schemaPath: string): Promise<ValidationResult>;
}
