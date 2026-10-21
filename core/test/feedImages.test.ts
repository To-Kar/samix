import { describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/db/prisma.js';
import { runAgent } from '../src/runner/runner.js';
import { registerFeedImages } from '../src/content/feedImages.js';
import { pickImageUrl } from '../src/sources/image.js';
import { logger } from '../src/logger.js';
import { PNG, useFakeNet } from './net.js';
import { fakeAdapter, makeSkill, respond, seedAgent, useAdapter, useRssItems } from './helpers.js';
import type { SourceItem } from '../src/types.js';

const net = useFakeNet({
  'https://magazin.example/img/a.png': { headers: { 'content-type': 'image/png' }, body: PNG },
  'https://magazin.example/img/fake.png': { headers: { 'content-type': 'image/png' }, body: 'not an image' },
});

const items: SourceItem[] = [
  { url: 'https://magazin.example/a', imageUrl: 'https://magazin.example/img/a.png' },
  { url: 'https://magazin.example/b', imageUrl: 'https://magazin.example/img/fake.png' },
  { url: 'https://magazin.example/c', imageUrl: 'http://127.0.0.1:11434/private.png' },
  { url: 'https://magazin.example/d' },
  { url: 'https://magazin.example/e' },
].map((i) => ({
  ...i,
  title: 't',
  sourceName: 'Magazin',
  sourceType: 'rss' as const,
  publishedAt: new Date('2026-10-18T08:00:00Z'),
}));

describe('feed images', () => {
  it('stores the declared image in the media store; bad or private ones are skipped without failing the run', async () => {
    registerFeedImages(logger);
    useRssItems(items);
    const out = JSON.stringify({
      items: items.map((it, i) => ({ title: `T${i}`, summary: 's', sourceUrl: it.url, importance: 3 })),
    });
    useAdapter(fakeAdapter('claude-haiku-4-5', async () => respond(out)));
    const skill = makeSkill();
    await seedAgent(skill);

    const result = await runAgent({ skill, trigger: 'manual', logger });
    expect(result.status).toBe('success');

    await vi.waitFor(async () => {
      const a = await prisma.article.findFirst({ where: { sourceUrl: items[0]!.url } });
      expect(a?.imageId).toMatch(/^[a-f0-9]{64}$/);
    });
    const rows = await prisma.article.findMany({ orderBy: { sourceUrl: 'asc' } });
    expect(rows.map((r) => r.imageUrl)).toEqual(items.map((i) => i.imageUrl ?? null));
    expect(rows.map((r) => r.imageId !== null)).toEqual([true, false, false, false, false]);
    expect(net.calls.some((u) => u.includes('127.0.0.1'))).toBe(false);
  });
});

describe('pickImageUrl', () => {
  it('prefers explicit feed markup over images in the item HTML', () => {
    expect(
      pickImageUrl({
        media: { contents: [{ url: 'https://x.example/m.jpg', medium: 'image' }] },
        description: '<img src="https://x.example/inline.jpg">',
      })
    ).toBe('https://x.example/m.jpg');
    expect(pickImageUrl({ enclosures: [{ url: 'https://x.example/e.png', type: 'image/png' }] })).toBe('https://x.example/e.png');
    expect(pickImageUrl({ description: '<p><img src="https://x.example/i.jpg?a=1&amp;b=2"></p>' })).toBe('https://x.example/i.jpg?a=1&b=2');
  });

  it('ignores non-http(s) and non-image enclosures', () => {
    expect(pickImageUrl({ description: '<img src="data:image/png;base64,AAAA">' })).toBeUndefined();
    expect(pickImageUrl({ enclosures: [{ url: 'https://x.example/a.mp3', type: 'audio/mpeg' }] })).toBeUndefined();
    expect(pickImageUrl(null)).toBeUndefined();
  });
});
