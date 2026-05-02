// Bundles the core into a single ESM file for Tauri release builds.
// Native modules (better-sqlite3, @prisma/client) are externalized — they
// must be present in node_modules relative to the bundled server.js at runtime.
import * as esbuild from 'esbuild';
import { mkdirSync } from 'node:fs';

mkdirSync('bundle', { recursive: true });

await esbuild.build({
  entryPoints: ['src/server.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: 'bundle/server.js',
  // Native addons and Prisma's generated client cannot be bundled.
  external: [
    'better-sqlite3',
    '@prisma/client',
    '.prisma',
    'prisma',
  ],
  // Preserve __dirname / __filename for path resolution in ESM.
  define: {
    'import.meta.dirname': '__dirname',
  },
  banner: {
    js: [
      "import { createRequire } from 'module';",
      "import { fileURLToPath } from 'url';",
      "import { dirname } from 'path';",
      "const __filename = fileURLToPath(import.meta.url);",
      "const __dirname = dirname(__filename);",
      "const require = createRequire(import.meta.url);",
    ].join('\n'),
  },
});

console.log('bundle/server.js written');
