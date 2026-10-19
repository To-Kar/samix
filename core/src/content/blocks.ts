// Structured article content. Extracted pages are reduced to these blocks and
// the UI renders them as React elements — raw HTML from the web never reaches
// the WebView. Inline markup (links, bold) is deliberately flattened to text.

export type ContentBlock =
  | { type: 'heading'; level: 2 | 3 | 4; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'quote'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'code'; text: string }
  | { type: 'image'; mediaId: string; alt?: string; caption?: string };

export function parseBlocks(json: string | null | undefined): ContentBlock[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? (v as ContentBlock[]) : [];
  } catch {
    return [];
  }
}

// The opening of an article for the front page: the first `paragraphs`
// paragraphs (plus headings/quotes between them), no images.
export function leadExcerpt(blocks: ContentBlock[], paragraphs: number): ContentBlock[] {
  const out: ContentBlock[] = [];
  let seen = 0;
  for (const b of blocks) {
    if (b.type === 'image' || b.type === 'code') continue;
    if (b.type === 'paragraph') {
      if (seen >= paragraphs) break;
      seen++;
    }
    out.push(b);
  }
  return out;
}

export function wordCountOf(blocks: ContentBlock[]): number {
  const text = blocks
    .map((b) => {
      switch (b.type) {
        case 'list':
          return b.items.join(' ');
        case 'image':
          return '';
        default:
          return b.text;
      }
    })
    .join(' ');
  return text.split(/\s+/).filter(Boolean).length;
}
