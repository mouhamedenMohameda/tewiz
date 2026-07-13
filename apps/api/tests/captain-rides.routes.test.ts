import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CAPTAIN_RIDE_CANCEL_REASONS, RIDE_CANCEL_REASON_LABEL_FR } from '@tewiz/shared-types';
import { api, startTestApp, type TestAppHandle } from './helpers/app.js';
import { dispatchSql, rows } from './helpers/db.js';

const { queryMock, txQueryMock, ridesMock, captainInboxMock, insightsMock, ingestLocationMock } =
  vi.hoisted(() => ({
    queryMock: vi.fn(),
    txQueryMock: vi.fn(),
    ridesMock: {
      getCurrentRideForCaptain: vi.fn(),
      listCaptainHistory: vi.fn(),
      getRideForUser: vi.fn(),
      acceptRide: vi.fn(),
      arriveRide: vi.fn(),
      startRide: vi.fn(),
      completeRide: vi.fn(),
      cancelRide: vi.fn(),
    },
    captainInboxMock: vi.fn(),
    insightsMock: vi.fn(),
    ingestLocationMock: vi.fn(),
  }));

vi.mock('../src/db/pool.js', () => ({
  pool: { query: queryMock, connect: vi.fn(), on: vi.fn() },
  withTx: async (fn: (client: { query: typeof txQueryMock }) => Promise<unknown>) =>
    fn({ query: txQueryMock }),
}));
vi.mock('../src/modules/rides/rides.service.js', () => ridesMock);
vi.mock('../src/modules/rides/dispatch.service.js', () => ({
  captainInbox: captainInboxMock,
}));
vi.mock('../src/modules/rides/ride-insights.service.js', () => ({
  getRideInsights: insightsMock,
}));
vi.mock('../src/modules/rides/meter.service.js', () => ({
  ingestLocation: ingestLocationMock,
}));

import { captainRidesRouter } from '../src/modules/rides/captain-rides.routes.js';

const CAPTAIN = { id: 'captain-1', role: 'captain' as const };
let handle: TestAppHandle | null = null;

async function start() {
  handle = await startTestApp('/captain/rides', captainRidesRouter, CAPTAIN);
  return handle;
}

beforeEach(() => {
  queryMock.mockReset();
  txQueryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
  txQueryMock.mockResolvedValue({ rows: [], rowCount: 0 });
  for (const fn of Object.values(ridesMock)) fn.mockReset();
  captainInboxMock.mockReset();
  insightsMock.mockReset();
  ingestLocationMock.mockReset();
});

afterEach(async () => {
  if (handle) await handle.close();
  handle = null;
});

describe('GET /captain/rides/inbox', () => {
  it('lists nearby rides using the query location', async () => {
    captainInboxMock.mockResolvedValue([{ id: 'ride-1', distanceM: 300 }]);
    const { baseUrl } = await start();

    const res = await api(baseUrl, 'GET', '/captain/rides/inbox?lat=18.08&lng=-15.97&radiusM=2000');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'ride-1', distanceM: 300 }]);
    expect(captainInboxMock).toHaveBeenCalledWith({
      captainId: 'captain-1',
      lat: 18.08,
      lng: -15.97,
      radiusM: 2000,
    });
  });

  it('falls back to the stored captain location', async () => {
    dispatchSql(queryMock, [[/FROM captain_state/, rows([{ lat: '18.1', lng: '-15.9' }])]]);
    captainInboxMock.mockResolvedValue([]);
    const { baseUrl } = await start();

    const res = await api(baseUrl, 'GET', '/captain/rides/inbox');
    expect(res.status).toBe(200);
    expect(captainInboxMock).toHaveBeenCalledWith(
      expect.objectContaining({ lat: 18.1, lng: -15.9 }),
    );
  });

  it('returns 400 no_location when no location is known', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/captain/rides/inbox');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('no_location');
  });
});

describe('GET current / history / :id', () => {
  it('GET /current returns 204 without an active ride', async () => {
    ridesMock.getCurrentRideForCaptain.mockResolvedValue(null);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/captain/rides/current');
    expect(res.status).toBe(204);
  });

  it('GET /current returns the active ride', async () => {
    ridesMock.getCurrentRideForCaptain.mockResolvedValue({ id: 'ride-2' });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/captain/rides/current');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('ride-2');
  });

  it('GET /history lists past rides', async () => {
    ridesMock.listCaptainHistory.mockResolvedValue([{ id: 'ride-3' }]);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/captain/rides/history');
    expect(res.status).toBe(200);
    expect(ridesMock.listCaptainHistory).toHaveBeenCalledWith('captain-1', 30);
  });

  it('GET /:id scopes the lookup to the captain role', async () => {
    ridesMock.getRideForUser.mockResolvedValue({ id: 'ride-4' });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/captain/rides/ride-4');
    expect(res.status).toBe(200);
    expect(ridesMock.getRideForUser).toHaveBeenCalledWith('ride-4', 'captain-1', 'captain');
  });
});

describe('GET /captain/rides/:id/insights', () => {
  it('returns insights for a searching ride', async () => {
    dispatchSql(queryMock, [
      [/SELECT status, captain_id FROM rides/, rows([{ status: 'searching', captain_id: null }])],
    ]);
    insightsMock.mockResolvedValue({ demand: 'high' });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/captain/rides/ride-5/insights');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ demand: 'high' });
  });

  it('returns 404 when the ride does not exist', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/captain/rides/ride-x/insights');
    expect(res.status).toBe(404);
  });

  it("refuses another captain's accepted ride (403)", async () => {
    dispatchSql(queryMock, [
      [/SELECT status, captain_id FROM rides/, rows([{ status: 'accepted', captain_id: 'other' }])],
    ]);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/captain/rides/ride-5/insights');
    expect(res.status).toBe(403);
    expect(insightsMock).not.toHaveBeenCalled();
  });
});

describe('ride lifecycle actions', () => {
  it('POST /:id/accept delegates to the service', async () => {
    ridesMock.acceptRide.mockResolvedValue({ id: 'ride-6', status: 'accepted' });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/captain/rides/ride-6/accept');
    expect(res.status).toBe(200);
    expect(ridesMock.acceptRide).toHaveBeenCalledWith('ride-6', 'captain-1');
  });

  it('POST /:id/decline records an idempotent decline', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/captain/rides/ride-6/decline');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    const insert = queryMock.mock.calls.find((c) => String(c[0]).includes('INSERT INTO ride_declines'));
    expect(insert![1]).toEqual(['ride-6', 'captain-1']);
  });

  it('POST /:id/start delegates to the service', async () => {
    ridesMock.startRide.mockResolvedValue({ id: 'ride-6', status: 'in_progress' });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/captain/rides/ride-6/start');
    expect(res.status).toBe(200);
    expect(ridesMock.startRide).toHaveBeenCalledWith('ride-6', 'captain-1');
  });

  it('POST /:id/complete forwards distance and duration', async () => {
    ridesMock.completeRide.mockResolvedValue({ id: 'ride-6', status: 'completed' });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/captain/rides/ride-6/complete', {
      actualDistanceM: 4200,
      actualDurationS: 900,
    });
    expect(res.status).toBe(200);
    expect(ridesMock.completeRide).toHaveBeenCalledWith({
      rideId: 'ride-6',
      captainId: 'captain-1',
      actualDistanceM: 4200,
      actualDurationS: 900,
    });
  });

  it('POST /:id/cancel maps a reasonKey to its label', async () => {
    const key = CAPTAIN_RIDE_CANCEL_REASONS[0]!;
    ridesMock.cancelRide.mockResolvedValue({ id: 'ride-6' });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/captain/rides/ride-6/cancel', { reasonKey: key });
    expect(res.status).toBe(200);
    expect(ridesMock.cancelRide).toHaveBeenCalledWith({
      rideId: 'ride-6',
      userId: 'captain-1',
      role: 'captain',
      reason: RIDE_CANCEL_REASON_LABEL_FR[key],
    });
  });

  it('POST /:id/cancel without reason is a 400', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/captain/rides/ride-6/cancel', {});
    expect(res.status).toBe(400);
  });
});

describe('POST /captain/rides/:id/location', () => {
  const sample = { lat: 18.09, lng: -15.96, accuracyM: 8, speedMps: 11 };

  it('ingests a GPS sample for the assigned in_progress ride', async () => {
    dispatchSql(queryMock, [
      [/SELECT captain_id, status FROM rides/, rows([{ captain_id: 'captain-1', status: 'in_progress' }])],
    ]);
    ingestLocationMock.mockResolvedValue({ accepted: true, distanceM: 4200 });
    const { baseUrl } = await start();

    const res = await api(baseUrl, 'POST', '/captain/rides/ride-7/location', sample);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ accepted: true, distanceM: 4200 });
    expect(ingestLocationMock).toHaveBeenCalledWith(
      expect.anything(),
      'ride-7',
      expect.objectContaining({ lat: 18.09, lng: -15.96, accuracyM: 8, speedMps: 11 }),
    );
  });

  it('returns 404 for an unknown ride', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/captain/rides/ride-x/location', sample);
    expect(res.status).toBe(404);
  });

  it("returns 403 for another captain's ride", async () => {
    dispatchSql(queryMock, [
      [/SELECT captain_id, status FROM rides/, rows([{ captain_id: 'other', status: 'in_progress' }])],
    ]);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/captain/rides/ride-7/location', sample);
    expect(res.status).toBe(403);
  });

  it('returns 409 when the ride is not in_progress', async () => {
    dispatchSql(queryMock, [
      [/SELECT captain_id, status FROM rides/, rows([{ captain_id: 'captain-1', status: 'accepted' }])],
    ]);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/captain/rides/ride-7/location', sample);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('wrong_status');
  });
});
