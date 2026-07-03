import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, startTestApp, type TestAppHandle } from './helpers/app.js';
import { dispatchSql, rows } from './helpers/db.js';

const { queryMock, auditMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  auditMock: vi.fn(),
}));

vi.mock('../src/db/pool.js', () => ({
  pool: { query: queryMock, connect: vi.fn(), on: vi.fn() },
  withTx: vi.fn(),
}));
vi.mock('../src/modules/admin/audit.js', () => ({ audit: auditMock }));

import { adminUsersRouter } from '../src/modules/admin/users.routes.js';

const UUID = '5f1e7a10-1111-4222-8333-444455556666';

let handle: TestAppHandle | null = null;

async function start(adminRole: string = 'super_admin') {
  handle = await startTestApp('/admin/users', adminUsersRouter, {
    id: 'admin-1',
    role: 'admin',
    adminRole,
  });
  return handle;
}

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
  auditMock.mockReset();
  auditMock.mockResolvedValue(undefined);
});

afterEach(async () => {
  if (handle) await handle.close();
  handle = null;
});

describe('GET /admin/users', () => {
  it('returns the paged directory with counts', async () => {
    dispatchSql(queryMock, [
      [/COUNT\(\*\) AS count/, rows([{ count: '12', online: '3' }])],
      [/FROM users/, rows([{ id: 'u1', phone: '+22245123456', role: 'rider' }])],
    ]);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/admin/users?role=rider&limit=25&offset=0');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 12, onlineCount: 3, limit: 25, offset: 0 });
    expect(res.body.users).toHaveLength(1);
    const list = queryMock.mock.calls.find((c) => /SELECT id, phone/.test(String(c[0])));
    expect(list![1]).toEqual(['rider', 25, 0]);
  });

  it('rejects an unknown role filter (400)', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/admin/users?role=ghost');
    expect(res.status).toBe(400);
  });
});

describe('POST /admin/users', () => {
  const body = { phone: '45123456', role: 'rider', fullName: 'Fatimetou Mint Ahmed' };

  it('creates a user and returns the one-shot password + WhatsApp link', async () => {
    dispatchSql(queryMock, [
      [/SELECT id FROM users WHERE phone/, rows([])],
      [/INSERT INTO users/, rows([{ id: UUID }])],
    ]);
    const { baseUrl } = await start('ops_manager');
    const res = await api(baseUrl, 'POST', '/admin/users', body);
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ id: UUID, phone: '+22245123456', role: 'rider' });
    expect(res.body.password).toMatch(/^[A-Za-z2-9]{8}$/);
    expect(res.body.whatsappLink).toContain('https://wa.me/22245123456');
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'user.create' }));
  });

  it('rejects a duplicate phone with 409', async () => {
    dispatchSql(queryMock, [[/SELECT id FROM users WHERE phone/, rows([{ id: 'existing' }])]]);
    const { baseUrl } = await start('ops_manager');
    const res = await api(baseUrl, 'POST', '/admin/users', body);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('phone_already_exists');
  });

  it('forbids an ops_manager from creating an admin (403)', async () => {
    const { baseUrl } = await start('ops_manager');
    const res = await api(baseUrl, 'POST', '/admin/users', {
      ...body,
      role: 'admin',
      adminRole: 'support',
    });
    expect(res.status).toBe(403);
  });

  it('lets a super_admin create an admin with a sub-role', async () => {
    dispatchSql(queryMock, [
      [/SELECT id FROM users WHERE phone/, rows([])],
      [/INSERT INTO users/, rows([{ id: UUID }])],
    ]);
    const { baseUrl } = await start('super_admin');
    const res = await api(baseUrl, 'POST', '/admin/users', {
      ...body,
      role: 'admin',
      adminRole: 'dispatcher',
    });
    expect(res.status).toBe(201);
    expect(res.body.user.adminRole).toBe('dispatcher');
  });

  it('rejects role=admin without adminRole (400)', async () => {
    const { baseUrl } = await start('super_admin');
    const res = await api(baseUrl, 'POST', '/admin/users', { ...body, role: 'admin' });
    expect(res.status).toBe(400);
  });
});

describe('POST /admin/users/:id/regenerate-password', () => {
  it('rotates the password and revokes every session', async () => {
    dispatchSql(queryMock, [
      [/SELECT phone, full_name, role FROM users/, rows([{ phone: '+22245123456', full_name: 'X', role: 'rider' }])],
    ]);
    const { baseUrl } = await start('ops_manager');
    const res = await api(baseUrl, 'POST', `/admin/users/${UUID}/regenerate-password`);
    expect(res.status).toBe(200);
    expect(res.body.password).toMatch(/^[A-Za-z2-9]{8}$/);
    const sqls = queryMock.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => s.includes('SET password_hash'))).toBe(true);
    expect(sqls.some((s) => s.includes('UPDATE sessions SET revoked_at'))).toBe(true);
  });

  it('returns 404 for an unknown user', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', `/admin/users/${UUID}/regenerate-password`);
    expect(res.status).toBe(404);
  });

  it("forbids an ops_manager from rotating an admin's password (403)", async () => {
    dispatchSql(queryMock, [
      [/SELECT phone, full_name, role FROM users/, rows([{ phone: '+22245', full_name: 'A', role: 'admin' }])],
    ]);
    const { baseUrl } = await start('ops_manager');
    const res = await api(baseUrl, 'POST', `/admin/users/${UUID}/regenerate-password`);
    expect(res.status).toBe(403);
  });

  it('rejects a non-uuid id (400)', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/admin/users/not-a-uuid/regenerate-password');
    expect(res.status).toBe(400);
  });
});

describe('PATCH /admin/users/:id/admin-role', () => {
  it('is super_admin only (403 for ops_manager)', async () => {
    const { baseUrl } = await start('ops_manager');
    const res = await api(baseUrl, 'PATCH', `/admin/users/${UUID}/admin-role`, {
      adminRole: 'support',
    });
    expect(res.status).toBe(403);
  });

  it('returns 400 when the target is not an admin', async () => {
    dispatchSql(queryMock, [
      [/SELECT role, admin_role FROM users/, rows([{ role: 'rider', admin_role: null }])],
    ]);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'PATCH', `/admin/users/${UUID}/admin-role`, {
      adminRole: 'support',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('not_admin');
  });

  it('refuses to demote the last active super_admin (409)', async () => {
    dispatchSql(queryMock, [
      [/SELECT role, admin_role FROM users/, rows([{ role: 'admin', admin_role: 'super_admin' }])],
      [/COUNT\(\*\)::text AS count/, rows([{ count: '1' }])],
    ]);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'PATCH', `/admin/users/${UUID}/admin-role`, {
      adminRole: 'support',
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('last_super_admin');
  });

  it('reassigns the sub-role and audits it', async () => {
    dispatchSql(queryMock, [
      [/SELECT role, admin_role FROM users/, rows([{ role: 'admin', admin_role: 'dispatcher' }])],
    ]);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'PATCH', `/admin/users/${UUID}/admin-role`, {
      adminRole: 'finance',
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, userId: UUID, adminRole: 'finance' });
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'user.admin_role.update' }),
    );
  });

  it('is a no-op when the role is unchanged', async () => {
    dispatchSql(queryMock, [
      [/SELECT role, admin_role FROM users/, rows([{ role: 'admin', admin_role: 'finance' }])],
    ]);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'PATCH', `/admin/users/${UUID}/admin-role`, {
      adminRole: 'finance',
    });
    expect(res.status).toBe(200);
    expect(auditMock).not.toHaveBeenCalled();
  });
});
