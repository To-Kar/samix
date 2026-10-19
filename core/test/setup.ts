import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations } from '../src/db/migrate.js';

// Runs per test file, before the file's imports: every file gets a private,
// fully migrated database, and nothing touches core/data.
process.env.SAMIX_LOG_LEVEL = 'silent';
const dir = mkdtempSync(join(tmpdir(), 'samix-test-'));
process.env.DATABASE_URL = `file:${join(dir, 'test.db').replace(/\\/g, '/')}`;
applyMigrations();
