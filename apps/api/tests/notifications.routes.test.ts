import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, startTestApp, type TestAppHandle } from './helpers/app.js';

const { svcMock } = vi.hoisted(() => ({
  svcMock: {
    getInboxForUser: vi.fn(),
    markRead: vi.fn(),
    markAllRead: vi.fn(),
    sendNotification: vi.fn(),
    listCampaigns: vi.fn(),
  },
}));

vi.mock('../src/modules/notifications/notifications.service.js', () => svcMock);

import { userNotificationsRouter } from '../src/modules/notifications/user.routes.js';
import { adminNotificationsRouter } from '../src/modules/notifications/admin.routes.js';
import { signAccessToken } from '../src/modules/auth/jwt.js';

function bearer(id = 'user-1') {
  return {
    authorization: `Bearer ${signAccessToken({ sub: id, role: 'rider', adminRole: null, sid: 's1' })}`,
  };
}

let handle: TestAppHandle | null = null;

beforeEach(() => {
  for (const fn of Object.values(svcMock)) fn.mockReset();
});

afterEach(async () => {
  if (handle) await handle.close();
  handle = null;
});

describe('user inbox (/notifications)', () => {
  async function start() {
    handle = await startTestApp('/notifications', userNotificationsRouter);
    return handle;
  }

  it('requires authentication (401)', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/notifications');
    expect(res.status).toBe(401);
  });

  it('GET / returns the inbox with pagination', async () => {
    svcMock.getInboxForUser.mockResolvedValue({ items: [{ id: 'n1' }], unread: 1 });
    const { baseUrl } = await start();
    const res = await api(
      baseUrl,
      'GET',
      '/notifications?limit=20&before=2026-07-01T00:00:00.000Z',
      undefined,
      bearer(),
    );
    expect(res.status).toBe(200);
    expect(svcMock.getInboxForUser).toHaveBeenCalledWith('user-1', {
      limit: 20,
      before: '2026-07-01T00:00:00.000Z',
    });
  });

  it('POST /:id/read marks one notification as read', async () => {
    svcMock.markRead.mockResolvedValue(true);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/notifications/n1/read', undefined, bearer());
    expect(res.status).toBe(200);
    expect(svcMock.markRead).toHaveBeenCalledWith('n1', 'user-1');
  });

  it("POST /:id/read returns 404 for someone else's notification", async () => {
    svcMock.markRead.mockResolvedValue(false);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/notifications/n1/read', undefined, bearer());
    expect(res.status).toBe(404);
  });

  it('POST /read-all reports the updated count', async () => {
    svcMock.markAllRead.mockResolvedValue(7);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/notifications/read-all', undefined, bearer());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ updated: 7 });
  });
});

describe('admin campaigns (/admin/notifications)', () => {
  const ADMIN = { id: 'admin-1', role: 'admin' as const, adminRole: 'ops_manager' };

  async function start() {
    handle = await startTestApp('/admin/notifications', adminNotificationsRouter, ADMIN);
    return handle;
  }

  it('POST / broadcasts to all captains', async () => {
    svcMock.sendNotification.mockResolvedValue({ sent: 42 });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/admin/notifications', {
      target: { type: 'all_captains' },
      title: 'Maintenance',
      body: 'Le service sera interrompu à 22h.',
    });
    expect(res.status).toBe(200);
    expect(svcMock.sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { type: 'all_captains' },
        title: 'Maintenance',
        sentBy: 'admin-1',
      }),
    );
  });

  it('POST / targets a single user by uuid', async () => {
    svcMock.sendNotification.mockResolvedValue({ sent: 1 });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/admin/notifications', {
      target: { type: 'user', userId: '5f1e7a10-1111-4222-8333-444455556666' },
      title: 'Bonus',
      body: 'Votre bonus est actif.',
    });
    expect(res.status).toBe(200);
  });

  it('POST / rejects an invalid target shape (400)', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/admin/notifications', {
      target: { type: 'user' }, // missing userId
      title: 'x',
      body: 'y',
    });
    expect(res.status).toBe(400);
    expect(svcMock.sendNotification).not.toHaveBeenCalled();
  });

  it('GET / lists past campaigns', async () => {
    svcMock.listCampaigns.mockResolvedValue([{ id: 'c1' }]);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/admin/notifications?limit=10');
    expect(res.status).toBe(200);
    expect(svcMock.listCampaigns).toHaveBeenCalledWith({ limit: 10 });
  });
});
