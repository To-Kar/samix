#!/usr/bin/env node
// One version for the whole repo. These files carry it and must agree:
//   package.json, app/package.json, core/package.json,
//   app/src-tauri/tauri.conf.json, app/src-tauri/Cargo.toml (+ the samix-app
//   entry in Cargo.lock), and PKG_VERSION in core/src/app.ts (GET /health).
//
//   node scripts/version.mjs              print them
//   node scripts/version.mjs --check      exit 1 unless they all agree
//   node scripts/version.mjs --expect X   exit 1 unless they all equal X (release tags)
//   node scripts/version.mjs 1.2.3        set all of them

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

const jsonVersion = (file) => ({
  file,
  read: (text) => JSON.parse(text).version,
  write: (text, v) => text.replace(/("version"\s*:\s*")[^"]*(")/, `$1${v}$2`),
});

const FILES = [
  jsonVersion('package.json'),
  jsonVersion('app/package.json'),
  jsonVersion('core/package.json'),
  jsonVersion('app/src-tauri/tauri.conf.json'),
  {
    file: 'app/src-tauri/Cargo.toml',
    read: (text) => /\[package\][^[]*?\nversion\s*=\s*"([^"]+)"/.exec(text)?.[1],
    write: (text, v) => text.replace(/(\[package\][^[]*?\nversion\s*=\s*")[^"]+(")/, `$1${v}$2`),
  },
  {
    file: 'core/src/app.ts',
    read: (text) => /const PKG_VERSION = '([^']+)'/.exec(text)?.[1],
    write: (text, v) => text.replace(/(const PKG_VERSION = ')[^']+(')/, `$1${v}$2`),
  },
];

// Cargo.lock mirrors the app's version; keep it in step so `cargo --locked` stays happy.
const LOCK = 'app/src-tauri/Cargo.lock';
const lockWrite = (text, v) => text.replace(/(name = "samix-app"\nversion = ")[^"]+(")/, `$1${v}$2`);

export function readVersions(root) {
  return FILES.map((f) => ({ file: f.file, version: f.read(readFileSync(join(root, f.file), 'utf8')) }));
}

export function setVersion(root, version) {
  if (!SEMVER.test(version)) throw new Error(`not a version like 1.2.3: "${version}"`);
  for (const f of FILES) {
    const path = join(root, f.file);
    const before = readFileSync(path, 'utf8');
    const after = f.write(before, version);
    if (f.read(after) !== version) throw new Error(`could not set the version in ${f.file}`);
    writeFileSync(path, after);
  }
  const lock = join(root, LOCK);
  if (existsSync(lock)) writeFileSync(lock, lockWrite(readFileSync(lock, 'utf8'), version));
}

export function disagreements(root, expected) {
  const rows = readVersions(root);
  const want = expected ?? rows[0].version;
  return rows.filter((r) => r.version !== want);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(fileURLToPath(import.meta.url), '../..');
  const [arg, value] = process.argv.slice(2);
  if (!arg) {
    for (const r of readVersions(root)) console.log(`${r.version}\t${r.file}`);
  } else if (arg === '--check' || arg === '--expect') {
    const bad = disagreements(root, arg === '--expect' ? value : undefined);
    if (bad.length) {
      console.error(`versions do not agree${value ? ` with ${value}` : ''}:`);
      for (const r of readVersions(root)) console.error(`  ${r.version}\t${r.file}`);
      process.exit(1);
    }
    console.log('versions agree');
  } else {
    setVersion(root, arg);
    console.log(`set ${arg} in ${FILES.length} files (+ Cargo.lock)`);
  }
}
