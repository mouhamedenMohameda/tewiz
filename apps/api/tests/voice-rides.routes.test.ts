import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, startTestApp, type TestAppHandle } from './helpers/app.js';
import { dispatchSql, rows } from './helpers/db.js';

const { queryMock, svcMock, poiSearchMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  svcMock: {
    createVoiceRideRequest: vi.fn(),
    getVoiceRideRequestForUser: vi.fn(),
    cancelVoiceRideRequest: vi.fn(),
    listVoiceRideRequestsForAdmin: vi.fn(),
    getVoiceRideRequestForAdmin: vi.fn(),
    getVoiceRideAudio: vi.fn(),
    confirmVoiceRideRequest: vi.fn(),
    rejectVoiceRideRequest: vi.fn(),
  },
  poiSearchMock: vi.fn(),
}));

vi.mock('../src/db/pool.js', () => ({
  pool: { query: queryMock, connect: vi.fn(), on: vi.fn() },
  withTx: vi.fn(),
}));
vi.mock('../src/modules/voice-rides/voice-rides.service.js', () => svcMock);
vi.mock('../src/modules/voice-rides/poi.service.js', () => ({ searchPois: poiSearchMock }));

import { riderVoiceRidesRouter } from '../src/modules/voice-rides/rider-voice-rides.routes.js';
import { adminVoiceRidesRouter } from '../src/modules/voice-rides/admin-voice-rides.routes.js';

const RIDER = { id: 'rider-1', role: 'rider' as const };
const ADMIN = { id: 'admin-1', role: 'admin' as const, adminRole: 'dispatcher' };

let handle: TestAppHandle | null = null;

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
  for (const fn of Object.values(svcMock)) fn.mockReset();
  poiSearchMock.mockReset();
});

afterEach(async () => {
  if (handle) await handle.close();
  handle = null;
});

describe('rider voice rides', () => {
  async function start() {
    handle = await startTestApp('/rider/voice-rides', riderVoiceRidesRouter, RIDER);
    return handle;
  }

  async function postAudio(baseUrl: string, withFile = true, durationS?: string) {
    const form = new FormData();
    if (withFile) {
      form.set('audio', new Blob([Buffer.from('m4a-bytes')], { type: 'audio/m4a' }), 'memo.m4a');
    }
    if (durationS) form.set('durationS', durationS);
    const res = await fetch(`${baseUrl}/rider/voice-rides`, { method: 'POST', body: form });
    return { status: res.status, body: await res.json().catch(() => null) };
  }

  it('POST / uploads the memo and creates a pending request (201)', async () => {
    dispatchSql(queryMock, [[/SELECT phone FROM users/, rows([{ phone: '+22245123456' }])]]);
    svcMock.createVoiceRideRequest.mockResolvedValue({ id: 'vr-1', status: 'pending' });
    const { baseUrl } = await start();

    const res = await postAudio(baseUrl, true, '12.6');
    expect(res.status).toBe(201);
    expect(svcMock.createVoiceRideRequest).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'rider-1', durationS: 13 }),
    );
  });

  it('POST / without audio is a 400 audio_required', async () => {
    dispatchSql(queryMock, [[/SELECT phone FROM users/, rows([{ phone: '+22245123456' }])]]);
    const { baseUrl } = await start();
    const res = await postAudio(baseUrl, false);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('audio_required');
  });

  it('POST / requires a phone on file (400 phone_required)', async () => {
    dispatchSql(queryMock, [[/SELECT phone FROM users/, rows([{ phone: null }])]]);
    const { baseUrl } = await start();
    const res = await postAudio(baseUrl);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('phone_required');
  });

  it('GET /:id polls the request state', async () => {
    svcMock.getVoiceRideRequestForUser.mockResolvedValue({ id: 'vr-1', status: 'confirmed' });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/rider/voice-rides/vr-1');
    expect(res.status).toBe(200);
    expect(svcMock.getVoiceRideRequestForUser).toHaveBeenCalledWith('vr-1', 'rider-1');
  });

  it('POST /:id/cancel cancels a pending request', async () => {
    svcMock.cancelVoiceRideRequest.mockResolvedValue({ id: 'vr-1', status: 'cancelled' });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/rider/voice-rides/vr-1/cancel');
    expect(res.status).toBe(200);
    expect(svcMock.cancelVoiceRideRequest).toHaveBeenCalledWith('vr-1', 'rider-1');
  });
});

describe('admin voice rides', () => {
  async function start() {
    handle = await startTestApp('/admin/voice-rides', adminVoiceRidesRouter, ADMIN);
    return handle;
  }

  it('GET / lists the pending queue by default', async () => {
    svcMock.listVoiceRideRequestsForAdmin.mockResolvedValue([{ id: 'vr-1' }]);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/admin/voice-rides');
    expect(res.status).toBe(200);
    expect(svcMock.listVoiceRideRequestsForAdmin).toHaveBeenCalledWith({
      status: 'pending',
      limit: 50,
    });
  });

  it('GET /poi-search proxies the query with proximity bias', async () => {
    poiSearchMock.mockResolvedValue([{ name: 'Marché Capitale' }]);
    const { baseUrl } = await start();
    const res = await api(
      baseUrl,
      'GET',
      '/admin/voice-rides/poi-search?q=marche&proximity=-15.97,18.08&limit=5',
    );
    expect(res.status).toBe(200);
    expect(poiSearchMock).toHaveBeenCalledWith('marche', { proximity: '-15.97,18.08', limit: 5 });
  });

  it('GET /poi-search rejects a 1-char query (400)', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/admin/voice-rides/poi-search?q=a');
    expect(res.status).toBe(400);
  });

  it('GET /:id returns the admin detail', async () => {
    svcMock.getVoiceRideRequestForAdmin.mockResolvedValue({ id: 'vr-1' });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/admin/voice-rides/vr-1');
    expect(res.status).toBe(200);
  });

  it('GET /:id/audio streams the memo with its mime type', async () => {
    svcMock.getVoiceRideAudio.mockResolvedValue({
      buffer: Buffer.from('audio'),
      mime: 'audio/mp4',
    });
    const { baseUrl } = await start();
    const res = await fetch(`${baseUrl}/admin/voice-rides/vr-1/audio`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('audio/mp4');
  });

  it('POST /:id/confirm creates the ride from the dispatcher pins', async () => {
    svcMock.confirmVoiceRideRequest.mockResolvedValue({ id: 'vr-1', status: 'confirmed' });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/admin/voice-rides/vr-1/confirm', {
      pickup: { lat: 18.08, lng: -15.97, label: 'Ksar' },
      dropoff: { lat: 18.1, lng: -15.95, label: 'Sebkha' },
      paymentMethod: 'cash',
    });
    expect(res.status).toBe(200);
    expect(svcMock.confirmVoiceRideRequest).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'vr-1', adminId: 'admin-1' }),
    );
  });

  it('POST /:id/confirm rejects an out-of-range pin (400)', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/admin/voice-rides/vr-1/confirm', {
      pickup: { lat: 118, lng: -15.97 },
      dropoff: { lat: 18.1, lng: -15.95 },
    });
    expect(res.status).toBe(400);
  });

  it('POST /:id/reject requires a reason', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/admin/voice-rides/vr-1/reject', {});
    expect(res.status).toBe(400);
  });

  it('POST /:id/reject rejects the request with a reason', async () => {
    svcMock.rejectVoiceRideRequest.mockResolvedValue({ id: 'vr-1', status: 'rejected' });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/admin/voice-rides/vr-1/reject', {
      reason: 'Audio inaudible',
    });
    expect(res.status).toBe(200);
    expect(svcMock.rejectVoiceRideRequest).toHaveBeenCalledWith({
      id: 'vr-1',
      adminId: 'admin-1',
      reason: 'Audio inaudible',
    });
  });
});
