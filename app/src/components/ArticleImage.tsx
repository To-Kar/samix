import { useEffect, useState } from 'react';
import type { ApiClient, Article } from '../lib/api';
import { hostnameOf } from '../lib/articles';
import { useI18n } from '../i18n/I18nProvider';
import { useTheme } from '../theme/ThemeProvider';

// Object URLs of fetched images. Stored images never change, so they are
// kept for the session; the oldest are released past the cap.
const MAX_CACHED = 80;
const cache = new Map<string, Promise<string | null>>();

function imageUrl(api: ApiClient, id: string): Promise<string | null> {
  let entry = cache.get(id);
  if (!entry) {
    entry = api.articleImage(id).then(
      (blob) => URL.createObjectURL(blob),
      () => null
    );
    cache.set(id, entry);
    if (cache.size > MAX_CACHED) {
      const [oldest, url] = cache.entries().next().value as [string, Promise<string | null>];
      cache.delete(oldest);
      void url.then((u) => u && URL.revokeObjectURL(u));
    }
  }
  return entry;
}

type Placement = 'lead' | 'column' | 'reader';

// Written out in full so Tailwind keeps the component classes.
const FIGURE_CLASS: Record<Placement, string> = {
  lead: 'samix-figure samix-figure-lead',
  column: 'samix-figure samix-figure-column',
  reader: 'samix-figure samix-figure-reader',
};

interface ArticleImageProps {
  api: ApiClient;
  article: Article;
  placement: Placement;
}

/**
 * The article's stored image with its origin as credit. Whether it shows at
 * all follows the theme (`images.show`); hidden images are never fetched.
 */
export function ArticleImage({ api, article, placement }: ArticleImageProps) {
  const { resolved } = useTheme();
  const { t } = useI18n();
  const show = resolved.theme.images.show ?? 'always';
  const wanted =
    article.imageSourceUrl !== null && (show === 'always' || (show === 'lead-only' && placement !== 'column'));
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!wanted) return;
    let live = true;
    void imageUrl(api, article.id).then((u) => live && setSrc(u));
    return () => {
      live = false;
    };
  }, [api, article.id, wanted]);

  if (!wanted || !src) return null;
  const captionAlways = placement === 'reader' || resolved.theme.images.captionsAlways;

  return (
    <figure className={FIGURE_CLASS[placement]}>
      {/* The headline carries the meaning; feeds ship no alt text we could trust. */}
      <img src={src} alt="" />
      <figcaption className={captionAlways ? 'samix-hint mt-1' : 'sr-only'}>
        {t.paper.imageCredit(hostnameOf(article.imageSourceUrl!))}
      </figcaption>
    </figure>
  );
}
