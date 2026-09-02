/**
 * FEATURE 3 — Accepter une course (premier arrivé, premier servi).
 *
 * The single most safety-critical write in the product. Every online captain
 * within the radius sees the same ride, and they tap at the same time. If two
 * of them can both win, two cars drive to one passenger, two wallets get
 * debited, and the marketplace loses the trust it takes months to build.
 *
 * The guarantee is `SELECT … FOR UPDATE` inside a transaction: the loser reads
 * the ride only after the winner committed, sees a status that is no longer
 * 'searching', and is refused. These tests pin the lock, the ordering, and each
 * eligibility gate that runs while it is held.
 *
 * Status per the audit: solid.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeClient, rideRow, type FakeClient } from './_fixtures.js';

const { poolQueryMock, withTxMock, getBalanceMock, smsSendMock } = vi.hoisted(() => ({
  poolQueryMock: vi.fn(),
  withTxMock: vi.fn(),
  getBalanceMock: vi.fn(),
  smsSendMock: vi.fn(),
}));

vi.mock('../../src/db/pool.js', () => ({
  pool: { query: poolQueryMock, connect: vi.fn(), on: vi.fn() },
  withTx: withTxMock,
}));
// Abonnement Captain (migration 0089) : un abonné saute le contrôle de solde.
// Ces suites portent sur le contrôle lui-même, donc on part d'un Captain non
// abonné — le comportement de l'abonnement a ses propres tests.
vi.mock('../../src/modules/captain/subscription.service.js', () => ({
  isSubscriptionActive: vi.fn().mockResolvedValue(false),
}));
vi.mock('../../src/modules/wallet/wallet.service.js', () => ({
  getBalance: getBalanceMock,
  debitWallet: vi.fn(),
}));
vi.mock('../../src/modules/auth/sms.js', () => ({ sms: { send: smsSendMock } }));
vi.mock('../../src/modules/rides/dispatch.service.js', () => ({
  distanceMeters: vi.fn(),
  eligibleCaptainsForRide: vi.fn(async () => []),
}));
vi.mock('../../src/modules/push/expo-push.js', () => ({ notifyCaptainsNewRide: vi.fn() }));

import { acceptRide } from '../../src/modules/rides/rides.service.js';

const CAPTAIN = 'captain-1';

interface Scenario {
  ride?: Record<string, unknown>;
  /** Rides currently held by this captain — drives the "already busy" gate. */
  busy?: boolean;
  captain?: { accepts_colis: boolean; vehicle_type: 'car' | 'moto' } | null;
}

function scenario(s: Scenario = {}): FakeClient {
  const ride = rideRow(s.ride);
  const client = fakeClient([
    [/FROM rides WHERE id = \$1 FOR UPDATE/i, () => ({ rows: [ride] })],
    [/FROM rides\s+WHERE captain_id = \$1/i, () => ({ rows: s.busy ? [{ '?column?': 1 }] : [] })],
    [/SELECT accepts_colis, vehicle_type FROM captains/i, () => ({
      rows: s.captain === null ? [] : [s.captain ?? { accepts_colis: false, vehicle_type: 'car' }],
    })],
    [/UPDATE rides\s+SET captain_id/i, () => ({
      rows: [rideRow({ ...s.ride, captain_id: CAPTAIN, status: 'accepted', accepted_at: new Date() })],
    })],
    [/FROM colis_details/i, () => ({
      rows: [{ recipient_phone: '+22245000000', recipient_name: 'Fatimetou' }],
    })],
  ]);
  withTxMock.mockImplementation(async (fn: any) => fn(client));
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
  poolQueryMock.mockResolvedValue({ rows: [], rowCount: 0 });
  getBalanceMock.mockResolvedValue(500);
});

describe('the winner', () => {
  it('takes the ride and is marked on_ride', async () => {
    const client = scenario();

    const ride = await acceptRide('ride-1', CAPTAIN);

    expect(ride.status).toBe('accepted');
    expect(ride.captainId).toBe(CAPTAIN);
    expect(client.didQuery(/UPDATE captain_state SET presence = 'on_ride'/i)).toBe(true);
  });

  it('reads the ride under a row lock before deciding anything', async () => {
    const client = scenario();

    await acceptRide('ride-1', CAPTAIN);

    // Without FOR UPDATE the two concurrent transactions would both read
    // 'searching' and both write. This assertion IS the concurrency guarantee.
    const first = client.calls[0]!;
    expect(first.sql).toMatch(/FROM rides WHERE id = \$1 FOR UPDATE/i);
    expect(first.params).toEqual(['ride-1']);
  });

  it('records the acceptance in the same transaction as the assignment', async () => {
    const client = scenario();

    await acceptRide('ride-1', CAPTAIN);

    // Committed atomically with the ride: a ride with a captain_id always has a
    // matching ride_acceptances row, so the operator view can never disagree
    // with the ride table about who took it.
    expect(client.didQuery(/INSERT INTO ride_acceptances/i)).toBe(true);
  });
});

describe('the loser of the race', () => {
  it.each(['accepted', 'in_progress', 'completed', 'cancelled_by_rider'] as const)(
    'is refused with 409 when the ride is already %s',
    async (status) => {
      scenario({ ride: { status } });

      await expect(acceptRide('ride-1', 'captain-2')).rejects.toMatchObject({
        status: 409,
        code: 'not_searching',
      });
    },
  );

  it('never writes the assignment when it lost', async () => {
    const client = scenario({ ride: { status: 'accepted', captain_id: 'captain-1' } });

    await acceptRide('ride-1', 'captain-2').catch(() => {});

    expect(client.didQuery(/UPDATE rides\s+SET captain_id/i)).toBe(false);
  });

  it('still logs its interest so the operator sees everyone who wanted the ride', async () => {
    scenario({ ride: { status: 'accepted', captain_id: 'captain-1' } });

    await acceptRide('ride-1', 'captain-2').catch(() => {});

    // Recorded on a fresh connection, outside the rolled-back transaction.
    const insert = poolQueryMock.mock.calls.find(
      ([sql]) => /INSERT INTO ride_acceptances/i.test(String(sql)),
    );
    expect(insert).toBeDefined();
    expect(insert![1]).toEqual(['ride-1', 'captain-2']);
  });

  it('surfaces the 409 even if logging the late tap fails', async () => {
    scenario({ ride: { status: 'accepted' } });
    poolQueryMock.mockRejectedValue(new Error('connection reset'));

    // The bookkeeping is best-effort; the captain must still be told the truth.
    await expect(acceptRide('ride-1', 'captain-2')).rejects.toMatchObject({
      code: 'not_searching',
    });
  });
});

describe('eligibility gates held under the lock', () => {
  it('refuses a captain whose wallet is below the working minimum', async () => {
    scenario();
    getBalanceMock.mockResolvedValue(-40);

    const err = await acceptRide('ride-1', CAPTAIN).catch((e) => e);

    expect(err).toMatchObject({ status: 402, code: 'balance_too_low' });
    // The captain needs to know how far off they are to fix it.
    expect(err.details).toMatchObject({ balance: -40 });
  });

  it('lets a captain keep working slightly in the red — the soft float', async () => {
    scenario();
    getBalanceMock.mockResolvedValue(-5);

    // Deliberate: cutting a captain off the instant they hit zero would strand
    // them mid-shift with no way to top up. env.MIN_BALANCE_TO_GO_ONLINE_MRU
    // is the floor, and its DEFAULT IS -10 MRU.
    //
    // Note for whoever reads this next: docs/features.md still claims captains
    // are "blocked from going online below 20 MRU". That is not what the code
    // does, and .env sets NEGATIVE_BALANCE_FLOOR_KHOUMS — a variable no longer
    // read by anything, since migration 0017 removed the khoums unit. Fix the
    // doc and the env key, not this test.
    const ride = await acceptRide('ride-1', CAPTAIN);

    expect(ride.captainId).toBe(CAPTAIN);
  });

  it('refuses a captain who already has an active ride', async () => {
    scenario({ busy: true });

    await expect(acceptRide('ride-1', CAPTAIN)).rejects.toMatchObject({
      status: 409,
      code: 'captain_busy',
    });
  });

  it('refuses a moto on a passenger ride', async () => {
    scenario({ captain: { accepts_colis: true, vehicle_type: 'moto' } });

    await expect(acceptRide('ride-1', CAPTAIN)).rejects.toMatchObject({
      status: 403,
      code: 'passenger_not_allowed',
    });
  });

  it('refuses a car on a colis ride when the captain has not opted in', async () => {
    scenario({
      ride: { ride_type: 'colis' },
      captain: { accepts_colis: false, vehicle_type: 'car' },
    });

    await expect(acceptRide('ride-1', CAPTAIN)).rejects.toMatchObject({
      status: 403,
      code: 'colis_not_allowed',
    });
  });

  it('lets a moto take a colis', async () => {
    scenario({
      ride: { ride_type: 'colis' },
      captain: { accepts_colis: false, vehicle_type: 'moto' },
    });

    const ride = await acceptRide('ride-1', CAPTAIN);

    expect(ride.captainId).toBe(CAPTAIN);
  });

  it('refuses an account that is not a captain at all', async () => {
    scenario({ captain: null });

    await expect(acceptRide('ride-1', CAPTAIN)).rejects.toMatchObject({
      status: 404,
      code: 'not_captain',
    });
  });
});
