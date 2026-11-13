import { defineConfig } from 'vitest/config';

// Browser fixtures and release bundling share CPU/memory; bound concurrency on build PCs.
export default defineConfig({ test: { include: ['packages/**/*.test.ts'], testTimeout: 10000, minWorkers: 1, maxWorkers: 2 } });
