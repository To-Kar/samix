#!/usr/bin/env node
// Downloads the official Node.js binary that ships inside the app as a Tauri
// sidecar, named the way Tauri expects: src-tauri/binaries/node-<target-triple>[.exe].
//
// The version comes from /.node-version, the same file CI's setup-node reads,
// so the Node that builds the core bundle and the Node that runs it match.
// The download is verified against nodejs.org's SHASUMS256.txt.
// (A system Node is not used: Homebrew's, for one, links dylibs that don't
// exist on other Macs. The official builds are self-contained.)

import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const version = readFileSync(join(repo, '.node-version'), 'utf8').trim();

// target triple → how nodejs.org names the build
const TARGETS = {
  'aarch64-apple-darwin': { dist: 'darwin-arm64', ext: 'tar.gz', inner: 'bin/node', exe: '' },
  'x86_64-pc-windows-msvc': { dist: 'win-x64', ext: 'zip', inner: 'node.exe', exe: '.exe' },
  // Not shipped; lets the bundle be verified on Linux/CI.
  'x86_64-unknown-linux-gnu': { dist: 'linux-x64', ext: 'tar.gz', inner: 'bin/node', exe: '' },
};

function hostTriple() {
  const key = `${process.platform}-${process.arch}`;
  const map = { 'darwin-arm64': 'aarch64-apple-darwin', 'win32-x64': 'x86_64-pc-windows-msvc', 'linux-x64': 'x86_64-unknown-linux-gnu' };
  const t = map[key];
  if (!t) throw new Error(`no Node target for ${key}`);
  return t;
}

const args = process.argv.slice(2);
const targetArg = args.indexOf('--target');
const triple = targetArg >= 0 ? args[targetArg + 1] : hostTriple();
const force = args.includes('--force');
const t = TARGETS[triple];
if (!t) throw new Error(`unsupported target "${triple}"; known: ${Object.keys(TARGETS).join(', ')}`);

const outDir = join(repo, 'app/src-tauri/binaries');
const outFile = join(outDir, `node-${triple}${t.exe}`);
const stamp = `${outFile}.version`;
if (!force && existsSync(outFile) && existsSync(stamp) && readFileSync(stamp, 'utf8') === version) {
  console.log(`node ${version} for ${triple} already present: ${outFile}`);
  process.exit(0);
}

const base = `https://nodejs.org/dist/v${version}`;
const name = `node-v${version}-${t.dist}.${t.ext}`;
console.log(`downloading ${base}/${name}`);

const sums = await (await fetch(`${base}/SHASUMS256.txt`)).text();
const expected = sums.split('\n').map((l) => l.trim().split(/\s+/)).find(([, f]) => f === name)?.[0];
if (!expected) throw new Error(`${name} not listed in SHASUMS256.txt`);

const res = await fetch(`${base}/${name}`);
if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
const archive = Buffer.from(await res.arrayBuffer());
const actual = createHash('sha256').update(archive).digest('hex');
if (actual !== expected) throw new Error(`checksum mismatch for ${name}: expected ${expected}, got ${actual}`);

const tmp = mkdtempSync(join(tmpdir(), 'samix-node-'));
try {
  const archivePath = join(tmp, name);
  writeFileSync(archivePath, archive);
  // bsdtar (macOS, Windows 10+) and GNU tar both read .tar.gz; bsdtar also .zip.
  execFileSync('tar', ['-xf', archivePath, '-C', tmp], { stdio: 'inherit' });
  mkdirSync(outDir, { recursive: true });
  copyFileSync(join(tmp, `node-v${version}-${t.dist}`, t.inner), outFile);
  if (!t.exe) chmodSync(outFile, 0o755);
  writeFileSync(stamp, version);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`ok: ${outFile} (sha256 verified)`);
