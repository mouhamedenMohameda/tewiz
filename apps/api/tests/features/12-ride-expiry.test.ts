/**
 * FEATURE 12 — Personne n'accepte : la course expire.
 *
 * The mechanism, covered here and in rides-expiry.service.test.ts: only rides
 * still 'searching' are touched, the timeout is a bound parameter, the job is
 * idempotent, and a failing tick does not kill the interval.
 *
 * Two further guarantees live in their own files:
 *   * telling the rider nobody came — 12-rider-notified-when-no-captain.test.ts
 *   * a distributed lock so the API can run more than one process —
 *     17-crons-take-a-distributed-lock.test.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pricingSettings } from './_fixtures.js';

const { poolQueryMock, settingsMock } = vi.hoisted(() => ({
  poolQueryMock: vi.fn(),
  settingsMock: vi.fn(),
}));

// The job now takes a cluster lock before doing any work. Mocked so this file
// stays about the SQL, and so importing it never opens a real Redis socket.
vi.mock('../../src/db/redis.js', () => ({
  redis: { set: vi.fn(async () => 'OK'), eval: vi.fn(async () => 1) },
}));
vi.mock('../../src/db/pool.js', () => ({ pool: { query: poolQueryMock } }));
vi.mock('../../src/modules/admin/app-settings.service.js', () => ({
  getPricingSettings: settingsMock,
}));

import { expireSearchingRides, startRideExpiryCron } from '../../src/modules/rides/expiry.service.js';

beforeEach(() => {
  vi.clearAllMocks();
  settingsMock.mockResolvedValue(pricingSettings({ searchingTimeoutS: 300 }));
  poolQueryMock.mockResolvedValue({ rows: [], rowCount: 2 });
});

describe('the job stays safe under repetition', () => {
  it('only ever touches rides still in searching', async () => {
    await expireSearchingRides();

    const [sql] = poolQueryMock.mock.calls[0]!;
    // A ride that was accepted a second before the tick must not be cancelled
    // out from under its captain.
    expect(String(sql)).toMatch(/WHERE status = 'searching'/);
  });

  it('is idempotent — a re-run finds nothing left to cancel', async () => {
    poolQueryMock
      .mockResolvedValueOnce({
        rows: [{ id: 'r1', booker_id: 'b1' }, { id: 'r2', booker_id: 'b2' }], rowCount: 2,
      })
      .mockResolvedValue({ rows: [], rowCount: 0 });

    expect(await expireSearchingRides()).toHaveLength(2);
    expect(await expireSearchingRides()).toHaveLength(0);
  });

  it('passes the timeout as a bound parameter, never interpolated', async () => {
    settingsMock.mockResolvedValue(pricingSettings({ searchingTimeoutS: 45 }));

    await expireSearchingRides();

    const [sql, params] = poolQueryMock.mock.calls[0]!;
    expect(String(sql)).toMatch(/make_interval\(secs => \$1\)/);
    expect(params).toEqual([45]);
  });

  it('is disabled entirely when the admin sets the timeout to 0', async () => {
    settingsMock.mockResolvedValue(pricingSettings({ searchingTimeoutS: 0 }));

    expect(await expireSearchingRides()).toEqual([]);
    expect(poolQueryMock).not.toHaveBeenCalled();
  });
});

describe('the cron keeps ticking', () => {
  it('schedules a first run shortly after boot, then every 30 s', async () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

    startRideExpiryCron();

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 30_000);
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 10_000);

    vi.useRealTimers();
  });

  it('survives a failing tick without killing the interval', async () => {
    vi.useFakeTimers();
    poolQueryMock.mockRejectedValue(new Error('connection terminated'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    startRideExpiryCron();
    await vi.advanceTimersByTimeAsync(11_000);
    await vi.advanceTimersByTimeAsync(31_000);

    // A transient DB blip must not silently stop expiring rides for the rest of
    // the process's life — that is how phantom searching rides accumulate.
    expect(warn).toHaveBeenCalled();
    expect(poolQueryMock.mock.calls.length).toBeGreaterThanOrEqual(2);

    warn.mockRestore();
    vi.useRealTimers();
  });
});
