import { existsSync, readdirSync } from 'node:fs';
import { mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';

// Removing an agent moves its folder to `.removed/<slug>--<timestamp>` in the
// agents folder (the loader ignores dot folders). Nothing is deleted: the files
// can be moved back by hand, and the runs/articles stay in the database. The
// folder name keeps a shipped default from being seeded again and its slug
// from being reused (the history is filed under it).

const REMOVED_DIR = '.removed';

export function isRemoved(agentsDir: string, slug: string): boolean {
  const dir = join(agentsDir, REMOVED_DIR);
  if (!existsSync(dir)) return false;
  return readdirSync(dir).some((n) => n === slug || n.startsWith(`${slug}--`));
}

export async function removeAgentFolder(agentsDir: string, slug: string): Promise<string> {
  const target = join(agentsDir, REMOVED_DIR, `${slug}--${new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)}`);
  await mkdir(join(agentsDir, REMOVED_DIR), { recursive: true });
  await rename(join(agentsDir, slug), target);
  return target;
}
