import { beforeEach, describe, expect, it, vi } from 'vitest';

// Background job that auto-cancels rides stuck in 'searching'. The service
// reads searchingTimeoutS from app settings, then runs a single guarded
// UPDATE. We mock both the pool and the settings source so we can assert the
// no-op short-circuit, the SQL shape, and the returned count in isolation.

const { queryMock, getPricingSettingsMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  getPricingSettingsMock: vi.fn(),
}));

vi.mock('../src/db/pool.js', () => ({
  pool: { query: queryMock },
}));
vi.mock('../src/modules/admin/app-settings.service.js', () => ({
  getPricingSettings: getPricingSettingsMock,
}));

import { expireSearchingRides } from '../src/modules/rides/expiry.service.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('expireSearchingRides', () => {
  it('is a no-op (no DB write) when the timeout is 0', async () => {
    getPricingSettingsMock.mockResolvedValue({ searchingTimeoutS: 0 });

    const n = await expireSearchingRides();

    expect(n).toBe(0);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('is a no-op when the timeout is negative', async () => {
    getPricingSettingsMock.mockResolvedValue({ searchingTimeoutS: -5 });

    const n = await expireSearchingRides();

    expect(n).toBe(0);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('cancels only stale searching rides and returns the affected count', async () => {
    getPricingSettingsMock.mockResolvedValue({ searchingTimeoutS: 120 });
    queryMock.mockResolvedValue({ rows: [], rowCount: 3 });

    const n = await expireSearchingRides();

    expect(n).toBe(3);
    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql, params] = queryMock.mock.calls[0];
    // Only affects rides still in 'searching', flips them to system-cancelled
    // with the no-captain reason, and scopes by the age window.
    expect(sql).toMatch(/UPDATE rides/);
    expect(sql).toMatch(/status\s*=\s*'cancelled_by_system'/);
    expect(sql).toMatch(/cancel_reason\s*=\s*'no_captain_accepted'/);
    expect(sql).toMatch(/WHERE status = 'searching'/);
    expect(sql).toMatch(/make_interval\(secs => \$1\)/);
    // The timeout is passed as the interval parameter, never string-interpolated.
    expect(params).toEqual([120]);
  });

  it('returns 0 when rowCount comes back null/undefined', async () => {
    getPricingSettingsMock.mockResolvedValue({ searchingTimeoutS: 120 });
    queryMock.mockResolvedValue({ rows: [] });

    const n = await expireSearchingRides();

    expect(n).toBe(0);
  });
});
