# Samix — Claude Code Handoff for Phase 0

**Companion to:** `SAMIX_PHASE_0_SPEC.md`
**Audience:** Claude Code (or any capable coding assistant) executing Phase 0 implementation
**Scope:** Build the working pipeline — no real LLM calls yet, no newsletter, no newspaper UI

---

## 0. Before You Start

### Read first
1. `SAMIX_PHASE_0_SPEC.md` (companion doc) — architecture, types, schema, principles
2. This document — step-by-step instructions

### Prerequisites to verify on Tom's machine

- Node.js ≥ 20 LTS (check with `node --version`)
- pnpm ≥ 9 (`pnpm --version`) — install with `npm install -g pnpm` if missing
- Rust toolchain for Tauri ([Inference] Tauri v2 requires recent stable Rust) — install via rustup
- Windows-specific Tauri prerequisites: WebView2 (usually preinstalled on Windows 11) and Microsoft Visual Studio C++ Build Tools. [Unverified] Exact requirements — verify at the current Tauri prerequisites page before starting.
- Git

Run Tauri's own prerequisites checker if available (`pnpm create tauri-app` will complain if anything is missing).

### Scope reminder

Phase 0 is **pipeline validation**, not a product. The `hello-world` agent uses a `static` adapter that returns a literal string — no LLM call, no API key needed. This is intentional: we prove the plumbing works before spending tokens.

### Ground rules

- **Prioritization:** architecture cleanliness > cost efficiency > speed to MVP
- **When uncertain** about a specific Tauri v2 API, Prisma + better-sqlite3 behavior, or library version: consult the current official docs rather than guessing. Mark uncertainty in code comments with `// VERIFY:`
- **Do not add dependencies** not listed here without flagging in the final report
- **Do not implement Phase 1+ features** even if tempting — see "Out of Scope" at the bottom

---

## 1. Repo Initialization

### 1.1 Root setup

```bash
mkdir samix && cd samix
git init
pnpm init
```

### 1.2 `pnpm-workspace.yaml`

```yaml
packages:
  - 'app'
  - 'core'
```

### 1.3 Root `package.json` scripts

```json
{
  "name": "samix",
  "private": true,
  "scripts": {
    "dev:core": "pnpm --filter samix-core dev",
    "dev:app": "pnpm --filter samix-app tauri dev",
    "build:core": "pnpm --filter samix-core build",
    "build:app": "pnpm --filter samix-app tauri build",
    "db:migrate": "pnpm --filter samix-core prisma migrate dev",
    "db:studio": "pnpm --filter samix-core prisma studio"
  }
}
```

### 1.4 `.gitignore` (root)

Include: `node_modules/`, `dist/`, `build/`, `target/`, `.env`, `.env.local`, `data/`, `*.db`, `*.db-journal`, `.DS_Store`

### 1.5 `docs/` + ADRs

Create `docs/decisions/` and add three ADR stubs:
- `001-tauri-v2.md` — why Tauri over Electron
- `002-node-core-separate-process.md` — Alternative D reasoning
- `003-sqlite-not-postgres.md` — local-first justification

Each ADR: 5–10 lines, pointing to the spec for full context.

---

## 2. Core Implementation (`core/`)

Implementation order matters: types → DB → adapters → skill loader → runner → server. Each step should run in isolation before moving on.

### 2.1 Package scaffold

```bash
cd core
pnpm init
```

`core/package.json` minimum:

```json
{
  "name": "samix-core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc",
    "prisma": "prisma"
  }
}
```

### 2.2 Dependencies

**Runtime:**
- `fastify` — HTTP framework
- `@fastify/helmet` — basic security headers
- `zod` — schema validation
- `@prisma/client`, `prisma` (dev) — DB
- `better-sqlite3` — SQLite driver
- `pino`, `pino-pretty` — logging
- `node-cron` — scheduler (used in Phase 1, set up now so infrastructure is ready)
- `yaml` — parse manifest.yaml
- `gray-matter` — parse SKILL.md frontmatter

**Dev:**
- `typescript`
- `tsx` — dev runner
- `@types/node`
- `@types/node-cron`
- `@types/better-sqlite3`

[Inference] Versions: use latest stable at install time unless there's a known compatibility issue. Prisma + better-sqlite3 has historically been stable, but verify the current adapter status — Prisma has been moving toward a new driver adapter model for SQLite. Check current Prisma docs for whether to use `better-sqlite3` directly or the new `@prisma/adapter-better-sqlite3`.

### 2.3 `tsconfig.json`

Strict mode, ESM, Node target. Standard setup — no tricks.

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

### 2.4 Prisma setup

```bash
pnpm prisma init --datasource-provider sqlite
```

Replace generated `prisma/schema.prisma` with the schema from Section 9 of the spec. Then:

```bash
DATABASE_URL="file:./data/samix-dev.db" pnpm prisma migrate dev --name init
```

Put the generated DB file under `core/data/samix-dev.db`. This directory is `.gitignore`d.

### 2.5 Types

Create `core/src/types.ts` — copy from Section 8 of the spec. Do not embellish.

Also create a thin re-export `core/src/index.ts` that surfaces the public types — in case the UI package ever wants to import them via a workspace dep (not needed Phase 0, but sets the pattern).

### 2.6 Model Adapters

`core/src/adapters/base.ts` — interface only (see spec Section 8).

`core/src/adapters/static.ts` — the Phase 0 adapter:

```typescript
export class StaticAdapter implements ModelAdapter {
  readonly name = 'static' as const;
  readonly supportsTools = false;
  readonly supportsSearch = false;
  readonly pricing = { inputPerMillionTokens: 0, outputPerMillionTokens: 0 };

  async generate(req: NormalizedRequest): Promise<NormalizedResponse> {
    // Returns the system prompt verbatim as content.
    // Used for Phase 0 pipeline validation without LLM cost.
    return {
      content: req.systemPrompt,
      toolCalls: [],
      citations: [],
      usage: { inputTokens: 0, outputTokens: 0 },
      stopReason: 'static',
    };
  }
}
```

`core/src/adapters/claude.ts` — stub with real Anthropic SDK integration, but **do not wire it into the runner yet** in Phase 0. Write the code, leave it untested against real API. This validates the interface design and is ready for Phase 1.

[Inference] The official `@anthropic-ai/sdk` is the right choice. Use `messages.create`. Verify current SDK API shape — SDK evolves.

Adapter registry: `core/src/adapters/index.ts` exports a map `ModelId → ModelAdapter`.

### 2.7 Skill Loader

`core/src/skills/loader.ts`:

Responsibilities:
1. Scan `agents/` directory (relative to repo root — `../agents/` from `core/`)
2. For each subdirectory: read `manifest.yaml` and `SKILL.md`
3. Parse YAML, parse Markdown frontmatter (title, description) + body
4. Validate manifest with a zod schema (infer from the types in Section 8)
5. Upsert into `Agent` table (by `slug`)
6. Return loaded `Skill[]`

Validation failures should log loudly but not kill the process — other skills may still be valid.

### 2.8 Agent Runner + Budget Ledger

`core/src/runner/runner.ts`:

```
async function runAgent(skill: Skill, context: RunContext): Promise<RunResult>
```

Steps:
1. Check `BudgetLedger` for today. If projected cost + current cost > `daily_usd_max` and `halt_on_budget_exceeded`, fail fast with `reason: 'budget_exceeded'`.
2. Resolve `ModelAdapter` via `skill.manifest.model.primary` from the adapter registry.
3. Build `NormalizedRequest`: systemPrompt = SKILL.md body; messages = []; etc.
4. Call `adapter.generate()`.
5. Persist `AgentRun` row with status, tokens, cost, output.
6. Update `BudgetLedger` for (agent, today) with token/cost increment.
7. Return `RunResult`.

For Phase 0 with `StaticAdapter`, costs are always 0 — budget logic is wired but never triggers. That's fine; we're testing the path, not the outcomes.

### 2.9 Fastify Server

`core/src/server.ts`:

Endpoints:
- `GET /health` — returns `{ status: 'ok', uptime, version }`. **No auth required.**
- `GET /agents` — lists all agents from DB
- `POST /agents/:slug/run` — triggers a reactive run, returns `RunResult`
- `GET /runs/:id` — fetches a run by ID

Token-auth middleware: reads `SAMIX_TOKEN` from env on startup. For each request except `/health`, checks `Authorization: Bearer <token>` header. Mismatch → 401.

Port: reads `SAMIX_PORT` from env, defaults to `0` (OS-assigned). Binds to `127.0.0.1` only — **never 0.0.0.0**.

Startup sequence:
1. Connect Prisma
2. Load skills via SkillLoader (syncs DB)
3. Register Fastify routes
4. Start listening
5. Log `ready` with actual port

Graceful shutdown on `SIGINT`/`SIGTERM`: close Fastify, disconnect Prisma, exit 0.

### 2.10 Hello-world skill

Create at repo root: `agents/hello-world/SKILL.md` and `agents/hello-world/manifest.yaml` — contents from spec Section 7.

Create also: `agents/_registry.yaml` — for Phase 0 it can be empty or just list hello-world. It's a hook for future auto-discovery controls.

### 2.11 Logging

Use Pino with a child logger per run: `logger.child({ runId })`. In dev, pipe through `pino-pretty`. Every HTTP request gets a correlation ID (use `request.id` from Fastify). Every `runAgent` call creates a child logger tagged with runId.

### 2.12 Core standalone verification (before touching Tauri)

Before moving to the app side, verify the core works by itself:

```bash
cd core
SAMIX_TOKEN=test SAMIX_PORT=4000 DATABASE_URL=file:./data/samix-dev.db pnpm dev
```

Then in another terminal:

```bash
curl http://127.0.0.1:4000/health
curl -H "Authorization: Bearer test" http://127.0.0.1:4000/agents
curl -X POST -H "Authorization: Bearer test" http://127.0.0.1:4000/agents/hello-world/run
```

Expected: third call returns a result with content `"You are the hello-world agent..."` and `status: 'success'`.

**Do not proceed to Tauri until this works cleanly.**

---

## 3. Tauri App (`app/`)

### 3.1 Init

```bash
cd app
pnpm create tauri-app .
```

Choose: TypeScript + React + Vite. Tauri v2.

[Inference] The create-tauri-app CLI has evolved — exact prompts may differ. If the CLI produces a different structure than described here, adapt but keep: `src/` for React, `src-tauri/` for Rust, `vite.config.ts` at app root.

### 3.2 UI dependencies

- `react`, `react-dom` — from scaffold
- `tailwindcss`, `postcss`, `autoprefixer` — standard Tailwind setup
- `shadcn-ui` — [Inference] CLI-based, follow current shadcn docs for Vite + React setup
- `@tanstack/react-query` — for HTTP state
- `zod` — optional, for client-side validation

### 3.3 Rust shell (`src-tauri/src/main.rs`)

Responsibilities:
1. Generate a random UUID as token
2. Pick a free port (bind to `127.0.0.1:0`, read assigned port, release)
3. Spawn core process: `node path/to/core/dist/server.js` (release) or `pnpm --filter samix-core dev` (dev mode)
4. Pass `SAMIX_PORT` and `SAMIX_TOKEN` via environment to child process
5. Expose a Tauri command `get_core_config() -> { port: u16, token: String }` that the UI can `invoke`
6. On app exit: kill the child process cleanly (SIGTERM, then SIGKILL after timeout)

[Inference] In dev mode, consider whether Tauri spawns the core or whether Tom runs it manually in a separate terminal. For Phase 0 simplicity, **manual run is acceptable** — document it in README. Automatic spawn can be Phase 0.5 polish. Flag this decision in the handoff report.

Key crates: `tauri`, `uuid`, `tokio` or `std::process::Command`. Keep it small.

### 3.4 React UI

`src/lib/api.ts`:

```typescript
export async function initApi(): Promise<ApiClient> {
  const config = await invoke<{ port: number; token: string }>('get_core_config');
  return new ApiClient(config.port, config.token);
}
```

`ApiClient` wraps `fetch` with base URL `http://127.0.0.1:<port>` and `Authorization: Bearer <token>` on every request.

Methods: `listAgents()`, `runAgent(slug)`, `getRun(id)`, `health()`.

**Pages/Components:**
- `App.tsx` — initializes API, renders main layout
- `AgentList.tsx` — lists agents, "Run" button per agent
- `RunResult.tsx` — displays the last run result in a card
- `ConnectionBanner.tsx` — if `/health` fails, show red banner "Samix Core disconnected"

Polling: `useQuery` on `/health` every 10 s to detect core crashes.

Styling: minimal. shadcn/ui `Card`, `Button`, `Alert`. No fancy layout yet — newspaper UI is Phase 1.

### 3.5 Tauri config

`src-tauri/tauri.conf.json`:
- App name: `Samix`
- Window title: `Samix`
- Default window size: 1200×800
- Min size: 800×600
- CSP: default-src for the app, connect-src to include `http://127.0.0.1:*` (needed because UI talks to local core)

[Inference] Exact CSP syntax for Tauri v2 may differ — verify against current docs.

---

## 4. Integration & Acceptance

### 4.1 End-to-end smoke test

1. In one terminal: `pnpm dev:core` (or let Tauri spawn it in 3.3)
2. In another: `pnpm dev:app`
3. Tauri window opens. UI loads.
4. Agent list shows `hello-world`.
5. Click "Run" next to it.
6. Result card shows: `"You are the hello-world agent..."` (SKILL.md body).
7. Status: `success`. Tokens: 0. Cost: 0.00 USD.
8. Open Prisma Studio (`pnpm db:studio`): `AgentRun` table has one row.
9. Kill the core process (Ctrl-C). Within 10 seconds the UI shows a red disconnect banner.

All checks passing = Phase 0 done.

### 4.2 README

Write a `README.md` at repo root covering:
- What Samix is (one paragraph, from spec)
- Prerequisites
- First-time setup (`pnpm install`, `pnpm db:migrate`)
- Running in dev (`pnpm dev:core`, `pnpm dev:app`)
- Project structure overview
- Where to find the spec

---

## 5. Known Gotchas and Inference-Flagged Decisions

Places where uncertainty is real — document what you chose and why in code comments or the handoff report.

1. **Prisma + better-sqlite3 adapter model.** [Inference] Prisma has been migrating SQLite support. If the default Prisma setup works out of the box, use it. If you hit issues, switch to `@prisma/adapter-better-sqlite3`. Record which path you took.

2. **Tauri v2 sidecar vs. separate process.** [Inference] Tauri v2 supports a `sidecar` pattern for bundled binaries. For Phase 0 we're explicitly using the non-bundled Alternative D (manual run, or Rust-spawned Node). If you find that spawning from Rust is simpler than documented, great — but don't use the bundled-sidecar pattern yet.

3. **Tauri v2 Command API.** [Inference] The `#[tauri::command]` macro and `invoke` pathway. Verify current syntax.

4. **Port-assignment race condition.** Between picking a free port and the core binding to it, another process could grab it. Acceptable for single-user local app. Do not over-engineer.

5. **Cron in a desktop app.** `node-cron` works but only while the process lives. Phase 0 doesn't trigger cron (no proactive agents yet) — just wire up the dependency and a no-op scheduler that logs `scheduler_ready`.

6. **ESM vs. CommonJS.** Prefer ESM (`"type": "module"`) throughout. Some older packages may need workarounds.

7. **Windows path handling.** `%APPDATA%/samix/samix.db` is for release. In dev, use `./data/samix-dev.db` (relative to `core/`). Do not hardcode Windows-specific paths in dev.

---

## 6. Out of Scope for This Handoff

Do NOT implement in Phase 0 even if easy:

- Real LLM adapter calls (Claude/OpenAI/Perplexity) — stubs fine, runtime use forbidden
- RSS parsing, news fetching
- Newsletter agent
- Newspaper UI (any multi-column layout)
- Cron triggering of agents
- Tray icon
- Autostart on Windows login
- Secrets management via OS keychain
- Windows installer / code signing
- macOS or Linux support

These are explicitly scheduled for Phase 1+.

---

## 7. Handoff Report to Tom (after completion)

When Phase 0 is done, produce a short report covering:

### What works
- Concrete checklist of acceptance criteria passed
- How to run it

### Inference-flagged decisions actually taken
- Prisma adapter choice
- Tauri dev-spawn vs. manual run for core
- Any dependency version surprises

### Known issues / follow-ups
- Anything flaky
- Anything marked `// VERIFY:` in code
- Anything you'd want to refactor in Phase 1

### Deviations from spec
- If you had to deviate from the spec, say what and why
- Flag if a spec section is outdated

### Token/API usage
- Hello-world uses `static` adapter — zero API cost
- Confirm no accidental real API calls happened during implementation/testing

### What's ready for Phase 1
- Which abstractions are solid and what needs work
- Whether `ClaudeAdapter` stub is ready to wire up

---

## 8. Questions to Ask Tom if Blocked

Before guessing on ambiguous choices, ask Tom:

1. Should Rust-shell auto-spawn the core in dev mode, or is manual `pnpm dev:core` in a separate terminal OK for Phase 0?
2. Any existing GitHub username / org preference for the repo?
3. Should we set up GitHub Actions CI in Phase 0 (lint + typecheck + prisma validate) or defer to Phase 1?
4. Preferred icon/logo placeholder for Samix app, or is the Tauri default fine for now?

---

*End of handoff. Phase 1 handoff will be a separate document once Phase 0 is merged and reviewed.*
