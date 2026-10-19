import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { applyMigrations } from '../src/db/migrate.js';
import { sqlitePathFromUrl } from '../src/db/paths.js';

const fresh = () => {
  const dir = mkdtempSync(join(tmpdir(), 'samix-mig-'));
  return { dir, url: `file:${join(dir, 'nested', 'm.db').replace(/\\/g, '/')}` };
};

describe('applyMigrations', () => {
  it('creates the database (and its directory) and applies every migration once', () => {
    const { url } = fresh();
    const first = applyMigrations({ databaseUrl: url });
    expect(first.length).toBeGreaterThan(0);

    const db = new DatabaseSync(sqlitePathFromUrl(url), { readOnly: true });
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((t) => t.name);
    db.close();
    expect(tables).toEqual(expect.arrayContaining(['Agent', 'AgentRun', 'Article', 'BudgetLedger', 'SourceSnapshot', '_prisma_migrations']));

    expect(applyMigrations({ databaseUrl: url })).toEqual([]);
  });

  it('refuses a migration that changed after it was applied', () => {
    const { dir, url } = fresh();
    const migrations = join(dir, 'migrations');
    mkdirSync(join(migrations, '001_a'), { recursive: true });
    writeFileSync(join(migrations, '001_a', 'migration.sql'), 'CREATE TABLE a (id INTEGER);');
    applyMigrations({ databaseUrl: url, migrationsDir: migrations });

    writeFileSync(join(migrations, '001_a', 'migration.sql'), 'CREATE TABLE a (id INTEGER, extra TEXT);');
    expect(() => applyMigrations({ databaseUrl: url, migrationsDir: migrations })).toThrow(/modified after/);
  });
});

describe('sqlitePathFromUrl', () => {
  it('rejects non-SQLite URLs', () => {
    expect(() => sqlitePathFromUrl('postgres://x')).toThrow(/SQLite/);
  });
  it('keeps absolute paths and strips query strings', () => {
    expect(sqlitePathFromUrl('file:/tmp/a.db?connection_limit=1')).toBe('/tmp/a.db');
  });
});
