/**
 * FEATURE 17 — pouvoir faire tourner plus d'un process d'API.
 *
 * WHAT MUST HOLD
 *
 *   1. Every in-process cron acquires a distributed lock before doing work, and
 *      skips its tick when another instance holds it. Redis is already a
 *      dependency, and `ioredis` is already imported by db/redis.ts — a `SET key
 *      value NX PX ttl` is enough. A Postgres advisory lock is equally fine.
 *   2. The lock has a TTL shorter than the interval, so a process that dies
 *      mid-tick does not wedge the job until the next restart.
 *   3. Losing the lock is a normal, silent outcome — not an error log. With
 *      three instances, two lose it on every single tick.
 *
 * SCOPE
 *
 * `index.ts` starts SEVEN crons in-process on `listen`: heatmap, ride expiry,
 * carpooling, listings, roadside, captain-track reap, metrics refresh. This
 * spec covers ride expiry as the representative case; apply the same helper to
 * the other six.
 *
 * WHY
 *
 * Today a second instance behind nginx double-expires rides, double-recomputes
 * the heatmap and double-sends carpooling reminders. That caps the API at one
 * process, which in turn means every deploy and every crash is a full dispatch
 * outage rather than a rolling restart. This is the single change that unblocks
 * horizontal scaling.
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pricingSettings } from './_fixtures.js';

const { poolQueryMock, settingsMock, redisMock } = vi.hoisted(() => ({
  poolQueryMock: vi.fn(),
  settingsMock: vi.fn(),
  redisMock: {
    set: vi.fn(),
    del: vi.fn(),
    eval: vi.fn(),
    get: vi.fn(),
  },
}));

vi.mock('../../src/db/pool.js', () => ({ pool: { query: poolQueryMock }, withTx: vi.fn() }));
vi.mock('../../src/modules/admin/app-settings.service.js', () => ({
  getPricingSettings: settingsMock,
}));
vi.mock('../../src/db/redis.js', () => ({ redis: redisMock, getRedis: () => redisMock }));

import { expireSearchingRides } from '../../src/modules/rides/expiry.service.js';

const EXPIRY_SRC = readFileSync(
  new URL('../../src/modules/rides/expiry.service.ts', import.meta.url),
  'utf8',
);

beforeEach(() => {
  vi.clearAllMocks();
  settingsMock.mockResolvedValue(pricingSettings({ searchingTimeoutS: 300 }));
  poolQueryMock.mockResolvedValue({ rows: [], rowCount: 2 });
  // Default: this instance wins the lock.
  redisMock.set.mockResolvedValue('OK');
});

describe('the expiry job coordinates with other instances', () => {
  it('takes a lock before touching any ride', async () => {
    await expireSearchingRides();

    const tookRedisLock = redisMock.set.mock.calls.length > 0;
    const tookAdvisoryLock = poolQueryMock.mock.calls.some(([sql]) =>
      /pg_try_advisory_lock/i.test(String(sql)));

    expect(
      tookRedisLock || tookAdvisoryLock,
      'No distributed lock is taken. A second API instance runs this same tick, so the API cannot be scaled past one process.',
    ).toBe(true);
  });

  it('skips the tick entirely when another instance holds the lock', async () => {
    // ioredis returns null when SET … NX finds the key already set.
    redisMock.set.mockResolvedValue(null);
    poolQueryMock.mockResolvedValue({ rows: [], rowCount: 0 });

    const result = await expireSearchingRides();

    const wrote = poolQueryMock.mock.calls.some(([sql]) => /UPDATE rides/i.test(String(sql)));
    expect(
      wrote,
      'The job did work despite losing the lock — two instances will both expire the same rides.',
    ).toBe(false);
    const count = typeof result === 'number' ? result : (result as any[])?.length ?? 0;
    expect(count).toBe(0);
  });

  it('sets a TTL so a crashed instance cannot wedge the job', async () => {
    await expireSearchingRides();

    expect(redisMock.set.mock.calls.length, 'No lock was taken at all').toBeGreaterThan(0);
    const args = redisMock.set.mock.calls[0]!.map(String);
    // SET key value NX PX <ttl>. Without the TTL, a process killed mid-tick
    // leaves the lock held forever and expiry silently stops platform-wide.
    expect(args.join(' ')).toMatch(/\bNX\b/i);
    expect(args.join(' ')).toMatch(/\bP?X\b/i);
  });

  it('treats losing the lock as normal, not as an error', async () => {
    redisMock.set.mockResolvedValue(null);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expireSearchingRides();

    // With three instances, two lose the lock on every tick. Logging that at
    // warn level buries the logs that matter.
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();

    warn.mockRestore();
    error.mockRestore();
  });
});

describe('the pattern is reusable across the seven crons', () => {
  it('the expiry service references a shared lock helper', async () => {
    // Copy-pasting the lock into seven files guarantees one of them drifts.
    // Extract it — e.g. `withClusterLock('ride-expiry', ttlMs, fn)` in lib/.
    expect(
      EXPIRY_SRC,
      'No shared lock helper is used. Extract one before applying this to the other six crons.',
    ).toMatch(/withClusterLock|withLock|acquireLock|tryLock/);
  });
});
