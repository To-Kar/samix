# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Values anchor

`docs/SAMIX_ABOUT.md` is the project's values anchor. When a design decision feels ambiguous, re-read it — architecture specs defer to it, not the other way around. The eight core values (local-first, model-agnostic, source-traceable, budget-disciplined, architecture-first, transparent-operations, skills-as-data, honest-AI) are hard constraints, not aspirations.

Prioritization, in order: **architecture cleanliness > cost efficiency > time-to-MVP**. A second API method that duplicates code is wrong even when faster. Refactor now, not later.

## Phase context

The repo ships in named phases. Each phase has a spec + a Claude Code handoff doc in `docs/`.

- **Phase 0 — merged.** Pipeline validation with a `static` adapter returning a literal string. Proved skill-loader → runner → DB → HTTP → UI works end-to-end. See `docs/SAMIX_PHASE_0_SPEC.md` and `docs/SAMIX_PHASE_0_REPORT.md`.
- **Phase 1 — in progress.** First real proactive agent (`newsletter-ai`): real Claude Haiku calls, RSS + Arxiv sources (Perplexity adapter+fetcher are wired but dormant — manifest edit away), JSON-schema output validation that creates `Article` rows, OS-keychain secrets, live cron scheduler. Spec: `docs/SAMIX_PHASE_1_SPEC.md`. Playbook: `docs/SAMIX_PHASE_1_CLAUDE_CODE_HANDOFF.md`. **Pivot:** SMTP + Telegram delivery channels were dropped from Phase 1 — the in-app Newspaper UI is the delivery surface. The original spec/handoff still describe delivery channels; treat those sections as superseded.
- **Phase 3b — done** (read-only project assistant, `docs/SAMIX_PHASE_3B_SPEC.md`): released folders, path-safe read-only tools, file citations; second delegate of the orchestrator. 3c (coding agent) is not built and needs its own spec.
- **Phase 4 — done** (orchestrator + visible notes, see `docs/SAMIX_PHASE_4_SPEC.md` and the roadmap status): `POST /ask` goes through the `orchestrator` agent, which picks exactly one action per question; notes are written only by the reader. Not verified: any real model's routing.
- **Phase 3a — done** ("Frag deine Zeitung", see `docs/SAMIX_PHASE_3_SPEC.md` and the roadmap status): the first reactive agent — questions answered only from collected articles, via read-only tools and enforced citations. 3b (read-only project assistant) and 3c (coding agent) are specified only. Not verified: any real model's tool use.
- **Phase 2c — done** (see roadmap status): votes + reader profile, dedupe across runs, create/enable/rename Ressorts (agents) from a template, per-agent schedule/sources/model editing, run history. Not done: OpenAI adapter, deleting agents.
- **Phase 2b — in progress** (bundled desktop app for macOS Apple Silicon + Windows): core bundle + Node sidecar (ADR 007), tray, autostart, wake catch-up, onboarding, model choice. Verified on Linux only; see the roadmap status for what is unverified.
- **Phase 1.5 / 2a — done** (see `docs/SAMIX_ROADMAP.md`, which supersedes the phase specs' out-of-scope lists where it differs): stabilisation, newspaper UI + reader, full-text extraction, website sources, DeepSeek adapter. Next: 2b (bundled desktop app, macOS Apple Silicon + Windows).
- Do not pull later-phase features forward (tray icon, autostart, voting, orchestrator, coding agents, mobile, semantic filter) without checking the roadmap first.

## Dev platform note

Spec targets Windows-first for shipping. **Development happens on macOS**; no code is intentionally Mac-specific. When writing paths, env handling, or OS integrations, keep both platforms in mind — ship target is Windows.

## Commands

All orchestrated from the root via pnpm workspaces (no Turborepo). Node ≥ 22.13 (`.node-version`; `node:sqlite`), pnpm ≥ 10, Rust toolchain for Tauri.

```bash
pnpm install
pnpm --filter samix-core test                     # vitest (core)
pnpm --filter samix-core typecheck
pnpm db:migrate                                  # create new Prisma migration (dev)
pnpm db:studio                                   # inspect SQLite

pnpm build:core                                  # tsc to core/dist
pnpm build:app                                   # installable app: pinned Node + core bundle + tauri build (build on the target platform)
```

### Running in dev

```bash
pnpm dev:app
```

The Tauri shell spawns the core itself (`app/src-tauri/src/spawn.rs`) with a free port, a generated token, `SAMIX_PARENT_PID`, and the API keys from the OS keychain. The core applies DB migrations on start, so no manual DB step is needed. To run the core alone: `SAMIX_TOKEN=testtok SAMIX_PORT=4000 pnpm dev:core`. The core binds only to `127.0.0.1`; the bearer token is the access control.

### Testing

`pnpm --filter samix-core test` (vitest). Each test file gets its own migrated temp SQLite DB (`core/test/setup.ts`); providers and fetchers are replaced with fakes via `registerAdapter` / `registerFetcher`. Covered: budget gates, fallback chain, traceability, no-source gate, schema → `partial`, per-agent lock, interrupted-run recovery, catch-up, migrator, HTTP routes (`fastify.inject`), safe fetching, extraction, media, website discovery, DeepSeek adapter. Network is replaced by `test/net.ts` (`useFakeNet`). The app has `pnpm --filter samix-app test` for layout logic only. The theme-file validator is precompiled (`app/scripts/build-theme-validator.mjs` → `validateTheme.generated.js`; rerun after editing the theme schema, a test checks it): the app's CSP has no `'unsafe-eval'`, so Ajv's runtime `compile()` gives a white screen in the installed app. Not covered: the Tauri shell and the React components (checked by hand in Chromium: run the core, then `VITE_SAMIX_PORT=… VITE_SAMIX_TOKEN=… pnpm --filter samix-app exec vite`). Anything claimed as a passing acceptance criterion should have a test or a documented manual check.

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

- **`src-tauri/src/lib.rs`** + `spawn.rs` — Deliberately minimal. Spawns the core, keeps its port/token in `AppState`, and exposes `get_core_config` plus the keychain commands to the WebView. **No business logic in Rust** — mobile-ready-by-design means the core speaks HTTP to any client.
- **`src/lib/api.ts`** — `ApiClient` wrapping `fetch`. `initApi()` calls the Tauri command once and caches the client as a module-level promise.
- **`src/theme/`** — Theme system. A theme is data: `themes/<id>.samix-theme.json` (format `samix-theme/1`, validated with Ajv against `themes/samix-theme.schema.json`). `resolve.ts` picks theme + mode ("follow system"; dark-only themes hand the light case to a selectable light partner) and runs the **contrast gate** (`gatePalette`): user accent / paper tone are corrected in OKLCH lightness until every pair in `contrastRules` passes (WCAG 2 AA; AAA for `contrast: "AAA"` themes); corrections are returned, never applied silently. `apply.ts` writes CSS variables + `data-*` attributes on `<html>`; Tailwind colours (`paper`, `paper-raised`, `ink`, `ink-soft`, `rule`, `line`, `accent`, `on-accent`, `mark`, `focus`, `danger(-paper)`, `warning(-paper)`) and fonts (`font-head`, `font-body`, `font-ui`) read them. **Components use only these tokens — no `dark:` variants and no raw palette colours (`neutral-*`, `red-*`, …):** every theme carries its own light and dark palette. Long-form text uses `.samix-prose` (theme size, leading, measure, paragraph style); lead/teaser photos pass `photo` to `AuthImage` for the theme's image treatment. Appearance settings and own themes are per device (`localStorage`, `store.ts`); `share.ts` imports (size → JSON → schema → gate, failing palettes only on explicit confirmation) and exports theme files. Fonts are bundled via Fontsource (`fontFaces.ts`, imported once in `main.tsx`).
- **`src/i18n/`** — UI language (German / English), chosen under Einrichtung → Sprache, stored per device, defaulting to the system language. Strings live in one module per area under `i18n/ns/`; in each, `de` defines the keys and `en` is typed against it, so a missing translation fails `tsc` (`i18n.test.ts` also checks shapes and stray umlauts in English). **No hard-coded UI strings in components:** add a key to both languages and read it via `useI18n().t`; dates and money via `useFormat()`; `lib/explain.ts` and `lib/cron.ts` take the messages as an argument. The locale sets `<html lang>` (hyphenation, screen readers). Theme names are translated in the theme files' `l10n`. Not covered: texts the core generates (e.g. source notes, preview warnings) and the tray menu (Rust).
- **`src/App.tsx`** + `components/` — React 19 + Vite + Tailwind + shadcn-style utilities. `ConnectionBanner` polls `/health` every ~10 s; loss of reachability surfaces a red banner, not a crash.

### `agents/` — Skill definitions (data, not code)

A new agent is two files: `SKILL.md` (Markdown + frontmatter — system prompt lives in the body) and `manifest.yaml` (id, type, model preference, budget, optional schedule, optional sources, output shape). The loader picks it up on next core start. **No source edits should be required to ship a new 95%-case agent** — if you find yourself adding a code path to support a specific agent, stop and reconsider whether the skill abstraction should be richer instead.

Manifest YAML uses `snake_case` (`daily_usd_max`); the runtime `Manifest` uses `camelCase` (`dailyUsdMax`). Conversion happens in `normalizeManifest` in the loader — keep both sides in sync when adding fields.

### Installed app (Phase 2b)

The shell (`app/src-tauri/src/{lib,spawn,tray}.rs`) runs the **bundled** core with the **bundled** Node sidecar (`spawn.rs::release_command`); `tauri dev` still uses pnpm. `src-tauri/tauri.release.conf.json` adds the sidecar and resources, so dev builds and `cargo check` don't need them. The shell also owns the tray/menu-bar icon (closing the window hides it, quit is in the tray), the autostart plugin (`--hidden`), `restart_core` (re-reads the keychain; installed app only) and `get_app_paths`. `core/scripts/build-bundle.mjs` builds the core bundle, `core/scripts/verify-bundle.mjs` smoke-tests it, `app/scripts/fetch-node.mjs` fetches the checksum-verified Node. **No business logic in Rust** still holds: "Update now" from the tray is an event the UI handles.

### Agents as data, created at runtime (Phase 2c)

A "Ressort" is a proactive agent. `POST /agents` (`skills/create.ts`) writes a new agent folder from a template — a shipped agent whose `SKILL.md` marks its topic sentence with `<!-- focus -->…<!-- /focus -->` (today only `newsletter-ai`); only that sentence is replaced, so there is one prompt to maintain. Agents live in the user's agents folder; `enabled` is database state (a disabled agent is not scheduled, not caught up, and refuses manual runs with 409); the display title is `title:` in the SKILL.md frontmatter. Removing a Ressort (`DELETE /agents/:slug`, proactive only) never deletes: the folder moves to `<agents dir>/.removed/<slug>--<time>`, the cron job stops, the agent drops out of the lists, and its runs and articles stay in the database; the `.removed` name keeps shipped defaults from being re-seeded and the slug from being reused. The topic of a template-based Ressort is editable (`PUT /agents/:slug/topic`). Editing endpoints (`/agents/:slug/{sources,model,schedule,title,enabled,personalize}`) all rewrite the file through `skills/manifestFile.ts` (temp file + rename) and update the running skill.

### Reactive agents and tools (Phase 3a)

`type: reactive` agents answer on request. Which tools an agent may call is data (`tools:` in the manifest, names from `src/tools/index.ts`; unknown names are rejected by the manifest schema); tools themselves are code, read-only, and return bounded results (`src/tools/`). `ModelAdapter` normalises tool calls (`ToolSpec`/`ToolCall`/`tool` messages in `types.ts`); Claude and DeepSeek translate them, the others throw on tools (`adapters/no-tools.ts`). `runner/converse.ts` (`askAgent`) is the loop behind `POST /ask`; budget arithmetic is shared with `runner.ts` via `runner/budget.ts`. Conversations (`Conversation`/`ConversationMessage`) are plain user data and deletable; the `AgentRun` rows that paid for them stay. Reactive agents do not appear under Ressorts.

### Orchestrator and notes (Phase 4)

`agents/orchestrator` is a reactive agent with `routes:` (which actions) and `delegates:` (which agents it may hand a question to) instead of `tools:`. `runner/orchestrate.ts` makes **one** routing call (max 2 with a reminder); the core executes the chosen action and the reader sees only its result. A delegate runs through `askAgent` (`ephemeral`, caller-supplied `history`) with its own `AgentRun`, budget and gates. `runner/turn.ts` holds the bookkeeping `askAgent` and `routeQuestion` share. `MemoryNote`s (`memory/notes.ts`, `/notes`) are written only through the notes API by the reader and read by agents through the `read_notes` tool, if their manifest lists it.

### Project files (Phase 3b)

`Project` rows are folders the reader released; `allowModelAccess` must be on or no tool returns anything. All filesystem access goes through `projects/safePath.ts` (relative paths only, `realpath` inside the real root, exclusions, symlinks skipped, size caps) and is read-only. Tool results surface `file:<projectId>:<path>` source ids; `converse.ts` validates them exactly like article ids.

### Non-obvious runtime invariants

- **Project files are read-only, released per folder, and never reached by path tricks.** Do not add a tool that takes an absolute path or writes, and do not bypass `resolveInProject`. The exclusion list is a heuristic, not a guarantee.

- **The orchestrator has no voice and no side effects.** Its model never writes user-visible text, never picks a delegate outside `delegates:`, and cannot start anything that costs money or changes data: `propose_refresh` only returns a proposal the reader confirms in the UI. Notes are not citable (they surface no article ids) and the model cannot write them.

- **Answers are grounded in code, not in the prompt.** In `converse.ts` an article may only be cited if a tool returned it *in this question*; invented ids are dropped, `[n]` is renumbered, nothing citable → `partial`, nothing found at all → a fixed text (the model's text is not shown). An answer without any search is `partial: ungrounded`. A model without tool support is refused before any call, and a fallback without tools is never used. The budget gate (agent + global) runs before **every** model call of a question, max 6 calls, max 3 full-text fetches. Do not move any of this into the prompt.

- **Paid sources are budgeted like model calls.** A source that costs money (`perplexity_search`) must `ctx.reserve()` before each request (agent day cap + global cap, leaving room for the model call) and report `ctx.spend()` afterwards; the runner books it to the ledger and the run. Never call a paid API from a fetcher without both. Its results are enriched from the page itself, never from the provider's generated text.
- **Story grouping is the model's judgement, checked only structurally.** `story` keys survive only if ≥ 2 accepted articles share them (`output/traceability.ts`); the UI shows every member. Do not add code or prompts that claim sources "agree" or "confirm".
- **Shipped agents are brought forward, not frozen.** `skills/sync.ts` (installed app) replaces an agent's prompt, schema and capability keys when the shipped `version` is higher; user edits (title, sources, schedule, model, limits, topic) stay and the old files are backed up. **Bump `version` in a shipped agent's `manifest.yaml` whenever its prompt, schema or capability keys change**, or installed copies never see it. Prices and limits the reader sets live in `AppSetting` (`settings.ts`) and win over built-ins and the environment.
- **Dedupe before the model.** Items whose URL the same agent published within `dedupe_days` (default 14) are dropped before the call (`runner/dedupe.ts`); if none are left the run is a zero-cost success (`no_new_items`), not a failure.
- **Personalisation is opt-in and inspectable.** With `personalize: true` and at least one vote, the user message carries `readerProfile` (≤ 10 liked / disliked titles + topics of that agent, `runner/profile.ts`). `GET /profile` shows exactly this; nothing else personal is ever sent. Without votes or opt-in the message is unchanged.

- **Loopback + token are the only auth.** No sessions, no users. CORS is permissive by design because the real gate is the bearer token. Do not remove the `crossOriginResourcePolicy: cross-origin` helmet setting — the WebView fetch would break.
- **Skill IDs must match directory names** (the loader keys off `manifest.id`, but `upsertAgent` uses `skill.id` as `slug` — inconsistency will create orphan `Agent` rows).
- **Cost is computed locally from token counts + adapter pricing table**, not trusted from the provider response. If you add an adapter, set `pricing` accurately or the `BudgetLedger` will lie.
- **Articles must be traceable (`src/output/traceability.ts`).** A schema-valid article is only stored if its URL matches an item fetched in *this* run; URL, source name and date are taken from that item, never from the model. Too few survivors (< `output.min_items`) → run is `partial`. Do not move this check into the prompt.
- **No sources, no model call.** A skill that declares `sources` but fetched zero items fails with `no_source_items` before any adapter call.
- **Every fetch of a third-party URL goes through `net/safeFetch.ts`** (feeds, pages, images, sitemaps). It refuses non-public addresses on every redirect hop and caps size. Never call `fetch` on a URL that came from a feed or a page.
- **No HTML from the web reaches the UI.** Pages are reduced to blocks (`content/blocks.ts`); the UI renders them as React text. Images are stored by the core (type sniffed from bytes, SVG refused) and served via `GET /media/:id`, which needs the token, so the UI loads them with `fetch` and shows `blob:` URLs.
- **Editions:** one successful run that produced articles = one edition. Which article is the lead is the UI's layout decision (`app/src/lib/layout.ts`); the core pre-loads the full text of the two most important ones after a run (`runner/hooks.ts`, registered only by `server.ts`).
- **One run per agent at a time** (in-process lock in `runner.ts`); a second trigger is recorded as `failed: already_running`. Runs left `running` by a dead process are marked `failed: interrupted` at startup.
- **The budget gate is pre-call.** In Phase 1 it becomes the only thing between a buggy skill and a real bill — the check must stay *before* `adapter.generate`.

### Releases

One version for the whole repo: `node scripts/version.mjs <x.y.z>` sets it in every file that carries it, `--check` verifies (CI and `core/test/version.test.ts`). A tag `vX.Y.Z` triggers `release.yml`, which checks the tag against the version, builds macOS (Apple Silicon) and Windows, signs/notarises macOS only if the Apple secrets exist, and files a **draft** GitHub release. None of it has run on a real runner; see `docs/SAMIX_RELEASE.md`.

## Environment variables

| Var | Purpose |
|---|---|
| `SAMIX_TOKEN` | Shared secret between Rust shell and core. **Required** on both processes. |
| `SAMIX_PORT` | Loopback port. `0` = let OS pick; in dev we use a fixed port so the Tauri shell can reuse it. |
| `DATABASE_URL` | SQLite `file:` URL. Optional: defaults in code to `core/data/samix-dev.db` (absolute). Relative paths resolve against `core/prisma/`, so prefer absolute. |
| `DEEPSEEK_API_KEY` | Keychain account / env var for the DeepSeek adapter. Price, model and URL are overridable via `SAMIX_DEEPSEEK_PRICE_IN/OUT`, `SAMIX_DEEPSEEK_MODEL`, `SAMIX_DEEPSEEK_URL`; defaults are marked unverified in `adapters/deepseek.ts`. |
| `SAMIX_CONTENT_RETENTION_DAYS` / `SAMIX_MEDIA_DIR` | Cached full texts and images expire after this many days (default 90); media dir defaults to `media/` next to the database. |
| `SAMIX_AGENTS_DIR` / `SAMIX_BUNDLED_AGENTS_DIR` / `SAMIX_MIGRATIONS_DIR` / `SAMIX_LOG_FILE` | Set by the shell in the installed app: editable agents folder, shipped defaults (copied once, never overwritten), bundled migrations, JSON log file (rotated at start, written synchronously). Dev uses the repo's `agents/` and `prisma/migrations`. |
| `SAMIX_PARENT_PID` | Set by the Tauri shell. The core exits when this process is gone. |
| `SAMIX_OLLAMA_URL` / `SAMIX_OLLAMA_MODEL` | Ollama endpoint and model tag. Defaults `http://127.0.0.1:11434` / `llama3`. |
| `SAMIX_LOG_LEVEL` | Pino level (`debug` / `info` / `warn` / `error`). Default `info`. |
| `SAMIX_GLOBAL_DAILY_USD_MAX` | Phase 1+ global kill-switch across all agents. Not yet enforced in Phase 0. |
| `ANTHROPIC_API_KEY` / `PERPLEXITY_API_KEY` | Phase 1+ only. Populated by the Rust shell from the OS keychain, never stored in `.env` in prod. |

## ADRs

`docs/decisions/001–006*.md` record the load-bearing choices (Tauri v2, Node core as separate process, SQLite, OS keychain, Ollama as fallback, Ajv for output validation). Consult before proposing to replace any of them.
