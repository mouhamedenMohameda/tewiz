import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The heartbeat throttle writes users.last_seen_at at most once per minute per
// user and evicts stale entries so the in-memory Map can't grow unbounded. We
// drive it with a mocked pool (so no real DB) and fake timers (so we control
// Date.now() and can jump past the throttle / eviction windows deterministically).

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(async () => ({ rows: [], rowCount: 0 })),
}));

vi.mock('../src/db/pool.js', () => ({ pool: { query: queryMock } }));

// Re-import the module fresh per test so its module-level cache (lastBump /
// lastSweep) starts empty and tests don't leak state into one another.
async function freshHeartbeat() {
  vi.resetModules();
  return import('../src/middleware/heartbeat.js');
}

beforeEach(() => {
  queryMock.mockClear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-15T00:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('bumpHeartbeat', () => {
  it('writes once then throttles repeated bumps within the 60s window', async () => {
    const { bumpHeartbeat } = await freshHeartbeat();

    bumpHeartbeat('user-a');
    bumpHeartbeat('user-a');
    bumpHeartbeat('user-a');

    // Only the first bump reaches the DB; the rest are throttled in memory.
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(queryMock.mock.calls[0]?.[1]).toEqual(['user-a']);
  });

  it('writes again once the throttle window has elapsed', async () => {
    const { bumpHeartbeat } = await freshHeartbeat();

    bumpHeartbeat('user-a');
    vi.advanceTimersByTime(61_000); // past the 60s throttle
    bumpHeartbeat('user-a');

    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  it('throttles each user independently', async () => {
    const { bumpHeartbeat } = await freshHeartbeat();

    bumpHeartbeat('user-a');
    bumpHeartbeat('user-b');
    bumpHeartbeat('user-a'); // throttled
    bumpHeartbeat('user-b'); // throttled

    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  it('evicts stale entries so the cache stays bounded (no unbounded growth)', async () => {
    const { bumpHeartbeat, heartbeatCacheSize } = await freshHeartbeat();

    // Fill the cache with several users at t0.
    for (const id of ['u1', 'u2', 'u3', 'u4', 'u5']) bumpHeartbeat(id);
    expect(heartbeatCacheSize()).toBe(5);

    // Jump 11 minutes: every existing entry is now older than the 10-min TTL,
    // and enough time has passed to trigger the (>=5-min-gated) sweep.
    vi.advanceTimersByTime(11 * 60_000);

    // The next bump runs the sweep before inserting: the 5 stale users are
    // dropped and only the fresh one remains.
    bumpHeartbeat('u6');
    expect(heartbeatCacheSize()).toBe(1);
  });

  it('rolls the entry back when the DB write fails so the next bump retries', async () => {
    const { bumpHeartbeat } = await freshHeartbeat();

    queryMock.mockRejectedValueOnce(new Error('db down'));

    bumpHeartbeat('user-a'); // attempt 1 — write rejects, entry rolled back
    await Promise.resolve(); // let the fire-and-forget .catch() run
    await Promise.resolve();

    bumpHeartbeat('user-a'); // attempt 2 — not throttled, retries the write

    expect(queryMock).toHaveBeenCalledTimes(2);
  });
});
