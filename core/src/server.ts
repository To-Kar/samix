import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { readFile, writeFile, rename } from 'node:fs/promises';
import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';
import { logger } from './logger.js';
import { prisma } from './db/prisma.js';
import { loadSkills } from './skills/loader.js';
import { runAgent } from './runner/runner.js';
import { recoverInterruptedRuns } from './runner/recovery.js';
import { applyMigrations } from './db/migrate.js';
import { watchParent } from './watchdog.js';
import { startScheduler, reloadSkill } from './scheduler/index.js';
import type { Skill, SourceSpec } from './types.js';

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
  methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
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

const DEFAULT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const articlesQuerySchema = z.object({
  since: z
    .string()
    .refine((v) => Number.isFinite(Date.parse(v)), 'must be a parseable date')
    .optional(),
  topic: z.string().min(1).optional(),
  agent: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

fastify.get('/articles', async (request, reply) => {
  const parsedQuery = articlesQuerySchema.safeParse(request.query);
  if (!parsedQuery.success) {
    reply.code(400).send({ error: 'invalid_query', details: parsedQuery.error.flatten() });
    return reply;
  }
  const q = parsedQuery.data;

  // Filter by Article.createdAt (when we persisted it), not publishedAt
  // (the source's date). The newspaper is "what samix produced when".
  // Default window: last 7 days.
  const since = new Date(q.since ? Date.parse(q.since) : Date.now() - DEFAULT_WINDOW_MS);
  const where: {
    topic?: string;
    agentRun?: { agent: { slug: string } };
  } = {};
  if (q.topic) where.topic = q.topic;
  if (q.agent) where.agentRun = { agent: { slug: q.agent } };

  const rows = await prisma.article.findMany({
    where: {
      ...where,
      createdAt: { gte: since },
    },
    orderBy: { createdAt: 'desc' },
    take: q.limit,
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

const sourcesBodySchema = z.object({
  sources: z.array(
    z.object({
      type: z.enum(['rss', 'perplexity_search', 'arxiv', 'api', 'custom']),
      config: z.record(z.string(), z.unknown()).default({}),
    })
  ),
});

fastify.get<{ Params: { slug: string } }>(
  '/agents/:slug/sources',
  async (request, reply) => {
    const skill = skills.find((s) => s.id === request.params.slug);
    if (!skill) {
      reply.code(404).send({ error: 'agent_not_found', slug: request.params.slug });
      return reply;
    }
    return skill.manifest.sources ?? [];
  }
);

fastify.put<{ Params: { slug: string }; Body: unknown }>(
  '/agents/:slug/sources',
  async (request, reply) => {
    const slug = request.params.slug;
    const skill = skills.find((s) => s.id === slug);
    if (!skill) {
      reply.code(404).send({ error: 'agent_not_found', slug });
      return reply;
    }

    const parsed = sourcesBodySchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send({ error: 'invalid_sources', details: parsed.error.flatten() });
      return reply;
    }

    const manifestDir = dirname(skill.skillMdPath);
    const manifestPath = join(manifestDir, 'manifest.yaml');
    const tmpPath = join(manifestDir, 'manifest.yaml.tmp');

    const raw = await readFile(manifestPath, 'utf8');
    const manifestObj = parseYaml(raw) as Record<string, unknown>;
    manifestObj['sources'] = parsed.data.sources;

    await writeFile(tmpPath, stringifyYaml(manifestObj), 'utf8');
    await rename(tmpPath, manifestPath);

    skill.manifest.sources = parsed.data.sources as SourceSpec[];

    reloadSkill(slug, skill, request.log as unknown as typeof logger);

    return { ok: true };
  }
);

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
