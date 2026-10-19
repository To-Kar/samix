import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    // Each test file gets its own SQLite database (see test/setup.ts).
    testTimeout: 15_000,
  },
});
