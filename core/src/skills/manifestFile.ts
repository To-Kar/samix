import { readFile, rename, writeFile } from 'node:fs/promises';
import matter from 'gray-matter';
import { dirname, join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { Skill } from '../types.js';
import { cleanFocus } from './create.js';

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

// Changes the display title in SKILL.md's frontmatter (the prompt body is
// left exactly as it is), with the same temp-file-and-rename write.
export async function updateSkillTitle(skill: Skill, title: string): Promise<void> {
  const path = skill.skillMdPath;
  const tmp = `${path}.tmp`;
  const parsed = matter(await readFile(path, 'utf8'));
  parsed.data['title'] = title;
  await writeFile(tmp, matter.stringify(parsed.content, parsed.data), 'utf8');
  await rename(tmp, path);
  skill.title = title;
}

// Changes what a Ressort is about: the topic in the manifest and the sentence
// in the prompt (the one marked by <!-- focus --> or written by createAgent as
// `matching this focus: "…"`). Returns false if the prompt has no such sentence
// (an agent that is not made from a template), and changes nothing then.
const FOCUS_MARKED = /<!-- focus -->[\s\S]*?<!-- \/focus -->/;
const FOCUS_WRITTEN = /matching this focus: "[^"]*"/;

export async function updateTopic(skill: Skill, rawTopic: string): Promise<boolean> {
  const topic = cleanFocus(rawTopic);
  if (!topic) return false;
  const path = skill.skillMdPath;
  const parsed = matter(await readFile(path, 'utf8'));
  const sentence = `matching this focus: "${topic}"`;
  let body: string;
  if (FOCUS_WRITTEN.test(parsed.content)) body = parsed.content.replace(FOCUS_WRITTEN, () => sentence);
  else if (FOCUS_MARKED.test(parsed.content)) body = parsed.content.replace(FOCUS_MARKED, () => sentence);
  else return false;

  if (typeof parsed.data['description'] === 'string' && parsed.data['description'].startsWith('Digest of:')) {
    parsed.data['description'] = `Digest of: ${topic}`.slice(0, 160);
  }
  const tmp = `${path}.tmp`;
  await writeFile(tmp, matter.stringify(body, parsed.data), 'utf8');
  await rename(tmp, path);
  await updateManifest(skill, (m) => {
    m['topic'] = topic;
  });
  skill.systemPrompt = matter(await readFile(path, 'utf8')).content.trim();
  skill.manifest.topic = topic;
  if (typeof parsed.data['description'] === 'string') skill.description = parsed.data['description'];
  return true;
}
