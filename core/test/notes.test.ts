import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db/prisma.js';
import { logger } from '../src/logger.js';
import { MAX_NOTES, MAX_NOTE_CHARS } from '../src/memory/notes.js';
import { executeTool, resolveTools } from '../src/tools/index.js';
import { makeSkill } from './helpers.js';

const AUTH = { authorization: 'Bearer tok' };

describe('notes', () => {
  it('can be added, listed (newest first) and deleted over the API; all of it needs the token', async () => {
    const app = await buildApp({ token: 'tok', logger, getSkills: () => [] });
    expect((await app.inject({ method: 'GET', url: '/notes' })).statusCode).toBe(401);

    const a = (await app.inject({ method: 'POST', url: '/notes', headers: AUTH, payload: { text: '  Ich verfolge Rust  ' } }));
    expect(a.statusCode).toBe(201);
    expect(a.json()).toMatchObject({ text: 'Ich verfolge Rust' });
    await new Promise((r) => setTimeout(r, 5));
    await app.inject({ method: 'POST', url: '/notes', headers: AUTH, payload: { text: 'Keine Krypto' } });

    const list = (await app.inject({ method: 'GET', url: '/notes', headers: AUTH })).json();
    expect(list.map((n: { text: string }) => n.text)).toEqual(['Keine Krypto', 'Ich verfolge Rust']);

    expect((await app.inject({ method: 'DELETE', url: `/notes/${a.json().id}`, headers: AUTH })).statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', url: `/notes/${a.json().id}`, headers: AUTH })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/notes', headers: AUTH })).json()).toHaveLength(1);
  });

  it('rejects empty, non-text and too long notes, and stops at the maximum', async () => {
    const app = await buildApp({ token: 'tok', logger, getSkills: () => [] });
    await prisma.memoryNote.deleteMany();
    for (const payload of [{ text: '   ' }, { text: 'x'.repeat(MAX_NOTE_CHARS + 1) }, { text: 5 }, {}]) {
      expect((await app.inject({ method: 'POST', url: '/notes', headers: AUTH, payload })).statusCode).toBe(400);
    }
    expect((await app.inject({ method: 'POST', url: '/notes', headers: AUTH, payload: { text: 'x'.repeat(MAX_NOTE_CHARS) } })).statusCode).toBe(201);

    await prisma.memoryNote.createMany({ data: Array.from({ length: MAX_NOTES - 1 }, (_, i) => ({ text: `n${i}` })) });
    const over = await app.inject({ method: 'POST', url: '/notes', headers: AUTH, payload: { text: 'one too many' } });
    expect(over.statusCode).toBe(409);
    expect(over.json()).toEqual({ error: 'too_many_notes' });
  });

  it('read_notes returns the texts and never an article id', async () => {
    await prisma.memoryNote.deleteMany();
    await prisma.memoryNote.create({ data: { text: 'Ich verfolge Rust' } });
    const tools = resolveTools(['read_notes']);
    const r = await executeTool({ id: '1', name: 'read_notes', input: {} }, tools, { logger, skills: [makeSkill()], allowance: { fullTextFetches: 0 } });
    expect(JSON.parse(r.content)).toEqual(['Ich verfolge Rust']);
    expect(r).toMatchObject({ articleIds: [], resultCount: 1 });
    // takes no arguments
    const bad = await executeTool({ id: '2', name: 'read_notes', input: { x: 1 } }, tools, { logger, skills: [], allowance: { fullTextFetches: 0 } });
    expect(bad.isError).toBe(true);
  });
});
