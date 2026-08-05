/**
 * FEATURE 1 — Commander une course.
 *
 * The entry point of the whole marketplace: if createRide accepts something it
 * shouldn't, every downstream guarantee (fare, commission, dispatch) is built
 * on a bad row. These tests pin the gates that run BEFORE the ride is written,
 * because that is the only place they can still be refused cheaply.
 *
 * Status per the audit: working. This file exists to keep it that way.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeClient, pricingSettings, rideRow } from './_fixtures.js';

const {
  poolQueryMock, withTxMock, settingsMock, distanceMock,
  estimateMock, eligibleMock, notifyMock, findPartnerMock,
} = vi.hoisted(() => ({
  poolQueryMock: vi.fn(),
  withTxMock: vi.fn(),
  settingsMock: vi.fn(),
  distanceMock: vi.fn(),
  estimateMock: vi.fn(),
  eligibleMock: vi.fn(),
  notifyMock: vi.fn(),
  findPartnerMock: vi.fn(),
}));

vi.mock('../../src/db/pool.js', () => ({
  pool: { query: poolQueryMock, connect: vi.fn(), on: vi.fn() },
  withTx: withTxMock,
}));
vi.mock('../../src/modules/admin/app-settings.service.js', () => ({
  getPricingSettings: settingsMock,
}));
vi.mock('../../src/modules/rides/dispatch.service.js', () => ({
  distanceMeters: distanceMock,
  eligibleCaptainsForRide: eligibleMock,
}));
vi.mock('../../src/modules/rides/pricing.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  estimateFareMru: estimateMock,
}));
vi.mock('../../src/modules/push/expo-push.js', () => ({ notifyCaptainsNewRide: notifyMock }));
vi.mock('../../src/modules/partners/partners.service.js', () => ({
  findPartnerByUserId: findPartnerMock,
}));
vi.mock('../../src/modules/auth/sms.js', () => ({ sms: { send: vi.fn() } }));

import { createRide } from '../../src/modules/rides/rides.service.js';

const PICKUP = { lat: 18.08, lng: -15.97, label: 'Marché Capitale' };
const DROPOFF = { lat: 18.1, lng: -15.95, label: 'Ksar' };

/** Wire withTx to a client that returns a freshly inserted ride row. */
function commitsARide(overrides: Record<string, unknown> = {}) {
  const client = fakeClient([
    [/INSERT INTO rides/i, () => ({ rows: [rideRow(overrides)] })],
  ]);
  withTxMock.mockImplementation(async (fn: any) => fn(client));
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
  settingsMock.mockResolvedValue(pricingSettings());
  findPartnerMock.mockResolvedValue(null);
  distanceMock.mockResolvedValue(4000);
  estimateMock.mockResolvedValue({
    fareMru: 205,
    distanceEstimateM: 5200,
    pricingModeApplied: 'solo',
    sharedSeatsApplied: null,
    soloFareMru: 205,
    isIntercityPricing: false,
  });
  eligibleMock.mockResolvedValue([]);
});

describe('creating a standard passenger ride', () => {
  it('writes the ride and returns it in searching state', async () => {
    commitsARide();

    const ride = await createRide({ bookerId: 'rider-1', pickup: PICKUP, dropoff: DROPOFF });

    expect(ride.status).toBe('searching');
    expect(ride.fareEstimateMru).toBe(205);
    expect(ride.pickup).toMatchObject({ lat: 18.08, lng: -15.97 });
  });

  it('prices from the crow-flies distance, not from anything client-supplied', async () => {
    commitsARide();

    await createRide({ bookerId: 'rider-1', pickup: PICKUP, dropoff: DROPOFF });

    // The client sends coordinates only; the server measures. A rider cannot
    // post a short distance to get a cheap fare.
    expect(distanceMock).toHaveBeenCalledWith(18.08, -15.97, 18.1, -15.95);
    expect(estimateMock).toHaveBeenCalledWith(4000, 'passenger', expect.anything());
  });
});

describe('gates that must refuse a ride before it is written', () => {
  it('refuses a trip shorter than 50 m', async () => {
    const client = commitsARide();
    distanceMock.mockResolvedValue(30);

    await expect(
      createRide({ bookerId: 'rider-1', pickup: PICKUP, dropoff: DROPOFF }),
    ).rejects.toMatchObject({ status: 400, code: 'distance_too_short' });

    // Refused before the transaction — no half-written ride to clean up.
    expect(client.didQuery(/INSERT INTO rides/i)).toBe(false);
  });

  it('refuses a fixed-fare ride with no destination', async () => {
    commitsARide();

    await expect(
      createRide({ bookerId: 'rider-1', pickup: PICKUP }),
    ).rejects.toMatchObject({ status: 400, code: 'missing_dropoff' });
  });

  it('refuses an open ride that also carries a destination', async () => {
    commitsARide();

    // Contradictory input: an open ride is metered precisely because nobody
    // knows where it ends. Accepting both would make the fare ambiguous.
    await expect(
      createRide({ bookerId: 'rider-1', pickup: PICKUP, dropoff: DROPOFF, isOpen: true }),
    ).rejects.toMatchObject({ status: 400, code: 'open_has_dropoff' });
  });

  it('refuses an open ride for any type other than passenger', async () => {
    commitsARide();

    await expect(
      createRide({ bookerId: 'rider-1', pickup: PICKUP, isOpen: true, rideType: 'colis' }),
    ).rejects.toMatchObject({ status: 400, code: 'open_only_passenger' });
  });

  it('refuses an open ride when the admin disabled them', async () => {
    commitsARide();
    settingsMock.mockResolvedValue(pricingSettings({ allowOpenRides: false }));

    await expect(
      createRide({ bookerId: 'rider-1', pickup: PICKUP, isOpen: true }),
    ).rejects.toMatchObject({ status: 403, code: 'open_rides_disabled' });
  });

  it('refuses a private-driver booking with an unsupported duration', async () => {
    commitsARide();

    await expect(
      createRide({
        bookerId: 'rider-1', pickup: PICKUP,
        rideType: 'private_driver', privateDriverDurationH: 5,
      }),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_duration' });
  });

  it('refuses a convoyage with no vehicle plate', async () => {
    commitsARide();

    await expect(
      createRide({
        bookerId: 'rider-1', pickup: PICKUP, dropoff: DROPOFF, rideType: 'convoyage',
      }),
    ).rejects.toMatchObject({ status: 400, code: 'convoyage_missing_plate' });
  });

  it.each([
    ['private_driver', 'privateDriverEnabled', 'private_driver_disabled'],
    ['convoyage', 'convoyageEnabled', 'convoyage_disabled'],
    ['car_rental', 'carRentalEnabled', 'car_rental_disabled'],
    ['roadside_assistance', 'roadsideAssistanceEnabled', 'roadside_assistance_disabled'],
    ['light_moving', 'lightMovingEnabled', 'light_moving_disabled'],
    ['intercity_freight', 'intercityFreightEnabled', 'intercity_freight_disabled'],
    ['equipment_rental', 'equipmentRentalEnabled', 'equipment_rental_disabled'],
  ])('refuses a %s ride when the admin turned the service off', async (rideType, flag, code) => {
    commitsARide();
    settingsMock.mockResolvedValue(pricingSettings({ [flag]: false }));

    await expect(
      createRide({
        bookerId: 'rider-1',
        pickup: PICKUP,
        dropoff: DROPOFF,
        rideType: rideType as never,
        privateDriverDurationH: 3,
        vehiclePlate: 'AA-1234',
      }),
    ).rejects.toMatchObject({ status: 403, code });
  });
});

describe('partner attribution is stamped by the server', () => {
  it('marks the ride as a restaurant ride when the booker is a restaurant partner', async () => {
    const client = commitsARide({ source: 'restaurant', origin_partner_id: 'partner-9' });
    findPartnerMock.mockResolvedValue({ id: 'partner-9', type: 'restaurant', status: 'active' });

    const ride = await createRide({ bookerId: 'rider-1', pickup: PICKUP, dropoff: DROPOFF });

    // The client never gets a say: whatever app the partner used, the commission
    // share follows the account. Losing this would silently cost a partner money.
    expect(ride.source).toBe('restaurant');
    expect(ride.originPartnerId).toBe('partner-9');
    const insert = client.calls.find((c) => /INSERT INTO rides/i.test(c.sql));
    expect(insert!.params).toContain('partner-9');
  });

  it('ignores a partner account that is not active', async () => {
    commitsARide();
    findPartnerMock.mockResolvedValue({ id: 'partner-9', type: 'restaurant', status: 'suspended' });

    const ride = await createRide({ bookerId: 'rider-1', pickup: PICKUP, dropoff: DROPOFF });

    expect(ride.source).toBe('app');
    expect(ride.originPartnerId).toBeNull();
  });
});
