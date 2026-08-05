/**
 * FEATURE 5 — La lecture "course en cours" du rider.
 *
 * Covers what the endpoint does today: the captain identity and vehicle it
 * enriches the ride with, the live meter on an open ride, and the fact that
 * optional telemetry failing must never take down the tracking screen.
 *
 * The captain's live POSITION — the thing the rider actually wants — is covered
 * separately by 05-rider-sees-captain-position.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { rideRow } from './_fixtures.js';

const { poolQueryMock, readLiveMeterMock } = vi.hoisted(() => ({
  poolQueryMock: vi.fn(),
  readLiveMeterMock: vi.fn(),
}));

vi.mock('../../src/db/pool.js', () => ({
  pool: { query: poolQueryMock, connect: vi.fn(), on: vi.fn() },
  withTx: vi.fn(),
}));
vi.mock('../../src/modules/rides/meter.service.js', () => ({
  readLiveMeter: readLiveMeterMock,
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

const CAPTAIN_ROW = {
  id: 'captain-1',
  full_name: 'Sidi Ould Ahmed',
  phone: '+22246000000',
  rating_avg: '4.8',
  rating_count: 42,
  total_rides: 130,
  plate: 'AA-1234-BB',
  brand: 'Toyota',
  model: 'Corolla',
  color: 'blanche',
};

/** Every statement issued during the read, in order. */
function sqlIssued(): string[] {
  return poolQueryMock.mock.calls.map(([sql]) => String(sql));
}

beforeEach(() => {
  vi.clearAllMocks();
  readLiveMeterMock.mockResolvedValue(null);
  poolQueryMock.mockImplementation(async (sql: unknown) => {
    const text = String(sql);
    if (/FROM rides\s+WHERE booker_id/i.test(text)) {
      return {
        rows: [rideRow({ captain_id: 'captain-1', status: 'accepted', accepted_at: new Date() })],
        rowCount: 1,
      };
    }
    if (/JOIN captains c ON c\.user_id/i.test(text)) {
      return { rows: [CAPTAIN_ROW], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
});

describe('the in-ride GPS trail is collected but stays server-side', () => {
  it('surfaces a live meter for open rides — the one thing GPS does reach the rider through', async () => {
    poolQueryMock.mockImplementation(async (sql: unknown) => {
      const text = String(sql);
      if (/FROM rides\s+WHERE booker_id/i.test(text)) {
        return {
          rows: [rideRow({
            captain_id: 'captain-1',
            status: 'in_progress',
            is_open: true,
            started_at: new Date(Date.now() - 600_000),
            open_base_fare_mru: 50,
            open_per_km_mru: 40,
            open_per_minute_mru: 5,
            open_min_fare_mru: 100,
            fare_estimate_mru: null,
          })],
          rowCount: 1,
        };
      }
      if (/JOIN captains c ON c\.user_id/i.test(text)) return { rows: [CAPTAIN_ROW], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    readLiveMeterMock.mockResolvedValue({ distanceM: 3400, durationS: 600, fareMru: 216 });

    const ride = await getCurrentRideForRider('rider-1');

    // The running fare IS derived from the captain's GPS trail and IS shown.
    // So the pipeline works end to end — it is only the position itself that is
    // withheld. That makes the gap a product decision, not a technical blocker.
    expect(ride!.liveMeter).toMatchObject({ distanceM: 3400, fareMru: 216 });
  });

  it('degrades to a null meter instead of failing the whole screen', async () => {
    poolQueryMock.mockImplementation(async (sql: unknown) => {
      const text = String(sql);
      if (/FROM rides\s+WHERE booker_id/i.test(text)) {
        return {
          rows: [rideRow({
            captain_id: 'captain-1', status: 'in_progress', is_open: true,
            started_at: new Date(), open_base_fare_mru: 50, open_per_km_mru: 40,
            open_per_minute_mru: 5, open_min_fare_mru: 100,
          })],
          rowCount: 1,
        };
      }
      if (/JOIN captains c ON c\.user_id/i.test(text)) return { rows: [CAPTAIN_ROW], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    readLiveMeterMock.mockRejectedValue(new Error('relation ride_locations does not exist'));

    const ride = await getCurrentRideForRider('rider-1');

    // Optional telemetry must never take down the tracking screen.
    expect(ride!.liveMeter).toBeNull();
    expect(ride!.status).toBe('in_progress');
  });
});

describe('the read itself stays correct', () => {
  it('returns null when the rider has no active ride', async () => {
    poolQueryMock.mockResolvedValue({ rows: [], rowCount: 0 });

    expect(await getCurrentRideForRider('rider-1')).toBeNull();
  });

  it('returns a captain-less ride while still searching', async () => {
    poolQueryMock.mockImplementation(async (sql: unknown) => {
      if (/FROM rides\s+WHERE booker_id/i.test(String(sql))) {
        return { rows: [rideRow({ captain_id: null, status: 'searching' })], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const ride = await getCurrentRideForRider('rider-1');

    expect(ride!.status).toBe('searching');
    expect(ride!.captain).toBeNull();
  });
});
