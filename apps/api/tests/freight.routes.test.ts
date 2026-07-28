import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, startTestApp, type TestAppHandle } from './helpers/app.js';
import { HttpError } from '../src/middleware/error.js';

const { svcMock } = vi.hoisted(() => ({
  svcMock: {
    browseTrips: vi.fn(),
    cancelBooking: vi.fn(),
    createTrip: vi.fn(),
    getTripDetail: vi.fn(),
    listIncomingBookings: vi.fn(),
    listMyBookings: vi.fn(),
    listMyTrips: vi.fn(),
    requestBooking: vi.fn(),
    respondBooking: vi.fn(),
    updateTrip: vi.fn(),
  },
}));

vi.mock('../src/modules/freight/freight.service.js', () => svcMock);
vi.mock('../src/middleware/auth.js', () => ({
  requireAuth: (_req: any, _res: any, next: () => void) => next(),
}));

import { freightRouter } from '../src/modules/freight/freight.routes.js';

const USER = { id: 'user-1', role: 'captain' as const };
const UUID = '11111111-1111-1111-1111-111111111111';
let app: TestAppHandle;

beforeEach(async () => {
  vi.clearAllMocks();
  app = await startTestApp('/freight', freightRouter, USER);
});
afterEach(async () => {
  await app.close();
});

describe('POST /freight/trips', () => {
  it('rejects capacity below 1 with 400', async () => {
    const res = await api(app.baseUrl, 'POST', '/freight/trips', {
      origin_city: 'Nouakchott',
      destination_city: 'Nouadhibou',
      departure_date: '2026-08-01',
      capacity_kg: 0,
      price_per_kg_mru: 50,
    });
    expect(res.status).toBe(400);
    expect(svcMock.createTrip).not.toHaveBeenCalled();
  });

  it('creates a trip (201) and maps snake→camel input', async () => {
    svcMock.createTrip.mockResolvedValue({ id: 'trip-1' });
    const res = await api(app.baseUrl, 'POST', '/freight/trips', {
      origin_city: 'Nouakchott',
      destination_city: 'Nouadhibou',
      departure_date: '2026-08-01',
      capacity_kg: 1000,
      price_per_kg_mru: 50,
      min_price_mru: 2000,
    });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ trip: { id: 'trip-1' } });
    expect(svcMock.createTrip).toHaveBeenCalledWith('user-1', expect.objectContaining({
      originCity: 'Nouakchott',
      destinationCity: 'Nouadhibou',
      capacityKg: 1000,
      pricePerKgMru: 50,
      minPriceMru: 2000,
    }));
  });
});

describe('POST /freight/bookings', () => {
  it('rejects a non-UUID trip_id with 400', async () => {
    const res = await api(app.baseUrl, 'POST', '/freight/bookings', {
      trip_id: 'nope',
      cargo_description: 'Cartons',
      weight_kg: 10,
    });
    expect(res.status).toBe(400);
  });

  it('propagates a 409 capacity_exceeded', async () => {
    svcMock.requestBooking.mockRejectedValue(new HttpError(409, 'capacity_exceeded', 'x'));
    const res = await api(app.baseUrl, 'POST', '/freight/bookings', {
      trip_id: UUID,
      cargo_description: 'Cartons',
      weight_kg: 999,
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('capacity_exceeded');
  });

  it('returns 201 { booking } on success', async () => {
    svcMock.requestBooking.mockResolvedValue({ id: 'bk-1' });
    const res = await api(app.baseUrl, 'POST', '/freight/bookings', {
      trip_id: UUID,
      cargo_description: 'Cartons',
      weight_kg: 10,
    });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ booking: { id: 'bk-1' } });
    expect(svcMock.requestBooking).toHaveBeenCalledWith('user-1', {
      tripId: UUID,
      cargoDescription: 'Cartons',
      weightKg: 10,
    });
  });
});

describe('POST /freight/bookings/:id/respond', () => {
  it('rejects an action other than confirm/decline', async () => {
    const res = await api(app.baseUrl, 'POST', `/freight/bookings/${UUID}/respond`, { action: 'maybe' });
    expect(res.status).toBe(400);
    expect(svcMock.respondBooking).not.toHaveBeenCalled();
  });

  it('forwards the action and returns { booking }', async () => {
    svcMock.respondBooking.mockResolvedValue({ id: 'bk-1', status: 'confirmed' });
    const res = await api(app.baseUrl, 'POST', `/freight/bookings/${UUID}/respond`, { action: 'confirm' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ booking: { id: 'bk-1', status: 'confirmed' } });
    expect(svcMock.respondBooking).toHaveBeenCalledWith(UUID, 'user-1', 'confirm');
  });
});

describe('GET /freight/trips (browse) vs /freight/trips/:id (detail)', () => {
  it('browse injects the caller as excludeCarrierId', async () => {
    svcMock.browseTrips.mockResolvedValue([{ id: 't1' }]);
    const res = await api(app.baseUrl, 'GET', '/freight/trips?origin=Nouak');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ trips: [{ id: 't1' }] });
    expect(svcMock.browseTrips).toHaveBeenCalledWith(expect.objectContaining({
      origin: 'Nouak',
      excludeCarrierId: 'user-1',
    }));
  });

  it('detail 404s for a missing or removed trip', async () => {
    svcMock.getTripDetail.mockResolvedValue({ id: 't1', status: 'removed' });
    const res = await api(app.baseUrl, 'GET', `/freight/trips/${UUID}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('trip_not_found');
  });

  it('detail returns the trip when active', async () => {
    svcMock.getTripDetail.mockResolvedValue({ id: 't1', status: 'active' });
    const res = await api(app.baseUrl, 'GET', `/freight/trips/${UUID}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ trip: { id: 't1', status: 'active' } });
  });
});

describe('POST /freight/bookings/:id/cancel', () => {
  it('404s when nothing was cancellable', async () => {
    svcMock.cancelBooking.mockResolvedValue(false);
    const res = await api(app.baseUrl, 'POST', `/freight/bookings/${UUID}/cancel`, {});
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('booking_not_found');
  });
});
