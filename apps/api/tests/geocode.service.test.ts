import { beforeEach, describe, expect, it, vi } from 'vitest';

// The place-search service.
//
// This service was untested: `misc.routes.test.ts` mocks it wholesale to test
// the route around it, so nothing covered the upstream calls themselves. That
// matters more than usual here, because this is the one path in the API that
// costs money per call — the Google field mask carries a comment saying exactly
// that — and it is called on every keystroke-ish search from the rider app.
//
// The first two blocks are characterisation: they lock the CURRENT mapping of
// Google and Nominatim responses so the caching work below cannot quietly
// change what a caller receives. The rest cover what was added: a Redis entry
// per normalised query, and single-flight so a burst of identical searches
// bills one upstream call instead of one per rider.

const { fetchMock, envMock, cachedMock, singleFlightMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  envMock: {
    GOOGLE_PLACES_API_KEY: 'test-key' as string | undefined,
    GEOCODE_CACHE_TTL_MS: 3_600_000,
  },
  cachedMock: vi.fn(),
  singleFlightMock: vi.fn(),
}));

vi.mock('../src/config/env.js', () => ({ env: envMock }));
vi.mock('../src/lib/cache.js', () => ({
  cached: cachedMock,
  singleFlight: singleFlightMock,
}));

const { searchPlaces } = await import('../src/modules/geocode/geocode.service.js');

const GOOGLE_PLACE = {
  id: 'place-1',
  displayName: { text: 'Marché Capitale' },
  formattedAddress: 'Avenue Gamal Abdel Nasser, Nouakchott',
  location: { latitude: 18.0858, longitude: -15.9785 },
  types: ['market', 'point_of_interest'],
};

function okJson(body: unknown) {
  return { ok: true, json: async () => body, text: async () => JSON.stringify(body) };
}

beforeEach(() => {
  envMock.GOOGLE_PLACES_API_KEY = 'test-key';
  envMock.GEOCODE_CACHE_TTL_MS = 3_600_000;
  fetchMock.mockReset();
  // By default both wrappers are transparent, so the characterisation blocks
  // exercise the real upstream path rather than the cache.
  cachedMock.mockReset().mockImplementation(async (_k: string, _t: number, loader: () => unknown) => loader());
  singleFlightMock.mockReset().mockImplementation((_k: string, work: () => unknown) => work());
  vi.stubGlobal('fetch', fetchMock);
});

describe('searchPlaces — Google Places path (characterisation)', () => {
  it('maps a Google place onto the GeocodeResult shape', async () => {
    fetchMock.mockResolvedValue(okJson({ places: [GOOGLE_PLACE] }));

    const out = await searchPlaces({ q: 'marche' });

    expect(out).toEqual([
      {
        id: 'place-1',
        label: 'Avenue Gamal Abdel Nasser, Nouakchott',
        name: 'Marché Capitale',
        lat: 18.0858,
        lng: -15.9785,
        types: ['market', 'point_of_interest'],
      },
    ]);
  });

  it('keeps the billing-sensitive field mask and the MR/fr bias', async () => {
    fetchMock.mockResolvedValue(okJson({ places: [] }));
    await searchPlaces({ q: 'marche' });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://places.googleapis.com/v1/places:searchText');
    expect(init.headers['X-Goog-FieldMask']).toBe(
      'places.id,places.displayName,places.formattedAddress,places.location,places.types',
    );
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ textQuery: 'marche', languageCode: 'fr', regionCode: 'MR' });
  });

  it('clamps limit into 1..10 and applies the 50 km proximity bias', async () => {
    fetchMock.mockResolvedValue(okJson({ places: [] }));
    await searchPlaces({ q: 'marche', proximity: '-15.9785,18.0858', limit: 99 });

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.maxResultCount).toBe(10);
    expect(body.locationBias).toEqual({
      circle: { center: { latitude: 18.0858, longitude: -15.9785 }, radius: 50_000 },
    });
  });

  it('raises a 502 geocoder_failed when Google rejects the request', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, text: async () => 'denied' });
    await expect(searchPlaces({ q: 'marche' })).rejects.toMatchObject({
      status: 502,
      code: 'geocoder_failed',
    });
  });
});

describe('searchPlaces — Nominatim fallback (characterisation)', () => {
  beforeEach(() => {
    envMock.GOOGLE_PLACES_API_KEY = undefined;
  });

  it('falls back to Nominatim when no Google key is configured', async () => {
    fetchMock.mockResolvedValue(
      okJson([
        {
          place_id: 42,
          lat: '18.09',
          lon: '-15.98',
          display_name: 'Marché Capitale, Nouakchott',
          name: 'Marché Capitale',
          class: 'amenity',
          type: 'marketplace',
        },
      ]),
    );

    const out = await searchPlaces({ q: 'marche' });

    expect(String(fetchMock.mock.calls[0]![0])).toContain('nominatim.openstreetmap.org');
    expect(out[0]).toMatchObject({
      id: '42',
      name: 'Marché Capitale',
      lat: 18.09,
      lng: -15.98,
      types: ['amenity', 'marketplace'],
    });
  });

  it('sends the contactable User-Agent the Nominatim policy requires', async () => {
    fetchMock.mockResolvedValue(okJson([]));
    await searchPlaces({ q: 'marche' });
    expect(fetchMock.mock.calls[0]![1].headers['User-Agent']).toContain('Tewiz');
  });
});

describe('searchPlaces — caching', () => {
  it('reads through the cache with the configured TTL', async () => {
    fetchMock.mockResolvedValue(okJson({ places: [] }));
    await searchPlaces({ q: 'marche' });

    expect(cachedMock).toHaveBeenCalledTimes(1);
    const [key, ttl] = cachedMock.mock.calls[0]!;
    expect(key).toContain('geocode:');
    expect(ttl).toBe(3_600_000);
  });

  it('serves a cache hit without calling any upstream', async () => {
    const hit = [{ id: 'cached', label: 'L', name: 'N', lat: 1, lng: 2, types: [] }];
    cachedMock.mockResolvedValue(hit);

    expect(await searchPlaces({ q: 'marche' })).toEqual(hit);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('normalises the key so case and stray whitespace share one entry', async () => {
    fetchMock.mockResolvedValue(okJson({ places: [] }));

    await searchPlaces({ q: 'Marché   Capitale ' });
    await searchPlaces({ q: 'marché capitale' });

    const [k1] = cachedMock.mock.calls[0]!;
    const [k2] = cachedMock.mock.calls[1]!;
    expect(k1).toBe(k2);
  });

  it('separates entries that would return different results', async () => {
    fetchMock.mockResolvedValue(okJson({ places: [] }));

    await searchPlaces({ q: 'marche' });
    await searchPlaces({ q: 'marche', proximity: '-15.9,18.0' });
    await searchPlaces({ q: 'marche', limit: 10 });

    const keys = cachedMock.mock.calls.map((c) => c[0]);
    expect(new Set(keys).size).toBe(3);
  });

  it('caches an empty result, so a fruitless search is not re-billed', async () => {
    fetchMock.mockResolvedValue(okJson({ places: [] }));
    expect(await searchPlaces({ q: 'zzz' })).toEqual([]);
    // The loader ran inside cached(), which is what stores it.
    expect(cachedMock).toHaveBeenCalledTimes(1);
  });

  it('does not cache an upstream failure', async () => {
    // cached() propagates loader rejections without storing; assert the service
    // lets that happen rather than swallowing the error into an empty list.
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    await expect(searchPlaces({ q: 'marche' })).rejects.toMatchObject({ status: 502 });
  });
});

describe('searchPlaces — real cache integration', () => {
  it('bills one upstream call for a burst of identical concurrent searches', async () => {
    // Swap the mocked cache for the real one, backed by an in-memory Redis.
    // The top-level vi.mock of lib/cache.js is hoisted and survives
    // resetModules, so it has to be explicitly unmocked or this test would
    // silently keep exercising the passthrough stub and prove nothing.
    vi.resetModules();
    vi.doUnmock('../src/lib/cache.js');
    vi.doMock('../src/lib/logger.js', () => ({
      logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
    }));
    const store = new Map<string, string>();
    vi.doMock('../src/db/redis.js', () => ({
      redis: {
        get: async (k: string) => store.get(k) ?? null,
        set: async (k: string, v: string) => {
          store.set(k, v);
          return 'OK';
        },
        del: async (k: string) => (store.delete(k) ? 1 : 0),
      },
    }));
    vi.doMock('../src/config/env.js', () => ({ env: envMock }));

    let resolveUpstream!: (v: unknown) => void;
    const upstream = new Promise((r) => {
      resolveUpstream = r;
    });
    const slowFetch = vi.fn().mockReturnValue(upstream);
    vi.stubGlobal('fetch', slowFetch);

    const svc = await import('../src/modules/geocode/geocode.service.js');

    const burst = Promise.all([
      svc.searchPlaces({ q: 'nouakchott' }),
      svc.searchPlaces({ q: 'nouakchott' }),
      svc.searchPlaces({ q: 'NOUAKCHOTT' }),
    ]);
    await vi.waitFor(() => expect(slowFetch).toHaveBeenCalledTimes(1));

    resolveUpstream(okJson({ places: [GOOGLE_PLACE] }));
    const results = await burst;

    expect(slowFetch).toHaveBeenCalledTimes(1);
    expect(results[0]).toEqual(results[1]);
    expect(results[0]).toEqual(results[2]);

    // And the result is now warm: a fourth search hits Redis, not Google.
    const again = await svc.searchPlaces({ q: 'nouakchott' });
    expect(again).toEqual(results[0]);
    expect(slowFetch).toHaveBeenCalledTimes(1);

    vi.doUnmock('../src/db/redis.js');
    vi.doUnmock('../src/lib/logger.js');
    vi.resetModules();
  });
});
