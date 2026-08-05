/**
 * FEATURE 15 — Noter le chauffeur.
 *
 * Reputation is the only quality signal a marketplace with no employment
 * relationship has. The rider→captain half is covered here: the upsert, the
 * recomputed average, and every guard on who may rate what.
 *
 * The other half — a captain rating the rider — is covered by
 * 15-captain-rates-rider.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeClient, rideRow } from './_fixtures.js';

const { poolQueryMock, withTxMock } = vi.hoisted(() => ({
  poolQueryMock: vi.fn(),
  withTxMock: vi.fn(),
}));

vi.mock('../../src/db/pool.js', () => ({
  pool: { query: poolQueryMock, connect: vi.fn(), on: vi.fn() },
  withTx: withTxMock,
}));
vi.mock('../../src/modules/rides/dispatch.service.js', () => ({
  distanceMeters: vi.fn(), eligibleCaptainsForRide: vi.fn(async () => []),
}));
vi.mock('../../src/modules/push/expo-push.js', () => ({ notifyCaptainsNewRide: vi.fn() }));
vi.mock('../../src/modules/auth/sms.js', () => ({ sms: { send: vi.fn() } }));
vi.mock('../../src/modules/wallet/wallet.service.js', () => ({
  getBalance: vi.fn(async () => 500), debitWallet: vi.fn(),
}));

import { hasRated, rateCaptain } from '../../src/modules/rides/rides.service.js';

const RIDER = 'rider-1';
const CAPTAIN = 'captain-1';

function scenario(ride: Record<string, unknown> = {}, agg = { avg: '4.75', cnt: 4 }) {
  const client = fakeClient([
    [/FROM rides WHERE id = \$1 FOR UPDATE/i, () => ({
      rows: [rideRow({ booker_id: RIDER, captain_id: CAPTAIN, status: 'completed', ...ride })],
    })],
    [/COALESCE\(AVG\(stars\), 0\)/i, () => ({ rows: [agg] })],
  ]);
  withTxMock.mockImplementation(async (fn: any) => fn(client));
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
  poolQueryMock.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe('rating a captain', () => {
  it('stores the rating and returns the recomputed average', async () => {
    scenario();

    const res = await rateCaptain({ rideId: 'ride-1', riderId: RIDER, stars: 5 });

    expect(res).toMatchObject({ stars: 5, captainRatingAvg: 4.75, captainRatingCount: 4 });
  });

  it('is idempotent — re-rating updates instead of stacking', async () => {
    const client = scenario();

    await rateCaptain({ rideId: 'ride-1', riderId: RIDER, stars: 3, comment: 'trop lent' });

    // ON CONFLICT (ride_id, rater_id) DO UPDATE. Without it, a rider who taps
    // twice on a flaky connection inflates the captain's rating count and can
    // move the average with a single ride.
    const insert = client.calls.find((c) => /INSERT INTO ratings/i.test(c.sql))!;
    expect(insert.sql).toMatch(/ON CONFLICT \(ride_id, rater_id\)\s*DO UPDATE/i);
    expect(insert.params).toEqual(['ride-1', RIDER, CAPTAIN, 3, 'trop lent']);
  });

  it('recomputes the average from scratch rather than incrementing', async () => {
    const client = scenario();

    await rateCaptain({ rideId: 'ride-1', riderId: RIDER, stars: 5 });

    // A running counter drifts the moment a rating is edited (which the upsert
    // above allows). Recomputing is cheap here — a captain has at most ~1k rows.
    expect(client.didQuery(/COALESCE\(AVG\(stars\), 0\)/i)).toBe(true);
    expect(client.didQuery(/UPDATE captains SET rating_avg = \$1, rating_count = \$2/i)).toBe(true);
  });

  it('writes the rating and the captain average in one transaction', async () => {
    const client = scenario();

    await rateCaptain({ rideId: 'ride-1', riderId: RIDER, stars: 5 });

    // A rating stored without the average being updated would make the number
    // riders see permanently wrong until the next rating happens to fix it.
    const order = client.calls.map((c) =>
      /INSERT INTO ratings/i.test(c.sql) ? 'insert'
        : /AVG\(stars\)/i.test(c.sql) ? 'agg'
        : /UPDATE captains SET rating_avg/i.test(c.sql) ? 'update' : null,
    ).filter(Boolean);
    expect(order).toEqual(['insert', 'agg', 'update']);
  });

  it('stores an optional comment as null when omitted', async () => {
    const client = scenario();

    await rateCaptain({ rideId: 'ride-1', riderId: RIDER, stars: 4 });

    const insert = client.calls.find((c) => /INSERT INTO ratings/i.test(c.sql))!;
    expect(insert.params[4]).toBeNull();
  });
});

describe('who may rate what', () => {
  it('refuses a rating from someone who did not book the ride', async () => {
    scenario();

    await expect(
      rateCaptain({ rideId: 'ride-1', riderId: 'stranger', stars: 1 }),
    ).rejects.toMatchObject({ status: 403, code: 'forbidden' });
  });

  it.each(['searching', 'accepted', 'in_progress', 'cancelled_by_rider'] as const)(
    'refuses a rating on a ride that is %s',
    async (status) => {
      scenario({ status });

      // Rating before completion would let a rider punish a captain for a trip
      // that has not happened — and, worse, for one they then cancel.
      await expect(
        rateCaptain({ rideId: 'ride-1', riderId: RIDER, stars: 1 }),
      ).rejects.toMatchObject({ status: 409, code: 'wrong_status' });
    },
  );

  it('refuses a rating on a completed ride with no captain', async () => {
    scenario({ captain_id: null });

    await expect(
      rateCaptain({ rideId: 'ride-1', riderId: RIDER, stars: 5 }),
    ).rejects.toMatchObject({ status: 409, code: 'no_captain' });
  });

  it('refuses a rating on a ride that does not exist', async () => {
    const client = fakeClient([[/FOR UPDATE/i, () => ({ rows: [] })]]);
    withTxMock.mockImplementation(async (fn: any) => fn(client));

    await expect(
      rateCaptain({ rideId: 'nope', riderId: RIDER, stars: 5 }),
    ).rejects.toMatchObject({ status: 404, code: 'not_found' });
  });

  it('reports whether this rider already rated this ride', async () => {
    poolQueryMock.mockResolvedValue({ rows: [{ '?column?': 1 }], rowCount: 1 });

    expect(await hasRated('ride-1', RIDER)).toBe(true);

    poolQueryMock.mockResolvedValue({ rows: [], rowCount: 0 });
    expect(await hasRated('ride-1', RIDER)).toBe(false);
  });
});

