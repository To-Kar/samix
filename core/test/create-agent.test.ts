import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { buildApp } from '../src/app.js';
import { logger } from '../src/logger.js';
import { createAgent, isTemplate, listTemplates, slugify } from '../src/skills/create.js';
import { loadSkillDir } from '../src/skills/loader.js';
import { validateSchedule } from '../src/skills/schedule.js';
import { prisma } from '../src/db/prisma.js';
import type { Skill } from '../src/types.js';
import { makeSkill, seedAgent } from './helpers.js';

const REPO_AGENTS = resolve(import.meta.dirname, '../../agents');
const AUTH = { authorization: 'Bearer tok' };
const tmp = () => mkdtempSync(join(tmpdir(), 'samix-create-'));
const sources = [{ type: 'website' as const, config: { url: 'chip.de', filter: { keywords: ['KI'] } } }];

describe('slugify', () => {
  it.each([
    ['Chip · KI', 'chip-ki'],
    ['Größere Übersicht', 'grossere-ubersicht'],
    ['  --Weird__Title!! ', 'weird-title'],
    ['日本語', 'agent'],
    ['a'.repeat(80), 'a'.repeat(40)],
  ])('%s → %s', (title, slug) => expect(slugify(title)).toBe(slug));
});

describe('templates', () => {
  it('newsletter-ai is a template; hello-world is not', async () => {
    const found = await listTemplates(REPO_AGENTS);
    expect(found.map((t) => t.id)).toEqual(['newsletter-ai']);
    expect(isTemplate(readFileSync(join(REPO_AGENTS, 'hello-world/SKILL.md'), 'utf8'))).toBe(false);
  });
});

describe('createAgent', () => {
  it('writes an agent that the loader accepts, with only the focus sentence changed', async () => {
    const agentsDir = tmp();
    const { slug, dir } = await createAgent({
      input: { title: 'Chip · KI', focus: 'Künstliche Intelligenz im Alltag', sources, schedule: { cron: '30 7 * * *', timezone: 'Europe/Berlin' } },
      agentsDir,
      templateDir: join(REPO_AGENTS, 'newsletter-ai'),
    });
    expect(slug).toBe('chip-ki');

    const skill = await loadSkillDir(dir);
    expect(skill).toMatchObject({ id: 'chip-ki', title: 'Chip · KI', type: 'proactive', enabled: true });
    expect(skill.manifest.sources).toEqual(sources);
    expect(skill.manifest.schedule).toMatchObject({ cron: '30 7 * * *', timezone: 'Europe/Berlin' });
    expect(skill.manifest.personalize).toBe(true); // template options carry over

    const original = readFileSync(join(REPO_AGENTS, 'newsletter-ai/SKILL.md'), 'utf8');
    expect(skill.systemPrompt).toContain('matching this focus: "Künstliche Intelligenz im Alltag"');
    expect(skill.systemPrompt).not.toContain('artificial');
    expect(skill.systemPrompt).not.toContain('<!--');
    // the hard rules are inherited untouched
    expect(skill.systemPrompt).toContain('MUST be exactly one of the URLs in the input');
    expect(original).toContain('<!-- focus -->');
    expect(existsSync(join(dir, 'schema.json'))).toBe(true);
  });

  it('makes names unique and leaves no staging folder behind', async () => {
    const agentsDir = tmp();
    const make = () =>
      createAgent({ input: { title: 'Tech', focus: 'x', sources }, agentsDir, templateDir: join(REPO_AGENTS, 'newsletter-ai') });
    expect((await make()).slug).toBe('tech');
    expect((await make()).slug).toBe('tech-2');
    expect(readdirSync(agentsDir).sort()).toEqual(['tech', 'tech-2']);
  });

  it('strips markers and control characters from the focus; refuses an empty one', async () => {
    const agentsDir = tmp();
    const { dir } = await createAgent({
      input: { title: 'X', focus: 'robots <!-- /focus --> and\n\n"laws"\u0007', sources },
      agentsDir,
      templateDir: join(REPO_AGENTS, 'newsletter-ai'),
    });
    const skill = await loadSkillDir(dir);
    expect(skill.systemPrompt).toContain("matching this focus: \"robots and 'laws'\"");
    await expect(
      createAgent({ input: { title: 'Y', focus: '<!-- only a comment -->', sources }, agentsDir, templateDir: join(REPO_AGENTS, 'newsletter-ai') })
    ).rejects.toThrow(/empty/);
  });

  it('refuses a template without a focus marker and creates nothing', async () => {
    const agentsDir = tmp();
    await expect(
      createAgent({ input: { title: 'Z', focus: 'x', sources }, agentsDir, templateDir: join(REPO_AGENTS, 'hello-world') })
    ).rejects.toThrow(/marker/);
    expect(readdirSync(agentsDir)).toEqual([]);
  });
});

describe('validateSchedule', () => {
  it('accepts real cron expressions and zones, rejects the rest', () => {
    expect(() => validateSchedule({ cron: '0 6 * * *', timezone: 'Europe/Berlin' })).not.toThrow();
    expect(() => validateSchedule({ cron: 'every day', timezone: 'Europe/Berlin' })).toThrow(/cron/);
    expect(() => validateSchedule({ cron: '0 6 * * *', timezone: 'Mars/Olympus' })).toThrow(/time zone/);
  });
});

describe('API: create agent, edit schedule', () => {
  const setup = async () => {
    const agentsDir = tmp();
    const templates = tmp();
    cpSync(join(REPO_AGENTS, 'newsletter-ai'), join(templates, 'newsletter-ai'), { recursive: true });
    const skills: Skill[] = [];
    const app = await buildApp({ token: 'tok', logger, getSkills: () => skills, addSkill: (s) => skills.push(s), agentsDir, templateDir: templates });
    const post = (payload: unknown) => app.inject({ method: 'POST', url: '/agents', headers: AUTH, payload: payload as object });
    return { app, skills, agentsDir, post };
  };

  it('creates an agent: files, loaded skill, listed, scheduled, no run started', async () => {
    const { app, skills, agentsDir, post } = await setup();
    const res = await post({ title: 'Chip KI', focus: 'KI', sources, schedule: { cron: '0 7 * * *', timezone: 'Europe/Berlin' } });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ slug: 'chip-ki', title: 'Chip KI' });
    expect(skills.map((s) => s.id)).toEqual(['chip-ki']);
    expect(existsSync(join(agentsDir, 'chip-ki', 'manifest.yaml'))).toBe(true);

    const list = (await app.inject({ url: '/agents', headers: AUTH })).json() as { slug: string; title: string; enabled: boolean }[];
    expect(list.find((a) => a.slug === 'chip-ki')).toMatchObject({ title: 'Chip KI', enabled: true });
    expect(await prisma.agentRun.count({ where: { agent: { slug: 'chip-ki' } } })).toBe(0);
  });

  it.each([
    ['no title', { focus: 'x', sources }],
    ['no sources', { title: 'T', focus: 'x', sources: [] }],
    ['bad source config', { title: 'T', focus: 'x', sources: [{ type: 'website', config: { url: 'x.de', maxItems: 0 } }] }],
    ['web search without query or topic', { title: 'T', focus: 'x', sources: [{ type: 'perplexity_search', config: {} }] }],
    ['bad cron', { title: 'T', focus: 'x', sources, schedule: { cron: 'nope', timezone: 'UTC' } }],
    ['unknown template', { title: 'T', focus: 'x', sources, template: 'nope' }],
    ['model without adapter', { title: 'T', focus: 'x', sources, model: { primary: 'gpt-4o-mini' } }],
  ])('rejects %s and creates nothing', async (_n, body) => {
    const { skills, agentsDir, post } = await setup();
    expect((await post(body)).statusCode).toBe(400);
    expect(skills).toEqual([]);
    expect(readdirSync(agentsDir)).toEqual([]);
  });

  it('creates a Ressort that only searches the web for its topic, and the search can be switched off again', async () => {
    const { app, skills, post } = await setup();
    const res = await post({ title: 'Fussball', focus: 'Fußball-Spiele, Bundesliga', sources: [{ type: 'perplexity_search', config: { useTopic: true, recencyHours: 24 } }] });
    expect(res.statusCode).toBe(201);
    expect(skills[0]!.manifest.sources).toEqual([{ type: 'perplexity_search', config: { useTopic: true, recencyHours: 24 } }]);
    // the topic the search will use is stored with the Ressort
    expect(skills[0]!.manifest.topic).toBe('Fußball-Spiele, Bundesliga');

    // adding sites next to it, then removing only the search
    const slug = res.json().slug;
    const put = (s: unknown) => app.inject({ method: 'PUT', url: `/agents/${slug}/sources`, headers: AUTH, payload: { sources: s } });
    expect((await put([{ type: 'perplexity_search', config: { useTopic: true } }, ...sources])).statusCode).toBe(200);
    expect(skills[0]!.manifest.sources!.map((x) => x.type).sort()).toEqual(['perplexity_search', 'website']);
    expect((await put(sources)).statusCode).toBe(200);
    expect(skills[0]!.manifest.sources!.map((x) => x.type)).toEqual(['website']);
    expect((await put([{ type: 'perplexity_search', config: {} }])).statusCode).toBe(400);
  });

  it('lists templates; needs auth', async () => {
    const { app } = await setup();
    expect((await app.inject({ url: '/agent-templates', headers: AUTH })).json()).toEqual([
      expect.objectContaining({ id: 'newsletter-ai' }),
    ]);
    expect((await app.inject({ method: 'POST', url: '/agents', payload: {} })).statusCode).toBe(401);
  });

  it('changes and removes a schedule in the manifest and the running skill', async () => {
    const dir = tmp();
    writeFileSync(join(dir, 'manifest.yaml'), 'id: x\nschedule:\n  cron: "0 6 * * *"\n  timezone: UTC\n  jitter_seconds: 30\n');
    const skill = makeSkill();
    skill.skillMdPath = join(dir, 'SKILL.md');
    skill.manifest.schedule = { cron: '0 6 * * *', timezone: 'UTC', jitterSeconds: 30 };
    await seedAgent(skill);
    const app = await buildApp({ token: 'tok', logger, getSkills: () => [skill] });
    const put = (payload: unknown) =>
      app.inject({ method: 'PUT', url: `/agents/${skill.id}/schedule`, headers: AUTH, payload: payload as object });

    expect((await put({ schedule: { cron: '15 8 * * 1', timezone: 'Europe/Berlin' } })).statusCode).toBe(200);
    const yaml = parseYaml(readFileSync(join(dir, 'manifest.yaml'), 'utf8'));
    expect(yaml.schedule).toEqual({ cron: '15 8 * * 1', timezone: 'Europe/Berlin', jitter_seconds: 30 }); // other keys kept
    expect(skill.manifest.schedule).toMatchObject({ cron: '15 8 * * 1', jitterSeconds: 30 });

    expect((await put({ schedule: { cron: 'bad', timezone: 'UTC' } })).statusCode).toBe(400);
    expect(skill.manifest.schedule?.cron).toBe('15 8 * * 1'); // unchanged

    expect((await put({ schedule: null })).statusCode).toBe(200);
    expect(parseYaml(readFileSync(join(dir, 'manifest.yaml'), 'utf8')).schedule).toBeUndefined();
    expect(skill.manifest.schedule).toBeUndefined();
  });
});
