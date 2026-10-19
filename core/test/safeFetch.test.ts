import { describe, expect, it } from 'vitest';
import { assertPublicUrl, isPrivateIp, netDeps, safeFetch, SafeFetchError } from '../src/net/safeFetch.js';
import { useFakeNet } from './net.js';

describe('isPrivateIp', () => {
  it.each([
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
    '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '::1', '::', 'fe80::1', 'fd12:3456::1',
    'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', 'not-an-ip',
  ])('blocks %s', (ip) => expect(isPrivateIp(ip)).toBe(true));

  it.each(['93.184.216.34', '8.8.8.8', '172.15.0.1', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])(
    'allows %s',
    (ip) => expect(isPrivateIp(ip)).toBe(false)
  );
});

describe('safeFetch', () => {
  const net = useFakeNet(
    {
      'https://ok.example/page': { headers: { 'content-type': 'text/html' }, body: '<p>hi</p>' },
      'https://ok.example/json': { headers: { 'content-type': 'application/json' }, body: '{}' },
      'https://ok.example/big': { headers: { 'content-type': 'text/html' }, body: 'x'.repeat(5000) },
      'https://ok.example/declared-big': { headers: { 'content-type': 'text/html', 'content-length': '999999' }, body: 'x' },
      'https://ok.example/to-private': { status: 302, headers: { location: 'http://internal.example/admin' } },
      'https://ok.example/to-loopback': { status: 301, headers: { location: 'http://127.0.0.1:11434/api/tags' } },
      'https://ok.example/hop1': { status: 302, headers: { location: '/hop2' } },
      'https://ok.example/hop2': { status: 302, headers: { location: '/page' } },
      'https://ok.example/loop': { status: 302, headers: { location: '/loop' } },
      'http://internal.example/admin': { body: 'secret' },
    },
    ['internal.example']
  );

  const code = async (p: Promise<unknown>) => (await p.catch((e: SafeFetchError) => e)) as SafeFetchError;

  it('returns body, final URL and content type', async () => {
    const r = await safeFetch('https://ok.example/page', { maxBytes: 1000 });
    expect(r).toMatchObject({ finalUrl: 'https://ok.example/page', status: 200, contentType: 'text/html' });
    expect(r.body.toString()).toBe('<p>hi</p>');
  });

  it('follows redirects, checking each hop', async () => {
    const r = await safeFetch('https://ok.example/hop1', { maxBytes: 1000 });
    expect(r.finalUrl).toBe('https://ok.example/page');
    expect(net.calls).toEqual(['https://ok.example/hop1', 'https://ok.example/hop2', 'https://ok.example/page']);
  });

  it.each([
    'http://localhost/x',
    'http://foo.localhost/x',
    'http://printer.local/x',
    'http://127.0.0.1:11434/api/tags',
    'http://[::1]/x',
    'http://10.0.0.5/x',
    'http://169.254.169.254/latest/meta-data/',
    'http://internal.example/admin', // public-looking name that resolves to 10.0.0.1
  ])('refuses %s without making a request', async (url) => {
    const e = await code(safeFetch(url, { maxBytes: 1000 }));
    expect(e.code).toBe('blocked_host');
    expect(net.calls).toEqual([]);
  });

  it.each(['file:///etc/passwd', 'ftp://ok.example/x', 'javascript:alert(1)', 'not a url'])('refuses %s', async (url) => {
    expect((await code(safeFetch(url, { maxBytes: 1000 }))).code).toBe('bad_url');
  });

  it('refuses a redirect from a public host to a private one, and never requests it', async () => {
    expect((await code(safeFetch('https://ok.example/to-private', { maxBytes: 1000 }))).code).toBe('blocked_host');
    expect((await code(safeFetch('https://ok.example/to-loopback', { maxBytes: 1000 }))).code).toBe('blocked_host');
    expect(net.calls).not.toContain('http://internal.example/admin');
    expect(net.calls).not.toContain('http://127.0.0.1:11434/api/tags');
  });

  it('stops redirect loops', async () => {
    expect((await code(safeFetch('https://ok.example/loop', { maxBytes: 1000, maxRedirects: 3 }))).code).toBe('too_many_redirects');
  });

  it('enforces the byte limit while streaming and from Content-Length', async () => {
    expect((await code(safeFetch('https://ok.example/big', { maxBytes: 1000 }))).code).toBe('too_large');
    expect((await code(safeFetch('https://ok.example/declared-big', { maxBytes: 1000 }))).code).toBe('too_large');
  });

  it('enforces the content type', async () => {
    const e = await code(safeFetch('https://ok.example/json', { maxBytes: 1000, contentType: /text\/html/ }));
    expect(e.code).toBe('bad_content_type');
  });

  it('reports HTTP errors with their status', async () => {
    const e = await code(safeFetch('https://ok.example/missing', { maxBytes: 1000 }));
    expect(e).toMatchObject({ code: 'http_error', status: 404 });
  });

  it('times out', async () => {
    netDeps.fetch = (_url, init) =>
      new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason)));
    expect((await code(safeFetch('https://ok.example/page', { maxBytes: 1000, timeoutMs: 30 }))).code).toBe('timeout');
  });

  it('treats an unresolvable name as a network error', async () => {
    netDeps.lookup = async () => {
      throw new Error('ENOTFOUND');
    };
    expect((await code(assertPublicUrl('https://nowhere.example/'))).code).toBe('network');
  });
});
