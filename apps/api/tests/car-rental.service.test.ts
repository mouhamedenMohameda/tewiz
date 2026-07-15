import { beforeEach, describe, expect, it, vi } from 'vitest';

// Transactional confirm (FOR UPDATE) + targeted get-by-id read-back
// (respondBooking returns via a single get-by-id, not by re-listing everything).
//
// respondBooking runs inside the shared `withTx` helper, so we mock pool.js to
// expose a withTx that drives the same fake client used for the transaction.
// That client records the exact query sequence, letting us assert
// BEGIN → FOR UPDATE → clash-guard → UPDATE → get-by-id → COMMIT ordering and
// ROLLBACK on conflict.

const { sendNotificationMock, fakeClient, state } = vi.hoisted(() => {
  const state = {
    clientQueries: [] as string[],
    poolQueries: [] as string[],
    // Programmable responses keyed by a substring of the SQL.
    clientResponder: (_sql: string) => ({ rows: [] as any[] }),
    poolResponder: (_sql: string) => ({ rows: [] as any[] }),
  };
  const fakeClient = {
    query: vi.fn(async (sql: string) => {
      state.clientQueries.push(sql.replace(/\s+/g, ' ').trim());
      return state.clientResponder(sql);
    }),
    release: vi.fn(),
  };
  return { sendNotificationMock: vi.fn(async () => {}), fakeClient, state };
});

vi.mock('../src/db/pool.js', () => ({
  pool: {
    connect: vi.fn(async () => fakeClient),
    query: vi.fn(async (sql: string) => {
      state.poolQueries.push(sql.replace(/\s+/g, ' ').trim());
      return state.poolResponder(sql);
    }),
  },
  // Mirror the real withTx: check out a client, BEGIN, run fn, COMMIT (or
  // ROLLBACK on throw), always release. Runs against the same fakeClient so
  // the BEGIN/COMMIT/ROLLBACK land in state.clientQueries alongside the
  // service's own statements.
  withTx: async (fn: (client: typeof fakeClient) => Promise<unknown>) => {
    await fakeClient.query('BEGIN');
    try {
      const result = await fn(fakeClient);
      await fakeClient.query('COMMIT');
      return result;
    } catch (err) {
      await fakeClient.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      fakeClient.release();
    }
  },
}));

vi.mock('../src/modules/notifications/notifications.service.js', () => ({
  sendNotification: sendNotificationMock,
}));

import { respondBooking } from '../src/modules/car-rental/car-rental.service.js';

const OWNER = 'owner-1';
const pendingRow = {
  listing_id: 'car-1',
  // lockOwnerBooking joins car_listings and rejects (403 not_your_car) unless
  // the locked row's owner matches the acting owner.
  owner_id: OWNER,
  start_date: new Date('2026-07-10'),
  end_date: new Date('2026-07-14'),
  status: 'pending',
  renter_id: 'renter-1',
};
const ownerBookingRow = {
  id: 'bk-1',
  start_date: new Date('2026-07-10'),
  end_date: new Date('2026-07-14'),
  days: 5,
  with_driver: false,
  total_mru: 5000,
  status: 'confirmed',
  created_at: new Date('2026-07-01'),
  car_title: 'Toyota',
  city: 'Nouakchott',
  // BOOKING_SELECT returns these array columns; toOwnerBooking reads photos[0]
  // and passes the pickup/return arrays straight through.
  photos: ['car.webp'],
  pickup_photos: [],
  return_photos: [],
  renter_name: 'Ali',
  renter_phone: '22200000',
};

beforeEach(() => {
  vi.clearAllMocks();
  state.clientQueries = [];
  state.poolQueries = [];
  fakeClient.query.mockClear();
  fakeClient.release.mockClear();
});

describe('car-rental respondBooking — transaction + get-by-id', () => {
  it('confirms inside a transaction: BEGIN, FOR UPDATE, clash-check, UPDATE, COMMIT', async () => {
    state.clientResponder = (sql) => {
      if (sql.includes('FOR UPDATE OF b')) return { rows: [pendingRow] };
      if (sql.includes('daterange')) return { rows: [] }; // no clash
      if (sql.includes('WHERE b.id = $1')) return { rows: [ownerBookingRow] }; // get-by-id
      return { rows: [] };
    };
    state.poolResponder = () => ({ rows: [] });

    const result = await respondBooking('bk-1', OWNER, 'confirm');

    expect(state.clientQueries[0]).toBe('BEGIN');
    expect(state.clientQueries.some((q) => q.includes('FOR UPDATE OF b'))).toBe(true);
    expect(state.clientQueries.some((q) => q.includes('daterange') && q.includes('FOR UPDATE'))).toBe(true);
    expect(state.clientQueries.some((q) => q.startsWith('UPDATE car_bookings SET status'))).toBe(true);
    expect(state.clientQueries).toContain('COMMIT');
    expect(state.clientQueries).not.toContain('ROLLBACK');
    expect(fakeClient.release).toHaveBeenCalledTimes(1);

    // Return value comes from a single targeted get-by-id run on the SAME
    // transaction client — no separate pool round-trip, no re-list.
    expect(state.poolQueries).toHaveLength(0);
    const getById = state.clientQueries.filter(
      (q) => q.includes('WHERE b.id = $1') && !q.includes('FOR UPDATE'),
    );
    expect(getById).toHaveLength(1);
    expect(result.id).toBe('bk-1');
    expect(result.status).toBe('confirmed');
  });

  it('rolls back and throws 409 when confirmed dates already clash', async () => {
    state.clientResponder = (sql) => {
      if (sql.includes('FOR UPDATE OF b')) return { rows: [pendingRow] };
      if (sql.includes('daterange')) return { rows: [{ '?column?': 1 }] }; // clash!
      return { rows: [] };
    };
    state.poolResponder = () => ({ rows: [] });

    await expect(respondBooking('bk-1', OWNER, 'confirm')).rejects.toMatchObject({
      status: 409,
      code: 'dates_taken',
    });

    expect(state.clientQueries).toContain('ROLLBACK');
    expect(state.clientQueries).not.toContain('COMMIT');
    expect(state.clientQueries.some((q) => q.startsWith('UPDATE car_bookings'))).toBe(false);
    expect(fakeClient.release).toHaveBeenCalledTimes(1);
    expect(state.poolQueries).toHaveLength(0); // never reaches get-by-id
  });

  it('rolls back and throws 409 when the booking is no longer pending', async () => {
    state.clientResponder = (sql) => {
      if (sql.includes('FOR UPDATE OF b')) return { rows: [{ ...pendingRow, status: 'confirmed' }] };
      return { rows: [] };
    };
    state.poolResponder = () => ({ rows: [] });

    await expect(respondBooking('bk-1', OWNER, 'confirm')).rejects.toMatchObject({
      status: 409,
      code: 'not_pending',
    });

    expect(state.clientQueries).toContain('ROLLBACK');
    expect(state.clientQueries.some((q) => q.includes('daterange'))).toBe(false);
    expect(fakeClient.release).toHaveBeenCalledTimes(1);
  });
});
