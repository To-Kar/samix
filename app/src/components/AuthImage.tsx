import { useEffect, useState } from 'react';
import type { ApiClient } from '../lib/api';

// <img> can't send the bearer token, so images are fetched with it and shown
// via blob: URLs. Kept for the session; they are small and re-used across the
// front page and the reader.
const cache = new Map<string, Promise<string>>();

function load(api: ApiClient, id: string): Promise<string> {
  let p = cache.get(id);
  if (!p) {
    p = api.fetchMedia(id).then((blob) => URL.createObjectURL(blob));
    cache.set(id, p);
    p.catch(() => cache.delete(id)); // allow a retry later
  }
  return p;
}

interface Props {
  api: ApiClient;
  id: string;
  alt?: string;
  className?: string;
  /** A lead or teaser photo: takes the theme's treatment (greyscale, sepia …).
   *  Pictures inside the article text stay untouched — they may be charts. */
  photo?: boolean;
}

export function AuthImage({ api, id, alt, className, photo }: Props) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setSrc(null);
    setFailed(false);
    load(api, id).then(
      (url) => live && setSrc(url),
      () => live && setFailed(true)
    );
    return () => {
      live = false;
    };
  }, [api, id]);

  if (failed) return null;
  if (!src) return <div className={`${className ?? ''} bg-ink/5 animate-pulse`} aria-hidden />;
  return <img src={src} alt={alt ?? ''} className={photo ? `samix-photo ${className ?? ''}` : className} loading="lazy" />;
}
