import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { registerAdapter } from '../src/adapters/index.js';
import { prisma } from '../src/db/prisma.js';
import { logger } from '../src/logger.js';
import {
  MAX_LIST_ENTRIES,
  MAX_SEARCH_HITS,
  listDir,
  readTextFile,
  resolveInProject,
  searchTree,
  validateProjectRoot,
} from '../src/projects/safePath.js';
import { askAgent } from '../src/runner/converse.js';
import { executeTool, resolveTools } from '../src/tools/index.js';
import { calling, finalAnswer, makeSkill, scripted, seedAgent, toolCall } from './helpers.js';

const AUTH = { authorization: 'Bearer tok' };
let base: string;
let root: string;
let projectId: string;
let closedId: string;

const write = (p: string, content: string | Buffer) => {
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, content);
};

beforeAll(async () => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'samix-proj-')));
  root = join(base, 'proj');
  write(join(root, 'README.md'), 'hello world\nTODO: fix login\n');
  write(join(root, 'src/app.ts'), 'export const answer = 42;\n// TODO: remove\n');
  write(join(root, 'src/deep/x.ts'), 'deep file\n');
  write(join(root, '.env'), 'SECRET=hunter2\n');
  write(join(root, '.git/config'), 'SECRET=in-git\n');
  write(join(root, 'node_modules/pkg/index.js'), 'SECRET in deps\n');
  write(join(root, 'key.pem'), 'SECRET key\n');
  write(join(root, 'id_rsa'), 'SECRET ssh\n');
  write(join(root, 'bin.dat'), Buffer.from([1, 2, 0, 3, 4]));
  write(join(root, 'big.txt'), 'x'.repeat(600_000));
  write(join(base, 'outside/secret.txt'), 'SECRET outside\n');
  write(join(base, 'proj-evil/file.txt'), 'SECRET sibling\n');
  symlinkSync(join(base, 'outside'), join(root, 'link-out'));
  symlinkSync(join(base, 'proj-evil'), join(root, 'sib'));
  symlinkSync(join(root, '.env'), join(root, 'link-env'));
  symlinkSync(join(root, 'src/app.ts'), join(root, 'link-in'));
  for (let i = 0; i < MAX_LIST_ENTRIES + 50; i++) write(join(root, 'many', `f${String(i).padStart(3, '0')}.txt`), 'n\n');
  for (let i = 0; i < MAX_SEARCH_HITS + 10; i++) write(join(root, 'hits', `h${i}.txt`), 'needle\n');

  projectId = (await prisma.project.create({ data: { name: 'Demo', path: root, allowModelAccess: true } })).id;
  closedId = (await prisma.project.create({ data: { name: 'Closed', path: join(base, 'outside'), allowModelAccess: false } })).id;
});

describe('resolveInProject', () => {
  it.each([
    ['../outside/secret.txt', 'invalid_path'],
    ['src/../../outside/secret.txt', 'invalid_path'],
    ['/etc/passwd', 'invalid_path'],
    ['src\\app.ts', 'invalid_path'],
    ['C:/Windows/win.ini', 'invalid_path'],
    ['a\0b', 'invalid_path'],
    ['.env', 'excluded'],
    ['.git/config', 'excluded'],
    ['node_modules/pkg/index.js', 'excluded'],
    ['key.pem', 'excluded'],
    ['id_rsa', 'excluded'],
    ['link-out/secret.txt', 'outside_project'],
    ['sib/file.txt', 'outside_project'],
    ['link-env', 'excluded'],
    ['nope.txt', 'not_found'],
  ])('refuses %j (%s)', (rel, error) => {
    expect(resolveInProject(root, rel)).toEqual({ ok: false, error });
  });

  it('accepts files inside, normalising the path; a symlink to a file inside is fine', () => {
    expect(resolveInProject(root, 'README.md')).toMatchObject({ ok: true, rel: 'README.md' });
    expect(resolveInProject(root, './src//app.ts')).toMatchObject({ ok: true, rel: 'src/app.ts' });
    expect(resolveInProject(root, 'link-in')).toMatchObject({ ok: true });
    expect(resolveInProject(root, '')).toMatchObject({ ok: true, rel: '' });
  });
});

// Assigning undefined to process.env stores the string "undefined".
function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe('validateProjectRoot', () => {
  it('refuses relative paths, files, the filesystem root and the home folder; accepts a folder', () => {
    expect(validateProjectRoot('relative/dir')).toEqual({ ok: false, error: 'invalid_path' });
    expect(validateProjectRoot(join(root, 'README.md'))).toEqual({ ok: false, error: 'not_a_directory' });
    expect(validateProjectRoot(join(base, 'missing'))).toEqual({ ok: false, error: 'not_a_directory' });
    expect(validateProjectRoot('/')).toEqual({ ok: false, error: 'too_broad' });
    // os.homedir() reads HOME on Unix and USERPROFILE on Windows.
    const home = process.env.HOME;
    const profile = process.env.USERPROFILE;
    process.env.HOME = root;
    process.env.USERPROFILE = root;
    try {
      expect(validateProjectRoot(root)).toEqual({ ok: false, error: 'too_broad' });
    } finally {
      restoreEnv('HOME', home);
      restoreEnv('USERPROFILE', profile);
    }
    expect(validateProjectRoot(root)).toEqual({ ok: true, real: root });
  });
});

describe('listing, reading, searching', () => {
  it('lists without secrets, VCS, dependencies or symlinks, and caps the list', () => {
    const names = listDir(root).entries.map((e) => e.name);
    expect(names).toEqual(expect.arrayContaining(['README.md', 'src', 'many', 'bin.dat']));
    for (const hidden of ['.env', '.git', 'node_modules', 'key.pem', 'id_rsa', 'link-out', 'sib', 'link-env', 'link-in']) {
      expect(names).not.toContain(hidden);
    }
    const many = listDir(join(root, 'many'));
    expect(many.entries).toHaveLength(MAX_LIST_ENTRIES);
    expect(many.truncated).toBe(true);
  });

  it('refuses binary and oversized files', () => {
    expect(readTextFile(join(root, 'bin.dat'))).toEqual({ ok: false, error: 'binary' });
    expect(readTextFile(join(root, 'big.txt'))).toEqual({ ok: false, error: 'too_large' });
    expect(readTextFile(join(root, 'README.md'))).toMatchObject({ ok: true });
  });

  it('searches text files, finds nothing in excluded places, and stops at the hit limit', () => {
    const todo = searchTree(root, '', 'todo');
    expect(todo.hits.map((h) => `${h.path}:${h.line}`).sort()).toEqual(['README.md:2', 'src/app.ts:2']);
    expect(searchTree(root, '', 'SECRET').hits).toEqual([]);
    const many = searchTree(join(root, 'hits'), 'hits', 'needle');
    expect(many.hits).toHaveLength(MAX_SEARCH_HITS);
    expect(many.truncated).toBe(true);
  });
});

describe('tools', () => {
  const tools = () => resolveTools(['list_projects', 'list_files', 'search_files', 'read_file']);
  const ctx = { logger, skills: [], allowance: { fullTextFetches: 0 } };
  const call = (name: string, input: unknown) => executeTool({ id: 'x', name, input }, tools(), ctx);

  it('only released projects exist for the tools', async () => {
    const list = JSON.parse((await call('list_projects', {})).content);
    expect(list).toEqual([{ id: projectId, name: 'Demo' }]);
    for (const [name, input] of [
      ['list_files', { project: closedId }],
      ['search_files', { project: closedId, query: 'SECRET' }],
      ['read_file', { project: closedId, path: 'secret.txt' }],
      ['read_file', { project: 'nope', path: 'x' }],
    ] as const) {
      const r = await call(name, input);
      expect(r).toMatchObject({ isError: true, articleIds: [] });
      expect(r.content).toContain('unknown project');
    }
    // revoking the release takes effect at once
    await prisma.project.update({ where: { id: projectId }, data: { allowModelAccess: false } });
    expect((await call('read_file', { project: projectId, path: 'README.md' })).isError).toBe(true);
    await prisma.project.update({ where: { id: projectId }, data: { allowModelAccess: true } });
  });

  it('read_file numbers lines, pages, and surfaces the file as the only citable source', async () => {
    const r = await call('read_file', { project: projectId, path: 'README.md' });
    const body = JSON.parse(r.content);
    expect(body).toMatchObject({ path: 'README.md', totalLines: 3, truncated: false, sourceId: `file:${projectId}:README.md` });
    expect(body.text).toBe('1: hello world\n2: TODO: fix login\n3: ');
    expect(r.articleIds).toEqual([`file:${projectId}:README.md`]);

    const page = JSON.parse((await call('read_file', { project: projectId, path: 'README.md', startLine: 2, maxLines: 1 })).content);
    expect(page).toMatchObject({ text: '2: TODO: fix login', truncated: true });
  });

  it('refuses what the path rules refuse, with a reason the model can read', async () => {
    for (const path of ['../outside/secret.txt', '.env', 'link-out/secret.txt', 'bin.dat', 'big.txt', 'src']) {
      const r = await call('read_file', { project: projectId, path });
      expect(r.isError, path).toBe(true);
      expect(r.content).not.toContain('hunter2');
      expect(r.content).not.toContain('SECRET');
    }
    expect((await call('list_files', { project: projectId, path: '.git' })).isError).toBe(true);
    expect((await call('search_files', { project: projectId, query: 'x', path: '../outside' })).isError).toBe(true);
    expect((await call('read_file', { project: projectId, path: 'README.md', extra: 1 })).isError).toBe(true);
  });

  it('search_files returns hits with source ids, list_files surfaces no sources', async () => {
    const r = await call('search_files', { project: projectId, query: 'todo' });
    const body = JSON.parse(r.content);
    expect(body.hits.map((h: { path: string }) => h.path).sort()).toEqual(['README.md', 'src/app.ts']);
    expect(body.hits[0].sourceId).toMatch(new RegExp(`^file:${projectId}:`));
    expect(r.articleIds.sort()).toEqual([`file:${projectId}:README.md`, `file:${projectId}:src/app.ts`]);
    const listed = await call('list_files', { project: projectId, path: 'src' });
    expect(JSON.parse(listed.content).entries.map((e: { name: string }) => e.name)).toEqual(['app.ts', 'deep']);
    expect(listed.articleIds).toEqual([]);
  });
});

function projectSkill() {
  const s = makeSkill({ withSources: false, withSchema: false });
  s.type = 'reactive';
  s.manifest.type = 'reactive';
  s.manifest.sources = undefined;
  s.manifest.tools = ['list_projects', 'list_files', 'search_files', 'read_file'];
  s.manifest.emptyAnswer = 'Nichts in den Projekten.';
  s.manifest.output = { format: 'answer' };
  return s;
}

describe('project questions', () => {
  it('cites files that were read, with project and path; invented or unread files are dropped', async () => {
    const skill = projectSkill();
    await seedAgent(skill);
    const readme = `file:${projectId}:README.md`;
    const m = scripted([
      () => calling(toolCall('read_file', { project: projectId, path: 'README.md' })),
      () => finalAnswer('Es gibt ein TODO [1]; mehr in [2] und [3].', [readme, `file:${projectId}:src/app.ts`, `file:${projectId}:.env`]),
    ]);
    registerAdapter('claude-haiku-4-5', () => m.adapter);

    const r = await askAgent({ skill, question: 'Was ist offen?' });

    expect(r.status).toBe('success');
    expect(r.citations).toEqual([{ number: 1, articleId: readme, kind: 'file', path: 'README.md', title: 'README.md', sourceName: 'Demo', publishedAt: null, url: null }]);
    expect(r.answer).toBe('Es gibt ein TODO [1]; mehr in und.');
  });

  it('uses the agent\'s own "nothing found" text and never the model\'s', async () => {
    const skill = projectSkill();
    await seedAgent(skill);
    const m = scripted([() => calling(toolCall('search_files', { project: projectId, query: 'zzzzz' })), () => finalAnswer('Im Projekt steht X.', [])]);
    registerAdapter('claude-haiku-4-5', () => m.adapter);
    expect(await askAgent({ skill, question: 'Wo steht zzzzz?' })).toMatchObject({ status: 'success', answer: 'Nichts in den Projekten.', citations: [] });
  });

  it('does not show a citation for a project that was removed while the question ran', async () => {
    const skill = projectSkill();
    await seedAgent(skill);
    write(join(base, 'ghost/a.txt'), 'ghost\n');
    const ghost = await prisma.project.create({ data: { name: 'Ghost', path: join(base, 'ghost'), allowModelAccess: true } });
    const m = scripted([
      () => calling(toolCall('read_file', { project: ghost.id, path: 'a.txt' })),
      async () => {
        await prisma.project.delete({ where: { id: ghost.id } });
        return finalAnswer('Steht dort [1]', [`file:${ghost.id}:a.txt`]);
      },
    ]);
    registerAdapter('claude-haiku-4-5', () => m.adapter);
    expect(await askAgent({ skill, question: 'Was steht in a.txt?' })).toMatchObject({ status: 'partial', error: 'no_valid_citations' });
  });
});

describe('projects API', () => {
  it('releases, lists, revokes and removes a folder; the folder itself is untouched', async () => {
    const app = await buildApp({ token: 'tok', logger, getSkills: () => [] });
    const post = (payload: unknown) => app.inject({ method: 'POST', url: '/projects', headers: AUTH, payload });
    expect((await app.inject({ method: 'GET', url: '/projects' })).statusCode).toBe(401);

    expect((await post({ name: '', path: root })).statusCode).toBe(400);
    expect((await post({ name: 'x', path: 'relative' })).json()).toMatchObject({ error: 'invalid_path' });
    expect((await post({ name: 'x', path: '/' })).json()).toMatchObject({ error: 'too_broad' });
    expect((await post({ name: 'x', path: join(base, 'missing') })).json()).toMatchObject({ error: 'not_a_directory' });
    expect((await post({ name: 'again', path: root })).statusCode).toBe(409);

    const dir = join(base, 'fresh');
    mkdirSync(dir);
    const created = await post({ name: 'Fresh', path: dir });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ name: 'Fresh', allowModelAccess: false, exists: true });

    const id = created.json().id;
    expect((await app.inject({ method: 'PUT', url: `/projects/${id}`, headers: AUTH, payload: { allowModelAccess: 'yes' } })).statusCode).toBe(400);
    const on = await app.inject({ method: 'PUT', url: `/projects/${id}`, headers: AUTH, payload: { allowModelAccess: true } });
    expect(on.json()).toMatchObject({ allowModelAccess: true });
    expect((await app.inject({ method: 'PUT', url: '/projects/nope', headers: AUTH, payload: { allowModelAccess: true } })).statusCode).toBe(404);

    const list = (await app.inject({ method: 'GET', url: '/projects', headers: AUTH })).json();
    expect(list.map((p: { name: string }) => p.name)).toContain('Fresh');

    expect((await app.inject({ method: 'DELETE', url: `/projects/${id}`, headers: AUTH })).statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', url: `/projects/${id}`, headers: AUTH })).statusCode).toBe(404);
    expect(readTextFile(join(root, 'README.md'))).toMatchObject({ ok: true });
  });
});
