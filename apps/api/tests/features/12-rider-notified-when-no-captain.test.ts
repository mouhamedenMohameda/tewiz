/**
 * FEATURE 12 — dire au rider que personne n'est venu.
 *
 * WHAT MUST HOLD
 *
 *   1. `expireSearchingRides()` returns the bookers it just cancelled — the
 *      UPDATE needs `RETURNING booker_id, id`. Today it is a blind UPDATE with
 *      no RETURNING, so there is no list of people to tell. That is the first
 *      thing to change, and it is why this is not a one-line fix.
 *   2. Each affected booker receives a push saying no captain was found.
 *   3. The push carries the ride id so the app can offer a one-tap retry —
 *      the failure is the moment you are most likely to lose the user, and the
 *      cheapest moment to win them back.
 *   4. A tick that expires nothing sends nothing.
 *
 * WHY
 *
 * "J'ai demandé, personne n'est venu" is the most demoralising failure a
 * marketplace has. Today the ride is flipped to cancelled_by_system
 * server-side while the rider's screen keeps showing "recherche en cours"
 * until they give up on their own. They never learn the system gave up first.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { capturePush, expectPushedTo, flush, type PushCapture } from './_harness.js';
import { pricingSettings } from './_fixtures.js';

const { poolQueryMock, settingsMock } = vi.hoisted(() => ({
  poolQueryMock: vi.fn(),
  settingsMock: vi.fn(),
}));

vi.mock('../../src/db/pool.js', () => ({
  pool: { query: poolQueryMock },
  withTx: vi.fn(),
}));
vi.mock('../../src/modules/admin/app-settings.service.js', () => ({
  getPricingSettings: settingsMock,
}));

import { expireSearchingRides } from '../../src/modules/rides/expiry.service.js';

const EXPIRED = [
  { id: 'ride-1', booker_id: 'rider-1' },
  { id: 'ride-2', booker_id: 'rider-2' },
];
const TOKENS: Record<string, string> = {
  'rider-1': 'ExponentPushToken[rider-1]',
  'rider-2': 'ExponentPushToken[rider-2]',
};

let push: PushCapture;

function db(expired = EXPIRED) {
  poolQueryMock.mockImplementation(async (sql: unknown, params: any[] = []) => {
    const text = String(sql);
    if (/UPDATE rides/i.test(text)) {
      // Answer as Postgres would once RETURNING is added; harmless if it is not.
      return { rows: expired, rowCount: expired.length };
    }
    if (/FROM push_tokens/i.test(text)) {
      const ids: string[] = Array.isArray(params[0]) ? params[0] : [params[0]];
      const rows = ids.filter((id) => TOKENS[id]).map((id) => ({
        token: TOKENS[id]!, platform: 'android',
      }));
      return { rows, rowCount: rows.length };
    }
    return { rows: [], rowCount: 0 };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  push = capturePush();
  settingsMock.mockResolvedValue(pricingSettings({ searchingTimeoutS: 300 }));
  db();
});

describe('the expiry job can identify who it just disappointed', () => {
  it('returns the expired rides from the UPDATE', async () => {
    await expireSearchingRides();

    const [sql] = poolQueryMock.mock.calls[0]!;
    expect(
      String(sql),
      'The UPDATE has no RETURNING, so the job has no list of bookers to notify. Add `RETURNING id, booker_id` first.',
    ).toMatch(/RETURNING/i);
  });

  it('reports the bookers to its caller', async () => {
    const result = await expireSearchingRides();

    // Return the affected rides (or at least their bookers) rather than a bare
    // count, so the notification is testable and can be moved out of the job.
    const bookers = Array.isArray(result)
      ? (result as any[]).map((r) => r.bookerId ?? r.booker_id)
      : (result as any)?.bookers;

    expect(
      bookers,
      'expireSearchingRides() returns only a count — nothing downstream can tell who to notify.',
    ).toEqual(expect.arrayContaining(['rider-1', 'rider-2']));
  });
});

describe('each affected rider is told', () => {
  it('pushes to every booker whose ride expired', async () => {
    await expireSearchingRides();
    await flush();

    expectPushedTo(push, TOKENS['rider-1']!, 'Their ride was cancelled server-side and they were not told.');
    expectPushedTo(push, TOKENS['rider-2']!, 'Their ride was cancelled server-side and they were not told.');
  });

  it('says no captain was found', async () => {
    await expireSearchingRides();
    await flush();

    const msg = push.messages()[0];
    expect(msg, 'No notification was sent at all').toBeDefined();
    const text = `${msg.title ?? ''} ${msg.body ?? ''}`.toLowerCase();
    // The reason is already stored as cancel_reason='no_captain_accepted'; it
    // reaches the admin dashboard and stops there.
    expect(
      text,
      'Tell the rider no captain was available — not just that "something happened".',
    ).toMatch(/captain|chauffeur|disponible|trouvé/);
  });

  it('carries the ride id so the app can offer a retry', async () => {
    await expireSearchingRides();
    await flush();

    const msg = push.messages()[0];
    expect(msg, 'No notification was sent at all').toBeDefined();
    expect(
      msg.data,
      'Without the ride id the app cannot pre-fill a retry, which is the whole point of telling them.',
    ).toMatchObject({ rideId: expect.any(String) });
  });

  it('sends nothing when the tick expired nothing', async () => {
    db([]);

    await expireSearchingRides();
    await flush();

    expect(push.messages()).toEqual([]);
  });

  it('still cancels the rides when the push fails', async () => {
    push.fetchMock.mockRejectedValue(new Error('exp.host unreachable'));

    // The cleanup must not depend on Expo being up.
    const result = await expireSearchingRides();
    await flush();

    const count = typeof result === 'number' ? result : (result as any[]).length;
    expect(count).toBe(2);
  });
});
