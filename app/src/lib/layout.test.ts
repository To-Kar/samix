import { describe, expect, it } from 'vitest';
import type { EditionArticle } from './api';
import { groupStories, layoutEdition, readingOrder, storySources } from './layout';

const art = (id: string, importance: number): EditionArticle => ({
  id,
  title: id,
  summary: '',
  sourceUrl: null,
  sourceName: null,
  imageId: null,
  publishedAt: null,
  topic: null,
  importance,
  importanceReason: null,
  storyKey: null,
  createdAt: '2026-10-19T00:00:00Z',
  vote: null,
  content: null,
  excerpt: null,
});
const ids = (xs: EditionArticle[]) => xs.map((a) => a.id);

describe('layoutEdition', () => {
  it('is empty for an empty edition', () => {
    expect(layoutEdition([])).toEqual({ lead: [], main: [], brief: [] });
  });

  it('makes the first article the lead even when nothing is rated highly', () => {
    const l = layoutEdition([art('a', 3), art('b', 3), art('c', 1)]);
    expect(ids(l.lead)).toEqual(['a']);
    expect(ids(l.main)).toEqual(['b']);
    expect(ids(l.brief)).toEqual(['c']);
  });

  it('adds a second lead only for importance >= 4', () => {
    expect(ids(layoutEdition([art('a', 5), art('b', 4), art('c', 3)]).lead)).toEqual(['a', 'b']);
    expect(ids(layoutEdition([art('a', 5), art('b', 3), art('c', 3)]).lead)).toEqual(['a']);
  });

  it('never has more than two leads, even if many are rated 5', () => {
    const l = layoutEdition([art('a', 5), art('b', 5), art('c', 5), art('d', 5)]);
    expect(ids(l.lead)).toEqual(['a', 'b']);
    expect(ids(l.main)).toEqual(['c', 'd']);
  });

  it('sends importance 1-2 to the short notices and 3+ to the main grid', () => {
    const l = layoutEdition([art('a', 5), art('b', 3), art('c', 2), art('d', 1), art('e', 4)]);
    expect(ids(l.main)).toEqual(['b', 'e']);
    expect(ids(l.brief)).toEqual(['c', 'd']);
  });

  it('keeps every article exactly once', () => {
    const input = [art('a', 5), art('b', 4), art('c', 3), art('d', 2), art('e', 1), art('f', 3)];
    const l = layoutEdition(input);
    expect([...ids(l.lead), ...ids(l.main), ...ids(l.brief)].sort()).toEqual(ids(input).sort());
  });

  it('gives the reader the page order: lead, then main, then notices', () => {
    const l = layoutEdition([art('a', 5), art('b', 2), art('c', 3)]);
    expect(readingOrder(l)).toEqual(['a', 'c', 'b']);
  });
});

describe('groupStories', () => {
  const story = (id: string, importance: number, key: string | null, source: string): EditionArticle => ({ ...art(id, importance), storyKey: key, sourceName: source });

  it('prints one article per story, in front-page order, and hangs the rest off the first', () => {
    const out = groupStories([story('a', 5, 'derby', 'kicker.de'), story('b', 3, null, 'x.de'), story('c', 3, 'derby', 'sportschau.de'), story('d', 2, 'derby', 'kicker.de')]);
    expect(ids(out)).toEqual(['a', 'b']);
    expect(ids(out[0]!.related ?? [])).toEqual(['c', 'd']);
    expect(out[1]!.related).toBeUndefined();
  });

  it('counts distinct sources, the printed one included', () => {
    const [head] = groupStories([story('a', 5, 'k', 'kicker.de'), story('c', 3, 'k', 'sportschau.de'), story('d', 2, 'k', 'kicker.de')]);
    expect(storySources(head!)).toEqual(['kicker.de', 'sportschau.de']);
    expect(storySources(story('x', 3, null, 'solo.de'))).toEqual(['solo.de']);
  });

  it('does not touch articles without a key, and does not mutate its input', () => {
    const input = [story('a', 3, null, 'a.de'), story('b', 3, null, 'b.de')];
    expect(ids(groupStories(input))).toEqual(['a', 'b']);
    const grouped = [story('a', 3, 'k', 'a.de'), story('b', 3, 'k', 'b.de')];
    groupStories(grouped);
    expect(grouped[0]!.related).toBeUndefined();
  });

  it('keeps the printed articles in reading order and leaves related ones out of it', () => {
    const l = layoutEdition(groupStories([story('a', 5, 'k', 'a.de'), story('b', 3, 'k', 'b.de'), story('c', 3, null, 'c.de')]));
    expect(readingOrder(l)).toEqual(['a', 'c']);
  });
});
