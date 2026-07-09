import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, startTestApp, type TestAppHandle } from './helpers/app.js';
import { dispatchSql, rows } from './helpers/db.js';

const { queryMock, redisPingMock, ridesMock, settingsMock, mockSmsMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  redisPingMock: vi.fn(),
  ridesMock: { confirmPassengerRide: vi.fn() },
  settingsMock: vi.fn(),
  mockSmsMock: vi.fn(),
}));

vi.mock('../src/db/pool.js', () => ({
  pool: { query: queryMock, connect: vi.fn(), on: vi.fn() },
  withTx: vi.fn(),
}));
vi.mock('../src/db/redis.js', () => ({
  redis: { ping: redisPingMock, on: vi.fn() },
}));
vi.mock('../src/modules/rides/rides.service.js', () => ridesMock);
vi.mock('../src/modules/admin/app-settings.service.js', () => ({
  getPricingSettings: settingsMock,
}));
vi.mock('../src/modules/auth/sms.js', () => ({ getMockMessages: mockSmsMock }));
// Force dev mode so the /dev router is reachable regardless of the local .env.
vi.mock('../src/config/env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/config/env.js')>();
  return { env: { ...actual.env, NODE_ENV: 'development' } };
});

import { publicRouter } from '../src/modules/public/public.routes.js';
import { healthRouter } from '../src/modules/health/health.routes.js';
import { devRouter } from '../src/modules/health/dev.routes.js';
import { voiceRouter } from '../src/modules/voice/voice.routes.js';

let handle: TestAppHandle | null = null;
const realFetch = globalThis.fetch;

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
  redisPingMock.mockReset();
  ridesMock.confirmPassengerRide.mockReset();
  settingsMock.mockReset();
  mockSmsMock.mockReset();
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  if (handle) await handle.close();
  handle = null;
});

/** Intercepts fetch calls matching `match`; everything else hits the network. */
function interceptFetch(match: string, respond: () => Response) {
  globalThis.fetch = ((input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes(match)) return Promise.resolve(respond());
    return realFetch(input, init);
  }) as typeof fetch;
}

describe('public routes', () => {
  async function start() {
    handle = await startTestApp('/public', publicRouter);
    return handle;
  }

  const settings = {
    showDemoButtons: true,
    captainAlertSoundMode: 'loop',
    captainAlertRepeatIntervalS: 5,
    captainAlertSoundUrl: 'https://cdn.example.com/alert.mp3',
  };

  it('GET /config exposes the pre-auth feature flags (demo buttons on for the allowed version)', async () => {
    settingsMock.mockResolvedValue(settings);
    const { baseUrl } = await start();
    // DEMO_BUTTONS_ALLOWED_VERSIONS defaults to 1.1.12.
    const res = await api(baseUrl, 'GET', '/public/config', undefined, {
      'x-app-version': '1.1.12',
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      showDemoButtons: true,
      captainAlertSoundMode: 'loop',
      captainAlertRepeatIntervalS: 5,
      captainAlertSoundUrl: 'https://cdn.example.com/alert.mp3',
    });
  });

  it('GET /config hides the demo buttons for an older / unknown version even when the toggle is on', async () => {
    settingsMock.mockResolvedValue(settings);
    const { baseUrl } = await start();

    // An already-shipped build sends no version header → demo buttons stay off.
    const noHeader = await api(baseUrl, 'GET', '/public/config');
    expect(noHeader.status).toBe(200);
    expect(noHeader.body.showDemoButtons).toBe(false);
    // Other flags still pass through untouched.
    expect(noHeader.body.captainAlertSoundMode).toBe('loop');

    // A different (non-allowed) version is also gated off.
    const otherVersion = await api(baseUrl, 'GET', '/public/config', undefined, {
      'x-app-version': '1.1.11',
    });
    expect(otherVersion.body.showDemoButtons).toBe(false);
  });

  it('GET /captain-alert-sound returns 404 when no sound is configured', async () => {
    settingsMock.mockResolvedValue({ ...settings, captainAlertSoundUrl: null });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/public/captain-alert-sound');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('alert_sound_not_configured');
  });

  it('GET /captain-alert-sound proxies the upstream audio', async () => {
    settingsMock.mockResolvedValue(settings);
    interceptFetch(
      'cdn.example.com',
      () => new Response(Buffer.from('mp3-bytes'), {
        status: 200,
        headers: { 'content-type': 'audio/mpeg' },
      }),
    );
    const { baseUrl } = await start();
    const res = await realFetch(`${handle!.baseUrl}/public/captain-alert-sound`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('audio/mpeg');
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('mp3-bytes');
  });

  it('GET /captain-alert-sound maps an upstream failure to 502', async () => {
    settingsMock.mockResolvedValue(settings);
    interceptFetch('cdn.example.com', () => new Response('nope', { status: 500 }));
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/public/captain-alert-sound');
    expect(res.status).toBe(502);
  });

  it('POST /rides/:id/confirm confirms with the 4-digit SMS code', async () => {
    ridesMock.confirmPassengerRide.mockResolvedValue({
      id: 'ride-1',
      status: 'searching',
      pickup: { label: 'Ksar' },
      dropoff: { label: 'Sebkha' },
      fareEstimateMru: 120,
      internalField: 'must-not-leak',
    });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/public/rides/ride-1/confirm', { code: '1234' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: 'ride-1',
      status: 'searching',
      pickup: { label: 'Ksar' },
      dropoff: { label: 'Sebkha' },
      fareEstimateMru: 120,
    });
  });

  it('POST /rides/:id/confirm rejects a non-numeric code (400)', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/public/rides/ride-1/confirm', { code: '12ab' });
    expect(res.status).toBe(400);
  });
});

describe('GET /health', () => {
  async function start() {
    handle = await startTestApp('/', healthRouter);
    return handle;
  }

  it('returns 200 when postgres, redis and postgis are all up', async () => {
    dispatchSql(queryMock, [
      [/SELECT 1 AS ok/, rows([{ ok: 1 }])],
      [/pg_extension/, rows([{ extname: 'postgis' }])],
    ]);
    redisPingMock.mockResolvedValue('PONG');
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.checks).toEqual({ postgres: 'ok', redis: 'ok', postgis: 'ok' });
  });

  it('returns 503 when redis is down', async () => {
    dispatchSql(queryMock, [
      [/SELECT 1 AS ok/, rows([{ ok: 1 }])],
      [/pg_extension/, rows([{ extname: 'postgis' }])],
    ]);
    redisPingMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/health');
    expect(res.status).toBe(503);
    expect(res.body.ok).toBe(false);
    expect(res.body.checks.redis).toContain('ECONNREFUSED');
  });
});

describe('GET /dev/mock-sms', () => {
  it('returns the mock outbox for a phone in development', async () => {
    mockSmsMock.mockReturnValue([{ to: '+22245123456', body: 'Code 1234' }]);
    handle = await startTestApp('/dev', devRouter);
    const res = await api(handle.baseUrl, 'GET', '/dev/mock-sms?phone=%2B22245123456');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ to: '+22245123456', body: 'Code 1234' }]);
    expect(mockSmsMock).toHaveBeenCalledWith('+22245123456');
  });
});

describe('voice-to-location proxy (currently unmounted in rider.routes)', () => {
  async function start() {
    handle = await startTestApp('/rider', voiceRouter);
    return handle;
  }

  it('POST /voice-to-location without audio is a 400', async () => {
    const { baseUrl } = await start();
    const res = await fetch(`${baseUrl}/rider/voice-to-location`, {
      method: 'POST',
      body: new FormData(),
    });
    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.error).toBe('audio_required');
  });

  it('POST /voice-to-location forwards the audio with the server-side key', async () => {
    let upstreamHeaders: Record<string, string> = {};
    interceptFetch('/v1/voice-to-location', () =>
      new Response(JSON.stringify({ transcript: 'vers le marché' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    // Wrap again to capture headers.
    const inner = globalThis.fetch;
    globalThis.fetch = ((input: any, init?: any) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('/v1/voice-to-location')) {
        upstreamHeaders = Object.fromEntries(
          Object.entries((init?.headers ?? {}) as Record<string, string>),
        );
      }
      return inner(input, init);
    }) as typeof fetch;

    const { baseUrl } = await start();
    const form = new FormData();
    form.set('audio', new Blob([Buffer.from('m4a')], { type: 'audio/m4a' }), 'memo.m4a');
    const res = await realFetch(`${baseUrl}/rider/voice-to-location`, {
      method: 'POST',
      body: form,
    });

    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.transcript).toBe('vers le marché');
    expect(upstreamHeaders['X-API-Key']).toBeTruthy();
  });

  it('POST /voice-to-location/confirm relays the JSON body and mirrors the upstream status', async () => {
    interceptFetch('/v1/voice-to-location/confirm', () =>
      new Response(JSON.stringify({ error: 'invalid_body' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/rider/voice-to-location/confirm', {
      request_id: 'r1',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_body');
  });
});
