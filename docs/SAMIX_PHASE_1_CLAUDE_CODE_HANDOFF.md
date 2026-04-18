# Samix — Claude Code Handoff for Phase 1

**Companion to:** `SAMIX_PHASE_1_SPEC.md`
**Audience:** Claude Code (or any capable coding assistant) executing Phase 1 implementation
**Scope:** Activate the first proactive agent end-to-end — real LLM calls, real sources, real deliveries. Built on top of the merged Phase 0 pipeline.

---

## 0. Before You Start

### Read first (in order)

1. `SAMIX_ABOUT.md` — the values anchor. Re-read whenever a design decision feels ambiguous. The spec defers to it, not the other way around.
2. `SAMIX_PHASE_1_SPEC.md` — architecture, types, schema, decisions. This is the authoritative reference.
3. `SAMIX_PHASE_0_REPORT.md` — what shipped in Phase 0, known follow-ups that Phase 1 inherits.
4. This document — step-by-step implementation playbook.
5. `docs/decisions/004-006*.md` — short ADR stubs for Phase 1 decisions.

### What's already in the repo

Phase 0 is merged and acceptance-tested. Do not re-invent anything from Phase 0:

- `core/` — Fastify + Prisma + SQLite; StaticAdapter + ClaudeAdapter stub; SkillLoader; AgentRunner; BudgetLedger; Pino logging; token auth; CORS; graceful shutdown.
- `app/` — Tauri v2 + React + Vite + Tailwind; ApiClient; AgentList; RunResult card; ConnectionBanner + `/health` polling; `get_core_config` Tauri command.
- `agents/hello-world/` — Phase 0 smoke-test skill. Keep it working; your new `newsletter-ai` lives beside it.
- `docs/decisions/001–003*.md` — Phase 0 ADRs.

### Prerequisites to verify

On top of Phase 0 prereqs (Node 20, pnpm, Rust toolchain, git):

- **Ollama** — user has installed it locally (`brew install ollama && ollama pull llama3`). If unreachable at core startup, the adapter must self-unregister and log loudly, never block boot. Spec §21 risk row.
- **SMTP credentials** — typically a provider-specific "app password" with 2FA. Document provider-specific gotchas in the README.
- **Telegram bot** — created via BotFather, chat-id obtained via `getUpdates`. README step.
- **Anthropic + Perplexity API keys** — paid accounts with credit.

### Ground rules

- **Prioritization:** architecture cleanliness > cost efficiency > speed to MVP (unchanged from Phase 0).
- **Model-agnostic is not a suggestion.** Every adapter must implement `ModelAdapter` cleanly. No provider-specific concepts leaking into the runner or skill loader.
- **Source-traceability is enforced in code, not docs.** Output validator rejects anything without `sourceUrl`. `SourceSnapshot` rows prove what the LLM saw — persist them even if the LLM ignores the item.
- **Budget is a pre-call gate.** The global USD cap is checked *before* the adapter is invoked, not after. This is the only thing standing between you and a bill.
- **Secrets never leave Rust except via spawn ENV.** No `get_secret` Tauri command. UI sees "configured: true/false" booleans, never values.
- **When uncertain** about a specific SDK/API/library: consult current official docs. Mark uncertainty in code with `// VERIFY:`. Do not guess versions.
- **Do not implement Phase 2+ features** — tray icon, autostart, OpenAI adapter, voting, retention, orchestrator all out of scope per spec §20.

---

## 1. Recommended Implementation Order

Each step runs cleanly before moving to the next. Integration friction shows up loudly when you skip forward.

1. **Types + schema** — extend `types.ts`, add Prisma models, migrate. No runtime yet.
2. **Keychain + secrets flow** — Rust `keychain.rs`, Tauri commands, Settings UI page to set keys. Verify with `has_secret` + OS keychain inspection.
3. **Adapters** — activate `ClaudeAdapter`, add `PerplexityAdapter`, add `OllamaAdapter`. Unit-test each against real APIs with trivial prompts.
4. **Source fetchers** — RSS, Perplexity search, Arxiv. Each fetcher standalone, returns `SourceItem[]`, persists `SourceSnapshot` rows.
5. **Output validator** — Ajv wrapper with `ajv-formats`. Validate both valid and invalid LLM outputs before wiring into runner.
6. **Runner integration** — stitch fetchers → adapter → validator → Article rows. `newsletter-ai` manifest exists at this point; trigger it manually via `POST /agents/newsletter-ai/run`.
7. **Delivery** — SMTP channel, Telegram channel, DeliveryDispatcher. Delivery fires from runner on successful run.
8. **Scheduler activation** — replace the no-op; register jobs; implement jitter + catchup.
9. **HTTP API extensions** — new routes for articles, sources, deliveries.
10. **UI pages** — Newspaper, Sources, Deliveries, Settings. Sidebar nav.
11. **Rust auto-spawn** — Phase-0.5 polish from the Phase 0 report. Bundles the two terminals into one.
12. **End-to-end acceptance** — run all 12 criteria from spec §19.

Mark progress with TaskCreate at the top of the implementation session so stalled work is visible.

---

## 2. Core Extensions (`core/`)

### 2.1 Types (`src/types.ts`)

Add the new interfaces from spec §10 (`SourceItem`, `SourceFetcher`, `FetchContext`, `DeliveryChannel`, `DeliveryPayload`, `DeliveryResult`, `OutputValidator`, `ValidationResult`). Extend `RunResult` with `articleIds: string[]` and `deliveries: DeliveryResult[]`. Extend `ModelId` with `perplexity-sonar` and `ollama-llama3`. Rename `claude-sonnet-4-5` → `claude-sonnet-4-6` (Phase 0 report flagged this; April-2026 verified model id).

### 2.2 Prisma schema (`prisma/schema.prisma`)

Add `SourceSnapshot`, `DeliveryLog`, `DeliverySchedule` per spec §11. Extend `AgentRun` with back-relations. Generate a migration named `phase-1-sources-delivery`. **Do not** alter existing columns on `AgentRun`, `Article`, `BudgetLedger` — they were sized correctly for this phase in Phase 0.

### 2.3 Adapters (`src/adapters/`)

- **Activate `claude.ts`** — already implemented as a Phase 0 stub. Add `claude-sonnet-4-6` if you plan to use Sonnet (Phase 1 skill only needs Haiku). Register both in `index.ts`.
- **`perplexity.ts`** — OpenAI-compatible endpoint at `https://api.perplexity.ai/chat/completions`. Pass `search_recency_filter` through from `routing: { research: ... }` callers if needed (Phase 1 runs the skill hardcoded, so not critical yet). Map `citations[]` from response into `NormalizedResponse.citations`.
- **`ollama.ts`** — `http://127.0.0.1:11434/api/chat`. On adapter construction, ping `/api/version`; if it fails, throw a typed `OllamaUnreachable` error. The registry wrapper catches it and omits the adapter cleanly.
- **`index.ts`** — registry is a map; add new entries, export a `resolveAdapter(id)` helper that also handles fallback chains (primary fails → log → try `manifest.model.fallback` → if that also fails, run fails).

### 2.4 Source fetchers (`src/sources/`)

- **`base.ts`** — `SourceFetcher<C>` interface from spec §10.
- **`rss.ts`** — uses `feedsmith` (verified modern, all-in-one RSS/Atom/RDF/JSON Feed). Iterate `config.urls`, cap per-feed at `config.maxPerFeed`. Normalize into `SourceItem[]`.
- **`perplexity.ts`** — reuses `PerplexityAdapter`'s HTTP client; input is `queries[]` + `recencyHours`. Each query → one Sonar call → list of results. Citations become separate `SourceItem`s so the LLM gets a flat list.
- **`arxiv.ts`** — `GET http://export.arxiv.org/api/query?search_query=cat:cs.AI&start=0&max_results=15`. Response is **Atom 1.0** — `feedsmith` parses that too, same parser as RSS. Implement 429-retry-with-backoff (spec §7 calls this out explicitly — arxiv tightened rate-limits Feb 2026).
- **Persistence** — each fetcher's caller (the runner, not the fetcher itself) writes `SourceSnapshot` rows. Fetchers are pure I/O + parsing.

### 2.5 Output validator (`src/output/validator.ts`)

```typescript
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
```

Load schema from `join(dirname(skill.skillMdPath), manifest.output.schemaPath)`. Compile once per skill (cache by path). Return `{ valid, errors, parsed }`. Runner handles what to do with the result.

### 2.6 Runner integration (`src/runner/runner.ts`)

The Phase 0 runner already handles: budget check → adapter call → persist run → update ledger. Phase 1 wraps this with two new phases:

1. **Pre-adapter (after budget check):**
   - If `manifest.sources`, resolve each via `SourceFetcher` registry.
   - Collect `SourceItem[]`, persist each as a `SourceSnapshot` with `agentRunId = runId`.
   - Pass the flat list to the adapter via `NormalizedRequest.messages[0].content` as structured JSON (the skill prompt instructs the LLM on the shape).

2. **Post-adapter (before returning):**
   - If `manifest.output.schemaPath`, run the validator.
   - Valid → create `Article` rows from `parsed.items[]`, each linked to the run.
   - Invalid → set `status='partial'`, persist raw output and error list in `AgentRun.error`, **skip Article creation and delivery**.
   - On `status='success'`, call `DeliveryDispatcher.run(agentRun, articles)` — delivery failures log but don't flip run status.

### 2.7 Global budget gate

Before the adapter call, sum `BudgetLedger.costUsd` for today (UTC day, same as per-agent logic in Phase 0). If `sum + estimatedRunCost > SAMIX_GLOBAL_DAILY_USD_MAX`, abort with `reason: 'global_budget_exceeded'`. "Estimated" for Phase 1: use the adapter's `pricing` × `manifest.budget.tokensPerRunMax` as a pessimistic estimate. This will reject early in the day if a single misconfigured skill could blow the budget.

### 2.8 Delivery (`src/delivery/`)

- **`mail.ts`** — `nodemailer` with SMTP config from env. HTML template as a simple template-literal function (`renderDigest(articles)` → string). Subject: `Samix — <date> — <N> items`.
- **`telegram.ts`** — direct `fetch` to `https://api.telegram.org/bot<token>/sendMessage`. Markdown formatting. One message with list of links; rate-limit is only a concern for large digests — not a Phase 1 blocker.
- **`dispatcher.ts`** — reads `DeliverySchedule` rows, dispatches in parallel, writes `DeliveryLog` per channel. Returns `DeliveryResult[]`.
- **`index.ts`** — channel registry mirror of the adapter registry pattern.

### 2.9 Scheduler (`src/scheduler/index.ts`)

Replace the no-op. For each skill with `type === 'proactive' && manifest.schedule`:

- Register a `node-cron` task using `manifest.schedule.cron` + `timezone`.
- Inside the task: `await delay(jitterMs)` then `await runAgent({ skill, trigger: 'schedule' })`.
- **Catchup**: at boot, `SELECT max(startedAt)` from `AgentRun` where `agentId = ? AND status = 'success'`. If older than one cron interval (compute via `cron-parser` or equivalent), fire one immediate run with `trigger: 'catchup'`. Not re-fired on the next boot — catchup is always one-shot.
- **Live reload**: when a skill's manifest is rewritten (via `PUT /agents/:slug/sources`), stop that skill's existing task, reload the skill, re-register. Keep a `Map<slug, Task>` inside the scheduler for this.

### 2.10 HTTP API extensions (`src/server.ts`)

New routes per spec §12 — all behind existing token auth:

- `GET /articles?since=&topic=&agent=` — paginated (default 100, max 500).
- `GET /articles/:id` — includes related `SourceSnapshot[]`.
- `GET /agents/:slug/sources` — read manifest, return the `sources:` array.
- `PUT /agents/:slug/sources` — validate payload, atomically write manifest (`tmpWrite + fsync + rename`), call scheduler's `reloadSkill(slug)`.
- `GET /deliveries` — join `DeliverySchedule` + recent `DeliveryLog[]`.
- `PUT /deliveries/:channel` — update enable flag + non-secret config.
- `POST /deliveries/:channel/test` — render a sample payload and send.

Add Pino redaction paths for `req.headers.authorization`, any `apiKey`, `smtpPass`, `botToken` fields to keep secrets out of request logs.

### 2.11 Standalone core verification

Before touching the UI:

```bash
cd core
SAMIX_TOKEN=test SAMIX_PORT=4000 \
  ANTHROPIC_API_KEY=sk-... \
  PERPLEXITY_API_KEY=pplx-... \
  pnpm dev
```

Then:

```bash
curl -X POST -H "Authorization: Bearer test" http://127.0.0.1:4000/agents/newsletter-ai/run | jq .
curl -H "Authorization: Bearer test" http://127.0.0.1:4000/articles
```

Expected: `status: 'success'`, 5–10 Article rows, SourceSnapshot rows visible in Prisma Studio, non-zero cost in `AgentRun.costUsd` and `BudgetLedger`.

Do not proceed to the UI or delivery before this passes.

---

## 3. Tauri App Extensions (`app/`)

### 3.1 Keychain (`src-tauri/src/keychain.rs`)

Crate: `keyring = "3"` (verify current major at install time).

```rust
use keyring::Entry;

#[tauri::command]
fn set_secret(account: String, value: String) -> Result<(), String> {
    Entry::new("samix", &account).map_err(|e| e.to_string())?
        .set_password(&value).map_err(|e| e.to_string())
}

#[tauri::command]
fn has_secret(account: String) -> bool {
    Entry::new("samix", &account)
        .and_then(|e| e.get_password()).is_ok()
}

#[tauri::command]
fn delete_secret(account: String) -> Result<(), String> {
    Entry::new("samix", &account).map_err(|e| e.to_string())?
        .delete_password().map_err(|e| e.to_string())
}
```

Register all three in `invoke_handler`. **Do not add a `get_secret`** — secrets leave Rust only via spawn env.

### 3.2 Core auto-spawn (replaces Phase 0 manual-start)

At Tauri startup in dev mode:

1. Read secrets from keychain for known accounts. Missing keys → log warning but continue (Ollama-only mode still functional).
2. Pick a free port: bind `127.0.0.1:0`, read assigned port, close listener. Accept the race per Phase 0 handoff.
3. Generate a UUID token.
4. `Command::new("pnpm").args(["--filter", "samix-core", "dev"]).env("SAMIX_PORT", ...).env("SAMIX_TOKEN", ...).env("ANTHROPIC_API_KEY", ...)...spawn()`.
5. Poll `http://127.0.0.1:<port>/health` until 200 or timeout (10 s).
6. On app exit: SIGTERM to child, SIGKILL after 5 s if still alive.
7. Expose `get_core_config()` as before — still the only way UI gets port + token.

For `pnpm tauri build` (release), the core ships as a bundled binary sidecar; defer that packaging decision to Phase 2 if it becomes complex. Dev-mode auto-spawn is the Phase-1.0 deliverable.

### 3.3 UI pages (`src/pages/`)

Sidebar (shadcn `Sheet` or custom):

- **Newspaper (`/`)** — queries `GET /articles?since=<today-7d>`. Group by `createdAt` day, render as cards in descending-date order. `Open` button uses `@tauri-apps/plugin-opener`.
- **Sources (`/sources`)** — one section per agent. Form fields for each source type (RSS urls list, Perplexity queries list, Arxiv config). Save button → `PUT /agents/:slug/sources`. Show "scheduler reloaded" toast on success.
- **Deliveries (`/deliveries`)** — two cards (SMTP, Telegram). Each shows: configured secrets (boolean via `has_secret`), enable toggle, test-send button, last 10 `DeliveryLog` rows.
- **Settings (`/settings`)** — four secret-entry forms (anthropic, perplexity, smtp credentials grouped, telegram credentials grouped). Save → `set_secret`. Warning banner: "restart app to load new keys" after save.

Routing: `react-router` or a minimal custom switch; shadcn already ships with `react-router-dom` if you scaffold that way.

### 3.4 API client extensions (`src/lib/api.ts`)

Add methods: `listArticles(filter)`, `getArticle(id)`, `getSources(slug)`, `putSources(slug, sources)`, `getDeliveries()`, `putDeliveryConfig(channel, config)`, `testDelivery(channel)`. All thin wrappers around `fetch` with the existing auth.

---

## 4. Skill Files (`agents/newsletter-ai/`)

Write per spec §9:

- `SKILL.md` — system prompt instructing the LLM to: (a) take the structured source list it receives, (b) pick the top 5–10 items by relevance, (c) produce a JSON response matching `schema.json` (it will reference the schema inline to reduce hallucination). Emphasize "do not invent URLs or dates — use only values present in the source list."
- `manifest.yaml` — concrete values per spec §9. Starting cron: `0 6 * * *` Europe/Berlin. Starting source URLs: 2–3 RSS feeds Tom cares about; Perplexity queries Tom cares about; Arxiv categories Tom cares about. These will be editable from the Sources UI.
- `schema.json` — exactly as in spec §9.

---

## 5. Known Gotchas and Inference-Flagged Decisions

Document what you chose and why in code comments or the handoff report.

1. **Ollama version compatibility.** `/api/chat` is the stable endpoint; `/api/generate` is deprecated in newer Ollama versions. VERIFY current API shape at install time.
2. **Perplexity Sonar vs. Sonar Pro.** Sonar Pro costs more but returns more citations. Phase 1 skill uses Sonar. If output quality is poor, switch in the adapter — it's a model-id change, not a code change.
3. **Atomic manifest writes.** Node's `fs.rename` is atomic on the same filesystem, but not if `/tmp` is a different mount. Write the temp file *in the same directory* as the target, then rename.
4. **Cron timezone vs. DST.** `node-cron` respects `timezone` but has historically had DST edge-case bugs. Test a run scheduled across a DST boundary if you can; otherwise document as a known edge case.
5. **SMTP "app password" vs. regular password.** Most consumer providers (Gmail, iCloud, etc.) require app-specific passwords when 2FA is on. The Deliveries page must not validate as "secret too short" — app passwords are typically 16 chars.
6. **Ajv `strict: false`.** The JSON Schema in `agents/` uses Draft 2020-12. Strict mode rejects unknown keywords; disable for skill schemas to stay forward-compatible.
7. **Global budget cap — clock source.** UTC day rollover, not local day. Matches Phase 0 ledger semantics.
8. **Ollama slow first token.** Cold-start on a local model is seconds-to-minutes depending on hardware. Fallback logic should not interpret slow-first-token as unreachable — use a generous timeout (e.g. 2 minutes) on Ollama calls.
9. **Telegram markdown escaping.** `sendMessage` with `parse_mode: 'MarkdownV2'` requires `_ * [ ] ( ) ~` etc. to be escaped. Use a small escape helper; titles from RSS often contain these.
10. **Newspaper layout is single-column on purpose.** Spec §3 — do not add multi-column / masonry / grid layouts. That's a Phase 2 design decision if it ever becomes one.

---

## 6. Out of Scope for This Handoff

Do NOT implement in Phase 1 even if easy:

- OpenAI adapter (deferred, ADR-005)
- Voting / personalization / up-down votes on articles
- Retention policy / auto-delete of old rows
- Tray icon + Windows autostart (Phase 2)
- Orchestrator / delegating router (Phase 4)
- Reactive coding agent (Phase 3)
- Cross-agent memory (Phase 4+)
- Multi-platform installers, code signing (Phase 5+)
- Cross-device sync (never — local-first)

If a feature is in spec §20 "Out of Scope for Phase 1", it stays out of scope here even if the implementation gets tempting.

---

## 7. Handoff Report to Tom (after completion)

When Phase 1 is done, produce a `SAMIX_PHASE_1_REPORT.md` following the Phase 0 report template. Cover:

### What works
- Acceptance-criteria checklist (all 12 from spec §19).
- How to run it end-to-end (single command now that auto-spawn exists).

### Decisions actually taken
- Which RSS library you settled on (feedsmith unless blocked).
- SMTP + Telegram config sources (README docs for providers).
- Any model version bumps (Haiku 4.5 → 4.6 if released during build, Sonnet id rename).
- Ajv / cron-parser / nodemailer versions pinned.

### Known issues / follow-ups
- Anything marked `// VERIFY:` in code.
- Anything flaky (rate-limit retries, Ollama cold-start edge cases).
- Anything you'd refactor for Phase 2.

### Deviations from spec
- If you deviated, name the section and reason.
- Flag stale spec sections that should be updated.

### Token / API usage during build
- Rough USD spent in testing.
- Confirm all API keys you touched are in the keychain now, not in any file.

### What's ready for Phase 2
- Which abstractions survived Phase 1 cleanly.
- What needs refactoring before Phase 2 adds orchestrator / voting / retention.

---

## 8. Questions to Ask Tom if Blocked

Before guessing on ambiguous choices:

1. **Initial source URLs** — which RSS feeds / Perplexity queries / Arxiv categories should ship in the first `newsletter-ai` manifest? (Tom cares about specific topics; don't invent.)
2. **Mail recipient** — SMTP `From` is Tom's sender address; the `To` in the digest should go to which address? Same as `From`, or a separate inbox?
3. **Telegram chat-id** — private chat vs. group vs. channel? Affects the Bot setup steps in the README.
4. **Ollama model choice** — `llama3` is the default. If Tom has a preferred local model (`mistral`, `llama3.2`, `qwen2.5`), extend the `ollama-*` entries in `ModelId`.
5. **Newspaper retention window** — spec defers retention to Phase 2, but the UI needs *some* default. Default: last 7 days. Override?
6. **Auto-spawn in dev: OK to run `pnpm --filter samix-core dev` from Rust?** — requires `pnpm` on PATH at Tauri launch. Alternatively, build the core to `core/dist/` first and spawn `node dist/server.js`.

---

*End of handoff. Phase 2 handoff will be a separate document once Phase 1 is merged and reviewed.*
