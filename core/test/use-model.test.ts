import { cpSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { buildApp } from '../src/app.js';
import { logger } from '../src/logger.js';
import { loadSkillDir } from '../src/skills/loader.js';

const REPO_AGENTS = resolve(import.meta.dirname, '../../agents');
const AUTH = { authorization: 'Bearer tok' };

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'samix-usemodel-'));
  for (const a of ['newsletter-ai', 'frag-die-zeitung', 'orchestrator']) cpSync(join(REPO_AGENTS, a), join(dir, a), { recursive: true });
  const skills = await Promise.all(['newsletter-ai', 'frag-die-zeitung', 'orchestrator'].map((a) => loadSkillDir(join(dir, a))));
  const app = await buildApp({ token: 'tok', logger, getSkills: () => skills });
  const primaryOnDisk = (slug: string) => (parseYaml(readFileSync(join(dir, slug, 'manifest.yaml'), 'utf8')) as { model: { primary: string } }).model.primary;
  return { app, skills, primaryOnDisk };
}
const use = (app: Awaited<ReturnType<typeof setup>>['app'], primary: string) =>
  app.inject({ method: 'POST', url: '/models/use', headers: AUTH, payload: { primary } });

const saved = { a: process.env.ANTHROPIC_API_KEY, d: process.env.DEEPSEEK_API_KEY };
afterEach(() => {
  for (const [k, v] of [['ANTHROPIC_API_KEY', saved.a], ['DEEPSEEK_API_KEY', saved.d]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('POST /models/use', () => {
  it('switches every agent whose model has no key to the model that has one, in memory and in the files', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.DEEPSEEK_API_KEY = 'k';
    const { app, skills, primaryOnDisk } = await setup();

    const res = await use(app, 'deepseek-chat');

    expect(res.statusCode).toBe(200);
    expect(res.json().changed.map((c: { slug: string }) => c.slug).sort()).toEqual(['frag-die-zeitung', 'newsletter-ai', 'orchestrator']);
    for (const s of skills) expect(s.manifest.model.primary).toBe('deepseek-chat');
    expect(primaryOnDisk('newsletter-ai')).toBe('deepseek-chat');
    expect(primaryOnDisk('orchestrator')).toBe('deepseek-chat');
  });

  it('leaves agents alone whose current model already works', async () => {
    process.env.ANTHROPIC_API_KEY = 'a';
    process.env.DEEPSEEK_API_KEY = 'k';
    const { app, skills } = await setup();
    expect((await use(app, 'deepseek-chat')).json().changed).toEqual([]);
    for (const s of skills) expect(s.manifest.model.primary).toBe('claude-haiku-4-5');
  });

  it('refuses a model without a key, an unknown model, and does not move tool agents to a model without tool calling', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    const { app, skills } = await setup();
    expect((await use(app, 'deepseek-chat')).statusCode).toBe(409);
    expect((await use(app, 'gpt-5')).statusCode).toBe(400);

    // a local model has no key and no tool calling: only the newsletter may move there
    const res = await use(app, 'ollama-llama3');
    expect(res.json().changed.map((c: { slug: string }) => c.slug)).toEqual(['newsletter-ai']);
    expect(skills.find((s) => s.id === 'frag-die-zeitung')!.manifest.model.primary).toBe('claude-haiku-4-5');
  });
});
