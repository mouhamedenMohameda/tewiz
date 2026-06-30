import { describe, expect, it } from 'vitest';
import { phoneSchema } from '../src/modules/auth/phone.js';

describe('phoneSchema', () => {
  it('normalizes 8-digit local phone to +222 format', () => {
    expect(phoneSchema.parse('45123456')).toBe('+22245123456');
  });

  it('normalizes 222-prefixed phone to +222 format', () => {
    expect(phoneSchema.parse('22245123456')).toBe('+22245123456');
  });

  it('keeps a valid +222 phone intact', () => {
    expect(phoneSchema.parse('+22245123456')).toBe('+22245123456');
  });

  it('rejects invalid Mauritanian numbers', () => {
    expect(() => phoneSchema.parse('11111111')).toThrow();
    expect(() => phoneSchema.parse('+22215123456')).toThrow();
  });
});
