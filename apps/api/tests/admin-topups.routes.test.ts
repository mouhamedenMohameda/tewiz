import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, startTestApp, type TestAppHandle } from './helpers/app.js';

const { topupSvcMock, auditMock, storageGetMock } = vi.hoisted(() => ({
  topupSvcMock: {
    listTopupsForAdmin: vi.fn(),
    getTopupForAdmin: vi.fn(),
    getTopupScreenshotKey: vi.fn(),
    approveTopup: vi.fn(),
    rejectTopup: vi.fn(),
  },
  auditMock: vi.fn(),
  storageGetMock: vi.fn(),
}));

vi.mock('../src/modules/wallet/topup.service.js', () => topupSvcMock);
vi.mock('../src/modules/admin/audit.js', () => ({ audit: auditMock }));
vi.mock('../src/modules/storage/local-disk.js', () => ({
  defaultStorage: { get: storageGetMock },
}));

import { adminTopupRouter } from '../src/modules/admin/topup.routes.js';

const ADMIN = { id: 'admin-1', role: 'admin' as const, adminRole: 'finance' };
let handle: TestAppHandle | null = null;

async function start() {
  handle = await startTestApp('/admin/topups', adminTopupRouter, ADMIN);
  return handle;
}

beforeEach(() => {
  for (const fn of Object.values(topupSvcMock)) fn.mockReset();
  auditMock.mockReset();
  auditMock.mockResolvedValue(undefined);
  storageGetMock.mockReset();
});

afterEach(async () => {
  if (handle) await handle.close();
  handle = null;
});

describe('GET /admin/topups', () => {
  it('lists pending topups by default', async () => {
    topupSvcMock.listTopupsForAdmin.mockResolvedValue([{ id: 't1' }]);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/admin/topups');
    expect(res.status).toBe(200);
    expect(topupSvcMock.listTopupsForAdmin).toHaveBeenCalledWith({ status: 'pending', limit: 50 });
  });

  it('filters by status', async () => {
    topupSvcMock.listTopupsForAdmin.mockResolvedValue([]);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/admin/topups?status=rejected&limit=10');
    expect(res.status).toBe(200);
    expect(topupSvcMock.listTopupsForAdmin).toHaveBeenCalledWith({ status: 'rejected', limit: 10 });
  });

  it('rejects an unknown status (400)', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/admin/topups?status=weird');
    expect(res.status).toBe(400);
  });
});

describe('GET /admin/topups/:id', () => {
  it('returns the topup detail', async () => {
    topupSvcMock.getTopupForAdmin.mockResolvedValue({ id: 't1', status: 'pending' });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/admin/topups/t1');
    expect(res.status).toBe(200);
    expect(topupSvcMock.getTopupForAdmin).toHaveBeenCalledWith('t1');
  });
});

describe('GET /admin/topups/:id/screenshot', () => {
  it('streams the proof image', async () => {
    topupSvcMock.getTopupScreenshotKey.mockResolvedValue('screens/t1.jpg');
    storageGetMock.mockResolvedValue(Buffer.from('img'));
    const { baseUrl } = await start();
    const res = await fetch(`${baseUrl}/admin/topups/t1/screenshot`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/jpeg');
    expect(storageGetMock).toHaveBeenCalledWith('screens/t1.jpg');
  });
});

describe('POST /admin/topups/:id/approve', () => {
  it('approves the full amount', async () => {
    topupSvcMock.approveTopup.mockResolvedValue({ topup: { id: 't1', status: 'approved' } });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/admin/topups/t1/approve', {});
    expect(res.status).toBe(200);
    expect(topupSvcMock.approveTopup).toHaveBeenCalledWith(
      expect.objectContaining({ adminId: 'admin-1', topupId: 't1' }),
    );
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'approve_topup' }));
  });

  it('logs a partial approval under its own audit action', async () => {
    topupSvcMock.approveTopup.mockResolvedValue({ topup: { id: 't1', status: 'partial' } });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/admin/topups/t1/approve', { approvedAmountMru: 300 });
    expect(res.status).toBe(200);
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'partial_approve_topup' }),
    );
  });

  it('rejects a zero amount (400)', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/admin/topups/t1/approve', { approvedAmountMru: 0 });
    expect(res.status).toBe(400);
  });
});

describe('POST /admin/topups/:id/reject', () => {
  it('rejects with a reason', async () => {
    topupSvcMock.rejectTopup.mockResolvedValue({ id: 't1', status: 'rejected' });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/admin/topups/t1/reject', {
      reason: 'Capture illisible',
    });
    expect(res.status).toBe(200);
    expect(topupSvcMock.rejectTopup).toHaveBeenCalledWith({
      adminId: 'admin-1',
      topupId: 't1',
      reason: 'Capture illisible',
    });
  });

  it('requires a reason (400)', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/admin/topups/t1/reject', {});
    expect(res.status).toBe(400);
  });
});
