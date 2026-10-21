import { cp, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import matter from 'gray-matter';
import type { Logger } from 'pino';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { cleanFocus, focusFromRenderedBody, renderTemplateBody } from './create.js';

// Keeps the agents in the user's folder current with the ones shipped in the
// app. seedAgents (skills/seed.ts) copies an agent once and never touches it
// again, because users edit manifests (sources, schedule, model, limits). That
// left prompts and schemas stuck at the version of the first install. This
// brings them forward when the shipped agent's `version` is newer:
//
//   replaced   the prompt (SKILL.md body) and the schema file, and the manifest
//              keys that define what an agent can do (MANAGED_KEYS)
//   kept       everything the user can edit: title, sources, schedule, model,
//              limits, personalize, topic
//   added      keys the shipped manifest has and the user's lacks
//
// The old files are copied to `.backup-v<version>/` inside the agent folder.
// A Ressort created from a template gets the template's new prompt with its
// own topic put back in.

// What an agent *is allowed and built to do* — not editable in the app.
const MANAGED_KEYS = ['tools', 'routes', 'delegates', 'empty_answer', 'output'];

export interface SyncResult {
  agent: string;
  from: string;
  to: string;
  template: string;
}

// "1.10" > "1.9": compared as numbers, segment by segment.
export function compareVersions(a: string, b: string): number {
  const pa = String(a).split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

const exists = (p: string) => stat(p).then(() => true, () => false);
const readText = (p: string) => readFile(p, 'utf8').catch(() => null);

async function writeAtomic(path: string, content: string): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, content, 'utf8');
  await rename(tmp, path);
}

type Manifest = Record<string, unknown>;

function schemaFileOf(manifest: Manifest): string | undefined {
  const rel = (manifest['output'] as { schema?: unknown } | undefined)?.schema;
  return typeof rel === 'string' ? rel.replace(/^\.\//, '') : undefined;
}

export async function syncShippedAgents(bundledDir: string, userDir: string, log?: Logger): Promise<SyncResult[]> {
  const results: SyncResult[] = [];
  const entries = await readdir(userDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
    try {
      const r = await syncOne(bundledDir, join(userDir, entry.name), entry.name, log);
      if (r) results.push(r);
    } catch (err) {
      // One broken agent must not stop the others, or the app from starting.
      log?.warn({ agent: entry.name, err: err instanceof Error ? err.message : String(err) }, 'agent_sync_failed');
    }
  }
  return results;
}

async function syncOne(bundledDir: string, dir: string, name: string, log?: Logger): Promise<SyncResult | null> {
  const [skillRaw, manifestRaw] = await Promise.all([readText(join(dir, 'SKILL.md')), readText(join(dir, 'manifest.yaml'))]);
  if (!skillRaw || !manifestRaw) return null;
  const user = parseYaml(manifestRaw) as Manifest;
  const parsedSkill = matter(skillRaw);

  // Which shipped agent is this one a copy of, and is it a plain copy or made from a template?
  let templateId: string | null = null;
  let created = false;
  if (await exists(join(bundledDir, name, 'manifest.yaml'))) {
    templateId = name;
  } else if (typeof user['template'] === 'string' && (await exists(join(bundledDir, user['template'], 'manifest.yaml')))) {
    templateId = user['template'];
    created = true;
  } else if (
    (user['output'] as { format?: unknown } | undefined)?.format === 'newsletter_items' &&
    focusFromRenderedBody(parsedSkill.content) &&
    (await exists(join(bundledDir, 'newsletter-ai', 'manifest.yaml')))
  ) {
    // Created before agents recorded their template.
    templateId = 'newsletter-ai';
    created = true;
  }
  if (!templateId) return null;

  const bundledAgentDir = join(bundledDir, templateId);
  const shipped = parseYaml((await readFile(join(bundledAgentDir, 'manifest.yaml'), 'utf8'))) as Manifest;
  const from = String(user['version'] ?? '0');
  const to = String(shipped['version'] ?? '0');
  if (compareVersions(to, from) <= 0) return null;

  // The new prompt.
  const shippedSkill = matter((await readText(join(bundledAgentDir, 'SKILL.md'))) ?? '');
  let body = shippedSkill.content;
  let topic = typeof user['topic'] === 'string' ? user['topic'] : undefined;
  if (created) {
    topic ??= focusFromRenderedBody(parsedSkill.content);
    const focus = topic ? cleanFocus(topic) : '';
    if (!focus) {
      log?.warn({ agent: name }, 'agent_sync_skipped_no_topic');
      return null;
    }
    body = renderTemplateBody(body, focus);
  }

  // Back up what is about to be replaced.
  const backup = join(dir, `.backup-v${from}`);
  if (!(await exists(backup))) {
    await mkdir(backup, { recursive: true });
    await cp(join(dir, 'SKILL.md'), join(backup, 'SKILL.md'));
    await cp(join(dir, 'manifest.yaml'), join(backup, 'manifest.yaml'));
    const oldSchema = schemaFileOf(user);
    if (oldSchema && (await exists(join(dir, oldSchema)))) await cp(join(dir, oldSchema), join(backup, oldSchema));
  }

  // The schema file the new prompt expects.
  const newSchema = schemaFileOf(shipped);
  if (newSchema && (await exists(join(bundledAgentDir, newSchema)))) {
    await cp(join(bundledAgentDir, newSchema), join(dir, `${newSchema}.tmp`));
    await rename(join(dir, `${newSchema}.tmp`), join(dir, newSchema));
  }

  // The manifest: managed keys from the shipped one, missing keys added, the rest the user's.
  const merged: Manifest = { ...user };
  for (const key of MANAGED_KEYS) {
    if (key in shipped) merged[key] = shipped[key];
    else delete merged[key];
  }
  for (const [key, value] of Object.entries(shipped)) {
    if (!(key in merged) && !['id', 'topic', 'template'].includes(key)) merged[key] = value;
  }
  // The per-question cap is a safety limit the reader cannot edit, so it comes from the shipped
  // manifest even though `budget` as a whole is the reader's.
  const shippedCap = (shipped['budget'] as { question_usd_max?: unknown } | undefined)?.question_usd_max;
  if (typeof shippedCap === 'number' && merged['budget'] && typeof merged['budget'] === 'object') {
    const budget = merged['budget'] as Record<string, unknown>;
    if (!('question_usd_max' in budget)) merged['budget'] = { ...budget, question_usd_max: shippedCap };
  }
  merged['version'] = to;
  if (created) {
    merged['template'] = templateId;
    if (topic) merged['topic'] = topic;
  }

  // Frontmatter (name, title, description) stays the user's.
  await writeAtomic(join(dir, 'SKILL.md'), matter.stringify(body, parsedSkill.data));
  await writeAtomic(join(dir, 'manifest.yaml'), stringifyYaml(merged));
  log?.info({ agent: name, from, to, template: templateId }, 'agent_updated_from_shipped');
  return { agent: name, from, to, template: templateId };
}
