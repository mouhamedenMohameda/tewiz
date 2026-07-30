import { beforeEach, describe, expect, it, vi } from 'vitest';

// The DISPATCH_GEO_SOURCE rollout switch.
//
// This is the only place in the codebase where the same question ("who is
// eligible for this ride?") can be answered by two different systems, so these
// tests are about the switch itself rather than about either query: that
// `postgres` still behaves exactly as before, that `shadow` always SERVES the
// PostGIS answer while counting disagreements, that `redis` falls back instead
// of failing, and — the one that actually protects riders — that an empty Redis
// result is never confused with a Redis outage.

const { queryMock, captainsNearMock, envMock, trackingMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  captainsNearMock: vi.fn(),
  trackingMock: vi.fn(),
  envMock: {
    DISPATCH_GEO_SOURCE: 'postgres' as 'postgres' | 'shadow' | 'redis',
    DISPATCH_RADIUS_M: 3000,
    DISPATCH_MAX_LOCATION_AGE_S: 900,
    DISPATCH_TOP_N: 5,
    METRICS_REFRESH_MS: 30_000,
    SLOW_QUERY_MS: 0,
  },
}));

vi.mock('../src/db/pool.js', () => ({ pool: { query: queryMock } }));
vi.mock('../src/config/env.js', () => ({ env: envMock }));
vi.mock('../src/modules/captain/live-location.js', () => ({ captainsNear: captainsNearMock }));
vi.mock('../src/modules/captain/track.service.js', () => ({ isTrackingEnabled: trackingMock }));
vi.mock('../src/modules/admin/app-settings.service.js', () => ({
  getPricingSettings: () => Promise.resolve({ longDistanceThresholdM: 30_000 }),
}));

const { eligibleCaptainsForRide } = await import('../src/modules/rides/dispatch.service.js');
const { dispatchGeoFallback, dispatchGeoMismatch, dispatchEligibleDuration } =
  await import('../src/lib/metrics.js');

const PICKUP = { lat: '18.0858', lng: '-15.9785' };

/** Route the mocked pool by which of the three queries the SQL is. */
function stubSql(opts: {
  pickup?: { lat: string | null; lng: string | null } | null;
  postgres?: string[];
  candidates?: string[];
}) {
  queryMock.mockImplementation(async (sql: string) => {
    if (sql.includes('AS lat')) {
      const p = opts.pickup === undefined ? PICKUP : opts.pickup;
      return { rows: p ? [p] : [], rowCount: p ? 1 : 0 };
    }
    if (sql.includes('ST_DWithin')) {
      const ids = opts.postgres ?? [];
      return { rows: ids.map((id) => ({ captain_id: id })), rowCount: ids.length };
    }
    if (sql.includes('ANY($3::uuid[])')) {
      const ids = opts.candidates ?? [];
      return { rows: ids.map((id) => ({ captain_id: id })), rowCount: ids.length };
    }
    return { rows: [], rowCount: 0 };
  });
}

/** Total value of a counter across all label combinations. */
async function counterTotal(c: { get: () => Promise<{ values: { value: number }[] }> }) {
  const { values } = await c.get();
  return values.reduce((sum, v) => sum + v.value, 0);
}

/** Value of the fallback counter for one reason label. */
async function fallbackFor(reason: 'redis_error' | 'no_pickup') {
  const { values } = await dispatchGeoFallback.get();
  return values.find((v) => (v.labels as { reason?: string }).reason === reason)?.value ?? 0;
}

/** Value of the mismatch counter for one direction label. */
async function mismatchFor(direction: 'missing' | 'extra') {
  const { values } = await dispatchGeoMismatch.get();
  return values.find((v) => (v.labels as { direction?: string }).direction === direction)?.value ?? 0;
}

/** SQL texts the mocked pool saw, for asserting which path ran. */
function sqlSeen() {
  return queryMock.mock.calls.map((c) => String(c[0]));
}

/** Number of observations recorded for one value of the `source` label. */
async function eligibleCountFor(source: string) {
  const { values } = await dispatchEligibleDuration.get();
  return values.find(
    (v) => (v as { metricName?: string }).metricName === 'tewiz_dispatch_eligible_duration_seconds_count'
      && (v.labels as { source?: string }).source === source,
  )?.value ?? 0;
}

beforeEach(() => {
  vi.clearAllMocks();
  dispatchGeoFallback.reset();
  dispatchGeoMismatch.reset();
  dispatchEligibleDuration.reset();
  trackingMock.mockResolvedValue(true);
  envMock.DISPATCH_GEO_SOURCE = 'postgres';
});

describe("DISPATCH_GEO_SOURCE='postgres' (the default)", () => {
  it('uses the PostGIS query and never touches Redis', async () => {
    stubSql({ postgres: ['c1', 'c2'] });

    expect(await eligibleCaptainsForRide('ride-1')).toEqual(['c1', 'c2']);
    expect(captainsNearMock).not.toHaveBeenCalled();
    expect(sqlSeen().some((s) => s.includes('ST_DWithin'))).toBe(true);
  });

  it('does not spend a query looking up the pickup point', async () => {
    // The pickup lookup only exists to feed GEOSEARCH; the default path must
    // stay exactly as cheap as it was before this change.
    stubSql({ postgres: ['c1'] });
    await eligibleCaptainsForRide('ride-1');

    expect(sqlSeen().some((s) => s.includes('AS lat'))).toBe(false);
  });
});

describe("DISPATCH_GEO_SOURCE='redis'", () => {
  beforeEach(() => { envMock.DISPATCH_GEO_SOURCE = 'redis'; });

  it('narrows by GEOSEARCH, then applies the business rules in Postgres', async () => {
    captainsNearMock.mockResolvedValue(['c1', 'c2', 'c3']);
    stubSql({ candidates: ['c1', 'c3'] });

    expect(await eligibleCaptainsForRide('ride-1')).toEqual(['c1', 'c3']);
    expect(captainsNearMock).toHaveBeenCalledWith(18.0858, -15.9785, 3000, 900);
    expect(sqlSeen().some((s) => s.includes('ST_DWithin'))).toBe(false);
  });

  it('drops the freshness window when off-ride tracking is disabled', async () => {
    // The PostGIS query skips its stale-position guard when tracking is off, so
    // Redis has to as well. Enforcing it on only one side would make `redis`
    // mode quietly unreachable for captains `postgres` mode still notifies.
    trackingMock.mockResolvedValue(false);
    captainsNearMock.mockResolvedValue(['c1']);
    stubSql({ candidates: ['c1'] });

    await eligibleCaptainsForRide('ride-1');
    expect(captainsNearMock).toHaveBeenCalledWith(18.0858, -15.9785, 3000, null);
  });

  it('returns nobody without a fallback when Redis says nobody is nearby', async () => {
    // The distinction this whole design rests on: [] is a real answer. Treating
    // it as a failure would send every quiet-area ride down the slow path and
    // hide the fact that there genuinely are no captains.
    captainsNearMock.mockResolvedValue([]);
    stubSql({ postgres: ['c1'] });

    expect(await eligibleCaptainsForRide('ride-1')).toEqual([]);
    expect(sqlSeen().some((s) => s.includes('ST_DWithin'))).toBe(false);
    expect(await counterTotal(dispatchGeoFallback)).toBe(0);
  });

  it('falls back to PostGIS and counts it when Redis is down', async () => {
    captainsNearMock.mockRejectedValue(new Error('ECONNREFUSED'));
    stubSql({ postgres: ['c1', 'c2'] });

    expect(await eligibleCaptainsForRide('ride-1')).toEqual(['c1', 'c2']);
    expect(await fallbackFor('redis_error')).toBe(1);
    expect(await fallbackFor('no_pickup')).toBe(0);
  });

  it('falls back when the ride has no pickup point, under its own reason', async () => {
    // These two were indistinguishable at first, and the very first shadow ride
    // in production fell back without anyone being able to say which had
    // happened — a Redis outage and a ride with no pickup point have nothing in
    // common and call for opposite responses.
    stubSql({ pickup: null, postgres: ['c1'] });

    expect(await eligibleCaptainsForRide('ride-1')).toEqual(['c1']);
    expect(captainsNearMock).not.toHaveBeenCalled();
    expect(await fallbackFor('no_pickup')).toBe(1);
    expect(await fallbackFor('redis_error')).toBe(0);
  });
});

describe("DISPATCH_GEO_SOURCE='shadow'", () => {
  beforeEach(() => { envMock.DISPATCH_GEO_SOURCE = 'shadow'; });

  it('serves the PostGIS answer even when Redis disagrees', async () => {
    captainsNearMock.mockResolvedValue(['c1']);
    stubSql({ postgres: ['c1', 'c2'], candidates: ['c1'] });

    // Shadow mode must be observationally identical to postgres mode for riders.
    expect(await eligibleCaptainsForRide('ride-1')).toEqual(['c1', 'c2']);
  });

  it("counts a captain PostGIS found and Redis missed as 'missing'", async () => {
    // The dangerous direction: in redis mode that captain would never have been
    // notified at all.
    captainsNearMock.mockResolvedValue(['c1']);
    stubSql({ postgres: ['c1', 'c2'], candidates: ['c1'] });

    await eligibleCaptainsForRide('ride-1');
    expect(await mismatchFor('missing')).toBe(1);
    expect(await mismatchFor('extra')).toBe(0);
  });

  it("counts a captain only Redis found as 'extra'", async () => {
    captainsNearMock.mockResolvedValue(['c1', 'c2']);
    stubSql({ postgres: ['c1'], candidates: ['c1', 'c2'] });

    await eligibleCaptainsForRide('ride-1');
    expect(await mismatchFor('extra')).toBe(1);
    expect(await mismatchFor('missing')).toBe(0);
  });

  it('stays at zero when the two sources agree — the signal to promote to redis', async () => {
    captainsNearMock.mockResolvedValue(['c1', 'c2']);
    stubSql({ postgres: ['c1', 'c2'], candidates: ['c1', 'c2'] });

    await eligibleCaptainsForRide('ride-1');
    expect(await counterTotal(dispatchGeoMismatch)).toBe(0);
  });

  it('ignores ordering differences between the two sources', async () => {
    // GEOSEARCH returns nearest-first; the PostGIS query has no ORDER BY. Only
    // set membership is meaningful, so ordering must not raise a false alarm
    // that would keep us from ever promoting to redis.
    captainsNearMock.mockResolvedValue(['c2', 'c1']);
    stubSql({ postgres: ['c1', 'c2'], candidates: ['c2', 'c1'] });

    await eligibleCaptainsForRide('ride-1');
    expect(await counterTotal(dispatchGeoMismatch)).toBe(0);
  });

  it('counts a fallback, not a mismatch, when Redis is down', async () => {
    captainsNearMock.mockRejectedValue(new Error('ECONNREFUSED'));
    stubSql({ postgres: ['c1'] });

    expect(await eligibleCaptainsForRide('ride-1')).toEqual(['c1']);
    expect(await fallbackFor('redis_error')).toBe(1);
    expect(await counterTotal(dispatchGeoMismatch)).toBe(0);
  });

  it('a fallback means NOTHING was compared — zero mismatches is not agreement', async () => {
    // The trap this whole label exists for. In shadow mode a fallen-back ride
    // produces no mismatch series at all, which reads exactly like "the two
    // sources agreed". It does not: it means Redis never answered. Any reading
    // of the mismatch counter has to be paired with the fallback counter.
    captainsNearMock.mockRejectedValue(new Error('ECONNREFUSED'));
    stubSql({ postgres: ['c1', 'c2'] });

    await eligibleCaptainsForRide('ride-1');

    expect(await counterTotal(dispatchGeoMismatch)).toBe(0);
    expect(await counterTotal(dispatchGeoFallback)).toBe(1);
    // The comparison ran zero times despite the histogram counting the call.
    expect(await eligibleCountFor('shadow')).toBe(1);
  });
});

describe('tewiz_dispatch_eligible_duration_seconds', () => {
  // The metric for this migration. tewiz_dispatch_inbox_duration_seconds measures
  // captainInbox, which scans `rides` and never read captain_state, so it cannot
  // show this change at all — timing the wrong query is how a rewrite gets
  // declared a success on evidence that never moved.

  it('times the selection under the source that served it', async () => {
    envMock.DISPATCH_GEO_SOURCE = 'redis';
    captainsNearMock.mockResolvedValue(['c1']);
    stubSql({ candidates: ['c1'] });

    await eligibleCaptainsForRide('ride-1');

    expect(await eligibleCountFor('redis')).toBe(1);
    expect(await eligibleCountFor('postgres')).toBe(0);
  });

  it('keeps each source on its own series, so the two are comparable', async () => {
    stubSql({ postgres: ['c1'] });
    await eligibleCaptainsForRide('ride-1');

    envMock.DISPATCH_GEO_SOURCE = 'shadow';
    captainsNearMock.mockResolvedValue(['c1']);
    stubSql({ postgres: ['c1'], candidates: ['c1'] });
    await eligibleCaptainsForRide('ride-2');

    expect(await eligibleCountFor('postgres')).toBe(1);
    expect(await eligibleCountFor('shadow')).toBe(1);
  });

  it('still records a timing when the call falls back', async () => {
    // Observed in a `finally`. A migration measured only on its happy path tells
    // you nothing about the day it starts failing — and the fallback path is the
    // slow one, so leaving it out would flatter the numbers exactly when they
    // should look bad.
    envMock.DISPATCH_GEO_SOURCE = 'redis';
    captainsNearMock.mockRejectedValue(new Error('ECONNREFUSED'));
    stubSql({ postgres: ['c1'] });

    await eligibleCaptainsForRide('ride-1');

    expect(await eligibleCountFor('redis')).toBe(1);
  });

  it('records a timing even when the selection throws', async () => {
    envMock.DISPATCH_GEO_SOURCE = 'postgres';
    queryMock.mockRejectedValue(new Error('connection terminated'));

    await expect(eligibleCaptainsForRide('ride-1')).rejects.toThrow('connection terminated');
    expect(await eligibleCountFor('postgres')).toBe(1);
  });
});
