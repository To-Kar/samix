import type { ApiClient, ContentBlock } from '../lib/api';
import { AuthImage } from './AuthImage';

// Renders structured article blocks as React elements. Everything is plain
// text: nothing from a web page is ever interpreted as markup.

interface Props {
  blocks: ContentBlock[];
  api: ApiClient;
  /** `excerpt` = compact, for the front page; `reader` = full reading size. */
  variant: 'excerpt' | 'reader';
}

export function Blocks({ blocks, api, variant }: Props) {
  const reader = variant === 'reader';
  // In the reader, size, leading and paragraph style come from the theme
  // (.samix-prose on the container); paragraphs space or indent by its rule.
  const body = reader ? 'mb-[0.75em]' : 'text-[0.95rem] leading-[1.6] mb-3';
  const paragraph = reader ? '' : body;

  return (
    <>
      {blocks.map((b, i) => {
        switch (b.type) {
          case 'paragraph':
            return (
              <p key={i} className={paragraph}>
                {b.text}
              </p>
            );
          case 'heading':
            return (
              <h3
                key={i}
                className={
                  reader
                    ? 'font-bold text-2xl leading-snug mt-9 mb-3'
                    : 'font-bold text-base leading-snug mt-2 mb-1 break-after-avoid'
                }
              >
                {b.text}
              </h3>
            );
          case 'quote':
            return (
              <blockquote
                key={i}
                className={`${body} italic border-l-2 border-rule pl-4 text-ink-soft`}
              >
                {b.text}
              </blockquote>
            );
          case 'list': {
            const List = b.ordered ? 'ol' : 'ul';
            return (
              <List
                key={i}
                className={`${body} ${b.ordered ? 'list-decimal' : 'list-disc'} pl-6 space-y-1`}
              >
                {b.items.map((item, j) => (
                  <li key={j}>{item}</li>
                ))}
              </List>
            );
          }
          case 'code':
            return (
              <pre
                key={i}
                className="mb-5 overflow-x-auto rounded bg-ink/5 p-3 text-sm font-mono leading-snug"
              >
                {b.text}
              </pre>
            );
          case 'image':
            return (
              <figure key={i} className="my-6">
                <AuthImage api={api} id={b.mediaId} alt={b.alt} className="w-full h-auto rounded-sm" />
                {b.caption ? (
                  <figcaption className="mt-2 text-sm text-ink-soft">
                    {b.caption}
                  </figcaption>
                ) : null}
              </figure>
            );
        }
      })}
    </>
  );
}
