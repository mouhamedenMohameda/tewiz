import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, startTestApp, type TestAppHandle } from './helpers/app.js';
import { dispatchSql, rows } from './helpers/db.js';

const {
  queryMock,
  txQueryMock,
  auditMock,
  storageGetMock,
  requiredDocsMock,
  attachAgencyMock,
  roadReportsMock,
} = vi.hoisted(() => ({
  queryMock: vi.fn(),
  txQueryMock: vi.fn(),
  auditMock: vi.fn(),
  storageGetMock: vi.fn(),
  requiredDocsMock: vi.fn(),
  attachAgencyMock: vi.fn(),
  roadReportsMock: { adminRemove: vi.fn() },
}));

vi.mock('../src/db/pool.js', () => ({
  pool: { query: queryMock, connect: vi.fn(), on: vi.fn() },
  withTx: async (fn: (client: { query: typeof txQueryMock }) => Promise<unknown>) =>
    fn({ query: txQueryMock }),
}));
vi.mock('../src/modules/admin/audit.js', () => ({ audit: auditMock }));
vi.mock('../src/modules/storage/local-disk.js', () => ({
  defaultStorage: { get: storageGetMock },
}));
vi.mock('../src/modules/admin/document-requirements.service.js', () => ({
  getRequiredDocumentTypes: requiredDocsMock,
}));
vi.mock('../src/modules/partners/partners.service.js', () => ({
  attachCaptainToAgency: attachAgencyMock,
}));
vi.mock('../src/modules/reports/road-reports.service.js', () => roadReportsMock);

// Sub-routers have dedicated test files — stub them so this file exercises
// only the routes declared directly on adminRouter (plus its RBAC gates).
vi.mock('../src/modules/admin/topup.routes.js', async () => ({
  adminTopupRouter: (await import('express')).Router(),
}));
vi.mock('../src/modules/recurring/admin.routes.js', async () => ({
  adminRecurringRouter: (await import('express')).Router(),
}));
vi.mock('../src/modules/jobs/admin-jobs.routes.js', async () => ({
  adminJobsRouter: (await import('express')).Router(),
}));
vi.mock('../src/modules/rides/admin-rides.routes.js', async () => ({
  adminRidesRouter: (await import('express')).Router(),
}));
vi.mock('../src/modules/admin/users.routes.js', async () => ({
  adminUsersRouter: (await import('express')).Router(),
}));
vi.mock('../src/modules/admin/settings.routes.js', async () => ({
  adminSettingsRouter: (await import('express')).Router(),
}));
vi.mock('../src/modules/admin/document-requirements.routes.js', async () => ({
  adminDocumentRequirementsRouter: (await import('express')).Router(),
}));
vi.mock('../src/modules/admin/stats.routes.js', async () => ({
  adminStatsRouter: (await import('express')).Router(),
}));
vi.mock('../src/modules/voice-rides/admin-voice-rides.routes.js', async () => ({
  adminVoiceRidesRouter: (await import('express')).Router(),
}));
vi.mock('../src/modules/restaurants/admin-restaurants.routes.js', async () => ({
  adminRestaurantsRouter: (await import('express')).Router(),
}));
vi.mock('../src/modules/notifications/admin.routes.js', async () => ({
  adminNotificationsRouter: (await import('express')).Router(),
}));
vi.mock('../src/modules/partners/admin-partners.routes.js', async () => ({
  adminPartnersRouter: (await import('express')).Router(),
}));

import { adminRouter } from '../src/modules/admin/admin.routes.js';
import { signAccessToken } from '../src/modules/auth/jwt.js';

type AdminRole = 'super_admin' | 'ops_manager' | 'dispatcher' | 'kyc_reviewer' | 'finance' | 'support';

function bearer(adminRole: AdminRole | null = 'super_admin', role: 'rider' | 'admin' = 'admin') {
  return {
    authorization: `Bearer ${signAccessToken({
      sub: 'admin-1',
      role,
      adminRole: adminRole as never,
      sid: 's1',
    })}`,
  };
}

let handle: TestAppHandle | null = null;

async function start() {
  handle = await startTestApp('/admin', adminRouter);
  return handle;
}

beforeEach(() => {
  queryMock.mockReset();
  txQueryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
  txQueryMock.mockResolvedValue({ rows: [], rowCount: 0 });
  auditMock.mockReset();
  auditMock.mockResolvedValue(undefined);
  storageGetMock.mockReset();
  requiredDocsMock.mockReset();
  attachAgencyMock.mockReset();
  roadReportsMock.adminRemove.mockReset();
});

afterEach(async () => {
  if (handle) await handle.close();
  handle = null;
});

describe('access control', () => {
  it('rejects unauthenticated requests (401)', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/admin/captains');
    expect(res.status).toBe(401);
  });

  it('rejects a non-admin token (403)', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/admin/captains', undefined, bearer(null, 'rider'));
    expect(res.status).toBe(403);
  });

  it('lets support VIEW applications but not act on them', async () => {
    const { baseUrl } = await start();
    const list = await api(baseUrl, 'GET', '/admin/applications', undefined, bearer('support'));
    expect(list.status).toBe(200);
    const claim = await api(
      baseUrl,
      'POST',
      '/admin/applications/app-1/claim',
      undefined,
      bearer('support'),
    );
    expect(claim.status).toBe(403);
  });
});

describe('GET /admin/captains', () => {
  it('returns the captains directory for a kyc_reviewer', async () => {
    dispatchSql(queryMock, [
      [/FROM users u/, rows([{ id: 'c1', fullName: 'Cap One', presence: 'online' }])],
    ]);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/admin/captains', undefined, bearer('kyc_reviewer'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'c1', fullName: 'Cap One', presence: 'online' }]);
  });
});

describe('applications queue', () => {
  it('GET /applications lists by status (default submitted)', async () => {
    dispatchSql(queryMock, [[/FROM captain_applications/, rows([{ id: 'app-1' }])]]);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/admin/applications', undefined, bearer());
    expect(res.status).toBe(200);
    const call = queryMock.mock.calls.find((c) => String(c[0]).includes('FROM captain_applications'));
    expect(call![1]).toEqual(['submitted', 50]);
  });

  it('GET /applications/:id returns the application with its documents', async () => {
    dispatchSql(queryMock, [
      [/SELECT \* FROM captain_applications/, rows([{ id: 'app-1', status: 'submitted' }])],
      [/FROM application_documents/, rows([{ id: 'doc-1', type: 'selfie' }])],
    ]);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/admin/applications/app-1', undefined, bearer());
    expect(res.status).toBe(200);
    expect(res.body.application.id).toBe('app-1');
    expect(res.body.documents).toHaveLength(1);
  });

  it('GET /applications/:id returns 404 when missing', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/admin/applications/nope', undefined, bearer());
    expect(res.status).toBe(404);
  });

  it('GET .../documents/:docId/file streams the stored image', async () => {
    dispatchSql(queryMock, [
      [/SELECT storage_key FROM application_documents/, rows([{ storage_key: 'k1' }])],
    ]);
    storageGetMock.mockResolvedValue(Buffer.from('jpeg-bytes'));
    const { baseUrl } = await start();

    const res = await fetch(`${baseUrl}/admin/applications/app-1/documents/doc-1/file`, {
      headers: bearer(),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/jpeg');
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('jpeg-bytes');
  });
});

describe('document review', () => {
  it('PATCH .../documents/:docId approves a document and audits it', async () => {
    dispatchSql(queryMock, [
      [/SELECT status, reject_reason/, rows([{ status: 'pending', reject_reason: null }])],
      [/UPDATE application_documents/, rows([{ id: 'doc-1', status: 'approved' }])],
    ]);
    const { baseUrl } = await start();
    const res = await api(
      baseUrl,
      'PATCH',
      '/admin/applications/app-1/documents/doc-1',
      { status: 'approved' },
      bearer('kyc_reviewer'),
    );
    expect(res.status).toBe(200);
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'document_approved' }));
  });

  it('rejecting without a rejectReason is a 400', async () => {
    const { baseUrl } = await start();
    const res = await api(
      baseUrl,
      'PATCH',
      '/admin/applications/app-1/documents/doc-1',
      { status: 'rejected' },
      bearer(),
    );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('reject_reason_required');
  });
});

describe('application transitions', () => {
  it('POST /:id/claim moves submitted → under_review', async () => {
    dispatchSql(queryMock, [
      [/UPDATE captain_applications/, rows([{ id: 'app-1', status: 'under_review' }])],
    ]);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/admin/applications/app-1/claim', undefined, bearer());
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('under_review');
  });

  it('POST /:id/claim on a non-submitted application is a 409', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/admin/applications/app-1/claim', undefined, bearer());
    expect(res.status).toBe(409);
  });

  it('POST /:id/request-corrections requires notes >= 5 chars', async () => {
    const { baseUrl } = await start();
    const res = await api(
      baseUrl,
      'POST',
      '/admin/applications/app-1/request-corrections',
      { notes: 'ab' },
      bearer(),
    );
    expect(res.status).toBe(400);
  });

  it('POST /:id/reject rejects with a reason', async () => {
    dispatchSql(queryMock, [
      [/UPDATE captain_applications/, rows([{ id: 'app-1', status: 'rejected' }])],
    ]);
    const { baseUrl } = await start();
    const res = await api(
      baseUrl,
      'POST',
      '/admin/applications/app-1/reject',
      { reason: 'Documents falsifiés' },
      bearer(),
    );
    expect(res.status).toBe(200);
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'reject_application' }));
  });
});

describe('POST /admin/applications/:id/approve', () => {
  const appRow = {
    id: 'app-1',
    status: 'submitted',
    user_id: 'user-9',
    phone: '+22245123456',
    full_name: 'Nouveau Captain',
    vehicle_type: 'car',
    accepts_colis: false,
    accepts_long_distance: false,
    vehicle_plate: '1234AB00',
    vehicle_brand: 'Toyota',
    vehicle_model: 'Corolla',
    vehicle_year: 2018,
    vehicle_color: 'Blanc',
    vehicle_seats: 4,
    agency_code: null,
  };

  it('approves a complete application and issues one-shot credentials', async () => {
    requiredDocsMock.mockResolvedValue(['selfie']);
    dispatchSql(txQueryMock, [
      [/FROM captain_applications WHERE id .* FOR UPDATE/s, rows([appRow])],
      [/SELECT type, status FROM application_documents/, rows([{ type: 'selfie', status: 'approved' }])],
      [/SELECT phone, password_hash FROM users/, rows([{ phone: '+22245123456', password_hash: null }])],
      [/SELECT captain_id FROM vehicles WHERE plate/, rows([])],
      [/UPDATE captain_applications/, rows([{ id: 'app-1', status: 'approved' }])],
    ]);
    const { baseUrl } = await start();

    const res = await api(baseUrl, 'POST', '/admin/applications/app-1/approve', undefined, bearer());
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('approved');
    // The user had no password: a fresh one must be minted and returned once.
    expect(res.body.captainPassword).toMatch(/^[A-Za-z2-9]{8}$/);

    const sqls = txQueryMock.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => s.includes("role = 'captain'"))).toBe(true);
    expect(sqls.some((s) => s.includes('INSERT INTO captains'))).toBe(true);
    expect(sqls.some((s) => s.includes('INSERT INTO vehicles'))).toBe(true);
    expect(sqls.some((s) => s.includes('INSERT INTO wallets'))).toBe(true);
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'approve_application' }));
  });

  it('refuses when a required document is missing (400)', async () => {
    requiredDocsMock.mockResolvedValue(['selfie', 'nni_front']);
    dispatchSql(txQueryMock, [
      [/FROM captain_applications WHERE id .* FOR UPDATE/s, rows([appRow])],
      [/SELECT type, status FROM application_documents/, rows([{ type: 'selfie', status: 'approved' }])],
    ]);
    const { baseUrl } = await start();

    const res = await api(baseUrl, 'POST', '/admin/applications/app-1/approve', undefined, bearer());
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('required_docs_not_ready');
    expect(res.body.error.details.missing).toEqual(['nni_front']);
  });

  it("refuses a plate already registered to another captain (409)", async () => {
    requiredDocsMock.mockResolvedValue(['selfie']);
    dispatchSql(txQueryMock, [
      [/FROM captain_applications WHERE id .* FOR UPDATE/s, rows([appRow])],
      [/SELECT type, status FROM application_documents/, rows([{ type: 'selfie', status: 'approved' }])],
      [/SELECT phone, password_hash FROM users/, rows([{ phone: '+22245123456', password_hash: 'hash' }])],
      [/SELECT captain_id FROM vehicles WHERE plate/, rows([{ captain_id: 'someone-else' }])],
    ]);
    const { baseUrl } = await start();

    const res = await api(baseUrl, 'POST', '/admin/applications/app-1/approve', undefined, bearer());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('plate_taken');
  });

  it('returns 404 for an unknown application', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/admin/applications/nope/approve', undefined, bearer());
    expect(res.status).toBe(404);
  });

  it('returns 409 when the application is already approved', async () => {
    dispatchSql(txQueryMock, [
      [/FROM captain_applications WHERE id .* FOR UPDATE/s, rows([{ ...appRow, status: 'approved' }])],
    ]);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/admin/applications/app-1/approve', undefined, bearer());
    expect(res.status).toBe(409);
  });
});

describe('DELETE /admin/road-reports/:id', () => {
  it('removes an abusive report as ops_manager', async () => {
    roadReportsMock.adminRemove.mockResolvedValue({ ok: true });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'DELETE', '/admin/road-reports/rr-1', undefined, bearer('ops_manager'));
    expect(res.status).toBe(200);
    expect(roadReportsMock.adminRemove).toHaveBeenCalledWith('rr-1');
  });

  it('is forbidden for support (403)', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'DELETE', '/admin/road-reports/rr-1', undefined, bearer('support'));
    expect(res.status).toBe(403);
  });
});
