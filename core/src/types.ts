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

export interface Manifest {
  id: string;
  type: AgentType;
  version: string;
  model: ModelPreference;
  budget: BudgetSpec;
  schedule?: ScheduleSpec;
  sources?: SourceSpec[];
  output: OutputSpec;
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
  type: 'rss' | 'perplexity_search' | 'arxiv' | 'workspace' | 'api' | 'custom';
  config: Record<string, unknown>;
}

export interface OutputSpec {
  format: string;
  schemaPath?: string;
  minItems?: number;
  maxItems?: number;
}

export type RunTrigger = 'manual' | 'schedule' | 'catchup' | 'orchestrator' | 'query';

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

export interface QueryResult {
  runId: string;
  agentSlug: string;
  status: RunStatus;
  content: string;
  tokensInput: number;
  tokensOutput: number;
  costUsd: number;
  error?: string;
  startedAt: Date;
  completedAt: Date;
}

export interface Citation {
  url: string;
  title?: string;
  publishedAt?: Date;
  accessedAt: Date;
}

export interface NormalizedMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface NormalizedRequest {
  systemPrompt: string;
  messages: NormalizedMessage[];
  maxTokens?: number;
  temperature?: number;
  tools?: unknown[];
}

export interface NormalizedResponse {
  content: string;
  toolCalls: unknown[];
  citations: Citation[];
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  stopReason: string;
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
}

export interface SourceFetcher<C = unknown> {
  readonly type: 'rss' | 'perplexity_search' | 'arxiv' | 'workspace';
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
