import { describe, expect, it } from 'vitest';
import { generateOtp } from '../src/modules/auth/otp.js';

describe('generateOtp', () => {
  it('returns a 6-digit numeric code', () => {
    const otp = generateOtp();

    expect(otp).toMatch(/^\d{6}$/);
  });

  it('preserves leading zeros', () => {
    const attempts = Array.from({ length: 1_000 }, () => generateOtp());
    const foundLeadingZero = attempts.some((code) => code.startsWith('0'));

    expect(foundLeadingZero).toBe(true);
  });
});
