import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, startTestApp, type TestAppHandle } from './helpers/app.js';
import { dispatchSql, rows } from './helpers/db.js';

const { queryMock, svcMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  svcMock: {
    getOrCreateDraft: vi.fn(),
    getMyApplication: vi.fn(),
    updateMyApplication: vi.fn(),
    uploadDocument: vi.fn(),
    deleteDocument: vi.fn(),
    submitApplication: vi.fn(),
  },
}));

vi.mock('../src/db/pool.js', () => ({
  pool: { query: queryMock, connect: vi.fn(), on: vi.fn() },
  withTx: vi.fn(),
}));
vi.mock('../src/modules/captain/application.service.js', () => svcMock);

// Sub-routers are exercised by their own test files — stub them out so this
// file only pulls in the /applications surface.
vi.mock('../src/modules/captain/wallet.routes.js', async () => ({
  captainWalletRouter: (await import('express')).Router(),
}));
vi.mock('../src/modules/captain/state.routes.js', async () => ({
  captainStateRouter: (await import('express')).Router(),
}));
vi.mock('../src/modules/rides/captain-rides.routes.js', async () => ({
  captainRidesRouter: (await import('express')).Router(),
}));
vi.mock('../src/modules/home/home.routes.js', async () => ({
  captainHomeRouter: (await import('express')).Router(),
}));
vi.mock('../src/modules/recurring/captain.routes.js', async () => ({
  captainRecurringRouter: (await import('express')).Router(),
}));
vi.mock('../src/modules/heatmap/heatmap.routes.js', async () => ({
  captainHeatmapRouter: (await import('express')).Router(),
}));
vi.mock('../src/modules/captain/preferences.routes.js', async () => ({
  captainPreferencesRouter: (await import('express')).Router(),
}));
vi.mock('../src/modules/captain/bonus.routes.js', async () => ({
  captainBonusRouter: (await import('express')).Router(),
}));

import { captainRouter } from '../src/modules/captain/captain.routes.js';
import { signAccessToken } from '../src/modules/auth/jwt.js';

const USER_ID = 'user-app-1';

function bearer(role: 'rider' | 'captain' | 'admin' = 'rider') {
  return {
    authorization: `Bearer ${signAccessToken({ sub: USER_ID, role, adminRole: null, sid: 's1' })}`,
  };
}

let handle: TestAppHandle | null = null;

async function start() {
  // captainRouter runs its own requireAuth, so no user injection here.
  handle = await startTestApp('/captain', captainRouter);
  return handle;
}

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
  for (const fn of Object.values(svcMock)) fn.mockReset();
});

afterEach(async () => {
  if (handle) await handle.close();
  handle = null;
});

describe('auth guards', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/captain/applications/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('no_token');
  });

  it('rejects an admin token on the application flow (403)', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/captain/applications/me', undefined, bearer('admin'));
    expect(res.status).toBe(403);
  });
});

describe('POST /captain/applications', () => {
  it('returns the current draft (or creates one)', async () => {
    svcMock.getOrCreateDraft.mockResolvedValue({ id: 'app-1', status: 'draft' });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/captain/applications', undefined, bearer());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 'app-1', status: 'draft' });
    expect(svcMock.getOrCreateDraft).toHaveBeenCalledWith(USER_ID);
  });
});

describe('GET /captain/applications/me', () => {
  it('returns null when the user never applied', async () => {
    svcMock.getMyApplication.mockResolvedValue(null);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/captain/applications/me', undefined, bearer());
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });
});

describe('PATCH /captain/applications/me', () => {
  it('updates personal and vehicle info', async () => {
    svcMock.updateMyApplication.mockResolvedValue({ id: 'app-1', fullName: 'Sidi Mohamed' });
    const { baseUrl } = await start();
    const res = await api(
      baseUrl,
      'PATCH',
      '/captain/applications/me',
      { fullName: 'Sidi Mohamed', vehiclePlate: '1234 AB 00', vehicleType: 'car' },
      bearer(),
    );
    expect(res.status).toBe(200);
    expect(svcMock.updateMyApplication).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ fullName: 'Sidi Mohamed', vehicleType: 'car' }),
    );
  });

  it('rejects a malformed NNI with 400', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'PATCH', '/captain/applications/me', { nni: 'ABC' }, bearer());
    expect(res.status).toBe(400);
  });
});

describe('POST /captain/applications/me/documents', () => {
  async function postDocument(baseUrl: string, fields: Record<string, string>, withFile = true) {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    if (withFile) {
      form.set('file', new Blob([Buffer.from('fake-image')], { type: 'image/jpeg' }), 'doc.jpg');
    }
    const res = await fetch(`${baseUrl}/captain/applications/me/documents`, {
      method: 'POST',
      headers: bearer(),
      body: form,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }

  it('uploads a document', async () => {
    svcMock.uploadDocument.mockResolvedValue({ id: 'doc-1', type: 'selfie' });
    const { baseUrl } = await start();
    const res = await postDocument(baseUrl, { type: 'selfie' });
    expect(res.status).toBe(200);
    expect(svcMock.uploadDocument).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ type: 'selfie', mimeType: 'image/jpeg' }),
    );
  });

  it('returns 400 no_file when the file part is missing', async () => {
    const { baseUrl } = await start();
    const res = await postDocument(baseUrl, { type: 'selfie' }, false);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('no_file');
  });

  it('rejects an unknown document type with 400', async () => {
    const { baseUrl } = await start();
    const res = await postDocument(baseUrl, { type: 'passport' });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /captain/applications/me/documents/:docId', () => {
  it('deletes the document', async () => {
    svcMock.deleteDocument.mockResolvedValue(undefined);
    const { baseUrl } = await start();
    const res = await api(
      baseUrl,
      'DELETE',
      '/captain/applications/me/documents/doc-9',
      undefined,
      bearer(),
    );
    expect(res.status).toBe(200);
    expect(svcMock.deleteDocument).toHaveBeenCalledWith(USER_ID, 'doc-9');
  });
});

describe('POST /captain/applications/me/submit', () => {
  it('submits the application', async () => {
    svcMock.submitApplication.mockResolvedValue({ id: 'app-1', status: 'submitted' });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/captain/applications/me/submit', undefined, bearer());
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('submitted');
  });
});

describe('credentials handoff', () => {
  it('GET /credentials returns the one-shot password when present', async () => {
    dispatchSql(queryMock, [
      [/FROM captain_applications/, rows([{ phone: '+22245123456', delivered_password: 'Abcd2345' }])],
    ]);
    const { baseUrl } = await start();
    const res = await api(
      baseUrl,
      'GET',
      '/captain/applications/me/credentials',
      undefined,
      bearer('captain'),
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ phone: '+22245123456', password: 'Abcd2345' });
  });

  it('GET /credentials returns null once consumed', async () => {
    const { baseUrl } = await start();
    const res = await api(
      baseUrl,
      'GET',
      '/captain/applications/me/credentials',
      undefined,
      bearer('captain'),
    );
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });

  it('POST /credentials/ack wipes the delivered password', async () => {
    const { baseUrl } = await start();
    const res = await api(
      baseUrl,
      'POST',
      '/captain/applications/me/credentials/ack',
      undefined,
      bearer('captain'),
    );
    expect(res.status).toBe(200);
    const wipe = queryMock.mock.calls.find((c) =>
      String(c[0]).includes('SET delivered_password = NULL'),
    );
    expect(wipe![1]).toEqual([USER_ID]);
  });
});
