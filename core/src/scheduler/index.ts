import type { Logger } from 'pino';
import type { Skill } from '../types.js';

// Phase 0: no-op scheduler. Proactive triggering (cron) arrives in Phase 1.
// We import node-cron-free here on purpose so this remains a pure placeholder
// until there is real scheduling to do.
export function startScheduler(skills: Skill[], logger: Logger): void {
  const scheduled = skills.filter(
    (s) => s.type === 'proactive' && s.manifest.schedule
  ).length;
  logger.info({ scheduled }, 'scheduler_ready');
}
