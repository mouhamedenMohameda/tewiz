/**
 * FEATURE 11 — annuler après avoir accepté coûte quelque chose.
 *
 * WHAT MUST HOLD
 *
 *   1. The rider is notified that their captain dropped the ride, so the screen
 *      rewinding from "un captain arrive" to "recherche en cours" has an
 *      explanation.
 *   2. The cancellation is COUNTED against the captain: a rolling count is read
 *      before the cancellation is allowed, and written after.
 *   3. Past a configurable threshold within a window, the captain faces a
 *      consequence — a fee, or being taken offline. Which one is a product
 *      decision; that one exists is not.
 *   4. The ride keeps a trace of why it went back to searching, so support can
 *      reconstruct it from the ride alone.
 *
 * The re-broadcast behaviour that already works is NOT re-specified here — it
 * is covered by tests/features/11-captain-cancel.test.ts, which must stay green
 * while you implement this.
 *
 * WHY
 *
 * Today cancelling is free. `captain_cancel_events` IS written, but its only
 * reader is the GPS-fraud evaluator — nothing scores the cancellation itself.
 * So "accept to reserve the ride, read the destination, cancel if it does not
 * suit me" is a strictly dominant strategy for a captain, and the cost lands
 * entirely on a rider who is not even told.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { capturePush, expectPushedTo, flush, type PushCapture } from './_harness.js';

const { poolQueryMock, withTxMock } = vi.hoisted(() => ({
  poolQueryMock: vi.fn(),
  withTxMock: vi.fn(),
}));

vi.mock('../../src/db/pool.js', () => ({
  pool: { query: poolQueryMock, connect: vi.fn(), on: vi.fn() },
  withTx: withTxMock,
}));
vi.mock('../../src/modules/rides/dispatch.service.js', () => ({
  eligibleCaptainsForRide: vi.fn(async () => ['captain-2']),
  distanceMeters: vi.fn(),
}));
vi.mock('../../src/modules/auth/sms.js', () => ({ sms: { send: vi.fn() } }));
vi.mock('../../src/modules/wallet/wallet.service.js', () => ({
  getBalance: vi.fn(async () => 500),
  debitWallet: vi.fn(async () => ({ transactionId: 'tx', balanceAfter: 400 })),
}));

import { cancelRide } from '../../src/modules/rides/rides.service.js';
import { rideRow } from './_fixtures.js';

const RIDER = 'rider-1';
const CAPTAIN = 'captain-1';
const RIDER_TOKEN = 'ExponentPushToken[rider-phone]';

let push: PushCapture;

/** Every statement the cancellation issues, on the tx client and on the pool. */
let issued: { sql: string; params: any[] }[] = [];

/** `priorCancellations` drives the "repeat offender" scenarios. */
function scenario(opts: { priorCancellations?: number } = {}) {
  issued = [];
  const record = (sql: unknown, params: any[] = []) => {
    issued.push({ sql: String(sql), params });
  };

  let lastUpdateParams: any[] = [];

  const answer = (sql: unknown) => {
    const text = String(sql);
    if (/FROM rides WHERE id = \$1 FOR UPDATE/i.test(text)) {
      return {
        rows: [rideRow({ booker_id: RIDER, captain_id: CAPTAIN, status: 'accepted' })],
        rowCount: 1,
      };
    }
    if (/UPDATE rides\s+SET captain_id   = NULL/i.test(text)) {
      // Simulate RETURNING: echo back whatever the UPDATE wrote, the way
      // Postgres would, so the trace assertion reads real output.
      return {
        rows: [rideRow({
          booker_id: RIDER, captain_id: null, status: 'searching',
          last_captain_cancel_reason: lastUpdateParams[1] ?? null,
          last_captain_cancel_at: new Date(),
        })],
        rowCount: 1,
      };
    }
    // Any COUNT over the captain cancellation history answers with the
    // configured number of prior offences.
    if (/COUNT/i.test(text) && /captain_cancel_events/i.test(text)) {
      const n = opts.priorCancellations ?? 0;
      return { rows: [{ count: String(n), n: String(n) }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  };

  const client = {
    query: vi.fn(async (sql: unknown, params: any[] = []) => {
      record(sql, params);
      if (/UPDATE rides\s+SET captain_id   = NULL/i.test(String(sql))) lastUpdateParams = params;
      return answer(sql);
    }),
  };
  withTxMock.mockImplementation(async (fn: any) => fn(client));
  return client;
}

const didQuery = (re: RegExp) => issued.some((c) => re.test(c.sql));

beforeEach(() => {
  vi.clearAllMocks();
  push = capturePush();
  poolQueryMock.mockImplementation(async (sql: unknown, params: any[] = []) => {
    issued.push({ sql: String(sql), params });
    if (/FROM push_tokens/i.test(String(sql))) {
      const ids: string[] = Array.isArray(params[0]) ? params[0] : [params[0]];
      return ids.includes(RIDER)
        ? { rows: [{ token: RIDER_TOKEN, platform: 'android' }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    if (/COUNT/i.test(String(sql)) && /captain_cancel_events/i.test(String(sql))) {
      return { rows: [{ count: '0', n: '0' }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
});

describe('the rider is told their captain dropped the ride', () => {
  it('pushes to the booker', async () => {
    scenario();

    await cancelRide({ rideId: 'ride-1', userId: CAPTAIN, role: 'captain', reason: 'panne' });
    await flush();

    expectPushedTo(
      push, RIDER_TOKEN,
      'The rider screen silently rewinds to "recherche en cours" with no explanation.',
    );
  });

  it('explains that the search has restarted rather than that the ride died', async () => {
    scenario();

    await cancelRide({ rideId: 'ride-1', userId: CAPTAIN, role: 'captain', reason: 'panne' });
    await flush();

    const toRider = push.messages().filter((m) =>
      (Array.isArray(m.to) ? m.to : [m.to]).includes(RIDER_TOKEN));
    expect(toRider.length, 'No message addressed to the rider').toBeGreaterThan(0);

    // The trip is NOT cancelled — it is being re-offered. Telling the rider
    // "course annulée" would make them rebook and double the load.
    const text = `${toRider[0]!.title ?? ''} ${toRider[0]!.body ?? ''}`.toLowerCase();
    expect(
      text,
      'Tell the rider the search restarted, not that their ride was cancelled.',
    ).toMatch(/recherch|nouveau captain|autre captain/);
  });
});

describe('the cancellation is scored against the captain', () => {
  it('reads the captain recent cancellation history', async () => {
    scenario();

    await cancelRide({ rideId: 'ride-1', userId: CAPTAIN, role: 'captain', reason: 'panne' });

    expect(
      didQuery(/COUNT[\s\S]*captain_cancel_events/i) || didQuery(/cancel_rate|cancellation_count/i),
      'Nothing counts how often this captain cancels. The tenth cancellation of the day takes the same path as the first.',
    ).toBe(true);
  });

  it('applies a consequence once the threshold is crossed', async () => {
    scenario({ priorCancellations: 10 });

    await cancelRide({ rideId: 'ride-1', userId: CAPTAIN, role: 'captain', reason: 'panne' });

    // Which consequence is your call — a fee debited from the wallet, or being
    // forced offline for a cooldown. This asserts that ONE of them happens.
    const feeCharged = didQuery(/INSERT INTO wallet_transactions/i);
    // The presence value may be a literal or a bound parameter — parameterising
    // it is the correct practice, so check both rather than forcing an inline
    // string into the SQL just to satisfy a regex.
    const forcedOffline = issued.some(
      (c) => /UPDATE captain_state/i.test(c.sql)
        && (/offline/i.test(c.sql) || c.params.some((p) => p === 'offline')),
    );
    const suspended = didQuery(/UPDATE captains[\s\S]*(status|suspended)/i);

    expect(
      feeCharged || forcedOffline || suspended,
      'A captain on their 11th cancellation faces no consequence: no fee, no cooldown, no suspension.',
    ).toBe(true);
  });

  it('leaves an occasional cancellation unpunished', async () => {
    scenario({ priorCancellations: 0 });

    await cancelRide({ rideId: 'ride-1', userId: CAPTAIN, role: 'captain', reason: 'panne' });

    // A captain with a genuine breakdown must not be fined. The policy has to
    // distinguish a pattern from an incident, or it will drive good drivers off
    // the platform faster than it deters the bad ones.
    expect(didQuery(/INSERT INTO wallet_transactions/i)).toBe(false);
  });
});

describe('the ride keeps a trace of what happened', () => {
  it('records why it went back to searching', async () => {
    scenario();

    const ride = await cancelRide({
      rideId: 'ride-1', userId: CAPTAIN, role: 'captain', reason: 'panne',
    });

    // Today the row is reset clean: captain_id, accepted_at and arrived_at are
    // nulled and nothing is written in their place, so support looking at the
    // ride cannot tell a captain cancellation from a ride nobody ever took.
    const trace =
      (ride as any).lastCancelReason
      ?? (ride as any).previousCaptainCancelReason
      ?? (ride as any).cancelHistory;

    expect(
      trace,
      'The ride carries no trace of the captain cancellation — support cannot reconstruct it from the ride alone.',
    ).toBeTruthy();
  });
});
