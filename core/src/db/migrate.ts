import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import type { Logger } from 'pino';
import { PRISMA_DIR, ensureDatabaseUrl, sqlitePathFromUrl } from './paths.js';

// Applies the Prisma migrations in prisma/migrations at core start, so a
// fresh install (or a packaged app with no Prisma CLI) needs no manual step.
//
// It reads and writes Prisma's own `_prisma_migrations` table, in Prisma's
// format, so `prisma migrate deploy|status|dev` keep working against the
// same database. Migrations are executed as-is, without an outer
// transaction: generated SQLite migrations toggle `PRAGMA foreign_keys`,
// which is a no-op inside one.

const MIGRATIONS_TABLE_DDL = `CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id"                    TEXT PRIMARY KEY NOT NULL,
    "checksum"              TEXT NOT NULL,
    "finished_at"           DATETIME,
    "migration_name"        TEXT NOT NULL,
    "logs"                  TEXT,
    "rolled_back_at"        DATETIME,
    "started_at"            DATETIME NOT NULL DEFAULT current_timestamp,
    "applied_steps_count"   INTEGER UNSIGNED NOT NULL DEFAULT 0
)`;

export interface MigrateOptions {
  databaseUrl?: string;
  migrationsDir?: string;
  logger?: Logger;
}

export function applyMigrations(opts: MigrateOptions = {}): string[] {
  const dbPath = sqlitePathFromUrl(opts.databaseUrl ?? ensureDatabaseUrl());
  const migrationsDir =
    opts.migrationsDir ?? process.env.SAMIX_MIGRATIONS_DIR ?? join(PRISMA_DIR, 'migrations');
  if (!existsSync(migrationsDir)) {
    throw new Error(`Migrations directory not found: ${migrationsDir}`);
  }

  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  const applied: string[] = [];
  try {
    db.exec(MIGRATIONS_TABLE_DDL);
    const done = new Map<string, string>(
      (
        db
          .prepare(
            'SELECT migration_name, checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL'
          )
          .all() as { migration_name: string; checksum: string }[]
      ).map((r) => [r.migration_name, r.checksum])
    );

    const names = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();

    for (const name of names) {
      const sqlPath = join(migrationsDir, name, 'migration.sql');
      if (!existsSync(sqlPath)) continue;
      const sql = readFileSync(sqlPath, 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');

      const prior = done.get(name);
      if (prior !== undefined) {
        if (prior !== checksum) {
          throw new Error(`Migration "${name}" was modified after it was applied`);
        }
        continue;
      }

      const startedAt = Date.now();
      db.exec(sql);
      db.prepare(
        `INSERT INTO _prisma_migrations
           (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
         VALUES (?, ?, ?, ?, ?, 1)`
      ).run(randomUUID(), checksum, Date.now(), name, startedAt);
      applied.push(name);
      opts.logger?.info({ migration: name }, 'migration_applied');
    }
  } finally {
    db.close();
  }
  return applied;
}
