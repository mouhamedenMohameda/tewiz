/**
 * FEATURE 2 — Le captain reçoit la course.
 *
 * A ride nobody is told about is a ride nobody takes. Two mechanisms carry it:
 * the push (which reaches a backgrounded/locked phone) and the inbox poll
 * (which is the safety net when the push is dropped). Both are pinned here.
 *
 * The delivery guarantees themselves — retry on a transient failure, and a TTL
 * that survives a slow 2G link — are covered by 02-push-is-retried.test.ts.
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

/** One Expo push request, decoded. */
function pushRequests(): any[] {
  return fetchMock.mock.calls.map(([, init]: any[]) => JSON.parse(init.body));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  settingsMock.mockResolvedValue(pricingSettings());
  // Expo answers 200 with one ticket per token.
  fetchMock.mockImplementation(async (_url: string, init: any) => {
    const body = JSON.parse(init.body);
    const n = Array.isArray(body.to) ? body.to.length : 1;
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: Array.from({ length: n }, () => ({ status: 'ok' })) }),
    };
  });
});

const RIDE = { id: 'ride-1', rideType: 'passenger', fareEstimateMru: 205 };

describe('the alert that reaches a locked phone', () => {
  it('sends nothing at all when no captain has a registered device', async () => {
    poolQueryMock.mockResolvedValue({ rows: [], rowCount: 0 });

    await notifyCaptainsNewRide(['captain-1'], RIDE);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('carries the ride id so the app can open the right alert', async () => {
    poolQueryMock.mockResolvedValue({
      rows: [{ token: 'ExponentPushToken[a]', platform: 'ios' }], rowCount: 1,
    });

    await notifyCaptainsNewRide(['captain-1'], RIDE);

    const [visible] = pushRequests();
    expect(visible.data).toEqual({ type: 'ride_alert', rideId: 'ride-1' });
    expect(visible.channelId).toBe('ride-alerts');
    expect(visible.priority).toBe('high');
  });

  it('quotes the fare in the body so the captain decides without opening the app', async () => {
    poolQueryMock.mockResolvedValue({
      rows: [{ token: 'ExponentPushToken[a]', platform: 'ios' }], rowCount: 1,
    });

    await notifyCaptainsNewRide(['captain-1'], RIDE);

    expect(pushRequests()[0].body).toContain('205');
  });

  it('marks the alert time-sensitive so iOS Focus/DND cannot swallow it', async () => {
    poolQueryMock.mockResolvedValue({
      rows: [{ token: 'ExponentPushToken[a]', platform: 'ios' }], rowCount: 1,
    });

    await notifyCaptainsNewRide(['captain-1'], RIDE);

    // Apple forbids third-party full-screen takeovers; this is the strongest
    // conformant signal we have. Losing it makes the app silent on a locked
    // iPhone, which is the only state that matters for a driver.
    expect(pushRequests()[0].interruptionLevel).toBe('time-sensitive');
  });

  it('adds a data-only push on Android so a killed app can still be woken', async () => {
    poolQueryMock.mockResolvedValue({
      rows: [
        { token: 'ExponentPushToken[android]', platform: 'android' },
        { token: 'ExponentPushToken[ios]', platform: 'ios' },
      ],
      rowCount: 2,
    });

    await notifyCaptainsNewRide(['c1', 'c2'], RIDE);

    const reqs = pushRequests();
    expect(reqs).toHaveLength(2);
    // The second request has no title/body → the OS does not draw it, the
    // headless task does. It targets Android tokens only.
    const dataOnly = reqs[1];
    expect(dataOnly.title).toBeUndefined();
    expect(dataOnly.to).toEqual(['ExponentPushToken[android]']);
    expect(dataOnly.data.rideId).toBe('ride-1');
  });

  it('labels the alert by ride type so a moto captain recognises a colis', async () => {
    poolQueryMock.mockResolvedValue({
      rows: [{ token: 'ExponentPushToken[a]', platform: 'ios' }], rowCount: 1,
    });

    await notifyCaptainsNewRide(['captain-1'], { ...RIDE, rideType: 'colis' });

    expect(pushRequests()[0].title).toContain('colis');
  });

  it('chunks at 100 tokens per request, the Expo limit', async () => {
    const tokens = Array.from({ length: 250 }, (_, i) => ({
      token: `ExponentPushToken[${i}]`, platform: 'ios',
    }));
    poolQueryMock.mockResolvedValue({ rows: tokens, rowCount: tokens.length });

    await notifyCaptainsNewRide(['captain-1'], RIDE);

    const reqs = pushRequests();
    expect(reqs).toHaveLength(3);
    expect(reqs.map((r) => r.to.length)).toEqual([100, 100, 50]);
  });
});

describe('a broken push must never break ride creation', () => {
  it('swallows a non-200 from Expo', async () => {
    poolQueryMock.mockResolvedValue({
      rows: [{ token: 'ExponentPushToken[a]', platform: 'ios' }], rowCount: 1,
    });
    fetchMock.mockResolvedValue({ ok: false, status: 502, text: async () => 'bad gateway' });

    // Resolves, does not throw: the caller is `void broadcastNewRide(...)`, so a
    // rejection here would surface as an unhandled rejection, not as a 500.
    await expect(notifyCaptainsNewRide(['captain-1'], RIDE)).resolves.toBeUndefined();
  });

  it('swallows a network failure', async () => {
    poolQueryMock.mockResolvedValue({
      rows: [{ token: 'ExponentPushToken[a]', platform: 'ios' }], rowCount: 1,
    });
    fetchMock.mockRejectedValue(new Error('ENOTFOUND exp.host'));

    await expect(notifyCaptainsNewRide(['captain-1'], RIDE)).resolves.toBeUndefined();
  });

  it('deletes a token Expo reports as permanently dead', async () => {
    poolQueryMock.mockResolvedValue({
      rows: [
        { token: 'ExponentPushToken[dead]', platform: 'ios' },
        { token: 'ExponentPushToken[live]', platform: 'ios' },
      ],
      rowCount: 2,
    });
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        data: [
          { status: 'error', details: { error: 'DeviceNotRegistered' } },
          { status: 'ok' },
        ],
      }),
    });

    await notifyCaptainsNewRide(['captain-1'], RIDE);

    const del = poolQueryMock.mock.calls.find(([sql]) => /DELETE FROM push_tokens/i.test(String(sql)));
    expect(del).toBeDefined();
    // Only the dead one is pruned; the healthy token survives.
    expect(del![1]).toEqual([['ExponentPushToken[dead]']]);
  });
});
