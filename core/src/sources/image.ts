// Finds the image a feed item itself declares. Only what the source ships
// is used — no page scraping, no guessing — so every picture stays
// traceable to the feed it came from.

type Raw = Record<string, unknown>;

const obj = (v: unknown): Raw | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : undefined);
const arr = (v: unknown): Raw[] => (Array.isArray(v) ? v.map(obj).filter((x): x is Raw => !!x) : []);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

const isImageType = (type: unknown) => typeof type === 'string' && type.toLowerCase().startsWith('image/');

/** Absolute http(s) URL or undefined. */
export function httpUrl(value: unknown): string | undefined {
  const s = str(value);
  if (!s) return undefined;
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

// Media RSS: <media:content medium="image"> or type image/*, also inside <media:group>.
function mediaContent(media: Raw | undefined): string | undefined {
  if (!media) return undefined;
  const contents = [...arr(media.contents), ...arr(media.groups).flatMap((g) => arr(g.contents))];
  const image = contents.find((c) => c.medium === 'image' || isImageType(c.type));
  return httpUrl(image?.url) ?? httpUrl(arr(media.thumbnails)[0]?.url);
}

const IMG_SRC = /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/i;

function firstImgInHtml(...html: unknown[]): string | undefined {
  for (const h of html) {
    const s = str(h);
    const m = s ? IMG_SRC.exec(s) : null;
    const url = m?.[1] ? httpUrl(m[1].replace(/&amp;/g, '&')) : undefined;
    if (url) return url;
  }
  return undefined;
}

/**
 * Image URL of a parsed feed item (RSS, Atom, RDF or JSON Feed as returned
 * by feedsmith), in order of how explicitly the feed marks it as the image.
 */
export function pickImageUrl(raw: unknown): string | undefined {
  const item = obj(raw);
  if (!item) return undefined;
  const content = obj(item.content);
  return (
    mediaContent(obj(item.media)) ??
    httpUrl(arr(item.enclosures).find((e) => isImageType(e.type))?.url) ??
    httpUrl(arr(item.links).find((l) => l.rel === 'enclosure' && isImageType(l.type))?.href) ??
    httpUrl(obj(item.itunes)?.image) ??
    httpUrl(item.image) ?? // JSON Feed
    httpUrl(item.banner_image) ??
    firstImgInHtml(content?.encoded, typeof item.content === 'string' ? item.content : undefined, item.description, item.summary)
  );
}
