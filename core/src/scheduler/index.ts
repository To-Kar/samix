import cron from 'node-cron';
import { CronExpressionParser } from 'cron-parser';
import type { Logger } from 'pino';
import type { Skill } from '../types.js';
import { runAgent } from '../runner/runner.js';
import { prisma } from '../db/prisma.js';
import { cleanupOldData } from './retention.js';

type ScheduledTask = ReturnType<typeof cron.schedule>;

// Module-level task registry — needed for live-reload when manifest sources change.
const tasks = new Map<string, ScheduledTask>();

function registerJob(skill: Skill, logger: Logger): void {
  const schedule = skill.manifest.schedule!;

  if (!cron.validate(schedule.cron)) {
    logger.error({ skill: skill.id, cron: schedule.cron }, 'invalid_cron; skipping');
    return;
  }

  const task = cron.schedule(
    schedule.cron,
    () => {
      const jitterMs = schedule.jitterSeconds
        ? Math.floor(Math.random() * schedule.jitterSeconds * 1000)
        : 0;
      setTimeout(() => {
        void runAgent({ skill, trigger: 'schedule', logger }).catch((err) =>
          logger.error({ err, skill: skill.id }, 'scheduled_run_failed')
        );
      }, jitterMs);
    },
    { timezone: schedule.timezone }
  );

  tasks.set(skill.id, task);
  logger.info({ skill: skill.id, cron: schedule.cron, timezone: schedule.timezone }, 'cron_registered');
}

async function checkCatchup(skill: Skill, log: Logger): Promise<void> {
  const schedule = skill.manifest.schedule!;

  try {
    const interval = CronExpressionParser.parse(schedule.cron, { tz: schedule.timezone });
    const prevScheduledTime = interval.prev().toDate();

    const agentRow = await prisma.agent.findUnique({ where: { slug: skill.id } });
    if (!agentRow) return;

    const runSinceThen = await prisma.agentRun.findFirst({
      where: {
        agentId: agentRow.id,
        status: { in: ['success', 'partial'] },
        startedAt: { gte: prevScheduledTime },
      },
    });

    if (!runSinceThen) {
      log.info({ skill: skill.id, missedAt: prevScheduledTime }, 'catchup_triggered');
      void runAgent({ skill, trigger: 'catchup', logger: log }).catch((err) =>
        log.error({ err, skill: skill.id }, 'catchup_run_failed')
      );
    }
  } catch (err) {
    log.error({ err, skill: skill.id }, 'catchup_check_failed');
  }
}

export function startScheduler(skills: Skill[], logger: Logger): void {
  const proactive = skills.filter((s) => s.type === 'proactive' && s.manifest.schedule);

  for (const skill of proactive) {
    registerJob(skill, logger);

    if (skill.manifest.schedule?.catchupOnStartup) {
      void checkCatchup(skill, logger);
    }
  }

  // Daily retention cleanup at 03:00 UTC — runs before skill crons.
  cron.schedule(
    '0 3 * * *',
    () => {
      void cleanupOldData(logger).catch((err) =>
        logger.error({ err }, 'retention_job_uncaught')
      );
    },
    { timezone: 'UTC' }
  );

  logger.info({ scheduled: proactive.length }, 'scheduler_ready');
}

// Called by PUT /agents/:slug/sources after a manifest rewrite so the job
// picks up any schedule changes alongside the source update.
export function reloadSkill(slug: string, skill: Skill, logger: Logger): void {
  const existing = tasks.get(slug);
  if (existing) {
    existing.stop();
    tasks.delete(slug);
    logger.info({ skill: slug }, 'cron_stopped_for_reload');
  }

  if (skill.type === 'proactive' && skill.manifest.schedule) {
    registerJob(skill, logger);
  }
}
