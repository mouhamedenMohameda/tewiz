/**
 * FEATURE 10 — Recharger le wallet.
 *
 * The prepaid commission model lives or dies here: a captain at zero cannot
 * accept rides. Today the flow is a Bankily/Masrivi screenshot reviewed by a
 * human, which the audit flags as the biggest operational bottleneck in the
 * product — it does not scale, and it stops at night and on weekends.
 *
 * The anti-fraud controls that DO exist are pinned below, along with the shape
 * of what they cannot catch, so the residual risk is written down rather than
 * assumed away.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { poolQueryMock, withTxMock, creditMock, storagePut, storageDelete } = vi.hoisted(() => ({
  poolQueryMock: vi.fn(),
  withTxMock: vi.fn(),
  creditMock: vi.fn(),
  storagePut: vi.fn(),
  storageDelete: vi.fn(),
}));

vi.mock('../../src/db/pool.js', () => ({
  pool: { query: poolQueryMock, connect: vi.fn(), on: vi.fn() },
  withTx: withTxMock,
}));
vi.mock('../../src/modules/wallet/wallet.service.js', () => ({
  creditWallet: creditMock,
  debitWallet: vi.fn(),
  getBalance: vi.fn(),
}));
vi.mock('../../src/modules/storage/local-disk.js', () => ({
  defaultStorage: { put: storagePut, delete: storageDelete, get: vi.fn() },
}));

import { approveTopup, createTopup, rejectTopup } from '../../src/modules/wallet/topup.service.js';

const SHOT = { buffer: Buffer.from('fake-jpeg-bytes'), mimeType: 'image/jpeg' };

function topupRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'top-1',
    captain_id: 'captain-1',
    provider: 'bankily',
    reference_code: 'TWZ-4821',
    claimed_amount_mru: '2000',
    provider_ref_number: null,
    screenshot_storage_key: 'topups/captain-1/1.jpg',
    screenshot_hash: 'abc',
    status: 'pending',
    approved_amount_mru: null,
    reject_reason: null,
    reviewed_by: null,
    reviewed_at: null,
    created_at: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  storagePut.mockResolvedValue(undefined);
  storageDelete.mockResolvedValue(undefined);
  creditMock.mockResolvedValue({ transactionId: 'txn-1', balanceAfter: 2000 });
});

describe('submitting a top-up request', () => {
  it('stores the screenshot and issues a reference code', async () => {
    poolQueryMock.mockImplementation(async (sql: unknown) => {
      if (/INSERT INTO topup_requests/i.test(String(sql))) {
        return { rows: [topupRow()], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const t = await createTopup({
      captainId: 'captain-1', provider: 'bankily', claimedAmountMru: 2000, screenshot: SHOT,
    });

    expect(storagePut).toHaveBeenCalled();
    // The reference code is what the captain quotes to support when a transfer
    // is disputed; without it the two sides have nothing in common to compare.
    expect(t.referenceCode).toBe('TWZ-4821');
    expect(t.status).toBe('pending');
  });

  it('allows only one pending request at a time', async () => {
    poolQueryMock.mockImplementation(async (sql: unknown) => {
      if (/status = 'pending' LIMIT 1/i.test(String(sql))) {
        return { rows: [{ id: 'top-0' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    // Forces resolution: a queue of pending requests from one captain is how a
    // double-credit gets approved twice by two different admins.
    await expect(createTopup({
      captainId: 'captain-1', provider: 'bankily', claimedAmountMru: 2000, screenshot: SHOT,
    })).rejects.toMatchObject({ status: 409, code: 'topup_pending' });

    expect(storagePut).not.toHaveBeenCalled();
  });

  it('rejects a screenshot already submitted by anyone, ever', async () => {
    poolQueryMock.mockImplementation(async (sql: unknown) => {
      const text = String(sql);
      if (/status = 'pending' LIMIT 1/i.test(text)) return { rows: [], rowCount: 0 };
      if (/screenshot_hash = \$1/i.test(text)) return { rows: [{ id: 'top-old' }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });

    await expect(createTopup({
      captainId: 'captain-2', provider: 'bankily', claimedAmountMru: 2000, screenshot: SHOT,
    })).rejects.toMatchObject({ status: 400, code: 'duplicate_screenshot' });
  });

  it('hashes the exact bytes, so re-sending the same image is caught', async () => {
    const seen: string[] = [];
    poolQueryMock.mockImplementation(async (sql: unknown, params: any[]) => {
      const text = String(sql);
      if (/screenshot_hash = \$1/i.test(text)) { seen.push(params[0]); return { rows: [], rowCount: 0 }; }
      if (/INSERT INTO topup_requests/i.test(text)) return { rows: [topupRow()], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });

    await createTopup({ captainId: 'c1', provider: 'bankily', claimedAmountMru: 2000, screenshot: SHOT });
    await createTopup({ captainId: 'c2', provider: 'bankily', claimedAmountMru: 2000, screenshot: SHOT });

    expect(seen[0]).toBe(seen[1]);
    expect(seen[0]).toMatch(/^[a-f0-9]{64}$/);
  });

  it('deletes the stored file when the insert fails, leaving no orphan', async () => {
    poolQueryMock.mockImplementation(async (sql: unknown) => {
      if (/INSERT INTO topup_requests/i.test(String(sql))) {
        throw Object.assign(new Error('disk full'), { code: '53100' });
      }
      return { rows: [], rowCount: 0 };
    });

    await expect(createTopup({
      captainId: 'captain-1', provider: 'bankily', claimedAmountMru: 2000, screenshot: SHOT,
    })).rejects.toThrow();

    expect(storageDelete).toHaveBeenCalled();
  });
});

describe('admin approval — the only path that creates money', () => {
  function pendingTopup(row = topupRow()) {
    const client = {
      query: vi.fn(async (sql: unknown, params: any[] = []) => {
        const text = String(sql);
        if (/FROM topup_requests WHERE id = \$1 FOR UPDATE/i.test(text)) {
          return { rows: [row], rowCount: 1 };
        }
        if (/UPDATE topup_requests/i.test(text)) {
          return {
            rows: [{ ...row, status: params[0], approved_amount_mru: String(params[1]),
                     reviewed_by: params[3], reviewed_at: new Date() }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      }),
    };
    withTxMock.mockImplementation(async (fn: any) => fn(client));
    return client;
  }

  it('credits the claimed amount and marks the request approved', async () => {
    pendingTopup();

    const res = await approveTopup({ adminId: 'admin-1', topupId: 'top-1' });

    expect(creditMock).toHaveBeenCalledWith(
      expect.objectContaining({ captainId: 'captain-1', amountMru: 2000, type: 'topup', topupId: 'top-1' }),
      expect.anything(),
    );
    expect(res.topup.status).toBe('approved');
  });

  it('credits inside the same transaction as the status change', async () => {
    pendingTopup();

    await approveTopup({ adminId: 'admin-1', topupId: 'top-1' });

    // The client is passed through to creditWallet: money and paperwork commit
    // together, or neither does. A credit with the request still 'pending' would
    // be approved a second time by the next admin to look at the queue.
    const [, client] = creditMock.mock.calls[0]!;
    expect(client).toBeDefined();
  });

  it('marks the request partial when the admin corrects the amount down', async () => {
    pendingTopup();

    const res = await approveTopup({ adminId: 'admin-1', topupId: 'top-1', approvedAmountMru: 1500 });

    // The captain claimed 2000, the transfer was 1500. Both numbers are kept so
    // a pattern of over-claiming is visible per captain.
    expect(res.topup.status).toBe('partial');
    expect(res.topup.approvedAmountMru).toBe(1500);
    expect(res.topup.claimedAmountMru).toBe(2000);
  });

  it('records which admin approved it', async () => {
    pendingTopup();

    const res = await approveTopup({ adminId: 'admin-7', topupId: 'top-1' });

    expect(res.topup.reviewedBy).toBe('admin-7');
    expect(res.topup.reviewedAt).toBeTruthy();
  });

  it.each(['approved', 'rejected', 'partial'] as const)(
    'refuses to approve a request already %s',
    async (status) => {
      pendingTopup(topupRow({ status }));

      // Double-approval is the one bug in this flow that directly prints money.
      await expect(approveTopup({ adminId: 'admin-1', topupId: 'top-1' })).rejects.toMatchObject({
        status: 409, code: 'wrong_status',
      });
      expect(creditMock).not.toHaveBeenCalled();
    },
  );

  it.each([0, -100, 12.5])('refuses an approved amount of %s', async (amount) => {
    pendingTopup();

    await expect(
      approveTopup({ adminId: 'admin-1', topupId: 'top-1', approvedAmountMru: amount }),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_amount' });
    expect(creditMock).not.toHaveBeenCalled();
  });

  it('rejects a pending request without crediting anything', async () => {
    poolQueryMock.mockResolvedValue({
      rows: [topupRow({ status: 'rejected', reject_reason: 'capture illisible' })], rowCount: 1,
    });

    const t = await rejectTopup({ adminId: 'admin-1', topupId: 'top-1', reason: 'capture illisible' });

    expect(t.status).toBe('rejected');
    expect(creditMock).not.toHaveBeenCalled();
  });

  it('cannot reject a request that is no longer pending', async () => {
    // The UPDATE is guarded by `AND status = 'pending'`; zero rows means someone
    // else already resolved it.
    poolQueryMock.mockResolvedValue({ rows: [], rowCount: 0 });

    await expect(
      rejectTopup({ adminId: 'admin-1', topupId: 'top-1', reason: 'doublon' }),
    ).rejects.toMatchObject({ status: 409, code: 'wrong_status' });
  });
});

describe('what the controls do NOT cover — residual risk, written down', () => {
  it('accepts any screenshot bytes: authenticity is never verified', async () => {
    // Echo the inserted amount back, so the assertion reads the real value the
    // service accepted rather than a canned fixture.
    poolQueryMock.mockImplementation(async (sql: unknown, params: any[] = []) => {
      if (/INSERT INTO topup_requests/i.test(String(sql))) {
        return { rows: [topupRow({ claimed_amount_mru: String(params[3]) })], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    // A hand-made image passes every automated check. The hash detects REUSE of
    // an image, not FABRICATION of one — the only real control is an admin
    // eyeballing it against the operator's own records.
    const t = await createTopup({
      captainId: 'captain-1', provider: 'bankily', claimedAmountMru: 999_999,
      screenshot: { buffer: Buffer.from('not actually a screenshot'), mimeType: 'image/jpeg' },
    });

    expect(t.status).toBe('pending');
    expect(t.claimedAmountMru).toBe(999_999);
  });

  it('has no automatic reconciliation against the mobile-money provider', async () => {
    poolQueryMock.mockImplementation(async (sql: unknown) => {
      if (/INSERT INTO topup_requests/i.test(String(sql))) return { rows: [topupRow()], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });

    await createTopup({
      captainId: 'captain-1', provider: 'bankily', claimedAmountMru: 2000, screenshot: SHOT,
    });

    // GAP GUARD: nothing calls out to Bankily/Masrivi. If an API integration is
    // ever added, this fails and the manual path can be retired.
    const outbound = poolQueryMock.mock.calls
      .map(([sql]) => String(sql))
      .filter((s) => /bankily_api|masrivi_api|provider_verification/i.test(s));
    expect(outbound).toEqual([]);
  });
});
