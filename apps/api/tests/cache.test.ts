import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The Redis cache-aside helper.
//
// Redis was already in the stack but only ever held cron locks and geo sets, so
// every read that could have been cached still went to Postgres. Adding a cache
// is easy; adding one that cannot take the site down is the part worth testing.
//
// Three properties matter more than the caching itself:
//
//   1. It FAILS OPEN. A Redis outage must degrade us to "no cache" — the exact
//      behaviour we have today — and never to "no data". Same reasoning as
//      cluster-lock: the cache is an optimisation, and an optimisation that can
//      break a booking is a liability.
//   2. It COALESCES. N concurrent misses on one key must run the loader once.
//      This is what protects a billed upstream (Google Places) from a stampede
//      when a cold key is requested by ten riders at the same moment.
//   3. It never CACHES A FAILURE. A loader that throws must leave no trace —
//      neither a stored value nor a poisoned in-flight promise that every later
//      caller would await forever.

const { getMock, setMock, delMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  setMock: vi.fn(),
  delMock: vi.fn(),
}));

vi.mock('../src/db/redis.js', () => ({
  redis: { get: getMock, set: setMock, del: delMock },
}));
vi.mock('../src/lib/logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const { cached, invalidate, singleFlight, __resetInflight } = await import('../src/lib/cache.js');

/** A deferred promise, so a test can hold a loader open across concurrent calls. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  getMock.mockReset().mockResolvedValue(null);
  setMock.mockReset().mockResolvedValue('OK');
  delMock.mockReset().mockResolvedValue(1);
  __resetInflight();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('cached() — hit and miss', () => {
  it('returns the stored value without calling the loader on a hit', async () => {
    getMock.mockResolvedValue(JSON.stringify({ fare: 500 }));
    const loader = vi.fn();

    const out = await cached('pricing', 30_000, loader);

    expect(out).toEqual({ fare: 500 });
    expect(loader).not.toHaveBeenCalled();
    expect(setMock).not.toHaveBeenCalled();
  });

  it('calls the loader on a miss and stores the result with the given TTL', async () => {
    const loader = vi.fn().mockResolvedValue({ fare: 700 });

    const out = await cached('pricing', 30_000, loader);

    expect(out).toEqual({ fare: 700 });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(setMock).toHaveBeenCalledWith(
      'cache:pricing',
      JSON.stringify({ fare: 700 }),
      'PX',
      30_000,
    );
  });

  it('namespaces keys so a shared Redis cannot collide with cron locks', async () => {
    await cached('pricing', 1000, async () => 1);
    expect(getMock).toHaveBeenCalledWith('cache:pricing');
  });

  it('caches null, so a known-absent row does not re-query on every request', async () => {
    const loader = vi.fn().mockResolvedValue(null);
    await cached('missing-restaurant', 5_000, loader);
    expect(setMock).toHaveBeenCalledWith('cache:missing-restaurant', 'null', 'PX', 5_000);

    // And a stored "null" must read back as null rather than as a miss.
    getMock.mockResolvedValue('null');
    const loader2 = vi.fn();
    expect(await cached('missing-restaurant', 5_000, loader2)).toBeNull();
    expect(loader2).not.toHaveBeenCalled();
  });

  it('does not store undefined, which JSON cannot round-trip', async () => {
    const out = await cached('nothing', 5_000, async () => undefined);
    expect(out).toBeUndefined();
    expect(setMock).not.toHaveBeenCalled();
  });

  it('treats corrupt JSON as a miss instead of throwing', async () => {
    getMock.mockResolvedValue('{not json');
    const loader = vi.fn().mockResolvedValue('fresh');

    expect(await cached('k', 1000, loader)).toBe('fresh');
    expect(loader).toHaveBeenCalledTimes(1);
  });
});

describe('cached() — fails open', () => {
  it('serves from the loader when Redis GET is down', async () => {
    getMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const loader = vi.fn().mockResolvedValue('from-db');

    expect(await cached('k', 1000, loader)).toBe('from-db');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('still returns the value when Redis SET is down', async () => {
    setMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const loader = vi.fn().mockResolvedValue('from-db');

    expect(await cached('k', 1000, loader)).toBe('from-db');
  });

  it('propagates a loader failure rather than masking it as a cache miss', async () => {
    const loader = vi.fn().mockRejectedValue(new Error('db exploded'));
    await expect(cached('k', 1000, loader)).rejects.toThrow('db exploded');
    expect(setMock).not.toHaveBeenCalled();
  });
});

describe('cached() — single-flight', () => {
  it('runs the loader once for concurrent misses on the same key', async () => {
    const d = deferred<string>();
    const loader = vi.fn().mockReturnValue(d.promise);

    const all = Promise.all([
      cached('hot', 1000, loader),
      cached('hot', 1000, loader),
      cached('hot', 1000, loader),
    ]);
    // Let the three GETs resolve and all three land in the in-flight map.
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1));

    d.resolve('once');
    expect(await all).toEqual(['once', 'once', 'once']);
    expect(loader).toHaveBeenCalledTimes(1);
    // One shared result means one write, not three.
    expect(setMock).toHaveBeenCalledTimes(1);
  });

  it('does not coalesce across different keys', async () => {
    const loader = vi.fn().mockResolvedValue('v');
    await Promise.all([cached('a', 1000, loader), cached('b', 1000, loader)]);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('clears the in-flight entry after a rejection, so the next caller retries', async () => {
    const failing = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(cached('k', 1000, failing)).rejects.toThrow('boom');

    const ok = vi.fn().mockResolvedValue('recovered');
    expect(await cached('k', 1000, ok)).toBe('recovered');
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it('shares one rejection with every concurrent caller', async () => {
    const d = deferred<string>();
    const loader = vi.fn().mockReturnValue(d.promise);

    const a = cached('k', 1000, loader);
    const b = cached('k', 1000, loader);
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1));

    d.reject(new Error('shared failure'));
    await expect(a).rejects.toThrow('shared failure');
    await expect(b).rejects.toThrow('shared failure');
  });
});

describe('invalidate()', () => {
  it('deletes the namespaced key', async () => {
    await invalidate('pricing');
    expect(delMock).toHaveBeenCalledWith('cache:pricing');
  });

  it('never throws when Redis is down — a failed bust must not fail the write', async () => {
    delMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(invalidate('pricing')).resolves.toBeUndefined();
  });
});

describe('singleFlight() — standalone, no Redis', () => {
  it('collapses concurrent calls and runs the work once', async () => {
    const d = deferred<string>();
    const work = vi.fn().mockReturnValue(d.promise);

    const all = Promise.all([
      singleFlight('q:nouakchott', work),
      singleFlight('q:nouakchott', work),
    ]);
    await vi.waitFor(() => expect(work).toHaveBeenCalledTimes(1));

    d.resolve('places');
    expect(await all).toEqual(['places', 'places']);
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('runs the work again once the first call has settled', async () => {
    const work = vi.fn().mockResolvedValue('v');
    await singleFlight('k', work);
    await singleFlight('k', work);
    expect(work).toHaveBeenCalledTimes(2);
  });

  it('does not leak the in-flight entry when the work throws', async () => {
    const failing = vi.fn().mockRejectedValue(new Error('upstream 502'));
    await expect(singleFlight('k', failing)).rejects.toThrow('upstream 502');

    const ok = vi.fn().mockResolvedValue('ok');
    expect(await singleFlight('k', ok)).toBe('ok');
  });
});
