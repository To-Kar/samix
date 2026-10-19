import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractArticle } from '../src/content/extract.js';
import { leadExcerpt, wordCountOf } from '../src/content/blocks.js';

const html = readFileSync(resolve(import.meta.dirname, 'fixtures/article.html'), 'utf8');
const URL_ = 'https://magazin.example/ki/modell';

describe('extractArticle', () => {
  const r = extractArticle(html, URL_)!;

  it('finds the headline without the site name, plus byline, site and language', () => {
    expect(r).toMatchObject({
      title: 'Neues Sprachmodell schlägt Benchmark',
      byline: 'Erika Muster',
      siteName: 'Beispiel Magazin',
      lang: 'de',
      leadImageSrc: 'https://magazin.example/img/hero-large.jpg',
    });
  });

  it('keeps the article structure in order', () => {
    expect(r.blocks.map((b) => b.type)).toEqual([
      'paragraph', 'image-ref', 'heading', 'paragraph', 'list', 'quote', 'paragraph', 'code', 'paragraph',
    ]);
    expect(r.blocks[1]).toEqual({
      type: 'image-ref',
      src: 'https://magazin.example/img/chart.png',
      alt: 'Benchmark-Diagramm',
      caption: 'Ergebnisse im Vergleich zu bisherigen Modellen.',
    });
    expect(r.blocks[4]).toEqual({ type: 'list', ordered: false, items: ['Offene Gewichte', 'Lange Kontextfenster', 'Geringer Speicherbedarf'] });
  });

  it('drops the byline paragraph, navigation, cookie banner, scripts, footer and tracking pixels', () => {
    const all = JSON.stringify(r.blocks);
    for (const noise of ['Von Erika Muster', 'Cookies', 'tracking', 'Impressum', 'Das könnte Sie auch', 'R0lGOD']) {
      expect(all).not.toContain(noise);
    }
  });

  it('returns null when there is no article', () => {
    expect(extractArticle('<html><body><nav><a href="/">Home</a></nav></body></html>', URL_)).toBeNull();
  });

  it('never emits raw HTML', () => {
    const evil = `<html><body><article><h1>T</h1><p>${'word '.repeat(60)}<script>alert(1)</script><b onclick="x()">bold</b> <a href="javascript:evil()">link</a></p></article></body></html>`;
    const out = extractArticle(evil, URL_)!;
    const text = JSON.stringify(out.blocks);
    expect(text).not.toMatch(/<\w|onclick|javascript:|alert\(1\)/);
  });
});

describe('blocks helpers', () => {
  const blocks = [
    { type: 'paragraph', text: 'a b c' },
    { type: 'image', mediaId: 'x' },
    { type: 'quote', text: 'd e' },
    { type: 'paragraph', text: 'f' },
    { type: 'list', ordered: false, items: ['g h', 'i'] },
  ] as const;

  it('counts words across block types', () => {
    expect(wordCountOf([...blocks])).toBe(9);
  });

  it('cuts an excerpt by paragraph count and skips images', () => {
    expect(leadExcerpt([...blocks], 1)).toEqual([blocks[0], blocks[2]]);
    expect(leadExcerpt([...blocks], 0)).toEqual([]);
  });
});
