import { describe, expect, it } from 'vitest';
import { formatMru } from '../lib/format';

describe('formatMru', () => {
  it('formats and rounds values as MRU strings', () => {
    expect(formatMru(1234.2)).toMatch(/1\D?234 MRU/);
    expect(formatMru(1234.8)).toMatch(/1\D?235 MRU/);
  });
});
