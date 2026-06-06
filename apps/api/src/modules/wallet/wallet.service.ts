import type pg from 'pg';
import { pool, withTx } from '../../db/pool.js';
import { HttpError } from '../../middleware/error.js';
import type { WalletTxType } from '@tewiz/shared-types';

export interface CreditOptions {
  captainId: string;
  amountKhoums: number;          // POSITIVE integer
  type: Extract<WalletTxType, 'topup' | 'bonus' | 'manual_adjustment' | 'commission_refund'>;
  topupId?: string | null;
  rideId?: string | null;
  reason?: string | null;
  createdBy?: string | null;     // admin user id, or null for system
}

export interface DebitOptions {
  captainId: string;
  amountKhoums: number;          // POSITIVE integer; will be stored as negative
  type: Extract<WalletTxType, 'commission' | 'manual_adjustment'>;
  rideId?: string | null;
  reason?: string | null;
  createdBy?: string | null;
}

export interface TxResult {
  transactionId: string;
  balanceAfter: number;
}

/**
 * Credit the captain wallet inside a transaction.
 *
 * Order matters:
 *   1. SELECT ... FOR UPDATE locks the wallet row
 *   2. INSERT into wallet_transactions with balance_after = new total
 *   3. UPDATE wallets.balance_khoums to the new total
 *
 * Step 3 triggers `assert_wallet_balance_consistency`, which sums the ledger
 * and refuses the UPDATE if the wallet drifts from the sum.
 *
 * If you already hold a tx (e.g. inside topup approval), pass the client.
 */
export async function creditWallet(
  opts: CreditOptions,
  client?: pg.PoolClient,
): Promise<TxResult> {
  if (!Number.isInteger(opts.amountKhoums) || opts.amountKhoums <= 0) {
    throw new HttpError(400, 'invalid_amount', 'Credit amount must be positive integer khoums');
  }
  const run = (c: pg.PoolClient) => mutateWallet(c, {
    captainId: opts.captainId,
    delta: opts.amountKhoums,
    type: opts.type,
    topupId: opts.topupId ?? null,
    rideId: opts.rideId ?? null,
    reason: opts.reason ?? null,
    createdBy: opts.createdBy ?? null,
  });
  return client ? run(client) : withTx(run);
}

/**
 * Debit the captain wallet (e.g. ride commission).
 *
 * Will go negative down to env.NEGATIVE_BALANCE_FLOOR_KHOUMS (soft float).
 * Beyond that, the operation is refused — callers should check eligibility
 * before attempting; this is the hard floor.
 */
export async function debitWallet(
  opts: DebitOptions,
  client?: pg.PoolClient,
): Promise<TxResult> {
  if (!Number.isInteger(opts.amountKhoums) || opts.amountKhoums <= 0) {
    throw new HttpError(400, 'invalid_amount', 'Debit amount must be positive integer khoums');
  }
  const run = (c: pg.PoolClient) => mutateWallet(c, {
    captainId: opts.captainId,
    delta: -opts.amountKhoums,
    type: opts.type,
    topupId: null,
    rideId: opts.rideId ?? null,
    reason: opts.reason ?? null,
    createdBy: opts.createdBy ?? null,
  });
  return client ? run(client) : withTx(run);
}

interface MutateInput {
  captainId: string;
  delta: number;             // signed
  type: WalletTxType;
  topupId: string | null;
  rideId: string | null;
  reason: string | null;
  createdBy: string | null;
}

async function mutateWallet(c: pg.PoolClient, m: MutateInput): Promise<TxResult> {
  const lock = await c.query<{ balance_khoums: string }>(
    `SELECT balance_khoums FROM wallets WHERE captain_id = $1 FOR UPDATE`,
    [m.captainId],
  );
  if (!lock.rows[0]) {
    throw new HttpError(404, 'no_wallet', 'No wallet for captain');
  }
  const current = Number(lock.rows[0].balance_khoums);
  const next = current + m.delta;

  // We intentionally do not check NEGATIVE_BALANCE_FLOOR here; callers should
  // pre-check. But the trigger and any sanity checks would catch arithmetic
  // overflow if we ever change types.
  const txn = await c.query<{ id: string }>(
    `INSERT INTO wallet_transactions
       (captain_id, type, amount_khoums, balance_after, ride_id, topup_id, reason, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [m.captainId, m.type, m.delta, next, m.rideId, m.topupId, m.reason, m.createdBy],
  );

  await c.query(
    `UPDATE wallets SET balance_khoums = $1, updated_at = now() WHERE captain_id = $2`,
    [next, m.captainId],
  );

  return { transactionId: txn.rows[0]!.id, balanceAfter: next };
}

/**
 * Read-only: balance + recent N transactions.
 */
export async function getWalletSummary(captainId: string, limit = 20) {
  const w = await pool.query<{ balance_khoums: string; updated_at: Date }>(
    `SELECT balance_khoums, updated_at FROM wallets WHERE captain_id = $1`,
    [captainId],
  );
  if (!w.rows[0]) throw new HttpError(404, 'no_wallet', 'No wallet');

  const txs = await pool.query(
    `SELECT id, type, amount_khoums, balance_after, ride_id, topup_id, reason, created_at
       FROM wallet_transactions
      WHERE captain_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [captainId, limit],
  );

  return {
    balanceKhoums: Number(w.rows[0].balance_khoums),
    updatedAt: w.rows[0].updated_at,
    transactions: txs.rows.map((t) => ({
      id: t.id,
      type: t.type,
      amountKhoums: Number(t.amount_khoums),
      balanceAfter: Number(t.balance_after),
      rideId: t.ride_id,
      topupId: t.topup_id,
      reason: t.reason,
      createdAt: t.created_at,
    })),
  };
}

/**
 * Read-only: balance only (cheap).
 */
export async function getBalance(captainId: string): Promise<number> {
  const r = await pool.query<{ balance_khoums: string }>(
    `SELECT balance_khoums FROM wallets WHERE captain_id = $1`,
    [captainId],
  );
  if (!r.rows[0]) throw new HttpError(404, 'no_wallet', 'No wallet');
  return Number(r.rows[0].balance_khoums);
}
