# ADR 008 — `node:sqlite` instead of `better-sqlite3` for migrations

**Status:** Accepted
**Date:** 2026-10-19
**Context doc:** ADR 003 (SQLite stays), ADR 007

## Decision

The core applies Prisma migrations at start (`db/migrate.ts`) using Node's built-in `node:sqlite`, and `better-sqlite3` is removed.

## Rationale

`better-sqlite3` was used for nothing else, and every native module has to be built, shipped and (on Apple Silicon) signed per platform. With `node:sqlite` the Prisma query engine is the only native module in the packaged core.

## Consequences

- Requires Node >= 22.13 (`engines`, `/.node-version`). The dev README must say so. [The exact version where the flag was dropped is from memory, not checked; 22.22 is what was tested.]
- `node:sqlite` is marked experimental in Node 22 and prints a warning; the shell starts Node with `--disable-warning=ExperimentalWarning`. The API surface used (`exec`, `prepare().all/run`) is small, and the bundled Node version is pinned.
- The migrator reads and writes Prisma's own `_prisma_migrations` table in Prisma's format; `prisma migrate status` and `migrate diff` agree with it (checked).
