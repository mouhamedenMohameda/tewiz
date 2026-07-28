import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchSql, rows } from './helpers/db.js';

// Carpooling ("Ervdni") — the largest service: trip publishing (wallet-gated
// boost), the booking trust layer (request → accept w/ OTP → complete →
// commission), no-show handling, cancellation seat-return, and ratings.
//
// Booking mutations run in withTx and read the result back via BOOKING_SELECT
// on the same client, so the fake tx client answers both the mutation and the
// read-back. pool.query covers the list/admin/cron helpers.

const { queryMock, settingsMock, debitWalletMock, notifyMock, fakeClient, state } = vi.hoisted(() => {
  const state = {
    clientQueries: [] as string[],
    clientResponder: (_sql: string, _params?: any[]) => ({ rows: [] as any[], rowCount: 0 }),
  };
  const fakeClient = {
    query: vi.fn(async (sql: string, params?: any[]) => {
      state.clientQueries.push(sql.replace(/\s+/g, ' ').trim());
      return state.clientResponder(sql, params);
    }),
    release: vi.fn(),
  };
  return {
    queryMock: vi.fn(),
    settingsMock: vi.fn(),
    debitWalletMock: vi.fn(async () => {}),
    notifyMock: vi.fn(async () => {}),
    fakeClient,
    state,
  };
});

vi.mock('../src/db/pool.js', () => ({
  pool: { query: queryMock },
  withTx: async (fn: (c: typeof fakeClient) => Promise<unknown>) => {
    await fakeClient.query('BEGIN');
    try {
      const r = await fn(fakeClient);
      await fakeClient.query('COMMIT');
      return r;
    } catch (e) {
      await fakeClient.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      fakeClient.release();
    }
  },
}));
vi.mock('../src/modules/admin/app-settings.service.js', () => ({ getPricingSettings: settingsMock }));
vi.mock('../src/modules/wallet/wallet.service.js', () => ({ debitWallet: debitWalletMock }));
vi.mock('../src/modules/notifications/notifications.service.js', () => ({ sendNotification: notifyMock }));

import {
  publishTrip,
  requestBooking,
  acceptBooking,
  declineBooking,
  completeBooking,
  markBookingNoShow,
  cancelBooking,
  rateBooking,
  updateTripSeats,
  cancelMyTrip,
  expireTrips,
  getAdminStats,
  listTrips,
} from '../src/modules/carpooling/carpooling.service.js';

const SETTINGS = {
  carpoolingEnabled: true,
  carpoolingPublicationFee: 0,
  carpoolingBoostFee: 500,
  carpoolingCommissionBps: 1000, // 10%
  carpoolingNoShowLimit: 3,
};

// A full BOOKING_SELECT read-back row used by fetchBookingView.
function bookingSelectRow(over: Record<string, unknown> = {}) {
  return {
    id: 'bk-1',
    trip_id: 'trip-1',
    passenger_id: 'pass-1',
    seats: 1,
    status: 'requested',
    otp_code: null,
    fare_mru: 1000,
    commission_mru: 0,
    created_at: new Date('2026-07-01T00:00:00.000Z'),
    accepted_at: null,
    completed_at: null,
    driver_id: 'drv-1',
    origin_city: 'Nouakchott',
    destination_city: 'Rosso',
    departure_at: new Date('2026-07-02T00:00:00.000Z'),
    price_per_seat_mru: 1000,
    driver_phone: '22200',
    driver_name: 'Sidi',
    passenger_name: 'Ali',
    passenger_phone: '22211',
    driver_rating_avg: '4.5',
    driver_rating_count: 10,
    passenger_rating_avg: '4.0',
    passenger_rating_count: 4,
    rated_by_passenger: false,
    rated_by_driver: false,
    ...over,
  };
}

const FUTURE = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  state.clientQueries = [];
  state.clientResponder = () => ({ rows: [], rowCount: 0 });
  settingsMock.mockResolvedValue(SETTINGS);
});

describe('publishTrip', () => {
  const input = {
    originCity: 'Nouakchott',
    destinationCity: 'Rosso',
    departureAt: FUTURE,
    totalSeats: 3,
    pricePerSeatMru: 1000,
  };

  it('403 when carpooling is disabled', async () => {
    settingsMock.mockResolvedValue({ ...SETTINGS, carpoolingEnabled: false });
    await expect(publishTrip('drv-1', input)).rejects.toMatchObject({ status: 403, code: 'carpooling_disabled' });
  });

  it('400 invalid_departure for an unparseable date', async () => {
    await expect(publishTrip('drv-1', { ...input, departureAt: 'not-a-date' }))
      .rejects.toMatchObject({ status: 400, code: 'invalid_departure' });
  });

  it('400 departure_too_soon when under 30 minutes away', async () => {
    await expect(publishTrip('drv-1', { ...input, departureAt: new Date(Date.now() + 60_000).toISOString() }))
      .rejects.toMatchObject({ status: 400, code: 'departure_too_soon' });
  });

  it('403 captain_only for a non-captain', async () => {
    state.clientResponder = (sql) =>
      /FROM users WHERE id/.test(sql) ? { rows: [{ role: 'rider', phone: '2', full_name: 'X' }], rowCount: 1 } : { rows: [], rowCount: 0 };
    await expect(publishTrip('drv-1', input)).rejects.toMatchObject({ status: 403, code: 'captain_only' });
  });

  it('publishes free (no wallet touch) when not boosted', async () => {
    state.clientResponder = (sql) => {
      if (/FROM users WHERE id/.test(sql)) return { rows: [{ role: 'captain', phone: '22200', full_name: 'Sidi' }], rowCount: 1 };
      if (/INSERT INTO carpooling_trips/.test(sql)) return {
        rows: [{
          id: 'trip-1', driver_id: 'drv-1', origin_city: 'Nouakchott', destination_city: 'Rosso',
          departure_at: new Date(FUTURE), total_seats: 3, available_seats: 3, price_per_seat_mru: 1000,
          driver_phone: '22200', notes: null, publication_fee_mru: 0, boost_fee_mru: 0,
          is_boosted: false, boosted_until: null, views_count: 0, status: 'active',
          created_at: new Date('2026-07-01T00:00:00.000Z'), driver_name: 'Sidi',
        }], rowCount: 1,
      };
      return { rows: [], rowCount: 0 };
    };
    const trip = await publishTrip('drv-1', input);
    expect(debitWalletMock).not.toHaveBeenCalled();
    expect(state.clientQueries.some((q) => /FROM wallets WHERE captain_id/.test(q))).toBe(false);
    expect(trip.id).toBe('trip-1');
    expect(trip.isBoosted).toBe(false);
  });

  it('402 insufficient_wallet when a boosted publish exceeds the balance', async () => {
    state.clientResponder = (sql) => {
      if (/FROM users WHERE id/.test(sql)) return { rows: [{ role: 'captain', phone: '22200', full_name: 'Sidi' }], rowCount: 1 };
      if (/FROM wallets WHERE captain_id/.test(sql)) return { rows: [{ balance_mru: '100' }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    };
    await expect(publishTrip('drv-1', { ...input, boost: true }))
      .rejects.toMatchObject({ status: 402, code: 'insufficient_wallet' });
    expect(debitWalletMock).not.toHaveBeenCalled();
  });

  it('charges publication + boost fee when the balance suffices', async () => {
    state.clientResponder = (sql) => {
      if (/FROM users WHERE id/.test(sql)) return { rows: [{ role: 'captain', phone: '22200', full_name: 'Sidi' }], rowCount: 1 };
      if (/FROM wallets WHERE captain_id/.test(sql)) return { rows: [{ balance_mru: '1000' }], rowCount: 1 };
      if (/INSERT INTO carpooling_trips/.test(sql)) return {
        rows: [{
          id: 'trip-1', driver_id: 'drv-1', origin_city: 'Nouakchott', destination_city: 'Rosso',
          departure_at: new Date(FUTURE), total_seats: 3, available_seats: 3, price_per_seat_mru: 1000,
          driver_phone: '22200', notes: null, publication_fee_mru: 500, boost_fee_mru: 500,
          is_boosted: true, boosted_until: new Date(), views_count: 0, status: 'active',
          created_at: new Date('2026-07-01T00:00:00.000Z'), driver_name: 'Sidi',
        }], rowCount: 1,
      };
      return { rows: [], rowCount: 0 };
    };
    await publishTrip('drv-1', { ...input, boost: true });
    // publicationFee(0) + boostFee(500) = 500 debited.
    expect(debitWalletMock).toHaveBeenCalledWith(
      expect.objectContaining({ amountMru: 500, type: 'carpooling_publication' }),
      fakeClient,
    );
  });
});

describe('requestBooking', () => {
  function tripLock(over: Record<string, unknown> = {}) {
    return {
      driver_id: 'drv-1', status: 'active', departure_at: new Date(Date.now() + 86_400_000),
      available_seats: 3, price_per_seat_mru: 1000, origin_city: 'Nouakchott', destination_city: 'Rosso',
      ...over,
    };
  }

  it('400 own_trip when the passenger is the driver', async () => {
    state.clientResponder = (sql) =>
      /FROM carpooling_trips/.test(sql) && /FOR UPDATE/.test(sql)
        ? { rows: [tripLock({ driver_id: 'pass-1' })], rowCount: 1 } : { rows: [], rowCount: 0 };
    await expect(requestBooking('pass-1', 'trip-1', 1)).rejects.toMatchObject({ status: 400, code: 'own_trip' });
  });

  it('409 not_enough_seats when requesting more than available', async () => {
    state.clientResponder = (sql) =>
      /FOR UPDATE/.test(sql) ? { rows: [tripLock({ available_seats: 1 })], rowCount: 1 } : { rows: [], rowCount: 0 };
    await expect(requestBooking('pass-1', 'trip-1', 2)).rejects.toMatchObject({ status: 409, code: 'not_enough_seats' });
  });

  it('403 too_many_no_shows when the passenger is over the rolling limit', async () => {
    state.clientResponder = (sql) => {
      if (/FOR UPDATE/.test(sql) && /carpooling_trips/.test(sql)) return { rows: [tripLock()], rowCount: 1 };
      if (/status = 'no_show'/.test(sql)) return { rows: [{ cnt: '3' }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    };
    await expect(requestBooking('pass-1', 'trip-1', 1)).rejects.toMatchObject({ status: 403, code: 'too_many_no_shows' });
  });

  it('409 already_requested on a unique-violation (23505)', async () => {
    state.clientResponder = (sql) => {
      if (/FOR UPDATE/.test(sql) && /carpooling_trips/.test(sql)) return { rows: [tripLock()], rowCount: 1 };
      if (/status = 'no_show'/.test(sql)) return { rows: [{ cnt: '0' }], rowCount: 1 };
      if (/INSERT INTO carpooling_bookings/.test(sql)) { const e: any = new Error('dup'); e.code = '23505'; throw e; }
      return { rows: [], rowCount: 0 };
    };
    await expect(requestBooking('pass-1', 'trip-1', 1)).rejects.toMatchObject({ status: 409, code: 'already_requested' });
  });

  it('creates the booking and returns the passenger view with the phone still hidden', async () => {
    state.clientResponder = (sql) => {
      if (/FOR UPDATE/.test(sql) && /carpooling_trips/.test(sql)) return { rows: [tripLock()], rowCount: 1 };
      if (/status = 'no_show'/.test(sql)) return { rows: [{ cnt: '0' }], rowCount: 1 };
      if (/INSERT INTO carpooling_bookings/.test(sql)) return { rows: [{ id: 'bk-1' }], rowCount: 1 };
      if (/FROM carpooling_bookings b/.test(sql)) return { rows: [bookingSelectRow({ status: 'requested' })], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    };
    const view = await requestBooking('pass-1', 'trip-1', 1);
    expect(view.id).toBe('bk-1');
    // Status still 'requested' → contact not revealed, no OTP.
    expect(view.driverPhone).toBeNull();
    expect(view.otpCode).toBeNull();
    expect(notifyMock).toHaveBeenCalled();
  });
});

describe('acceptBooking → completeBooking OTP flow', () => {
  function driverLock(over: Record<string, unknown> = {}) {
    return {
      status: 'requested', seats: 1, fare_mru: 1000, otp_code: null, passenger_id: 'pass-1',
      trip_id: 'trip-1', driver_id: 'drv-1', trip_status: 'active', available_seats: 3,
      origin_city: 'Nouakchott', destination_city: 'Rosso', ...over,
    };
  }

  it('403 not_your_trip when the actor is not the driver', async () => {
    state.clientResponder = (sql) =>
      /FOR UPDATE OF b, t/.test(sql) ? { rows: [driverLock({ driver_id: 'someone-else' })], rowCount: 1 } : { rows: [], rowCount: 0 };
    await expect(acceptBooking('drv-1', 'bk-1')).rejects.toMatchObject({ status: 403, code: 'not_your_trip' });
  });

  it('accept: sets OTP, decrements seats, returns driver view with the passenger phone revealed', async () => {
    state.clientResponder = (sql) => {
      if (/FOR UPDATE OF b, t/.test(sql)) return { rows: [driverLock()], rowCount: 1 };
      if (/FROM carpooling_bookings b/.test(sql) && /WHERE b\.id = \$1/.test(sql))
        return { rows: [bookingSelectRow({ status: 'accepted', otp_code: '1234' })], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    };
    const view = await acceptBooking('drv-1', 'bk-1');
    // Seat decrement issued.
    expect(state.clientQueries.some((q) => /available_seats = available_seats - \$2/.test(q))).toBe(true);
    // Driver view of an accepted booking → passenger phone revealed, driver's own phone hidden.
    expect(view.passengerPhone).toBe('22211');
    expect(view.driverPhone).toBeNull();
    // OTP is only shown to the passenger, never in the driver view.
    expect(view.otpCode).toBeNull();
  });

  it('complete: 400 invalid_otp when the code mismatches', async () => {
    state.clientResponder = (sql) =>
      /FOR UPDATE OF b, t/.test(sql) ? { rows: [driverLock({ status: 'accepted', otp_code: '1234' })], rowCount: 1 } : { rows: [], rowCount: 0 };
    await expect(completeBooking('drv-1', 'bk-1', '9999')).rejects.toMatchObject({ status: 400, code: 'invalid_otp' });
  });

  it('complete: 409 not_accepted when the booking is not accepted', async () => {
    state.clientResponder = (sql) =>
      /FOR UPDATE OF b, t/.test(sql) ? { rows: [driverLock({ status: 'requested' })], rowCount: 1 } : { rows: [], rowCount: 0 };
    await expect(completeBooking('drv-1', 'bk-1', '1234')).rejects.toMatchObject({ status: 409, code: 'not_accepted' });
  });

  it('complete: debits the 10% commission and marks completed', async () => {
    state.clientResponder = (sql) => {
      if (/FOR UPDATE OF b, t/.test(sql)) return { rows: [driverLock({ status: 'accepted', otp_code: '1234', fare_mru: 2000 })], rowCount: 1 };
      if (/FROM carpooling_bookings b/.test(sql) && /WHERE b\.id = \$1/.test(sql))
        return { rows: [bookingSelectRow({ status: 'completed', commission_mru: 200 })], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    };
    const view = await completeBooking('drv-1', 'bk-1', ' 1234 ');
    // 2000 * 1000bps / 10000 = 200.
    expect(debitWalletMock).toHaveBeenCalledWith(
      expect.objectContaining({ amountMru: 200, type: 'carpooling_commission' }),
      fakeClient,
    );
    const upd = state.clientQueries.find((q) => /SET status = 'completed', completed_at = now\(\), commission_mru = \$2/.test(q));
    expect(upd).toBeTruthy();
    expect(view.status).toBe('completed');
  });
});

describe('declineBooking / markBookingNoShow / cancelBooking — seat accounting', () => {
  function driverLock(over: Record<string, unknown> = {}) {
    return {
      status: 'requested', seats: 1, fare_mru: 1000, otp_code: null, passenger_id: 'pass-1',
      trip_id: 'trip-1', driver_id: 'drv-1', trip_status: 'active', available_seats: 3,
      origin_city: 'A', destination_city: 'B', ...over,
    };
  }

  it('decline: 409 not_pending unless requested', async () => {
    state.clientResponder = (sql) =>
      /FOR UPDATE OF b, t/.test(sql) ? { rows: [driverLock({ status: 'accepted' })], rowCount: 1 } : { rows: [], rowCount: 0 };
    await expect(declineBooking('drv-1', 'bk-1')).rejects.toMatchObject({ status: 409, code: 'not_pending' });
  });

  it('no_show: releases the held seat back to the trip', async () => {
    state.clientResponder = (sql) => {
      if (/FOR UPDATE OF b, t/.test(sql)) return { rows: [driverLock({ status: 'accepted' })], rowCount: 1 };
      if (/FROM carpooling_bookings b/.test(sql) && /WHERE b\.id = \$1/.test(sql))
        return { rows: [bookingSelectRow({ status: 'no_show' })], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    };
    await markBookingNoShow('drv-1', 'bk-1');
    expect(state.clientQueries.some((q) => /available_seats = LEAST\(available_seats \+ \$2, total_seats\)/.test(q))).toBe(true);
  });

  it('cancel: 403 when the booking belongs to neither party', async () => {
    state.clientResponder = (sql) =>
      /FOR UPDATE OF b, t/.test(sql)
        ? { rows: [{ status: 'requested', seats: 1, passenger_id: 'pass-1', trip_id: 'trip-1', driver_id: 'drv-1', origin_city: 'A', destination_city: 'B' }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    await expect(cancelBooking('stranger', 'bk-1')).rejects.toMatchObject({ status: 403, code: 'not_your_booking' });
  });

  it('cancel: an accepted booking returns the seat; a requested one does not', async () => {
    // Accepted → seat returned.
    state.clientResponder = (sql) => {
      if (/FOR UPDATE OF b, t/.test(sql))
        return { rows: [{ status: 'accepted', seats: 2, passenger_id: 'pass-1', trip_id: 'trip-1', driver_id: 'drv-1', origin_city: 'A', destination_city: 'B' }], rowCount: 1 };
      if (/FROM carpooling_bookings b/.test(sql) && /WHERE b\.id = \$1/.test(sql))
        return { rows: [bookingSelectRow({ status: 'cancelled' })], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    };
    await cancelBooking('pass-1', 'bk-1');
    expect(state.clientQueries.some((q) => /available_seats = LEAST/.test(q))).toBe(true);

    // Reset & test requested → no seat return.
    state.clientQueries = [];
    state.clientResponder = (sql) => {
      if (/FOR UPDATE OF b, t/.test(sql))
        return { rows: [{ status: 'requested', seats: 2, passenger_id: 'pass-1', trip_id: 'trip-1', driver_id: 'drv-1', origin_city: 'A', destination_city: 'B' }], rowCount: 1 };
      if (/FROM carpooling_bookings b/.test(sql) && /WHERE b\.id = \$1/.test(sql))
        return { rows: [bookingSelectRow({ status: 'cancelled' })], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    };
    await cancelBooking('pass-1', 'bk-1');
    expect(state.clientQueries.some((q) => /available_seats = LEAST/.test(q))).toBe(false);
  });
});

describe('rateBooking', () => {
  it('409 not_completed unless the booking is completed', async () => {
    state.clientResponder = (sql) =>
      /FOR UPDATE OF b/.test(sql) ? { rows: [{ status: 'accepted', passenger_id: 'pass-1', driver_id: 'drv-1' }], rowCount: 1 } : { rows: [], rowCount: 0 };
    await expect(rateBooking('pass-1', 'bk-1', 5, null)).rejects.toMatchObject({ status: 409, code: 'not_completed' });
  });

  it('409 already_rated on a unique-violation, and recomputes reputation on success', async () => {
    // already_rated
    state.clientResponder = (sql) => {
      if (/FOR UPDATE OF b/.test(sql)) return { rows: [{ status: 'completed', passenger_id: 'pass-1', driver_id: 'drv-1' }], rowCount: 1 };
      if (/INSERT INTO carpooling_ratings/.test(sql)) { const e: any = new Error('dup'); e.code = '23505'; throw e; }
      return { rows: [], rowCount: 0 };
    };
    await expect(rateBooking('pass-1', 'bk-1', 5, null)).rejects.toMatchObject({ status: 409, code: 'already_rated' });

    // success
    state.clientQueries = [];
    state.clientResponder = (sql) => {
      if (/FOR UPDATE OF b/.test(sql)) return { rows: [{ status: 'completed', passenger_id: 'pass-1', driver_id: 'drv-1' }], rowCount: 1 };
      if (/FROM carpooling_bookings b/.test(sql) && /WHERE b\.id = \$1/.test(sql))
        return { rows: [bookingSelectRow({ status: 'completed', rated_by_passenger: true })], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    };
    const view = await rateBooking('pass-1', 'bk-1', 5, 'great');
    expect(state.clientQueries.some((q) => /carpooling_rating_avg = agg\.avg/.test(q))).toBe(true);
    expect(view.ratedByMe).toBe(true);
  });
});

describe('pool-only helpers', () => {
  it('updateTripSeats 404s when nothing matched', async () => {
    dispatchSql(queryMock, [[/UPDATE carpooling_trips t/, rows([])]]);
    await expect(updateTripSeats('trip-1', 'drv-1', 2)).rejects.toMatchObject({ status: 404, code: 'trip_not_found' });
  });

  it('cancelMyTrip maps rowCount to boolean', async () => {
    dispatchSql(queryMock, [[/UPDATE carpooling_trips/, { rows: [], rowCount: 1 }]]);
    expect(await cancelMyTrip('trip-1', 'drv-1')).toBe(true);
  });

  it('expireTrips returns the affected count', async () => {
    dispatchSql(queryMock, [[/UPDATE carpooling_trips/, { rows: [], rowCount: 4 }]]);
    expect(await expireTrips()).toBe(4);
  });

  it('getAdminStats coerces text aggregates', async () => {
    dispatchSql(queryMock, [[/FROM carpooling_trips/, rows([{
      total_trips: '10', total_revenue_mru: '0', total_boost_revenue_mru: '1500', avg_views: '2.5',
    }])]]);
    expect(await getAdminStats()).toEqual({
      totalTrips: 10, totalRevenueMru: 0, totalBoostRevenueMru: 1500, avgViews: 2.5,
    });
  });

  it('listTrips boosts to the top and only appends provided filters', async () => {
    dispatchSql(queryMock, [[/FROM carpooling_trips t/, rows([])]]);
    await listTrips({ excludeDriverId: 'me', origin: 'Nouak' });
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/t\.status = 'active'/);
    expect(sql).toMatch(/is_boosted = true/); // boosted-first ordering
    expect(sql).toMatch(/driver_id <> \$1/);
    expect(sql).toMatch(/origin_city ILIKE \$2/);
    expect(params).toEqual(['me', '%Nouak%']);
  });
});
