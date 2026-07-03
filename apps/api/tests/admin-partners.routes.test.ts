import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, startTestApp, type TestAppHandle } from './helpers/app.js';
import { dispatchSql, rows } from './helpers/db.js';

const { queryMock, txQueryMock, auditMock, partnersSvcMock, fraudScanMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  txQueryMock: vi.fn(),
  auditMock: vi.fn(),
  partnersSvcMock: {
    createPartner: vi.fn(),
    updatePartner: vi.fn(),
    shapePartner: (p: any) => ({ id: p.id, type: p.type, name: p.name }),
    PARTNER_COLUMNS: 'id, type, name, status, window_max_courses',
  },
  fraudScanMock: vi.fn(),
}));

vi.mock('../src/db/pool.js', () => ({
  pool: { query: queryMock, connect: vi.fn(), on: vi.fn() },
  withTx: async (fn: (client: { query: typeof txQueryMock }) => Promise<unknown>) =>
    fn({ query: txQueryMock }),
}));
vi.mock('../src/modules/admin/audit.js', () => ({ audit: auditMock }));
vi.mock('../src/modules/partners/partners.service.js', () => partnersSvcMock);
vi.mock('../src/modules/partners/fraud.service.js', () => ({
  scanPartnerEarnings: fraudScanMock,
}));

import { adminPartnersRouter } from '../src/modules/partners/admin-partners.routes.js';

const ADMIN = { id: 'admin-1', role: 'admin' as const, adminRole: 'finance' };
const UUID = '5f1e7a10-1111-4222-8333-444455556666';

let handle: TestAppHandle | null = null;

async function start() {
  handle = await startTestApp('/admin/partners', adminPartnersRouter, ADMIN);
  return handle;
}

beforeEach(() => {
  queryMock.mockReset();
  txQueryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
  txQueryMock.mockResolvedValue({ rows: [], rowCount: 0 });
  auditMock.mockReset();
  auditMock.mockResolvedValue(undefined);
  partnersSvcMock.createPartner.mockReset();
  partnersSvcMock.updatePartner.mockReset();
  fraudScanMock.mockReset();
});

afterEach(async () => {
  if (handle) await handle.close();
  handle = null;
});

describe('GET /admin/partners', () => {
  it('lists partners with the current-month snapshot', async () => {
    dispatchSql(queryMock, [
      [/FROM partners p/, rows([
        { id: 'p1', type: 'agency', name: 'Agence Nord', month_total_mru: '340', month_count: '12' },
      ])],
    ]);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/admin/partners?type=agency&status=active');
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ id: 'p1', monthTotalMru: 340, monthCount: 12 });
  });
});

describe('POST /admin/partners', () => {
  const body = { type: 'agency', name: 'Agence Sud', shareBps: 2000 };

  it('creates a partner without a login account', async () => {
    partnersSvcMock.createPartner.mockResolvedValue({ id: 'p2', type: 'agency', name: 'Agence Sud' });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/admin/partners', body);
    expect(res.status).toBe(201);
    expect(res.body.partnerPassword).toBeNull();
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'create_partner' }));
  });

  it('creates a fresh login account and returns its one-shot password', async () => {
    dispatchSql(queryMock, [
      [/SELECT id, role FROM users WHERE phone/, rows([])],
      [/INSERT INTO users/, rows([{ id: 'user-new' }])],
    ]);
    partnersSvcMock.createPartner.mockResolvedValue({ id: 'p3', type: 'agency', name: 'Agence Sud' });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/admin/partners', { ...body, userPhone: '45123456' });
    expect(res.status).toBe(201);
    expect(res.body.partnerPassword).toMatch(/^[A-Za-z2-9]{8}$/);
    expect(partnersSvcMock.createPartner).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-new' }),
    );
  });

  it('refuses to bind an admin account as partner login (400)', async () => {
    dispatchSql(queryMock, [
      [/SELECT id, role FROM users WHERE phone/, rows([{ id: 'admin-x', role: 'admin' }])],
    ]);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/admin/partners', { ...body, userPhone: '45123456' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('user_is_admin');
  });

  it('rejects a shareBps above 5000 (400)', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/admin/partners', { ...body, shareBps: 9000 });
    expect(res.status).toBe(400);
  });
});

describe('earnings registry', () => {
  it('GET /earnings lists with the ride context (literal path wins over /:id)', async () => {
    dispatchSql(queryMock, [
      [/FROM partner_earnings e/, rows([
        {
          id: 'e1',
          partner_id: 'p1',
          partner_name: 'Agence Nord',
          partner_code: 'NORD',
          ride_id: 'r1',
          role: 'courier_agency',
          base_commission_mru: '70',
          share_bps: 2000,
          amount_mru: '14',
          status: 'on_hold',
          hold_reason: 'pair_recurrence',
          settlement_id: null,
          created_at: '2026-07-01',
          completed_at: '2026-07-01',
          distance_m: 900,
          pickup_label: 'A',
          dropoff_label: 'B',
        },
      ])],
    ]);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/admin/partners/earnings?status=on_hold');
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({
      id: 'e1',
      holdReason: 'pair_recurrence',
      amountMru: 14,
    });
  });

  it('PATCH /earnings/:id returns 404 for an unknown earning', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'PATCH', '/admin/partners/earnings/e-x', { status: 'on_hold' });
    expect(res.status).toBe(404);
  });

  it('PATCH /earnings/:id refuses to touch a settled line (409)', async () => {
    dispatchSql(queryMock, [
      [/SELECT id, status, hold_reason FROM partner_earnings/, rows([{ id: 'e1', status: 'settled' }])],
    ]);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'PATCH', '/admin/partners/earnings/e1', { status: 'cancelled' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('already_settled');
  });

  it('PATCH /earnings/:id moderates a pending line', async () => {
    dispatchSql(queryMock, [
      [/SELECT id, status, hold_reason FROM partner_earnings/, rows([{ id: 'e1', status: 'pending' }])],
      [/UPDATE partner_earnings/, rows([{ id: 'e1', status: 'on_hold' }])],
    ]);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'PATCH', '/admin/partners/earnings/e1', {
      status: 'on_hold',
      reason: 'Vérification manuelle',
    });
    expect(res.status).toBe(200);
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'partner_earning_on_hold' }),
    );
  });
});

describe('POST /admin/partners/fraud-scan', () => {
  it('runs the fraud scan on demand', async () => {
    fraudScanMock.mockResolvedValue({ frozen: 2 });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/admin/partners/fraud-scan');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ frozen: 2 });
  });
});

describe('settlements', () => {
  it('GET /settlements lists with partner names', async () => {
    dispatchSql(queryMock, [
      [/FROM partner_settlements s/, rows([
        {
          id: 's1',
          partner_id: 'p1',
          partner_name: 'Agence Nord',
          partner_code: 'NORD',
          period_start: '2026-06-01',
          period_end: '2026-06-30',
          total_mru: '450',
          status: 'draft',
          paid_at: null,
          paid_by: null,
          note: null,
          created_at: '2026-07-01',
        },
      ])],
    ]);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/admin/partners/settlements');
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ id: 's1', totalMru: 450, status: 'draft' });
  });

  it('POST /:id/settlements rejects an inverted period (400)', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', `/admin/partners/${UUID}/settlements`, {
      periodStart: '2026-06-30',
      periodEnd: '2026-06-01',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_period');
  });

  it('POST /:id/settlements is a 409 when nothing is pending', async () => {
    dispatchSql(txQueryMock, [
      [/SELECT id FROM partners WHERE id .* FOR UPDATE/s, rows([{ id: UUID }])],
      [/INSERT INTO partner_settlements/, rows([{ id: 'settle-1' }])],
      [/WITH linked AS/s, rows([{ total: '0', n: '0' }])],
    ]);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', `/admin/partners/${UUID}/settlements`, {
      periodStart: '2026-06-01',
      periodEnd: '2026-06-30',
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('nothing_to_settle');
  });

  it('POST /:id/settlements bundles the pending lines into a draft (201)', async () => {
    dispatchSql(txQueryMock, [
      [/SELECT id FROM partners WHERE id .* FOR UPDATE/s, rows([{ id: UUID }])],
      [/INSERT INTO partner_settlements/, rows([{ id: 'settle-1' }])],
      [/WITH linked AS/s, rows([{ total: '450', n: '9' }])],
      [/UPDATE partner_settlements SET total_mru/, rows([{ id: 'settle-1', total_mru: 450, status: 'draft' }])],
    ]);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', `/admin/partners/${UUID}/settlements`, {
      periodStart: '2026-06-01',
      periodEnd: '2026-06-30',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: 'settle-1', earningsCount: 9 });
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'generate_partner_settlement' }),
    );
  });

  it('POST /settlements/:id/pay flips the earnings to settled', async () => {
    dispatchSql(txQueryMock, [
      [/UPDATE partner_settlements/, rows([{ id: 'settle-1', status: 'paid' }])],
    ]);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/admin/partners/settlements/settle-1/pay');
    expect(res.status).toBe(200);
    const flip = txQueryMock.mock.calls.find((c) =>
      String(c[0]).includes("SET status = 'settled'"),
    );
    expect(flip![1]).toEqual(['settle-1']);
  });

  it('POST /settlements/:id/pay on a paid settlement is a 409', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/admin/partners/settlements/settle-1/pay');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('not_draft');
  });
});

describe('links + detail + update', () => {
  it('GET /links lists every courier window', async () => {
    dispatchSql(queryMock, [
      [/FROM captain_partner_links l/, rows([
        {
          captain_id: 'cap-1',
          captain_name: 'Courier',
          captain_phone: '+22246000001',
          partner_id: 'p1',
          partner_name: 'Agence Nord',
          partner_code: 'NORD',
          window_max_courses: 100,
          attached_at: '2026-06-01',
          expires_at: '2026-12-01',
          courses_counted: 4,
          closed_at: null,
          closure_bonus_paid: false,
        },
      ])],
    ]);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/admin/partners/links');
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ captainId: 'cap-1', coursesMax: 100 });
  });

  it('GET /:id returns 404 for an unknown partner', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/admin/partners/ghost');
    expect(res.status).toBe(404);
  });

  it('GET /:id returns the partner with links and totals', async () => {
    dispatchSql(queryMock, [
      [/FROM partners WHERE id/, rows([{ id: 'p1', type: 'agency', name: 'Agence Nord', window_max_courses: 100 }])],
      [/FROM captain_partner_links/, rows([])],
      [/GROUP BY status/, rows([{ status: 'pending', total: '100', n: '2' }])],
    ]);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/admin/partners/p1');
    expect(res.status).toBe(200);
    expect(res.body.earningsByStatus.pending).toEqual({ totalMru: 100, count: 2 });
  });

  it('PATCH /:id updates the contract terms', async () => {
    dispatchSql(queryMock, [
      [/FROM partners WHERE id/, rows([{ id: 'p1', type: 'agency', name: 'Agence Nord' }])],
    ]);
    partnersSvcMock.updatePartner.mockResolvedValue({ id: 'p1', name: 'Agence Nord', shareBps: 2500 });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'PATCH', '/admin/partners/p1', { shareBps: 2500 });
    expect(res.status).toBe(200);
    expect(partnersSvcMock.updatePartner).toHaveBeenCalledWith('p1', { shareBps: 2500 });
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'update_partner' }));
  });
});
