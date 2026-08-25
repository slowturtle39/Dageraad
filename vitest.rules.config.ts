import { defineConfig } from 'vitest/config';

/** Rules tests need the Firestore emulator; run via `npm run test:rules`. */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    testTimeout: 20_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
