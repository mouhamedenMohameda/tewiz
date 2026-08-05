/**
 * FEATURE 7 — Le captain signale son arrivée : la machine à états.
 *
 * These transitions guard the fare. A captain who could reach 'in_progress'
 * without passing through 'arrived' would start the meter while still driving
 * to the pickup; one who could re-enter 'arrived' could restart it.
 *
 * The other half — notifying the rider that their captain is at the kerb — is
 * covered by 07-rider-notified-on-arrival.test.ts. These transitions guard the
 * fare and must stay green independently of it.
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
vi.mock('../../src/modules/push/expo-push.js', () => ({ notifyCaptainsNewRide: vi.fn() }));
vi.mock('../../src/modules/auth/sms.js', () => ({ sms: { send: vi.fn() } }));
vi.mock('../../src/modules/wallet/wallet.service.js', () => ({
  getBalance: vi.fn(async () => 500),
  debitWallet: vi.fn(),
}));
vi.mock('../../src/modules/rides/dispatch.service.js', () => ({
  distanceMeters: vi.fn(),
  eligibleCaptainsForRide: vi.fn(async () => []),
}));

import { arriveRide, startRide } from '../../src/modules/rides/rides.service.js';

const CAPTAIN = 'captain-1';

function scenario(ride: Record<string, unknown>, updated: Record<string, unknown>) {
  const client = fakeClient([
    [/FROM rides WHERE id = \$1 FOR UPDATE/i, () => ({
      rows: [rideRow({ captain_id: CAPTAIN, ...ride })],
    })],
    [/UPDATE rides\s+SET status/i, () => ({
      rows: [rideRow({ captain_id: CAPTAIN, ...updated })],
    })],
  ]);
  withTxMock.mockImplementation(async (fn: any) => fn(client));
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
  poolQueryMock.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe('the arrival state machine must not loosen when the push is added', () => {
  it('moves accepted → arrived for a normal fixed-fare ride', async () => {
    scenario({ status: 'accepted' }, { status: 'arrived', arrived_at: new Date() });

    const ride = await arriveRide('ride-1', CAPTAIN);

    expect(ride.status).toBe('arrived');
  });

  it('skips straight to in_progress for an open ride', async () => {
    scenario(
      { status: 'accepted', is_open: true },
      { status: 'in_progress', is_open: true, arrived_at: new Date(), started_at: new Date() },
    );

    // An open ride has no boarding step to confirm — the meter starts when the
    // captain reaches the rider, so 'arrived' would be a state nobody leaves.
    const ride = await arriveRide('ride-1', CAPTAIN);

    expect(ride.status).toBe('in_progress');
    expect(ride.startedAt).toBeInstanceOf(Date);
  });

  it('skips straight to in_progress for a private-driver booking', async () => {
    scenario(
      { status: 'accepted', ride_type: 'private_driver' },
      { status: 'in_progress', ride_type: 'private_driver', started_at: new Date() },
    );

    const ride = await arriveRide('ride-1', CAPTAIN);

    expect(ride.status).toBe('in_progress');
  });

  it('refuses an arrival from a captain who does not own the ride', async () => {
    scenario({ status: 'accepted' }, {});

    await expect(arriveRide('ride-1', 'captain-999')).rejects.toMatchObject({
      status: 403,
      code: 'forbidden',
    });
  });

  it.each(['searching', 'arrived', 'in_progress', 'completed'] as const)(
    'refuses an arrival from status %s',
    async (status) => {
      scenario({ status }, {});

      await expect(arriveRide('ride-1', CAPTAIN)).rejects.toMatchObject({
        status: 409,
        code: 'wrong_status',
      });
    },
  );

  it('requires the arrival step before the ride can start', async () => {
    scenario({ status: 'accepted' }, {});

    // Guards the fare: a captain who could jump to in_progress from 'accepted'
    // would start the clock while still driving to the pickup.
    await expect(startRide('ride-1', CAPTAIN)).rejects.toMatchObject({
      status: 409,
      code: 'wrong_status',
    });
  });

  it('starts the ride once arrived', async () => {
    scenario({ status: 'arrived' }, { status: 'in_progress', started_at: new Date() });

    const ride = await startRide('ride-1', CAPTAIN);

    expect(ride.status).toBe('in_progress');
    expect(ride.startedAt).toBeInstanceOf(Date);
  });
});
