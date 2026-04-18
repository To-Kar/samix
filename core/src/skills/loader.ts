import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import matter from 'gray-matter';
import type { Manifest, Skill } from '../types.js';
import { logger } from '../logger.js';
import { prisma } from '../db/prisma.js';
import {
  manifestYamlSchema,
  skillFrontmatterSchema,
  type ManifestYaml,
} from './schema.js';

export interface LoadOptions {
  agentsDir: string;
}

export async function loadSkills(opts: LoadOptions): Promise<Skill[]> {
  const agentsDir = resolve(opts.agentsDir);
  const log = logger.child({ component: 'skill-loader', agentsDir });

  let entries: string[];
  try {
    entries = await readdir(agentsDir);
  } catch (err) {
    log.error({ err }, 'agents directory not readable');
    return [];
  }

  const skills: Skill[] = [];

  for (const entry of entries) {
    if (entry.startsWith('_') || entry.startsWith('.')) continue;
    const dir = join(agentsDir, entry);
    const s = await stat(dir).catch(() => null);
    if (!s || !s.isDirectory()) continue;

    try {
      const skill = await loadOneSkill(dir);
      skills.push(skill);
      await upsertAgent(skill);
      log.info({ skill: skill.id }, 'skill loaded');
    } catch (err) {
      log.error({ err, dir: entry }, 'skill load failed; skipping');
    }
  }

  return skills;
}

async function loadOneSkill(dir: string): Promise<Skill> {
  const manifestPath = join(dir, 'manifest.yaml');
  const skillMdPath = join(dir, 'SKILL.md');

  const [manifestRaw, skillMdRaw] = await Promise.all([
    readFile(manifestPath, 'utf8'),
    readFile(skillMdPath, 'utf8'),
  ]);

  const parsed = manifestYamlSchema.parse(parseYaml(manifestRaw));
  const fm = matter(skillMdRaw);
  skillFrontmatterSchema.parse(fm.data);

  const manifest = normalizeManifest(parsed);

  return {
    id: manifest.id,
    type: manifest.type,
    version: manifest.version,
    skillMdPath,
    manifest,
    systemPrompt: fm.content.trim(),
  };
}

function normalizeManifest(m: ManifestYaml): Manifest {
  return {
    id: m.id,
    type: m.type,
    version: m.version,
    model: m.model,
    budget: {
      dailyUsdMax: m.budget.daily_usd_max,
      tokensPerRunMax: m.budget.tokens_per_run_max,
      haltOnBudgetExceeded: m.budget.halt_on_budget_exceeded,
    },
    schedule: m.schedule
      ? {
          cron: m.schedule.cron,
          timezone: m.schedule.timezone,
          jitterSeconds: m.schedule.jitter_seconds,
          catchupOnStartup: m.schedule.catchup_on_startup,
        }
      : undefined,
    sources: m.sources?.map((s) => ({ type: s.type, config: s.config })),
    output: {
      format: m.output.format,
      schemaPath: m.output.schema,
      minItems: m.output.min_items,
      maxItems: m.output.max_items,
    },
  };
}

async function upsertAgent(skill: Skill): Promise<void> {
  await prisma.agent.upsert({
    where: { slug: skill.id },
    create: {
      slug: skill.id,
      type: skill.type,
      skillPath: skill.skillMdPath,
      config: JSON.stringify(skill.manifest),
      enabled: true,
    },
    update: {
      type: skill.type,
      skillPath: skill.skillMdPath,
      config: JSON.stringify(skill.manifest),
    },
  });
}
