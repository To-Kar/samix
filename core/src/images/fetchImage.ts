// Downloads one article image during a run. Feed content is untrusted, so:
// http(s) only, no private/loopback targets (checked on every redirect hop),
// raster formats only (no SVG — it can carry script), a hard size cap, and
// the stored type comes from the file's own signature, not the server's word.

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { Logger } from 'pino';

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;
const UA = 'samix/0.1 (+https://samix.app)';

export interface FetchedImage {
  mimeType: string;
  bytes: Uint8Array;
}

export async function fetchImage(url: string, log: Logger): Promise<FetchedImage | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let target = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const why = await refuseTarget(target);
      if (why) {
        log.warn({ url: target, why }, 'image_target_refused');
        return null;
      }
      const res = await fetch(target, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'User-Agent': UA, Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif' },
      });
      if (res.status >= 300 && res.status < 400) {
        const next = res.headers.get('location');
        if (!next) return null;
        target = new URL(next, target).toString();
        continue;
      }
      if (!res.ok || !res.body) {
        log.warn({ url: target, status: res.status }, 'image_fetch_http_error');
        return null;
      }
      const declared = Number(res.headers.get('content-length') ?? 0);
      if (declared > MAX_IMAGE_BYTES) {
        log.warn({ url: target, bytes: declared }, 'image_too_large');
        return null;
      }
      const bytes = await readCapped(res.body, MAX_IMAGE_BYTES);
      if (!bytes) {
        log.warn({ url: target }, 'image_too_large');
        return null;
      }
      const mimeType = sniffImageType(bytes);
      if (!mimeType) {
        log.warn({ url: target, declared: res.headers.get('content-type') }, 'image_not_a_raster_image');
        return null;
      }
      return { mimeType, bytes };
    }
    log.warn({ url }, 'image_too_many_redirects');
    return null;
  } catch (err) {
    log.warn({ url, err: err instanceof Error ? err.message : String(err) }, 'image_fetch_failed');
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function readCapped(body: ReadableStream<Uint8Array>, cap: number): Promise<Uint8Array | null> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/** Raster image type from the file signature, or null. */
export function sniffImageType(b: Uint8Array): string | null {
  const ascii = (start: number, end: number) => String.fromCharCode(...b.subarray(start, end));
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && ascii(1, 4) === 'PNG' && b[0] === 0x89) return 'image/png';
  if (b.length >= 6 && (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a')) return 'image/gif';
  if (b.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (b.length >= 12 && ascii(4, 8) === 'ftyp' && ['avif', 'avis'].includes(ascii(8, 12))) return 'image/avif';
  return null;
}

/** Reason to refuse a URL as fetch target, or null when it may be fetched. */
async function refuseTarget(raw: string): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'invalid_url';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'protocol';
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return 'local_host';
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (addresses.length === 0) return 'unresolvable';
  return addresses.some(isPrivateAddress) ? 'private_address' : null;
}

/** Loopback, private, link-local, CGNAT, unspecified and multicast ranges (v4 and v6). */
export function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a = 0, b = 0] = address.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  const v6 = address.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
  if (mapped?.[1]) return isPrivateAddress(mapped[1]);
  return v6 === '::' || v6 === '::1' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || v6.startsWith('ff');
}
