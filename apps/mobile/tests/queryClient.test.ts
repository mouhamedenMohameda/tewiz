import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// react-native isn't available in the node test env, so stub the tiny surface
// queryClient.tsx touches (AppState + Platform). The focusManager listener is
// registered at import time; we just need the import not to throw.
vi.mock('react-native', () => ({
  AppState: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
  Platform: { OS: 'ios' },
}));

import { makeQueryClient } from '../lib/queryClient';

describe('makeQueryClient', () => {
  it('applies the weak-network defaults (retry + staleTime + gcTime)', () => {
    const client = makeQueryClient();
    const defaults = client.getDefaultOptions().queries!;

    expect(defaults.retry).toBe(1);
    expect(defaults.staleTime).toBe(30_000);
    expect(defaults.gcTime).toBe(5 * 60_000);
    expect(defaults.refetchOnWindowFocus).toBe(true);
  });

  it('backs off exponentially but caps the retry delay at 8s', () => {
    const client = makeQueryClient();
    const retryDelay = client.getDefaultOptions().queries!.retryDelay as (
      attempt: number,
    ) => number;

    expect(retryDelay(0)).toBe(1000);
    expect(retryDelay(1)).toBe(2000);
    expect(retryDelay(2)).toBe(4000);
    // 2^5 * 1000 = 32000 → clamped to the 8000 ceiling.
    expect(retryDelay(5)).toBe(8000);
  });

  it('de-duplicates concurrent fetches for the same key into one call', async () => {
    const client = makeQueryClient();
    const queryFn = vi.fn(async () => 'value');

    // Two simultaneous fetches of the same key share a single in-flight promise.
    const [a, b] = await Promise.all([
      client.fetchQuery({ queryKey: ['k'], queryFn }),
      client.fetchQuery({ queryKey: ['k'], queryFn }),
    ]);

    expect(a).toBe('value');
    expect(b).toBe('value');
    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it('serves a fresh cached value without re-invoking the query function', async () => {
    const client = makeQueryClient();
    const queryFn = vi.fn(async () => 'cached');

    await client.fetchQuery({ queryKey: ['k'], queryFn, staleTime: 60_000 });
    // Within staleTime, a second fetch is served from cache — no extra call.
    await client.fetchQuery({ queryKey: ['k'], queryFn, staleTime: 60_000 });

    expect(queryFn).toHaveBeenCalledTimes(1);
  });
});
