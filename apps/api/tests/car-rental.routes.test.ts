import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, startTestApp, type TestAppHandle } from './helpers/app.js';

// Fix #1 regression guard: booking dates are validated at the HTTP boundary,
// so an inverted range returns a clean 400 (not a 500 from the DB CHECK) and
// never reaches the service.

const { svcMock } = vi.hoisted(() => ({
  svcMock: {
    browseCars: vi.fn(),
    cancelBooking: vi.fn(),
    createCar: vi.fn(),
    getCarDetail: vi.fn(),
    getMyBookings: vi.fn(),
    listIncomingBookings: vi.fn(),
    listMyCars: vi.fn(),
    requestBooking: vi.fn(),
    respondBooking: vi.fn(),
    updateCar: vi.fn(),
  },
}));

vi.mock('../src/modules/car-rental/car-rental.service.js', () => svcMock);

// requireAuth runs inline on each route; the harness already injects req.user,
// so make the guard a passthrough for isolated route testing.
vi.mock('../src/middleware/auth.js', () => ({
  requireAuth: (_req: any, _res: any, next: () => void) => next(),
}));

import { carRentalRouter } from '../src/modules/car-rental/car-rental.routes.js';

const RENTER = { id: 'renter-1', role: 'rider' as const };
const VALID_LISTING = '11111111-1111-1111-1111-111111111111';

let app: TestAppHandle;

beforeEach(async () => {
  vi.clearAllMocks();
  app = await startTestApp('/car-rental', carRentalRouter, RENTER);
});

afterEach(async () => {
  await app.close();
});

describe('POST /car-rental/bookings — date validation', () => {
  it('rejects a booking whose end_date is before start_date with 400', async () => {
    const res = await api(app.baseUrl, 'POST', '/car-rental/bookings', {
      listing_id: VALID_LISTING,
      start_date: '2026-07-10',
      end_date: '2026-07-08',
    });
    expect(res.status).toBe(400);
    expect(svcMock.requestBooking).not.toHaveBeenCalled();
  });

  it('accepts a single-day booking (start == end)', async () => {
    svcMock.requestBooking.mockResolvedValue({ id: 'bk-1' });
    const res = await api(app.baseUrl, 'POST', '/car-rental/bookings', {
      listing_id: VALID_LISTING,
      start_date: '2026-07-10',
      end_date: '2026-07-10',
    });
    expect(res.status).toBe(201);
    expect(svcMock.requestBooking).toHaveBeenCalledWith('renter-1', {
      listingId: VALID_LISTING,
      startDate: '2026-07-10',
      endDate: '2026-07-10',
      withDriver: undefined,
    });
  });

  it('accepts a normal multi-day range', async () => {
    svcMock.requestBooking.mockResolvedValue({ id: 'bk-2' });
    const res = await api(app.baseUrl, 'POST', '/car-rental/bookings', {
      listing_id: VALID_LISTING,
      start_date: '2026-07-10',
      end_date: '2026-07-14',
      with_driver: true,
    });
    expect(res.status).toBe(201);
    expect(svcMock.requestBooking).toHaveBeenCalledWith('renter-1', {
      listingId: VALID_LISTING,
      startDate: '2026-07-10',
      endDate: '2026-07-14',
      withDriver: true,
    });
  });
});
