import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * The red list: executable specs for features that are not built yet.
 * See tests/pending/README.md.
 */
export default defineConfig({
  resolve: {
    alias: { '@': path.dirname(fileURLToPath(import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['tests/pending/**/*.spec.ts'],
    bail: 0,
  },
});
