import type { FetchContext, SourceItem } from '../types.js';
import { prisma } from '../db/prisma.js';

export interface DbArticlesConfig {
  hours_back?: number;
  limit?: number;
}

export class DbArticlesFetcher {
  readonly type = 'db_articles' as const;

  async fetch(config: DbArticlesConfig, ctx: FetchContext): Promise<SourceItem[]> {
    const hoursBack = config.hours_back ?? 24;
    const limit = config.limit ?? 20;
    const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000);

    const articles = await prisma.article.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return articles.map((a) => ({
      url: a.sourceUrl ?? '',
      title: a.title,
      snippet: a.summary,
      publishedAt: a.publishedAt ?? a.createdAt,
      sourceName: 'db_articles',
    }));
  }
}
