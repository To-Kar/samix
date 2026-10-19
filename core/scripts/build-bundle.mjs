#!/usr/bin/env node
// Builds the self-contained core that ships inside the desktop app:
//
//   <out>/server.mjs          all of the core's code and dependencies, bundled
//   <out>/node_modules/       only @prisma/client + the generated client with
//                             the query engine for THIS platform
//   <out>/prisma/             migrations (applied by the core at start)
//   <out>/agents/             default agents (copied to the user's folder once)
//
// Run it on each target platform (macOS arm64, Windows x64): the Prisma engine
// is a native library, so a bundle built on one OS does not run on another.
// It runs on the Node that will ship with the app, which is pinned in
// /.node-version.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const coreDir = resolve(here, '..');
const repoDir = resolve(coreDir, '..');
const out = resolve(process.argv[2] ?? join(repoDir, 'app/src-tauri/resources/core'));
const require = createRequire(import.meta.url);

const prismaClientVersion = JSON.parse(
  readFileSync(require.resolve('@prisma/client/package.json', { paths: [coreDir] }), 'utf8')
).version;

console.log(`bundle → ${out}`);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// 1. Code. CJS dependencies call require() on Node built-ins, which an ESM
//    bundle doesn't have: give them one.
await build({
  entryPoints: [join(coreDir, 'src/server.ts')],
  outfile: join(out, 'server.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  external: ['@prisma/client', '.prisma/client'],
  banner: {
    js: [
      "import { createRequire as __samixCreateRequire } from 'node:module';",
      "import { fileURLToPath as __samixFileURLToPath } from 'node:url';",
      "import { dirname as __samixDirname } from 'node:path';",
      'const require = __samixCreateRequire(import.meta.url);',
      'const __filename = __samixFileURLToPath(import.meta.url);',
      'const __dirname = __samixDirname(__filename);',
    ].join('\n'),
  },
  logLevel: 'warning',
});

// 2. The one external dependency, installed fresh for this platform.
writeFileSync(
  join(out, 'package.json'),
  JSON.stringify(
    { name: 'samix-core-bundle', private: true, type: 'module', dependencies: { '@prisma/client': prismaClientVersion } },
    null,
    2
  )
);
cpSync(join(coreDir, 'prisma/schema.prisma'), join(out, 'prisma/schema.prisma'));
cpSync(join(coreDir, 'prisma/migrations'), join(out, 'prisma/migrations'), { recursive: true });
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
execFileSync(npm, ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock'], {
  cwd: out,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

// 3. Generate the client into the bundle's own node_modules (uses the Prisma
//    CLI from the repo; the CLI itself is not shipped).
const prismaCli = require.resolve('prisma/build/index.js', { paths: [coreDir] });
execFileSync(process.execPath, [prismaCli, 'generate', '--schema', join(out, 'prisma/schema.prisma')], {
  cwd: out,
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: 'file:./unused.db' },
});

// 3b. Trim. The client ships WASM query engines for every database (the
//     largest part of the install); this app only uses the native library
//     engine with SQLite.
const runtimeDir = join(out, 'node_modules/@prisma/client/runtime');
for (const f of readdirSync(runtimeDir)) {
  if (/wasm/.test(f)) rmSync(join(runtimeDir, f));
}

// 3c. Apple Silicon only loads native code that carries at least an ad-hoc
//     signature. Prisma's engine comes unsigned from npm, so sign it here
//     (harmless if it is already signed). Notarisation is a Phase 5 matter.
if (process.platform === 'darwin') {
  const clientDir = join(out, 'node_modules/.prisma/client');
  for (const f of readdirSync(clientDir).filter((n) => n.endsWith('.node'))) {
    execFileSync('codesign', ['--force', '--sign', '-', join(clientDir, f)], { stdio: 'inherit' });
  }
}

// 4. Default agents.
cpSync(join(repoDir, 'agents'), join(out, 'agents'), { recursive: true });

// Summary
const size = (p) => {
  let n = 0;
  for (const e of readdirSync(p, { withFileTypes: true })) {
    const f = join(p, e.name);
    n += e.isDirectory() ? size(f) : statSync(f).size;
  }
  return n;
};
const engine = readdirSync(join(out, 'node_modules/.prisma/client')).filter((f) => /query_engine|query-engine/.test(f));
console.log(`done: ${(size(out) / 1e6).toFixed(1)} MB, server.mjs ${(statSync(join(out, 'server.mjs')).size / 1e6).toFixed(1)} MB`);
console.log(`prisma engine: ${engine.join(', ') || 'NOT FOUND'}`);
if (!existsSync(join(out, 'node_modules/.prisma/client/index.js')) || engine.length === 0) {
  console.error('generated Prisma client or engine missing');
  process.exit(1);
}
