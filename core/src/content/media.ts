import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ensureDatabaseUrl, sqlitePathFromUrl } from '../db/paths.js';
import { safeFetch } from '../net/safeFetch.js';

// Images are downloaded by the core and served from the loopback API, so the
// WebView never talks to third-party hosts (no tracking pixels, strict CSP).
// Files are content-addressed: <sha256>.<ext>.

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// SVG is deliberately absent: it can carry script.
const TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
} as const;
type Ext = keyof typeof TYPES;

export function mediaDir(): string {
  return (
    process.env.SAMIX_MEDIA_DIR ?? join(dirname(sqlitePathFromUrl(ensureDatabaseUrl())), 'media')
  );
}

// Decide the type from the bytes, never from the server's Content-Type.
export function sniffImage(buf: Buffer): Ext | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.subarray(0, 6).toString('latin1'))) return 'gif';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

const ID_RE = /^[a-f0-9]{64}$/;
export const isMediaId = (id: string): boolean => ID_RE.test(id);

export async function storeImage(url: string): Promise<string> {
  const res = await safeFetch(url, {
    maxBytes: MAX_IMAGE_BYTES,
    timeoutMs: 15_000,
    accept: 'image/png,image/jpeg,image/gif,image/webp',
  });
  const ext = sniffImage(res.body);
  if (!ext) throw new Error('not a supported image');
  const id = createHash('sha256').update(res.body).digest('hex');
  const dir = mediaDir();
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${id}.${ext}`);
  if (!existsSync(path)) await writeFile(path, res.body);
  return id;
}

export async function readMedia(id: string): Promise<{ data: Buffer; mime: string } | null> {
  if (!isMediaId(id)) return null; // also rules out path traversal
  for (const ext of Object.keys(TYPES) as Ext[]) {
    const path = join(mediaDir(), `${id}.${ext}`);
    if (existsSync(path)) return { data: await readFile(path), mime: TYPES[ext] };
  }
  return null;
}

// Deletes media files that no remaining article refers to. Files younger than
// `graceMs` are kept so an extraction in flight isn't undercut.
export async function collectUnreferencedMedia(
  referenced: Set<string>,
  graceMs = 24 * 60 * 60 * 1000
): Promise<number> {
  const dir = mediaDir();
  if (!existsSync(dir)) return 0;
  let removed = 0;
  for (const name of await readdir(dir)) {
    const id = name.split('.')[0] ?? '';
    if (!isMediaId(id) || referenced.has(id)) continue;
    const path = join(dir, name);
    if (Date.now() - (await stat(path)).mtimeMs < graceMs) continue;
    await unlink(path);
    removed++;
  }
  return removed;
}
