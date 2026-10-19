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
  const body = reader
    ? 'text-[1.1rem] leading-[1.75] mb-5'
    : 'text-[0.95rem] leading-[1.6] mb-3';

  return (
    <>
      {blocks.map((b, i) => {
        switch (b.type) {
          case 'paragraph':
            return (
              <p key={i} className={body}>
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
                className={`${body} italic border-l-2 border-rule dark:border-rule-dark pl-4 text-ink-soft dark:text-ink-soft-dark`}
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
                className="mb-5 overflow-x-auto rounded bg-ink/5 dark:bg-ink-dark/10 p-3 text-sm font-mono leading-snug"
              >
                {b.text}
              </pre>
            );
          case 'image':
            return (
              <figure key={i} className="my-6">
                <AuthImage api={api} id={b.mediaId} alt={b.alt} className="w-full h-auto rounded-sm" />
                {b.caption ? (
                  <figcaption className="mt-2 text-sm text-ink-soft dark:text-ink-soft-dark">
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
