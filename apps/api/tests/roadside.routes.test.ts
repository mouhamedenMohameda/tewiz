import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, startTestApp, type TestAppHandle } from './helpers/app.js';

// HTTP boundary for the roadside router: zod validation, status codes, and the
// service-result → response-shape mapping. The service is fully mocked.

const { svcMock } = vi.hoisted(() => ({
  svcMock: {
    PROBLEM_TYPES: ['pneu', 'batterie', 'essence', 'moteur', 'remorquage', 'accident', 'autre'],
    createRequest: vi.fn(),
    getCurrentForRequester: vi.fn(),
    cancelRequest: vi.fn(),
    getProviderProfile: vi.fn(),
    setProviderProfile: vi.fn(),
    providerInbox: vi.fn(),
    acceptRequest: vi.fn(),
    declineRequest: vi.fn(),
    updateProviderStatus: vi.fn(),
  },
}));

vi.mock('../src/modules/roadside/roadside.service.js', () => svcMock);
vi.mock('../src/middleware/auth.js', () => ({
  requireAuth: (_req: any, _res: any, next: () => void) => next(),
}));

import { roadsideRouter } from '../src/modules/roadside/roadside.routes.js';
import { HttpError } from '../src/middleware/error.js';

const USER = { id: 'user-1', role: 'rider' as const };
let app: TestAppHandle;

beforeEach(async () => {
  vi.clearAllMocks();
  app = await startTestApp('/roadside', roadsideRouter, USER);
});
afterEach(async () => {
  await app.close();
});

describe('POST /roadside/requests', () => {
  it('rejects an unknown problem_type with 400 and never calls the service', async () => {
    const res = await api(app.baseUrl, 'POST', '/roadside/requests', {
      problem_type: 'nope',
      lat: 18,
      lng: -15,
    });
    expect(res.status).toBe(400);
    expect(svcMock.createRequest).not.toHaveBeenCalled();
  });

  it('rejects an out-of-range latitude with 400', async () => {
    const res = await api(app.baseUrl, 'POST', '/roadside/requests', {
      problem_type: 'pneu',
      lat: 200,
      lng: -15,
    });
    expect(res.status).toBe(400);
  });

  it('rejects a radius below the 1000 m floor with 400', async () => {
    const res = await api(app.baseUrl, 'POST', '/roadside/requests', {
      problem_type: 'pneu',
      lat: 18,
      lng: -15,
      radius_m: 500,
    });
    expect(res.status).toBe(400);
  });

  it('creates a request and returns 201 with the service payload', async () => {
    svcMock.createRequest.mockResolvedValue({
      request: { id: 'req-1', status: 'searching' },
      providersNotified: 3,
    });
    const res = await api(app.baseUrl, 'POST', '/roadside/requests', {
      problem_type: 'pneu',
      lat: 18.08,
      lng: -15.97,
      note: 'crevaison',
    });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ request: { id: 'req-1', status: 'searching' }, providersNotified: 3 });
    expect(svcMock.createRequest).toHaveBeenCalledWith('user-1', expect.objectContaining({
      problemType: 'pneu',
      lat: 18.08,
      lng: -15.97,
      note: 'crevaison',
    }));
  });
});

describe('GET /roadside/requests/current', () => {
  it('returns 204 when there is no active request', async () => {
    svcMock.getCurrentForRequester.mockResolvedValue(null);
    const res = await api(app.baseUrl, 'GET', '/roadside/requests/current');
    expect(res.status).toBe(204);
  });

  it('wraps the active request in { request }', async () => {
    svcMock.getCurrentForRequester.mockResolvedValue({ id: 'req-1' });
    const res = await api(app.baseUrl, 'GET', '/roadside/requests/current');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ request: { id: 'req-1' } });
  });
});

describe('POST /roadside/requests/:id/cancel', () => {
  it('404s when the service reports nothing cancellable', async () => {
    svcMock.cancelRequest.mockResolvedValue(false);
    const res = await api(app.baseUrl, 'POST', '/roadside/requests/req-1/cancel', {});
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('request_not_found');
  });

  it('passes an optional reason string through', async () => {
    svcMock.cancelRequest.mockResolvedValue(true);
    const res = await api(app.baseUrl, 'POST', '/roadside/requests/req-1/cancel', { reason: 'fixed' });
    expect(res.status).toBe(200);
    expect(svcMock.cancelRequest).toHaveBeenCalledWith('req-1', 'user-1', 'fixed');
  });
});

describe('PUT /roadside/provider', () => {
  it('validates the specialties enum', async () => {
    const res = await api(app.baseUrl, 'PUT', '/roadside/provider', {
      offers_roadside: true,
      specialties: ['pneu', 'bogus'],
    });
    expect(res.status).toBe(400);
    expect(svcMock.setProviderProfile).not.toHaveBeenCalled();
  });

  it('defaults specialties to [] when omitted', async () => {
    svcMock.setProviderProfile.mockResolvedValue({ offersRoadside: true, specialties: [] });
    const res = await api(app.baseUrl, 'PUT', '/roadside/provider', { offers_roadside: true });
    expect(res.status).toBe(200);
    expect(svcMock.setProviderProfile).toHaveBeenCalledWith('user-1', true, []);
  });
});

describe('GET /roadside/inbox', () => {
  it('coerces lat/lng from the query string', async () => {
    svcMock.providerInbox.mockResolvedValue([{ id: 'req-1' }]);
    const res = await api(app.baseUrl, 'GET', '/roadside/inbox?lat=18.08&lng=-15.97');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ requests: [{ id: 'req-1' }] });
    expect(svcMock.providerInbox).toHaveBeenCalledWith('user-1', 18.08, -15.97);
  });

  it('400s when lat/lng are missing', async () => {
    const res = await api(app.baseUrl, 'GET', '/roadside/inbox');
    expect(res.status).toBe(400);
  });
});

describe('POST /roadside/requests/:id/accept', () => {
  it('maps the AcceptResult to snake_case response fields', async () => {
    svcMock.acceptRequest.mockResolvedValue({
      requestId: 'req-1',
      problemType: 'pneu',
      note: 'x',
      location: { lat: 1, lng: 2 },
      addressLabel: 'A',
      requesterName: 'Ali',
      requesterPhone: '22200',
    });
    const res = await api(app.baseUrl, 'POST', '/roadside/requests/req-1/accept', {});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      request_id: 'req-1',
      problem_type: 'pneu',
      note: 'x',
      location: { lat: 1, lng: 2 },
      address_label: 'A',
      requester_name: 'Ali',
      requester_phone: '22200',
    });
  });

  it('propagates a 409 already_taken from the service', async () => {
    svcMock.acceptRequest.mockRejectedValue(new HttpError(409, 'already_taken', 'taken'));
    const res = await api(app.baseUrl, 'POST', '/roadside/requests/req-1/accept', {});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('already_taken');
  });
});

describe('POST /roadside/requests/:id/status', () => {
  it('rejects a status other than in_progress/completed', async () => {
    const res = await api(app.baseUrl, 'POST', '/roadside/requests/req-1/status', { status: 'searching' });
    expect(res.status).toBe(400);
    expect(svcMock.updateProviderStatus).not.toHaveBeenCalled();
  });

  it('404s when the provider does not own an accepted/in-progress request', async () => {
    svcMock.updateProviderStatus.mockResolvedValue(false);
    const res = await api(app.baseUrl, 'POST', '/roadside/requests/req-1/status', { status: 'completed' });
    expect(res.status).toBe(404);
  });
});
