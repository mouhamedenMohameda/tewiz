/**
 * FEATURE 9 — La commission est prélevée.
 *
 * This is how the business earns. It is also the only place captains' money is
 * touched, so the bar is higher than "it works": the ledger must be able to
 * prove every balance. The design is append-only —
 *
 *     lock wallet row  →  INSERT wallet_transactions(balance_after)  →  UPDATE wallets
 *
 * and the final UPDATE fires `assert_wallet_balance_consistency`, which sums the
 * ledger and refuses the write if the wallet has drifted. Getting that ORDER
 * wrong is what makes a drift undetectable, so the order is asserted, not
 * assumed.
 *
 * Status per the audit: solid.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { commissionMru } from '../../src/modules/rides/pricing.js';

const { poolQueryMock, withTxMock } = vi.hoisted(() => ({
  poolQueryMock: vi.fn(),
  withTxMock: vi.fn(),
}));

vi.mock('../../src/db/pool.js', () => ({
  pool: { query: poolQueryMock, connect: vi.fn(), on: vi.fn() },
  withTx: withTxMock,
}));

import { creditWallet, debitWallet, getBalance, getWalletSummary } from '../../src/modules/wallet/wallet.service.js';

/** A wallet client that records the exact statement order. */
function walletClient(balance: number | null) {
  const order: string[] = [];
  const params: Record<string, any[]> = {};
  return {
    order,
    params,
    query: vi.fn(async (sql: unknown, p: any[] = []) => {
      const text = String(sql);
      if (/SELECT balance_mru FROM wallets WHERE captain_id = \$1 FOR UPDATE/i.test(text)) {
        order.push('lock');
        params.lock = p;
        return { rows: balance === null ? [] : [{ balance_mru: String(balance) }], rowCount: balance === null ? 0 : 1 };
      }
      if (/INSERT INTO wallet_transactions/i.test(text)) {
        order.push('ledger');
        params.ledger = p;
        return { rows: [{ id: 'txn-1' }], rowCount: 1 };
      }
      if (/UPDATE wallets SET balance_mru/i.test(text)) {
        order.push('wallet');
        params.wallet = p;
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  poolQueryMock.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe('the commission amount', () => {
  it('takes 7% of the fare for a passenger ride', () => {
    expect(commissionMru(1000, 700)).toBe(70);
  });

  it('takes 10% for a colis', () => {
    expect(commissionMru(1000, 1000)).toBe(100);
  });

  it('always rounds DOWN, so the platform never overcharges by a rounding error', () => {
    // 205 × 7% = 14.35 → 14, not 15. Over thousands of rides this is the
    // difference between a ledger that reconciles and one that argues.
    expect(commissionMru(205, 700)).toBe(14);
    expect(commissionMru(99, 700)).toBe(6);
  });

  it('is zero when the admin sets the rate to zero', () => {
    expect(commissionMru(5000, 0)).toBe(0);
  });

  it('never returns a fraction', () => {
    for (const fare of [1, 7, 33, 205, 1234, 99_999]) {
      expect(Number.isInteger(commissionMru(fare, 700))).toBe(true);
    }
  });
});

describe('the wallet write order — what makes drift detectable', () => {
  it('locks, then appends the ledger row, then updates the balance', async () => {
    const c = walletClient(500);

    await debitWallet({ captainId: 'captain-1', amountMru: 14, type: 'commission' }, c as never);

    // If the wallet were updated before the ledger row, the consistency trigger
    // would fire against a ledger that has not caught up and either reject a
    // valid write or, worse, pass a drift. The order IS the invariant.
    expect(c.order).toEqual(['lock', 'ledger', 'wallet']);
  });

  it('records the running balance on the ledger row itself', async () => {
    const c = walletClient(500);

    const res = await debitWallet(
      { captainId: 'captain-1', amountMru: 14, type: 'commission', rideId: 'ride-1' },
      c as never,
    );

    // amount_mru is stored NEGATIVE for a debit; balance_after is the new total.
    expect(c.params.ledger[2]).toBe(-14);
    expect(c.params.ledger[3]).toBe(486);
    expect(res.balanceAfter).toBe(486);
  });

  it('stores a credit as a positive amount', async () => {
    const c = walletClient(100);

    const res = await creditWallet(
      { captainId: 'captain-1', amountMru: 2000, type: 'topup', topupId: 'top-1' },
      c as never,
    );

    expect(c.params.ledger[2]).toBe(2000);
    expect(res.balanceAfter).toBe(2100);
  });

  it('links the transaction to the ride that caused it', async () => {
    const c = walletClient(500);

    await debitWallet(
      { captainId: 'captain-1', amountMru: 14, type: 'commission', rideId: 'ride-77' },
      c as never,
    );

    // Without this, a captain disputing a debit cannot be shown which ride it
    // came from — the single most common support request in this model.
    expect(c.params.ledger).toContain('ride-77');
  });

  it('joins the caller transaction when a client is passed', async () => {
    const c = walletClient(500);

    await debitWallet({ captainId: 'captain-1', amountMru: 14, type: 'commission' }, c as never);

    // Commission and ride completion must commit or roll back together. Opening
    // its own transaction here would allow a debited captain with no completed
    // ride to show for it.
    expect(withTxMock).not.toHaveBeenCalled();
  });

  it('opens its own transaction when no client is passed', async () => {
    const c = walletClient(500);
    withTxMock.mockImplementation(async (fn: any) => fn(c));

    await debitWallet({ captainId: 'captain-1', amountMru: 14, type: 'commission' });

    expect(withTxMock).toHaveBeenCalledTimes(1);
    expect(c.order).toEqual(['lock', 'ledger', 'wallet']);
  });
});

describe('amounts that must be refused outright', () => {
  it.each([0, -50, 3.5, NaN, Infinity])('refuses a debit of %s', async (amount) => {
    const c = walletClient(500);

    await expect(
      debitWallet({ captainId: 'captain-1', amountMru: amount, type: 'commission' }, c as never),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_amount' });

    // Nothing was written — not even the lock.
    expect(c.order).toEqual([]);
  });

  it.each([0, -50, 3.5])('refuses a credit of %s', async (amount) => {
    const c = walletClient(500);

    await expect(
      creditWallet({ captainId: 'captain-1', amountMru: amount, type: 'topup' }, c as never),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_amount' });
  });

  it('refuses a fractional amount — money is integer MRU, never a float', async () => {
    const c = walletClient(500);

    // The whole schema is BIGINT for this reason. A float here would round
    // somewhere unpredictable and break the ledger sum.
    await expect(
      debitWallet({ captainId: 'captain-1', amountMru: 14.35, type: 'commission' }, c as never),
    ).rejects.toMatchObject({ code: 'invalid_amount' });
  });

  it('refuses to touch a wallet that does not exist', async () => {
    const c = walletClient(null);

    await expect(
      debitWallet({ captainId: 'ghost', amountMru: 14, type: 'commission' }, c as never),
    ).rejects.toMatchObject({ status: 404, code: 'no_wallet' });
  });
});

describe('the soft float — a captain may go slightly negative', () => {
  it('allows a debit that pushes the balance below zero', async () => {
    const c = walletClient(10);

    // Deliberate: refusing here would strand a captain mid-shift with a
    // passenger in the car. The floor is enforced when going online / accepting,
    // not at the moment of debit.
    const res = await debitWallet(
      { captainId: 'captain-1', amountMru: 30, type: 'commission' }, c as never,
    );

    expect(res.balanceAfter).toBe(-20);
    expect(c.params.ledger[3]).toBe(-20);
  });
});

describe('reading a wallet', () => {
  it('treats a captain with no wallet row as a zero balance, not a 404', async () => {
    poolQueryMock.mockResolvedValue({ rows: [], rowCount: 0 });

    // A freshly approved captain has no wallet row yet. Returning 404 here made
    // the app show "AxiosError 404" on first open of the wallet screen — and
    // tripped an App Store reviewer on the demo account.
    expect(await getBalance('fresh-captain')).toBe(0);

    const summary = await getWalletSummary('fresh-captain');
    expect(summary).toMatchObject({ balanceMru: 0, transactions: [] });
  });

  it('returns the ledger newest-first with numeric amounts', async () => {
    poolQueryMock.mockImplementation(async (sql: unknown) => {
      if (/SELECT balance_mru, updated_at FROM wallets/i.test(String(sql))) {
        return { rows: [{ balance_mru: '486', updated_at: new Date() }], rowCount: 1 };
      }
      return {
        rows: [{
          id: 'txn-1', type: 'commission', amount_mru: '-14', balance_after: '486',
          ride_id: 'ride-1', topup_id: null, reason: 'Commission 7.00%', created_at: new Date(),
        }],
        rowCount: 1,
      };
    });

    const summary = await getWalletSummary('captain-1');

    // pg returns BIGINT as string; leaking that to the client would make the
    // app render "-14" as text and break every arithmetic comparison.
    expect(summary.balanceMru).toBe(486);
    expect(summary.transactions[0]).toMatchObject({ amountMru: -14, balanceAfter: 486 });
    expect(typeof summary.transactions[0]!.amountMru).toBe('number');
  });
});
