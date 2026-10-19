import { dirname, join } from 'node:path';
import { readFile, writeFile, rename } from 'node:fs/promises';
import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';
import type { Logger } from 'pino';
import { prisma } from './db/prisma.js';
import { runAgent } from './runner/runner.js';
import { reloadSkill } from './scheduler/index.js';
import { leadExcerpt, parseBlocks } from './content/blocks.js';
import { normalizeUrl } from './output/traceability.js';
import { ensureArticleContent } from './content/articleContent.js';
import { readMedia } from './content/media.js';
import { SOURCE_TYPES, type Skill, type SourceItem, type SourceSpec } from './types.js';
import { WebsiteFetcher, type WebsiteConfig } from './sources/website.js';
import { resolveFetcher, validateSourceSpec } from './sources/index.js';

const PKG_VERSION = '0.1.0';

export interface AppDeps {
  token: string;
  logger: Logger;
  // A getter, because the skills are loaded after the app object is built.
  getSkills: () => Skill[];
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
    methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
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
      const skill = skillList().find((s) => s.id === slug);
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

  // ---- Editions: one successful run that produced articles = one edition ----

  const editionsQuery = z.object({
    agent: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  });
  const editionQuery = z.object({
    leadParagraphs: z.coerce.number().int().min(0).max(20).default(4),
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
          ? await prisma.agentRun.findFirst({ where: hasArticles, orderBy: { startedAt: 'desc' } })
          : await prisma.agentRun.findUnique({ where: { id: request.params.id } });
      if (!run) {
        reply.code(404).send({ error: 'edition_not_found', id: request.params.id });
        return reply;
      }

      const [articles, snapshotCount, agent, older, newer, earlier] = await Promise.all([
        prisma.article.findMany({
          where: { agentRunId: run.id },
          include: { content: true },
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

  async function loadArticleDetail(id: string) {
    const a = await prisma.article.findUnique({
      where: { id },
      include: { content: true, agentRun: { select: { id: true, model: true, startedAt: true } } },
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
  ReturnType<typeof prisma.article.findMany<{ include: { content: true } }>>
>[number];

// Listing shape: metadata plus, for lead stories whose text is already
// cached, an excerpt for the front page.
function articleSummary(a: ArticleWithContent, leadParagraphs: number) {
  const isLead = (a.importance ?? 3) >= 4;
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
    content: a.content
      ? {
          status: a.content.status,
          readingMinutes: a.content.readingMinutes,
          leadImageId: a.content.leadImageId,
        }
      : null,
    excerpt:
      isLead && contentOk && leadParagraphs > 0
        ? leadExcerpt(parseBlocks(a.content!.blocks), leadParagraphs)
        : null,
  };
}
