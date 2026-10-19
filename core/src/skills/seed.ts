import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { isRemoved } from './remove.js';
import { join } from 'node:path';
import type { Logger } from 'pino';

// In an installed app the agents shipped inside the bundle are read-only
// (and replaced on every update), but users edit manifests (sources, model)
// and add their own agents. So the bundle holds the defaults and the user
// folder is the working copy: any default agent missing there is copied over.
// An agent that already exists is never touched, so edits survive updates.
// (Consequence: improvements to a shipped agent's prompt don't reach existing
// installs yet — that needs a versioned update path, see the roadmap.)

export function seedAgents(bundledDir: string, userDir: string, log?: Logger): string[] {
  mkdirSync(userDir, { recursive: true });
  const copied: string[] = [];
  for (const entry of readdirSync(bundledDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
    const target = join(userDir, entry.name);
    if (existsSync(target)) continue;
    // The reader removed it on purpose; a shipped default must not come back.
    if (isRemoved(userDir, entry.name)) continue;
    cpSync(join(bundledDir, entry.name), target, { recursive: true });
    copied.push(entry.name);
    log?.info({ agent: entry.name }, 'agent_seeded');
  }
  return copied;
}
