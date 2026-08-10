import { beforeEach, describe, expect, it, vi } from 'vitest';

// Ride read-path enrichment.
//
// `getRideForUser` / `getCurrentRideForRider` / `getCurrentRideForCaptain` build
// their payload by folding a chain of `enrichWith*` helpers over the ride row.
// Every route test in the suite mocks `rides.service` wholesale, so until this
// file none of that fold was covered — which is uncomfortable, because it is the
// hottest read path in the product: the rider tracking screen polls it for the
// entire duration of a trip.
//
// The fold also serialises queries that do not depend on each other. Turning it
// into a fan-out is a latency win, but only if the payload comes out byte-identical
// and the ONE real dependency survives: `enrichWithCaptainPosition` reads the
// `captain` object that `enrichWithCaptain` produced and rewrites it with a
// `location`. Run those two in parallel and the rider silently stops seeing the
// captain move.
//
// So: the first block pins the payload, the second pins the dependency, and the
// third asserts the fan-out actually happens. The first two are what make the
// third safe to land.

const { queryMock, readLiveMeterMock, envMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  readLiveMeterMock: vi.fn(),
  envMock: {
    RIDER_CAPTAIN_POSITION_MAX_AGE_S: 120,
    DISPATCH_RADIUS_M: 3000,
    DISPATCH_TOP_N: 5,
    SLOW_QUERY_MS: 0,
    METRICS_REFRESH_MS: 30_000,
  },
}));

vi.mock('../src/db/pool.js', () => ({
  pool: { query: queryMock },
  withTx: vi.fn(),
  instrumentClient: (c: unknown) => c,
}));
vi.mock('../src/config/env.js', () => ({ env: envMock }));
vi.mock('../src/modules/rides/meter.service.js', () => ({
  readLiveMeter: readLiveMeterMock,
  computeDistanceM: vi.fn(),
  lastTrailPoint: vi.fn(),
}));

const { getRideForUser, getCurrentRideForRider } = await import(
  '../src/modules/rides/rides.service.js'
);

const RIDE_ID = '11111111-1111-1111-1111-111111111111';
const RIDER_ID = '22222222-2222-2222-2222-222222222222';
const CAPTAIN_ID = '33333333-3333-3333-3333-333333333333';

/** A ride row as RIDE_COLUMNS returns it: accepted, private_driver, closed fare. */
function rideRow(over: Record<string, unknown> = {}) {
  return {
    id: RIDE_ID,
    booker_id: RIDER_ID,
    passenger_user_id: null,
    passenger_name: null,
    passenger_phone: null,
    is_for_other: false,
    passenger_confirmed_at: null,
    captain_id: CAPTAIN_ID,
    ride_type: 'private_driver',
    source: 'app',
    origin_partner_id: null,
    pricing_mode: 'fixed',
    shared_seats: null,
    status: 'accepted',
    pickup_lat: 18.0858,
    pickup_lng: -15.9785,
    pickup_label: 'Marché Capitale',
    dropoff_lat: 18.1,
    dropoff_lng: -15.95,
    dropoff_label: 'Aéroport',
    fare_estimate_mru: '1200',
    fare_final_mru: null,
    commission_rate_bps: 700,
    commission_mru: null,
    payment_method: 'cash',
    distance_m: 4200,
    duration_s: 600,
    verification_code: '1234',
    requested_at: new Date('2026-08-09T10:00:00Z'),
    accepted_at: new Date('2026-08-09T10:01:00Z'),
    arrived_at: null,
    started_at: null,
    completed_at: null,
    cancelled_at: null,
    cancel_reason: null,
    last_captain_cancel_reason: null,
    last_captain_cancel_at: null,
    is_open: false,
    open_base_fare_mru: null,
    open_per_km_mru: null,
    open_per_minute_mru: null,
    open_min_fare_mru: null,
    ...over,
  };
}

const CAPTAIN_ROW = {
  id: CAPTAIN_ID,
  full_name: 'Sidi Ould Ahmed',
  phone: '+22233445566',
  rating_avg: '4.7',
  total_rides: 312,
  plate: 'AB-1234',
  brand: 'Toyota',
  model: 'Corolla',
  color: 'blanc',
};

/** Which logical query a SQL string is, so the mock can answer per-query. */
function classify(sql: string): string {
  if (sql.includes('FROM captain_state')) return 'position';
  if (sql.includes('JOIN captains c')) return 'captain';
  if (sql.includes('ride_acceptances')) return 'acceptances';
  if (sql.includes('private_driver_details')) return 'details';
  if (sql.includes('FROM users WHERE id')) return 'booker';
  if (sql.includes('FROM rides')) return 'ride';
  return 'other';
}

/**
 * Route the mocked pool per logical query. `hold` names queries that must not
 * settle until `release()` is called, which is how the fan-out is observed.
 */
function stubPool(opts: {
  ride?: Record<string, unknown> | null;
  captain?: typeof CAPTAIN_ROW | null;
  position?: { lat: number; lng: number; location_updated_at: Date | null } | null;
  hold?: string[];
} = {}) {
  const inflight = new Map<string, number>();
  const holders: (() => void)[] = [];
  const order: string[] = [];

  queryMock.mockImplementation((sql: string) => {
    const kind = classify(sql);
    order.push(kind);
    inflight.set(kind, (inflight.get(kind) ?? 0) + 1);

    const rows = (() => {
      switch (kind) {
        case 'ride': {
          const r = opts.ride === undefined ? rideRow() : opts.ride;
          return r ? [r] : [];
        }
        case 'captain':
          return opts.captain === undefined ? [CAPTAIN_ROW] : opts.captain ? [opts.captain] : [];
        case 'position':
          return opts.position === undefined
            ? [{ lat: 18.09, lng: -15.97, location_updated_at: new Date() }]
            : opts.position
              ? [opts.position]
              : [];
        case 'acceptances':
          return [];
        case 'details':
          return [{ booked_duration_h: 3, hourly_rate_mru: 500, booked_fare_mru: 1500 }];
        case 'booker':
          return [{ full_name: 'Fatimetou', phone: '+22299887766' }];
        default:
          return [];
      }
    })();

    const result = { rows, rowCount: rows.length };
    if (opts.hold?.includes(kind)) {
      return new Promise((resolve) => holders.push(() => resolve(result)));
    }
    return Promise.resolve(result);
  });

  return {
    order,
    /** How many queries of these kinds have been ISSUED so far. */
    issued: (...kinds: string[]) =>
      kinds.reduce((n, k) => n + (inflight.get(k) ?? 0), 0),
    release: () => {
      holders.splice(0).forEach((fn) => fn());
    },
  };
}

beforeEach(() => {
  queryMock.mockReset();
  readLiveMeterMock.mockReset().mockResolvedValue({ distanceM: 0, durationS: 0, fareMru: 0 });
  envMock.RIDER_CAPTAIN_POSITION_MAX_AGE_S = 120;
});

describe('getCurrentRideForRider — payload (characterisation)', () => {
  it('returns the ride with captain, live position, type details and meter slot', async () => {
    stubPool();

    const out = await getCurrentRideForRider(RIDER_ID);

    expect(out).toMatchObject({
      id: RIDE_ID,
      status: 'accepted',
      captainId: CAPTAIN_ID,
      captain: {
        id: CAPTAIN_ID,
        fullName: 'Sidi Ould Ahmed',
        phone: '+22233445566',
        ratingAvg: 4.7,
        totalRides: 312,
        vehicle: { plate: 'AB-1234', brand: 'Toyota', model: 'Corolla', color: 'blanc' },
      },
      privateDriverDetails: { bookedDurationH: 3, hourlyRateMru: 500, bookedFareMru: 1500 },
      convoyageDetails: null,
      carRentalDetails: null,
      equipmentRentalDetails: null,
      liveMeter: null,
    });
  });

  it('exposes every detail key even when the ride type uses none of them', async () => {
    stubPool({ ride: rideRow({ ride_type: 'standard' }) });

    const out = (await getCurrentRideForRider(RIDER_ID))!;

    // The mobile app destructures these unconditionally, so a missing key is a
    // crash, not a smaller payload.
    for (const key of [
      'privateDriverDetails',
      'convoyageDetails',
      'roadsideAssistanceDetails',
      'lightMovingDetails',
      'intercityFreightDetails',
      'carRentalDetails',
      'equipmentRentalDetails',
      'liveMeter',
      'captainDistanceM',
    ]) {
      expect(out).toHaveProperty(key);
    }
  });

  it('returns null when the rider has no current ride', async () => {
    stubPool({ ride: null });
    expect(await getCurrentRideForRider(RIDER_ID)).toBeNull();
  });

  it('attaches the live meter for an open in-progress ride', async () => {
    readLiveMeterMock.mockResolvedValue({ distanceM: 3200, durationS: 480, fareMru: 640 });
    stubPool({
      ride: rideRow({
        is_open: true,
        status: 'in_progress',
        started_at: new Date('2026-08-09T10:05:00Z'),
        open_base_fare_mru: 100,
        open_per_km_mru: 80,
        open_per_minute_mru: 5,
        open_min_fare_mru: 200,
      }),
    });

    const out = (await getCurrentRideForRider(RIDER_ID))!;
    expect(out.liveMeter).toEqual({ distanceM: 3200, durationS: 480, fareMru: 640 });
  });

  it('keeps the payload when the live meter blows up', async () => {
    readLiveMeterMock.mockRejectedValue(new Error('meter storage down'));
    stubPool({
      ride: rideRow({
        is_open: true,
        status: 'in_progress',
        started_at: new Date(),
        open_base_fare_mru: 100,
        open_per_km_mru: 80,
        open_per_minute_mru: 5,
        open_min_fare_mru: 200,
      }),
    });

    const out = (await getCurrentRideForRider(RIDER_ID))!;
    expect(out.liveMeter).toBeNull();
    expect(out.id).toBe(RIDE_ID);
  });
});

describe('captain position depends on the captain lookup', () => {
  it('merges the live location INTO the captain object', async () => {
    const updatedAt = new Date();
    stubPool({ position: { lat: 18.09, lng: -15.97, location_updated_at: updatedAt } });

    const out = (await getCurrentRideForRider(RIDER_ID))!;

    // This is the assertion that a naive fan-out breaks: `location` has to land
    // on the captain object built by the previous step, not replace it.
    expect(out.captain).toMatchObject({
      fullName: 'Sidi Ould Ahmed',
      vehicle: { plate: 'AB-1234' },
      location: { lat: 18.09, lng: -15.97, updatedAt },
    });
    expect(out.captainDistanceM).toBeGreaterThan(0);
  });

  it('never queries the position when no captain row was found', async () => {
    const p = stubPool({ captain: null });
    const out = (await getCurrentRideForRider(RIDER_ID))!;

    expect(out.captain).toBeNull();
    expect(out.captainDistanceM).toBeNull();
    expect(p.issued('position')).toBe(0);
  });

  it('reports a stale position as absent rather than drawing it', async () => {
    envMock.RIDER_CAPTAIN_POSITION_MAX_AGE_S = 60;
    stubPool({
      position: {
        lat: 18.09,
        lng: -15.97,
        location_updated_at: new Date(Date.now() - 10 * 60_000),
      },
    });

    const out = (await getCurrentRideForRider(RIDER_ID))!;
    expect(out.captainDistanceM).toBeNull();
    expect(out.captain?.location).toBeUndefined();
  });

  it('does not fetch a position for a ride that is no longer live', async () => {
    const p = stubPool({ ride: rideRow({ status: 'completed', completed_at: new Date() }) });
    const out = (await getCurrentRideForRider(RIDER_ID))!;

    expect(out.captainDistanceM).toBeNull();
    expect(p.issued('position')).toBe(0);
  });
});

describe('independent enrichment runs concurrently', () => {
  it('issues the captain and detail lookups without waiting for each other', async () => {
    const p = stubPool({ hold: ['captain', 'details'] });

    const pending = getCurrentRideForRider(RIDER_ID);
    // Both must be in flight while neither has settled. Under the old fold the
    // detail query could not be issued until the captain chain had resolved.
    await vi.waitFor(() => expect(p.issued('captain', 'details')).toBe(2));

    p.release();
    await vi.waitFor(() => expect(p.issued('position')).toBe(1));
    p.release();
    await expect(pending).resolves.toMatchObject({ id: RIDE_ID });
  });

  it('fans out captain, acceptances and details on the admin path', async () => {
    const p = stubPool({ hold: ['captain', 'acceptances', 'details'] });

    const pending = getRideForUser(RIDE_ID, 'admin-1', 'admin');
    await vi.waitFor(() => expect(p.issued('captain', 'acceptances', 'details')).toBe(3));

    p.release();
    await expect(pending).resolves.toMatchObject({ id: RIDE_ID });
  });

  it('fans out booker and details on the captain path', async () => {
    const p = stubPool({ hold: ['booker', 'details'] });

    const pending = getRideForUser(RIDE_ID, CAPTAIN_ID, 'captain');
    await vi.waitFor(() => expect(p.issued('booker', 'details')).toBe(2));

    p.release();
    await expect(pending).resolves.toMatchObject({ id: RIDE_ID });
  });

  it('still enforces authorisation before doing any enrichment work', async () => {
    const p = stubPool();
    await expect(getRideForUser(RIDE_ID, 'someone-else', 'rider')).rejects.toMatchObject({
      status: 403,
    });
    expect(p.issued('captain', 'details', 'booker', 'acceptances')).toBe(0);
  });
});
