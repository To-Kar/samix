import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// core/src/db (or core/dist/db) → core/
export const CORE_DIR = resolve(here, '../..');
export const PRISMA_DIR = resolve(CORE_DIR, 'prisma');
export const DEFAULT_DB_PATH = resolve(CORE_DIR, 'data', 'samix-dev.db');

// Prisma's SQLite connector wants forward slashes, also for Windows paths.
function toFileUrl(path: string): string {
  return `file:${path.replace(/\\/g, '/')}`;
}

// Fresh clones have no .env, so the default is set in code. An explicit
// DATABASE_URL (the Tauri shell in production, a test) always wins.
// Must run before the PrismaClient is constructed.
export function ensureDatabaseUrl(): string {
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = toFileUrl(DEFAULT_DB_PATH);
  }
  return process.env.DATABASE_URL;
}

// Filesystem path of a `file:` DATABASE_URL. Relative paths resolve against
// the prisma/ directory, which is what the Prisma CLI and client do.
export function sqlitePathFromUrl(url: string): string {
  if (!url.startsWith('file:')) {
    throw new Error(`Only SQLite "file:" DATABASE_URLs are supported, got "${url}"`);
  }
  const path = decodeURIComponent(url.slice('file:'.length).split('?')[0] ?? '');
  return isAbsolute(path) || /^[A-Za-z]:[\\/]/.test(path) ? path : resolve(PRISMA_DIR, path);
}
