/**
 * FEATURE 18 — plafonner les courses actives par compte.
 *
 * WHAT MUST HOLD
 *
 *   1. A booker with N rides already in ('searching','accepted','arrived',
 *      'in_progress') is refused when N reaches a cap, with a distinct error
 *      code the app can render ("vous avez déjà X courses en cours").
 *   2. The cap is read from app_settings, not hardcoded — a hotel or a
 *      restaurant partner legitimately books several cars at once, and you will
 *      want to tune this without a deploy.
 *   3. Partner accounts get their own, higher allowance. The limit must not
 *      break the business case that caused it to be removed in the first place.
 *   4. Completed and cancelled rides never count towards it.
 *   5. `skipBookerActiveCheck` is deleted from CreateRideInput. It is a dead
 *      flag today; leaving it would let a caller opt out of the new limit.
 *
 * WHY
 *
 * The limit existed and was removed on purpose — the flag survives as a comment
 * saying so. The product reason was sound; the consequence was never replaced.
 * Every ride created broadcasts to every eligible captain in the radius, so one
 * account in a loop floods the inbox and the push channel of every captain in
 * the city, on the same channel that carries real work. /rider sits outside the
 * only rate limiter in the app, which is scoped to /auth.
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
  distanceMeters: distanceMock, eligibleCaptainsForRide: eligibleMock,
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

const PICKUP = { lat: 18.08, lng: -15.97 };
const DROPOFF = { lat: 18.1, lng: -15.95 };
const BOOKER = 'rider-1';

/** How many rides the booker already has open, from the DB's point of view. */
function withActiveRides(n: number) {
  poolQueryMock.mockImplementation(async (sql: unknown) => {
    const text = String(sql);
    if (/FROM rides/i.test(text) && /booker_id/i.test(text)) {
      // Answer both shapes an implementation might use: a COUNT, or the rows.
      return {
        rows: n > 0
          ? [{ count: String(n), n: String(n) },
             ...Array.from({ length: n - 1 }, (_, i) => ({ id: `open-${i}` }))]
          : [{ count: '0', n: '0' }],
        rowCount: Math.max(n, 1),
      };
    }
    return { rows: [], rowCount: 0 };
  });
  const client = fakeClient([
    [/INSERT INTO rides/i, () => ({ rows: [rideRow({ booker_id: BOOKER })] })],
    [/FROM rides/i, () => ({ rows: [{ count: String(n), n: String(n) }] })],
  ]);
  withTxMock.mockImplementation(async (fn: any) => fn(client));
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
  settingsMock.mockResolvedValue(pricingSettings({ maxActiveRidesPerBooker: 3 }));
  findPartnerMock.mockResolvedValue(null);
  distanceMock.mockResolvedValue(4000);
  estimateMock.mockResolvedValue({
    fareMru: 205, distanceEstimateM: 5200, pricingModeApplied: 'solo',
    sharedSeatsApplied: null, soloFareMru: 205, isIntercityPricing: false,
  });
  eligibleMock.mockResolvedValue(['captain-1']);
});

describe('a booker cannot hold unlimited open rides', () => {
  it('counts the booker existing active rides before creating another', async () => {
    withActiveRides(0);

    await createRide({ bookerId: BOOKER, pickup: PICKUP, dropoff: DROPOFF });

    const counted = poolQueryMock.mock.calls.some(([sql]) => {
      const s = String(sql);
      return /FROM rides/i.test(s) && /booker_id/i.test(s) && /(COUNT|status IN)/i.test(s);
    });
    expect(
      counted,
      'Nothing counts the booker open rides — the question is never asked.',
    ).toBe(true);
  });

  it('refuses the ride once the cap is reached', async () => {
    withActiveRides(3);

    await expect(
      createRide({ bookerId: BOOKER, pickup: PICKUP, dropoff: DROPOFF }),
    ).rejects.toMatchObject({ status: 429 });
  });

  it('uses a distinct error code the app can render', async () => {
    withActiveRides(3);

    const err = await createRide({ bookerId: BOOKER, pickup: PICKUP, dropoff: DROPOFF })
      .catch((e) => e);

    // A generic 400 would surface as "Erreur" in the app. The rider needs to
    // know they already have rides open, and how many.
    expect(
      err?.code,
      'The refusal needs its own code so the app can explain it.',
    ).toMatch(/active_ride|too_many_rides|ride_limit/i);
  });

  it('creates nothing and broadcasts nothing when refused', async () => {
    const client = withActiveRides(3);

    await createRide({ bookerId: BOOKER, pickup: PICKUP, dropoff: DROPOFF }).catch(() => {});

    expect(client.didQuery(/INSERT INTO rides/i)).toBe(false);
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('still allows a ride below the cap', async () => {
    withActiveRides(1);

    const ride = await createRide({ bookerId: BOOKER, pickup: PICKUP, dropoff: DROPOFF });

    expect(ride.status).toBe('searching');
  });
});

describe('the cap is configurable, and partners get room to work', () => {
  it('reads the cap from app settings rather than a constant', async () => {
    settingsMock.mockResolvedValue(pricingSettings({ maxActiveRidesPerBooker: 1 }));
    withActiveRides(1);

    // With the cap lowered to 1, a booker holding 1 ride must now be refused.
    await expect(
      createRide({ bookerId: BOOKER, pickup: PICKUP, dropoff: DROPOFF }),
    ).rejects.toMatchObject({ status: 429 });
  });

  it('gives an active partner a higher allowance', async () => {
    settingsMock.mockResolvedValue(pricingSettings({
      maxActiveRidesPerBooker: 3,
      maxActiveRidesPerPartner: 20,
    }));
    findPartnerMock.mockResolvedValue({ id: 'partner-9', type: 'restaurant', status: 'active' });
    withActiveRides(5);

    // A restaurant dispatching five deliveries at once is the exact case that
    // caused the original limit to be removed. Do not reintroduce that problem.
    const ride = await createRide({ bookerId: BOOKER, pickup: PICKUP, dropoff: DROPOFF });

    expect(ride.status).toBe('searching');
  });
});

describe('the dead opt-out flag is gone', () => {
  it('no longer accepts skipBookerActiveCheck', async () => {
    const { CreateRideInput } = await import('../../src/modules/rides/rides.service.js') as any;
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(
        new URL('../../src/modules/rides/rides.service.ts', import.meta.url),
        'utf8',
      ));

    void CreateRideInput;
    // A caller passing it today gets silence. Once a real limit exists, a
    // lingering "skip the check" flag is a way to bypass it by accident.
    expect(
      src,
      'skipBookerActiveCheck is still in CreateRideInput — delete it, it can only be used to bypass the new limit.',
    ).not.toMatch(/skipBookerActiveCheck/);
  });
});
