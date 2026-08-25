import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // *.spec.ts are the Firestore rules tests; they need the emulator and run
    // separately via `npm run test:rules`.
    include: ['src/**/*.test.ts'],
  },
});
