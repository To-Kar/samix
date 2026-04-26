import type { Logger } from 'pino';
import { prisma } from '../db/prisma.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function readEnvDays(name: string, defaultDays: number): number {
  const raw = process.env[name];
  if (raw == null || raw === '') return defaultDays;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : defaultDays;
}

export async function cleanupOldData(logger: Logger): Promise<void> {
  const now = Date.now();
  const articleCutoff = new Date(now - readEnvDays('SAMIX_ARTICLE_RETENTION_DAYS', 30) * MS_PER_DAY);
  const snapshotCutoff = new Date(now - readEnvDays('SAMIX_SNAPSHOT_RETENTION_DAYS', 30) * MS_PER_DAY);
  const runCutoff = new Date(now - readEnvDays('SAMIX_RUN_RETENTION_DAYS', 14) * MS_PER_DAY);

  try {
    // Deletion order matters — schema uses ON DELETE RESTRICT (no cascade).
    // Articles reference AgentRuns; SourceSnapshots reference AgentRuns.
    // Delete children first, then orphaned AgentRuns.
    const { count: articles } = await prisma.article.deleteMany({
      where: { createdAt: { lt: articleCutoff } },
    });
    const { count: snapshots } = await prisma.sourceSnapshot.deleteMany({
      where: { fetchedAt: { lt: snapshotCutoff } },
    });

    const orphans = await prisma.agentRun.findMany({
      where: {
        startedAt: { lt: runCutoff },
        articles: { none: {} },
        snapshots: { none: {} },
      },
      select: { id: true },
    });
    const { count: runs } =
      orphans.length > 0
        ? await prisma.agentRun.deleteMany({
            where: { id: { in: orphans.map((r) => r.id) } },
          })
        : { count: 0 };

    logger.info({ articles, snapshots, runs }, 'retention_cleanup_done');
  } catch (err) {
    logger.error({ err }, 'retention_cleanup_failed');
    // Do not re-throw — a retention failure must not crash the scheduler.
  }
}
