import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, startTestApp, type TestAppHandle } from './helpers/app.js';
import { dispatchSql, rows } from './helpers/db.js';

const {
  queryMock, getBalanceMock, goingHomeMock, liveLocationMock, trackMock, onboardingMock,
} = vi.hoisted(() => ({
  onboardingMock: vi.fn(),
  queryMock: vi.fn(),
  getBalanceMock: vi.fn(),
  goingHomeMock: {
    startSession: vi.fn(),
    endSession: vi.fn(),
    getActiveSession: vi.fn(),
    resetSessions: vi.fn(),
  },
  // Mocked so the suite never opens a real Redis connection — CI has no Redis,
  // and the module's own behaviour is covered in live-location.test.ts. What
  // matters here is only that the routes mirror to it at the right moments.
  liveLocationMock: {
    setLiveLocation: vi.fn(),
    clearLiveLocation: vi.fn(),
  },
  trackMock: {
    ingestTrackBatch: vi.fn(),
    isTrackingEnabled: vi.fn(),
    startCaptainTrackReapCron: vi.fn(),
  },
}));

vi.mock('../src/db/pool.js', () => ({
  pool: { query: queryMock, connect: vi.fn(), on: vi.fn() },
  withTx: vi.fn(),
}));
// Abonnement Captain (migration 0089) : un abonné saute le contrôle de solde.
// Ces suites portent sur le contrôle lui-même, donc on part d'un Captain non
// abonné — le comportement de l'abonnement a ses propres tests.
vi.mock('../src/modules/captain/subscription.service.js', () => ({
  isSubscriptionActive: vi.fn().mockResolvedValue(false),
}));
vi.mock('../src/modules/wallet/wallet.service.js', () => ({ getBalance: getBalanceMock }));
vi.mock('../src/modules/home/going-home.service.js', () => goingHomeMock);
vi.mock('../src/modules/captain/live-location.js', () => liveLocationMock);
vi.mock('../src/modules/captain/track.service.js', () => trackMock);
// Onboarding v3 : /online exige un profil complet. Ces tests portent sur la
// présence et le miroir Redis — on part d'un profil complet.
vi.mock('../src/modules/captain/onboarding.service.js', () => ({
  getOnboardingStatus: onboardingMock,
}));

import { captainStateRouter } from '../src/modules/captain/state.routes.js';

const CAPTAIN = { id: 'captain-1', role: 'captain' as const };
let handle: TestAppHandle | null = null;

async function start() {
  handle = await startTestApp('/captain/state', captainStateRouter, CAPTAIN);
  return handle;
}

beforeEach(() => {
  onboardingMock.mockResolvedValue({
    fullName: 'Sidi Ould Ahmed', vehicle: { verifiedAt: new Date().toISOString() },
    onlineGaps: [], canGoOnline: true,
  });
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
  getBalanceMock.mockReset();
  for (const fn of Object.values(goingHomeMock)) fn.mockReset();
  for (const fn of Object.values(liveLocationMock)) fn.mockReset();
  for (const fn of Object.values(trackMock)) fn.mockReset();
  trackMock.isTrackingEnabled.mockResolvedValue(true);
  trackMock.ingestTrackBatch.mockResolvedValue({ accepted: 1, dropped: 0 });
});

afterEach(async () => {
  if (handle) await handle.close();
  handle = null;
});

describe('POST /captain/state/online', () => {
  /**
   * `effective` is what the UPSERT's RETURNING hands back — the position the row
   * HOLDS after the write, which is not always what the request carried: going
   * online without coordinates preserves the previous one.
   */
  function activeCaptainWith(
    presence: string | null,
    effective: { eff_lat: number | null; eff_lng: number | null; eff_seen_ms: number | null } =
      { eff_lat: null, eff_lng: null, eff_seen_ms: null },
  ) {
    dispatchSql(queryMock, [
      [/SELECT status FROM captains/, rows([{ status: 'active' }])],
      [/SELECT presence FROM captain_state/, presence ? rows([{ presence }]) : rows([])],
      [/INSERT INTO captain_state/, rows([
        { captain_id: 'captain-1', presence: 'online', ...effective },
      ])],
    ]);
  }

  it('goes online with a location and returns the balance', async () => {
    const now = Date.now();
    activeCaptainWith('offline', { eff_lat: 18.08, eff_lng: -15.97, eff_seen_ms: now });
    getBalanceMock.mockResolvedValue(150);
    const { baseUrl } = await start();

    const res = await api(baseUrl, 'POST', '/captain/state/online', { lat: 18.08, lng: -15.97 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ presence: 'online', balanceMru: 150 });
    const insert = queryMock.mock.calls.find((c) => String(c[0]).includes('INSERT INTO captain_state'));
    expect(insert![1]).toEqual(['captain-1', -15.97, 18.08]);
    // Dual write: Postgres stays the source of truth, Redis gets a mirror.
    // Note the argument order flips here — the SQL takes (lng, lat), the helper
    // takes (lat, lng).
    expect(liveLocationMock.setLiveLocation).toHaveBeenCalledWith('captain-1', 18.08, -15.97, now);
  });

  it('re-seeds the geo index from the position Postgres kept, with its real age', async () => {
    // The gap this closes: going offline removes the captain from the geo index,
    // but leaves captain_state.location intact. Coming back online without
    // coordinates preserves that position, so PostGIS still finds them while
    // Redis does not — invisible in `redis` mode, and a permanent stream of
    // shadow 'missing' mismatches that would block the promotion for good.
    //
    // The timestamp matters as much as the position: seeding an hour-old fix as
    // just-seen would make Redis consider fresh what PostGIS considers stale,
    // inverting the bug instead of fixing it.
    const anHourAgo = Date.now() - 3_600_000;
    activeCaptainWith('offline', { eff_lat: 18.11, eff_lng: -15.94, eff_seen_ms: anHourAgo });
    getBalanceMock.mockResolvedValue(150);
    const { baseUrl } = await start();

    const res = await api(baseUrl, 'POST', '/captain/state/online', {});
    expect(res.status).toBe(200);
    expect(liveLocationMock.setLiveLocation)
      .toHaveBeenCalledWith('captain-1', 18.11, -15.94, anHourAgo);
  });

  it('does not mirror when the row holds no position at all', async () => {
    // A brand-new captain going online without coordinates: there is nothing to
    // seed, and writing (0, 0) would place them in the Gulf of Guinea.
    activeCaptainWith('offline');
    getBalanceMock.mockResolvedValue(150);
    const { baseUrl } = await start();

    const res = await api(baseUrl, 'POST', '/captain/state/online', {});
    expect(res.status).toBe(200);
    expect(liveLocationMock.setLiveLocation).not.toHaveBeenCalled();
  });

  it('keeps the eff_* columns out of the response', async () => {
    // They exist only to feed the Redis mirror. Leaking them would quietly widen
    // the client contract, and a captain's coordinates are not part of it.
    activeCaptainWith('offline', { eff_lat: 18.08, eff_lng: -15.97, eff_seen_ms: Date.now() });
    getBalanceMock.mockResolvedValue(150);
    const { baseUrl } = await start();

    const res = await api(baseUrl, 'POST', '/captain/state/online', { lat: 18.08, lng: -15.97 });
    expect(res.body).not.toHaveProperty('eff_lat');
    expect(res.body).not.toHaveProperty('eff_lng');
    expect(res.body).not.toHaveProperty('eff_seen_ms');
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
    // The floor (MIN_BALANCE_TO_GO_ONLINE_MRU) defaults to -10 MRU, so the
    // balance has to be below that — 0 is now allowed online.
    getBalanceMock.mockResolvedValue(-20);
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
    // A GEO key has no per-member TTL: without this removal the captain would
    // sit at their last position forever and keep matching GEOSEARCH.
    expect(liveLocationMock.clearLiveLocation).toHaveBeenCalledWith('captain-1');
  });

  it('leaves the geo index alone when going offline is refused', async () => {
    dispatchSql(queryMock, [
      [/SELECT presence FROM captain_state/, rows([{ presence: 'on_ride' }])],
    ]);
    const { baseUrl } = await start();

    await api(baseUrl, 'POST', '/captain/state/offline');
    // The captain is still on a ride and still online — dropping them from the
    // index here would make them unreachable for the ride they are servicing.
    expect(liveLocationMock.clearLiveLocation).not.toHaveBeenCalled();
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

describe('POST /captain/state/track', () => {
  const points = [
    { lat: 18.08, lng: -15.97, recordedAt: 1_700_000_000_000 },
    { lat: 18.09, lng: -15.96, recordedAt: 1_700_000_030_000 },
  ];

  it('mirrors the most recent point to the geo index', async () => {
    dispatchSql(queryMock, [[/UPDATE captain_state/, rows([{ captain_id: 'captain-1' }])]]);
    const { baseUrl } = await start();

    const res = await api(baseUrl, 'POST', '/captain/state/track', { points });
    expect(res.status).toBe(200);
    // The latest point by recordedAt, not the last in the array.
    expect(liveLocationMock.setLiveLocation).toHaveBeenCalledWith('captain-1', 18.09, -15.96);
  });

  it('does not resurrect an offline captain in the geo index', async () => {
    // The UPDATE carries `AND presence <> 'offline'`, so it is a no-op for a
    // captain who went offline mid-flush. Mirroring regardless would put them
    // back in the index as a dispatch candidate with nothing to remove them.
    dispatchSql(queryMock, [[/UPDATE captain_state/, rows([])]]);
    const { baseUrl } = await start();

    const res = await api(baseUrl, 'POST', '/captain/state/track', { points });
    expect(res.status).toBe(200);
    expect(liveLocationMock.setLiveLocation).not.toHaveBeenCalled();
  });

  it('writes nothing anywhere while tracking is disabled', async () => {
    trackMock.isTrackingEnabled.mockResolvedValue(false);
    const { baseUrl } = await start();

    const res = await api(baseUrl, 'POST', '/captain/state/track', { points });
    expect(res.body).toEqual({ stored: 0, disabled: true });
    expect(liveLocationMock.setLiveLocation).not.toHaveBeenCalled();
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
