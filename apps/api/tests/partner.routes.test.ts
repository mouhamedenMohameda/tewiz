import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, startTestApp, type TestAppHandle } from './helpers/app.js';
import { dispatchSql, rows } from './helpers/db.js';

const { queryMock, findPartnerMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  findPartnerMock: vi.fn(),
}));

vi.mock('../src/db/pool.js', () => ({
  pool: { query: queryMock, connect: vi.fn(), on: vi.fn() },
  withTx: vi.fn(),
}));
vi.mock('../src/modules/partners/partners.service.js', () => ({
  findPartnerByUserId: findPartnerMock,
  shapePartner: (p: any) => ({ id: p.id, type: p.type, name: p.name }),
}));

import { partnerRouter } from '../src/modules/partners/partner.routes.js';
import { signAccessToken } from '../src/modules/auth/jwt.js';

function bearer(id = 'user-p1') {
  return {
    authorization: `Bearer ${signAccessToken({ sub: id, role: 'rider', adminRole: null, sid: 's1' })}`,
  };
}

const individualPartner = {
  id: 'partner-1',
  type: 'individual',
  name: 'Membre VIP',
  created_at: new Date('2026-01-01T00:00:00Z'),
  quota_months: 6,
  quota_courses: 50,
  window_max_courses: null,
};

let handle: TestAppHandle | null = null;

async function start() {
  handle = await startTestApp('/partner', partnerRouter);
  return handle;
}

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
  findPartnerMock.mockReset();
});

afterEach(async () => {
  if (handle) await handle.close();
  handle = null;
});

describe('partner guard', () => {
  it('requires authentication (401)', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/partner/me');
    expect(res.status).toBe(401);
  });

  it('rejects a signed-in user with no partner account (403)', async () => {
    findPartnerMock.mockResolvedValue(null);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/partner/me', undefined, bearer());
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('not_a_partner');
  });
});

describe('GET /partner/me', () => {
  it('returns quota progression for an individual member', async () => {
    findPartnerMock.mockResolvedValue(individualPartner);
    dispatchSql(queryMock, [
      [/GROUP BY status/, rows([{ status: 'pending', total: '1200', n: '4' }])],
      [/role = 'ride_creator'/, rows([{ n: '4' }])],
    ]);
    const { baseUrl } = await start();

    const res = await api(baseUrl, 'GET', '/partner/me', undefined, bearer());
    expect(res.status).toBe(200);
    expect(res.body.partner).toEqual({ id: 'partner-1', type: 'individual', name: 'Membre VIP' });
    expect(res.body.earningsByStatus.pending).toEqual({ totalMru: 1200, count: 4 });
    expect(res.body.quota).toMatchObject({ coursesUsed: 4, coursesMax: 50 });
    expect(res.body.windows).toBeNull();
  });

  it('returns courier windows for an agency', async () => {
    findPartnerMock.mockResolvedValue({
      ...individualPartner,
      id: 'partner-2',
      type: 'agency',
      window_max_courses: 100,
    });
    dispatchSql(queryMock, [
      [/GROUP BY status/, rows([])],
      [/FROM captain_partner_links/, rows([
        {
          captain_id: 'cap-1',
          full_name: 'Courier One',
          phone: '+22246000001',
          attached_at: '2026-06-01',
          expires_at: '2026-12-01',
          courses_counted: 12,
          closed_at: null,
          closure_bonus_paid: false,
        },
      ])],
    ]);
    const { baseUrl } = await start();

    const res = await api(baseUrl, 'GET', '/partner/me', undefined, bearer());
    expect(res.status).toBe(200);
    expect(res.body.quota).toBeNull();
    expect(res.body.windows).toHaveLength(1);
    expect(res.body.windows[0]).toMatchObject({
      captainId: 'cap-1',
      coursesCounted: 12,
      coursesMax: 100,
    });
  });
});

describe('GET /partner/earnings', () => {
  it('lists attributed rides with the ride context', async () => {
    findPartnerMock.mockResolvedValue(individualPartner);
    dispatchSql(queryMock, [
      [/FROM partner_earnings e/, rows([
        {
          id: 'e1',
          ride_id: 'r1',
          role: 'ride_creator',
          base_commission_mru: '70',
          share_bps: 2000,
          amount_mru: '14',
          status: 'pending',
          settlement_id: null,
          created_at: '2026-07-01',
          completed_at: '2026-07-01',
          pickup_label: 'Ksar',
          dropoff_label: 'Sebkha',
          ride_type: 'passenger',
        },
      ])],
    ]);
    const { baseUrl } = await start();

    const res = await api(baseUrl, 'GET', '/partner/earnings?status=pending&limit=10', undefined, bearer());
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({
      id: 'e1',
      amountMru: 14,
      baseCommissionMru: 70,
      ride: { pickupLabel: 'Ksar', dropoffLabel: 'Sebkha' },
    });
  });

  it('rejects an unknown status filter (400)', async () => {
    findPartnerMock.mockResolvedValue(individualPartner);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/partner/earnings?status=weird', undefined, bearer());
    expect(res.status).toBe(400);
  });
});

describe('GET /partner/settlements', () => {
  it('lists the monthly payout history', async () => {
    findPartnerMock.mockResolvedValue(individualPartner);
    dispatchSql(queryMock, [
      [/FROM partner_settlements/, rows([
        {
          id: 's1',
          period_start: '2026-06-01',
          period_end: '2026-06-30',
          total_mru: '450',
          status: 'paid',
          paid_at: '2026-07-01',
          note: null,
          created_at: '2026-07-01',
        },
      ])],
    ]);
    const { baseUrl } = await start();

    const res = await api(baseUrl, 'GET', '/partner/settlements', undefined, bearer());
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ id: 's1', totalMru: 450, status: 'paid' });
  });
});
