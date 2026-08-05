/**
 * FEATURE 2 (delivery) — ne pas perdre une diffusion sur un incident réseau.
 *
 * WHAT MUST HOLD
 *
 *   1. A transient failure reaching Expo (network error, 5xx, 429) is retried
 *      at least once, with a short backoff.
 *   2. A permanent failure (4xx other than 429) is NOT retried — the payload is
 *      wrong and retrying only doubles the damage.
 *   3. Retries stay bounded and never block the caller: ride creation is
 *      `void broadcastNewRide(...)` and must stay that way.
 *   4. The ride-alert TTL is long enough to survive a slow mobile link. 60 s is
 *      the current value; on a Mauritanian 2G connection an alert can take
 *      longer than that to be delivered, at which point the push service
 *      DISCARDS it and the captain never learns the ride existed.
 *
 * WHY
 *
 * One attempt, no backoff, no queue. A 30-second Expo blip loses every ride
 * broadcast in that window. The only recovery is the 5 s inbox poll, which
 * reaches just the captains who happen to have the app in the foreground —
 * precisely the ones who needed the push least.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pricingSettings } from './_fixtures.js';

const { poolQueryMock, settingsMock, fetchMock } = vi.hoisted(() => ({
  poolQueryMock: vi.fn(),
  settingsMock: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.mock('../../src/db/pool.js', () => ({
  pool: { query: poolQueryMock, connect: vi.fn(), on: vi.fn() },
  withTx: vi.fn(),
}));
vi.mock('../../src/modules/admin/app-settings.service.js', () => ({
  getPricingSettings: settingsMock,
}));

import { notifyCaptainsNewRide } from '../../src/modules/push/expo-push.js';

const RIDE = { id: 'ride-1', rideType: 'passenger', fareEstimateMru: 205 };

const ok = () => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify({ data: [{ status: 'ok' }] }),
});

/** Requests that actually reached Expo. */
const pushAttempts = () =>
  fetchMock.mock.calls.filter(([url]) => String(url).includes('exp.host'));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  settingsMock.mockResolvedValue(pricingSettings());
  poolQueryMock.mockResolvedValue({
    rows: [{ token: 'ExponentPushToken[a]', platform: 'ios' }], rowCount: 1,
  });
});

describe('transient failures are retried', () => {
  it('retries after a network error', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('ETIMEDOUT'))
      .mockImplementation(async () => ok());

    await notifyCaptainsNewRide(['captain-1'], RIDE);

    expect(
      pushAttempts().length,
      'A network blip loses the broadcast outright — no retry is attempted.',
    ).toBeGreaterThanOrEqual(2);
  });

  it('retries after a 502 from Expo', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 502, text: async () => 'bad gateway' })
      .mockImplementation(async () => ok());

    await notifyCaptainsNewRide(['captain-1'], RIDE);

    expect(pushAttempts().length).toBeGreaterThanOrEqual(2);
  });

  it('retries after a 429', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 429, text: async () => 'rate limited' })
      .mockImplementation(async () => ok());

    await notifyCaptainsNewRide(['captain-1'], RIDE);

    expect(pushAttempts().length).toBeGreaterThanOrEqual(2);
  });

  it('gives up after a bounded number of attempts', async () => {
    fetchMock.mockRejectedValue(new Error('ETIMEDOUT'));

    await notifyCaptainsNewRide(['captain-1'], RIDE);

    // Unbounded retries against a dead Expo would pile up across every ride and
    // eventually starve the event loop.
    expect(pushAttempts().length).toBeLessThanOrEqual(4);
  });

  it('does not retry a 400 — the payload is wrong, not the network', async () => {
    fetchMock.mockResolvedValue({
      ok: false, status: 400, text: async () => '{"errors":[{"code":"PUSH_TOO_MANY_NOTIFICATIONS"}]}',
    });

    await notifyCaptainsNewRide(['captain-1'], RIDE);

    expect(pushAttempts().length).toBe(1);
  });

  it('never throws, whatever happens', async () => {
    fetchMock.mockRejectedValue(new Error('ENOTFOUND exp.host'));

    // The caller is `void broadcastNewRide(...)`; a rejection here surfaces as
    // an unhandled rejection, not as a 500.
    await expect(notifyCaptainsNewRide(['captain-1'], RIDE)).resolves.toBeUndefined();
  });
});

describe('the alert survives a slow link', () => {
  it('gives the ride alert a TTL that tolerates 2G latency', async () => {
    fetchMock.mockImplementation(async () => ok());

    await notifyCaptainsNewRide(['captain-1'], RIDE);

    const body = JSON.parse((pushAttempts()[0]![1] as any).body);
    // 60 s is the current value and is too short for the target network. Pick a
    // TTL that outlives a slow delivery but still expires before the ride does
    // (searchingTimeoutS defaults to 300).
    expect(
      body.ttl,
      'A 60 s TTL means a slow 2G delivery is discarded before it arrives — the captain never learns the ride existed.',
    ).toBeGreaterThanOrEqual(120);
    expect(body.ttl).toBeLessThanOrEqual(300);
  });
});
