/**
 * FEATURE 13 — Rester en ligne avec une position fraîche.
 *
 * Dispatch can only offer a ride to a captain it believes is (a) online and
 * (b) somewhere it can trust. Both halves are fragile in different ways:
 *
 *   * presence is a state machine that must never downgrade someone mid-ride;
 *   * position has a FRESHNESS stamp, because a captain parked for an hour and
 *     a captain who moved 8 km without the tracker catching up look identical
 *     in the database otherwise.
 *
 * The position is dual-written to Postgres and to the Redis geo index. Postgres
 * stays authoritative; the mirror exists so DISPATCH_GEO_SOURCE can be rolled
 * back without a data migration. A divergence between the two is a silent
 * dispatch bug, so the mirroring rule is pinned here explicitly.
 *
 * Status per the audit: working.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, startTestApp, type TestAppHandle } from '../helpers/app.js';

const {
  poolQueryMock, getBalanceMock, setLiveMock, clearLiveMock,
  trackingEnabledMock, ingestMock, onboardingMock,
} = vi.hoisted(() => ({
    poolQueryMock: vi.fn(),
    getBalanceMock: vi.fn(),
    setLiveMock: vi.fn(),
    clearLiveMock: vi.fn(),
    trackingEnabledMock: vi.fn(),
    ingestMock: vi.fn(),
    onboardingMock: vi.fn(),
  }));

vi.mock('../../src/db/pool.js', () => ({
  pool: { query: poolQueryMock, connect: vi.fn(), on: vi.fn() },
  withTx: vi.fn(),
}));
// Abonnement Captain (migration 0089) : un abonné saute le contrôle de solde.
// Ces suites portent sur le contrôle lui-même, donc on part d'un Captain non
// abonné — le comportement de l'abonnement a ses propres tests.
vi.mock('../../src/modules/captain/subscription.service.js', () => ({
  isSubscriptionActive: vi.fn().mockResolvedValue(false),
}));
vi.mock('../../src/modules/wallet/wallet.service.js', () => ({
  getBalance: getBalanceMock, debitWallet: vi.fn(), creditWallet: vi.fn(),
}));
vi.mock('../../src/modules/captain/live-location.js', () => ({
  setLiveLocation: setLiveMock, clearLiveLocation: clearLiveMock, captainsNear: vi.fn(),
}));
vi.mock('../../src/modules/captain/track.service.js', () => ({
  isTrackingEnabled: trackingEnabledMock, ingestTrackBatch: ingestMock,
}));
// Onboarding v3 : /online exige désormais un profil complet (véhicule déclaré
// et vérifié, documents « pour rouler »). Ces tests portent sur la présence et
// la fraîcheur de position — on part d'un profil complet, et le refus a ses
// propres tests.
vi.mock('../../src/modules/captain/onboarding.service.js', () => ({
  getOnboardingStatus: onboardingMock,
}));
vi.mock('../../src/modules/home/going-home.service.js', () => ({
  startSession: vi.fn(), endSession: vi.fn(), getActiveSession: vi.fn(async () => null),
}));

import { captainStateRouter } from '../../src/modules/captain/state.routes.js';

const CAPTAIN = { id: 'captain-1', role: 'captain' as const };
const NKC = { lat: 18.0858, lng: -15.9785 };

let handle: TestAppHandle | null = null;
const start = async () => (handle = await startTestApp('/captain/state', captainStateRouter, CAPTAIN));

interface State {
  captainStatus?: string | null;
  presence?: string | null;
  effLat?: number | null;
  effLng?: number | null;
  effSeenMs?: number | null;
}

function db(s: State = {}) {
  poolQueryMock.mockImplementation(async (sql: unknown) => {
    const text = String(sql);
    if (/SELECT status FROM captains/i.test(text)) {
      return s.captainStatus === null
        ? { rows: [], rowCount: 0 }
        : { rows: [{ status: s.captainStatus ?? 'active' }], rowCount: 1 };
    }
    if (/SELECT presence FROM captain_state/i.test(text)) {
      return { rows: s.presence ? [{ presence: s.presence }] : [], rowCount: s.presence ? 1 : 0 };
    }
    if (/INSERT INTO captain_state/i.test(text)) {
      return {
        rows: [{
          captain_id: 'captain-1', presence: 'online', updated_at: new Date(),
          eff_lat: s.effLat === undefined ? NKC.lat : s.effLat,
          eff_lng: s.effLng === undefined ? NKC.lng : s.effLng,
          eff_seen_ms: s.effSeenMs === undefined ? Date.now() : s.effSeenMs,
        }],
        rowCount: 1,
      };
    }
    if (/UPDATE captain_state/i.test(text)) {
      return { rows: [{ captain_id: 'captain-1', presence: 'offline', updated_at: new Date() }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
}

beforeEach(() => {
  onboardingMock.mockResolvedValue({
    fullName: 'Sidi Ould Ahmed', vehicle: { verifiedAt: new Date().toISOString() },
    onlineGaps: [], canGoOnline: true,
  });
  vi.clearAllMocks();
  getBalanceMock.mockResolvedValue(500);
  trackingEnabledMock.mockResolvedValue(true);
  db();
});

afterEach(async () => {
  if (handle) await handle.close();
  handle = null;
});

describe('going online', () => {
  it('accepts an active captain with a healthy balance', async () => {
    const { baseUrl } = await start();

    const res = await api(baseUrl, 'POST', '/captain/state/online', NKC);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ presence: 'online', balanceMru: 500 });
  });

  it('refuses a captain whose wallet is below the floor', async () => {
    getBalanceMock.mockResolvedValue(-40);
    const { baseUrl } = await start();

    const res = await api(baseUrl, 'POST', '/captain/state/online', NKC);

    expect(res.status).toBe(402);
    expect(res.body.error).toMatchObject({ code: 'balance_too_low' });
    // The captain must be told how far off they are, or they cannot fix it.
    expect(res.body.error.details).toMatchObject({ balance: -40 });
  });

  it('refuses a suspended captain', async () => {
    db({ captainStatus: 'suspended' });
    const { baseUrl } = await start();

    const res = await api(baseUrl, 'POST', '/captain/state/online', NKC);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('captain_suspended');
  });

  it('refuses an account with no captain row at all', async () => {
    db({ captainStatus: null });
    const { baseUrl } = await start();

    const res = await api(baseUrl, 'POST', '/captain/state/online', NKC);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_captain');
  });

  it('never downgrades a captain who is mid-ride', async () => {
    db({ presence: 'on_ride' });
    const { baseUrl } = await start();

    // Flipping to 'online' here would make them eligible for a SECOND ride
    // while a passenger is already in the car.
    const res = await api(baseUrl, 'POST', '/captain/state/online', NKC);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('on_ride');
  });

  it('rejects an out-of-range coordinate', async () => {
    const { baseUrl } = await start();

    const res = await api(baseUrl, 'POST', '/captain/state/online', { lat: 91, lng: 0 });

    expect(res.status).toBe(400);
  });

  it('allows going online without coordinates, keeping the stored position', async () => {
    const { baseUrl } = await start();

    const res = await api(baseUrl, 'POST', '/captain/state/online', {});

    expect(res.status).toBe(200);
    const insert = poolQueryMock.mock.calls.find(([sql]) => /INSERT INTO captain_state/i.test(String(sql)))!;
    // The UPSERT keeps the previous location AND its freshness stamp rather
    // than blanking them — a captain reconnecting in a tunnel stays dispatchable.
    expect(String(insert[0])).toMatch(/location = captain_state\.location/);
    expect(String(insert[0])).toMatch(/location_updated_at = captain_state\.location_updated_at/);
  });

  it('stamps the freshness time when coordinates ARE supplied', async () => {
    const { baseUrl } = await start();

    await api(baseUrl, 'POST', '/captain/state/online', NKC);

    const insert = poolQueryMock.mock.calls.find(([sql]) => /INSERT INTO captain_state/i.test(String(sql)))!;
    expect(String(insert[0])).toMatch(/location_updated_at = now\(\)/);
    // PostGIS takes lng first — swapping these puts every captain in the ocean.
    expect(insert[1]).toEqual(['captain-1', NKC.lng, NKC.lat]);
  });
});

describe('the Redis geo mirror must not drift from Postgres', () => {
  it('mirrors the effective position, not the request body', async () => {
    const { baseUrl } = await start();

    await api(baseUrl, 'POST', '/captain/state/online', {});

    // A captain who goes online WITHOUT coordinates keeps their stored position
    // in Postgres and stays eligible there. Mirroring only when the body carried
    // coordinates left them invisible in `redis` mode — a permanent stream of
    // shadow-mode 'missing' mismatches that would block the rollout forever.
    expect(setLiveMock).toHaveBeenCalledWith('captain-1', NKC.lat, NKC.lng, expect.any(Number));
  });

  it('carries the row freshness stamp so a stale position stays stale in Redis', async () => {
    const stamp = Date.now() - 3_600_000;
    db({ effSeenMs: stamp });
    const { baseUrl } = await start();

    await api(baseUrl, 'POST', '/captain/state/online', {});

    // Re-seeding an hour-old position as "just seen" would resurrect captains
    // the freshness guard is meant to exclude.
    expect(setLiveMock).toHaveBeenCalledWith('captain-1', NKC.lat, NKC.lng, stamp);
  });

  it('treats a legacy row with no stamp as just-seen, matching the PostGIS guard', async () => {
    db({ effSeenMs: null });
    const { baseUrl } = await start();

    await api(baseUrl, 'POST', '/captain/state/online', NKC);

    // PostGIS treats a NULL location_updated_at as fresh; the mirror must agree
    // or the two sources disagree by construction.
    const [, , , seenMs] = setLiveMock.mock.calls[0]!;
    expect(seenMs).toBeGreaterThan(Date.now() - 5_000);
  });

  it('skips the mirror entirely when there is no position to mirror', async () => {
    db({ effLat: null, effLng: null });
    const { baseUrl } = await start();

    await api(baseUrl, 'POST', '/captain/state/online', {});

    expect(setLiveMock).not.toHaveBeenCalled();
  });

  it('never leaks the mirror-only columns into the client payload', async () => {
    const { baseUrl } = await start();

    const res = await api(baseUrl, 'POST', '/captain/state/online', NKC);

    // eff_* exist to feed the geo index; they are not part of the app contract.
    expect(res.body).not.toHaveProperty('eff_lat');
    expect(res.body).not.toHaveProperty('eff_lng');
    expect(res.body).not.toHaveProperty('eff_seen_ms');
  });
});

describe('going offline', () => {
  it('removes the captain from the geo index', async () => {
    const { baseUrl } = await start();

    const res = await api(baseUrl, 'POST', '/captain/state/offline', {});

    expect(res.status).toBe(200);
    // Leaving them in the index would keep offering rides to a captain who has
    // gone home — the fastest way to burn a driver's trust in the app.
    expect(clearLiveMock).toHaveBeenCalledWith('captain-1');
  });

  it('refuses to go offline mid-ride', async () => {
    db({ presence: 'on_ride' });
    const { baseUrl } = await start();

    const res = await api(baseUrl, 'POST', '/captain/state/offline', {});

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('on_ride');
    expect(clearLiveMock).not.toHaveBeenCalled();
  });
});
