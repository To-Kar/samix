import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/db/prisma.js';
import { runAgent } from '../src/runner/runner.js';
import { registerContentPrefetch } from '../src/content/prefetch.js';
import { logger } from '../src/logger.js';
import { PNG, useFakeNet } from './net.js';
import { fakeAdapter, makeSkill, respond, seedAgent, useAdapter, useRssItems } from './helpers.js';
import type { SourceItem } from '../src/types.js';

const HTML = readFileSync(resolve(import.meta.dirname, 'fixtures/article.html'), 'utf8');
const IMG = { 'content-type': 'image/png' };
const routes: Record<string, { headers: Record<string, string>; body: string | Buffer }> = {
  'https://magazin.example/img/chart.png': { headers: IMG, body: PNG },
  'https://magazin.example/img/hero-large.jpg': { headers: IMG, body: PNG },
};
const items: SourceItem[] = Array.from({ length: 6 }, (_, i) => ({
  url: `https://magazin.example/a${i}`,
  title: `t${i}`,
  sourceName: 'Magazin',
  sourceType: 'rss' as const,
  publishedAt: new Date('2026-10-18T08:00:00Z'),
}));
for (const i of items) routes[i.url] = { headers: { 'content-type': 'text/html' }, body: HTML };
const net = useFakeNet(routes);

describe('content prefetch after a run', () => {
  it('pre-loads only the two most important stories, and a failing fetch never fails the run', async () => {
    registerContentPrefetch(logger);
    useRssItems(items);
    // importance: a3=5, a1=4, others 2 → prefetch a3 and a1.
    const imp = [2, 4, 2, 5, 2];
    const out = JSON.stringify({
      items: items.slice(0, 5).map((it, i) => ({ title: `T${i}`, summary: 's', sourceUrl: it.url, importance: imp[i] })),
    });
    useAdapter(fakeAdapter('claude-haiku-4-5', async () => respond(out)));
    const skill = makeSkill();
    await seedAgent(skill);

    const result = await runAgent({ skill, trigger: 'manual', logger });
    expect(result.status).toBe('success');

    await vi.waitFor(async () => {
      const rows = await prisma.articleContent.findMany({ include: { article: true } });
      expect(rows.map((r) => r.article.sourceUrl).sort()).toEqual([items[1]!.url, items[3]!.url]);
    });
    expect(net.calls.filter((u) => /\/a\d$/.test(u))).toHaveLength(2);
  });
});
