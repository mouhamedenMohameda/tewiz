/**
 * FEATURE 7 — le rider apprend que le captain est arrivé.
 *
 * WHAT MUST HOLD
 *
 *   1. `POST /captain/rides/:id/arrive` pushes to the booker.
 *   2. The notification is marked time-sensitive (iOS) / high priority on the
 *      ride-alerts channel (Android). This is the one moment in the flow where
 *      the rider is provably NOT looking at their phone — they are waiting.
 *   3. The payload carries the ride id so the tap opens the tracking screen.
 *   4. Nothing is sent on the open-ride / private-driver shortcut where
 *      `arrive` transitions straight to `in_progress`: there the captain and
 *      rider are already together, and a "votre chauffeur est arrivé" push
 *      after the trip started is noise.
 *
 * WHY THIS IS WORSE THAN #4
 *
 * At accept time the rider has just used the app and is probably still looking
 * at it. At arrival they have been waiting several minutes with the phone in a
 * pocket. Today "Je suis arrivé" writes a timestamp and tells nobody: the
 * captain waits at the kerb, the rider waits inside, and whoever gives up first
 * makes a phone call.
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
vi.mock('../../src/modules/auth/sms.js', () => ({ sms: { send: vi.fn() } }));
vi.mock('../../src/modules/wallet/wallet.service.js', () => ({
  getBalance: vi.fn(async () => 500),
  debitWallet: vi.fn(),
}));
vi.mock('../../src/modules/rides/dispatch.service.js', () => ({
  distanceMeters: vi.fn(),
  eligibleCaptainsForRide: vi.fn(async () => []),
}));

import { arriveRide } from '../../src/modules/rides/rides.service.js';
import { rideRow } from './_fixtures.js';

const RIDER = 'rider-1';
const CAPTAIN = 'captain-1';
const RIDER_TOKEN = 'ExponentPushToken[rider-phone]';

let push: PushCapture;

function scenario(ride: Record<string, unknown> = {}, updated: Record<string, unknown> = {}) {
  const client = {
    query: vi.fn(async (sql: unknown) => {
      const text = String(sql);
      if (/FROM rides WHERE id = \$1 FOR UPDATE/i.test(text)) {
        return {
          rows: [rideRow({ booker_id: RIDER, captain_id: CAPTAIN, status: 'accepted', ...ride })],
          rowCount: 1,
        };
      }
      if (/UPDATE rides\s+SET status/i.test(text)) {
        return {
          rows: [rideRow({
            booker_id: RIDER, captain_id: CAPTAIN,
            status: 'arrived', arrived_at: new Date(), ...updated,
          })],
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
  poolQueryMock.mockImplementation(async (sql: unknown, params: any[] = []) => {
    if (/FROM push_tokens/i.test(String(sql))) {
      const ids: string[] = Array.isArray(params[0]) ? params[0] : [params[0]];
      return ids.includes(RIDER)
        ? { rows: [{ token: RIDER_TOKEN, platform: 'android' }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    return { rows: [], rowCount: 0 };
  });
});

describe('marking arrival notifies the rider', () => {
  it('pushes to the booker', async () => {
    scenario();

    await arriveRide('ride-1', CAPTAIN);
    await flush();

    expectPushedTo(
      push, RIDER_TOKEN,
      'The captain is at the kerb and the rider is not told. This is the moment a push matters most.',
    );
  });

  it('breaks through Focus / Do-Not-Disturb', async () => {
    scenario();

    await arriveRide('ride-1', CAPTAIN);
    await flush();

    const msg = push.messages()[0];
    expect(msg, 'No notification was sent at all').toBeDefined();
    // Apple forbids third-party full-screen takeovers; time-sensitive is the
    // strongest conformant signal, and it is already used for captain alerts.
    expect(
      msg.interruptionLevel,
      'The arrival alert must be time-sensitive — a rider waiting inside has their phone silenced.',
    ).toBe('time-sensitive');
    expect(msg.priority).toBe('high');
  });

  it('carries the ride id so the tap deep-links to the tracking screen', async () => {
    scenario();

    await arriveRide('ride-1', CAPTAIN);
    await flush();

    const msg = push.messages()[0];
    expect(msg, 'No notification was sent at all').toBeDefined();
    expect(msg.data).toMatchObject({ rideId: 'ride-1' });
  });

  it('says the captain is waiting, not merely that something changed', async () => {
    scenario();

    await arriveRide('ride-1', CAPTAIN);
    await flush();

    const msg = push.messages()[0];
    expect(msg, 'No notification was sent at all').toBeDefined();
    const text = `${msg.title ?? ''} ${msg.body ?? ''}`.toLowerCase();
    expect(
      text,
      'The copy must tell the rider their captain is waiting.',
    ).toMatch(/arriv|attend|là|prêt/);
  });

  it('stays silent on the open-ride shortcut, where arrive means the trip started', async () => {
    scenario(
      { is_open: true },
      { is_open: true, status: 'in_progress', started_at: new Date() },
    );

    await arriveRide('ride-1', CAPTAIN);
    await flush();

    // Rider and captain are already together; "votre chauffeur est arrivé"
    // after the meter starts is noise, and noise is how a channel gets muted.
    expect(push.recipients()).not.toContain(RIDER_TOKEN);
  });

  it('does not block the captain response on the push', async () => {
    scenario();
    push.fetchMock.mockImplementation(() => new Promise(() => {}));

    const ride = await Promise.race([
      arriveRide('ride-1', CAPTAIN),
      new Promise((_, reject) => setTimeout(() => reject(new Error('arrive blocked on push')), 500)),
    ]);

    expect((ride as any).status).toBe('arrived');
  });
});
