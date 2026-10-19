import { join } from 'node:path';
import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import { z } from 'zod';
import type { Logger } from 'pino';
import { prisma } from './db/prisma.js';
import { runAgent } from './runner/runner.js';
import { askAgent } from './runner/converse.js';
import { routeQuestion } from './runner/orchestrate.js';
import { MAX_QUESTION_CHARS } from './runner/turn.js';
import { addNote, deleteNote, listNotes } from './memory/notes.js';
import { reloadSkill } from './scheduler/index.js';
import { buildReaderProfile } from './runner/profile.js';
import { createAgent, listTemplates } from './skills/create.js';
import { loadSkillDir } from './skills/loader.js';
import { validateSchedule } from './skills/schedule.js';
import { knownModelIds, MODEL_KEY_ENV } from './adapters/index.js';
import { updateManifest, updateSkillTitle } from './skills/manifestFile.js';
import { leadExcerpt, parseBlocks } from './content/blocks.js';
import { normalizeUrl } from './output/traceability.js';
import { ensureArticleContent } from './content/articleContent.js';
import { readMedia } from './content/media.js';
import { MODEL_IDS, SOURCE_TYPES, type Skill, type SourceItem, type SourceSpec } from './types.js';
import { WebsiteFetcher, type WebsiteConfig } from './sources/website.js';
import { resolveFetcher, validateSourceSpec } from './sources/index.js';

const PKG_VERSION = '0.1.0';

export interface AppDeps {
  token: string;
  logger: Logger;
  // A getter, because the skills are loaded after the app object is built.
  getSkills: () => Skill[];
  /** Registers a skill created at runtime (POST /agents). */
  addSkill?: (skill: Skill) => void;
  /** Where user agents live and where agent templates are read from. */
  agentsDir?: string;
  templateDir?: string;
}

// Builds the HTTP API without listening, so tests can drive it with
// fastify.inject(). server.ts owns env handling, startup and shutdown.
export async function buildApp(deps: AppDeps) {
  const { token, logger } = deps;
  const skillList = deps.getSkills;

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
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
  });

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
    const lastRuns = await Promise.all(
      rows.map((a) =>
        prisma.agentRun.findFirst({
          where: { agentId: a.id },
          orderBy: { startedAt: 'desc' },
          select: { startedAt: true, status: true, error: true, costUsd: true },
        })
      )
    );
    return rows.map((a, i) => {
      const skill = skillList().find((s) => s.id === a.slug);
      return {
        id: a.id,
        slug: a.slug,
        title: skill?.title ?? a.slug,
        description: skill?.description ?? '',
        type: a.type,
        enabled: a.enabled,
        schedule: skill?.manifest.schedule ?? null,
        model: skill?.manifest.model.primary ?? null,
        personalize: skill?.manifest.personalize ?? false,
        lastRun: lastRuns[i] ?? null,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
      };
    });
  });

  fastify.put<{ Params: { slug: string }; Body: { enabled?: unknown } }>(
    '/agents/:slug/enabled',
    async (request, reply) => {
      const skill = skillList().find((s) => s.id === request.params.slug);
      if (!skill) {
        reply.code(404).send({ error: 'agent_not_found', slug: request.params.slug });
        return reply;
      }
      if (typeof request.body?.enabled !== 'boolean') {
        reply.code(400).send({ error: 'invalid_body', message: 'enabled must be true or false' });
        return reply;
      }
      await prisma.agent.update({ where: { slug: skill.id }, data: { enabled: request.body.enabled } });
      skill.enabled = request.body.enabled;
      // (Re)registers the cron job, or drops it when switched off.
      reloadSkill(skill.id, skill, request.log as unknown as typeof logger);
      return { ok: true, enabled: skill.enabled };
    }
  );

  fastify.post<{ Params: { slug: string } }>(
    '/agents/:slug/run',
    async (request, reply) => {
      const slug = request.params.slug;
      const skill = skillList().find((s) => s.id === slug);
      if (!skill) {
        reply.code(404).send({ error: 'agent_not_found', slug });
        return reply;
      }
      if (!skill.enabled) {
        reply.code(409).send({ error: 'agent_disabled', slug });
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

  // ---- Notes: the reader's visible memory

  fastify.get('/notes', async () => {
    const notes = await listNotes();
    return notes.map((n) => ({ id: n.id, text: n.text, createdAt: n.createdAt }));
  });

  fastify.post('/notes', async (request, reply) => {
    const text = (request.body as { text?: unknown } | null)?.text;
    const r = typeof text === 'string' ? await addNote(text) : ({ ok: false, error: 'invalid_text' } as const);
    if (!r.ok) {
      reply.code(r.error === 'too_many_notes' ? 409 : 400).send({ error: r.error });
      return reply;
    }
    reply.code(201);
    return { id: r.note.id, text: r.note.text, createdAt: r.note.createdAt };
  });

  fastify.delete<{ Params: { id: string } }>('/notes/:id', async (request, reply) => {
    if (!(await deleteNote(request.params.id))) {
      reply.code(404).send({ error: 'note_not_found' });
      return reply;
    }
    reply.code(204).send();
    return reply;
  });

  // ---- Fragen: conversations with a reactive agent over the collected articles

  // Questions go to the orchestrator, or straight to the Q&A agent when there is none.
  const ORCHESTRATOR = 'orchestrator';
  const QA_AGENT = 'frag-die-zeitung';
  const isAskable = (s: Skill) =>
    s.type === 'reactive' && ((s.manifest.tools?.length ?? 0) > 0 || (s.manifest.routes?.length ?? 0) > 0);

  const askBodySchema = z.object({
    question: z.string().trim().min(1).max(MAX_QUESTION_CHARS),
    conversationId: z.string().min(1).optional(),
    agent: z.string().min(1).optional(),
  });

  fastify.post('/ask', async (request, reply) => {
    const body = askBodySchema.safeParse(request.body);
    if (!body.success) {
      reply.code(400).send({ error: 'invalid_body', message: `question must be 1–${MAX_QUESTION_CHARS} characters` });
      return reply;
    }
    const { question, conversationId } = body.data;
    const agent =
      body.data.agent ?? (skillList().some((s) => s.id === ORCHESTRATOR && s.enabled) ? ORCHESTRATOR : QA_AGENT);
    const skill = skillList().find((s) => s.id === agent && isAskable(s));
    if (!skill) {
      reply.code(404).send({ error: 'agent_not_found', slug: agent });
      return reply;
    }
    if (!skill.enabled) {
      reply.code(409).send({ error: 'agent_disabled', slug: agent });
      return reply;
    }
    if (conversationId) {
      const row = await prisma.conversation.findFirst({ where: { id: conversationId, agent: { slug: agent } } });
      if (!row) {
        reply.code(404).send({ error: 'conversation_not_found' });
        return reply;
      }
    }
    const log = request.log as unknown as typeof logger;
    if (skill.manifest.routes?.length) {
      return routeQuestion({ skill, question, conversationId, skills: skillList(), logger: log });
    }
    return askAgent({ skill, question, conversationId, logger: log });
  });

  fastify.get('/conversations', async (request) => {
    const agent = (request.query as { agent?: string }).agent;
    const rows = await prisma.conversation.findMany({
      where: agent ? { agent: { slug: agent } } : {},
      orderBy: { updatedAt: 'desc' },
      take: 100,
      include: { agent: { select: { slug: true } } },
    });
    return rows.map((c) => ({ id: c.id, agent: c.agent.slug, title: c.title, createdAt: c.createdAt, updatedAt: c.updatedAt }));
  });

  fastify.get<{ Params: { id: string } }>('/conversations/:id', async (request, reply) => {
    const c = await prisma.conversation.findUnique({
      where: { id: request.params.id },
      include: { agent: { select: { slug: true } }, messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!c) {
      reply.code(404).send({ error: 'conversation_not_found' });
      return reply;
    }
    const runIds = c.messages.flatMap((m) => (m.agentRunId ? [m.agentRunId] : []));
    const runs = await prisma.agentRun.findMany({ where: { id: { in: runIds } } });
    const runById = new Map(runs.map((r) => [r.id, r]));
    return {
      id: c.id,
      agent: c.agent.slug,
      title: c.title,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      messages: c.messages.map((m) => {
        const run = m.agentRunId ? runById.get(m.agentRunId) : undefined;
        let trace: unknown[] = [];
        try {
          trace = run?.output ? ((JSON.parse(run.output) as { steps?: unknown[] }).steps ?? []) : [];
        } catch {
          // an unreadable trace must not hide the conversation
        }
        let extra: { route?: unknown; proposals?: unknown[]; totalCostUsd?: number } = {};
        try {
          extra = m.extra ? (JSON.parse(m.extra) as typeof extra) : {};
        } catch {
          // ignore an unreadable extra
        }
        return {
          id: m.id,
          role: m.role,
          content: m.content,
          status: m.status,
          citations: m.citations ? (JSON.parse(m.citations) as unknown[]) : [],
          createdAt: m.createdAt,
          route: extra.route ?? null,
          proposals: extra.proposals ?? [],
          ...(run ? { runId: run.id, error: run.error, model: run.model, costUsd: extra.totalCostUsd ?? run.costUsd, trace } : {}),
        };
      }),
    };
  });

  fastify.delete<{ Params: { id: string } }>('/conversations/:id', async (request, reply) => {
    const res = await prisma.conversation.deleteMany({ where: { id: request.params.id } });
    if (res.count === 0) {
      reply.code(404).send({ error: 'conversation_not_found' });
      return reply;
    }
    reply.code(204).send();
    return reply;
  });

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

  // Run history for the "what happened and what did it cost" view.
  const runsQuery = z.object({
    agent: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  });
  fastify.get('/runs', async (request, reply) => {
    const q = runsQuery.safeParse(request.query);
    if (!q.success) {
      reply.code(400).send({ error: 'invalid_query', details: q.error.flatten() });
      return reply;
    }
    const runs = await prisma.agentRun.findMany({
      where: q.data.agent ? { agent: { slug: q.data.agent } } : {},
      orderBy: { startedAt: 'desc' },
      take: q.data.limit,
      include: { agent: { select: { slug: true } }, _count: { select: { articles: true, snapshots: true } } },
    });
    return runs.map((r) => ({
      id: r.id,
      agentSlug: r.agent.slug,
      status: r.status,
      trigger: r.trigger,
      model: r.model,
      costUsd: r.costUsd,
      tokensInput: r.tokensInput,
      tokensOutput: r.tokensOutput,
      error: r.error,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      articleCount: r._count.articles,
      sourceCount: r._count.snapshots,
      // A run that found nothing new says so in its output; the raw model
      // output of other runs is not part of this listing.
      nothingNew: r.status === 'success' && (r.output?.startsWith('{"note":"no_new_items"') ?? false),
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
        type: z.enum(SOURCE_TYPES),
        config: z.record(z.string(), z.unknown()).default({}),
      })
    ),
  });

  fastify.get<{ Params: { slug: string } }>(
    '/agents/:slug/sources',
    async (request, reply) => {
      const skill = skillList().find((s) => s.id === request.params.slug);
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
      const skill = skillList().find((s) => s.id === slug);
      if (!skill) {
        reply.code(404).send({ error: 'agent_not_found', slug });
        return reply;
      }

      const parsed = sourcesBodySchema.safeParse(request.body);
      if (!parsed.success) {
        reply.code(400).send({ error: 'invalid_sources', details: parsed.error.flatten() });
        return reply;
      }
      for (const spec of parsed.data.sources) {
        try {
          validateSourceSpec(spec as SourceSpec);
        } catch (err) {
          reply.code(400).send({ error: 'invalid_source_config', type: spec.type, message: errorMessage(err) });
          return reply;
        }
      }

      await updateManifest(skill, (m) => {
        m['sources'] = parsed.data.sources;
      });

      skill.manifest.sources = parsed.data.sources as SourceSpec[];

      reloadSkill(slug, skill, request.log as unknown as typeof logger);

      return { ok: true };
    }
  );

  // ---- Editions: one successful run that produced articles = one edition ----

  const editionsQuery = z.object({
    agent: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  });
  const editionQuery = z.object({
    leadParagraphs: z.coerce.number().int().min(0).max(20).default(4),
    // Only used with id "latest": the newest edition of this agent (a Ressort).
    agent: z.string().min(1).optional(),
  });
  const hasArticles = { articles: { some: {} } } as const;

  fastify.get('/editions', async (request, reply) => {
    const parsed = editionsQuery.safeParse(request.query);
    if (!parsed.success) {
      reply.code(400).send({ error: 'invalid_query', details: parsed.error.flatten() });
      return reply;
    }
    const { agent, limit } = parsed.data;
    const where = { ...hasArticles, ...(agent ? { agent: { slug: agent } } : {}) };
    const [total, runs] = await Promise.all([
      prisma.agentRun.count({ where }),
      prisma.agentRun.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        take: limit,
        include: {
          agent: { select: { slug: true } },
          _count: { select: { articles: true, snapshots: true } },
        },
      }),
    ]);
    return runs.map((r, i) => ({
      id: r.id,
      number: total - i,
      agentSlug: r.agent.slug,
      startedAt: r.startedAt,
      articleCount: r._count.articles,
      sourceCount: r._count.snapshots,
      costUsd: r.costUsd,
      model: r.model,
    }));
  });

  fastify.get<{ Params: { id: string }; Querystring: unknown }>(
    '/editions/:id',
    async (request, reply) => {
      const q = editionQuery.safeParse(request.query);
      if (!q.success) {
        reply.code(400).send({ error: 'invalid_query', details: q.error.flatten() });
        return reply;
      }
      // "latest" is a convenience for the front page.
      const run =
        request.params.id === 'latest'
          ? await prisma.agentRun.findFirst({
              where: { ...hasArticles, ...(q.data.agent ? { agent: { slug: q.data.agent } } : {}) },
              orderBy: { startedAt: 'desc' },
            })
          : await prisma.agentRun.findUnique({ where: { id: request.params.id } });
      if (!run) {
        reply.code(404).send({ error: 'edition_not_found', id: request.params.id });
        return reply;
      }

      const [articles, snapshotCount, agent, older, newer, earlier] = await Promise.all([
        prisma.article.findMany({
          where: { agentRunId: run.id },
          include: { content: true, vote: true },
        }),
        prisma.sourceSnapshot.count({ where: { agentRunId: run.id } }),
        prisma.agent.findUnique({ where: { id: run.agentId }, select: { slug: true } }),
        prisma.agentRun.findFirst({
          where: { ...hasArticles, agentId: run.agentId, startedAt: { lt: run.startedAt } },
          orderBy: { startedAt: 'desc' },
          select: { id: true },
        }),
        prisma.agentRun.findFirst({
          where: { ...hasArticles, agentId: run.agentId, startedAt: { gt: run.startedAt } },
          orderBy: { startedAt: 'asc' },
          select: { id: true },
        }),
        prisma.agentRun.count({
          where: { ...hasArticles, agentId: run.agentId, startedAt: { lt: run.startedAt } },
        }),
      ]);
      // Front-page order: most important first, then newest.
      articles.sort(
        (a, b) =>
          (b.importance ?? 3) - (a.importance ?? 3) ||
          (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0)
      );

      return {
        id: run.id,
        number: earlier + 1,
        agentSlug: agent?.slug ?? null,
        startedAt: run.startedAt,
        costUsd: run.costUsd,
        model: run.model,
        sourceCount: snapshotCount,
        olderId: older?.id ?? null,
        newerId: newer?.id ?? null,
        articles: articles.map((a) => articleSummary(a, q.data.leadParagraphs)),
      };
    }
  );

  // ---- Creating agents, schedules ----------------------------------------

  fastify.put<{ Params: { slug: string }; Body: { title?: unknown } }>(
    '/agents/:slug/title',
    async (request, reply) => {
      const skill = skillList().find((s) => s.id === request.params.slug);
      if (!skill) {
        reply.code(404).send({ error: 'agent_not_found', slug: request.params.slug });
        return reply;
      }
      const title = z.string().trim().min(1).max(60).safeParse(request.body?.title);
      if (!title.success) {
        reply.code(400).send({ error: 'invalid_title', message: 'title must be 1–60 characters' });
        return reply;
      }
      await updateSkillTitle(skill, title.data);
      return { ok: true, title: skill.title };
    }
  );

  // Whether the reader's votes are sent along with a run (see runner/profile.ts).
  fastify.put<{ Params: { slug: string }; Body: { enabled?: unknown } }>(
    '/agents/:slug/personalize',
    async (request, reply) => {
      const skill = skillList().find((s) => s.id === request.params.slug);
      if (!skill) {
        reply.code(404).send({ error: 'agent_not_found', slug: request.params.slug });
        return reply;
      }
      if (typeof request.body?.enabled !== 'boolean') {
        reply.code(400).send({ error: 'invalid_body', message: 'enabled must be true or false' });
        return reply;
      }
      const on = request.body.enabled;
      await updateManifest(skill, (m) => {
        m['personalize'] = on;
      });
      skill.manifest.personalize = on;
      return { ok: true, personalize: on };
    }
  );

  fastify.get('/agent-templates', async () => (deps.templateDir ? listTemplates(deps.templateDir) : []));

  const newAgentSchema = z.object({
    title: z.string().trim().min(1).max(60),
    focus: z.string().trim().min(1).max(400),
    template: z.string().min(1).default('newsletter-ai'),
    sources: sourcesBodySchema.shape.sources.min(1),
    schedule: z.object({ cron: z.string().min(1), timezone: z.string().min(1) }).optional(),
    model: z.object({ primary: z.enum(MODEL_IDS), fallback: z.enum(MODEL_IDS).optional() }).optional(),
  });

  fastify.post('/agents', async (request, reply) => {
    if (!deps.agentsDir || !deps.templateDir || !deps.addSkill) {
      reply.code(501).send({ error: 'not_supported' });
      return reply;
    }
    const parsed = newAgentSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send({ error: 'invalid_agent', message: errorMessage(parsed.error) });
      return reply;
    }
    const input = parsed.data;
    const available = new Set<string>(knownModelIds().filter((id) => id !== 'static'));
    try {
      for (const spec of input.sources) validateSourceSpec(spec as SourceSpec);
      if (input.schedule) validateSchedule(input.schedule);
      for (const id of [input.model?.primary, input.model?.fallback]) {
        if (id && !available.has(id)) throw new Error(`no adapter for "${id}"`);
      }
      const templates = await listTemplates(deps.templateDir);
      if (!templates.some((t) => t.id === input.template)) throw new Error(`unknown template "${input.template}"`);

      const { slug, dir } = await createAgent({
        input: { ...input, sources: input.sources as SourceSpec[] },
        agentsDir: deps.agentsDir,
        templateDir: join(deps.templateDir, input.template),
      });
      const skill = await loadSkillDir(dir);
      deps.addSkill(skill);
      // Schedules the cron job. No immediate run: spending starts when the
      // reader presses "run" or the schedule fires, not at creation.
      reloadSkill(skill.id, skill, request.log as unknown as typeof logger);
      reply.code(201);
      return { slug, title: skill.title };
    } catch (err) {
      reply.code(400).send({ error: 'invalid_agent', message: errorMessage(err) });
      return reply;
    }
  });

  fastify.put<{ Params: { slug: string }; Body: unknown }>(
    '/agents/:slug/schedule',
    async (request, reply) => {
      const skill = skillList().find((s) => s.id === request.params.slug);
      if (!skill) {
        reply.code(404).send({ error: 'agent_not_found', slug: request.params.slug });
        return reply;
      }
      const parsed = z
        .object({ schedule: z.object({ cron: z.string().min(1), timezone: z.string().min(1) }).nullable() })
        .safeParse(request.body);
      if (!parsed.success || skill.type !== 'proactive') {
        reply.code(400).send({
          error: 'invalid_schedule',
          message: skill.type !== 'proactive' ? 'only proactive agents have a schedule' : errorMessage(parsed.error),
        });
        return reply;
      }
      const schedule = parsed.data.schedule;
      try {
        if (schedule) validateSchedule(schedule);
      } catch (err) {
        reply.code(400).send({ error: 'invalid_schedule', message: errorMessage(err) });
        return reply;
      }

      await updateManifest(skill, (m) => {
        if (schedule) m['schedule'] = { ...(m['schedule'] as object | undefined), ...schedule };
        else delete m['schedule'];
      });
      skill.manifest.schedule = schedule ? { ...skill.manifest.schedule, ...schedule } : undefined;
      reloadSkill(skill.id, skill, request.log as unknown as typeof logger);
      return { ok: true, schedule: skill.manifest.schedule ?? null };
    }
  );

  // ---- Model choice ------------------------------------------------------

  fastify.get('/models', async () =>
    knownModelIds()
      .filter((id) => id !== 'static')
      .map((id) => {
        const keyEnv = MODEL_KEY_ENV[id] ?? null;
        return {
          id,
          keyEnv,
          // Local models need no key.
          keyConfigured: keyEnv ? Boolean(process.env[keyEnv]) : true,
        };
      })
  );

  fastify.get<{ Params: { slug: string } }>('/agents/:slug/model', async (request, reply) => {
    const skill = skillList().find((s) => s.id === request.params.slug);
    if (!skill) {
      reply.code(404).send({ error: 'agent_not_found', slug: request.params.slug });
      return reply;
    }
    return skill.manifest.model;
  });

  const modelBodySchema = z.object({
    primary: z.enum(MODEL_IDS),
    fallback: z.enum(MODEL_IDS).nullable().optional(),
  });

  fastify.put<{ Params: { slug: string }; Body: unknown }>(
    '/agents/:slug/model',
    async (request, reply) => {
      const skill = skillList().find((s) => s.id === request.params.slug);
      if (!skill) {
        reply.code(404).send({ error: 'agent_not_found', slug: request.params.slug });
        return reply;
      }
      const parsed = modelBodySchema.safeParse(request.body);
      const available = new Set<string>(knownModelIds().filter((id) => id !== 'static'));
      const bad = parsed.success
        ? [parsed.data.primary, parsed.data.fallback].find((id) => id && !available.has(id))
        : undefined;
      if (!parsed.success || bad) {
        reply.code(400).send({
          error: 'invalid_model',
          message: bad ? `no adapter for "${bad}"` : errorMessage(parsed.error),
        });
        return reply;
      }
      const { primary, fallback } = parsed.data;

      await updateManifest(skill, (m) => {
        const model = (m['model'] ?? {}) as Record<string, unknown>;
        model['primary'] = primary;
        if (fallback) model['fallback'] = fallback;
        else delete model['fallback'];
        m['model'] = model;
      });
      skill.manifest.model.primary = primary;
      skill.manifest.model.fallback = fallback ?? undefined;
      return { ok: true };
    }
  );

  // Dry run of a source for the sources editor: what would be fetched, and by
  // which method. Perplexity is excluded because a preview would cost money.
  fastify.post('/sources/preview', async (request, reply) => {
    const parsed = sourcesBodySchema.shape.sources.element.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send({ error: 'invalid_source', details: parsed.error.flatten() });
      return reply;
    }
    const spec = parsed.data as SourceSpec;
    if (spec.type !== 'website' && spec.type !== 'rss' && spec.type !== 'arxiv') {
      reply.code(400).send({ error: 'preview_not_available', type: spec.type });
      return reply;
    }
    const ctx = { runId: 'preview', logger: request.log as unknown as Logger };
    try {
      validateSourceSpec(spec);
      if (spec.type === 'website') {
        const r = await new WebsiteFetcher().discover(spec.config as WebsiteConfig, ctx);
        return { ...r, items: r.items.map(previewItem) };
      }
      const items = await resolveFetcher(spec.type)!.fetch(spec.config, ctx);
      return { method: spec.type, candidates: items.length, warnings: [], items: items.map(previewItem) };
    } catch (err) {
      reply.code(400).send({ error: 'invalid_source_config', type: spec.type, message: errorMessage(err) });
      return reply;
    }
  });

  // ---- Votes and the reader profile --------------------------------------

  fastify.put<{ Params: { id: string }; Body: { value?: unknown } }>(
    '/articles/:id/vote',
    async (request, reply) => {
      const value = request.body?.value;
      if (value !== -1 && value !== 0 && value !== 1) {
        reply.code(400).send({ error: 'invalid_body', message: 'value must be -1, 0 (clear) or 1' });
        return reply;
      }
      const exists = await prisma.article.findUnique({ where: { id: request.params.id }, select: { id: true } });
      if (!exists) {
        reply.code(404).send({ error: 'article_not_found', id: request.params.id });
        return reply;
      }
      if (value === 0) {
        await prisma.articleVote.deleteMany({ where: { articleId: request.params.id } });
        return { vote: null };
      }
      await prisma.articleVote.upsert({
        where: { articleId: request.params.id },
        create: { articleId: request.params.id, value },
        update: { value },
      });
      return { vote: value };
    }
  );

  // Exactly what a personalised run sends about the reader, for one agent.
  fastify.get<{ Querystring: { agent?: string } }>('/profile', async (request, reply) => {
    const agent = request.query.agent ? await prisma.agent.findUnique({ where: { slug: request.query.agent } }) : null;
    if (!agent) {
      reply.code(404).send({ error: 'agent_not_found', slug: request.query.agent ?? null });
      return reply;
    }
    return { agent: agent.slug, profile: await buildReaderProfile(agent.id) };
  });

  // Forget the reader's votes for one agent ("reset profile").
  fastify.delete<{ Querystring: { agent?: string } }>('/votes', async (request, reply) => {
    const agent = request.query.agent ? await prisma.agent.findUnique({ where: { slug: request.query.agent } }) : null;
    if (!agent) {
      reply.code(404).send({ error: 'agent_not_found', slug: request.query.agent ?? null });
      return reply;
    }
    const { count } = await prisma.articleVote.deleteMany({ where: { article: { agentRun: { agentId: agent.id } } } });
    return { deleted: count };
  });

  async function loadArticleDetail(id: string) {
    const a = await prisma.article.findUnique({
      where: { id },
      include: { content: true, vote: true, agentRun: { select: { id: true, model: true, startedAt: true } } },
    });
    if (!a) return null;
    // Evidence: the fetched item(s) of the same run that this article rests on.
    const key = a.sourceUrl ? normalizeUrl(a.sourceUrl) : null;
    const snapshots = key
      ? (await prisma.sourceSnapshot.findMany({ where: { agentRunId: a.agentRunId } })).filter(
          (s) => normalizeUrl(s.url) === key
        )
      : [];
    return {
      ...articleSummary(a, 0),
      run: { id: a.agentRun.id, model: a.agentRun.model, startedAt: a.agentRun.startedAt },
      content: a.content
        ? {
            status: a.content.status,
            error: a.content.error,
            finalUrl: a.content.finalUrl,
            title: a.content.title,
            byline: a.content.byline,
            siteName: a.content.siteName,
            lang: a.content.lang,
            fetchedAt: a.content.fetchedAt,
            wordCount: a.content.wordCount,
            readingMinutes: a.content.readingMinutes,
            leadImageId: a.content.leadImageId,
            blocks: parseBlocks(a.content.blocks),
          }
        : null,
      sources: snapshots.map((s) => ({
        sourceType: s.sourceType,
        sourceName: s.sourceName,
        url: s.url,
        title: s.title,
        publishedAt: s.publishedAt,
        fetchedAt: s.fetchedAt,
      })),
    };
  }

  fastify.get<{ Params: { id: string } }>('/articles/:id', async (request, reply) => {
    const detail = await loadArticleDetail(request.params.id);
    if (!detail) {
      reply.code(404).send({ error: 'article_not_found', id: request.params.id });
      return reply;
    }
    return detail;
  });

  // Fetches the original page's text on demand (lazy), caches it, and returns
  // the article. Remote problems come back as content.status, not as an error.
  fastify.post<{ Params: { id: string }; Body: { refresh?: boolean } | undefined }>(
    '/articles/:id/content',
    async (request, reply) => {
      const exists = await prisma.article.findUnique({
        where: { id: request.params.id },
        select: { id: true },
      });
      if (!exists) {
        reply.code(404).send({ error: 'article_not_found', id: request.params.id });
        return reply;
      }
      await ensureArticleContent(request.params.id, {
        refresh: request.body?.refresh === true,
        logger: request.log as unknown as Logger,
      });
      return loadArticleDetail(request.params.id);
    }
  );

  // Cached images. Needs the bearer token like everything else, so the UI
  // fetches them with the header and shows them via blob: URLs.
  fastify.get<{ Params: { id: string } }>('/media/:id', async (request, reply) => {
    const media = await readMedia(request.params.id);
    if (!media) {
      reply.code(404).send({ error: 'media_not_found' });
      return reply;
    }
    reply
      .header('Content-Type', media.mime)
      .header('Cache-Control', 'private, max-age=31536000, immutable')
      .header('Content-Security-Policy', "default-src 'none'; sandbox");
    return reply.send(media.data);
  });

  return fastify;
}

const errorMessage = (err: unknown): string =>
  err instanceof z.ZodError
    ? err.issues.map((i) => `${i.path.join('.') || 'config'}: ${i.message}`).join('; ')
    : err instanceof Error
      ? err.message
      : String(err);

const previewItem = (i: SourceItem) => ({
  title: i.title,
  url: i.url,
  publishedAt: i.publishedAt ?? null,
  sourceName: i.sourceName,
});

type ArticleWithContent = Awaited<
  ReturnType<typeof prisma.article.findMany<{ include: { content: true; vote: true } }>>
>[number];

// Listing shape: metadata plus, for articles whose text is already cached, an
// excerpt. Which article is printed as the lead is the UI's layout decision;
// the lead stories are the ones the core pre-loads after a run.
function articleSummary(a: ArticleWithContent, leadParagraphs: number) {
  const contentOk = a.content?.status === 'ok';
  return {
    id: a.id,
    title: a.title,
    summary: a.summary,
    sourceUrl: a.sourceUrl,
    sourceName: a.sourceName,
    publishedAt: a.publishedAt,
    topic: a.topic,
    importance: a.importance ?? 3,
    importanceReason: a.importanceReason,
    createdAt: a.createdAt,
    // +1 / -1, or null if the reader hasn't voted.
    vote: a.vote?.value ?? null,
    content: a.content
      ? {
          status: a.content.status,
          readingMinutes: a.content.readingMinutes,
          leadImageId: a.content.leadImageId,
        }
      : null,
    excerpt:
      contentOk && leadParagraphs > 0
        ? leadExcerpt(parseBlocks(a.content!.blocks), leadParagraphs)
        : null,
  };
}
