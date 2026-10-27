// Runs the Prisma CLI with the same DATABASE_URL the core uses at runtime.
// Invoked via the `prisma` package script, e.g.
//   pnpm --filter samix-core prisma migrate deploy
// Spawns node directly (no shell, no .cmd shim) so it behaves the same on
// Windows and macOS.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { ensureDatabaseUrl } from '../src/db/location.js';

ensureDatabaseUrl();

const require = createRequire(import.meta.url);
const cli = join(dirname(require.resolve('prisma/package.json')), 'build', 'index.js');

const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
});
process.exit(result.status ?? 1);
