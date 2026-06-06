import crypto from 'node:crypto';
import { pool, withTx } from '../../db/pool.js';
import { HttpError } from '../../middleware/error.js';
import { defaultStorage } from '../storage/local-disk.js';
import { generateReferenceCode } from './codes.js';
import { creditWallet } from './wallet.service.js';
import type { TopupProvider, TopupStatus } from '@tewiz/shared-types';

interface CreateTopupInput {
  captainId: string;
  provider: TopupProvider;
  claimedAmountKhoums: number;
  providerRefNumber?: string | null;
  screenshot: { buffer: Buffer; mimeType: string };
}

interface TopupRow {
  id: string;
  captain_id: string;
  provider: TopupProvider;
  reference_code: string;
  claimed_amount_khoums: string;
  provider_ref_number: string | null;
  screenshot_storage_key: string;
  screenshot_hash: string | null;
  status: TopupStatus;
  approved_amount_khoums: string | null;
  reject_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  created_at: Date;
}

/**
 * Captain creates a new top-up request.
 *
 *   - Only one pending top-up per captain at a time (forces resolution).
 *   - Screenshot hashed; reuse rejected.
 *   - Reference code generated with retry on UNIQUE collision.
 */
export async function createTopup(input: CreateTopupInput): Promise<ReturnType<typeof shape>> {
  // 1. Captain may only have one pending top-up at a time.
  const existing = await pool.query(
    `SELECT id FROM topup_requests
      WHERE captain_id = $1 AND status = 'pending' LIMIT 1`,
    [input.captainId],
  );
  if ((existing.rowCount ?? 0) > 0) {
    throw new HttpError(409, 'topup_pending',
      'You already have a pending top-up. Wait for review or cancel it.');
  }

  // 2. Hash the screenshot — reject duplicates across the whole table.
  const hash = crypto.createHash('sha256').update(input.screenshot.buffer).digest('hex');
  const dup = await pool.query(
    `SELECT id FROM topup_requests WHERE screenshot_hash = $1 LIMIT 1`,
    [hash],
  );
  if ((dup.rowCount ?? 0) > 0) {
    throw new HttpError(400, 'duplicate_screenshot',
      'This screenshot has already been submitted');
  }

  // 3. Store the screenshot. Use a temporary key; rename if everything else
  // succeeds. Simpler: write under a UUID-ish key from the start.
  const storageKey = `topups/${input.captainId}/${Date.now()}-${hash.slice(0, 12)}.jpg`;
  await defaultStorage.put(storageKey, input.screenshot.buffer, input.screenshot.mimeType);

  // 4. Generate a reference code, retry on UNIQUE collision.
  let inserted: TopupRow | undefined;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
    const code = generateReferenceCode();
    try {
      const r = await pool.query<TopupRow>(
        `INSERT INTO topup_requests
           (captain_id, provider, reference_code, claimed_amount_khoums,
            provider_ref_number, screenshot_storage_key, screenshot_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          input.captainId,
          input.provider,
          code,
          input.claimedAmountKhoums,
          input.providerRefNumber ?? null,
          storageKey,
          hash,
        ],
      );
      inserted = r.rows[0];
    } catch (e: any) {
      // 23505 = unique_violation
      if (e?.code === '23505' && e?.constraint?.includes('reference_code')) {
        lastErr = e;
        continue;
      }
      // Cleanup stored file on unrecoverable failure
      await defaultStorage.delete(storageKey).catch(() => {});
      throw e;
    }
  }
  if (!inserted) {
    await defaultStorage.delete(storageKey).catch(() => {});
    throw lastErr ?? new HttpError(500, 'code_collision',
      'Could not generate unique reference code, please retry');
  }
  return shape(inserted);
}

/**
 * List my top-ups (captain side).
 */
export async function listMyTopups(captainId: string, limit = 50) {
  const r = await pool.query<TopupRow>(
    `SELECT * FROM topup_requests WHERE captain_id = $1
      ORDER BY created_at DESC LIMIT $2`,
    [captainId, limit],
  );
  return r.rows.map(shape);
}

/**
 * Admin: list top-ups filtered by status.
 */
export async function listTopupsForAdmin(opts: { status: TopupStatus; limit: number }) {
  const r = await pool.query<TopupRow & { captain_phone: string; captain_name: string | null }>(
    `SELECT t.*, u.phone AS captain_phone, u.full_name AS captain_name
       FROM topup_requests t
       JOIN users u ON u.id = t.captain_id
      WHERE t.status = $1
      ORDER BY t.created_at ASC
      LIMIT $2`,
    [opts.status, opts.limit],
  );
  return r.rows.map((row) => ({
    ...shape(row),
    captain: { phone: row.captain_phone, fullName: row.captain_name },
  }));
}

export async function getTopupForAdmin(id: string) {
  const r = await pool.query<TopupRow & { captain_phone: string; captain_name: string | null }>(
    `SELECT t.*, u.phone AS captain_phone, u.full_name AS captain_name
       FROM topup_requests t
       JOIN users u ON u.id = t.captain_id
      WHERE t.id = $1`,
    [id],
  );
  if (!r.rows[0]) throw new HttpError(404, 'not_found', 'Top-up not found');
  return {
    ...shape(r.rows[0]),
    captain: { phone: r.rows[0].captain_phone, fullName: r.rows[0].captain_name },
  };
}

export async function getTopupScreenshotKey(id: string): Promise<string> {
  const r = await pool.query<{ screenshot_storage_key: string }>(
    `SELECT screenshot_storage_key FROM topup_requests WHERE id = $1`,
    [id],
  );
  if (!r.rows[0]) throw new HttpError(404, 'not_found', 'Top-up not found');
  return r.rows[0].screenshot_storage_key;
}

interface ApproveInput {
  adminId: string;
  topupId: string;
  approvedAmountKhoums?: number;   // defaults to claimed
  providerRefNumber?: string;      // admin may fill or correct
}

export async function approveTopup(input: ApproveInput) {
  return withTx(async (client) => {
    const r = await client.query<TopupRow>(
      `SELECT * FROM topup_requests WHERE id = $1 FOR UPDATE`,
      [input.topupId],
    );
    const t = r.rows[0];
    if (!t) throw new HttpError(404, 'not_found', 'Top-up not found');
    if (t.status !== 'pending') {
      throw new HttpError(409, 'wrong_status',
        `Top-up is ${t.status}, cannot approve`);
    }

    const claimed = Number(t.claimed_amount_khoums);
    const approved = input.approvedAmountKhoums ?? claimed;
    if (!Number.isInteger(approved) || approved <= 0) {
      throw new HttpError(400, 'invalid_amount', 'Approved amount must be positive');
    }

    const status: TopupStatus = approved === claimed ? 'approved' : 'partial';

    // Credit wallet inside the same tx (atomic).
    const credit = await creditWallet({
      captainId: t.captain_id,
      amountKhoums: approved,
      type: 'topup',
      topupId: t.id,
      reason: `Top-up ${t.provider} (ref ${t.reference_code})`,
      createdBy: input.adminId,
    }, client);

    const updated = await client.query<TopupRow>(
      `UPDATE topup_requests
          SET status = $1, approved_amount_khoums = $2,
              provider_ref_number = COALESCE($3, provider_ref_number),
              reviewed_by = $4, reviewed_at = now()
        WHERE id = $5 RETURNING *`,
      [status, approved, input.providerRefNumber ?? null, input.adminId, t.id],
    );

    return { topup: shape(updated.rows[0]!), balanceAfter: credit.balanceAfter };
  });
}

interface RejectInput {
  adminId: string;
  topupId: string;
  reason: string;
}

export async function rejectTopup(input: RejectInput) {
  const r = await pool.query<TopupRow>(
    `UPDATE topup_requests
        SET status = 'rejected', reject_reason = $1,
            reviewed_by = $2, reviewed_at = now()
      WHERE id = $3 AND status = 'pending'
   RETURNING *`,
    [input.reason, input.adminId, input.topupId],
  );
  if (!r.rows[0]) throw new HttpError(409, 'wrong_status', 'Cannot reject');
  return shape(r.rows[0]);
}

// ────────────────────────────────────────────────────────────────────────────

function shape(t: TopupRow) {
  return {
    id: t.id,
    captainId: t.captain_id,
    provider: t.provider,
    referenceCode: t.reference_code,
    claimedAmountKhoums: Number(t.claimed_amount_khoums),
    providerRefNumber: t.provider_ref_number,
    status: t.status,
    approvedAmountKhoums: t.approved_amount_khoums === null ? null : Number(t.approved_amount_khoums),
    rejectReason: t.reject_reason,
    reviewedBy: t.reviewed_by,
    reviewedAt: t.reviewed_at,
    createdAt: t.created_at,
  };
}
