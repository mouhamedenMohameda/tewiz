import { Router } from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { env } from '../../config/env.js';
import { HttpError } from '../../middleware/error.js';
import { phoneSchema } from './phone.js';
import { assertNotRateLimited, consumeOtp, generateOtp, hashOtp, storeOtp } from './otp.js';
import { sms } from './sms.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from './jwt.js';
import type { UserRole } from '@tewiz/shared-types';

export const authRouter = Router();

/**
 * POST /auth/otp/request
 * Body: { phone, role }
 * Sends an OTP via SMS (or logs it in dev).
 * In dev, the response includes the OTP for convenience.
 */
const requestOtpBody = z.object({
  phone: phoneSchema,
  role: z.enum(['rider', 'captain', 'admin']).optional(),
});

authRouter.post('/otp/request', async (req, res) => {
  const { phone } = requestOtpBody.parse(req.body);

  await assertNotRateLimited(phone);

  const code = generateOtp();
  const codeHash = await hashOtp(code);
  await storeOtp(phone, codeHash, 'login');

  await sms.send(phone, `Tewiz: votre code de connexion est ${code}. Valable ${env.OTP_TTL_SECONDS / 60} min.`);

  res.json({
    ok: true,
    ...(env.NODE_ENV === 'development' ? { _devCode: code } : {}),
  });
});

/**
 * POST /auth/otp/verify
 * Body: { phone, code, role, deviceId, fullName? }
 * Creates the user if not present, opens a session, returns tokens.
 */
const verifyOtpBody = z.object({
  phone: phoneSchema,
  code: z.string().regex(/^\d{6}$/),
  role: z.enum(['rider', 'captain', 'admin']),
  deviceId: z.string().min(8).max(128),
  fullName: z.string().min(2).max(100).optional(),
});

authRouter.post('/otp/verify', async (req, res) => {
  const { phone, code, role, deviceId, fullName } = verifyOtpBody.parse(req.body);

  const result = await consumeOtp(phone, code, 'login');
  if (!result.ok) {
    throw new HttpError(400, 'otp_' + result.reason, 'OTP invalid or expired');
  }

  // Find or create the user.
  // NOTE: for captain role, this only creates the *user* (auth identity).
  // The captains row is created only after KYC approval (different flow).
  let userRow = await findUserByPhone(phone);
  if (!userRow) {
    userRow = await createUser(phone, role, fullName ?? null);
  } else {
    // The DB role is the source of truth. The requested `role` is just the
    // app context. We allow login as long as:
    //   - the user isn't trying to claim admin from a non-admin account
    //   - the user isn't an admin trying to log in via a non-admin app
    // Rider <-> captain transitions are allowed (a rider whose captain
    // application got approved can sign in from the rider app and still
    // be recognized as a captain).
    if (role === 'admin' && userRow.role !== 'admin') {
      throw new HttpError(403, 'role_mismatch', 'Not an administrator');
    }
    if (userRow.role === 'admin' && role !== 'admin') {
      throw new HttpError(403, 'role_mismatch', 'Admin must sign in via admin app');
    }
  }

  // Issue session + tokens.
  const sessionId = crypto.randomUUID();
  const accessToken = signAccessToken({ sub: userRow.id, role: userRow.role, sid: sessionId });
  const refreshToken = signRefreshToken({ sub: userRow.id, sid: sessionId });
  const refreshHash = await bcrypt.hash(refreshToken, 8);

  await pool.query(
    `INSERT INTO sessions (id, user_id, device_id, refresh_token_hash, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + ($6 || ' seconds')::interval)`,
    [
      sessionId,
      userRow.id,
      deviceId,
      refreshHash,
      req.headers['user-agent'] ?? null,
      env.JWT_REFRESH_TTL_SECONDS.toString(),
    ],
  );

  await pool.query('UPDATE users SET last_seen_at = now() WHERE id = $1', [userRow.id]);

  res.json({
    user: {
      id: userRow.id,
      phone: userRow.phone,
      role: userRow.role,
      fullName: userRow.full_name,
      language: userRow.language,
    },
    tokens: {
      accessToken,
      refreshToken,
      accessExpiresIn: env.JWT_ACCESS_TTL_SECONDS,
      refreshExpiresIn: env.JWT_REFRESH_TTL_SECONDS,
    },
  });
});

/**
 * POST /auth/refresh
 * Body: { refreshToken }
 */
const refreshBody = z.object({ refreshToken: z.string() });

authRouter.post('/refresh', async (req, res) => {
  const { refreshToken } = refreshBody.parse(req.body);

  let payload: { sub: string; sid: string };
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw new HttpError(401, 'invalid_refresh', 'Refresh token invalid or expired');
  }

  const { rows } = await pool.query<{ refresh_token_hash: string; revoked_at: Date | null }>(
    `SELECT refresh_token_hash, revoked_at
       FROM sessions WHERE id = $1 AND user_id = $2`,
    [payload.sid, payload.sub],
  );
  const session = rows[0];
  if (!session || session.revoked_at) {
    throw new HttpError(401, 'session_revoked', 'Session revoked');
  }

  const ok = await bcrypt.compare(refreshToken, session.refresh_token_hash);
  if (!ok) throw new HttpError(401, 'invalid_refresh', 'Refresh token mismatch');

  const user = await getUserById(payload.sub);
  if (!user) throw new HttpError(401, 'user_missing', 'User not found');

  await pool.query('UPDATE sessions SET last_used_at = now() WHERE id = $1', [payload.sid]);

  const accessToken = signAccessToken({ sub: user.id, role: user.role, sid: payload.sid });
  res.json({ accessToken, accessExpiresIn: env.JWT_ACCESS_TTL_SECONDS });
});

/**
 * POST /auth/logout
 * Header: Authorization: Bearer <accessToken>
 * Revokes the current session.
 */
authRouter.post('/logout', async (req, res) => {
  // Lightweight: just revoke whatever session id is provided.
  // Full auth middleware comes later.
  const refreshToken = req.body?.refreshToken;
  if (!refreshToken) {
    res.json({ ok: true });
    return;
  }
  try {
    const payload = verifyRefreshToken(refreshToken);
    await pool.query('UPDATE sessions SET revoked_at = now() WHERE id = $1', [payload.sid]);
  } catch {
    // Even on error, treat as logged out.
  }
  res.json({ ok: true });
});

// --- Helpers ---

interface UserRow {
  id: string;
  phone: string;
  role: UserRole;
  full_name: string | null;
  language: 'fr' | 'ar' | 'en';
}

async function findUserByPhone(phone: string): Promise<UserRow | null> {
  const { rows } = await pool.query<UserRow>(
    `SELECT id, phone, role, full_name, language FROM users WHERE phone = $1`,
    [phone],
  );
  return rows[0] ?? null;
}

async function createUser(phone: string, role: UserRole, fullName: string | null): Promise<UserRow> {
  const { rows } = await pool.query<UserRow>(
    `INSERT INTO users (phone, role, full_name)
     VALUES ($1, $2, $3)
     RETURNING id, phone, role, full_name, language`,
    [phone, role, fullName],
  );
  if (!rows[0]) throw new HttpError(500, 'create_user_failed', 'Failed to create user');
  return rows[0];
}

async function getUserById(id: string): Promise<UserRow | null> {
  const { rows } = await pool.query<UserRow>(
    `SELECT id, phone, role, full_name, language FROM users WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}
