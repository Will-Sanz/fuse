import { defineConfig } from 'vitest/config';
export default defineConfig({
  // Real Git/TypeScript fixtures can exceed 20 seconds on busy developer machines.
  test: { include: ['tests/**/*.test.ts'], testTimeout: 60000, fileParallelism: false },
});
