import { beforeEach, describe, expect, it, vi } from 'vitest';

// Fix #2 (transactional confirm with FOR UPDATE) + Fix #3 (respondBooking
// returns via a targeted get-by-id query, not by re-listing everything).
//
// We drive the service with a fake pool whose `connect()` hands out a client
// that records the exact query sequence, so we can assert BEGIN → FOR UPDATE →
// clash-guard → UPDATE → COMMIT ordering and ROLLBACK on conflict.

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
}));

vi.mock('../src/modules/notifications/notifications.service.js', () => ({
  sendNotification: sendNotificationMock,
}));

import { respondBooking } from '../src/modules/car-rental/car-rental.service.js';

const OWNER = 'owner-1';
const pendingRow = {
  listing_id: 'car-1',
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
      return { rows: [] };
    };
    state.poolResponder = () => ({ rows: [ownerBookingRow] });

    const result = await respondBooking('bk-1', OWNER, 'confirm');

    expect(state.clientQueries[0]).toBe('BEGIN');
    expect(state.clientQueries.some((q) => q.includes('FOR UPDATE OF b'))).toBe(true);
    expect(state.clientQueries.some((q) => q.includes('daterange') && q.includes('FOR UPDATE'))).toBe(true);
    expect(state.clientQueries.some((q) => q.startsWith('UPDATE car_bookings SET status'))).toBe(true);
    expect(state.clientQueries).toContain('COMMIT');
    expect(state.clientQueries).not.toContain('ROLLBACK');
    expect(fakeClient.release).toHaveBeenCalledTimes(1);

    // Fix #3: return value comes from a single targeted get-by-id, no re-list.
    expect(state.poolQueries).toHaveLength(1);
    expect(state.poolQueries[0]).toContain('WHERE b.id = $1 AND c.owner_id = $2');
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
