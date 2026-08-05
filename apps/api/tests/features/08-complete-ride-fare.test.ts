/**
 * FEATURE 8 — Terminer la course et fixer le tarif final.
 *
 * The moment money becomes real. Three fare paths converge here, and each has a
 * different trust model:
 *
 *   * fixed-fare  — the rider was quoted upfront; that quote is honoured
 *   * open/meter  — the fare is computed from the server's own GPS trail, NOT
 *                   from anything the captain's app reports
 *   * private     — hourly, with overtime measured server-side
 *
 * The invariant that matters most: a captain must never be able to inflate a
 * fare by lying to the API. These tests pin exactly that.
 *
 * Status per the audit: working.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeClient, pricingSettings, rideRow } from './_fixtures.js';

const {
  poolQueryMock, withTxMock, settingsMock, debitMock,
  computeDistanceMock, lastTrailPointMock, bonusMock, attributionMock, estimateMock,
} = vi.hoisted(() => ({
  poolQueryMock: vi.fn(),
  withTxMock: vi.fn(),
  settingsMock: vi.fn(),
  debitMock: vi.fn(),
  computeDistanceMock: vi.fn(),
  lastTrailPointMock: vi.fn(),
  bonusMock: vi.fn(),
  attributionMock: vi.fn(),
  estimateMock: vi.fn(),
}));

vi.mock('../../src/db/pool.js', () => ({
  pool: { query: poolQueryMock, connect: vi.fn(), on: vi.fn() },
  withTx: withTxMock,
}));
vi.mock('../../src/modules/admin/app-settings.service.js', () => ({
  getPricingSettings: settingsMock,
}));
vi.mock('../../src/modules/wallet/wallet.service.js', () => ({
  debitWallet: debitMock,
  getBalance: vi.fn(async () => 500),
}));
vi.mock('../../src/modules/rides/meter.service.js', () => ({
  computeDistanceM: computeDistanceMock,
  lastTrailPoint: lastTrailPointMock,
  readLiveMeter: vi.fn(),
}));
vi.mock('../../src/modules/rides/commission-bonus.service.js', () => ({
  applyBonusOnCompletion: bonusMock,
}));
vi.mock('../../src/modules/partners/attribution.service.js', () => ({
  applyPartnerAttributionOnCompletion: attributionMock,
}));
vi.mock('../../src/modules/rides/pricing.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  estimateFareMru: estimateMock,
}));
vi.mock('../../src/modules/notifications/notifications.service.js', () => ({
  notifyCaptainBonusEarned: vi.fn(),
}));
vi.mock('../../src/modules/rides/dispatch.service.js', () => ({
  distanceMeters: vi.fn(),
  eligibleCaptainsForRide: vi.fn(async () => []),
}));
vi.mock('../../src/modules/push/expo-push.js', () => ({ notifyCaptainsNewRide: vi.fn() }));
vi.mock('../../src/modules/auth/sms.js', () => ({ sms: { send: vi.fn() } }));

import { completeRide } from '../../src/modules/rides/rides.service.js';

const CAPTAIN = 'captain-1';

/** Captures the params the UPDATE … status='completed' was called with. */
function scenario(ride: Record<string, unknown> = {}) {
  const captured: { fareFinal?: number; commission?: number; distance?: number; duration?: number } = {};
  const client = fakeClient([
    [/FROM rides WHERE id = \$1 FOR UPDATE/i, () => ({
      rows: [rideRow({ captain_id: CAPTAIN, status: 'in_progress', ...ride })],
    })],
    [/FROM private_driver_details/i, () => ({
      rows: [{ booked_duration_h: 3, hourly_rate_mru: 1000 }],
    })],
    [/UPDATE rides\s+SET status = 'completed'/i, (params) => {
      captured.fareFinal = Number(params[0]);
      captured.commission = Number(params[1]);
      captured.distance = Number(params[2]);
      captured.duration = params[3] === null ? undefined : Number(params[3]);
      return {
        rows: [rideRow({
          captain_id: CAPTAIN, status: 'completed', ...ride,
          fare_final_mru: String(params[0]), commission_mru: String(params[1]),
          distance_m: params[2], duration_s: params[3],
        })],
      };
    }],
  ]);
  withTxMock.mockImplementation(async (fn: any) => fn(client));
  return { client, captured };
}

beforeEach(() => {
  vi.clearAllMocks();
  poolQueryMock.mockResolvedValue({ rows: [], rowCount: 0 });
  settingsMock.mockResolvedValue(pricingSettings());
  debitMock.mockImplementation(async (opts: any) => ({
    transactionId: 'tx-1', balanceAfter: 500 - opts.amountMru,
  }));
  // Bonus off by default: effective commission == base commission.
  bonusMock.mockImplementation(async (_c: any, _id: string, base: number) => ({
    effectiveCommissionMru: base, bonusApplied: false, bonusJustEarned: false, bonusUntil: null,
  }));
  attributionMock.mockResolvedValue(undefined);
});

describe('fixed-fare ride — the rider pays what they were quoted', () => {
  it('charges the upfront estimate when the captain reports nothing', async () => {
    const { captured } = scenario({ fare_estimate_mru: '205' });

    const res = await completeRide({ rideId: 'ride-1', captainId: CAPTAIN });

    expect(captured.fareFinal).toBe(205);
    expect(res.ride.status).toBe('completed');
  });

  it('does not recompute when the reported distance equals the stored one', async () => {
    const { captured } = scenario({ fare_estimate_mru: '205', distance_m: 4200 });

    await completeRide({ rideId: 'ride-1', captainId: CAPTAIN, actualDistanceM: 4200 });

    expect(estimateMock).not.toHaveBeenCalled();
    expect(captured.fareFinal).toBe(205);
  });

  it('recomputes from the tariff — never from a captain-supplied fare', async () => {
    const { captured } = scenario({ fare_estimate_mru: '205', distance_m: 4200 });
    estimateMock.mockResolvedValue({ fareMru: 260, distanceEstimateM: 6000 });

    await completeRide({ rideId: 'ride-1', captainId: CAPTAIN, actualDistanceM: 6000 });

    // The captain can report a DISTANCE; the price is still derived by the
    // server from its own tariff. There is no code path where a client-sent
    // amount lands in fare_final_mru.
    expect(estimateMock).toHaveBeenCalled();
    expect(captured.fareFinal).toBe(260);
  });
});

describe('open ride — the meter is the server, not the phone', () => {
  const OPEN = {
    is_open: true,
    fare_estimate_mru: null,
    started_at: new Date(Date.now() - 600_000), // 10 min ago
    open_base_fare_mru: 50,
    open_per_km_mru: 40,
    open_per_minute_mru: 5,
    open_min_fare_mru: 100,
  };

  it('sums the distance from stored GPS pings and ignores the captain report', async () => {
    const { captured } = scenario(OPEN);
    computeDistanceMock.mockResolvedValue(5000);
    lastTrailPointMock.mockResolvedValue({ lat: 18.11, lng: -15.94 });

    // The captain claims 40 km. The server measured 5 km.
    await completeRide({ rideId: 'ride-1', captainId: CAPTAIN, actualDistanceM: 40_000 });

    // This assertion is the "course honnête" promise in one line.
    expect(computeDistanceMock).toHaveBeenCalled();
    expect(captured.distance).toBe(5000);
    // 50 base + 5 km × 40 + 10 min × 5 = 300, rounded up to nearest 5.
    expect(captured.fareFinal).toBe(300);
  });

  it('takes the duration from started_at, not from the request body', async () => {
    const { captured } = scenario(OPEN);
    computeDistanceMock.mockResolvedValue(1000);
    lastTrailPointMock.mockResolvedValue(null);

    await completeRide({ rideId: 'ride-1', captainId: CAPTAIN, actualDurationS: 99_999 });

    expect(captured.duration).toBeGreaterThanOrEqual(595);
    expect(captured.duration).toBeLessThan(700);
  });

  it('enforces the minimum fare on a very short metered trip', async () => {
    const { captured } = scenario({ ...OPEN, started_at: new Date(Date.now() - 30_000) });
    computeDistanceMock.mockResolvedValue(200);
    lastTrailPointMock.mockResolvedValue(null);

    await completeRide({ rideId: 'ride-1', captainId: CAPTAIN });

    expect(captured.fareFinal).toBe(100);
  });

  it('writes the last GPS point back as the dropoff so history has a from→to', async () => {
    const { client } = scenario(OPEN);
    computeDistanceMock.mockResolvedValue(3000);
    lastTrailPointMock.mockResolvedValue({ lat: 18.11, lng: -15.94 });

    await completeRide({ rideId: 'ride-1', captainId: CAPTAIN });

    const upd = client.calls.find((c) => /UPDATE rides\s+SET status = 'completed'/i.test(c.sql))!;
    // $7 = lng, $8 = lat in the CASE-guarded dropoff write.
    expect(upd.params[6]).toBe(-15.94);
    expect(upd.params[7]).toBe(18.11);
  });

  it('refuses to complete an open ride that never started', async () => {
    scenario({ ...OPEN, started_at: null });

    await expect(completeRide({ rideId: 'ride-1', captainId: CAPTAIN })).rejects.toMatchObject({
      status: 409, code: 'not_started',
    });
  });
});

describe('private driver — hourly with server-measured overtime', () => {
  it('prices the booked duration when the captain finishes on time', async () => {
    const { captured } = scenario({
      ride_type: 'private_driver',
      started_at: new Date(Date.now() - 3 * 3600_000),
      fare_estimate_mru: '3000',
    });

    await completeRide({ rideId: 'ride-1', captainId: CAPTAIN });

    expect(captured.fareFinal).toBe(3000);
    // No route driven means no distance to bill.
    expect(captured.distance).toBe(0);
  });

  it('bills overtime beyond the booked hours', async () => {
    const { captured } = scenario({
      ride_type: 'private_driver',
      started_at: new Date(Date.now() - 5 * 3600_000), // booked 3 h, ran 5 h
    });

    await completeRide({ rideId: 'ride-1', captainId: CAPTAIN });

    expect(captured.fareFinal).toBeGreaterThan(3000);
  });
});

describe('guards on the completion itself', () => {
  it('refuses a completion from a captain who does not own the ride', async () => {
    scenario();

    await expect(completeRide({ rideId: 'ride-1', captainId: 'captain-999' })).rejects.toMatchObject({
      status: 403, code: 'forbidden',
    });
  });

  it.each(['searching', 'accepted', 'arrived', 'completed'] as const)(
    'refuses a completion from status %s',
    async (status) => {
      scenario({ status });

      await expect(completeRide({ rideId: 'ride-1', captainId: CAPTAIN })).rejects.toMatchObject({
        status: 409, code: 'wrong_status',
      });
    },
  );

  it('marks a colis delivered when the courier completes it', async () => {
    const { client } = scenario({ ride_type: 'colis' });

    await completeRide({ rideId: 'ride-1', captainId: CAPTAIN });

    expect(client.didQuery(/UPDATE colis_details SET recipient_confirmed_at/i)).toBe(true);
  });

  it('puts the captain back online, ready for the next ride', async () => {
    const { client } = scenario();

    await completeRide({ rideId: 'ride-1', captainId: CAPTAIN });

    expect(client.didQuery(/UPDATE captain_state SET presence = 'online'/i)).toBe(true);
  });

  it('never lets a partner-attribution failure undo a completed ride', async () => {
    scenario();
    attributionMock.mockRejectedValue(new Error('partner ledger unavailable'));

    // The captain's payment is committed before attribution is even attempted;
    // the earnings ledger is idempotent and can be replayed.
    const res = await completeRide({ rideId: 'ride-1', captainId: CAPTAIN });

    expect(res.ride.status).toBe('completed');
  });
});
