import { afterEach, beforeEach } from 'vitest';
import { netDeps } from '../src/net/safeFetch.js';

export interface FakeResponse {
  status?: number;
  headers?: Record<string, string>;
  body?: string | Buffer | (() => ReadableStream<Uint8Array>);
}

// Smallest valid PNG (1×1) — enough for magic-byte sniffing.
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);
export const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);

/**
 * Replaces DNS and fetch for the current describe block. `routes` maps a full
 * URL to a response; unknown URLs answer 404. Hosts listed in `privateHosts`
 * resolve to 10.0.0.1, everything else to a public address.
 */
export function useFakeNet(routes: Record<string, FakeResponse | undefined>, privateHosts: string[] = []) {
  const calls: string[] = [];
  const original = { ...netDeps };

  beforeEach(() => {
    calls.length = 0;
    netDeps.lookup = async (host) => (privateHosts.includes(host) ? ['10.0.0.1'] : ['93.184.216.34']);
    netDeps.fetch = async (url, init) => {
      calls.push(url);
      const r = routes[url];
      const status = r?.status ?? (r ? 200 : 404);
      const body = r?.body ?? '';
      const stream =
        typeof body === 'function'
          ? body()
          : new ReadableStream<Uint8Array>({
              start(c) {
                c.enqueue(typeof body === 'string' ? new TextEncoder().encode(body) : new Uint8Array(body));
                c.close();
              },
            });
      init.signal?.throwIfAborted();
      return new Response(status === 204 || status === 304 ? null : stream, { status, headers: r?.headers });
    };
  });
  afterEach(() => {
    Object.assign(netDeps, original);
  });

  return { calls };
}
