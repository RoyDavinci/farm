import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    env: { NODE_ENV: 'test' },
    // Tests share one database and truncate it between cases.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 60000,
  },
});
