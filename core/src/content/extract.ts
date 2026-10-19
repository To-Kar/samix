import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import type { ContentBlock } from './blocks.js';

// Page HTML in, structured blocks out. No network here; images are returned
// as references and downloaded by the caller (articleContent.ts).

export type RawBlock =
  | Exclude<ContentBlock, { type: 'image' }>
  | { type: 'image-ref'; src: string; alt?: string; caption?: string };

export interface ExtractedArticle {
  title?: string;
  byline?: string;
  siteName?: string;
  lang?: string;
  leadImageSrc?: string;
  blocks: RawBlock[];
}

const MAX_BLOCKS = 400;

export function extractArticle(html: string, pageUrl: string): ExtractedArticle | null {
  const { document } = parseHTML(html);

  const lang = document.documentElement?.getAttribute('lang') ?? undefined;
  const leadImageSrc = resolve(
    document.querySelector('meta[property="og:image"]')?.getAttribute('content') ??
      document.querySelector('meta[name="twitter:image"]')?.getAttribute('content') ??
      undefined,
    pageUrl
  );

  // The page's own headline beats <title>, which usually carries the site name.
  const headline = clean(
    document.querySelector('h1')?.textContent ??
      document.querySelector('meta[property="og:title"]')?.getAttribute('content')
  );

  // Readability mutates the document it is given; we are done with it after.
  const parsed = new Readability(document as unknown as Document, {
    charThreshold: 150,
  }).parse();
  if (!parsed?.content) return null;

  const { document: body } = parseHTML(`<div id="root">${parsed.content}</div>`);
  const root = body.getElementById('root');
  if (!root) return null;

  const blocks: RawBlock[] = [];
  walk(root as unknown as El, blocks, pageUrl);

  // The author line sometimes survives as the first paragraph.
  const byline = clean(parsed.byline);
  const first = blocks[0];
  if (byline && first?.type === 'paragraph' && first.text.length < 120 && first.text.includes(byline)) {
    blocks.shift();
  }

  if (blocks.length === 0) return null;

  return {
    title: headline ?? clean(parsed.title),
    byline,
    siteName: clean(parsed.siteName),
    lang: clean(parsed.lang) ?? lang,
    leadImageSrc,
    blocks: blocks.slice(0, MAX_BLOCKS),
  };
}

type El = {
  tagName?: string;
  childNodes: Iterable<El & { nodeType: number; textContent: string | null }>;
  textContent: string | null;
  getAttribute(name: string): string | null;
  querySelector(sel: string): El | null;
  querySelectorAll(sel: string): Iterable<El>;
};

const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'FORM', 'BUTTON', 'SVG', 'NAV', 'ASIDE']);

function walk(node: El, out: RawBlock[], pageUrl: string): void {
  for (const child of node.childNodes) {
    if (child.nodeType === 3) {
      // Bare text directly inside a container.
      const text = clean(child.textContent);
      if (text && text.length > 1) out.push({ type: 'paragraph', text });
      continue;
    }
    if (child.nodeType !== 1) continue;
    const tag = (child.tagName ?? '').toUpperCase();
    if (SKIP.has(tag)) continue;

    switch (tag) {
      case 'H1':
      case 'H2':
        pushText(out, 'heading', child, 2);
        break;
      case 'H3':
        pushText(out, 'heading', child, 3);
        break;
      case 'H4':
      case 'H5':
      case 'H6':
        pushText(out, 'heading', child, 4);
        break;
      case 'P': {
        // A paragraph that only wraps an image is an image.
        const img = child.querySelector('img');
        const text = clean(child.textContent);
        if (img && !text) pushImage(out, img, undefined, pageUrl);
        else if (text) out.push({ type: 'paragraph', text });
        break;
      }
      case 'BLOCKQUOTE': {
        const text = clean(child.textContent);
        if (text) out.push({ type: 'quote', text });
        break;
      }
      case 'UL':
      case 'OL': {
        const items = [...child.querySelectorAll('li')]
          .map((li) => clean(li.textContent))
          .filter((t): t is string => !!t);
        if (items.length) out.push({ type: 'list', ordered: tag === 'OL', items });
        break;
      }
      case 'PRE': {
        const text = (child.textContent ?? '').replace(/\s+$/, '');
        if (text.trim()) out.push({ type: 'code', text });
        break;
      }
      case 'FIGURE': {
        const img = child.querySelector('img');
        const caption = clean(child.querySelector('figcaption')?.textContent);
        if (img) pushImage(out, img, caption, pageUrl);
        else if (caption) out.push({ type: 'paragraph', text: caption });
        break;
      }
      case 'IMG':
        pushImage(out, child, undefined, pageUrl);
        break;
      case 'TABLE': {
        // Tables don't fit a calm reading column; keep the content as rows.
        for (const row of child.querySelectorAll('tr')) {
          const cells = [...row.querySelectorAll('th,td')]
            .map((c) => clean(c.textContent))
            .filter((t): t is string => !!t);
          if (cells.length) out.push({ type: 'paragraph', text: cells.join(' · ') });
        }
        break;
      }
      default:
        walk(child, out, pageUrl);
    }
  }
}

function pushText(out: RawBlock[], kind: 'heading', el: El, level: 2 | 3 | 4): void {
  const text = clean(el.textContent);
  if (text) out.push({ type: kind, level, text });
}

function pushImage(out: RawBlock[], img: El, caption: string | undefined, pageUrl: string): void {
  const src = resolve(
    img.getAttribute('src') ?? img.getAttribute('data-src') ?? firstSrcset(img.getAttribute('srcset')),
    pageUrl
  );
  if (!src) return;
  const alt = clean(img.getAttribute('alt'));
  out.push({ type: 'image-ref', src, alt, caption });
}

function firstSrcset(srcset: string | null): string | undefined {
  return srcset?.split(',')[0]?.trim().split(/\s+/)[0];
}

// Absolute http(s) URL or undefined. data: URIs and junk are dropped.
function resolve(raw: string | undefined | null, base: string): string | undefined {
  if (!raw) return undefined;
  try {
    const u = new URL(raw.trim(), base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

function clean(s: string | null | undefined): string | undefined {
  const t = s?.replace(/\s+/g, ' ').trim();
  return t ? t : undefined;
}
