import { mkdirSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectUnreferencedMedia, mediaDir, readMedia, sniffImage, storeImage } from '../src/content/media.js';
import { JPEG, PNG, useFakeNet } from './net.js';

describe('sniffImage', () => {
  it('recognises formats by magic bytes', () => {
    expect(sniffImage(PNG)).toBe('png');
    expect(sniffImage(JPEG)).toBe('jpg');
    expect(sniffImage(Buffer.from('GIF89a......'))).toBe('gif');
    expect(sniffImage(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]))).toBe('webp');
  });
  it('rejects SVG, HTML and garbage', () => {
    expect(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'))).toBeNull();
    expect(sniffImage(Buffer.from('<html><body>not an image</body></html>'))).toBeNull();
    expect(sniffImage(Buffer.alloc(0))).toBeNull();
  });
});

describe('storeImage / readMedia', () => {
  useFakeNet({
    'https://cdn.example/a.png': { headers: { 'content-type': 'image/png' }, body: PNG },
    'https://cdn.example/same.png': { headers: { 'content-type': 'image/png' }, body: PNG },
    'https://cdn.example/lie.png': { headers: { 'content-type': 'image/png' }, body: '<svg><script>alert(1)</script></svg>' },
    'https://cdn.example/huge.jpg': { headers: { 'content-type': 'image/jpeg' }, body: Buffer.concat([JPEG, Buffer.alloc(6 * 1024 * 1024)]) },
  });

  it('stores content-addressed and serves it back with the sniffed type', async () => {
    const id = await storeImage('https://cdn.example/a.png');
    expect(id).toMatch(/^[a-f0-9]{64}$/);
    const media = await readMedia(id);
    expect(media?.mime).toBe('image/png');
    expect(media?.data.equals(PNG)).toBe(true);
  });

  it('stores identical bytes from different URLs once', async () => {
    const a = await storeImage('https://cdn.example/a.png');
    const b = await storeImage('https://cdn.example/same.png');
    expect(a).toBe(b);
    expect(readdirSync(mediaDir()).filter((f) => f.startsWith(a))).toHaveLength(1);
  });

  it('refuses content that lies about being an image, and oversized files', async () => {
    await expect(storeImage('https://cdn.example/lie.png')).rejects.toThrow(/not a supported image/);
    await expect(storeImage('https://cdn.example/huge.jpg')).rejects.toThrow();
  });

  it('never reads a real file outside the media directory', async () => {
    // A PNG one level above media/ that a traversal id would reach.
    mkdirSync(mediaDir(), { recursive: true });
    writeFileSync(join(mediaDir(), '..', 'outside.png'), PNG);
    expect(await readMedia('../outside')).toBeNull();
  });

  it('rejects malformed ids', async () => {
    for (const id of ['../../etc/passwd', '..%2f..%2fetc%2fpasswd', 'a'.repeat(63), 'g'.repeat(64), '']) {
      expect(await readMedia(id)).toBeNull();
    }
  });
});

describe('collectUnreferencedMedia', () => {
  it('removes old unreferenced files, keeps referenced and recent ones', async () => {
    const dir = mediaDir();
    mkdirSync(dir, { recursive: true });
    const old = 'a'.repeat(64);
    const keep = 'b'.repeat(64);
    const fresh = 'c'.repeat(64);
    for (const id of [old, keep, fresh]) writeFileSync(join(dir, `${id}.png`), PNG);
    const longAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    for (const id of [old, keep]) utimesSync(join(dir, `${id}.png`), longAgo, longAgo);

    const removed = await collectUnreferencedMedia(new Set([keep]));

    const left = readdirSync(dir);
    expect(left).toContain(`${keep}.png`);
    expect(left).toContain(`${fresh}.png`);
    expect(left).not.toContain(`${old}.png`);
    expect(removed).toBeGreaterThanOrEqual(1);
  });
});
