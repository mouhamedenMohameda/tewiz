import { beforeEach, describe, expect, it, vi } from 'vitest';

// The push to nearby captains must happen AFTER the transaction commits.
//
// It used to be fired from inside the `withTx` callback, on a separate pool
// connection. Every query in eligibleCaptainsForRide starts with
// `WITH r AS (SELECT … FROM rides WHERE id = $1)` and CROSS JOINs it, so a ride
// still inside an uncommitted transaction produced an empty `r`, zero eligible
// captains, and a broadcast that silently reached nobody. Nothing threw and
// nothing was logged — riders simply waited while only inbox-polling captains
// ever saw the ride.
//
// It was a race, so it only bit some of the time, which is exactly why an
// ordering test is the only thing that keeps it fixed. These tests assert the
// ORDER of events, not just that a broadcast happened.

const events: string[] = [];

let fakeClient: { query: (sql: unknown, params?: any[]) => Promise<any> };

vi.mock('../src/db/pool.js', () => ({
  pool: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) },
  // Records a marker at the moment the transaction would commit: after the
  // callback resolves, before the caller resumes.
  withTx: async (fn: any) => {
    const result = await fn(fakeClient);
    events.push('commit');
    return result;
  },
}));

vi.mock('../src/modules/rides/dispatch.service.js', () => ({
  eligibleCaptainsForRide: vi.fn(async () => {
    events.push('lookup');
    return ['captain-2'];
  }),
  distanceMeters: vi.fn(async () => 1000),
}));

vi.mock('../src/modules/push/expo-push.js', () => ({
  notifyCaptainsNewRide: vi.fn(async () => {
    events.push('push');
  }),
  // Rider-facing notifications also fire on this path; stubbed so the ordering
  // assertions below stay about the captain re-broadcast.
  notifyRiderRideAccepted: vi.fn(),
  notifyRiderCaptainArrived: vi.fn(),
  notifyRiderCaptainCancelled: vi.fn(),
  notifyRiderRideExpired: vi.fn(),
}));

import { cancelRide } from '../src/modules/rides/rides.service.js';

/** Lets the fire-and-forget broadcast run to completion. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

function rideRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ride-1',
    booker_id: 'rider-1',
    passenger_user_id: 'rider-1',
    passenger_name: null,
    passenger_phone: null,
    is_for_other: false,
    passenger_confirmed_at: null,
    captain_id: 'captain-1',
    ride_type: 'passenger',
    source: 'app',
    origin_partner_id: null,
    pricing_mode: 'solo',
    shared_seats: null,
    status: 'accepted',
    pickup_lat: 18.08,
    pickup_lng: -15.97,
    pickup_label: 'Marché Capitale',
    dropoff_lat: 18.1,
    dropoff_lng: -15.95,
    dropoff_label: 'Ksar',
    fare_estimate_mru: '205',
    fare_final_mru: null,
    commission_rate_bps: 700,
    commission_mru: null,
    payment_method: 'cash',
    distance_m: 4200,
    duration_s: null,
    requested_at: new Date(),
    accepted_at: new Date(),
    arrived_at: null,
    started_at: null,
    completed_at: null,
    cancelled_at: null,
    cancel_reason: null,
    is_open: false,
    open_base_fare_mru: null,
    open_per_km_mru: null,
    open_per_minute_mru: null,
    open_min_fare_mru: null,
    confirm_code: null,
    ...overrides,
  };
}

beforeEach(() => {
  events.length = 0;
  // A captain cancelling an accepted ride: the ride goes back to 'searching'
  // and must be re-broadcast to everyone else.
  fakeClient = {
    query: async (sql: unknown) => {
      const text = String(sql);
      if (text.includes('FOR UPDATE')) return { rows: [rideRow()], rowCount: 1 };
      if (text.includes("status       = 'searching'")) {
        return { rows: [rideRow({ captain_id: null, status: 'searching', accepted_at: null })], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
});

describe('re-broadcast after a captain cancels', () => {
  it('looks up eligible captains only AFTER the transaction commits', async () => {
    await cancelRide({ rideId: 'ride-1', userId: 'captain-1', role: 'captain', reason: 'panne' });
    await flush();

    // The whole bug in one assertion. Before the fix this read
    // ['lookup', 'commit', …] — the ride was queried while still invisible.
    expect(events).toEqual(['commit', 'lookup', 'push']);
  });

  it('resolves the caller without waiting for the push to finish', async () => {
    // Fire-and-forget is deliberate: a slow Expo call must not hold up the cancel
    // response. Asserted by holding the push open — checking the event list right
    // after the await would only be testing microtask interleaving, which is not
    // a property worth pinning.
    const { notifyCaptainsNewRide } = await import('../src/modules/push/expo-push.js');
    let releasePush: () => void = () => {};
    vi.mocked(notifyCaptainsNewRide).mockImplementationOnce(
      () => new Promise<void>((resolve) => { releasePush = () => { events.push('push'); resolve(); }; }),
    );

    const ride = await cancelRide({
      rideId: 'ride-1', userId: 'captain-1', role: 'captain', reason: 'panne',
    });

    // The push is still in flight, and the caller already has its answer.
    expect(ride.status).toBe('searching');
    expect(events).not.toContain('push');

    releasePush();
    await flush();
    expect(events).toEqual(['commit', 'lookup', 'push']);
  });

  it('does not broadcast when the rider cancels — no ride is revived', async () => {
    fakeClient = {
      query: async (sql: unknown) => {
        const text = String(sql);
        if (text.includes('FOR UPDATE')) {
          return { rows: [rideRow({ status: 'searching', captain_id: null })], rowCount: 1 };
        }
        return { rows: [rideRow({ status: 'cancelled_by_rider' })], rowCount: 1 };
      },
    };

    await cancelRide({ rideId: 'ride-1', userId: 'rider-1', role: 'rider', reason: 'changé d\'avis' });
    await flush();

    expect(events).toEqual(['commit']);
  });

  it('never lets a failed push break the cancellation', async () => {
    const { notifyCaptainsNewRide } = await import('../src/modules/push/expo-push.js');
    vi.mocked(notifyCaptainsNewRide).mockRejectedValueOnce(new Error('expo down'));

    const ride = await cancelRide({
      rideId: 'ride-1', userId: 'captain-1', role: 'captain', reason: 'panne',
    });
    await flush();

    // The ride is still freed for other captains; only the notification is lost,
    // and they will find it by polling their inbox.
    expect(ride.status).toBe('searching');
  });
});
