import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// expo-push imports the pg pool and the settings service at module load; mock
// both so the module can be imported without a live DB / Redis.
vi.mock('../src/db/pool.js', () => ({ pool: { query: vi.fn(), on: vi.fn() }, withTx: vi.fn() }));
vi.mock('../src/modules/admin/app-settings.service.js', () => ({ getPricingSettings: vi.fn() }));

import { notifyCaptainsNewRide, sendPush } from '../src/modules/push/expo-push.js';
import { pool } from '../src/db/pool.js';
import { getPricingSettings } from '../src/modules/admin/app-settings.service.js';

const EXPO_URL = 'https://exp.host/--/api/v2/push/send';

type FetchResponse = { ok: boolean; status: number; text: () => Promise<string> };

function ok(): FetchResponse {
  // A 200 body is JSON with a per-token ticket array. sendPush JSON.parses it on
  // the success path, so an empty string would throw and warn — return the
  // minimal valid shape (no tickets = nothing to prune).
  return { ok: true, status: 200, text: async () => '{"data":[]}' };
}
function fail(status: number, body: string): FetchResponse {
  return { ok: false, status, text: async () => body };
}

/** Body Expo returns when a single request mixes tokens from >1 project. */
function tooManyExperiencesBody(groups: Record<string, string[]>): string {
  return JSON.stringify({
    errors: [{ code: 'PUSH_TOO_MANY_EXPERIENCE_IDS', message: 'mixed', details: groups }],
  });
}

const fetchMock = vi.fn();
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  warnSpy.mockRestore();
});

/** JSON body posted to Expo for the Nth fetch call. */
function sentBody(callIndex: number): any {
  return JSON.parse(fetchMock.mock.calls[callIndex][1].body);
}

describe('sendPush — happy path', () => {
  it('posts once to the Expo endpoint and never warns when accepted', async () => {
    fetchMock.mockResolvedValue(ok());

    await sendPush({ to: ['tok-a', 'tok-b'], title: 'hi' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(EXPO_URL);
    expect(init.method).toBe('POST');
    expect(sentBody(0)).toMatchObject({ to: ['tok-a', 'tok-b'], title: 'hi' });
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe('sendPush — PUSH_TOO_MANY_EXPERIENCE_IDS split & retry', () => {
  it('resends once per experience group with that group tokens, and does not warn', async () => {
    const body = tooManyExperiencesBody({
      '@tewiz/rider': ['tok-a', 'tok-b'],
      '@other/app': ['tok-c'],
    });
    // First request is rejected with the mixed-project error; both retries pass.
    fetchMock.mockResolvedValueOnce(fail(400, body)).mockResolvedValue(ok());

    await sendPush({ to: ['tok-a', 'tok-b', 'tok-c'], title: 'course' });

    // 1 initial + 2 groups = 3 requests.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const retried = [sentBody(1), sentBody(2)];
    expect(retried).toContainEqual(
      expect.objectContaining({ to: ['tok-a', 'tok-b'], title: 'course' }),
    );
    expect(retried).toContainEqual(expect.objectContaining({ to: ['tok-c'], title: 'course' }));
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('does not recurse infinitely — a retry that fails again is only logged', async () => {
    const body = tooManyExperiencesBody({ p1: ['tok-a'], p2: ['tok-b'] });
    // Every request fails with the same mixed-project error.
    fetchMock.mockResolvedValue(fail(400, body));

    await sendPush({ to: ['tok-a', 'tok-b'] });

    // 1 initial + 2 retries; retries carry isRetry=true so they do NOT split
    // again — they just warn once each.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it('does not split when only a single experience group is present', async () => {
    const body = tooManyExperiencesBody({ solo: ['tok-a', 'tok-b'] });
    fetchMock.mockResolvedValue(fail(400, body));

    await sendPush({ to: ['tok-a', 'tok-b'] });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});

describe('sendPush — transient failures are retried, permanent ones are not', () => {
  // A thirty-second Expo blip used to lose EVERY ride broadcast in that window:
  // one attempt, no backoff, no queue. The only recovery was the 5 s inbox poll,
  // which reaches exactly the captains who needed the push least — the ones
  // already looking at the app.

  it('retries a 500 up to the attempt cap', async () => {
    fetchMock.mockResolvedValue(
      fail(500, JSON.stringify({ errors: [{ code: 'INTERNAL_SERVER_ERROR' }] })),
    );

    await sendPush({ to: ['tok-a'] });

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('retries a 502 whose body is not even JSON', async () => {
    fetchMock.mockResolvedValue(fail(502, '<html>Bad Gateway</html>'));

    await sendPush({ to: ['tok-a'] });

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('retries a network throw', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));

    await expect(sendPush({ to: ['tok-a'] })).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('stops as soon as an attempt succeeds', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('ETIMEDOUT'))
      .mockResolvedValue(ok());

    await sendPush({ to: ['tok-a'] });

    // Two attempts, not three: the retry budget is a ceiling, not a quota.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry a 4xx — the payload is wrong, not the network', async () => {
    fetchMock.mockResolvedValue(
      fail(400, JSON.stringify({ errors: [{ code: 'PUSH_TOO_MANY_NOTIFICATIONS' }] })),
    );

    await sendPush({ to: ['tok-a'] });

    // Retrying a malformed request only sends the same broken request again.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never throws, whatever happens', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));

    // The caller is always a void-ed promise on a ride path, so a rejection
    // here would surface as an unhandled rejection, not as a useful error.
    await expect(sendPush({ to: ['tok-a'] })).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });
});

// The platform-split that makes the incoming-ride alert behave like Uber:
//   - EVERYONE gets a visible push flagged interruptionLevel 'time-sensitive'
//     (the iOS-conformant stand-in for Android's full-screen intent);
//   - ANDROID captains get an ADDITIONAL data-only push (no title/body) that
//     wakes the headless task to pop the full-screen "incoming ride" screen.
describe('notifyCaptainsNewRide — platform split', () => {
  const RIDE = { id: 'ride-1', rideType: 'passenger', fareEstimateMru: 1200 };

  function mockTokens(rows: { token: string; platform: string }[]) {
    vi.mocked(pool.query).mockResolvedValue({ rows } as never);
  }

  beforeEach(() => {
    fetchMock.mockResolvedValue(ok());
    vi.mocked(getPricingSettings).mockResolvedValue({ captainAlertSoundMode: 'default' } as never);
  });

  it('sends a time-sensitive visible push AND an Android data-only push', async () => {
    mockTokens([
      { token: 'ios-1', platform: 'ios' },
      { token: 'and-1', platform: 'android' },
    ]);

    await notifyCaptainsNewRide(['u1', 'u2'], RIDE);

    expect(fetchMock).toHaveBeenCalledTimes(2);

    // 1. Visible push to everyone, iOS Time-Sensitive.
    const visible = sentBody(0);
    expect(visible.to).toEqual(['ios-1', 'and-1']);
    expect(visible.interruptionLevel).toBe('time-sensitive');
    expect(visible.title).toBeTruthy();
    expect(visible.body).toBeTruthy();
    expect(visible.data).toMatchObject({ type: 'ride_alert', rideId: 'ride-1' });
    expect(visible.channelId).toBe('ride-alerts');

    // 2. Android-only data-only push: no title/body so the OS runs our JS.
    const dataOnly = sentBody(1);
    expect(dataOnly.to).toEqual(['and-1']);
    expect(dataOnly.title).toBeUndefined();
    expect(dataOnly.body).toBeUndefined();
    expect(dataOnly.data).toMatchObject({ type: 'ride_alert', rideId: 'ride-1' });
  });

  it('sends only the visible push for an iOS-only cohort', async () => {
    mockTokens([
      { token: 'ios-1', platform: 'ios' },
      { token: 'ios-2', platform: 'ios' },
    ]);

    await notifyCaptainsNewRide(['u1'], RIDE);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentBody(0).interruptionLevel).toBe('time-sensitive');
  });

  it('sends nothing when no captain has a token', async () => {
    mockTokens([]);
    await notifyCaptainsNewRide(['u1'], RIDE);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('escalates the sound to critical when configured', async () => {
    vi.mocked(getPricingSettings).mockResolvedValue({ captainAlertSoundMode: 'critical' } as never);
    mockTokens([{ token: 'ios-1', platform: 'ios' }]);

    await notifyCaptainsNewRide(['u1'], RIDE);

    expect(sentBody(0).sound).toMatchObject({ name: 'default', critical: true, volume: 1 });
  });
});

describe('ticket outcome metrics', () => {
  // The gap this closes: a 200 from Expo only means the REQUEST was accepted.
  // Each device gets its own ticket, and production logs were full of
  // `InvalidCredentials` — Android push was dead in every build because
  // google-services.json never reached the EAS builder — while nothing counted
  // it. Ride creation looked perfectly healthy the whole time.

  /** Value of tewiz_push_tickets_total for one status label. */
  async function ticketsFor(status: string) {
    const { pushTickets } = await import('../src/lib/metrics.js');
    const { values } = await pushTickets.get();
    return values.find((v) => (v.labels as { status?: string }).status === status)?.value ?? 0;
  }

  function ticketsBody(tickets: unknown[]): FetchResponse {
    return { ok: true, status: 200, text: async () => JSON.stringify({ data: tickets }) };
  }

  it('counts a delivered ticket as ok', async () => {
    const before = await ticketsFor('ok');
    fetchMock.mockResolvedValue(ticketsBody([{ status: 'ok', id: 'x' }]));

    await sendPush({ to: 'ExponentPushToken[aaa]', title: 't' });

    expect(await ticketsFor('ok')).toBe(before + 1);
  });

  it('counts InvalidCredentials under its own label', async () => {
    // The one that matters: Expo cannot reach the platform's push service, so
    // EVERY notification fails silently until someone looks at the logs.
    const before = await ticketsFor('InvalidCredentials');
    fetchMock.mockResolvedValue(ticketsBody([
      { status: 'error', message: 'nope', details: { error: 'InvalidCredentials' } },
    ]));

    await sendPush({ to: 'ExponentPushToken[bbb]', title: 't' });

    expect(await ticketsFor('InvalidCredentials')).toBe(before + 1);
  });

  it('folds an unknown error code into "other" rather than minting a label', async () => {
    // ticket.message is free text; free text as a Prometheus label is unbounded.
    const before = await ticketsFor('other');
    fetchMock.mockResolvedValue(ticketsBody([
      { status: 'error', message: 'some brand new failure mode', details: { error: 'WhoKnows' } },
    ]));

    await sendPush({ to: 'ExponentPushToken[ccc]', title: 't' });

    expect(await ticketsFor('other')).toBe(before + 1);
    expect(await ticketsFor('WhoKnows')).toBe(0);
  });
});
