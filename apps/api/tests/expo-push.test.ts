import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// expo-push imports the pg pool and the settings service at module load; mock
// both so the module can be imported without a live DB / Redis.
vi.mock('../src/db/pool.js', () => ({ pool: { query: vi.fn(), on: vi.fn() }, withTx: vi.fn() }));
vi.mock('../src/modules/admin/app-settings.service.js', () => ({ getPricingSettings: vi.fn() }));

import { sendPush } from '../src/modules/push/expo-push.js';

const EXPO_URL = 'https://exp.host/--/api/v2/push/send';

type FetchResponse = { ok: boolean; status: number; text: () => Promise<string> };

function ok(): FetchResponse {
  return { ok: true, status: 200, text: async () => '' };
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

describe('sendPush — other failures are logged, never retried or thrown', () => {
  it('warns without retrying on an unrelated Expo error', async () => {
    fetchMock.mockResolvedValue(
      fail(500, JSON.stringify({ errors: [{ code: 'INTERNAL_SERVER_ERROR' }] })),
    );

    await sendPush({ to: ['tok-a'] });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('warns without retrying when the error body is not JSON', async () => {
    fetchMock.mockResolvedValue(fail(502, '<html>Bad Gateway</html>'));

    await sendPush({ to: ['tok-a'] });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('swallows a network throw and logs it (fire-and-forget)', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));

    await expect(sendPush({ to: ['tok-a'] })).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
