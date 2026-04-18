# Samix — Phase 0 Handoff Report

**Date:** 2026-04-18
**Companion to:** `SAMIX_PHASE_0_SPEC.md`, `SAMIX_PHASE_0_CLAUDE_CODE_HANDOFF.md`

---

## Acceptance criteria — all pass

1. `pnpm dev:core` → logs `ready` with `skills: 1`.
2. `pnpm dev:app` → Samix window opens, UI lists `hello-world`.
3. Click **Run** → response shows SKILL.md body, `status: success`, cost `0.0000`.
4. `AgentRun` row persisted with `status='success'`, `tokensInput/Output = 0`.
5. Killing the core flips the banner to red "Samix Core disconnected" within ~10 s.

## How to run it

Two terminals, both with the same tokens:

```bash
SAMIX_TOKEN=testtok SAMIX_PORT=4000 pnpm dev:core
SAMIX_TOKEN=testtok SAMIX_PORT=4000 pnpm dev:app
```

## Inference-flagged decisions taken

- **Prisma + better-sqlite3**: used the default Prisma SQLite driver, not the newer `@prisma/adapter-better-sqlite3`. Default works out of the box with `prisma migrate dev` and the generated client. Revisit if we need the driver-adapter features.
- **DB path**: Prisma resolves `file:...` URLs relative to the `schema.prisma` directory. Spec says `core/data/samix-dev.db`; that required `DATABASE_URL="file:../data/samix-dev.db"` in `core/.env`. Documented inline in the env file.
- **Tauri dev-spawn vs. manual**: manual `pnpm dev:core` per the handoff recommendation. Rust shell just exposes `get_core_config()` that forwards `SAMIX_PORT` + `SAMIX_TOKEN` from its own environment.
- **CORS/helmet for loopback WebView**: added `@fastify/cors` + set `crossOriginResourcePolicy: 'cross-origin'` on helmet. Without these, the WebView at `http://localhost:1420` cannot fetch the loopback core. Token auth + loopback bind remain the real access controls.
- **Auth middleware**: explicitly bypasses `OPTIONS` preflights so the cors plugin can short-circuit them with 204. Using `request.method`/`request.url` rather than `request.routeOptions.url` (which is undefined for preflights with no registered handler).
- **Package versions**: Prisma 6.x, Fastify 5.x. Fastify 5 changed the logger option from `logger: <pino instance>` to `loggerInstance`. Noted in `server.ts`.

## Out-of-scope compliance

No real LLM calls happened. `hello-world` uses the `StaticAdapter` which returns the system prompt verbatim. `ClaudeAdapter` is implemented but not wired into the runner — it will be activated by a skill manifest change in Phase 1.

## Known follow-ups (not blockers)

- **Phase 0.5 polish**: Rust shell could auto-spawn the core in dev mode, removing the two-terminal step. Currently requires env-var synchronization by hand.
- **Prisma warning**: CLI emitted a "major version upgrade" notice pointing to the next Prisma release. Safe to ignore; upgrade can happen before Phase 1.
- **Pricing numbers in `ClaudeAdapter`**: verified against the current Anthropic pricing page (April 2026). `claude-haiku-4-5` at $1/$5 per million tokens (input/output) is correct. `claude-sonnet-4-5` is outdated — the current generation is Sonnet 4.6 ($3/$15); `types.ts` and `claude.ts` should rename the id before the adapter is activated in Phase 1.
- **Scheduler**: wired and logs `scheduler_ready` but is a no-op. `node-cron` is installed but unused until Phase 1 introduces proactive skills.
- **Dev DB location**: `core/data/samix-dev.db` (gitignored). Production path `%APPDATA%/samix/samix.db` is Windows-only and remains a Phase 1+ concern.

## Deviations from spec

- **Dev platform**: spec says Windows-first; Phase 0 was developed on macOS (darwin arm64). No Windows-specific code was introduced; paths are relative, no OS-specific APIs used. Installer/signing are Phase 5+ per the spec's own out-of-scope list.
- **`tauri.conf.json` CSP**: spec says "default-src for the app, connect-src to include `http://127.0.0.1:*`". Implemented as an explicit policy string that also allows `ipc:` + `http://ipc.localhost` + `asset:` (Tauri's own schemes) so the WebView works in both dev and prod.

## What's ready for Phase 1

- `ModelAdapter` interface is clean; `ClaudeAdapter` exists and matches it.
- Skill loader + runner + budget ledger + transparent DB persistence all work end-to-end.
- HTTP API + token auth + CORS + graceful shutdown are in place.
- UI + Rust shell + env-passthrough plumbing ready for the first proactive skill.

Phase 1 can start by: (a) adding an `agents/newsletter-ai/` with a real manifest pointing to `claude-haiku-4-5`, (b) implementing one tool-use pathway (RSS or Perplexity search), and (c) enabling the scheduler to actually trigger proactive runs.
