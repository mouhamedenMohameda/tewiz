/**
 * FEATURE 15 — la réputation circule dans les deux sens.
 *
 * WHAT MUST HOLD
 *
 *   1. A service function lets a captain rate the booker of a completed ride —
 *      `rateRider({ rideId, captainId, stars, comment? })` or equivalent.
 *   2. It writes to the existing `ratings` table with the roles reversed
 *      (rater = captain, ratee = rider). No new table is needed: `ratings` is
 *      already generic over (rater_id, ratee_id).
 *   3. A rider aggregate is maintained, so the `avgRating` that ride-insights
 *      already SHOWS a captain stops being permanently null.
 *   4. The same guards as the rider→captain path: completed rides only, the
 *      ride's own captain only, idempotent on re-submission.
 *
 * WHY
 *
 * `ride_insights.service.ts` already surfaces a rider's no-show count,
 * cancellation count and an `avgRating` field to the captain deciding whether
 * to accept. That field can only ever be null, because nothing writes a rider
 * rating anywhere in the codebase. The UI promises a signal the backend cannot
 * produce.
 *
 * NOTE ON THE FIRST FAILURE
 *
 * The module is imported dynamically and the export asserted before use, so the
 * red output reads `expected undefined to be function` rather than an
 * unreadable module-load crash.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { rideRow } from './_fixtures.js';

const RIDER = 'rider-1';
const CAPTAIN = 'captain-1';

let issued: { sql: string; params: any[] }[] = [];

function scenario(ride: Record<string, unknown> = {}) {
  issued = [];
  const client = {
    query: vi.fn(async (sql: unknown, params: any[] = []) => {
      issued.push({ sql: String(sql), params });
      const text = String(sql);
      if (/FROM rides WHERE id = \$1 FOR UPDATE/i.test(text)) {
        return {
          rows: [rideRow({ booker_id: RIDER, captain_id: CAPTAIN, status: 'completed', ...ride })],
          rowCount: 1,
        };
      }
      if (/AVG\(stars\)/i.test(text)) {
        return { rows: [{ avg: '4.50', cnt: 2 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }),
  };
  withTxMock.mockImplementation(async (fn: any) => fn(client));
  return client;
}

/** Resolves the rating entry point, whatever it ends up being called. */
async function loadRateRider(): Promise<(input: any) => Promise<any>> {
  const svc: Record<string, unknown> = await import('../../src/modules/rides/rides.service.js');
  const fn = svc.rateRider ?? svc.rateBooker ?? svc.ratePassenger;
  expect(
    typeof fn,
    'No captain→rider rating function exists (looked for rateRider / rateBooker / ratePassenger in rides.service).',
  ).toBe('function');
  return fn as (input: any) => Promise<any>;
}

const didQuery = (re: RegExp) => issued.some((c) => re.test(c.sql));

beforeEach(() => {
  vi.clearAllMocks();
  poolQueryMock.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe('a captain can rate the rider', () => {
  it('exposes a rating entry point', async () => {
    await loadRateRider();
  });

  it('stores the rating with the roles reversed', async () => {
    const rateRider = await loadRateRider();
    scenario();

    await rateRider({ rideId: 'ride-1', captainId: CAPTAIN, stars: 2 });

    const insert = issued.find((c) => /INSERT INTO ratings/i.test(c.sql));
    expect(insert, 'Nothing was written to ratings').toBeDefined();
    // rater = captain, ratee = rider. The table is already generic over both.
    expect(insert!.params).toContain(CAPTAIN);
    expect(insert!.params).toContain(RIDER);
  });

  it('maintains a rider aggregate', async () => {
    const rateRider = await loadRateRider();
    scenario();

    await rateRider({ rideId: 'ride-1', captainId: CAPTAIN, stars: 2 });

    // Without an aggregate, the avgRating that ride-insights shows the captain
    // deciding whether to accept stays null forever.
    expect(
      didQuery(/UPDATE users[\s\S]*rating/i) || didQuery(/rider_ratings|UPDATE riders/i),
      'No rider aggregate is maintained — ride_insights.rider.avgRating can never be non-null.',
    ).toBe(true);
  });

  it('is idempotent on re-submission', async () => {
    const rateRider = await loadRateRider();
    scenario();

    await rateRider({ rideId: 'ride-1', captainId: CAPTAIN, stars: 2 });

    const insert = issued.find((c) => /INSERT INTO ratings/i.test(c.sql))!;
    expect(
      insert.sql,
      'A double tap on a flaky connection must update, not stack a second rating.',
    ).toMatch(/ON CONFLICT[\s\S]*DO UPDATE/i);
  });
});

describe('the same guards as the rider→captain path', () => {
  it('refuses a rating from a captain who did not drive the ride', async () => {
    const rateRider = await loadRateRider();
    scenario();

    await expect(
      rateRider({ rideId: 'ride-1', captainId: 'captain-999', stars: 1 }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it.each(['searching', 'accepted', 'in_progress', 'cancelled_by_rider'])(
    'refuses a rating on a ride that is %s',
    async (status) => {
      const rateRider = await loadRateRider();
      scenario({ status });

      await expect(
        rateRider({ rideId: 'ride-1', captainId: CAPTAIN, stars: 1 }),
      ).rejects.toMatchObject({ status: 409 });
    },
  );
});
