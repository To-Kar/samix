import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

// Fetches URLs that come from third-party content (feed items, page links,
// image tags). Those URLs are attacker-influenced, so before every hop —
// including redirects — the host must resolve to a public address. Otherwise
// a feed entry could make the core read http://127.0.0.1:11434 (Ollama), a
// router admin page or a cloud metadata endpoint and show the result.
//
// Known limit: the address is checked, then fetch() resolves the name again,
// so a DNS-rebinding server could still answer differently the second time.
// Closing that needs a pinned-IP dispatcher; accepted for a single-user,
// loopback-only app, and recorded here so it isn't forgotten.

export const USER_AGENT = 'samix/0.1 (+https://samix.app)';

export type SafeFetchErrorCode =
  | 'bad_url'
  | 'blocked_host'
  | 'http_error'
  | 'too_large'
  | 'timeout'
  | 'network'
  | 'bad_content_type'
  | 'too_many_redirects';

export class SafeFetchError extends Error {
  constructor(
    readonly code: SafeFetchErrorCode,
    message?: string,
    readonly status?: number
  ) {
    super(message ?? code);
    this.name = 'SafeFetchError';
  }
}

// Replaceable in tests, so no real DNS or network is needed.
export const netDeps = {
  lookup: async (host: string): Promise<string[]> =>
    (await dnsLookup(host, { all: true })).map((a) => a.address),
  fetch: (url: string, init: RequestInit): Promise<Response> => fetch(url, init),
};

export function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return isPrivateV4(ip);
  if (v === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::' || lower === '::1') return true;
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped?.[1]) return isPrivateV4(mapped[1]);
    // ::ffff:7f00:1 style (hex-form mapped IPv4)
    const hexMapped = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hexMapped?.[1] && hexMapped[2]) {
      const hi = parseInt(hexMapped[1], 16);
      const lo = parseInt(hexMapped[2], 16);
      return isPrivateV4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    const first = parseInt(lower.split(':')[0] || '0', 16);
    if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast
    return false;
  }
  return true; // not an IP at all: treat as unsafe
}

function isPrivateV4(ip: string): boolean {
  const [a = 0, b = 0, c = 0] = ip.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224 // multicast, reserved, broadcast
  );
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new SafeFetchError('bad_url', `not a URL: ${raw}`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new SafeFetchError('bad_url', `unsupported scheme ${u.protocol}`);
  }
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    throw new SafeFetchError('blocked_host', `${host} is not a public host`);
  }
  const addresses = isIP(host) ? [host] : await netDeps.lookup(host).catch(() => []);
  if (addresses.length === 0) {
    throw new SafeFetchError('network', `could not resolve ${host}`);
  }
  if (addresses.some(isPrivateIp)) {
    throw new SafeFetchError('blocked_host', `${host} resolves to a non-public address`);
  }
  return u;
}

export interface SafeFetchOptions {
  maxBytes: number;
  timeoutMs?: number;
  accept?: string;
  // Rejects responses whose Content-Type doesn't match.
  contentType?: RegExp;
  maxRedirects?: number;
}

export interface SafeFetchResult {
  finalUrl: string;
  status: number;
  contentType: string;
  body: Buffer;
}

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

export async function safeFetch(url: string, opts: SafeFetchOptions): Promise<SafeFetchResult> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const maxRedirects = opts.maxRedirects ?? 5;
  const signal = AbortSignal.timeout(timeoutMs);
  const fail = (err: unknown): never => {
    if (err instanceof SafeFetchError) throw err;
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new SafeFetchError('timeout', `timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw new SafeFetchError('network', err instanceof Error ? err.message : String(err));
  };

  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertPublicUrl(current);

    let res: Response;
    try {
      res = await netDeps.fetch(current, {
        redirect: 'manual',
        signal,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: opts.accept ?? '*/*',
        },
      });
    } catch (err) {
      return fail(err);
    }

    if (REDIRECT_STATUS.has(res.status)) {
      const location = res.headers.get('location');
      await res.body?.cancel().catch(() => undefined);
      if (!location) throw new SafeFetchError('http_error', 'redirect without Location', res.status);
      current = new URL(location, current).toString();
      continue;
    }

    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new SafeFetchError('http_error', `HTTP ${res.status}`, res.status);
    }

    const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
    if (opts.contentType && !opts.contentType.test(contentType)) {
      await res.body?.cancel().catch(() => undefined);
      throw new SafeFetchError('bad_content_type', contentType || 'missing content-type');
    }
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > opts.maxBytes) {
      await res.body?.cancel().catch(() => undefined);
      throw new SafeFetchError('too_large', `content-length ${declared} > ${opts.maxBytes}`);
    }

    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      const reader = res.body?.getReader();
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > opts.maxBytes) {
            await reader.cancel().catch(() => undefined);
            throw new SafeFetchError('too_large', `body exceeds ${opts.maxBytes} bytes`);
          }
          chunks.push(value);
        }
      }
    } catch (err) {
      return fail(err);
    }
    return { finalUrl: current, status: res.status, contentType, body: Buffer.concat(chunks) };
  }
  throw new SafeFetchError('too_many_redirects', `more than ${maxRedirects} redirects`);
}
