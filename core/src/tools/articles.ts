import { z } from 'zod';
import { ensureArticleContent } from '../content/articleContent.js';
import { parseBlocks, type ContentBlock } from '../content/blocks.js';
import { prisma } from '../db/prisma.js';
import { keywordMatcher, queryTerms } from '../text/keywords.js';
import type { ToolContext, ToolDefinition, ToolResult } from './types.js';

// Read-only tools over the articles Samix has collected (spec §5). Output is
// bounded so no single result can blow the budget.

const SEARCH_WINDOW = 2000; // newest articles considered
const SUMMARY_CHARS = 280;
const DEFAULT_FULLTEXT_CHARS = 4000;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function plainText(blocks: ContentBlock[]): string {
  return blocks
    .map((b) => {
      switch (b.type) {
        case 'list':
          return b.items.join('\n');
        case 'image':
          return '';
        default:
          return b.text;
      }
    })
    .filter(Boolean)
    .join('\n\n');
}

const titleOf = (ctx: ToolContext, slug: string) => ctx.skills.find((s) => s.id === slug)?.title ?? slug;
const json = (value: unknown): string => JSON.stringify(value);
const fail = (message: string): ToolResult => ({ content: json({ error: message }), articleIds: [], resultCount: 0, isError: true });

// ---- list_ressorts ---------------------------------------------------------

const listRessorts: ToolDefinition<Record<string, never>> = {
  spec: {
    name: 'list_ressorts',
    description: 'List the newspaper sections (Ressorts) with how many articles each has collected. Use the returned id as `ressort` in search_articles.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  input: z.object({}).strict() as unknown as z.ZodType<Record<string, never>, z.ZodTypeDef, unknown>,
  async run(_input, ctx) {
    const agents = await prisma.agent.findMany({ where: { type: 'proactive' }, orderBy: { slug: 'asc' } });
    const out = await Promise.all(
      agents.map(async (a) => ({
        id: a.slug,
        title: titleOf(ctx, a.slug),
        articles: await prisma.article.count({ where: { agentRun: { agentId: a.id } } }),
      }))
    );
    return { content: json(out), articleIds: [], resultCount: out.length };
  },
};

// ---- search_articles -------------------------------------------------------

const searchInput = z.object({
  query: z.string().trim().min(1).max(200),
  ressort: z.string().trim().min(1).max(80).optional(),
  since: z
    .string()
    .refine((v) => Number.isFinite(Date.parse(v)), 'must be a parseable date (e.g. 2026-10-01)')
    .optional(),
  limit: z.number().int().min(1).max(10).default(5),
});

const searchArticles: ToolDefinition<z.infer<typeof searchInput>> = {
  spec: {
    name: 'search_articles',
    description:
      'Keyword search over the articles Samix has collected (titles, summaries, topics and cached full texts). Whole words, case-insensitive. Returns short summaries with an articleId; use get_article for details. If nothing matches, try other words.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words to look for, e.g. "offene Sprachmodelle"' },
        ressort: { type: 'string', description: 'Optional Ressort id from list_ressorts' },
        since: { type: 'string', description: 'Optional: only articles published on/after this date (YYYY-MM-DD)' },
        limit: { type: 'integer', minimum: 1, maximum: 10, description: 'Max results (default 5)' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  input: searchInput,
  async run(input, ctx) {
    const terms = queryTerms(input.query);
    if (terms.length === 0) return fail('the query contains no searchable words');
    const matchers = terms.map((t) => keywordMatcher([t]));
    const since = input.since ? new Date(input.since) : undefined;

    const rows = await prisma.article.findMany({
      where: {
        ...(input.ressort ? { agentRun: { agent: { slug: input.ressort } } } : {}),
        ...(since ? { OR: [{ publishedAt: { gte: since } }, { publishedAt: null, createdAt: { gte: since } }] } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: SEARCH_WINDOW,
      include: {
        content: { select: { status: true, blocks: true } },
        agentRun: { select: { agent: { select: { slug: true } } } },
      },
    });

    const scored = rows
      .map((a) => {
        const body = a.content?.status === 'ok' ? plainText(parseBlocks(a.content.blocks)) : '';
        let score = 0;
        let matched = 0;
        const hitTerms: string[] = [];
        matchers.forEach((m, i) => {
          const inTitle = m(a.title);
          const inTopic = a.topic ? m(a.topic) : false;
          const inSummary = m(a.summary);
          const inBody = body ? m(body) : false;
          const s = (inTitle ? 3 : 0) + (inTopic ? 2 : 0) + (inSummary ? 2 : 0) + (inBody ? 1 : 0);
          if (s > 0) {
            score += s;
            matched++;
            hitTerms.push(terms[i]!);
          }
        });
        if (matched === 0) return null;
        if (matched === terms.length) score += 5; // all words present beats many hits of one
        return { a, score, hitTerms, hasFullText: body.length > 0 };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      // Rows are already newest first, and sort is stable: ties stay recent-first.
      .sort((x, y) => y.score - x.score)
      .slice(0, input.limit);

    const items = scored.map(({ a, hitTerms, hasFullText }) => ({
      articleId: a.id,
      title: a.title,
      summary: clip(a.summary, SUMMARY_CHARS),
      source: a.sourceName,
      url: a.sourceUrl,
      publishedAt: (a.publishedAt ?? a.createdAt).toISOString().slice(0, 10),
      ressort: titleOf(ctx, a.agentRun.agent.slug),
      matched: hitTerms,
      hasFullText,
    }));
    return {
      content: json(items.length ? items : { results: [], note: 'no matching articles in the collection' }),
      articleIds: items.map((i) => i.articleId),
      resultCount: items.length,
    };
  },
};

// ---- get_article / fetch_full_text ----------------------------------------

const articleInput = z.object({
  articleId: z.string().trim().min(1).max(100),
  maxChars: z.number().int().min(500).max(8000).default(DEFAULT_FULLTEXT_CHARS),
});

async function describeArticle(articleId: string, maxChars: number, ctx: ToolContext): Promise<ToolResult> {
  const a = await prisma.article.findUnique({
    where: { id: articleId },
    include: { content: true, agentRun: { select: { agent: { select: { slug: true } } } } },
  });
  if (!a) return fail(`no article with id "${articleId}" (use an articleId from search_articles)`);

  const full = a.content?.status === 'ok' ? plainText(parseBlocks(a.content.blocks)) : '';
  return {
    content: json({
      articleId: a.id,
      title: a.title,
      summary: a.summary,
      whyItMatters: a.importanceReason,
      topic: a.topic,
      source: a.sourceName,
      url: a.sourceUrl,
      publishedAt: (a.publishedAt ?? a.createdAt).toISOString().slice(0, 10),
      ressort: titleOf(ctx, a.agentRun.agent.slug),
      fullText: full ? clip(full, maxChars) : null,
      fullTextTruncated: full.length > maxChars,
      fullTextStatus: a.content ? (a.content.status === 'ok' ? 'available' : `unavailable (${a.content.error ?? a.content.status})`) : 'not fetched yet',
    }),
    articleIds: [a.id],
    resultCount: 1,
  };
}

const getArticle: ToolDefinition<z.infer<typeof articleInput>> = {
  spec: {
    name: 'get_article',
    description:
      'Details of one collected article: summary, source, date and — if already cached — the beginning of its full text. Does not go online. If fullTextStatus is "not fetched yet" and you need the text, call fetch_full_text.',
    inputSchema: {
      type: 'object',
      properties: {
        articleId: { type: 'string', description: 'An articleId returned by search_articles' },
        maxChars: { type: 'integer', minimum: 500, maximum: 8000, description: 'Max characters of full text (default 4000)' },
      },
      required: ['articleId'],
      additionalProperties: false,
    },
  },
  input: articleInput,
  run: (input, ctx) => describeArticle(input.articleId, input.maxChars, ctx),
};

const fetchFullText: ToolDefinition<z.infer<typeof articleInput>> = {
  spec: {
    name: 'fetch_full_text',
    description:
      'Download and read the full text of a collected article from its original page (only for articles already in the collection; you pass an articleId, never a URL). Limited to a few calls per question. Returns the same fields as get_article.',
    inputSchema: {
      type: 'object',
      properties: {
        articleId: { type: 'string', description: 'An articleId returned by search_articles' },
        maxChars: { type: 'integer', minimum: 500, maximum: 8000, description: 'Max characters of full text (default 4000)' },
      },
      required: ['articleId'],
      additionalProperties: false,
    },
  },
  input: articleInput,
  async run(input, ctx) {
    const exists = await prisma.article.findUnique({ where: { id: input.articleId }, select: { id: true } });
    if (!exists) return fail(`no article with id "${input.articleId}" (use an articleId from search_articles)`);
    if (ctx.allowance.fullTextFetches <= 0) {
      return fail('the limit for downloading full texts in one question is used up; answer from what you have');
    }
    ctx.allowance.fullTextFetches--;
    await ensureArticleContent(input.articleId, { logger: ctx.logger });
    return describeArticle(input.articleId, input.maxChars, ctx);
  },
};

export const ARTICLE_TOOLS: ToolDefinition<never>[] = [
  listRessorts as ToolDefinition<never>,
  searchArticles as ToolDefinition<never>,
  getArticle as ToolDefinition<never>,
  fetchFullText as ToolDefinition<never>,
];
