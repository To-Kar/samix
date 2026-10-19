import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import matter from 'gray-matter';
import { describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db/prisma.js';
import { logger } from '../src/logger.js';
import { isScheduled, startScheduler } from '../src/scheduler/index.js';
import { isAgentRunning, runAgent } from '../src/runner/runner.js';
import { createAgent } from '../src/skills/create.js';
import { loadSkillDir } from '../src/skills/loader.js';
import { seedAgents } from '../src/skills/seed.js';
import type { Skill } from '../src/types.js';
import { fakeAdapter, respond, sourceItems, useAdapter, useRssItems } from './helpers.js';

const REPO_AGENTS = resolve(import.meta.dirname, '../../agents');
const AUTH = { authorization: 'Bearer tok' };
const sources = [{ type: 'rss' as const, config: { urls: ['https://x.example/rss'] } }];

async function setup() {
  const agentsDir = mkdtempSync(join(tmpdir(), 'samix-edit-agents-'));
  const templates = mkdtempSync(join(tmpdir(), 'samix-edit-tpl-'));
  for (const a of ['newsletter-ai', 'orchestrator']) cpSync(join(REPO_AGENTS, a), join(templates, a), { recursive: true });
  const skills: Skill[] = [];
  const app = await buildApp({
    token: 'tok',
    logger,
    getSkills: () => skills,
    addSkill: (s) => skills.push(s),
    removeSkill: (slug) => {
      const i = skills.findIndex((s) => s.id === slug);
      if (i >= 0) skills.splice(i, 1);
    },
    agentsDir,
    templateDir: templates,
  });
  const create = async (title: string, focus: string) => {
    const res = await app.inject({ method: 'POST', url: '/agents', headers: AUTH, payload: { title, focus, sources } });
    return res.json().slug as string;
  };
  return { app, skills, agentsDir, templates, create };
}

describe('editing the topic', () => {
  it('changes the manifest, the prompt sentence and the description of a created Ressort', async () => {
    const { app, skills, agentsDir, create } = await setup();
    const slug = await create('Fussball', 'Fußball-Spiele');

    const res = await app.inject({ method: 'PUT', url: `/agents/${slug}/topic`, headers: AUTH, payload: { topic: 'Tennis, "Grand Slams"' } });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ topic: "Tennis, 'Grand Slams'" }); // quotes would break the prompt sentence
    expect(skills[0]!.systemPrompt).toContain(`matching this focus: "Tennis, 'Grand Slams'"`);
    expect(skills[0]!.systemPrompt).not.toContain('Fußball-Spiele');
    const onDisk = matter(readFileSync(join(agentsDir, slug, 'SKILL.md'), 'utf8'));
    expect(onDisk.content).toContain(`matching this focus: "Tennis, 'Grand Slams'"`);
    expect(onDisk.data.description).toBe("Digest of: Tennis, 'Grand Slams'");
    expect(onDisk.data.title).toBe('Fussball');
    expect((parseYaml(readFileSync(join(agentsDir, slug, 'manifest.yaml'), 'utf8')) as { topic: string }).topic).toBe("Tennis, 'Grand Slams'");
    const listed = (await app.inject({ url: '/agents', headers: AUTH })).json();
    expect(listed.find((a: { slug: string }) => a.slug === slug).topic).toBe("Tennis, 'Grand Slams'");
  });

  it('also works on a shipped copy whose sentence is still marked, and refuses agents without one', async () => {
    const { app, skills, agentsDir, templates } = await setup();
    cpSync(join(templates, 'newsletter-ai'), join(agentsDir, 'newsletter-ai'), { recursive: true });
    cpSync(join(templates, 'orchestrator'), join(agentsDir, 'orchestrator'), { recursive: true });
    skills.push(await loadSkillDir(join(agentsDir, 'newsletter-ai')), await loadSkillDir(join(agentsDir, 'orchestrator')));

    expect((await app.inject({ method: 'PUT', url: '/agents/newsletter-ai/topic', headers: AUTH, payload: { topic: 'Rust' } })).statusCode).toBe(200);
    expect(skills[0]!.systemPrompt).toContain('matching this focus: "Rust"');
    expect(skills[0]!.systemPrompt).not.toContain('<!-- focus -->');
    expect((await app.inject({ method: 'PUT', url: '/agents/orchestrator/topic', headers: AUTH, payload: { topic: 'x' } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'PUT', url: '/agents/newsletter-ai/topic', headers: AUTH, payload: { topic: '' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: '/agents/nope/topic', headers: AUTH, payload: { topic: 'x' } })).statusCode).toBe(404);
  });
});

describe('removing a Ressort', () => {
  it('moves the folder aside, drops it from the lists and the schedule, and keeps its history', async () => {
    const { app, skills, agentsDir, create } = await setup();
    const slug = await create('Fussball', 'Fußball');
    const keep = await create('Tennis', 'Tennis');
    const agentRow = await prisma.agent.findUniqueOrThrow({ where: { slug } });
    await prisma.agentRun.create({ data: { agentId: agentRow.id, status: 'success', trigger: 'manual', costUsd: 0.02 } });

    const res = await app.inject({ method: 'DELETE', url: `/agents/${slug}`, headers: AUTH });

    expect(res.statusCode).toBe(204);
    expect(existsSync(join(agentsDir, slug))).toBe(false);
    expect(readdirSync(join(agentsDir, '.removed')).some((n) => n.startsWith(`${slug}--`))).toBe(true);
    expect(existsSync(join(agentsDir, '.removed', readdirSync(join(agentsDir, '.removed'))[0]!, 'manifest.yaml'))).toBe(true);
    expect(skills.map((s) => s.id)).toEqual([keep]);
    expect((await app.inject({ url: '/agents', headers: AUTH })).json().map((a: { slug: string }) => a.slug)).toEqual([keep]);
    expect(await prisma.agentRun.count({ where: { agentId: agentRow.id } })).toBe(1);
    expect((await prisma.agent.findUniqueOrThrow({ where: { slug } })).enabled).toBe(false);
    expect((await app.inject({ method: 'DELETE', url: `/agents/${slug}`, headers: AUTH })).statusCode).toBe(404);
  });

  it('stops its cron job', async () => {
    const { app, skills, create } = await setup();
    const slug = await create('Zeitplan', 'Fußball');
    startScheduler(skills, logger);
    expect(isScheduled(slug)).toBe(true);

    await app.inject({ method: 'DELETE', url: `/agents/${slug}`, headers: AUTH });

    expect(isScheduled(slug)).toBe(false);
  });

  it('refuses reactive agents and a Ressort that is running right now', async () => {
    const { app, skills, agentsDir, templates, create } = await setup();
    cpSync(join(templates, 'orchestrator'), join(agentsDir, 'orchestrator'), { recursive: true });
    skills.push(await loadSkillDir(join(agentsDir, 'orchestrator')));
    expect((await app.inject({ method: 'DELETE', url: '/agents/orchestrator', headers: AUTH })).statusCode).toBe(409);
    expect(existsSync(join(agentsDir, 'orchestrator'))).toBe(true);

    const slug = await create('Laufend', 'Fußball');
    const skill = skills.find((s) => s.id === slug)!;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    useRssItems(sourceItems(6));
    useAdapter(fakeAdapter('claude-haiku-4-5', async () => { await gate; return respond('{}'); }));
    const running = runAgent({ skill, trigger: 'manual', logger });
    await vi.waitFor(() => expect(isAgentRunning(slug)).toBe(true));

    const res = await app.inject({ method: 'DELETE', url: `/agents/${slug}`, headers: AUTH });
    expect(res.statusCode).toBe(409);
    expect(existsSync(join(agentsDir, slug))).toBe(true);
    release();
    await running;
  });

  it('does not bring a removed shipped default back at the next start, and does not reuse its slug', async () => {
    const { app, skills, agentsDir, templates } = await setup();
    seedAgents(templates, agentsDir);
    skills.push(await loadSkillDir(join(agentsDir, 'newsletter-ai')));
    expect((await app.inject({ method: 'DELETE', url: '/agents/newsletter-ai', headers: AUTH })).statusCode).toBe(204);

    expect(seedAgents(templates, agentsDir)).toEqual([]); // orchestrator exists, newsletter-ai is removed
    expect(existsSync(join(agentsDir, 'newsletter-ai'))).toBe(false);

    // a new Ressort of the same name gets its own slug, so the old history is not mixed in
    const { slug } = await createAgent({ input: { title: 'newsletter-ai', focus: 'x', sources }, agentsDir, templateDir: join(templates, 'newsletter-ai') });
    expect(slug).toBe('newsletter-ai-2');
  });
});
