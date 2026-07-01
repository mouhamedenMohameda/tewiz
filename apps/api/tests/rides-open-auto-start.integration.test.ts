import { beforeEach, describe, expect, it, vi } from 'vitest';

let fakeClient: { query: (sql: unknown, params?: any[]) => Promise<any> };

vi.mock('../src/db/pool.js', () => ({
  pool: { query: vi.fn() },
  withTx: async (fn: any) => fn(fakeClient),
}));

import { arriveRide, startRide } from '../src/modules/rides/rides.service.js';
import { HttpError } from '../src/middleware/error.js';

type Status = 'searching' | 'accepted' | 'arrived' | 'in_progress' | 'completed' | 'cancelled';

type FakeRide = {
  id: string;
  booker_id: string;
  passenger_user_id: string | null;
  passenger_name: string | null;
  passenger_phone: string | null;
  is_for_other: boolean;
  passenger_confirmed_at: Date | null;
  captain_id: string | null;
  ride_type: 'passenger' | 'colis';
  source: 'app' | 'operator';
  pricing_mode: 'solo' | 'shared';
  shared_seats: number | null;
  status: Status;
  pickup_lat: number;
  pickup_lng: number;
  pickup_label: string | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  dropoff_label: string | null;
  fare_estimate_mru: string | null;
  fare_final_mru: string | null;
  commission_rate_bps: number;
  commission_mru: string | null;
  payment_method: 'cash' | 'wallet';
  distance_m: number | null;
  duration_s: number | null;
  verification_code: string | null;
  requested_at: Date;
  accepted_at: Date | null;
  arrived_at: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
  cancel_reason: string | null;
  is_open: boolean;
  open_base_fare_mru: number | null;
  open_per_km_mru: number | null;
  open_per_minute_mru: number | null;
  open_min_fare_mru: number | null;
};

class FakeRideClient {
  constructor(public ride: FakeRide) {}

  async query(sql: unknown, params: any[] = []) {
    const text = String(sql).replace(/\s+/g, ' ');

    if (text.includes('FROM rides WHERE id = $1 FOR UPDATE')) {
      return { rows: [this.ride] };
    }

    if (text.includes('SET status = $2') && text.includes('arrived_at = now()')) {
      const nextStatus = String(params[1]) as Status;
      this.ride.status = nextStatus;
      this.ride.arrived_at = new Date('2026-07-01T12:00:00.000Z');
      if (nextStatus === 'in_progress') {
        this.ride.started_at = new Date('2026-07-01T12:00:00.000Z');
      }
      return { rows: [this.ride] };
    }

    if (text.includes("SET status = 'in_progress', started_at = now()")) {
      this.ride.status = 'in_progress';
      this.ride.started_at = new Date('2026-07-01T12:01:00.000Z');
      return { rows: [this.ride] };
    }

    throw new Error(`Unexpected SQL: ${text}`);
  }
}

function makeRide(input: { id: string; status: Status; isOpen: boolean }): FakeRide {
  return {
    id: input.id,
    booker_id: 'booker-1',
    passenger_user_id: 'rider-1',
    passenger_name: 'Rider Test',
    passenger_phone: '+22230001122',
    is_for_other: false,
    passenger_confirmed_at: null,
    captain_id: 'captain-1',
    ride_type: 'passenger',
    source: 'app',
    pricing_mode: 'solo',
    shared_seats: null,
    status: input.status,
    pickup_lat: 18.07,
    pickup_lng: -15.95,
    pickup_label: 'A',
    dropoff_lat: input.isOpen ? null : 18.09,
    dropoff_lng: input.isOpen ? null : -15.97,
    dropoff_label: input.isOpen ? null : 'B',
    fare_estimate_mru: input.isOpen ? null : '500',
    fare_final_mru: null,
    commission_rate_bps: 1200,
    commission_mru: null,
    payment_method: 'cash',
    distance_m: input.isOpen ? null : 3200,
    duration_s: null,
    verification_code: null,
    requested_at: new Date('2026-07-01T11:00:00.000Z'),
    accepted_at: new Date('2026-07-01T11:05:00.000Z'),
    arrived_at: null,
    started_at: null,
    completed_at: null,
    cancelled_at: null,
    cancel_reason: null,
    is_open: input.isOpen,
    open_base_fare_mru: input.isOpen ? 300 : null,
    open_per_km_mru: input.isOpen ? 90 : null,
    open_per_minute_mru: input.isOpen ? 8 : null,
    open_min_fare_mru: input.isOpen ? 500 : null,
  };
}

describe('rides state transitions integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('auto-starts open rides when captain marks arrived', async () => {
    const client = new FakeRideClient(makeRide({ id: 'ride-open', status: 'accepted', isOpen: true }));
    fakeClient = client;

    const result = await arriveRide('ride-open', 'captain-1');

    expect(result.status).toBe('in_progress');
    expect(result.arrivedAt).toBeTruthy();
    expect(result.startedAt).toBeTruthy();

    await expect(startRide('ride-open', 'captain-1')).rejects.toMatchObject<HttpError>({
      status: 409,
      code: 'wrong_status',
    });
  });

  it('keeps closed rides on arrived, then allows explicit start', async () => {
    const client = new FakeRideClient(makeRide({ id: 'ride-closed', status: 'accepted', isOpen: false }));
    fakeClient = client;

    const arrived = await arriveRide('ride-closed', 'captain-1');
    expect(arrived.status).toBe('arrived');
    expect(arrived.startedAt).toBeNull();

    const started = await startRide('ride-closed', 'captain-1');
    expect(started.status).toBe('in_progress');
    expect(started.startedAt).toBeTruthy();
  });
});
