import { beforeEach, describe, expect, it, vi } from 'vitest';

// Convoyage job board. acceptProposal runs inside withTx, so we drive the same
// fake transaction client used by the car-rental service test; the plain
// pool.query path covers propose/withdraw/cancel and the DTO mappers.

const { sendNotificationMock, fakeClient, state } = vi.hoisted(() => {
  const state = {
    clientQueries: [] as string[],
    clientResponder: (_sql: string) => ({ rows: [] as any[], rowCount: 0 }),
    poolResponder: (_sql: string) => ({ rows: [] as any[], rowCount: 0 }),
  };
  const fakeClient = {
    query: vi.fn(async (sql: string) => {
      state.clientQueries.push(sql.replace(/\s+/g, ' ').trim());
      return state.clientResponder(sql);
    }),
    release: vi.fn(),
  };
  return { sendNotificationMock: vi.fn(async () => {}), fakeClient, state };
});

vi.mock('../src/db/pool.js', () => ({
  pool: { query: vi.fn(async (sql: string) => state.poolResponder(sql)) },
  withTx: async (fn: (c: typeof fakeClient) => Promise<unknown>) => {
    await fakeClient.query('BEGIN');
    try {
      const r = await fn(fakeClient);
      await fakeClient.query('COMMIT');
      return r;
    } catch (e) {
      await fakeClient.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      fakeClient.release();
    }
  },
}));
vi.mock('../src/modules/notifications/notifications.service.js', () => ({
  sendNotification: sendNotificationMock,
}));

import {
  acceptProposal,
  propose,
  cancelJob,
  withdrawProposal,
  listMyJobs,
  getJobProposals,
} from '../src/modules/convoyage/convoyage.service.js';
import { pool } from '../src/db/pool.js';

const poolQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  state.clientQueries = [];
  state.clientResponder = () => ({ rows: [], rowCount: 0 });
  state.poolResponder = () => ({ rows: [], rowCount: 0 });
});

describe('acceptProposal — transactional selection', () => {
  it('assigns the job, accepts the winner, rejects the rest, and notifies', async () => {
    state.clientResponder = (sql) => {
      if (sql.includes('FROM convoyage_jobs') && sql.includes('FOR UPDATE'))
        return { rows: [{ status: 'open' }], rowCount: 1 };
      if (sql.includes('FROM convoyage_proposals WHERE id'))
        return { rows: [{ provider_id: 'prov-1' }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    };

    await acceptProposal('job-1', 'prop-1', 'client-1');

    expect(state.clientQueries[0]).toBe('BEGIN');
    expect(state.clientQueries).toContain('COMMIT');
    expect(state.clientQueries.some((q) => q.startsWith("UPDATE convoyage_proposals SET status = 'accepted'"))).toBe(true);
    expect(state.clientQueries.some((q) => q.includes("SET status = 'rejected'") && q.includes('id <> $2'))).toBe(true);
    expect(state.clientQueries.some((q) => q.includes("UPDATE convoyage_jobs SET status = 'assigned'"))).toBe(true);
    expect(sendNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({ target: { type: 'user', userId: 'prov-1' } }),
    );
  });

  it('rolls back with 404 when the job is not owned/found', async () => {
    state.clientResponder = () => ({ rows: [], rowCount: 0 });
    await expect(acceptProposal('job-1', 'prop-1', 'client-1')).rejects.toMatchObject({
      status: 404,
      code: 'job_not_found',
    });
    expect(state.clientQueries).toContain('ROLLBACK');
    expect(sendNotificationMock).not.toHaveBeenCalled();
  });

  it('rolls back with 409 when the job is no longer open', async () => {
    state.clientResponder = (sql) =>
      sql.includes('FOR UPDATE') ? { rows: [{ status: 'assigned' }], rowCount: 1 } : { rows: [], rowCount: 0 };
    await expect(acceptProposal('job-1', 'prop-1', 'client-1')).rejects.toMatchObject({
      status: 409,
      code: 'not_open',
    });
    expect(state.clientQueries).toContain('ROLLBACK');
  });

  it('rolls back with 404 when the chosen proposal is not pending', async () => {
    state.clientResponder = (sql) =>
      sql.includes('FOR UPDATE') ? { rows: [{ status: 'open' }], rowCount: 1 } : { rows: [], rowCount: 0 };
    await expect(acceptProposal('job-1', 'prop-1', 'client-1')).rejects.toMatchObject({
      status: 404,
      code: 'proposal_not_found',
    });
    expect(state.clientQueries).toContain('ROLLBACK');
  });
});

describe('propose', () => {
  it('rejects proposing on a job that is not open (404)', async () => {
    state.poolResponder = () => ({ rows: [{ client_id: 'c1', status: 'assigned' }], rowCount: 1 });
    await expect(propose('job-1', 'prov-1', {})).rejects.toMatchObject({ status: 404, code: 'job_unavailable' });
  });

  it('rejects proposing on your own job (400)', async () => {
    state.poolResponder = () => ({ rows: [{ client_id: 'prov-1', status: 'open' }], rowCount: 1 });
    await expect(propose('job-1', 'prov-1', {})).rejects.toMatchObject({ status: 400, code: 'own_job' });
  });

  it('upserts the proposal and notifies the client on success', async () => {
    state.poolResponder = (sql) => {
      if (sql.includes('SELECT client_id, status')) return { rows: [{ client_id: 'c1', status: 'open' }], rowCount: 1 };
      if (sql.includes('INSERT INTO convoyage_proposals')) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    };
    await propose('job-1', 'prov-1', { priceMru: 5000, note: '  quick  ' });
    // Notification fires only when a row was actually written.
    expect(sendNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({ target: { type: 'user', userId: 'c1' } }),
    );
  });
});

describe('cancelJob / withdrawProposal — rowCount → boolean', () => {
  it('cancelJob true when a row updated, false otherwise', async () => {
    state.poolResponder = () => ({ rows: [], rowCount: 1 });
    expect(await cancelJob('job-1', 'c1')).toBe(true);
    state.poolResponder = () => ({ rows: [], rowCount: 0 });
    expect(await cancelJob('job-1', 'c1')).toBe(false);
  });
  it('withdrawProposal reflects rowCount', async () => {
    state.poolResponder = () => ({ rows: [], rowCount: 0 });
    expect(await withdrawProposal('job-1', 'prov-1')).toBe(false);
  });
});

describe('toJobDTO (via listMyJobs)', () => {
  it('reveals the provider block only once a phone is present and trims desired_date to YYYY-MM-DD', async () => {
    state.poolResponder = () => ({
      rows: [
        {
          id: 'j1',
          pickup_label: 'A',
          dropoff_label: 'B',
          vehicle_plate: 'AB-123',
          vehicle_model: null,
          desired_date: new Date('2026-08-15T00:00:00.000Z'),
          note: null,
          status: 'assigned',
          created_at: new Date('2026-07-01T00:00:00.000Z'),
          proposal_count: '2',
          provider_name: 'Sidi',
          provider_phone: '22233',
          provider_rating: '4.8',
        },
        {
          id: 'j2',
          pickup_label: 'C',
          dropoff_label: 'D',
          vehicle_plate: 'CD-456',
          vehicle_model: 'Hilux',
          desired_date: null,
          note: null,
          status: 'open',
          created_at: new Date('2026-07-02T00:00:00.000Z'),
          proposal_count: '0',
          provider_name: null,
          provider_phone: null,
          provider_rating: null,
        },
      ],
      rowCount: 2,
    });

    const jobs = await listMyJobs('c1');
    expect(jobs[0].provider).toEqual({ name: 'Sidi', phone: '22233', ratingAvg: 4.8 });
    expect(jobs[0].desiredDate).toBe('2026-08-15');
    expect(jobs[0].proposalCount).toBe(2);
    // Open job with no assigned provider → provider null, date null.
    expect(jobs[1].provider).toBeNull();
    expect(jobs[1].desiredDate).toBeNull();
  });
});

describe('getJobProposals — ownership guard', () => {
  it('404s when the caller does not own the job', async () => {
    state.poolResponder = () => ({ rows: [], rowCount: 0 }); // ownership check empty
    await expect(getJobProposals('job-1', 'not-owner')).rejects.toMatchObject({
      status: 404,
      code: 'job_not_found',
    });
    // Never runs the proposals query.
    expect(poolQuery).toHaveBeenCalledTimes(1);
  });
});
