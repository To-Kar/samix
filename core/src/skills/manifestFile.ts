import { readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { Skill } from '../types.js';

// Edits an agent's manifest.yaml in place. The file is rewritten through a
// temp file in the same directory and renamed over the original, so a crash
// mid-write can't leave a half-written manifest.
export async function updateManifest(
  skill: Skill,
  mutate: (manifest: Record<string, unknown>) => void
): Promise<void> {
  const dir = dirname(skill.skillMdPath);
  const path = join(dir, 'manifest.yaml');
  const tmp = join(dir, 'manifest.yaml.tmp');

  const manifest = parseYaml(await readFile(path, 'utf8')) as Record<string, unknown>;
  mutate(manifest);

  await writeFile(tmp, stringifyYaml(manifest), 'utf8');
  await rename(tmp, path);
}
