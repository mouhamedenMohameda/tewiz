import { defineConfig } from 'vitest/config';

/**
 * The red list: executable specs for features that are not built yet.
 *
 * Every failure here is a feature to implement, not a bug to fix. When a spec
 * goes green, move its file into tests/features/ — it has become a regression
 * test. See tests/pending/README.md.
 */
export default defineConfig({
  test: {
    include: ['tests/pending/**/*.spec.ts'],
    // One spec failing must not hide the others: the whole point is to read the
    // list top to bottom.
    bail: 0,
  },
});
