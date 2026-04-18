# ADR 001 — Tauri v2 for the desktop shell

**Status:** Accepted
**Date:** 2026-04-18
**Context doc:** `docs/SAMIX_PHASE_0_SPEC.md` §3

## Decision

Use Tauri v2 (Rust shell + WebView) as the desktop app framework instead of Electron.

## Rationale

- Smaller installed footprint and memory profile than Electron (native WebView vs. bundled Chromium).
- Rust shell is a natural fit for spawning and supervising the Node core child process.
- Tauri v2 has first-class Windows support (Phase 0 target platform).
- Keeps the value "local-first" credible: no hidden network stack, no telemetry by default.

## Consequences

- Requires a Rust toolchain on the dev machine.
- WebView differences across OSes will matter in later phases (macOS WebKit, Windows WebView2).
- The Rust shell is intentionally thin: window, child-process supervision, token handoff. No business logic.
