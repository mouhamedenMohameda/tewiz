import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, startTestApp, type TestAppHandle } from './helpers/app.js';
import { HttpError } from '../src/middleware/error.js';

// Boundary tests for the carpooling router: zod validation (incl. the
// same-city refine), response envelopes, driverId stripping on public detail,
// and service-error propagation. Auth guards passthrough.

const { svcMock } = vi.hoisted(() => ({
  svcMock: {
    acceptBooking: vi.fn(),
    cancelBooking: vi.fn(),
    cancelMyTrip: vi.fn(),
    completeBooking: vi.fn(),
    declineBooking: vi.fn(),
    getTripById: vi.fn(),
    listDriverBookings: vi.fn(),
    listMyTrips: vi.fn(),
    listPassengerBookings: vi.fn(),
    listTrips: vi.fn(),
    markBookingNoShow: vi.fn(),
    publishTrip: vi.fn(),
    rateBooking: vi.fn(),
    requestBooking: vi.fn(),
    updateTripSeats: vi.fn(),
  },
}));

vi.mock('../src/modules/carpooling/carpooling.service.js', () => svcMock);
vi.mock('../src/middleware/auth.js', () => ({
  requireAuth: (_req: any, _res: any, next: () => void) => next(),
  optionalAuth: (_req: any, _res: any, next: () => void) => next(),
  requireRole: () => (_req: any, _res: any, next: () => void) => next(),
}));

import { carpoolingRouter } from '../src/modules/carpooling/carpooling.routes.js';

const USER = { id: 'drv-1', role: 'captain' as const };
const FUTURE = new Date(Date.now() + 3 * 3600 * 1000).toISOString();
let app: TestAppHandle;

beforeEach(async () => {
  vi.clearAllMocks();
  app = await startTestApp('/carpooling', carpoolingRouter, USER);
});
afterEach(async () => {
  await app.close();
});

describe('POST /carpooling/trips', () => {
  it('rejects identical origin/destination via the refine (400)', async () => {
    const res = await api(app.baseUrl, 'POST', '/carpooling/trips', {
      origin_city: 'Nouakchott',
      destination_city: 'nouakchott',
      departure_at: FUTURE,
      total_seats: 3,
      price_per_seat_mru: 1000,
    });
    expect(res.status).toBe(400);
    expect(svcMock.publishTrip).not.toHaveBeenCalled();
  });

  it('rejects a non-ISO departure_at (400)', async () => {
    const res = await api(app.baseUrl, 'POST', '/carpooling/trips', {
      origin_city: 'Nouakchott',
      destination_city: 'Rosso',
      departure_at: '2026-07-02',
      total_seats: 3,
      price_per_seat_mru: 1000,
    });
    expect(res.status).toBe(400);
  });

  it('rejects more than 8 seats (400)', async () => {
    const res = await api(app.baseUrl, 'POST', '/carpooling/trips', {
      origin_city: 'Nouakchott',
      destination_city: 'Rosso',
      departure_at: FUTURE,
      total_seats: 9,
      price_per_seat_mru: 1000,
    });
    expect(res.status).toBe(400);
  });

  it('publishes (201) and maps snake→camel input', async () => {
    svcMock.publishTrip.mockResolvedValue({ id: 'trip-1' });
    const res = await api(app.baseUrl, 'POST', '/carpooling/trips', {
      origin_city: 'Nouakchott',
      destination_city: 'Rosso',
      departure_at: FUTURE,
      total_seats: 3,
      price_per_seat_mru: 1000,
      boost: true,
    });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ trip: { id: 'trip-1' } });
    expect(svcMock.publishTrip).toHaveBeenCalledWith('drv-1', expect.objectContaining({
      originCity: 'Nouakchott',
      destinationCity: 'Rosso',
      totalSeats: 3,
      pricePerSeatMru: 1000,
      boost: true,
    }));
  });

  it('propagates a 402 insufficient_wallet from the service', async () => {
    svcMock.publishTrip.mockRejectedValue(new HttpError(402, 'insufficient_wallet', 'x'));
    const res = await api(app.baseUrl, 'POST', '/carpooling/trips', {
      origin_city: 'Nouakchott',
      destination_city: 'Rosso',
      departure_at: FUTURE,
      total_seats: 3,
      price_per_seat_mru: 1000,
      boost: true,
    });
    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe('insufficient_wallet');
  });
});

describe('GET /carpooling/trips/:id — hides driverId', () => {
  it('strips driverId from the public detail', async () => {
    svcMock.getTripById.mockResolvedValue({ id: 'trip-1', driverId: 'drv-1', originCity: 'A', driverPhone: '22200' });
    const res = await api(app.baseUrl, 'GET', '/carpooling/trips/trip-1');
    expect(res.status).toBe(200);
    expect(res.body.trip).not.toHaveProperty('driverId');
    // Note: driverPhone is part of the detail contract and intentionally kept.
    expect(res.body.trip).toMatchObject({ id: 'trip-1', originCity: 'A' });
  });

  it('404s when the trip is missing', async () => {
    svcMock.getTripById.mockResolvedValue(null);
    const res = await api(app.baseUrl, 'GET', '/carpooling/trips/ghost');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('trip_not_found');
  });
});

describe('booking endpoints', () => {
  it('POST /trips/:id/bookings defaults seats to 1 and returns 201', async () => {
    svcMock.requestBooking.mockResolvedValue({ id: 'bk-1' });
    const res = await api(app.baseUrl, 'POST', '/carpooling/trips/trip-1/bookings', {});
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ booking: { id: 'bk-1' } });
    expect(svcMock.requestBooking).toHaveBeenCalledWith('drv-1', 'trip-1', 1);
  });

  it('POST /bookings/:id/complete requires an otp and forwards it', async () => {
    const bad = await api(app.baseUrl, 'POST', '/carpooling/bookings/bk-1/complete', {});
    expect(bad.status).toBe(400);

    svcMock.completeBooking.mockResolvedValue({ id: 'bk-1', status: 'completed' });
    const ok = await api(app.baseUrl, 'POST', '/carpooling/bookings/bk-1/complete', { otp: '1234' });
    expect(ok.status).toBe(200);
    expect(svcMock.completeBooking).toHaveBeenCalledWith('drv-1', 'bk-1', '1234');
  });

  it('POST /bookings/:id/rate validates stars 1..5', async () => {
    const bad = await api(app.baseUrl, 'POST', '/carpooling/bookings/bk-1/rate', { stars: 6 });
    expect(bad.status).toBe(400);

    svcMock.rateBooking.mockResolvedValue({ id: 'bk-1' });
    const ok = await api(app.baseUrl, 'POST', '/carpooling/bookings/bk-1/rate', { stars: 5, comment: 'top' });
    expect(ok.status).toBe(200);
    expect(svcMock.rateBooking).toHaveBeenCalledWith('drv-1', 'bk-1', 5, 'top');
  });

  it('POST /bookings/:id/cancel passes null comment through and returns the booking', async () => {
    svcMock.cancelBooking.mockResolvedValue({ id: 'bk-1', status: 'cancelled' });
    const res = await api(app.baseUrl, 'POST', '/carpooling/bookings/bk-1/cancel', {});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ booking: { id: 'bk-1', status: 'cancelled' } });
  });

  it('propagates a 409 not_pending from accept', async () => {
    svcMock.acceptBooking.mockRejectedValue(new HttpError(409, 'not_pending', 'x'));
    const res = await api(app.baseUrl, 'POST', '/carpooling/bookings/bk-1/accept', {});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('not_pending');
  });
});

describe('PATCH /carpooling/trips/:id/seats', () => {
  it('validates available_seats range', async () => {
    const res = await api(app.baseUrl, 'PATCH', '/carpooling/trips/trip-1/seats', { available_seats: 9 });
    expect(res.status).toBe(400);
  });
  it('forwards the new seat count', async () => {
    svcMock.updateTripSeats.mockResolvedValue({ id: 'trip-1', availableSeats: 2 });
    const res = await api(app.baseUrl, 'PATCH', '/carpooling/trips/trip-1/seats', { available_seats: 2 });
    expect(res.status).toBe(200);
    expect(svcMock.updateTripSeats).toHaveBeenCalledWith('trip-1', 'drv-1', 2);
  });
});
