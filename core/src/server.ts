import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import { logger } from './logger.js';
import { prisma } from './db/prisma.js';
import { loadSkills } from './skills/loader.js';
import { runAgent } from './runner/runner.js';
import { startScheduler } from './scheduler/index.js';
import type { Skill } from './types.js';

const PKG_VERSION = '0.1.0';

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

const fastify = Fastify({
  loggerInstance: logger,
  disableRequestLogging: false,
  trustProxy: false,
});

await fastify.register(helmet, {
  contentSecurityPolicy: false,
  // The WebView at http://localhost:1420 (dev) or tauri://localhost (prod)
  // fetches from this loopback API, so the default `same-origin` CORP would
  // block responses. Token auth + loopback bind are the real access controls.
  crossOriginResourcePolicy: { policy: 'cross-origin' },
});

// The WebView loads the UI from http://localhost:1420 (Vite dev) or
// tauri://localhost (prod). Both need permission to fetch the loopback core.
// The bearer-token middleware is still the real access control; CORS just
// lets the browser expose responses to the app-owned JS.
await fastify.register(cors, {
  origin: true,
  credentials: false,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type'],
});

let skills: Skill[] = [];

fastify.addHook('onRequest', async (request, reply) => {
  // Let CORS preflight through so @fastify/cors can handle it.
  if (request.method === 'OPTIONS') return;
  // /health is open so the UI can detect core reachability without a token.
  if (request.url === '/health') return;

  const header = request.headers['authorization'];
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
    reply.code(401).send({ error: 'unauthorized' });
    return reply;
  }
  const presented = header.slice('Bearer '.length).trim();
  if (presented !== token) {
    reply.code(401).send({ error: 'unauthorized' });
    return reply;
  }
});

fastify.get('/health', async () => ({
  status: 'ok',
  uptime: process.uptime(),
  version: PKG_VERSION,
}));

fastify.get('/agents', async () => {
  const rows = await prisma.agent.findMany({ orderBy: { slug: 'asc' } });
  return rows.map((a) => ({
    id: a.id,
    slug: a.slug,
    type: a.type,
    enabled: a.enabled,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  }));
});

fastify.post<{ Params: { slug: string } }>(
  '/agents/:slug/run',
  async (request, reply) => {
    const slug = request.params.slug;
    const skill = skills.find((s) => s.id === slug);
    if (!skill) {
      reply.code(404).send({ error: 'agent_not_found', slug });
      return reply;
    }
    const result = await runAgent({
      skill,
      trigger: 'manual',
      logger: request.log as unknown as typeof logger,
    });
    return result;
  }
);

fastify.get<{
  Querystring: { since?: string; topic?: string; agent?: string; limit?: string };
}>('/articles', async (request) => {
  const q = request.query;
  const where: {
    publishedAt?: { gte: Date };
    topic?: string;
    agentRun?: { agent: { slug: string } };
  } = {};

  // Default window: last 7 days, by createdAt — gives the newspaper a
  // sensible page-1 without forcing the client to compute a date.
  const sinceMs = q.since ? Date.parse(q.since) : Date.now() - 7 * 24 * 60 * 60 * 1000;
  if (Number.isFinite(sinceMs)) {
    // Filter by Article.createdAt (when we persisted it), not publishedAt
    // (the source's date). The newspaper is "what samix produced when".
  }
  if (q.topic) where.topic = q.topic;
  if (q.agent) where.agentRun = { agent: { slug: q.agent } };

  const limit = Math.min(Number(q.limit ?? 100), 500);

  const rows = await prisma.article.findMany({
    where: {
      ...where,
      createdAt: { gte: new Date(sinceMs) },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      agentRun: { select: { agent: { select: { slug: true } } } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    summary: r.summary,
    sourceUrl: r.sourceUrl,
    sourceName: r.sourceName,
    publishedAt: r.publishedAt,
    topic: r.topic,
    createdAt: r.createdAt,
    agentSlug: r.agentRun.agent.slug,
  }));
});

fastify.get<{ Params: { id: string } }>('/runs/:id', async (request, reply) => {
  const run = await prisma.agentRun.findUnique({
    where: { id: request.params.id },
    include: { agent: { select: { slug: true } } },
  });
  if (!run) {
    reply.code(404).send({ error: 'run_not_found', id: request.params.id });
    return reply;
  }
  return {
    id: run.id,
    agentSlug: run.agent.slug,
    status: run.status,
    trigger: run.trigger,
    input: run.input ? JSON.parse(run.input) : null,
    output: run.output ? JSON.parse(run.output) : null,
    tokensInput: run.tokensInput,
    tokensOutput: run.tokensOutput,
    costUsd: run.costUsd,
    error: run.error,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
  };
});

async function start(): Promise<void> {
  await prisma.$connect();
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

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await start();
} catch (err) {
  logger.error({ err }, 'startup failed');
  process.exit(1);
}
