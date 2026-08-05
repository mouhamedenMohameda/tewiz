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
// The job now takes a cluster lock before doing any work. Mocked so this file
// stays about the SQL, and so importing it never opens a real Redis socket.
vi.mock('../src/db/redis.js', () => ({
  redis: { set: vi.fn(async () => 'OK'), eval: vi.fn(async () => 1) },
}));
vi.mock('../src/modules/admin/app-settings.service.js', () => ({
  getPricingSettings: getPricingSettingsMock,
}));
// The job now notifies each affected rider. Stubbed so this file stays about
// the SQL — and so it never reaches the real Expo endpoint over the network.
vi.mock('../src/modules/push/expo-push.js', () => ({
  notifyRiderRideExpired: vi.fn(async () => {}),
}));

import { expireSearchingRides } from '../src/modules/rides/expiry.service.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('expireSearchingRides', () => {
  it('is a no-op (no DB write) when the timeout is 0', async () => {
    getPricingSettingsMock.mockResolvedValue({ searchingTimeoutS: 0 });

    const expired = await expireSearchingRides();

    expect(expired).toEqual([]);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('is a no-op when the timeout is negative', async () => {
    getPricingSettingsMock.mockResolvedValue({ searchingTimeoutS: -5 });

    const expired = await expireSearchingRides();

    expect(expired).toEqual([]);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('cancels only stale searching rides and returns them', async () => {
    getPricingSettingsMock.mockResolvedValue({ searchingTimeoutS: 120 });
    queryMock.mockResolvedValue({
      rows: [
        { id: 'r1', booker_id: 'b1' },
        { id: 'r2', booker_id: 'b2' },
        { id: 'r3', booker_id: 'b3' },
      ],
      rowCount: 3,
    });

    const expired = await expireSearchingRides();

    // RETURNING is what makes notifying the affected riders possible at all.
    expect(expired).toEqual([
      { id: 'r1', bookerId: 'b1' },
      { id: 'r2', bookerId: 'b2' },
      { id: 'r3', bookerId: 'b3' },
    ]);
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

  it('returns an empty list when nothing was stale', async () => {
    getPricingSettingsMock.mockResolvedValue({ searchingTimeoutS: 120 });
    queryMock.mockResolvedValue({ rows: [] });

    const expired = await expireSearchingRides();

    expect(expired).toEqual([]);
  });
});
