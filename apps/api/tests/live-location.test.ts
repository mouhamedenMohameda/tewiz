import { beforeEach, describe, expect, it, vi } from 'vitest';

// The Redis-backed live captain index. What is worth testing here is not "does
// ioredis work" but the decisions layered on top of it: that lng/lat never get
// swapped, that a missing freshness score is treated as stale rather than
// fresh, that an empty result is distinguishable from a failure (one is "nobody
// is nearby", the other must let dispatch fall back to PostGIS), and that the
// write path can never take a request down with it.
//
// Both redis and pool are mocked, in the same style as metrics.test.ts.

const { redisMock, queryMock } = vi.hoisted(() => ({
  redisMock: {
    multi: vi.fn(),
    pipeline: vi.fn(),
    geosearch: vi.fn(),
    zmscore: vi.fn(),
    on: vi.fn(),
  },
  queryMock: vi.fn(),
}));

vi.mock('../src/db/redis.js', () => ({ redis: redisMock }));
vi.mock('../src/db/pool.js', () => ({ pool: { query: queryMock } }));

const {
  setLiveLocation,
  clearLiveLocation,
  captainsNear,
  warmLiveLocations,
  GEO_KEY,
  SEEN_KEY,
} = await import('../src/modules/captain/live-location.js');

/**
 * A chainable stand-in for redis.multi() / redis.pipeline() that records the
 * commands queued against it, so a test can assert on argument ORDER — the one
 * mistake in this module that a type checker cannot catch.
 */
function chain(execImpl?: () => Promise<unknown>) {
  const calls: unknown[][] = [];
  const self: Record<string, unknown> = { calls };
  for (const cmd of ['geoadd', 'zadd', 'zrem'] as const) {
    self[cmd] = vi.fn((...args: unknown[]) => {
      calls.push([cmd, ...args]);
      return self;
    });
  }
  self.exec = vi.fn(execImpl ?? (() => Promise.resolve([])));
  return self as { calls: unknown[][]; exec: ReturnType<typeof vi.fn> };
}

beforeEach(() => {
  vi.clearAllMocks();
  queryMock.mockResolvedValue({ rows: [] });
});

describe('setLiveLocation', () => {
  it('writes the geo member as (lng, lat) and stamps freshness', async () => {
    const c = chain();
    redisMock.multi.mockReturnValue(c);

    const before = Date.now();
    await setLiveLocation('captain-1', 18.0858, -15.9785);

    // GEOADD takes longitude FIRST. Nouakchott sits at lat ~18, lng ~-16, so a
    // swap here would put every captain in the Atlantic off Liberia.
    expect(c.calls[0]).toEqual(['geoadd', GEO_KEY, -15.9785, 18.0858, 'captain-1']);

    const [cmd, key, score, member] = c.calls[1] as [string, string, number, string];
    expect(cmd).toBe('zadd');
    expect(key).toBe(SEEN_KEY);
    expect(member).toBe('captain-1');
    expect(score).toBeGreaterThanOrEqual(before);
    expect(c.exec).toHaveBeenCalledOnce();
  });

  it('never throws when redis is down — the position report must still succeed', async () => {
    redisMock.multi.mockReturnValue(chain(() => Promise.reject(new Error('ECONNREFUSED'))));
    await expect(setLiveLocation('captain-1', 18, -16)).resolves.toBeUndefined();
  });
});

describe('clearLiveLocation', () => {
  it('removes the captain from both keys', async () => {
    const c = chain();
    redisMock.multi.mockReturnValue(c);

    await clearLiveLocation('captain-1');

    // A GEO key IS a sorted set, so ZREM is the correct removal for both.
    expect(c.calls).toEqual([
      ['zrem', GEO_KEY, 'captain-1'],
      ['zrem', SEEN_KEY, 'captain-1'],
    ]);
  });

  it('never throws when redis is down', async () => {
    redisMock.multi.mockReturnValue(chain(() => Promise.reject(new Error('ECONNREFUSED'))));
    await expect(clearLiveLocation('captain-1')).resolves.toBeUndefined();
  });
});

describe('captainsNear', () => {
  it('queries FROMLONLAT with lng before lat, by radius, nearest first', async () => {
    redisMock.geosearch.mockResolvedValue([]);

    await captainsNear(18.0858, -15.9785, 3000, 900);

    expect(redisMock.geosearch).toHaveBeenCalledWith(
      GEO_KEY, 'FROMLONLAT', -15.9785, 18.0858, 'BYRADIUS', 3000, 'm', 'ASC',
    );
  });

  it('short-circuits without a ZMSCORE round trip when nothing is nearby', async () => {
    redisMock.geosearch.mockResolvedValue([]);

    expect(await captainsNear(18, -16, 3000, 900)).toEqual([]);
    expect(redisMock.zmscore).not.toHaveBeenCalled();
  });

  it('drops captains whose position is older than maxAgeS', async () => {
    const now = Date.now();
    redisMock.geosearch.mockResolvedValue(['fresh', 'stale']);
    redisMock.zmscore.mockResolvedValue([
      String(now - 10_000),   // 10s old — well inside the window
      String(now - 950_000),  // ~16 min old — past a 900s window
    ]);

    expect(await captainsNear(18, -16, 3000, 900)).toEqual(['fresh']);
  });

  it('treats a missing freshness score as stale, not fresh', async () => {
    // A member can exist in the geo key with no `seen` score if a write was
    // interrupted between the two commands. Trusting it would resurrect a
    // captain who may have been parked at that point for hours.
    redisMock.geosearch.mockResolvedValue(['scored', 'orphan']);
    redisMock.zmscore.mockResolvedValue([String(Date.now()), null]);

    expect(await captainsNear(18, -16, 3000, 900)).toEqual(['scored']);
  });

  it('preserves the nearest-first ordering GEOSEARCH returned', async () => {
    const now = Date.now();
    redisMock.geosearch.mockResolvedValue(['near', 'mid', 'far']);
    redisMock.zmscore.mockResolvedValue([String(now), String(now), String(now)]);

    expect(await captainsNear(18, -16, 3000, 900)).toEqual(['near', 'mid', 'far']);
  });

  it('skips the freshness filter entirely when maxAgeS is null', async () => {
    // Mirrors the PostGIS path, which only applies its stale-position guard
    // while off-ride tracking is on. Filtering here regardless would make
    // `redis` mode drop captains `postgres` mode still reaches.
    redisMock.geosearch.mockResolvedValue(['ancient', 'orphan']);

    expect(await captainsNear(18, -16, 3000, null)).toEqual(['ancient', 'orphan']);
    expect(redisMock.zmscore).not.toHaveBeenCalled();
  });

  it('propagates redis errors so the caller can fall back to PostGIS', async () => {
    // Deliberately NOT swallowed here: an empty array means "nobody is nearby"
    // and must not trigger a fallback, so failure has to be distinguishable.
    redisMock.geosearch.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(captainsNear(18, -16, 3000, 900)).rejects.toThrow('ECONNREFUSED');
  });
});

describe('warmLiveLocations', () => {
  it('reloads every non-offline captain with a position into both keys', async () => {
    const c = chain();
    redisMock.pipeline.mockReturnValue(c);
    queryMock.mockResolvedValue({
      rows: [
        { captain_id: 'c1', lat: '18.0858', lng: '-15.9785', seen_ms: '1700000000000' },
        { captain_id: 'c2', lat: '18.1000', lng: '-15.9500', seen_ms: '1700000001000' },
      ],
    });

    expect(await warmLiveLocations()).toBe(2);
    expect(c.calls).toEqual([
      ['geoadd', GEO_KEY, -15.9785, 18.0858, 'c1'],
      ['zadd', SEEN_KEY, 1700000000000, 'c1'],
      ['geoadd', GEO_KEY, -15.95, 18.1, 'c2'],
      ['zadd', SEEN_KEY, 1700000001000, 'c2'],
    ]);
  });

  it('only reloads captains who are not offline and have a location', async () => {
    redisMock.pipeline.mockReturnValue(chain());
    await warmLiveLocations();

    const sql = String(queryMock.mock.calls[0]?.[0]);
    expect(sql).toMatch(/presence <> 'offline'/);
    expect(sql).toMatch(/location IS NOT NULL/);
  });

  it('skips rows with unusable coordinates instead of poisoning the index', async () => {
    const c = chain();
    redisMock.pipeline.mockReturnValue(c);
    queryMock.mockResolvedValue({
      rows: [
        { captain_id: 'bad', lat: null, lng: null, seen_ms: '1700000000000' },
        { captain_id: 'ok', lat: '18.0858', lng: '-15.9785', seen_ms: '1700000000000' },
      ],
    });

    await warmLiveLocations();
    expect(c.calls).toEqual([
      ['geoadd', GEO_KEY, -15.9785, 18.0858, 'ok'],
      ['zadd', SEEN_KEY, 1700000000000, 'ok'],
    ]);
  });

  it('seeds a captain with no location_updated_at as just-seen', async () => {
    const c = chain();
    redisMock.pipeline.mockReturnValue(c);
    queryMock.mockResolvedValue({
      rows: [{ captain_id: 'legacy', lat: '18', lng: '-16', seen_ms: null }],
    });

    const before = Date.now();
    await warmLiveLocations();

    // Warming it in as stale would put it in the geo key only for the freshness
    // filter to discard it — worse than trusting a position Postgres considers
    // current.
    expect(c.calls[1]![2] as number).toBeGreaterThanOrEqual(before);
  });

  it('never throws when the warm-up fails — the API must still start', async () => {
    queryMock.mockRejectedValue(new Error('relation "captain_state" does not exist'));
    await expect(warmLiveLocations()).resolves.toBe(0);
  });
});
