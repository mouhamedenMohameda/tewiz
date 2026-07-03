import { describe, expect, it, vi } from 'vitest';
import { z, ZodError } from 'zod';
import { errorHandler, HttpError } from '../src/middleware/error.js';

/**
 * The errorHandler now surfaces the FIRST Zod issue's message instead of a
 * flat "Invalid request", so an actionable validation message (e.g. the
 * Mauritanian phone rule) reaches the client. The full `issues` list must stay
 * intact for programmatic consumers.
 */

/** Minimal Express res double: we only touch res.status().json(). */
function mockRes() {
  const res = {
    statusCode: 0,
    body: undefined as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

const req = { method: 'POST', path: '/x', log: { warn: vi.fn(), error: vi.fn() } } as any;
const next = vi.fn();

describe('errorHandler — ZodError', () => {
  it('surfaces the first issue message and keeps the full issue list', () => {
    const parsed = z
      .string()
      .min(9, 'Numéro mauritanien invalide (ex : 22 12 34 56).')
      .safeParse('short');
    if (parsed.success) throw new Error('expected the parse to fail');
    const res = mockRes();

    errorHandler(parsed.error, req, res, next);

    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
    expect(res.body.error.message).toBe('Numéro mauritanien invalide (ex : 22 12 34 56).');
    // Same reference — the raw issues are forwarded untouched.
    expect(res.body.error.issues).toBe(parsed.error.issues);
  });

  it('reports the first issue when several fields fail at once', () => {
    const parsed = z
      .object({
        phone: z.string().min(9, 'phone invalide'),
        pin: z.string().min(4, 'pin invalide'),
      })
      .safeParse({ phone: '1', pin: '1' });
    if (parsed.success) throw new Error('expected the parse to fail');
    const res = mockRes();

    errorHandler(parsed.error, req, res, next);

    expect(res.statusCode).toBe(400);
    expect(res.body.error.message).toBe(parsed.error.issues[0].message);
    expect(res.body.error.issues.length).toBeGreaterThanOrEqual(2);
  });

  it('falls back to "Invalid request" when a ZodError carries no issues', () => {
    const res = mockRes();

    errorHandler(new ZodError([]), req, res, next);

    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
    expect(res.body.error.message).toBe('Invalid request');
  });
});

describe('errorHandler — HttpError passthrough (unchanged)', () => {
  it('preserves status, code, message and details', () => {
    const res = mockRes();

    errorHandler(
      new HttpError(409, 'ride_taken', 'Course déjà prise', { rideId: 'r1' }),
      req,
      res,
      next,
    );

    expect(res.statusCode).toBe(409);
    expect(res.body.error).toEqual({
      code: 'ride_taken',
      message: 'Course déjà prise',
      details: { rideId: 'r1' },
    });
  });
});
