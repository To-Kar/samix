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

## Commands

All orchestrated from the root via pnpm workspaces (no Turborepo). Node ≥ 20, pnpm ≥ 10, Rust toolchain for Tauri.

```bash
pnpm install
pnpm --filter samix-core prisma migrate deploy   # first-time DB setup
pnpm db:migrate                                  # create new Prisma migration (dev)
pnpm db:studio                                   # inspect SQLite

pnpm build:core                                  # tsc to core/dist
pnpm build:app                                   # Tauri release bundle
```

### Running in dev (two terminals, Phase 0)

The Rust shell does **not** auto-spawn the core yet. Start each process manually with matching env vars.

```bash
# Terminal 1 — core
SAMIX_TOKEN=testtok SAMIX_PORT=4000 pnpm dev:core

# Terminal 2 — app (Rust shell reads the same env vars and hands them to the WebView via `get_core_config`)
SAMIX_TOKEN=testtok SAMIX_PORT=4000 pnpm dev:app
```

Auto-spawn is a Phase 0.5 / Phase 1 polish item; see `app/src-tauri/src/lib.rs` for the current shim. The core binds only to `127.0.0.1`; the bearer token is the access control.

### Testing

There is no test runner wired up yet. Phase 0 acceptance is manual — see `README.md` §"Phase 0 acceptance check" (5 steps ending with a disconnect banner).

## Architecture

Two deployable units plus declarative skill data.

### `core/` — Node.js HTTP core (`samix-core`)

- **`src/server.ts`** — Fastify entrypoint. Binds loopback only, enforces `Authorization: Bearer $SAMIX_TOKEN` on everything except `/health` and CORS preflight. Routes: `GET /health`, `GET /agents`, `POST /agents/:slug/run`, `GET /runs/:id`.
- **`src/skills/loader.ts`** — Auto-discovers `agents/<slug>/{SKILL.md,manifest.yaml}` on boot. Validates with Zod (`skills/schema.ts`), upserts the `Agent` row, returns in-memory `Skill[]`. Directories starting with `_` or `.` are ignored (hence `_registry.yaml` is reserved for a future explicit-enable flow). The system prompt is the body of `SKILL.md` after frontmatter.
- **`src/runner/runner.ts`** — Executes a skill. Reads `BudgetLedger` for the UTC day, refuses to run if `halt_on_budget_exceeded && spent >= dailyUsdMax`, resolves the adapter via `resolveAdapter(manifest.model.primary)`, calls `adapter.generate(...)`, persists `AgentRun`, increments `BudgetLedger`. Every run is atomic and logged with a run-scoped Pino child logger.
- **`src/adapters/`** — The model-agnostic boundary. `ModelAdapter` interface in `types.ts`. Registry in `adapters/index.ts` maps `ModelId` → factory. Phase 0 ships `StaticAdapter` (returns the system prompt verbatim, zero tokens, zero cost) and `ClaudeAdapter` (stub, not yet exercised). **Agent or runner code must never import provider SDKs directly** — always go through an adapter. Phase 1 activates Claude and adds Perplexity + Ollama.
- **`src/scheduler/index.ts`** — No-op in Phase 0; Phase 1 wires `node-cron` with jitter and `catchup_on_startup`.
- **`src/db/prisma.ts` + `prisma/schema.prisma`** — SQLite via Prisma. Models: `Agent`, `AgentRun`, `Article`, `BudgetLedger`. DB lives at `core/data/samix-dev.db` in dev, `%APPDATA%/samix/samix.db` on Windows prod. `BudgetLedger.period` is a UTC day-start (`utcDayStart` in `runner.ts`) — do not change this without also changing the lookup.

### `app/` — Tauri v2 desktop shell (`samix-app`)

- **`src-tauri/src/lib.rs`** — Deliberately minimal. Exposes one `get_core_config` Tauri command that reads `SAMIX_PORT` + `SAMIX_TOKEN` from its own environment and returns them to the WebView. **No business logic in Rust** — mobile-ready-by-design means the core speaks HTTP to any client.
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
| `SAMIX_TOKEN` | Shared secret between Rust shell and core. **Required** on both processes. |
| `SAMIX_PORT` | Loopback port. `0` = let OS pick; in dev we use a fixed port so the Tauri shell can reuse it. |
| `DATABASE_URL` | Prisma connection string. Defaults to `file:./data/samix-dev.db` via `.env` in `core/`. |
| `SAMIX_LOG_LEVEL` | Pino level (`debug` / `info` / `warn` / `error`). Default `info`. |
| `SAMIX_GLOBAL_DAILY_USD_MAX` | Phase 1+ global kill-switch across all agents. Not yet enforced in Phase 0. |
| `ANTHROPIC_API_KEY` / `PERPLEXITY_API_KEY` | Phase 1+ only. Populated by the Rust shell from the OS keychain, never stored in `.env` in prod. |
| `SAMIX_ARTICLE_RETENTION_DAYS` | Days to keep `Article` rows. Default `30`. |
| `SAMIX_SNAPSHOT_RETENTION_DAYS` | Days to keep `SourceSnapshot` rows. Default `30`. |
| `SAMIX_RUN_RETENTION_DAYS` | Days to keep orphaned `AgentRun` rows (those with no children). Default `14`. |

## ADRs

`docs/decisions/001–006*.md` record the load-bearing choices (Tauri v2, Node core as separate process, SQLite, OS keychain, Ollama as fallback, Ajv for output validation). Consult before proposing to replace any of them.
