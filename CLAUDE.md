# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Values anchor

`docs/SAMIX_ABOUT.md` is the project's values anchor. When a design decision feels ambiguous, re-read it — architecture specs defer to it, not the other way around. The eight core values (local-first, model-agnostic, source-traceable, budget-disciplined, architecture-first, transparent-operations, skills-as-data, honest-AI) are hard constraints, not aspirations.

Prioritization, in order: **architecture cleanliness > cost efficiency > time-to-MVP**. A second API method that duplicates code is wrong even when faster. Refactor now, not later.

## Phase context

The repo ships in named phases. Each phase has a spec + a Claude Code handoff doc in `docs/`.

- **Phase 0 — merged.** Pipeline validation with a `static` adapter returning a literal string. Proved skill-loader → runner → DB → HTTP → UI works end-to-end. See `docs/SAMIX_PHASE_0_SPEC.md` and `docs/SAMIX_PHASE_0_REPORT.md`.
- **Phase 1 — in progress.** First real proactive agent (`newsletter-ai`): real Claude Haiku calls, RSS + Arxiv sources (Perplexity adapter+fetcher are wired but dormant — manifest edit away), JSON-schema output validation that creates `Article` rows, OS-keychain secrets, live cron scheduler. Spec: `docs/SAMIX_PHASE_1_SPEC.md`. Playbook: `docs/SAMIX_PHASE_1_CLAUDE_CODE_HANDOFF.md`. **Pivot:** SMTP + Telegram delivery channels were dropped from Phase 1 — the in-app Newspaper UI is the delivery surface. The original spec/handoff still describe delivery channels; treat those sections as superseded.
- Do not pull Phase 2+ features forward (tray icon, autostart, OpenAI adapter, voting, orchestrator, coding agents, mobile) — the out-of-scope lists in the phase specs are load-bearing.

## Dev platform note

Spec targets Windows-first for shipping. **Development happens on macOS**; no code is intentionally Mac-specific. When writing paths, env handling, or OS integrations, keep both platforms in mind — ship target is Windows.

- One codebase, no per-OS folders. Branch on the OS only at the point of difference (`#[cfg(target_os = ...)]` in Rust, `process.platform` in Node) — today: `pnpm.cmd` vs `pnpm` in `spawn.rs`, and the app-data dir in `core/src/db/location.ts`.
- Spawn Node tools as `process.execPath` + script path, not via `.cmd` shims or a shell (see `core/scripts/prisma.ts`).
- `.gitattributes` forces LF on checkout. Prisma migration checksums, YAML and frontmatter must be byte-identical on both OSes — do not add CRLF files.
- Documented shell commands must work in PowerShell too: no inline `VAR=value cmd` as the only option.

## Commands

All orchestrated from the root via pnpm workspaces (no Turborepo). Node ≥ 20.12 (`util.parseEnv` in `db/location.ts`), pnpm ≥ 10, Rust toolchain for Tauri.

```bash
pnpm install                                     # also runs `prisma generate` (core postinstall)
pnpm --filter samix-core prisma migrate deploy   # first-time DB setup, no .env needed
pnpm db:migrate                                  # create new Prisma migration (dev)
pnpm db:studio                                   # inspect SQLite

pnpm build:core                                  # tsc to core/dist
pnpm build:app                                   # Tauri release bundle
```

`pnpm --filter samix-core prisma …` runs the package script `prisma`, i.e. `core/scripts/prisma.ts`: it resolves `DATABASE_URL` exactly like the runtime does, then calls the Prisma CLI. Do not call `pnpm exec prisma` directly for migrations — it skips that resolution.

### Running in dev

```bash
pnpm dev:app
```

The Tauri shell auto-spawns the core (`pnpm --filter samix-core dev`) with a free loopback port, a fresh per-launch UUID token and the API keys from the OS keychain (`app/src-tauri/src/spawn.rs`), then hands port + token to the WebView via `get_core_config`. The core binds only to `127.0.0.1`; the bearer token is the access control.

Core alone (no UI), e.g. for curl testing:

```bash
SAMIX_TOKEN=testtok SAMIX_PORT=4000 pnpm dev:core                     # macOS / bash
$env:SAMIX_TOKEN='testtok'; $env:SAMIX_PORT='4000'; pnpm dev:core      # Windows PowerShell
```

Release builds do **not** spawn the core yet (the shell needs pnpm + the source tree); bundling the core as a sidecar is a Phase 2 item.

### Testing

There is no test runner and no CI yet. Acceptance is manual — see `README.md` §"Verifying a working install" and the Phase 1 report. The fastest automated check is `pnpm --filter samix-core exec tsc --noEmit` and `pnpm --filter samix-app exec tsc --noEmit`.

## Architecture

Two deployable units plus declarative skill data.

### `core/` — Node.js HTTP core (`samix-core`)

- **`src/server.ts`** — Fastify entrypoint. Binds loopback only, enforces `Authorization: Bearer $SAMIX_TOKEN` on everything except `/health` and CORS preflight. Routes: `GET /health`, `GET /agents`, `POST /agents/:slug/run`, `GET /articles`, `GET /runs/:id`, `GET`/`PUT /agents/:slug/sources` (the PUT rewrites `manifest.yaml` on disk and re-registers the cron job).
- **`src/skills/loader.ts`** — Auto-discovers `agents/<slug>/{SKILL.md,manifest.yaml}` on boot. Validates with Zod (`skills/schema.ts`), upserts the `Agent` row, returns in-memory `Skill[]`. Directories starting with `_` or `.` are ignored (hence `_registry.yaml` is reserved for a future explicit-enable flow). The system prompt is the body of `SKILL.md` after frontmatter.
- **`src/runner/runner.ts`** — Executes a skill. Reads `BudgetLedger` for the UTC day, refuses to run if `halt_on_budget_exceeded && spent >= dailyUsdMax`, resolves the adapter via `resolveAdapter(manifest.model.primary)`, calls `adapter.generate(...)`, persists `AgentRun`, increments `BudgetLedger`. Every run is atomic and logged with a run-scoped Pino child logger.
- **`src/adapters/`** — The model-agnostic boundary. `ModelAdapter` interface in `types.ts`. Registry in `adapters/index.ts` maps `ModelId` → factory. Registered: `static` (returns the system prompt verbatim, zero tokens, zero cost), `claude-haiku-4-5`, `claude-sonnet-4-6`, `perplexity-sonar`, `ollama-llama3`. The runner retries once on the manifest's `fallback` model. **Agent or runner code must never import provider SDKs directly** — always go through an adapter.
- **`src/scheduler/index.ts`** — `node-cron` jobs per proactive skill, with jitter and `catchup_on_startup` (a missed slot triggers a run at core boot — this costs money if keys are set).
- **`src/sources/`** — Fetchers (`rss`, `arxiv`, `perplexity`) behind one interface; every fetched item is persisted as a `SourceSnapshot`.
- **`src/db/prisma.ts` + `src/db/location.ts` + `prisma/schema.prisma`** — SQLite via Prisma. Models: `Agent`, `AgentRun`, `Article`, `BudgetLedger`, `SourceSnapshot`. `location.ts` is the single source of truth for the DB path, shared by runtime and CLI wrapper. Precedence: `DATABASE_URL` env → `DATABASE_URL` in `core/.env` → `SAMIX_DATA_DIR/samix.db` → `NODE_ENV=production`: `%APPDATA%\samix\samix.db` (Windows) / `~/Library/Application Support/samix/samix.db` (macOS) → dev default `core/data/samix-dev.db`. Explicit relative `file:` URLs still resolve against `core/prisma/` (Prisma's rule); the computed defaults are absolute. `BudgetLedger.period` is a UTC day-start (`utcDayStart` in `runner.ts`) — do not change this without also changing the lookup.

### `app/` — Tauri v2 desktop shell (`samix-app`)

- **`src-tauri/src/lib.rs`** — Deliberately minimal. On setup it picks a free port, generates the token and spawns the core (`spawn.rs`); `get_core_config` returns port + token to the WebView. `keychain.rs` exposes `set_secret` / `has_secret` / `delete_secret` (no `get_secret`, by design — ADR 004). **No business logic in Rust** — mobile-ready-by-design means the core speaks HTTP to any client.
- **`src/lib/api.ts`** — `ApiClient` wrapping `fetch`. `initApi()` calls the Tauri command once and caches the client as a module-level promise.
- **`src/App.tsx`** + `components/` — React 19 + Vite + Tailwind + shadcn-style utilities. `ConnectionBanner` polls `/health` every ~10 s; loss of reachability surfaces a red banner, not a crash.

### `agents/` — Skill definitions (data, not code)

A new agent is two files: `SKILL.md` (Markdown + frontmatter — system prompt lives in the body) and `manifest.yaml` (id, type, model preference, budget, optional schedule, optional sources, output shape). The loader picks it up on next core start. **No source edits should be required to ship a new 95%-case agent** — if you find yourself adding a code path to support a specific agent, stop and reconsider whether the skill abstraction should be richer instead.

Manifest YAML uses `snake_case` (`daily_usd_max`); the runtime `Manifest` uses `camelCase` (`dailyUsdMax`). Conversion happens in `normalizeManifest` in the loader — keep both sides in sync when adding fields.

### Non-obvious runtime invariants

- **Loopback + token are the only auth.** No sessions, no users. CORS is permissive by design because the real gate is the bearer token. Do not remove the `crossOriginResourcePolicy: cross-origin` helmet setting — the WebView fetch would break.
- **Skill IDs must match directory names** (the loader keys off `manifest.id`, but `upsertAgent` uses `skill.id` as `slug` — inconsistency will create orphan `Agent` rows).
- **Cost is computed locally from token counts + adapter pricing table**, not trusted from the provider response. If you add an adapter, set `pricing` accurately or the `BudgetLedger` will lie.
- **The budget gate is pre-call.** In Phase 1 it becomes the only thing between a buggy skill and a real bill — the check must stay *before* `adapter.generate`.

## Environment variables

| Var | Purpose |
|---|---|
| `SAMIX_TOKEN` | Shared secret between Rust shell and core. **Required** by the core; the shell generates it per launch. |
| `SAMIX_PORT` | Loopback port. `0` = let OS pick. The shell picks a free port and passes it in. |
| `DATABASE_URL` | Optional. Prisma connection string; overrides the computed path (see `src/db/location.ts`). |
| `SAMIX_DATA_DIR` | Optional. Directory for `samix.db` when `DATABASE_URL` is unset. |
| `SAMIX_LOG_LEVEL` | Pino level (`debug` / `info` / `warn` / `error`). Default `info`. |
| `SAMIX_GLOBAL_DAILY_USD_MAX` | Global daily kill-switch across all agents, checked pre-call in `runner.ts`. |
| `ANTHROPIC_API_KEY` / `PERPLEXITY_API_KEY` | Phase 1+ only. Populated by the Rust shell from the OS keychain, never stored in `.env` in prod. |

## ADRs

`docs/decisions/001–006*.md` record the load-bearing choices (Tauri v2, Node core as separate process, SQLite, OS keychain, Ollama as fallback, Ajv for output validation). Consult before proposing to replace any of them.
