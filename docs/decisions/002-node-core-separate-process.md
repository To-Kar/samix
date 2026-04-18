# ADR 002 — Node core as a separate process (Alternative D)

**Status:** Accepted
**Date:** 2026-04-18
**Context doc:** `docs/SAMIX_PHASE_0_SPEC.md` §3, §4, §6

## Decision

Run the Samix Core as a standalone Node.js process that the Tauri shell spawns and communicates with over HTTP on loopback (`127.0.0.1`), authenticated via a per-session shared-secret token. This is "Alternative D" from the exploration phase — rejecting the alternatives of (A) embedding Node in Rust, (B) rewriting core in Rust, (C) using IPC-only without HTTP.

## Rationale

- **Mobile-ready by design** — the same HTTP API can later serve a Flutter client on LAN or a Mini-VPS deployment without core refactor.
- **Decoupling** — core can be developed and tested standalone (`pnpm dev:core` + curl), independent of the UI.
- **Language fit** — agent orchestration, LLM SDKs, and tooling ecosystems are strongest in TypeScript/Node.
- **Debuggability** — clear process boundary simplifies crash isolation and logging.

## Consequences

- Startup coordination: Rust picks port + token, passes via env, waits for `/health` to go green.
- Authentication lives in middleware; non-`/health` routes require `Authorization: Bearer <token>`.
- Loopback-only bind is mandatory; widening to LAN is a future config-only change.
