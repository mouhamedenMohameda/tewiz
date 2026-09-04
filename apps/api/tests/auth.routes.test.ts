import bcrypt from 'bcryptjs';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, startTestApp, type TestAppHandle } from './helpers/app.js';
import { dispatchSql, rows } from './helpers/db.js';

const { queryMock, txQueryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  txQueryMock: vi.fn(),
}));

vi.mock('../src/db/pool.js', () => ({
  pool: { query: queryMock, connect: vi.fn(), on: vi.fn() },
  withTx: async (fn: (client: { query: typeof txQueryMock }) => Promise<unknown>) =>
    fn({ query: txQueryMock }),
}));

import { authRouter } from '../src/modules/auth/auth.routes.js';
import { signAccessToken, signRefreshToken } from '../src/modules/auth/jwt.js';

const PHONE = '+22245123456';
const USER_ID = 'a4f0c1de-0000-4000-8000-000000000001';

let passwordHash: string;
let handle: TestAppHandle | null = null;

function bearer(id = USER_ID, role: 'rider' | 'captain' | 'admin' = 'rider') {
  return {
    authorization: `Bearer ${signAccessToken({ sub: id, role, adminRole: null, sid: 'sid-1' })}`,
  };
}

async function start() {
  handle = await startTestApp('/auth', authRouter);
  return handle;
}

beforeAll(async () => {
  passwordHash = await bcrypt.hash('Secret42', 4);
});

beforeEach(() => {
  queryMock.mockReset();
  txQueryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
  txQueryMock.mockResolvedValue({ rows: [], rowCount: 0 });
});

afterEach(async () => {
  if (handle) await handle.close();
  handle = null;
});

const userRow = {
  id: USER_ID,
  phone: PHONE,
  role: 'rider',
  admin_role: null,
  full_name: 'Test Rider',
  language: 'fr',
  // Login now guards on account status (403 account_suspended for anything
  // other than 'active'); the happy-path fixture must be active.
  status: 'active',
  password_hash: null as string | null,
  must_reset_password: false,
  is_guest: false,
};

describe('POST /auth/login', () => {
  it('returns user + tokens on valid credentials', async () => {
    dispatchSql(queryMock, [
      [/FROM login_attempts/, rows([{ count: '0' }])],
      [/FROM users WHERE phone/, rows([{ ...userRow, password_hash: passwordHash }])],
    ]);
    const { baseUrl } = await start();

    const res = await api(baseUrl, 'POST', '/auth/login', {
      phone: '45123456',
      password: 'Secret42',
      role: 'rider',
      deviceId: 'device-123456',
    });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: USER_ID, phone: PHONE, role: 'rider' });
    expect(res.body.tokens.accessToken).toBeTruthy();
    expect(res.body.tokens.refreshToken).toBeTruthy();
    // A session row must have been inserted.
    const sqls = queryMock.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => s.includes('INSERT INTO sessions'))).toBe(true);
  });

  it('accepts a password with trailing whitespace (trim fallback)', async () => {
    dispatchSql(queryMock, [
      [/FROM login_attempts/, rows([{ count: '0' }])],
      [/FROM users WHERE phone/, rows([{ ...userRow, password_hash: passwordHash }])],
    ]);
    const { baseUrl } = await start();

    const res = await api(baseUrl, 'POST', '/auth/login', {
      phone: PHONE,
      password: 'Secret42 ',
      role: 'rider',
      deviceId: 'device-123456',
    });
    expect(res.status).toBe(200);
  });

  it('logs a rider in even with no password and none set — riders have no password gate', async () => {
    dispatchSql(queryMock, [
      [/FROM login_attempts/, rows([{ count: '0' }])],
      [/FROM users WHERE phone/, rows([{ ...userRow, password_hash: null }])],
    ]);
    const { baseUrl } = await start();

    const res = await api(baseUrl, 'POST', '/auth/login', {
      phone: PHONE,
      role: 'rider',
      deviceId: 'device-123456',
    });
    expect(res.status).toBe(200);
    expect(res.body.tokens.accessToken).toBeTruthy();
  });

  it('rejects a captain with a wrong password with 401 invalid_credentials', async () => {
    dispatchSql(queryMock, [
      [/FROM login_attempts/, rows([{ count: '0' }])],
      [/FROM users WHERE phone/, rows([{ ...userRow, role: 'captain', password_hash: passwordHash }])],
    ]);
    const { baseUrl } = await start();

    const res = await api(baseUrl, 'POST', '/auth/login', {
      phone: PHONE,
      password: 'WrongPass',
      role: 'rider',
      deviceId: 'device-123456',
    });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('invalid_credentials');
  });

  it('rejects an unknown phone with the same 401 (no account enumeration)', async () => {
    dispatchSql(queryMock, [
      [/FROM login_attempts/, rows([{ count: '0' }])],
      [/FROM users WHERE phone/, rows([])],
    ]);
    const { baseUrl } = await start();

    const res = await api(baseUrl, 'POST', '/auth/login', {
      phone: PHONE,
      password: 'Secret42',
      role: 'rider',
      deviceId: 'device-123456',
    });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('invalid_credentials');
  });

  it('returns 403 no_password_set when a captain has no password yet', async () => {
    dispatchSql(queryMock, [
      [/FROM login_attempts/, rows([{ count: '0' }])],
      [/FROM users WHERE phone/, rows([{ ...userRow, role: 'captain', password_hash: null }])],
    ]);
    const { baseUrl } = await start();

    const res = await api(baseUrl, 'POST', '/auth/login', {
      phone: PHONE,
      password: 'Secret42',
      role: 'rider',
      deviceId: 'device-123456',
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('no_password_set');
  });

  it('returns 403 role_mismatch when a rider signs in as admin', async () => {
    dispatchSql(queryMock, [
      [/FROM login_attempts/, rows([{ count: '0' }])],
      [/FROM users WHERE phone/, rows([{ ...userRow, password_hash: passwordHash }])],
    ]);
    const { baseUrl } = await start();

    const res = await api(baseUrl, 'POST', '/auth/login', {
      phone: PHONE,
      password: 'Secret42',
      role: 'admin',
      deviceId: 'device-123456',
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('role_mismatch');
  });

  it('returns 403 role_mismatch when an admin signs in via the rider app', async () => {
    dispatchSql(queryMock, [
      [/FROM login_attempts/, rows([{ count: '0' }])],
      [
        /FROM users WHERE phone/,
        rows([{ ...userRow, role: 'admin', admin_role: 'super_admin', password_hash: passwordHash }]),
      ],
    ]);
    const { baseUrl } = await start();

    const res = await api(baseUrl, 'POST', '/auth/login', {
      phone: PHONE,
      password: 'Secret42',
      role: 'rider',
      deviceId: 'device-123456',
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('role_mismatch');
  });

  it('returns 429 after too many failed attempts', async () => {
    dispatchSql(queryMock, [[/FROM login_attempts/, rows([{ count: '5' }])]]);
    const { baseUrl } = await start();

    const res = await api(baseUrl, 'POST', '/auth/login', {
      phone: PHONE,
      password: 'Secret42',
      role: 'rider',
      deviceId: 'device-123456',
    });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('too_many_attempts');
  });

  it('returns 400 validation_error on an invalid phone', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/auth/login', {
      phone: '12345',
      password: 'Secret42',
      role: 'rider',
      deviceId: 'device-123456',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });
});

describe('POST /auth/guest', () => {
  it('creates an anonymous rider and returns 201 with tokens', async () => {
    dispatchSql(queryMock, [
      [/INSERT INTO users/, rows([{ id: USER_ID, role: 'rider' }])],
    ]);
    const { baseUrl } = await start();

    const res = await api(baseUrl, 'POST', '/auth/guest', { deviceId: 'device-123456' });

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ id: USER_ID, role: 'rider', isGuest: true, phone: null });
    expect(res.body.tokens.accessToken).toBeTruthy();
  });

  it('rejects a missing deviceId with 400', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/auth/guest', {});
    expect(res.status).toBe(400);
  });
});

describe('POST /auth/me/phone', () => {
  it('requires authentication', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/auth/me/phone', { phone: PHONE });
    expect(res.status).toBe(401);
  });

  it('returns 409 when the phone belongs to a captain/admin account (still needs real credentials)', async () => {
    dispatchSql(queryMock, [
      [/SELECT id, role, status FROM users WHERE phone/, rows([{ id: 'other-user', role: 'captain', status: 'active' }])],
    ]);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/auth/me/phone', { phone: PHONE }, bearer());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('phone_taken');
  });

  it('resumes an existing rider account instead of erroring — riders have no password', async () => {
    dispatchSql(queryMock, [
      [/SELECT id, role, status FROM users WHERE phone/, rows([{ id: 'other-user', role: 'rider', status: 'active' }])],
      [/FROM users WHERE id = \$1/, rows([{ ...userRow, id: 'other-user' }])],
    ]);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/auth/me/phone', { phone: PHONE, deviceId: 'device-123456' }, bearer());
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('other-user');
    expect(res.body.tokens.accessToken).toBeTruthy();
  });

  it('refuses to resume a suspended rider account with 403', async () => {
    dispatchSql(queryMock, [
      [/SELECT id, role, status FROM users WHERE phone/, rows([{ id: 'other-user', role: 'rider', status: 'suspended' }])],
    ]);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/auth/me/phone', { phone: PHONE }, bearer());
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('account_suspended');
  });

  it('sets the phone and returns the updated user', async () => {
    dispatchSql(queryMock, [
      [/SELECT id, role, status FROM users WHERE phone/, rows([])],
      [/UPDATE users SET phone/, rows([{ ...userRow }])],
    ]);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/auth/me/phone', { phone: '45123456' }, bearer());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: USER_ID, phone: PHONE });
  });
});

describe('POST /auth/refresh', () => {
  it('rotates the access token for a valid session', async () => {
    const refreshToken = signRefreshToken({ sub: USER_ID, sid: 'sid-1' });
    const refreshHash = await bcrypt.hash(refreshToken, 4);
    dispatchSql(queryMock, [
      [/FROM sessions WHERE id/, rows([{ refresh_token_hash: refreshHash, revoked_at: null }])],
      [/FROM users WHERE id/, rows([{ ...userRow }])],
    ]);
    const { baseUrl } = await start();

    const res = await api(baseUrl, 'POST', '/auth/refresh', { refreshToken });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
  });

  it('rejects a garbage refresh token with 401', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/auth/refresh', { refreshToken: 'not-a-jwt' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('invalid_refresh');
  });

  it('rejects a revoked session with 401', async () => {
    const refreshToken = signRefreshToken({ sub: USER_ID, sid: 'sid-1' });
    dispatchSql(queryMock, [
      [/FROM sessions WHERE id/, rows([{ refresh_token_hash: 'x', revoked_at: new Date() }])],
    ]);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/auth/refresh', { refreshToken });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('session_revoked');
  });
});

describe('POST /auth/logout', () => {
  it('always answers ok even without a refresh token', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/auth/logout', {});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('revokes the session when a valid refresh token is provided', async () => {
    const refreshToken = signRefreshToken({ sub: USER_ID, sid: 'sid-9' });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/auth/logout', { refreshToken });
    expect(res.status).toBe(200);
    const revoke = queryMock.mock.calls.find((c) => String(c[0]).includes('SET revoked_at'));
    expect(revoke).toBeTruthy();
    expect(revoke![1]).toEqual(['sid-9']);
  });
});

describe('push tokens', () => {
  it('POST /auth/push-token upserts the token', async () => {
    const { baseUrl } = await start();
    const res = await api(
      baseUrl,
      'POST',
      '/auth/push-token',
      { deviceId: 'device-123456', token: 'ExponentPushToken[abc]', platform: 'ios' },
      bearer(),
    );
    expect(res.status).toBe(200);
    const upsert = queryMock.mock.calls.find((c) => String(c[0]).includes('INSERT INTO push_tokens'));
    expect(upsert![1]).toEqual([USER_ID, 'device-123456', 'ExponentPushToken[abc]', 'ios']);
  });

  it('DELETE /auth/push-token removes the token', async () => {
    const { baseUrl } = await start();
    const res = await api(
      baseUrl,
      'DELETE',
      '/auth/push-token',
      { deviceId: 'device-123456' },
      bearer(),
    );
    expect(res.status).toBe(200);
    const del = queryMock.mock.calls.find((c) => String(c[0]).includes('DELETE FROM push_tokens'));
    expect(del![1]).toEqual([USER_ID, 'device-123456']);
  });

  it('rejects unauthenticated push-token calls', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/auth/push-token', {
      deviceId: 'device-123456',
      token: 'tok-1234567890',
      platform: 'ios',
    });
    expect(res.status).toBe(401);
  });
});

describe('GET /auth/me', () => {
  it('returns the fresh user record', async () => {
    dispatchSql(queryMock, [[/FROM users WHERE id/, rows([{ ...userRow }])]]);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/auth/me', undefined, bearer());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: USER_ID, phone: PHONE, role: 'rider', fullName: 'Test Rider' });
  });

  it('returns 401 when the user row is gone', async () => {
    dispatchSql(queryMock, [[/FROM users WHERE id/, rows([])]]);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/auth/me', undefined, bearer());
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('user_missing');
  });

  it('returns 401 without a token', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('no_token');
  });
});

describe('PATCH /auth/me', () => {
  it('updates the full name', async () => {
    dispatchSql(queryMock, [
      [/UPDATE users SET full_name/, rows([{ ...userRow, full_name: 'New Name' }])],
    ]);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'PATCH', '/auth/me', { fullName: 'New Name' }, bearer());
    expect(res.status).toBe(200);
    expect(res.body.fullName).toBe('New Name');
  });

  it('returns the current record when the body is empty', async () => {
    dispatchSql(queryMock, [[/FROM users WHERE id/, rows([{ ...userRow }])]]);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'PATCH', '/auth/me', {}, bearer());
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(USER_ID);
  });

  it('rejects an unsupported language with 400', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'PATCH', '/auth/me', { language: 'de' }, bearer());
    expect(res.status).toBe(400);
  });
});

describe('DELETE /auth/me', () => {
  it('soft-deletes the account, revokes sessions and drops push tokens', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'DELETE', '/auth/me', undefined, bearer());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const sqls = txQueryMock.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => s.includes("status = 'deleted'"))).toBe(true);
    expect(sqls.some((s) => s.includes('UPDATE sessions SET revoked_at'))).toBe(true);
    expect(sqls.some((s) => s.includes('DELETE FROM push_tokens'))).toBe(true);
  });
});
