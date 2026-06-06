import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { pool } from '../../db/pool.js';
import { env } from '../../config/env.js';
import { HttpError } from '../../middleware/error.js';

/**
 * Generate a 6-digit OTP. Leading zeros preserved.
 */
export function generateOtp(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/**
 * Hash an OTP for storage. bcrypt is overkill for a 6-digit code but the
 * verification cost (~50ms) is a useful brute-force speed bump.
 */
export async function hashOtp(code: string): Promise<string> {
  return bcrypt.hash(code, 8);
}

export async function verifyOtpHash(code: string, hash: string): Promise<boolean> {
  return bcrypt.compare(code, hash);
}

export async function storeOtp(phone: string, codeHash: string, purpose: string): Promise<void> {
  // Invalidate any previous unused OTPs for the same (phone, purpose).
  await pool.query(
    `UPDATE otp_codes
       SET consumed_at = now()
     WHERE phone = $1 AND purpose = $2 AND consumed_at IS NULL`,
    [phone, purpose],
  );
  await pool.query(
    `INSERT INTO otp_codes (phone, code_hash, purpose, expires_at)
     VALUES ($1, $2, $3, now() + ($4 || ' seconds')::interval)`,
    [phone, codeHash, purpose, env.OTP_TTL_SECONDS.toString()],
  );
}

interface ConsumeResult {
  ok: boolean;
  reason?: 'no_code' | 'expired' | 'too_many_attempts' | 'invalid';
}

export async function consumeOtp(
  phone: string,
  code: string,
  purpose: string,
): Promise<ConsumeResult> {
  const { rows } = await pool.query<{
    id: string;
    code_hash: string;
    expires_at: Date;
    attempts: number;
  }>(
    `SELECT id, code_hash, expires_at, attempts
       FROM otp_codes
      WHERE phone = $1 AND purpose = $2 AND consumed_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1`,
    [phone, purpose],
  );

  const row = rows[0];
  if (!row) return { ok: false, reason: 'no_code' };
  if (row.expires_at.getTime() < Date.now()) return { ok: false, reason: 'expired' };
  if (row.attempts >= env.OTP_MAX_ATTEMPTS) return { ok: false, reason: 'too_many_attempts' };

  const valid = await verifyOtpHash(code, row.code_hash);

  if (!valid) {
    await pool.query('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1', [row.id]);
    return { ok: false, reason: 'invalid' };
  }

  await pool.query('UPDATE otp_codes SET consumed_at = now() WHERE id = $1', [row.id]);
  return { ok: true };
}

/**
 * Throws if a phone is requesting OTPs too often. Basic rate limit.
 */
export async function assertNotRateLimited(phone: string): Promise<void> {
  const { rows } = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
       FROM otp_codes
      WHERE phone = $1 AND created_at > now() - interval '10 minutes'`,
    [phone],
  );
  if (Number(rows[0]?.n ?? 0) >= 5) {
    throw new HttpError(429, 'rate_limited', 'Too many OTP requests, try again later');
  }
}
