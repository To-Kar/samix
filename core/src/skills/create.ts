import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import matter from 'gray-matter';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { ScheduleSpec, SourceSpec, ModelId } from '../types.js';

// Creating an agent is writing two files (+ the schema) from a template:
// skills are data, no code per agent. A template is any shipped agent whose
// SKILL.md marks the sentence that says what it is about:
//
//   <!-- focus -->relevant to artificial intelligence<!-- /focus -->
//
// The new agent gets the template's prompt with only that sentence replaced.

const FOCUS_RE = /<!-- focus -->[\s\S]*?<!-- \/focus -->/;

export function isTemplate(skillMd: string): boolean {
  return FOCUS_RE.test(skillMd);
}

export interface NewAgentInput {
  title: string;
  focus: string;
  sources: SourceSpec[];
  schedule?: Pick<ScheduleSpec, 'cron' | 'timezone'>;
  model?: { primary: ModelId; fallback?: ModelId };
}

export function slugify(title: string): string {
  const base = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return base || 'agent';
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false);
}

export async function uniqueSlug(agentsDir: string, base: string): Promise<string> {
  let slug = base;
  for (let n = 2; await exists(join(agentsDir, slug)); n++) slug = `${base}-${n}`;
  return slug;
}

// The focus goes into a system prompt. It is the user's own text, but a
// stray marker or control character would corrupt the template.
function cleanFocus(focus: string): string {
  return focus
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/["“”„]/g, "'") // the focus is quoted in the prompt
    .replace(/\s+/g, ' ')
    .trim();
}

export async function listTemplates(
  templateRoot: string
): Promise<{ id: string; title: string; description: string }[]> {
  const out: { id: string; title: string; description: string }[] = [];
  for (const entry of await readdir(templateRoot, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory() || entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
    const md = await readFile(join(templateRoot, entry.name, 'SKILL.md'), 'utf8').catch(() => null);
    if (md && isTemplate(md)) {
      const fm = matter(md).data as { name?: string; title?: string; description?: string };
      out.push({ id: entry.name, title: fm.title ?? fm.name ?? entry.name, description: fm.description ?? '' });
    }
  }
  return out;
}

export async function createAgent(opts: {
  input: NewAgentInput;
  agentsDir: string;
  templateDir: string;
}): Promise<{ slug: string; dir: string }> {
  const { input, agentsDir, templateDir } = opts;
  const focus = cleanFocus(input.focus);
  if (!focus) throw new Error('focus is empty');

  const [skillRaw, manifestRaw] = await Promise.all([
    readFile(join(templateDir, 'SKILL.md'), 'utf8'),
    readFile(join(templateDir, 'manifest.yaml'), 'utf8'),
  ]);
  if (!isTemplate(skillRaw)) throw new Error('template has no <!-- focus --> marker');

  const slug = await uniqueSlug(agentsDir, slugify(input.title));
  const parsed = matter(skillRaw);
  const skillMd = matter.stringify(parsed.content.replace(FOCUS_RE, () => `matching this focus: "${focus}"`), {
    name: slug,
    title: input.title.trim(),
    description: `Digest of: ${focus}`.slice(0, 160),
  });

  const manifest = parseYaml(manifestRaw) as Record<string, unknown>;
  manifest['id'] = slug;
  manifest['version'] = '1.0';
  manifest['sources'] = input.sources;
  manifest['topic'] = focus;
  if (input.schedule) {
    manifest['schedule'] = { ...(manifest['schedule'] as object | undefined), ...input.schedule };
  }
  if (input.model) {
    manifest['model'] = { ...(manifest['model'] as object | undefined), ...input.model };
  }

  // Assemble next to the target and rename into place, so a crash can't leave
  // a half-written agent that the loader then trips over.
  await mkdir(agentsDir, { recursive: true });
  const staging = join(agentsDir, `.creating-${slug}-${process.pid}`);
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  try {
    await writeFile(join(staging, 'SKILL.md'), skillMd, 'utf8');
    await writeFile(join(staging, 'manifest.yaml'), stringifyYaml(manifest), 'utf8');
    const schemaRel = ((manifest['output'] as { schema?: string } | undefined)?.schema ?? './schema.json').replace(/^\.\//, '');
    if (await exists(join(templateDir, schemaRel))) {
      await cp(join(templateDir, schemaRel), join(staging, schemaRel));
    }
    const dir = join(agentsDir, slug);
    await rename(staging, dir);
    return { slug, dir };
  } catch (err) {
    await rm(staging, { recursive: true, force: true });
    throw err;
  }
}
