import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { logger } from './logger.js';
import { prisma } from './db/prisma.js';
import { loadSkills } from './skills/loader.js';
import { recoverInterruptedRuns } from './runner/recovery.js';
import { applyMigrations } from './db/migrate.js';
import { watchParent } from './watchdog.js';
import { startScheduler } from './scheduler/index.js';
import { buildApp } from './app.js';
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// src/server.ts → ../agents (relative to core/)
const agentsDir = resolve(__dirname, '../../agents');

let skills: Skill[] = [];
const fastify = await buildApp({ token, logger, getSkills: () => skills });

async function start(): Promise<void> {
  applyMigrations({ logger });
  await prisma.$connect();
  await recoverInterruptedRuns(logger);
  skills = await loadSkills({ agentsDir });
  startScheduler(skills, logger);

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
