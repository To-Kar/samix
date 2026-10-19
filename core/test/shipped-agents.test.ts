import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { prisma } from '../src/db/prisma.js';
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
    // Every shipped agent that declares a schema must point at a file that exists.
    for (const s of skills) expect(s.manifest.model.primary).toBeTruthy();
  });

  it('keeps a user-disabled agent disabled when the files are loaded again', async () => {
    await loadSkills({ agentsDir });
    await prisma.agent.update({ where: { slug: 'newsletter-ai' }, data: { enabled: false } });

    const skills = await loadSkills({ agentsDir });

    expect(skills.find((s) => s.id === 'newsletter-ai')!.enabled).toBe(false);
  });
});
