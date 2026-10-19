import type { Logger } from 'pino';
import { prisma } from '../db/prisma.js';

// A run is only ever `running` while this process is executing it. If the
// core starts and finds any, a previous process died mid-run: mark them
// failed so history is honest and catch-up logic isn't confused by them.
// Must run before the scheduler starts.
export async function recoverInterruptedRuns(log: Logger): Promise<number> {
  const { count } = await prisma.agentRun.updateMany({
    where: { status: 'running' },
    data: { status: 'failed', error: 'interrupted', completedAt: new Date() },
  });
  if (count > 0) log.warn({ count }, 'interrupted_runs_recovered');
  return count;
}
