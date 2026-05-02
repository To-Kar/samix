# Samix — Phase 4 Plan: Tool Use, UI Intelligence, Feedback Loop

**Status:** Planning
**Builds on:** Phase 3 (commit `5e55db0` on `claude/continue-tasks-verify-MMmUv`)
**Branch to use:** `claude/phase-4-tool-use-ui` (create fresh from the phase 3 commits)

---

## What shipped in Phase 3

- Reactive agents (`type: reactive` in manifest), `POST /agents/:slug/query` endpoint
- Workspace context source (walks filesystem, injects file content as LLM context)
- Multi-turn conversation history passed through query runner
- OpenAI adapter (`gpt-4o-mini`, `gpt-4o`), `OPENAI_API_KEY` in keychain + Settings
- Agent Memory: `Memory` Prisma model, CRUD API, memories injected per query
- Sources editor extended to all agents + workspace type editing
- Release build plumbing: `spawn_core(node_script)`, `esbuild.config.mjs`, Tauri resources
- Bug fix: `workspace` added to `sourcesBodySchema`

---

## Phase 4 Theme: "Tool Use, UI Intelligence, Feedback Loop"

Four threads:
1. **Tool use** — reactive agents can call real tools (file read, shell exec); the architecture gets a proper tool-execution loop
2. **Newspaper UI intelligence** — search, topic filters, unread tracking, article voting
3. **Runs dashboard** — transparent operations visible in-app
4. **Memory management UI** — manually add/edit/delete memories from the Query panel

---

## Architecture overview

### Tool use design

The `ModelAdapter` interface already declares `supportsTools: boolean` and `NormalizedRequest` has `tools?: unknown[]`. The gap: nothing actually sends tool definitions to Claude or handles tool-call responses in a loop.

**New types in `types.ts`:**
```typescript
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema object
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  content: string;
  isError?: boolean;
}
```

Update `NormalizedRequest`:
```typescript
export interface NormalizedRequest {
  systemPrompt: string;
  messages: NormalizedMessage[];
  maxTokens?: number;
  temperature?: number;
  tools?: ToolDefinition[];       // was unknown[]
}
```

Update `NormalizedResponse`:
```typescript
export interface NormalizedResponse {
  content: string;
  toolCalls: ToolCall[];           // was unknown[]
  citations: Citation[];
  usage: { inputTokens: number; outputTokens: number };
  stopReason: string;
}
```

**ClaudeAdapter update:**
- Map `ToolDefinition[]` → Anthropic `tool` format when sending
- Parse `tool_use` blocks in response back to `ToolCall[]`
- Stop reason `'tool_use'` passthrough

**New `core/src/tools/` directory:**

`registry.ts` — maps tool name → executor function
`executor.ts` — `executeTool(call: ToolCall): Promise<ToolResult>`
`builtins.ts` — implementations of built-in tools:
  - `read_file(path: string)` — reads file, truncates at 10 KB
  - `list_directory(path: string)` — lists files/dirs, skips hidden
  - `shell_exec(command: string, cwd?: string)` — runs command, captures stdout+stderr, timeout 15 s, allowed only if `SAMIX_ALLOW_SHELL_EXEC=1`

**Tool execution loop in `query-runner.ts`:**
```
generate(request) →
  if stopReason === 'tool_use' && toolCalls.length > 0:
    execute each tool call
    append assistant message (with tool calls) + tool results to messages
    generate(updated request) → loop
  else: return response
```
Max 5 tool-use rounds (prevent infinite loops). Total token cost still tracked and debited to budget ledger.

**Manifest opt-in:**
```yaml
tools:
  - read_file
  - list_directory
  # shell_exec is opt-in and requires SAMIX_ALLOW_SHELL_EXEC=1
```

Skill loader reads `manifest.tools`, query runner passes only the declared tools to the adapter.

---

## Feature 1 — Tool Use

### Files changed / created

| File | Change |
|------|--------|
| `core/src/types.ts` | Add `ToolDefinition`, `ToolCall`, `ToolResult`; update `NormalizedRequest.tools`, `NormalizedResponse.toolCalls` |
| `core/src/adapters/claude.ts` | Map tool definitions to Anthropic format; parse tool_use blocks |
| `core/src/adapters/openai.ts` | Map tool definitions to OpenAI function-call format (Phase 4b — can stub) |
| `core/src/tools/builtins.ts` | `read_file`, `list_directory`, `shell_exec` |
| `core/src/tools/registry.ts` | Tool name → executor map |
| `core/src/tools/executor.ts` | `executeTool(call)` dispatches to registry |
| `core/src/runner/query-runner.ts` | Tool-execution loop; tool usage logged; total tokens accumulated |
| `core/src/skills/loader.ts` | Read `manifest.tools?: string[]`; validate against registry |
| `core/src/types.ts` | Add `tools?: string[]` to `Manifest` |
| `agents/coding-assistant/manifest.yaml` | Add `tools: [read_file, list_directory]` |

### Manifest schema extension

```yaml
tools:
  - read_file
  - list_directory
```

### `shell_exec` safety note

`shell_exec` is gated behind `SAMIX_ALLOW_SHELL_EXEC=1` env var. If the var is absent, the tool returns an error result saying it is disabled. This is the security boundary — the tool is never silently skipped, it explicitly tells the LLM it is unavailable.

---

## Feature 2 — Newspaper Search + Filters + Voting

### Prisma: add vote columns to Article

```prisma
model Article {
  ...existing fields...
  upvotes   Int @default(0)
  downvotes Int @default(0)
}
```

New migration: `20260502_phase4_article_votes`

### Backend

**`GET /articles` extension:** add optional `search` query param — case-insensitive `contains` on `title` + `summary` (SQLite `LIKE`).

**`POST /articles/:id/vote`** with body `{ direction: 'up' | 'down' }`:
- Increments `upvotes` or `downvotes`; no auth/identity needed (local single-user)
- Returns `{ upvotes, downvotes }`

**`GET /articles` response:** include `upvotes` and `downvotes` fields.

### Frontend: `Newspaper.tsx`

1. Add search input above the article list — filters client-side first (fast), falls back to reloading with `search=` param if result set is empty.
2. Topic filter chips: extract distinct `topic` values from loaded articles, render as toggleable pills. Active topic = show only matching articles.
3. Agent filter: a small `<select>` for multi-agent setups (list from `agentSlug` in articles).
4. Unread tracking: store `lastVisitedAt` in `localStorage`. Articles newer than that get a subtle dot/badge. "Mark all read" updates localStorage.
5. Vote buttons on `ArticleCard`: 👍 and 👎 buttons call `api.voteArticle(id, direction)`. Optimistic update on click.
6. Vote counts visible in `ArticleDetailModal`.

### API client additions

```typescript
// Add to api.ts
voteArticle(id: string, direction: 'up' | 'down'): Promise<{ upvotes: number; downvotes: number }>;

// Update Article interface:
export interface Article {
  ...existing...
  upvotes: number;
  downvotes: number;
}

// Update ListArticlesQuery:
export interface ListArticlesQuery {
  since?: string; topic?: string; agent?: string; limit?: number; search?: string;
}
```

---

## Feature 3 — Runs Dashboard

### Backend

**`GET /runs`** — new list endpoint:
```typescript
GET /runs?agent=&status=&limit=50&since=
```
Returns `AgentRun[]` with `agentSlug` joined (same shape as `GET /runs/:id` but without `input`/`output` for the list view — those are expensive for large text).

List response shape per run:
```typescript
{ id, agentSlug, status, trigger, tokensInput, tokensOutput, costUsd, error, startedAt, completedAt }
```

### Frontend

New `Runs.tsx` component:
- Props: `{ api: ApiClient }`
- Table/list view with columns: Time | Agent | Trigger | Status | Tokens | Cost | Duration
- Color-coded status badges: `success` → green, `failed` → red, `running` → yellow, `partial` → amber
- Click row → loads and shows full `GET /runs/:id` detail (input + output JSON) in an inline expand or modal
- Filter: all agents or select one; filter by status
- Auto-refresh every 30 s when "Runs" tab is open (same ConnectionBanner polling pattern)

**`App.tsx`:** Add "Runs" nav button alongside Query/Sources/Settings. Mutually exclusive view.

### API client additions

```typescript
listRuns(query?: { agent?: string; status?: string; limit?: number; since?: string }): Promise<RunSummary[]>;

export interface RunSummary {
  id: string; agentSlug: string; status: string; trigger: string;
  tokensInput: number; tokensOutput: number; costUsd: number;
  error?: string; startedAt: string; completedAt?: string;
}
```

---

## Feature 4 — Memory Management UI

The Memory API (`GET/PUT/DELETE /agents/:slug/memory/:key`) exists. There is no UI.

**Extend `Query.tsx`:**

Below the conversation history, add a collapsible "Memories" section (uses `<details>`/`<summary>` for zero dependencies):

- On mount (and after each Clear): load memories via `api.listMemories(CODING_ASSISTANT_SLUG)`
- List: each memory as `[key] content` row with a Delete button (calls `api.deleteMemory`)
- "Add memory" inline form: key input + content textarea + Save button
- Auto-refresh after add/delete

### API client additions

```typescript
listMemories(slug: string): Promise<{ key: string; content: string }[]>;
setMemory(slug: string, key: string, content: string): Promise<{ ok: boolean }>;
deleteMemory(slug: string, key: string): Promise<{ ok: boolean }>;
```

---

## Implementation Order

1. **Types update** (`types.ts` — `ToolDefinition`, `ToolCall`, `ToolResult`, updated interfaces)
2. **Tool builtins + registry + executor** (`core/src/tools/`)
3. **ClaudeAdapter tool support** (map to Anthropic API format, parse responses)
4. **Skill loader** — read `manifest.tools`, store on `Manifest`
5. **Query runner** — tool execution loop, max 5 rounds, token accumulation
6. **`agents/coding-assistant/manifest.yaml`** — add `tools: [read_file, list_directory]`
7. **Prisma migration** — `upvotes`, `downvotes` on Article
8. **Backend** — `POST /articles/:id/vote`, update `GET /articles` (search + votes), `GET /runs`
9. **`api.ts`** — `voteArticle`, `listRuns`, `listMemories`, `setMemory`, `deleteMemory`, updated interfaces
10. **`Newspaper.tsx`** — search input, topic chips, agent filter, unread dots, vote buttons
11. **`Runs.tsx`** — new component
12. **`App.tsx`** — Runs nav button
13. **`Query.tsx`** — memories collapsible panel

---

## Files Changed / Created

| File | Change |
|------|--------|
| `core/src/types.ts` | `ToolDefinition`, `ToolCall`, `ToolResult`; updated `NormalizedRequest`, `NormalizedResponse`, `Manifest` |
| `core/src/adapters/claude.ts` | Tool call send + parse |
| `core/src/tools/builtins.ts` | `read_file`, `list_directory`, `shell_exec` |
| `core/src/tools/registry.ts` | Name → executor map |
| `core/src/tools/executor.ts` | `executeTool()` dispatch |
| `core/src/runner/query-runner.ts` | Tool execution loop |
| `core/src/skills/loader.ts` | Read `manifest.tools` |
| `core/src/server.ts` | `POST /articles/:id/vote`, `GET /runs` list, `GET /articles?search=` |
| `core/prisma/schema.prisma` | `upvotes`, `downvotes` on Article |
| `core/prisma/migrations/20260502_phase4_article_votes/` | Migration |
| `agents/coding-assistant/manifest.yaml` | Add `tools` list |
| `app/src/lib/api.ts` | `voteArticle`, `listRuns`, `listMemories`, `setMemory`, `deleteMemory`, updated interfaces |
| `app/src/components/Newspaper.tsx` | Search, filters, unread, vote buttons |
| `app/src/components/Runs.tsx` | New runs dashboard |
| `app/src/components/Query.tsx` | Memory management panel |
| `app/src/App.tsx` | Runs nav button |

---

## Verification

1. `pnpm build:core` — TypeScript clean
2. Tool use: `POST /agents/coding-assistant/query { "message": "List the files in ~/samix/core/src/" }` → LLM calls `list_directory`, receives results, answers with file list
3. Tool use: `POST /agents/coding-assistant/query { "message": "Show me the contents of ~/samix/core/src/types.ts" }` → LLM calls `read_file`, answers with file contents
4. Voting: `POST /articles/<any-id>/vote { "direction": "up" }` → 200 with `{ upvotes: 1, downvotes: 0 }`; repeat → `{ upvotes: 2, ... }`
5. Search: `GET /articles?search=LLM` → only articles containing "LLM" in title or summary
6. Runs list: `GET /runs?limit=10` → array of run summaries ordered by `startedAt` desc
7. UI: Open "Runs" tab → recent runs visible with correct status badges
8. UI: Search "AI" in Newspaper → article list filters in real-time
9. UI: Vote 👍 on an article → count updates optimistically
10. UI: Open Query panel → Memories section shows stored memories; add one → persists after refresh

---

## Non-goals for Phase 4

- `shell_exec` shipped with `SAMIX_ALLOW_SHELL_EXEC=1` gate — do NOT enable by default
- OpenAI function-calling format (stub `ClaudeAdapter` first; add `OpenAIAdapter` tool support in Phase 5)
- Voting analytics / "tune agent based on votes" (just store votes; tuning is Phase 5+)
- Telegram/SMTP delivery (still deferred)
- Orchestrator agent (Phase 5)
- Mobile client (Phase 5+)

---

## Context for the new session

**Repo:** `to-kar/samix`
**Branch:** create `claude/phase-4-tool-use-ui` from current `claude/continue-tasks-verify-MMmUv`
**Working directory:** `/home/user/samix`
**Key invariants to preserve:**
- `SAMIX_TOKEN` bearer auth on every route (except `/health`)
- Budget gate must run *before* any `adapter.generate()` call
- Never import provider SDKs directly in runner/agent code — only via adapters
- Skill IDs must match directory names
- `sourcesBodySchema` must stay in sync with `SourceSpec.type` union in `types.ts`
- Tool execution adds to token/cost totals — budget ledger must be updated after the full loop, not per-round
