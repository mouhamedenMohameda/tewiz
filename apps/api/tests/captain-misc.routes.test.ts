import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, startTestApp, type TestAppHandle } from './helpers/app.js';
import { dispatchSql, rows } from './helpers/db.js';

const { queryMock, bonusMock, homeMock, heatmapMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  bonusMock: vi.fn(),
  homeMock: {
    getHome: vi.fn(),
    createHome: vi.fn(),
    updateHome: vi.fn(),
    deleteHome: vi.fn(),
  },
  heatmapMock: { listCells: vi.fn() },
}));

vi.mock('../src/db/pool.js', () => ({
  pool: { query: queryMock, connect: vi.fn(), on: vi.fn() },
  withTx: vi.fn(),
}));
vi.mock('../src/modules/rides/commission-bonus.service.js', () => ({
  getCaptainBonusProgress: bonusMock,
}));
vi.mock('../src/modules/home/home.service.js', () => homeMock);
vi.mock('../src/modules/heatmap/heatmap.service.js', () => heatmapMock);

import { captainPreferencesRouter } from '../src/modules/captain/preferences.routes.js';
import { captainBonusRouter } from '../src/modules/captain/bonus.routes.js';
import { captainHomeRouter } from '../src/modules/home/home.routes.js';
import { captainHeatmapRouter } from '../src/modules/heatmap/heatmap.routes.js';

const CAPTAIN = { id: 'captain-1', role: 'captain' as const };
let handle: TestAppHandle | null = null;

afterEach(async () => {
  if (handle) await handle.close();
  handle = null;
});

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
  bonusMock.mockReset();
  heatmapMock.listCells.mockReset();
  for (const fn of Object.values(homeMock)) fn.mockReset();
});

describe('captain preferences', () => {
  async function start() {
    handle = await startTestApp('/captain/preferences', captainPreferencesRouter, CAPTAIN);
    return handle;
  }

  const prefsRow = { vehicle_type: 'car', accepts_colis: false, accepts_long_distance: true };

  it('GET / returns the live preferences', async () => {
    dispatchSql(queryMock, [[/FROM captains/, rows([prefsRow])]]);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/captain/preferences');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ vehicleType: 'car', acceptsColis: false, acceptsLongDistance: true });
  });

  it('GET / returns 404 for a non-captain', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/captain/preferences');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_captain');
  });

  it('PATCH / updates the flags', async () => {
    dispatchSql(queryMock, [
      [/SELECT vehicle_type/, rows([prefsRow])],
      [/UPDATE captains/, rows([{ ...prefsRow, accepts_colis: true }])],
    ]);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'PATCH', '/captain/preferences', { acceptsColis: true });
    expect(res.status).toBe(200);
    expect(res.body.acceptsColis).toBe(true);
    const update = queryMock.mock.calls.find((c) => String(c[0]).includes('UPDATE captains'));
    expect(update![1]).toEqual([true, true, 'captain-1']);
  });

  it('PATCH / forces moto captains to stay colis-only', async () => {
    const motoRow = { vehicle_type: 'moto', accepts_colis: true, accepts_long_distance: false };
    dispatchSql(queryMock, [
      [/SELECT vehicle_type/, rows([motoRow])],
      [/UPDATE captains/, rows([motoRow])],
    ]);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'PATCH', '/captain/preferences', {
      acceptsColis: false,
      acceptsLongDistance: true,
    });
    expect(res.status).toBe(200);
    const update = queryMock.mock.calls.find((c) => String(c[0]).includes('UPDATE captains'));
    // Moto: accepts_colis forced true, accepts_long_distance forced false.
    expect(update![1]).toEqual([true, false, 'captain-1']);
  });

  it('PATCH / with an empty body is a 400 no_fields', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'PATCH', '/captain/preferences', {});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('no_fields');
  });
});

describe('captain bonus', () => {
  it('GET / returns the bonus progress', async () => {
    bonusMock.mockResolvedValue({ counterMru: 750, thresholdMru: 1000, bonusActive: false });
    handle = await startTestApp('/captain/bonus', captainBonusRouter, CAPTAIN);
    const res = await api(handle.baseUrl, 'GET', '/captain/bonus');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ counterMru: 750, thresholdMru: 1000 });
    expect(bonusMock).toHaveBeenCalledWith('captain-1');
  });
});

describe('captain home', () => {
  async function start() {
    handle = await startTestApp('/captain/home', captainHomeRouter, CAPTAIN);
    return handle;
  }

  const homeBody = {
    lat: 18.05,
    lng: -15.99,
    label: 'Maison Arafat',
    currentLat: 18.08,
    currentLng: -15.97,
  };

  it('GET / returns 204 when no home is set', async () => {
    homeMock.getHome.mockResolvedValue(null);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/captain/home');
    expect(res.status).toBe(204);
  });

  it('GET / returns the saved home', async () => {
    homeMock.getHome.mockResolvedValue({ label: 'Maison Arafat' });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/captain/home');
    expect(res.status).toBe(200);
    expect(res.body.label).toBe('Maison Arafat');
  });

  it('POST / creates the home with the captain id', async () => {
    homeMock.createHome.mockResolvedValue({ id: 'home-1' });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/captain/home', homeBody);
    expect(res.status).toBe(200);
    expect(homeMock.createHome).toHaveBeenCalledWith({ captainId: 'captain-1', ...homeBody });
  });

  it('POST / rejects a missing current position (anti-fraud GPS check)', async () => {
    const { baseUrl } = await start();
    const { currentLat: _a, currentLng: _b, ...noGps } = homeBody;
    const res = await api(baseUrl, 'POST', '/captain/home', noGps);
    expect(res.status).toBe(400);
  });

  it('PATCH / updates the home', async () => {
    homeMock.updateHome.mockResolvedValue({ id: 'home-1', label: 'Nouvelle maison' });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'PATCH', '/captain/home', {
      ...homeBody,
      label: 'Nouvelle maison',
    });
    expect(res.status).toBe(200);
    expect(homeMock.updateHome).toHaveBeenCalledWith(
      expect.objectContaining({ captainId: 'captain-1', label: 'Nouvelle maison' }),
    );
  });

  it('DELETE / removes the home (204)', async () => {
    homeMock.deleteHome.mockResolvedValue(undefined);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'DELETE', '/captain/home');
    expect(res.status).toBe(204);
    expect(homeMock.deleteHome).toHaveBeenCalledWith('captain-1');
  });
});

describe('captain heatmap', () => {
  it('GET / forwards the bounding box to the service', async () => {
    heatmapMock.listCells.mockResolvedValue([{ h3: 'abc', score: 4 }]);
    handle = await startTestApp('/captain/heatmap', captainHeatmapRouter, CAPTAIN);
    const res = await api(
      handle.baseUrl,
      'GET',
      '/captain/heatmap?minLat=18&maxLat=18.2&minLng=-16&maxLng=-15.8',
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ h3: 'abc', score: 4 }]);
    expect(heatmapMock.listCells).toHaveBeenCalledWith({
      minLat: 18,
      maxLat: 18.2,
      minLng: -16,
      maxLng: -15.8,
    });
  });
});
