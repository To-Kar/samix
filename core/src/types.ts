import type { Logger } from 'pino';

export type AgentType = 'reactive' | 'proactive';

// Single source of truth: the manifest validator derives its enum from this.
export const MODEL_IDS = [
  'static',
  'claude-haiku-4-5',
  'claude-sonnet-4-6',
  'deepseek-chat',
  'gpt-4o-mini',
  'perplexity-sonar',
  'ollama-llama3',
  'custom',
] as const;

export type ModelId = (typeof MODEL_IDS)[number];

// What an orchestrator agent may do with a question (runner/orchestrate.ts).
export const ROUTE_NAMES = ['delegate', 'show_notes', 'propose_refresh'] as const;
export type RouteName = (typeof ROUTE_NAMES)[number];

export interface Skill {
  id: string;
  /** Display name (Ressort title): SKILL.md frontmatter `title`, else `name`. */
  title: string;
  description: string;
  /** Runtime state, kept in the database so it survives edits to the files. */
  enabled: boolean;
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
  /** Skip source items already published by this agent within N days (default 14, 0 = off). */
  dedupeDays?: number;
  /** Also skip items whose title is nearly identical to one already published (default true). */
  dedupeSimilar?: boolean;
  /** Tell the model what the reader liked/disliked (see runner/profile.ts). */
  personalize?: boolean;
  /** Tools a reactive agent may call, by name (see tools/index.ts). */
  tools?: string[];
  /** Orchestrators: the actions they may choose. */
  routes?: RouteName[];
  /** Orchestrators: reactive agents they may hand a question to. */
  delegates?: string[];
  /** Shown instead of the model's text when a question surfaced no source at all. */
  emptyAnswer?: string;
  /** What a Ressort is about (set when it is created from a template). */
  topic?: string;
  /** The shipped agent this one was created from. */
  template?: string;
}

export interface ModelPreference {
  primary: ModelId;
  fallback?: ModelId;
  routing?: Record<string, ModelId>;
  // Per-call timeout applied to whichever adapter serves the request.
  timeoutSecs?: number;
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

// Single source of truth for manifest validation and the sources API.
// `api` and `custom` are accepted in manifests but have no fetcher yet.
export const SOURCE_TYPES = ['rss', 'perplexity_search', 'arxiv', 'website', 'api', 'custom'] as const;

export interface SourceSpec {
  type: (typeof SOURCE_TYPES)[number];
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

// Tool use, normalised across providers (see docs/SAMIX_PHASE_3_SPEC.md §4).
export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema of the tool's input object. */
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
  /** Set when the provider's arguments were not valid JSON; the caller reports it back to the model. */
  parseError?: string;
}

export type NormalizedMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string; isError?: boolean };

export interface NormalizedRequest {
  systemPrompt: string;
  messages: NormalizedMessage[];
  maxTokens?: number;
  temperature?: number;
  tools?: ToolSpec[];
  timeoutMs?: number;
}

export interface NormalizedResponse {
  content: string;
  toolCalls: ToolCall[];
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

export type FetcherType = 'rss' | 'perplexity_search' | 'arxiv' | 'website';

export interface SourceItem {
  url: string;
  title: string;
  snippet?: string;
  publishedAt?: Date;
  sourceName: string;
  // The fetcher that produced this item; persisted on SourceSnapshot.
  sourceType: FetcherType;
  raw?: Record<string, unknown>;
}

export interface FetchContext {
  runId: string;
  logger: Logger;
  since?: Date;
  /** The agent's topic (its focus sentence), for sources that search by topic. */
  topic?: string;
  /** Paid sources ask first: false = the budget does not allow spending `estimateUsd` now. */
  reserve?(estimateUsd: number): Promise<boolean>;
  /** Paid sources report what a request cost; the runner books it to the ledger and the run. */
  spend?(costUsd: number, note: string): void;
  /** A plain-language remark about what a source did (shown to the reader when a run finds nothing). */
  note?(message: string): void;
}

export interface SourceFetcher<C = unknown> {
  readonly type: FetcherType;
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
