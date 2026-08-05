/**
 * FEATURE 4 — le rider apprend qu'un captain a accepté.
 *
 * WHAT MUST HOLD
 *
 * When a captain accepts a ride, the booker receives a push notification on
 * every device they have registered, such that:
 *
 *   1. it reaches a phone that is locked and has the app backgrounded;
 *   2. its `data` payload identifies the ride, so tapping it opens the
 *      tracking screen directly rather than the home grid;
 *   3. it names the captain, because "un captain arrive" is far less
 *      reassuring than "Sidi arrive dans une Toyota blanche";
 *   4. it is NOT sent to the captain who accepted, and not to other captains.
 *
 * WHY THIS IS THE HIGHEST-VALUE ITEM ON THE LIST
 *
 * The infrastructure is entirely built — push_tokens, sendPush, the Android
 * channel, the iOS entitlement. What is missing is the call. Meanwhile the only
 * way a rider learns a car is coming is the 5 s poll on the tracking screen,
 * which `useFocusEffect` stops the moment the screen loses focus. A rider who
 * books and pockets their phone learns nothing at all.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { capturePush, expectPushedTo, flush, type PushCapture } from './_harness.js';

const { poolQueryMock, withTxMock, getBalanceMock } = vi.hoisted(() => ({
  poolQueryMock: vi.fn(),
  withTxMock: vi.fn(),
  getBalanceMock: vi.fn(),
}));

vi.mock('../../src/db/pool.js', () => ({
  pool: { query: poolQueryMock, connect: vi.fn(), on: vi.fn() },
  withTx: withTxMock,
}));
vi.mock('../../src/modules/wallet/wallet.service.js', () => ({
  getBalance: getBalanceMock,
  debitWallet: vi.fn(),
}));
vi.mock('../../src/modules/auth/sms.js', () => ({ sms: { send: vi.fn() } }));
vi.mock('../../src/modules/rides/dispatch.service.js', () => ({
  distanceMeters: vi.fn(),
  eligibleCaptainsForRide: vi.fn(async () => []),
}));

import { acceptRide } from '../../src/modules/rides/rides.service.js';
import { rideRow } from './_fixtures.js';

const RIDER = 'rider-1';
const CAPTAIN = 'captain-1';
const RIDER_PHONE_TOKEN = 'ExponentPushToken[rider-phone]';
const RIDER_TABLET_TOKEN = 'ExponentPushToken[rider-tablet]';
const CAPTAIN_TOKEN = 'ExponentPushToken[captain-phone]';

let push: PushCapture;

/**
 * Token lookups answer for whichever user ids are asked about, so the spec does
 * not care whether the implementation fetches tokens one user at a time or in
 * a batch.
 */
function tokensFor(userIds: string[]): { token: string; platform: string }[] {
  const table: Record<string, { token: string; platform: string }[]> = {
    [RIDER]: [
      { token: RIDER_PHONE_TOKEN, platform: 'android' },
      { token: RIDER_TABLET_TOKEN, platform: 'ios' },
    ],
    [CAPTAIN]: [{ token: CAPTAIN_TOKEN, platform: 'android' }],
  };
  return userIds.flatMap((id) => table[id] ?? []);
}

function acceptScenario() {
  const client = {
    query: vi.fn(async (sql: unknown) => {
      const text = String(sql);
      if (/FROM rides WHERE id = \$1 FOR UPDATE/i.test(text)) {
        return { rows: [rideRow({ booker_id: RIDER, status: 'searching' })], rowCount: 1 };
      }
      if (/SELECT accepts_colis, vehicle_type FROM captains/i.test(text)) {
        return { rows: [{ accepts_colis: false, vehicle_type: 'car' }], rowCount: 1 };
      }
      if (/UPDATE rides\s+SET captain_id/i.test(text)) {
        return {
          rows: [rideRow({ booker_id: RIDER, captain_id: CAPTAIN, status: 'accepted', accepted_at: new Date() })],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    }),
  };
  withTxMock.mockImplementation(async (fn: any) => fn(client));
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
  push = capturePush();
  getBalanceMock.mockResolvedValue(500);
  poolQueryMock.mockImplementation(async (sql: unknown, params: any[] = []) => {
    const text = String(sql);
    if (/FROM push_tokens/i.test(text)) {
      const ids: string[] = Array.isArray(params[0]) ? params[0] : [params[0]];
      return { rows: tokensFor(ids), rowCount: tokensFor(ids).length };
    }
    // Whatever the implementation needs to enrich the notification (captain
    // name, vehicle) answers here.
    if (/FROM users/i.test(text) || /FROM captains/i.test(text)) {
      return {
        rows: [{
          id: CAPTAIN, full_name: 'Sidi Ould Ahmed', phone: '+22246000000',
          plate: 'AA-1234-BB', brand: 'Toyota', model: 'Corolla', color: 'blanche',
          rating_avg: '4.8', rating_count: 12, total_rides: 130,
        }],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: 0 };
  });
});

describe('accepting a ride notifies the rider', () => {
  it('pushes to the booker', async () => {
    acceptScenario();

    await acceptRide('ride-1', CAPTAIN);
    await flush();

    expectPushedTo(
      push, RIDER_PHONE_TOKEN,
      'Accepting a ride must notify the booker — today only the 5 s poll reveals it, and it stops when the screen blurs.',
    );
  });

  it('reaches every device the rider has registered', async () => {
    acceptScenario();

    await acceptRide('ride-1', CAPTAIN);
    await flush();

    // A rider who booked on a tablet and pocketed a phone must be reachable on
    // both — push_tokens is keyed (user_id, device_id) precisely for this.
    expectPushedTo(push, RIDER_TABLET_TOKEN, 'All of the booker devices must be notified.');
  });

  it('identifies the ride in the data payload so the tap deep-links', async () => {
    acceptScenario();

    await acceptRide('ride-1', CAPTAIN);
    await flush();

    const toRider = push.messages().filter((m) =>
      (Array.isArray(m.to) ? m.to : [m.to]).includes(RIDER_PHONE_TOKEN));

    expect(toRider.length, 'No message addressed to the rider').toBeGreaterThan(0);
    expect(
      toRider[0]!.data,
      'The payload must carry the ride id so NotificationTapHandler can route to the tracking screen.',
    ).toMatchObject({ rideId: 'ride-1' });
  });

  it('names the captain in the body', async () => {
    acceptScenario();

    await acceptRide('ride-1', CAPTAIN);
    await flush();

    const toRider = push.messages().filter((m) =>
      (Array.isArray(m.to) ? m.to : [m.to]).includes(RIDER_PHONE_TOKEN));

    expect(toRider.length, 'No message addressed to the rider').toBeGreaterThan(0);
    const text = `${toRider[0]!.title ?? ''} ${toRider[0]!.body ?? ''}`;
    // Who is coming, and in what. A generic "votre course a été acceptée" makes
    // the rider open the app anyway, which defeats the purpose of the push.
    expect(text, 'The notification should name the captain.').toMatch(/Sidi/);
  });

  it('does not notify the captain who just accepted', async () => {
    acceptScenario();

    await acceptRide('ride-1', CAPTAIN);
    await flush();

    // They are holding the phone that produced the action.
    expect(push.recipients()).not.toContain(CAPTAIN_TOKEN);
  });

  it('does not block the accept response on the push', async () => {
    acceptScenario();
    // Expo hanging must not hold the captain's UI on a spinner.
    push.fetchMock.mockImplementation(() => new Promise(() => {}));

    const ride = await Promise.race([
      acceptRide('ride-1', CAPTAIN),
      new Promise((_, reject) => setTimeout(() => reject(new Error('accept blocked on push')), 500)),
    ]);

    expect((ride as any).status).toBe('accepted');
  });

  it('still accepts the ride when the push fails outright', async () => {
    acceptScenario();
    push.fetchMock.mockRejectedValue(new Error('ENOTFOUND exp.host'));

    // Notifications are an enhancement. A dead Expo must never cost a match.
    const ride = await acceptRide('ride-1', CAPTAIN);
    await flush();

    expect(ride.status).toBe('accepted');
    expect(ride.captainId).toBe(CAPTAIN);
  });
});
