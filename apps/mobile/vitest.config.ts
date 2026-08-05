import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Mirror the tsconfig `@/*` path so lib modules resolve in tests.
    alias: { '@': path.dirname(fileURLToPath(import.meta.url)) },
  },
  test: {
    environment: 'node',
    // tests/pending holds executable specs for behaviour that does not exist
    // yet — expected to fail, so kept out of `pnpm test` and out of CI.
    // Run them with `pnpm test:pending`.
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/pending/**'],
  },
});
