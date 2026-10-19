import { describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/db/prisma.js';
import { checkCatchup } from '../src/scheduler/index.js';
import { logger } from '../src/logger.js';
import { fakeAdapter, makeSkill, respond, seedAgent, useAdapter } from './helpers.js';

function scheduledSkill() {
  const skill = makeSkill({ withSources: false, withSchema: false });
  // Every minute: the previous scheduled time is always within the last 60 s.
  skill.manifest.schedule = { cron: '* * * * *', timezone: 'UTC', catchupOnStartup: true };
  return skill;
}

describe('checkCatchup', () => {
  it('runs the agent when no successful run covers the last scheduled time', async () => {
    useAdapter(fakeAdapter('claude-haiku-4-5', async () => respond('ok')));
    const skill = scheduledSkill();
    await seedAgent(skill);

    await checkCatchup(skill, logger);

    await vi.waitFor(async () => {
        const runs = await prisma.agentRun.findMany({ where: { agent: { slug: skill.id } } });
        expect(runs.map((r) => [r.trigger, r.status])).toEqual([['catchup', 'success']]);
    });
  });

  it('does nothing when a successful run already happened since the last scheduled time', async () => {
    const skill = scheduledSkill();
    const agentId = await seedAgent(skill);
    await prisma.agentRun.create({
      data: { agentId, status: 'success', trigger: 'schedule', startedAt: new Date() },
    });

    await checkCatchup(skill, logger);
    await new Promise((r) => setTimeout(r, 200));

    const runs = await prisma.agentRun.findMany({ where: { agentId } });
    expect(runs).toHaveLength(1);
  });

  it('does not count a failed run as caught up', async () => {
    useAdapter(fakeAdapter('claude-haiku-4-5', async () => respond('ok')));
    const skill = scheduledSkill();
    const agentId = await seedAgent(skill);
    await prisma.agentRun.create({
      data: { agentId, status: 'failed', trigger: 'schedule', startedAt: new Date() },
    });

    await checkCatchup(skill, logger);

    await vi.waitFor(async () => {
        const runs = await prisma.agentRun.findMany({ where: { agentId, trigger: 'catchup' } });
        expect(runs).toHaveLength(1);
    });
  });
});
