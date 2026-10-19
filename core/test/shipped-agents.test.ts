import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { prisma } from '../src/db/prisma.js';
import { manifestYamlSchema } from '../src/skills/schema.js';
import { loadSkills } from '../src/skills/loader.js';

const agentsDir = resolve(import.meta.dirname, '../../agents');

describe('agents shipped in the repo', () => {
  it('all load, with their manifest options and titles', async () => {
    const skills = await loadSkills({ agentsDir });
    const by = Object.fromEntries(skills.map((s) => [s.id, s]));

    expect(Object.keys(by)).toEqual(expect.arrayContaining(['newsletter-ai', 'hello-world']));
    expect(by['newsletter-ai']).toMatchObject({
      title: 'KI-News',
      enabled: true,
      manifest: { personalize: true, dedupeDays: 14 },
    });
    expect(by['frag-die-zeitung']).toMatchObject({
      type: 'reactive',
      manifest: { tools: ['list_ressorts', 'search_articles', 'get_article', 'fetch_full_text', 'read_notes'] },
    });
    expect(by['orchestrator']).toMatchObject({
      type: 'reactive',
      manifest: { routes: ['delegate', 'show_notes', 'propose_refresh'], delegates: ['frag-die-zeitung', 'projekt-assistent'] },
    });
    // Every delegate an orchestrator names must be a shipped reactive agent.
    for (const d of by['orchestrator']!.manifest.delegates ?? []) expect(by[d]?.type).toBe('reactive');
    // Every shipped agent that declares a schema must point at a file that exists.
    for (const s of skills) expect(s.manifest.model.primary).toBeTruthy();
  });

  it('keeps a user-disabled agent disabled when the files are loaded again', async () => {
    await loadSkills({ agentsDir });
    await prisma.agent.update({ where: { slug: 'newsletter-ai' }, data: { enabled: false } });

    const skills = await loadSkills({ agentsDir });

    expect(skills.find((s) => s.id === 'newsletter-ai')!.enabled).toBe(false);
  });

  it('rejects a manifest that lists a tool that does not exist', () => {
    const base = {
      id: 'x', type: 'reactive', version: '1', model: { primary: 'static' },
      budget: { daily_usd_max: 0, tokens_per_run_max: 0, halt_on_budget_exceeded: false },
      output: { format: 'answer' },
    };
    expect(manifestYamlSchema.safeParse({ ...base, tools: ['search_articles'] }).success).toBe(true);
    expect(manifestYamlSchema.safeParse({ ...base, tools: ['run_shell'] }).success).toBe(false);
    expect(manifestYamlSchema.safeParse({ ...base, routes: ['delegate'] }).success).toBe(true);
    expect(manifestYamlSchema.safeParse({ ...base, routes: ['delete_everything'] }).success).toBe(false);
  });
});
