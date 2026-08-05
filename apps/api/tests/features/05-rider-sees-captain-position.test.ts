/**
 * FEATURE 5 — « Où est mon chauffeur ? »
 *
 * WHAT MUST HOLD
 *
 * `GET /rider/rides/current` returns, alongside the captain identity it already
 * carries, the captain's live position:
 *
 *     captain: {
 *       …,
 *       location: { lat: number, lng: number, updatedAt: string | Date } | null
 *     }
 *
 *   1. sourced from `captain_state.location`, which dispatch already keeps
 *      fresh — no new collection, no new permission, no extra battery;
 *   2. `null` (not absent, not stale-but-silent) when the stored position is
 *      older than the dispatch freshness window, so the app can show "position
 *      indisponible" instead of drawing a car in the wrong street;
 *   3. present from `accepted` onwards, and null again once the ride is over —
 *      a completed ride must not keep leaking a captain's whereabouts.
 *
 * WHY
 *
 * The platform already collects captain positions three ways (captain_state,
 * captain_track, ride_locations) and pays the full cost for it: background
 * permission, the Play disclosure, an Android foreground service. None of it
 * reaches the rider. This is the single largest gap between what the system
 * knows and what the user sees.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { poolQueryMock } = vi.hoisted(() => ({ poolQueryMock: vi.fn() }));

vi.mock('../../src/db/pool.js', () => ({
  pool: { query: poolQueryMock, connect: vi.fn(), on: vi.fn() },
  withTx: vi.fn(),
}));
vi.mock('../../src/modules/rides/meter.service.js', () => ({
  readLiveMeter: vi.fn(async () => null),
  computeDistanceM: vi.fn(),
  lastTrailPoint: vi.fn(),
}));
vi.mock('../../src/modules/rides/dispatch.service.js', () => ({
  distanceMeters: vi.fn(),
  eligibleCaptainsForRide: vi.fn(async () => []),
}));
vi.mock('../../src/modules/push/expo-push.js', () => ({ notifyCaptainsNewRide: vi.fn() }));
vi.mock('../../src/modules/auth/sms.js', () => ({ sms: { send: vi.fn() } }));

import { getCurrentRideForRider } from '../../src/modules/rides/rides.service.js';
import { rideRow } from './_fixtures.js';

const CAPTAIN_POSITION = { lat: 18.0912, lng: -15.9744 };

const CAPTAIN_ROW = {
  id: 'captain-1',
  full_name: 'Sidi Ould Ahmed',
  phone: '+22246000000',
  rating_avg: '4.8',
  rating_count: 12,
  total_rides: 130,
  plate: 'AA-1234-BB',
  brand: 'Toyota',
  model: 'Corolla',
  color: 'blanche',
};

/**
 * The DB answers a captain_state lookup whenever the implementation asks for
 * one — the spec does not care whether that is a JOIN on the main ride query or
 * a second round trip.
 */
function db(opts: { status?: string; positionAgeS?: number | null } = {}) {
  const ageS = opts.positionAgeS === undefined ? 5 : opts.positionAgeS;
  poolQueryMock.mockImplementation(async (sql: unknown) => {
    const text = String(sql);
    if (/FROM rides\s+WHERE booker_id/i.test(text)) {
      return {
        rows: [rideRow({
          captain_id: 'captain-1',
          status: opts.status ?? 'accepted',
          accepted_at: new Date(),
        })],
        rowCount: 1,
      };
    }
    if (/captain_state/i.test(text)) {
      if (ageS === null) return { rows: [], rowCount: 0 };
      return {
        rows: [{
          captain_id: 'captain-1',
          lat: CAPTAIN_POSITION.lat,
          lng: CAPTAIN_POSITION.lng,
          location_updated_at: new Date(Date.now() - ageS * 1000),
          presence: 'on_ride',
        }],
        rowCount: 1,
      };
    }
    if (/JOIN captains c ON c\.user_id/i.test(text)) {
      return { rows: [CAPTAIN_ROW], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  db();
});

describe('the rider payload carries the captain position', () => {
  it('reads it from captain_state', async () => {
    await getCurrentRideForRider('rider-1');

    const asked = poolQueryMock.mock.calls.some(([sql]) => /captain_state/i.test(String(sql)));
    expect(
      asked,
      'Nothing queried captain_state. The position dispatch already keeps fresh is never fetched for the rider.',
    ).toBe(true);
  });

  it('exposes it as captain.location', async () => {
    const ride = await getCurrentRideForRider('rider-1');

    expect(
      (ride!.captain as any)?.location,
      'captain.location is missing — the rider has no way to see where the car is.',
    ).toMatchObject(CAPTAIN_POSITION);
  });

  it('timestamps it so the app can show how fresh it is', async () => {
    const ride = await getCurrentRideForRider('rider-1');

    // A dot on a map with no age is a promise the backend cannot keep on a 2G
    // link. The app needs to grey it out rather than lie.
    expect(
      (ride!.captain as any)?.location?.updatedAt,
      'captain.location.updatedAt is missing — the app cannot tell a live position from a stale one.',
    ).toBeTruthy();
  });

  it('returns null rather than a stale position', async () => {
    db({ positionAgeS: 900 }); // 15 minutes old

    const ride = await getCurrentRideForRider('rider-1');

    // Drawing a car where it was a quarter of an hour ago is worse than drawing
    // nothing: the rider walks to the wrong corner.
    expect(
      (ride!.captain as any)?.location ?? null,
      'A 15-minute-old position must be reported as null, not drawn as live.',
    ).toBeNull();
  });

  it('returns null when the captain has no stored position at all', async () => {
    db({ positionAgeS: null });

    const ride = await getCurrentRideForRider('rider-1');

    expect((ride!.captain as any)?.location ?? null).toBeNull();
  });

  it.each(['accepted', 'arrived', 'in_progress'])(
    'exposes the position while the ride is %s',
    async (status) => {
      db({ status });

      const ride = await getCurrentRideForRider('rider-1');

      expect(
        (ride!.captain as any)?.location,
        `captain.location must be available during '${status}'.`,
      ).toBeTruthy();
    },
  );

  it('stops exposing it once the ride is completed', async () => {
    db({ status: 'completed' });

    const ride = await getCurrentRideForRider('rider-1');

    // The tracking screen stays mounted after completion so the rider can rate.
    // Continuing to stream the captain's whereabouts to a finished trip is a
    // privacy leak, not a feature.
    expect(
      (ride!.captain as any)?.location ?? null,
      'A completed ride must not keep exposing the captain position.',
    ).toBeNull();
  });
});

describe('derived values the position unlocks', () => {
  it('reports how far the captain still is from the pickup', async () => {
    const ride = await getCurrentRideForRider('rider-1');

    // "3 min" is the number riders actually want; distance is the honest
    // version of it and needs no routing provider.
    expect(
      (ride as any)?.captainDistanceM,
      'captainDistanceM is missing — with a position available this is a PostGIS one-liner.',
    ).toEqual(expect.any(Number));
  });
});
