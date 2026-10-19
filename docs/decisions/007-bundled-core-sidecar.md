# ADR 007 — The core ships as a bundled Node.js sidecar

**Status:** Accepted (Linux verified; macOS and Windows not yet)
**Date:** 2026-10-19
**Context doc:** `docs/SAMIX_ROADMAP.md` Phase 2b; amends ADR 002 (the core is still a separate process)

## Problem

In dev the Tauri shell starts the core with `pnpm --filter samix-core dev` (tsx watch). An installed app has no Node, pnpm or repository. On macOS a GUI app also doesn't inherit the shell's `PATH`, so even an installed `pnpm` would not be found. [Inference — not tested on a Mac.]

## Decision

Ship **an official Node.js binary plus a bundled core**, and let the shell run `node server.mjs`.

- **Node** is the official build from nodejs.org (version pinned in `/.node-version`, checksum-verified by `app/scripts/fetch-node.mjs`) and is a Tauri *sidecar* (`externalBin`), so it ends up next to the executable.
- **The core** is built by `core/scripts/build-bundle.mjs`: esbuild bundles all code and dependencies into one `server.mjs` (3.9 MB); only `@prisma/client` stays external, installed fresh into the bundle and `prisma generate`d so it carries the query engine **of the build platform**. WASM engines for other databases are removed. Result: ~41 MB (Linux), plus the migrations and the default agents.
- Both are added only by `src-tauri/tauri.release.conf.json`, so `tauri dev` and `cargo check` don't need them.
- The shell passes everything the bundled core needs through the environment: `DATABASE_URL`, `SAMIX_AGENTS_DIR`, `SAMIX_BUNDLED_AGENTS_DIR`, `SAMIX_MIGRATIONS_DIR`, `SAMIX_LOG_FILE`. User data lives in the OS app-data folder; the editable agents are a copy (`skills/seed.ts`), never overwritten.
- The bundle has to be built **on each target platform** (macOS arm64, Windows x64): the engine is a native library.

## Alternatives considered

- **Node single-executable application (SEA):** still needs the native engine as a separate file, and adds a build step with its own limits; saves little.
- **Shipping `node_modules` unbundled:** thousands of small files (slow installers, Windows path-length risk) for no gain.
- **Another runtime (Bun, Deno):** a second runtime that dev doesn't use.
- **Rewriting the core in Rust:** rejected in ADR 002.

## Consequences

- The installer carries a ~120 MB Node binary (compresses to roughly a third). [Inference for the compressed size.]
- Updating Node means changing `/.node-version`.
- Prisma's engine is the only native module left (see ADR 008). On Apple Silicon native code must be at least ad-hoc signed, so the bundle script signs the engine on macOS. [Unverified on a Mac.]
- Not solved here: signing and notarising for distribution (Phase 5), and updating the shipped agents' prompts on existing installs.

## Verification

`core/scripts/verify-bundle.sh <bundle> <node>` copies the bundle away from the repository, starts it with a scrubbed environment and checks health, database creation, agent seeding, auth, the Prisma engine, an agent run and the log file. Done with the official Linux Node binary. CI is meant to run the same on macOS and Windows runners (Windows: a PowerShell equivalent is still to be written).
