/**
 * FEATURE 11 — Le captain annule après avoir accepté : la course survit.
 *
 * The rule that matters: a captain changing their mind must not cancel the
 * RIDER'S trip. The ride goes back to 'searching', the cancelling captain lands
 * in ride_declines so he is not re-offered it, and the ride is re-broadcast
 * AFTER the commit — a race that was fixed once and is pinned by
 * rides-broadcast-after-commit.test.ts.
 *
 * The other half — scoring the cancellation and telling the rider — is covered
 * by 11-captain-cancellation-has-consequences.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeClient, flush, rideRow } from './_fixtures.js';

const { poolQueryMock, withTxMock, eligibleMock, pushSpies } = vi.hoisted(() => ({
  poolQueryMock: vi.fn(),
  withTxMock: vi.fn(),
  eligibleMock: vi.fn(),
  pushSpies: {
    sendPush: vi.fn(),
    notifyCaptainsNewRide: vi.fn(),
    notifyProvidersRoadside: vi.fn(),
    notifyVoiceRideConfirmed: vi.fn(),
    notifyRiderRideAccepted: vi.fn(),
    notifyRiderCaptainArrived: vi.fn(),
    notifyRiderCaptainCancelled: vi.fn(),
    notifyRiderRideExpired: vi.fn(),
    getPushTokensForUsers: vi.fn(async () => []),
    getPushTokensWithPlatform: vi.fn(async () => []),
  },
}));

vi.mock('../../src/db/pool.js', () => ({
  pool: { query: poolQueryMock, connect: vi.fn(), on: vi.fn() },
  withTx: withTxMock,
}));
vi.mock('../../src/modules/rides/dispatch.service.js', () => ({
  eligibleCaptainsForRide: eligibleMock,
  distanceMeters: vi.fn(),
}));
vi.mock('../../src/modules/push/expo-push.js', () => pushSpies);
vi.mock('../../src/modules/auth/sms.js', () => ({ sms: { send: vi.fn() } }));
vi.mock('../../src/modules/wallet/wallet.service.js', () => ({
  getBalance: vi.fn(async () => 500),
  debitWallet: vi.fn(),
}));

import { cancelRide } from '../../src/modules/rides/rides.service.js';

const RIDER = 'rider-1';
const CAPTAIN = 'captain-1';

function scenario(ride: Record<string, unknown> = {}) {
  const client = fakeClient([
    [/FROM rides WHERE id = \$1 FOR UPDATE/i, () => ({
      rows: [rideRow({ booker_id: RIDER, captain_id: CAPTAIN, status: 'accepted', ...ride })],
    })],
    [/UPDATE rides\s+SET captain_id   = NULL/i, () => ({
      rows: [rideRow({ booker_id: RIDER, captain_id: null, status: 'searching' })],
    })],
    [/UPDATE rides\s+SET status = \$1/i, (params) => ({
      rows: [rideRow({
        booker_id: RIDER, captain_id: CAPTAIN, status: params[0],
        cancel_reason: params[1], cancelled_at: new Date(),
      })],
    })],
  ]);
  withTxMock.mockImplementation(async (fn: any) => fn(client));
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
  poolQueryMock.mockResolvedValue({ rows: [], rowCount: 0 });
  eligibleMock.mockResolvedValue(['captain-2', 'captain-3']);
});

describe('the ride survives — it is re-offered, not destroyed', () => {
  it('goes back to searching with no captain assigned', async () => {
    scenario();

    const ride = await cancelRide({
      rideId: 'ride-1', userId: CAPTAIN, role: 'captain', reason: 'panne',
    });

    // The rider asked for a trip; a captain changing their mind must not cancel
    // the trip itself.
    expect(ride.status).toBe('searching');
    expect(ride.captainId).toBeNull();
    expect(ride.acceptedAt).toBeNull();
  });

  it('records a decline so the same captain is never re-offered this ride', async () => {
    const client = scenario();

    await cancelRide({ rideId: 'ride-1', userId: CAPTAIN, role: 'captain', reason: 'panne' });

    expect(client.didQuery(/INSERT INTO ride_declines/i)).toBe(true);
  });

  it('frees the captain back to online', async () => {
    const client = scenario();

    await cancelRide({ rideId: 'ride-1', userId: CAPTAIN, role: 'captain', reason: 'panne' });

    // The presence is a bound parameter, not a literal, because a captain past
    // the cancellation limit is sent 'offline' for a cooldown instead. Here the
    // history is empty, so an occasional cancellation stays free.
    const upd = client.calls.find((c) => /UPDATE captain_state/i.test(c.sql));
    expect(upd, 'presence was never updated').toBeDefined();
    expect(upd!.params).toContain('online');
  });

  it('re-broadcasts to the other eligible captains', async () => {
    scenario();

    await cancelRide({ rideId: 'ride-1', userId: CAPTAIN, role: 'captain', reason: 'panne' });
    await flush();

    expect(pushSpies.notifyCaptainsNewRide).toHaveBeenCalledWith(
      ['captain-2', 'captain-3'],
      expect.objectContaining({ id: 'ride-1' }),
    );
  });

  it('works the same way from the arrived state', async () => {
    scenario({ status: 'arrived', arrived_at: new Date() });

    const ride = await cancelRide({
      rideId: 'ride-1', userId: CAPTAIN, role: 'captain', reason: 'client absent',
    });

    expect(ride.status).toBe('searching');
    expect(ride.arrivedAt).toBeNull();
  });
});

describe('a genuine cancellation still terminates the ride', () => {
  it('marks the ride cancelled_by_rider when the rider gives up', async () => {
    scenario({ status: 'searching', captain_id: null });

    const ride = await cancelRide({
      rideId: 'ride-1', userId: RIDER, role: 'rider', reason: 'plus besoin',
    });

    expect(ride.status).toBe('cancelled_by_rider');
    expect(ride.cancelReason).toBe('plus besoin');
  });

  it('refuses a cancellation from someone who is neither party', async () => {
    scenario();

    await expect(cancelRide({
      rideId: 'ride-1', userId: 'stranger', role: 'rider', reason: 'x',
    })).rejects.toMatchObject({ status: 403, code: 'forbidden' });
  });

  it.each(['in_progress', 'completed', 'cancelled_by_rider'] as const)(
    'refuses a cancellation from status %s',
    async (status) => {
      scenario({ status });

      await expect(cancelRide({
        rideId: 'ride-1', userId: CAPTAIN, role: 'captain', reason: 'x',
      })).rejects.toMatchObject({ status: 409, code: 'wrong_status' });
    },
  );

  it('stops the rider cancelling a metered ride once it is under way', async () => {
    scenario({ is_open: true, status: 'in_progress' });

    // The rider is in the car and the meter is running: only the captain ends it.
    await expect(cancelRide({
      rideId: 'ride-1', userId: RIDER, role: 'rider', reason: 'x',
    })).rejects.toMatchObject({ code: 'rider_cancel_open_forbidden' });
  });

  it('still lets the rider cancel an open ride before anyone accepts', async () => {
    scenario({ is_open: true, status: 'searching', captain_id: null });

    const ride = await cancelRide({
      rideId: 'ride-1', userId: RIDER, role: 'rider', reason: 'trop long',
    });

    expect(ride.status).toBe('cancelled_by_rider');
  });
});
