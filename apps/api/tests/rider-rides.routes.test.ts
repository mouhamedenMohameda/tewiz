import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RIDER_RIDE_CANCEL_REASONS, RIDE_CANCEL_REASON_LABEL_FR } from '@tewiz/shared-types';
import { api, startTestApp, type TestAppHandle } from './helpers/app.js';
import { dispatchSql, rows } from './helpers/db.js';

const { queryMock, ridesMock, distanceMetersMock, estimateFareMock, pricingSettingsMock } =
  vi.hoisted(() => ({
    queryMock: vi.fn(),
    ridesMock: {
      createRide: vi.fn(),
      getCurrentRideForRider: vi.fn(),
      listRiderHistory: vi.fn(),
      getRideForUser: vi.fn(),
      rateCaptain: vi.fn(),
      cancelRide: vi.fn(),
    },
    distanceMetersMock: vi.fn(),
    estimateFareMock: vi.fn(),
    pricingSettingsMock: vi.fn(),
  }));

vi.mock('../src/db/pool.js', () => ({
  pool: { query: queryMock, connect: vi.fn(), on: vi.fn() },
  withTx: vi.fn(),
}));
vi.mock('../src/modules/rides/rides.service.js', () => ridesMock);
vi.mock('../src/modules/rides/dispatch.service.js', () => ({
  distanceMeters: distanceMetersMock,
}));
vi.mock('../src/modules/rides/pricing.js', () => ({ estimateFareMru: estimateFareMock }));
vi.mock('../src/modules/admin/app-settings.service.js', () => ({
  getPricingSettings: pricingSettingsMock,
}));

import { riderRidesRouter } from '../src/modules/rides/rider-rides.routes.js';

const RIDER = { id: 'rider-1', role: 'rider' as const };
const PICKUP = { lat: 18.08, lng: -15.97, label: 'Marché Capitale' };
const DROPOFF = { lat: 18.1, lng: -15.95, label: 'Tevragh Zeina' };

let handle: TestAppHandle | null = null;

async function start() {
  handle = await startTestApp('/rider/rides', riderRidesRouter, RIDER);
  return handle;
}

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
  for (const fn of Object.values(ridesMock)) fn.mockReset();
  distanceMetersMock.mockReset();
  estimateFareMock.mockReset();
  pricingSettingsMock.mockReset();
});

afterEach(async () => {
  if (handle) await handle.close();
  handle = null;
});

describe('POST /rider/rides/estimate', () => {
  it('returns the fare quote from pricing', async () => {
    distanceMetersMock.mockResolvedValue(2500);
    estimateFareMock.mockResolvedValue({
      fareMru: 120,
      distanceEstimateM: 3250,
      pricingModeApplied: 'solo',
      sharedSeatsApplied: null,
      soloFareMru: 120,
      isIntercityPricing: false,
    });
    const { baseUrl } = await start();

    const res = await api(baseUrl, 'POST', '/rider/rides/estimate', {
      pickup: PICKUP,
      dropoff: DROPOFF,
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ fareMru: 120, distanceM: 3250, pricingMode: 'solo' });
    expect(estimateFareMock).toHaveBeenCalledWith(2500, 'passenger', {
      pricingMode: undefined,
      sharedSeats: undefined,
    });
  });

  it('rejects an out-of-range latitude with 400', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/rider/rides/estimate', {
      pickup: { lat: 91, lng: 0 },
      dropoff: DROPOFF,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });
});

describe('POST /rider/rides', () => {
  it('creates a ride for a rider with a phone on file', async () => {
    dispatchSql(queryMock, [[/SELECT phone FROM users/, rows([{ phone: '+22245123456' }])]]);
    ridesMock.createRide.mockResolvedValue({ id: 'ride-1', status: 'searching' });
    const { baseUrl } = await start();

    const res = await api(baseUrl, 'POST', '/rider/rides', {
      pickup: PICKUP,
      dropoff: DROPOFF,
    });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('ride-1');
    expect(ridesMock.createRide).toHaveBeenCalledWith(
      expect.objectContaining({ bookerId: 'rider-1', rideType: 'passenger', paymentMethod: 'cash' }),
    );
  });

  it('blocks a guest without a phone (400 phone_required)', async () => {
    dispatchSql(queryMock, [[/SELECT phone FROM users/, rows([{ phone: null }])]]);
    const { baseUrl } = await start();

    const res = await api(baseUrl, 'POST', '/rider/rides', { pickup: PICKUP, dropoff: DROPOFF });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('phone_required');
    expect(ridesMock.createRide).not.toHaveBeenCalled();
  });
});

describe('GET /rider/rides/open-quote', () => {
  it('exposes the open-ride tariff', async () => {
    pricingSettingsMock.mockResolvedValue({
      allowOpenRides: true,
      openBaseFareMru: 30,
      openPerKmMru: 25,
      openPerMinuteMru: 3,
      openMinFareMru: 50,
    });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/rider/rides/open-quote');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      enabled: true,
      baseFareMru: 30,
      perKmMru: 25,
      perMinuteMru: 3,
      minFareMru: 50,
    });
  });
});

describe('GET /rider/rides/current', () => {
  it('returns 204 when there is no active ride', async () => {
    ridesMock.getCurrentRideForRider.mockResolvedValue(null);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/rider/rides/current');
    expect(res.status).toBe(204);
  });

  it('returns the active ride', async () => {
    ridesMock.getCurrentRideForRider.mockResolvedValue({ id: 'ride-2', status: 'accepted' });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/rider/rides/current');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('ride-2');
  });
});

describe('GET /rider/rides/history', () => {
  it('lists the rider history', async () => {
    ridesMock.listRiderHistory.mockResolvedValue([{ id: 'ride-3' }]);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/rider/rides/history');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'ride-3' }]);
    expect(ridesMock.listRiderHistory).toHaveBeenCalledWith('rider-1', 30);
  });
});

describe('GET /rider/rides/:id', () => {
  it('fetches a single ride scoped to the rider', async () => {
    ridesMock.getRideForUser.mockResolvedValue({ id: 'ride-4' });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/rider/rides/ride-4');
    expect(res.status).toBe(200);
    expect(ridesMock.getRideForUser).toHaveBeenCalledWith('ride-4', 'rider-1', 'rider');
  });
});

describe('POST /rider/rides/:id/rating', () => {
  it('records a rating', async () => {
    ridesMock.rateCaptain.mockResolvedValue({ ok: true });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/rider/rides/ride-5/rating', {
      stars: 5,
      comment: 'Parfait',
    });
    expect(res.status).toBe(200);
    expect(ridesMock.rateCaptain).toHaveBeenCalledWith({
      rideId: 'ride-5',
      riderId: 'rider-1',
      stars: 5,
      comment: 'Parfait',
    });
  });

  it('rejects out-of-range stars with 400', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/rider/rides/ride-5/rating', { stars: 6 });
    expect(res.status).toBe(400);
  });
});

describe('POST /rider/rides/:id/cancel', () => {
  it('cancels with a free-text reason', async () => {
    ridesMock.cancelRide.mockResolvedValue({ id: 'ride-6', status: 'cancelled_by_rider' });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/rider/rides/ride-6/cancel', {
      reason: 'Changement de plan',
    });
    expect(res.status).toBe(200);
    expect(ridesMock.cancelRide).toHaveBeenCalledWith({
      rideId: 'ride-6',
      userId: 'rider-1',
      role: 'rider',
      reason: 'Changement de plan',
    });
  });

  it('maps a reasonKey to its French label', async () => {
    const key = RIDER_RIDE_CANCEL_REASONS[0]!;
    ridesMock.cancelRide.mockResolvedValue({ id: 'ride-6' });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/rider/rides/ride-6/cancel', { reasonKey: key });
    expect(res.status).toBe(200);
    expect(ridesMock.cancelRide).toHaveBeenCalledWith(
      expect.objectContaining({ reason: RIDE_CANCEL_REASON_LABEL_FR[key] }),
    );
  });

  it('rejects a cancel without any reason', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/rider/rides/ride-6/cancel', {});
    expect(res.status).toBe(400);
  });
});
