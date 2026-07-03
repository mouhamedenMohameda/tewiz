import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, startTestApp, type TestAppHandle } from './helpers/app.js';
import { dispatchSql, rows } from './helpers/db.js';

const { queryMock, getBalanceMock, goingHomeMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  getBalanceMock: vi.fn(),
  goingHomeMock: {
    startSession: vi.fn(),
    endSession: vi.fn(),
    getActiveSession: vi.fn(),
    resetSessions: vi.fn(),
  },
}));

vi.mock('../src/db/pool.js', () => ({
  pool: { query: queryMock, connect: vi.fn(), on: vi.fn() },
  withTx: vi.fn(),
}));
vi.mock('../src/modules/wallet/wallet.service.js', () => ({ getBalance: getBalanceMock }));
vi.mock('../src/modules/home/going-home.service.js', () => goingHomeMock);

import { captainStateRouter } from '../src/modules/captain/state.routes.js';

const CAPTAIN = { id: 'captain-1', role: 'captain' as const };
let handle: TestAppHandle | null = null;

async function start() {
  handle = await startTestApp('/captain/state', captainStateRouter, CAPTAIN);
  return handle;
}

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
  getBalanceMock.mockReset();
  for (const fn of Object.values(goingHomeMock)) fn.mockReset();
});

afterEach(async () => {
  if (handle) await handle.close();
  handle = null;
});

describe('POST /captain/state/online', () => {
  function activeCaptainWith(presence: string | null) {
    dispatchSql(queryMock, [
      [/SELECT status FROM captains/, rows([{ status: 'active' }])],
      [/SELECT presence FROM captain_state/, presence ? rows([{ presence }]) : rows([])],
      [/INSERT INTO captain_state/, rows([{ captain_id: 'captain-1', presence: 'online' }])],
    ]);
  }

  it('goes online with a location and returns the balance', async () => {
    activeCaptainWith('offline');
    getBalanceMock.mockResolvedValue(150);
    const { baseUrl } = await start();

    const res = await api(baseUrl, 'POST', '/captain/state/online', { lat: 18.08, lng: -15.97 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ presence: 'online', balanceMru: 150 });
    const insert = queryMock.mock.calls.find((c) => String(c[0]).includes('INSERT INTO captain_state'));
    expect(insert![1]).toEqual(['captain-1', -15.97, 18.08]);
  });

  it('returns 404 when the user is not a captain', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/captain/state/online', {});
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_captain');
  });

  it('returns 403 when the captain is suspended', async () => {
    dispatchSql(queryMock, [[/SELECT status FROM captains/, rows([{ status: 'suspended' }])]]);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/captain/state/online', {});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('captain_suspended');
  });

  it('returns 402 when the balance is below the go-online floor', async () => {
    dispatchSql(queryMock, [[/SELECT status FROM captains/, rows([{ status: 'active' }])]]);
    getBalanceMock.mockResolvedValue(0);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/captain/state/online', {});
    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe('balance_too_low');
  });

  it('returns 409 while on a ride', async () => {
    activeCaptainWith('on_ride');
    getBalanceMock.mockResolvedValue(150);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/captain/state/online', {});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('on_ride');
  });
});

describe('POST /captain/state/offline', () => {
  it('goes offline', async () => {
    dispatchSql(queryMock, [
      [/SELECT presence FROM captain_state/, rows([{ presence: 'online' }])],
      [/UPDATE captain_state/, rows([{ captain_id: 'captain-1', presence: 'offline' }])],
    ]);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/captain/state/offline');
    expect(res.status).toBe(200);
    expect(res.body.presence).toBe('offline');
  });

  it('refuses while on a ride (409)', async () => {
    dispatchSql(queryMock, [
      [/SELECT presence FROM captain_state/, rows([{ presence: 'on_ride' }])],
    ]);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/captain/state/offline');
    expect(res.status).toBe(409);
  });

  it('returns 404 without a state row', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/captain/state/offline');
    expect(res.status).toBe(404);
  });
});

describe('GET /captain/state', () => {
  it('returns the current presence and location', async () => {
    dispatchSql(queryMock, [
      [/FROM captain_state/, rows([{ presence: 'online', lat: 18.08, lng: -15.97 }])],
    ]);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/captain/state');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ presence: 'online', lat: 18.08 });
  });

  it('returns 404 without a state row', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/captain/state');
    expect(res.status).toBe(404);
  });
});

describe('going-home sessions', () => {
  it('POST /going-home starts a session', async () => {
    goingHomeMock.startSession.mockResolvedValue({ id: 'gh-1', active: true });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/captain/state/going-home');
    expect(res.status).toBe(200);
    expect(goingHomeMock.startSession).toHaveBeenCalledWith('captain-1');
  });

  it('DELETE /going-home cancels the active session', async () => {
    goingHomeMock.endSession.mockResolvedValue({ id: 'gh-1', active: false });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'DELETE', '/captain/state/going-home');
    expect(res.status).toBe(200);
    expect(goingHomeMock.endSession).toHaveBeenCalledWith({
      captainId: 'captain-1',
      reason: 'cancelled',
    });
  });

  it('GET /going-home returns 204 without an active session', async () => {
    goingHomeMock.getActiveSession.mockResolvedValue(null);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/captain/state/going-home');
    expect(res.status).toBe(204);
  });

  it('GET /going-home returns the active session', async () => {
    goingHomeMock.getActiveSession.mockResolvedValue({ id: 'gh-2' });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/captain/state/going-home');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('gh-2');
  });

  it('DELETE /going-home/reset wipes the history (204)', async () => {
    goingHomeMock.resetSessions.mockResolvedValue(undefined);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'DELETE', '/captain/state/going-home/reset');
    expect(res.status).toBe(204);
    expect(goingHomeMock.resetSessions).toHaveBeenCalledWith('captain-1');
  });
});
