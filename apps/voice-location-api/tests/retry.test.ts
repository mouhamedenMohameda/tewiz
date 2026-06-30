import { describe, expect, it, vi } from 'vitest';
import { TimeoutError, withRetry, withTimeout } from '../src/lib/retry.js';

describe('withTimeout', () => {
  it('resolves when the inner promise resolves in time', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 50)).resolves.toBe('ok');
  });

  it('rejects with TimeoutError when deadline is reached', async () => {
    await expect(withTimeout(new Promise(() => {}), 5)).rejects.toBeInstanceOf(TimeoutError);
  });
});

describe('withRetry', () => {
  it('retries then resolves', async () => {
    let count = 0;
    const fn = vi.fn(async () => {
      count += 1;
      if (count < 3) throw new Error('temporary');
      return 'ok';
    });

    await expect(
      withRetry(fn, {
        retries: 3,
        baseDelayMs: 0,
        maxDelayMs: 0,
        shouldRetry: () => true,
      }),
    ).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('stops retrying when shouldRetry returns false', async () => {
    const fn = vi.fn(async () => {
      throw new Error('fatal');
    });

    await expect(
      withRetry(fn, {
        retries: 5,
        baseDelayMs: 0,
        maxDelayMs: 0,
        shouldRetry: () => false,
      }),
    ).rejects.toThrow('fatal');

    expect(fn).toHaveBeenCalledTimes(1);
  });
});
