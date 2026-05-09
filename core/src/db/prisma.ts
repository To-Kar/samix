import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

function resolveDbPath(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const platform = process.platform;
  if (platform === 'darwin') {
    const dir = join(homedir(), 'Library', 'Application Support', 'samix');
    mkdirSync(dir, { recursive: true });
    return `file:${join(dir, 'samix.db')}`;
  }
  if (platform === 'win32') {
    const dir = join(process.env.APPDATA ?? homedir(), 'samix');
    mkdirSync(dir, { recursive: true });
    return `file:${join(dir, 'samix.db')}`;
  }
  return 'file:./data/samix-dev.db';
}

export const prisma = new PrismaClient({
  datasourceUrl: resolveDbPath(),
});
