# ADR 003 — SQLite (via Prisma + better-sqlite3) instead of Postgres

**Status:** Accepted
**Date:** 2026-04-18
**Context doc:** `docs/SAMIX_PHASE_0_SPEC.md` §3, §9

## Decision

Persist agent configuration, runs, articles, and budget ledger in a local SQLite database, accessed through Prisma with the `better-sqlite3` driver.

## Rationale

- **Local-first** — user data stays on the user's device; no network DB call in the core path.
- **Single-user** — no concurrency model that requires a server-grade RDBMS.
- **Zero admin** — no daemon to start, no port to manage, no backups beyond copying a file.
- **Prisma** — gives us migrations, typed query builder, and a model definition that doubles as documentation.
- **better-sqlite3** — synchronous, process-local, very fast for the kind of workload a single-user agent system produces.

## Consequences

- DB file path is environment-driven (`DATABASE_URL=file:./data/samix-dev.db` in dev, `file:%APPDATA%/samix/samix.db` in release).
- Concurrency: no parallel writers across processes. Fine for single-process core.
- If we ever need multi-device sync, that is a new ADR — not a change to this schema.
- WAL mode should be enabled for durability; backup = copy the file while app is closed.
