import { defineConfig } from 'vitest/config';

/**
 * Default run: everything EXCEPT tests/pending.
 *
 * tests/pending holds executable specs for behaviour that does not exist yet
 * (see tests/pending/README.md). Those are expected to fail, so they are kept
 * out of `pnpm test` and out of CI — a permanently red pipeline stops being a
 * signal within a week, and the regression safety of the other 828 tests is
 * exactly what you want protecting you WHILE you build the missing features.
 *
 * Run them with `pnpm test:pending`.
 */
export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/pending/**'],
  },
});
