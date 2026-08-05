import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, startTestApp, type TestAppHandle } from './helpers/app.js';

const { ridesMock, auditMock, distanceMetersMock, estimateFareMock, pricingSettingsMock } =
  vi.hoisted(() => ({
    ridesMock: {
      listAdminRides: vi.fn(),
      getRideForUser: vi.fn(),
      createRide: vi.fn(),
      rebroadcastRide: vi.fn(),
      adminCancelRide: vi.fn(),
    },
    auditMock: vi.fn(),
    distanceMetersMock: vi.fn(),
    estimateFareMock: vi.fn(),
    pricingSettingsMock: vi.fn(),
  }));

vi.mock('../src/modules/rides/rides.service.js', () => ridesMock);
vi.mock('../src/modules/admin/audit.js', () => ({ audit: auditMock }));
vi.mock('../src/modules/rides/dispatch.service.js', () => ({
  distanceMeters: distanceMetersMock,
}));
vi.mock('../src/modules/rides/pricing.js', () => ({ estimateFareMru: estimateFareMock }));
vi.mock('../src/modules/admin/app-settings.service.js', () => ({
  getPricingSettings: pricingSettingsMock,
}));

import { adminRidesRouter } from '../src/modules/rides/admin-rides.routes.js';

const ADMIN = { id: 'admin-1', role: 'admin' as const, adminRole: 'super_admin' };
const PICKUP = { lat: 18.08, lng: -15.97, label: 'Ksar' };
const DROPOFF = { lat: 18.1, lng: -15.95, label: 'Sebkha' };

let handle: TestAppHandle | null = null;

async function start() {
  handle = await startTestApp('/admin/rides', adminRidesRouter, ADMIN);
  return handle;
}

beforeEach(() => {
  for (const fn of Object.values(ridesMock)) fn.mockReset();
  auditMock.mockReset();
  auditMock.mockResolvedValue(undefined);
  distanceMetersMock.mockReset();
  estimateFareMock.mockReset();
  pricingSettingsMock.mockReset();
});

afterEach(async () => {
  if (handle) await handle.close();
  handle = null;
});

describe('GET /admin/rides', () => {
  it('lists rides with a status shortcut and cursor', async () => {
    ridesMock.listAdminRides.mockResolvedValue([{ id: 'ride-1' }]);
    const { baseUrl } = await start();
    const res = await api(
      baseUrl,
      'GET',
      '/admin/rides?status=active&limit=50&before=2026-07-01T10:00:00.000Z',
    );
    expect(res.status).toBe(200);
    expect(ridesMock.listAdminRides).toHaveBeenCalledWith({
      status: 'active',
      limit: 50,
      before: new Date('2026-07-01T10:00:00.000Z'),
    });
  });

  it('rejects an unknown status with 400', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/admin/rides?status=bogus');
    expect(res.status).toBe(400);
  });
});

describe('GET /admin/rides/open-quote', () => {
  it('returns the open-ride tariff (and is not swallowed by /:id)', async () => {
    pricingSettingsMock.mockResolvedValue({
      allowOpenRides: false,
      openBaseFareMru: 30,
      openPerKmMru: 25,
      openPerMinuteMru: 3,
      openMinFareMru: 50,
    });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/admin/rides/open-quote');
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
    expect(ridesMock.getRideForUser).not.toHaveBeenCalled();
  });
});

describe('GET /admin/rides/:id', () => {
  it('fetches any ride with the admin scope', async () => {
    ridesMock.getRideForUser.mockResolvedValue({ id: 'ride-2' });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/admin/rides/ride-2');
    expect(res.status).toBe(200);
    expect(ridesMock.getRideForUser).toHaveBeenCalledWith('ride-2', 'admin-1', 'admin');
  });
});

describe('POST /admin/rides/estimate', () => {
  it('returns the same quote shape as the rider endpoint', async () => {
    distanceMetersMock.mockResolvedValue(3000);
    estimateFareMock.mockResolvedValue({
      fareMru: 90,
      distanceEstimateM: 3900,
      pricingModeApplied: 'solo',
      sharedSeatsApplied: null,
      soloFareMru: 90,
      isIntercityPricing: false,
    });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/admin/rides/estimate', {
      pickup: PICKUP,
      dropoff: DROPOFF,
      rideType: 'colis',
    });
    expect(res.status).toBe(200);
    expect(res.body.fareMru).toBe(90);
    expect(estimateFareMock).toHaveBeenCalledWith(3000, 'colis', expect.anything());
  });
});

describe('POST /admin/rides', () => {
  const validBody = {
    pickup: PICKUP,
    dropoff: DROPOFF,
    passengerName: 'Cheikh Ould Ahmed',
    passengerPhone: '+22246000001',
  };

  it('creates an operator ride that skips passenger confirmation', async () => {
    ridesMock.createRide.mockResolvedValue({ id: 'ride-3', status: 'searching' });
    const { baseUrl } = await start();

    const res = await api(baseUrl, 'POST', '/admin/rides', validBody);
    expect(res.status).toBe(200);
    expect(ridesMock.createRide).toHaveBeenCalledWith(
      expect.objectContaining({
        bookerId: 'admin-1',
        skipPassengerConfirm: true,
        source: 'operator',
      }),
    );
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'create_phone_ride', targetId: 'ride-3' }),
    );
  });

  it('rejects a colis ride without recipient info', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/admin/rides', {
      ...validBody,
      rideType: 'colis',
    });
    expect(res.status).toBe(400);
    expect(ridesMock.createRide).not.toHaveBeenCalled();
  });

  it('rejects an open ride that also has a dropoff', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/admin/rides', { ...validBody, isOpen: true });
    expect(res.status).toBe(400);
  });

  it('rejects a closed ride without dropoff', async () => {
    const { baseUrl } = await start();
    const { dropoff: _omit, ...noDropoff } = validBody;
    const res = await api(baseUrl, 'POST', '/admin/rides', noDropoff);
    expect(res.status).toBe(400);
  });
});

describe('POST /admin/rides/:id/rebroadcast', () => {
  it('re-pushes the ride and audits the action', async () => {
    ridesMock.rebroadcastRide.mockResolvedValue({ captainsNotified: 4 });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/admin/rides/ride-4/rebroadcast');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ captainsNotified: 4 });
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'rebroadcast_ride', targetId: 'ride-4' }),
    );
  });
});

describe('POST /admin/rides/:id/cancel', () => {
  it('cancels from any status with a reason', async () => {
    ridesMock.adminCancelRide.mockResolvedValue({ id: 'ride-5', status: 'cancelled_by_system' });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/admin/rides/ride-5/cancel', {
      reason: 'Client injoignable',
    });
    expect(res.status).toBe(200);
    expect(ridesMock.adminCancelRide).toHaveBeenCalledWith({
      rideId: 'ride-5',
      reason: 'Client injoignable',
    });
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'cancel_ride' }));
  });

  it('requires a reason (400)', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/admin/rides/ride-5/cancel', {});
    expect(res.status).toBe(400);
  });
});
