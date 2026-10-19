import { resolve } from 'node:path';
import { logger } from './logger.js';
import { prisma } from './db/prisma.js';
import { loadSkills } from './skills/loader.js';
import { recoverInterruptedRuns } from './runner/recovery.js';
import { applyMigrations } from './db/migrate.js';
import { loadSettings } from './settings.js';
import { watchParent } from './watchdog.js';
import { startScheduler, startWakeDetector } from './scheduler/index.js';
import { seedAgents } from './skills/seed.js';
import { syncShippedAgents } from './skills/sync.js';
import { buildApp } from './app.js';
import { registerContentPrefetch } from './content/prefetch.js';
import { applyContentRetention } from './content/retention.js';
import type { Skill } from './types.js';

const token = process.env.SAMIX_TOKEN;
if (!token) {
  logger.error('SAMIX_TOKEN env var is required');
  process.exit(1);
}

const portEnv = process.env.SAMIX_PORT;
const port = portEnv == null || portEnv === '' ? 0 : Number(portEnv);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  logger.error({ portEnv }, 'SAMIX_PORT must be an integer 0..65535');
  process.exit(1);
}

// Dev: the repo's agents/ (src/server.ts → ../../agents). Installed app: the
// shell points SAMIX_AGENTS_DIR at a writable folder and SAMIX_BUNDLED_AGENTS_DIR
// at the defaults inside the app bundle, which are copied over once.
const agentsDir = process.env.SAMIX_AGENTS_DIR ?? resolve(import.meta.dirname, '../../agents');
const bundledAgentsDir = process.env.SAMIX_BUNDLED_AGENTS_DIR;

let skills: Skill[] = [];
const fastify = await buildApp({
  token,
  logger,
  getSkills: () => skills,
  addSkill: (skill) => skills.push(skill),
  agentsDir,
  // Templates come from the shipped agents, which the user never edits.
  templateDir: bundledAgentsDir ?? agentsDir,
});

async function start(): Promise<void> {
  applyMigrations({ logger });
  await prisma.$connect();
  await loadSettings();
  await recoverInterruptedRuns(logger);
  if (bundledAgentsDir) {
    seedAgents(bundledAgentsDir, agentsDir, logger);
    await syncShippedAgents(bundledAgentsDir, agentsDir, logger);
  }
  skills = await loadSkills({ agentsDir });
  registerContentPrefetch(logger);
  await applyContentRetention(logger);
  setInterval(
    () => void applyContentRetention(logger).catch((err) => logger.warn({ err }, 'retention_failed')),
    24 * 60 * 60 * 1000
  ).unref();
  startScheduler(skills, logger);
  startWakeDetector(skills, logger);

  const actualPort = await fastify.listen({ host: '127.0.0.1', port });
  logger.info({ addr: actualPort, skills: skills.length }, 'ready');
}

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'shutdown start');
  try {
    await fastify.close();
    await prisma.$disconnect();
    logger.info('shutdown complete');
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'shutdown error');
    process.exit(1);
  }
}

const parentPid = Number(process.env.SAMIX_PARENT_PID);
if (Number.isInteger(parentPid) && parentPid > 0) {
  watchParent(parentPid, () => {
    logger.warn({ parentPid }, 'parent_process_gone');
    void shutdown('parent_gone');
  });
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await start();
} catch (err) {
  logger.error({ err }, 'startup failed');
  process.exit(1);
}
