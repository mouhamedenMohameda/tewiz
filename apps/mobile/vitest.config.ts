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
  },
});
