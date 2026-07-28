import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, startTestApp, type TestAppHandle } from './helpers/app.js';
import { HttpError } from '../src/middleware/error.js';

const { svcMock } = vi.hoisted(() => ({
  svcMock: {
    createJob: vi.fn(),
    listMyJobs: vi.fn(),
    getJobProposals: vi.fn(),
    acceptProposal: vi.fn(),
    cancelJob: vi.fn(),
    browseOpenJobs: vi.fn(),
    propose: vi.fn(),
    withdrawProposal: vi.fn(),
    listMyProposals: vi.fn(),
  },
}));

vi.mock('../src/modules/convoyage/convoyage.service.js', () => svcMock);
vi.mock('../src/middleware/auth.js', () => ({
  requireAuth: (_req: any, _res: any, next: () => void) => next(),
}));

import { convoyageRouter } from '../src/modules/convoyage/convoyage.routes.js';

const USER = { id: 'user-1', role: 'rider' as const };
const UUID = '11111111-1111-1111-1111-111111111111';
let app: TestAppHandle;

beforeEach(async () => {
  vi.clearAllMocks();
  app = await startTestApp('/convoyage', convoyageRouter, USER);
});
afterEach(async () => {
  await app.close();
});

describe('POST /convoyage/jobs', () => {
  it('rejects a too-short pickup_label with 400', async () => {
    const res = await api(app.baseUrl, 'POST', '/convoyage/jobs', {
      pickup_label: 'A',
      dropoff_label: 'Nouadhibou',
      vehicle_plate: 'AB-123',
    });
    expect(res.status).toBe(400);
    expect(svcMock.createJob).not.toHaveBeenCalled();
  });

  it('rejects a malformed desired_date with 400', async () => {
    const res = await api(app.baseUrl, 'POST', '/convoyage/jobs', {
      pickup_label: 'Nouakchott',
      dropoff_label: 'Nouadhibou',
      vehicle_plate: 'AB-123',
      desired_date: '15/08/2026',
    });
    expect(res.status).toBe(400);
  });

  it('creates a job and returns 201 { job }', async () => {
    svcMock.createJob.mockResolvedValue({ id: 'job-1', status: 'open' });
    const res = await api(app.baseUrl, 'POST', '/convoyage/jobs', {
      pickup_label: 'Nouakchott',
      dropoff_label: 'Nouadhibou',
      vehicle_plate: 'AB-123',
      desired_date: '2026-08-15',
    });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ job: { id: 'job-1', status: 'open' } });
    expect(svcMock.createJob).toHaveBeenCalledWith('user-1', expect.objectContaining({
      pickupLabel: 'Nouakchott',
      dropoffLabel: 'Nouadhibou',
      vehiclePlate: 'AB-123',
      desiredDate: '2026-08-15',
    }));
  });
});

describe('POST /convoyage/jobs/:id/accept', () => {
  it('requires a valid UUID proposal_id', async () => {
    const res = await api(app.baseUrl, 'POST', `/convoyage/jobs/${UUID}/accept`, { proposal_id: 'not-a-uuid' });
    expect(res.status).toBe(400);
    expect(svcMock.acceptProposal).not.toHaveBeenCalled();
  });

  it('propagates a 409 not_open from the service', async () => {
    svcMock.acceptProposal.mockRejectedValue(new HttpError(409, 'not_open', 'x'));
    const res = await api(app.baseUrl, 'POST', `/convoyage/jobs/${UUID}/accept`, { proposal_id: UUID });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('not_open');
  });

  it('returns { ok: true } on success', async () => {
    svcMock.acceptProposal.mockResolvedValue(undefined);
    const res = await api(app.baseUrl, 'POST', `/convoyage/jobs/${UUID}/accept`, { proposal_id: UUID });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(svcMock.acceptProposal).toHaveBeenCalledWith(UUID, UUID, 'user-1');
  });
});

describe('POST /convoyage/jobs/:id/cancel & /withdraw — 404 on no-op', () => {
  it('cancel 404s when nothing was cancellable', async () => {
    svcMock.cancelJob.mockResolvedValue(false);
    const res = await api(app.baseUrl, 'POST', `/convoyage/jobs/${UUID}/cancel`, {});
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('job_not_found');
  });
  it('withdraw 404s when there was no pending proposal', async () => {
    svcMock.withdrawProposal.mockResolvedValue(false);
    const res = await api(app.baseUrl, 'POST', `/convoyage/jobs/${UUID}/withdraw`, {});
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('proposal_not_found');
  });
});

describe('POST /convoyage/jobs/:id/propose', () => {
  it('rejects a negative price with 400', async () => {
    const res = await api(app.baseUrl, 'POST', `/convoyage/jobs/${UUID}/propose`, { price_mru: -1 });
    expect(res.status).toBe(400);
    expect(svcMock.propose).not.toHaveBeenCalled();
  });
  it('returns 201 on success and forwards the price/note', async () => {
    svcMock.propose.mockResolvedValue(undefined);
    const res = await api(app.baseUrl, 'POST', `/convoyage/jobs/${UUID}/propose`, { price_mru: 5000, note: 'ok' });
    expect(res.status).toBe(201);
    expect(svcMock.propose).toHaveBeenCalledWith(UUID, 'user-1', { priceMru: 5000, note: 'ok' });
  });
});

describe('list endpoints wrap in their envelopes', () => {
  it('GET /jobs/mine → { jobs }', async () => {
    svcMock.listMyJobs.mockResolvedValue([{ id: 'j1' }]);
    const res = await api(app.baseUrl, 'GET', '/convoyage/jobs/mine');
    expect(res.body).toEqual({ jobs: [{ id: 'j1' }] });
  });
  it('GET /open → { jobs }', async () => {
    svcMock.browseOpenJobs.mockResolvedValue([]);
    const res = await api(app.baseUrl, 'GET', '/convoyage/open');
    expect(res.body).toEqual({ jobs: [] });
  });
  it('GET /proposals/mine → { proposals }', async () => {
    svcMock.listMyProposals.mockResolvedValue([{ id: 'p1' }]);
    const res = await api(app.baseUrl, 'GET', '/convoyage/proposals/mine');
    expect(res.body).toEqual({ proposals: [{ id: 'p1' }] });
  });
});
