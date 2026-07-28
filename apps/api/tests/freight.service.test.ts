import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchSql, rows } from './helpers/db.js';

// Intercity freight board. Most methods use pool.query (routed by SQL regex);
// respondBooking manages its own client via pool.connect()/instrumentClient,
// so we expose a fake client whose responses we program per test.

const { queryMock, sendNotificationMock, fakeClient, state } = vi.hoisted(() => {
  const state = {
    clientQueries: [] as string[],
    clientResponder: (_sql: string) => ({ rows: [] as any[], rowCount: 0 }),
  };
  const fakeClient = {
    query: vi.fn(async (sql: string) => {
      state.clientQueries.push(sql.replace(/\s+/g, ' ').trim());
      return state.clientResponder(sql);
    }),
    release: vi.fn(),
  };
  return { queryMock: vi.fn(), sendNotificationMock: vi.fn(async () => {}), fakeClient, state };
});

vi.mock('../src/db/pool.js', () => ({
  pool: { query: queryMock, connect: vi.fn(async () => fakeClient) },
  instrumentClient: (c: unknown) => c,
}));
vi.mock('../src/modules/notifications/notifications.service.js', () => ({
  sendNotification: sendNotificationMock,
}));

import {
  requestBooking,
  respondBooking,
  cancelBooking,
  browseTrips,
  updateTrip,
  listMyTrips,
} from '../src/modules/freight/freight.service.js';

function tripRow(over: Record<string, unknown> = {}) {
  return {
    id: 'trip-1',
    carrier_id: 'carrier-1',
    origin_city: 'Nouakchott',
    destination_city: 'Nouadhibou',
    departure_date: new Date('2026-08-01T00:00:00.000Z'),
    capacity_kg: 1000,
    price_per_kg_mru: 50,
    min_price_mru: 2000,
    vehicle_type: 'Camion',
    note: null,
    status: 'active',
    carrier_name: 'Transport SA',
    carrier_rating: '4.2',
    booked_kg: '200',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.clientQueries = [];
  state.clientResponder = () => ({ rows: [], rowCount: 0 });
});

describe('toDetail (via listMyTrips) — remaining capacity + rating coercion', () => {
  it('computes remainingKg = capacity - confirmed and never goes negative', async () => {
    dispatchSql(queryMock, [
      [/FROM freight_trips t/, rows([
        tripRow({ capacity_kg: 1000, booked_kg: '200' }),
        tripRow({ id: 'trip-2', capacity_kg: 300, booked_kg: '500' }), // oversold guard
      ])],
    ]);
    const trips = await listMyTrips('carrier-1');
    expect(trips[0].remainingKg).toBe(800);
    expect(trips[0].carrierRating).toBe(4.2);
    expect(trips[0].departureDate).toBe('2026-08-01');
    expect(trips[1].remainingKg).toBe(0); // clamped, not -200
  });
});

describe('requestBooking', () => {
  it('404s when the trip is not active', async () => {
    dispatchSql(queryMock, [
      [/FROM freight_trips WHERE id/, rows([{ carrier_id: 'c1', status: 'paused', capacity_kg: 1000, price_per_kg_mru: 50, min_price_mru: 2000, booked_kg: '0' }])],
    ]);
    await expect(requestBooking('shipper-1', { tripId: 'trip-1', cargoDescription: 'x', weightKg: 10 }))
      .rejects.toMatchObject({ status: 404, code: 'trip_unavailable' });
  });

  it('400s when the shipper is also the carrier', async () => {
    dispatchSql(queryMock, [
      [/FROM freight_trips WHERE id/, rows([{ carrier_id: 'shipper-1', status: 'active', capacity_kg: 1000, price_per_kg_mru: 50, min_price_mru: 2000, booked_kg: '0' }])],
    ]);
    await expect(requestBooking('shipper-1', { tripId: 'trip-1', cargoDescription: 'x', weightKg: 10 }))
      .rejects.toMatchObject({ status: 400, code: 'own_trip' });
  });

  it('409s when the requested weight exceeds remaining capacity', async () => {
    dispatchSql(queryMock, [
      [/FROM freight_trips WHERE id/, rows([{ carrier_id: 'c1', status: 'active', capacity_kg: 100, price_per_kg_mru: 50, min_price_mru: 2000, booked_kg: '80' }])],
    ]);
    await expect(requestBooking('shipper-1', { tripId: 'trip-1', cargoDescription: 'x', weightKg: 50 }))
      .rejects.toMatchObject({ status: 409, code: 'capacity_exceeded' });
  });

  it('applies the min-price floor (weight*price < minPrice) and notifies the carrier', async () => {
    dispatchSql(queryMock, [
      [/FROM freight_trips WHERE id/, rows([{ carrier_id: 'c1', status: 'active', capacity_kg: 1000, price_per_kg_mru: 50, min_price_mru: 2000, booked_kg: '0' }])],
      [/INSERT INTO freight_bookings/, rows([{ id: 'bk-1' }])],
      [/FROM freight_bookings b/, rows([{
        id: 'bk-1', cargo_description: 'x', weight_kg: 10, total_mru: 2000, status: 'pending',
        created_at: new Date('2026-07-01T00:00:00.000Z'), origin_city: 'A', destination_city: 'B',
        departure_date: new Date('2026-08-01T00:00:00.000Z'), carrier_name: 'C', carrier_phone: null,
      }])],
    ]);

    const dto = await requestBooking('shipper-1', { tripId: 'trip-1', cargoDescription: '  x  ', weightKg: 10 });

    // 10 kg * 50 = 500 < 2000 floor → total charged is 2000.
    const insert = queryMock.mock.calls.find((c) => /INSERT INTO freight_bookings/.test(c[0]));
    expect(insert![1][4]).toBe(2000);
    expect(insert![1][2]).toBe('x'); // cargo trimmed
    expect(sendNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({ target: { type: 'user', userId: 'c1' } }),
    );
    // Pending booking → carrier phone stays hidden.
    expect(dto.carrierPhone).toBeNull();
  });

  it('charges weight*price when above the floor', async () => {
    dispatchSql(queryMock, [
      [/FROM freight_trips WHERE id/, rows([{ carrier_id: 'c1', status: 'active', capacity_kg: 1000, price_per_kg_mru: 50, min_price_mru: 2000, booked_kg: '0' }])],
      [/INSERT INTO freight_bookings/, rows([{ id: 'bk-1' }])],
      [/FROM freight_bookings b/, rows([{
        id: 'bk-1', cargo_description: 'x', weight_kg: 100, total_mru: 5000, status: 'pending',
        created_at: new Date('2026-07-01T00:00:00.000Z'), origin_city: 'A', destination_city: 'B',
        departure_date: new Date('2026-08-01T00:00:00.000Z'), carrier_name: 'C', carrier_phone: null,
      }])],
    ]);
    await requestBooking('shipper-1', { tripId: 'trip-1', cargoDescription: 'x', weightKg: 100 });
    const insert = queryMock.mock.calls.find((c) => /INSERT INTO freight_bookings/.test(c[0]));
    expect(insert![1][4]).toBe(5000); // 100 * 50
  });
});

describe('respondBooking — transactional confirm/decline', () => {
  it('404s and rolls back when the booking is not the carrier\'s', async () => {
    state.clientResponder = () => ({ rows: [], rowCount: 0 });
    await expect(respondBooking('bk-1', 'carrier-1', 'confirm'))
      .rejects.toMatchObject({ status: 404, code: 'booking_not_found' });
    expect(state.clientQueries).toContain('ROLLBACK');
    expect(state.clientQueries).not.toContain('COMMIT');
  });

  it('409s and rolls back when the booking is no longer pending', async () => {
    state.clientResponder = (sql) =>
      sql.includes('FOR UPDATE OF b')
        ? { rows: [{ trip_id: 't1', weight_kg: 10, status: 'confirmed', shipper_id: 's1' }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    await expect(respondBooking('bk-1', 'carrier-1', 'confirm'))
      .rejects.toMatchObject({ status: 409, code: 'not_pending' });
    expect(state.clientQueries).toContain('ROLLBACK');
  });

  it('409s and rolls back when confirming would exceed capacity', async () => {
    state.clientResponder = (sql) => {
      if (sql.includes('FOR UPDATE OF b')) return { rows: [{ trip_id: 't1', weight_kg: 500, status: 'pending', shipper_id: 's1' }], rowCount: 1 };
      if (sql.includes('FROM freight_trips WHERE id')) return { rows: [{ capacity_kg: 1000, booked_kg: '800' }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    };
    await expect(respondBooking('bk-1', 'carrier-1', 'confirm'))
      .rejects.toMatchObject({ status: 409, code: 'capacity_exceeded' });
    expect(state.clientQueries).toContain('ROLLBACK');
    expect(state.clientQueries.some((q) => q.startsWith('UPDATE freight_bookings SET status'))).toBe(false);
  });

  it('confirms within capacity: COMMIT, sets confirmed, notifies shipper', async () => {
    state.clientResponder = (sql) => {
      if (sql.includes('FOR UPDATE OF b')) return { rows: [{ trip_id: 't1', weight_kg: 100, status: 'pending', shipper_id: 's1' }], rowCount: 1 };
      if (sql.includes('FROM freight_trips WHERE id')) return { rows: [{ capacity_kg: 1000, booked_kg: '200' }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    };
    // getCarrierBookingById runs on the pool afterwards.
    dispatchSql(queryMock, [
      [/FROM freight_bookings b/, rows([{
        id: 'bk-1', cargo_description: 'x', weight_kg: 100, total_mru: 5000, status: 'confirmed',
        created_at: new Date('2026-07-01T00:00:00.000Z'), origin_city: 'A', destination_city: 'B',
        shipper_name: 'Ali', shipper_phone: '22200',
      }])],
    ]);

    const dto = await respondBooking('bk-1', 'carrier-1', 'confirm');

    expect(state.clientQueries).toContain('COMMIT');
    expect(state.clientQueries).not.toContain('ROLLBACK');
    const upd = state.clientQueries.find((q) => q.startsWith('UPDATE freight_bookings SET status'));
    expect(upd).toBeTruthy();
    expect(dto.status).toBe('confirmed');
    // Confirmed → shipper phone is revealed to the carrier.
    expect(dto.shipperPhone).toBe('22200');
    expect(fakeClient.release).toHaveBeenCalledTimes(1);
    expect(sendNotificationMock).toHaveBeenCalled();
  });

  it('declines without a capacity check', async () => {
    state.clientResponder = (sql) =>
      sql.includes('FOR UPDATE OF b')
        ? { rows: [{ trip_id: 't1', weight_kg: 100, status: 'pending', shipper_id: 's1' }], rowCount: 1 }
        : { rows: [], rowCount: 1 };
    dispatchSql(queryMock, [
      [/FROM freight_bookings b/, rows([{
        id: 'bk-1', cargo_description: 'x', weight_kg: 100, total_mru: 5000, status: 'declined',
        created_at: new Date('2026-07-01T00:00:00.000Z'), origin_city: 'A', destination_city: 'B',
        shipper_name: 'Ali', shipper_phone: null,
      }])],
    ]);

    const dto = await respondBooking('bk-1', 'carrier-1', 'decline');
    expect(dto.status).toBe('declined');
    // No capacity SELECT on the decline path.
    expect(state.clientQueries.some((q) => q.includes('capacity_kg'))).toBe(false);
  });
});

describe('browseTrips — dynamic filters', () => {
  it('always scopes to active + future trips and appends only provided filters', async () => {
    dispatchSql(queryMock, [[/FROM freight_trips t/, rows([])]]);
    await browseTrips({ origin: 'Nouak', destination: '', excludeCarrierId: 'me' });
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/t\.status = 'active'/);
    expect(sql).toMatch(/t\.departure_date >= CURRENT_DATE/);
    expect(sql).toMatch(/origin_city ILIKE \$1/);
    expect(sql).toMatch(/carrier_id <> \$2/);
    // Empty destination is skipped entirely.
    expect(sql).not.toMatch(/destination_city ILIKE/);
    expect(params).toEqual(['%Nouak%', 'me']);
  });
});

describe('updateTrip / cancelBooking', () => {
  it('updateTrip 404s when no row matched (wrong owner or removed)', async () => {
    dispatchSql(queryMock, [[/UPDATE freight_trips/, rows([])]]);
    await expect(updateTrip('trip-1', 'carrier-1', { note: 'x' }))
      .rejects.toMatchObject({ status: 404, code: 'trip_not_found' });
  });
  it('cancelBooking maps rowCount to a boolean', async () => {
    dispatchSql(queryMock, [[/UPDATE freight_bookings/, { rows: [], rowCount: 1 }]]);
    expect(await cancelBooking('bk-1', 'shipper-1')).toBe(true);
  });
});
