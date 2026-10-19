#!/usr/bin/env node
// Smoke test for a built core bundle. Usage:
//   node verify-bundle.mjs <bundle-dir> <node-binary>
//
// Copies the bundle to a temp folder (so nothing can resolve against the
// repo's node_modules), starts it with the environment the desktop shell
// provides, and checks what an installed app depends on: health, database
// creation + migrations, agent seeding, auth, the Prisma engine, an agent run
// and the log file. Pure Node, so it runs the same on macOS, Windows and Linux.

import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const [bundleArg, nodeArg] = process.argv.slice(2);
if (!bundleArg || !nodeArg) {
  console.error('usage: verify-bundle.mjs <bundle-dir> <node-binary>');
  process.exit(2);
}
const bundle = resolve(bundleArg);
const nodeBin = resolve(nodeArg);
const port = 4710 + Math.floor(Math.random() * 200);
const work = mkdtempSync(join(tmpdir(), 'samix-bundle-verify-'));
const slash = (p) => p.replace(/\\/g, '/');

cpSync(bundle, join(work, 'core'), { recursive: true });
const core = join(work, 'core');

const env = { ...process.env };
for (const k of Object.keys(env)) if (k.startsWith('SAMIX_') || k === 'DATABASE_URL' || k === 'NODE_PATH') delete env[k];
Object.assign(env, {
  NODE_ENV: 'production',
  SAMIX_TOKEN: 't',
  SAMIX_PORT: String(port),
  SAMIX_PARENT_PID: String(process.pid),
  DATABASE_URL: `file:${slash(join(work, 'data', 'samix.db'))}`,
  SAMIX_AGENTS_DIR: join(work, 'data', 'agents'),
  SAMIX_BUNDLED_AGENTS_DIR: join(core, 'agents'),
  SAMIX_MIGRATIONS_DIR: join(core, 'prisma', 'migrations'),
  SAMIX_LOG_FILE: join(work, 'logs', 'core.log'),
});

let output = '';
const child = spawn(nodeBin, ['--disable-warning=ExperimentalWarning', 'server.mjs'], { cwd: core, env, windowsHide: true });
child.stdout.on('data', (d) => (output += d));
child.stderr.on('data', (d) => (output += d));
let exited = false;
child.on('exit', () => (exited = true));

const base = `http://127.0.0.1:${port}`;
const auth = { Authorization: 'Bearer t' };
const checks = [];
async function check(name, fn) {
  try {
    const ok = await fn();
    checks.push({ name, ok: ok !== false });
  } catch (e) {
    checks.push({ name, ok: false, why: e instanceof Error ? e.message : String(e) });
  }
}

async function finish(code) {
  child.kill();
  await new Promise((r) => setTimeout(r, 300));
  rmSync(work, { recursive: true, force: true });
  process.exit(code);
}

// wait for the server
let up = false;
for (let i = 0; i < 60 && !exited; i++) {
  try {
    if ((await fetch(`${base}/health`)).ok) {
      up = true;
      break;
    }
  } catch {
    /* not yet */
  }
  await new Promise((r) => setTimeout(r, 500));
}

if (!up) {
  console.error('FAIL: core did not start');
  console.error(output || '(no output)');
  const log = join(work, 'logs', 'core.log');
  if (existsSync(log)) console.error(readFileSync(log, 'utf8').slice(-2000));
  await finish(1);
}

await check('health', async () => (await (await fetch(`${base}/health`)).json()).status === 'ok');
await check('database created', () => existsSync(join(work, 'data', 'samix.db')));
await check('default agents seeded', () => existsSync(join(work, 'data', 'agents', 'newsletter-ai', 'manifest.yaml')));
await check('auth enforced', async () => (await fetch(`${base}/agents`)).status === 401);
await check('Prisma engine + migrations (agents list)', async () => {
  const list = await (await fetch(`${base}/agents`, { headers: auth })).json();
  return list.some((a) => a.slug === 'newsletter-ai');
});
await check('models endpoint', async () => (await (await fetch(`${base}/models`, { headers: auth })).text()).includes('deepseek-chat'));
await check('agent run through the bundled core', async () => {
  const res = await fetch(`${base}/agents/hello-world/run`, { method: 'POST', headers: auth });
  return (await res.json()).status === 'success';
});
await check('create an agent from the bundled template', async () => {
  const res = await fetch(`${base}/agents`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Bundle Check',
      focus: 'anything',
      sources: [{ type: 'website', config: { url: 'example.com' } }],
    }),
  });
  if (res.status !== 201) return false;
  const created = existsSync(join(work, 'data', 'agents', 'bundle-check', 'SKILL.md'));
  const list = await (await fetch(`${base}/agents`, { headers: auth })).json();
  return created && list.some((a) => a.slug === 'bundle-check' && a.title === 'Bundle Check');
});
await check('log file written', async () => {
  await new Promise((r) => setTimeout(r, 600)); // async log destination
  const log = join(work, 'logs', 'core.log');
  return existsSync(log) && statSync(log).size > 0;
});

const failed = checks.filter((c) => !c.ok);
for (const c of checks) console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.name}${c.why ? ` (${c.why})` : ''}`);
if (failed.length) {
  console.error('--- core output');
  console.error(output || '(none)');
  await finish(1);
}
const version = await new Promise((r) => {
  const p = spawn(nodeBin, ['--version']);
  let s = '';
  p.stdout.on('data', (d) => (s += d));
  p.on('close', () => r(s.trim()));
});
console.log(`bundle OK (node ${version})`);
await finish(0);
