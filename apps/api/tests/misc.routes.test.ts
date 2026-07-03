import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, startTestApp, type TestAppHandle } from './helpers/app.js';

const { favoritesMock, recurringMock, reportsMock, geocodeMock } = vi.hoisted(() => ({
  favoritesMock: {
    listMyFavorites: vi.fn(),
    addFavorite: vi.fn(),
    removeFavorite: vi.fn(),
  },
  recurringMock: {
    listMyRecurring: vi.fn(),
    proposeRecurring: vi.fn(),
    cancelByRider: vi.fn(),
    listForCaptain: vi.fn(),
    acceptByCaptain: vi.fn(),
    processOccurrences: vi.fn(),
  },
  reportsMock: {
    listActive: vi.fn(),
    createReport: vi.fn(),
    voteReport: vi.fn(),
  },
  geocodeMock: { searchPlaces: vi.fn() },
}));

vi.mock('../src/modules/favorites/favorites.service.js', () => favoritesMock);
vi.mock('../src/modules/recurring/recurring.service.js', () => recurringMock);
vi.mock('../src/modules/reports/road-reports.service.js', () => reportsMock);
vi.mock('../src/modules/geocode/geocode.service.js', () => geocodeMock);
// requireAuth pulls in the heartbeat which touches the pool — neutralize it.
vi.mock('../src/db/pool.js', () => ({
  pool: { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }), connect: vi.fn(), on: vi.fn() },
  withTx: vi.fn(),
}));

import { riderFavoritesRouter } from '../src/modules/favorites/favorites.routes.js';
import { riderRecurringRouter } from '../src/modules/recurring/rider.routes.js';
import { captainRecurringRouter } from '../src/modules/recurring/captain.routes.js';
import { adminRecurringRouter } from '../src/modules/recurring/admin.routes.js';
import { roadReportsRouter } from '../src/modules/reports/road-reports.routes.js';
import { geocodeRouter } from '../src/modules/geocode/geocode.routes.js';
import { signAccessToken } from '../src/modules/auth/jwt.js';

const RIDER = { id: 'rider-1', role: 'rider' as const };
const CAPTAIN = { id: 'captain-1', role: 'captain' as const };
const CAPTAIN_UUID = '5f1e7a10-1111-4222-8333-444455556666';

function bearer(role: 'rider' | 'captain' | 'admin' = 'rider', id = 'user-1') {
  return {
    authorization: `Bearer ${signAccessToken({ sub: id, role, adminRole: null, sid: 's1' })}`,
  };
}

let handle: TestAppHandle | null = null;

beforeEach(() => {
  for (const mocks of [favoritesMock, recurringMock, reportsMock, geocodeMock]) {
    for (const fn of Object.values(mocks)) fn.mockReset();
  }
});

afterEach(async () => {
  if (handle) await handle.close();
  handle = null;
});

describe('rider favorites', () => {
  async function start() {
    handle = await startTestApp('/rider/favorites', riderFavoritesRouter, RIDER);
    return handle;
  }

  it('GET / lists my favorite captains', async () => {
    favoritesMock.listMyFavorites.mockResolvedValue([{ captainId: CAPTAIN_UUID }]);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/rider/favorites');
    expect(res.status).toBe(200);
    expect(favoritesMock.listMyFavorites).toHaveBeenCalledWith('rider-1');
  });

  it('POST / adds a favorite with a nickname', async () => {
    favoritesMock.addFavorite.mockResolvedValue({ ok: true });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/rider/favorites', {
      captainId: CAPTAIN_UUID,
      nickname: 'Mon chauffeur',
    });
    expect(res.status).toBe(200);
    expect(favoritesMock.addFavorite).toHaveBeenCalledWith('rider-1', CAPTAIN_UUID, 'Mon chauffeur');
  });

  it('POST / rejects a non-uuid captainId (400)', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/rider/favorites', { captainId: 'abc' });
    expect(res.status).toBe(400);
  });

  it('DELETE /:captainId removes the favorite', async () => {
    favoritesMock.removeFavorite.mockResolvedValue(undefined);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'DELETE', `/rider/favorites/${CAPTAIN_UUID}`);
    expect(res.status).toBe(200);
    expect(favoritesMock.removeFavorite).toHaveBeenCalledWith('rider-1', CAPTAIN_UUID);
  });
});

describe('recurring rides', () => {
  const proposal = {
    pickup: { lat: 18.08, lng: -15.97, label: 'Maison' },
    dropoff: { lat: 18.1, lng: -15.95, label: 'Bureau' },
    daysOfWeek: 31, // Mon-Fri
    timeOfDay: '08:00',
    validFrom: '2026-07-06',
  };

  it('rider: GET / lists my recurring rides', async () => {
    recurringMock.listMyRecurring.mockResolvedValue([{ id: 'rec-1' }]);
    handle = await startTestApp('/rider/recurring-rides', riderRecurringRouter, RIDER);
    const res = await api(handle.baseUrl, 'GET', '/rider/recurring-rides');
    expect(res.status).toBe(200);
    expect(recurringMock.listMyRecurring).toHaveBeenCalledWith('rider-1');
  });

  it('rider: POST / proposes a schedule', async () => {
    recurringMock.proposeRecurring.mockResolvedValue({ id: 'rec-1', status: 'proposed' });
    handle = await startTestApp('/rider/recurring-rides', riderRecurringRouter, RIDER);
    const res = await api(handle.baseUrl, 'POST', '/rider/recurring-rides', proposal);
    expect(res.status).toBe(200);
    expect(recurringMock.proposeRecurring).toHaveBeenCalledWith(
      expect.objectContaining({ riderId: 'rider-1', daysOfWeek: 31, timeOfDay: '08:00' }),
    );
  });

  it('rider: POST / rejects a malformed timeOfDay (400)', async () => {
    handle = await startTestApp('/rider/recurring-rides', riderRecurringRouter, RIDER);
    const res = await api(handle.baseUrl, 'POST', '/rider/recurring-rides', {
      ...proposal,
      timeOfDay: '8h00',
    });
    expect(res.status).toBe(400);
  });

  it('rider: POST /:id/cancel cancels my schedule', async () => {
    recurringMock.cancelByRider.mockResolvedValue({ id: 'rec-1', status: 'cancelled' });
    handle = await startTestApp('/rider/recurring-rides', riderRecurringRouter, RIDER);
    const res = await api(handle.baseUrl, 'POST', '/rider/recurring-rides/rec-1/cancel');
    expect(res.status).toBe(200);
    expect(recurringMock.cancelByRider).toHaveBeenCalledWith('rec-1', 'rider-1');
  });

  it('captain: GET / lists proposals for the captain', async () => {
    recurringMock.listForCaptain.mockResolvedValue([{ id: 'rec-2' }]);
    handle = await startTestApp('/captain/recurring-rides', captainRecurringRouter, CAPTAIN);
    const res = await api(handle.baseUrl, 'GET', '/captain/recurring-rides');
    expect(res.status).toBe(200);
    expect(recurringMock.listForCaptain).toHaveBeenCalledWith('captain-1');
  });

  it('captain: POST /:id/accept accepts a proposal', async () => {
    recurringMock.acceptByCaptain.mockResolvedValue({ id: 'rec-2', status: 'active' });
    handle = await startTestApp('/captain/recurring-rides', captainRecurringRouter, CAPTAIN);
    const res = await api(handle.baseUrl, 'POST', '/captain/recurring-rides/rec-2/accept');
    expect(res.status).toBe(200);
    expect(recurringMock.acceptByCaptain).toHaveBeenCalledWith('rec-2', 'captain-1');
  });

  it('admin: POST /process schedules and dispatches occurrences', async () => {
    recurringMock.processOccurrences.mockResolvedValue({ scheduled: 3, dispatched: 1 });
    handle = await startTestApp('/admin/recurring', adminRecurringRouter, {
      id: 'admin-1',
      role: 'admin',
      adminRole: 'super_admin',
    });
    const res = await api(handle.baseUrl, 'POST', '/admin/recurring/process');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ scheduled: 3, dispatched: 1 });
  });
});

describe('road reports', () => {
  async function start() {
    handle = await startTestApp('/road-reports', roadReportsRouter);
    return handle;
  }

  it('requires authentication (401)', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/road-reports');
    expect(res.status).toBe(401);
  });

  it('GET / lists active reports inside the bounding box', async () => {
    reportsMock.listActive.mockResolvedValue([{ id: 'rr-1', reason: 'sand' }]);
    const { baseUrl } = await start();
    const res = await api(
      baseUrl,
      'GET',
      '/road-reports?minLat=18&maxLat=18.2&minLng=-16&maxLng=-15.8',
      undefined,
      bearer('captain'),
    );
    expect(res.status).toBe(200);
    expect(reportsMock.listActive).toHaveBeenCalledWith(
      expect.objectContaining({ minLat: 18, limit: 200 }),
    );
  });

  it('POST / creates a report with the reporter identity', async () => {
    reportsMock.createReport.mockResolvedValue({ id: 'rr-2' });
    const { baseUrl } = await start();
    const res = await api(
      baseUrl,
      'POST',
      '/road-reports',
      { lat: 18.09, lng: -15.96, reason: 'flood', note: 'Route coupée' },
      bearer('captain', 'captain-9'),
    );
    expect(res.status).toBe(200);
    expect(reportsMock.createReport).toHaveBeenCalledWith(
      expect.objectContaining({ reporterId: 'captain-9', reporterRole: 'captain', reason: 'flood' }),
    );
  });

  it('POST / rejects an unknown reason (400)', async () => {
    const { baseUrl } = await start();
    const res = await api(
      baseUrl,
      'POST',
      '/road-reports',
      { lat: 18.09, lng: -15.96, reason: 'aliens' },
      bearer(),
    );
    expect(res.status).toBe(400);
  });

  it('POST /:id/vote maps confirm=false to a downvote', async () => {
    reportsMock.voteReport.mockResolvedValue({ id: 'rr-1', score: -1 });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/road-reports/rr-1/vote', { confirm: false }, bearer());
    expect(res.status).toBe(200);
    expect(reportsMock.voteReport).toHaveBeenCalledWith(
      expect.objectContaining({ reportId: 'rr-1', vote: -1 }),
    );
  });
});

describe('geocode proxy', () => {
  async function start() {
    handle = await startTestApp('/geocode', geocodeRouter);
    return handle;
  }

  it('requires authentication (401)', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/geocode/search?q=marche');
    expect(res.status).toBe(401);
  });

  it('GET /search proxies the query with defaults', async () => {
    geocodeMock.searchPlaces.mockResolvedValue([{ name: 'Marché Capitale' }]);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/geocode/search?q=marche', undefined, bearer());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ results: [{ name: 'Marché Capitale' }] });
    expect(geocodeMock.searchPlaces).toHaveBeenCalledWith({ q: 'marche', limit: 6 });
  });

  it('GET /search rejects a malformed proximity (400)', async () => {
    const { baseUrl } = await start();
    const res = await api(
      baseUrl,
      'GET',
      '/geocode/search?q=marche&proximity=abc',
      undefined,
      bearer(),
    );
    expect(res.status).toBe(400);
  });
});
