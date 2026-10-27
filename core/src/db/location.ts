import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

// Single source of truth for where the SQLite file lives. Used by both the
// runtime Prisma client (db/prisma.ts) and the Prisma CLI wrapper
// (scripts/prisma.ts), so `migrate deploy` and the running core can never
// disagree about the path.
//
// Precedence:
//   1. DATABASE_URL from the process env
//   2. DATABASE_URL from core/.env (legacy dev setups keep working unchanged)
//   3. SAMIX_DATA_DIR/<file>
//   4. NODE_ENV=production → per-user app-data dir (see appDataDir)
//   5. dev default → core/data/samix-dev.db

const coreRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function appDataDir(): string {
  if (process.platform === 'win32') {
    return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'samix');
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'samix');
  }
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'samix');
}

function urlFromDotEnv(): string | undefined {
  const envFile = join(coreRoot, '.env');
  if (!existsSync(envFile)) return undefined;
  return parseEnv(readFileSync(envFile, 'utf8')).DATABASE_URL;
}

function defaultDbFile(): string {
  if (process.env.SAMIX_DATA_DIR) return join(process.env.SAMIX_DATA_DIR, 'samix.db');
  if (process.env.NODE_ENV === 'production') return join(appDataDir(), 'samix.db');
  return join(coreRoot, 'data', 'samix-dev.db');
}

/**
 * Ensures `process.env.DATABASE_URL` is set before Prisma reads it.
 * An explicit URL (env or core/.env) is left untouched — including Prisma's
 * own rule that relative `file:` paths resolve against `prisma/`. Only the
 * computed default is absolute, so it means the same thing on every OS.
 */
export function ensureDatabaseUrl(): string {
  const explicit = process.env.DATABASE_URL ?? urlFromDotEnv();
  if (explicit) {
    process.env.DATABASE_URL = explicit;
    return explicit;
  }
  const file = defaultDbFile();
  mkdirSync(dirname(file), { recursive: true });
  // Forward slashes keep the URL valid on Windows (file:C:/Users/...).
  const url = `file:${file.replace(/\\/g, '/')}`;
  process.env.DATABASE_URL = url;
  return url;
}
