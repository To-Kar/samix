import type { ToolDefinition } from '../types.js';
import { prisma } from '../db/prisma.js';

export const listRecentArticlesTool: ToolDefinition = {
  name: 'list_recent_articles',
  description: 'List recently curated articles from the Samix newspaper. Returns titles, summaries, and source URLs.',
  inputSchema: {
    type: 'object',
    properties: {
      hours: {
        type: 'number',
        description: 'Look back this many hours. Default 24.',
      },
      limit: {
        type: 'number',
        description: 'Maximum articles to return. Default 10.',
      },
    },
  },
  handler: async (input) => {
    const hours = (input.hours as number) || 24;
    const limit = (input.limit as number) || 10;
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const articles = await prisma.article.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    if (articles.length === 0) return 'No articles found in the given time window.';

    return articles
      .map((a) => `- ${a.title}: ${a.summary}${a.sourceUrl ? ` (${a.sourceUrl})` : ''}`)
      .join('\n');
  },
};
