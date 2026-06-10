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
import {
  assertNotRateLimited as assertNotPasswordRateLimited,
  recordAttempt,
  verifyPassword,
} from './password.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from './jwt.js';
import { requireAuth, type AuthedRequest } from '../../middleware/auth.js';
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
  // 'login'  → refuse si le user n'existe pas (pas de création)
  // 'signup' → refuse si le user existe déjà (force "se connecter")
  // absent   → comportement legacy: find-or-create
  mode: z.enum(['login', 'signup']).optional(),
});

authRouter.post('/otp/verify', async (req, res) => {
  const { phone, code, role, deviceId, fullName, mode } = verifyOtpBody.parse(req.body);

  const result = await consumeOtp(phone, code, 'login');
  if (!result.ok) {
    throw new HttpError(400, 'otp_' + result.reason, 'OTP invalid or expired');
  }

  // Find or create the user.
  // NOTE: for captain role, this only creates the *user* (auth identity).
  // The captains row is created only after KYC approval (different flow).
  let userRow = await findUserByPhone(phone);
  if (!userRow) {
    if (mode === 'login') {
      throw new HttpError(404, 'no_account', 'Aucun compte trouvé pour ce numéro');
    }
    userRow = await createUser(phone, role, fullName ?? null);
  } else {
    if (mode === 'signup') {
      throw new HttpError(409, 'account_exists', 'Un compte existe déjà pour ce numéro — connectez-vous');
    }
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
 * POST /auth/login
 *
 * Phone + admin-generated password authentication. Replaces the legacy
 * /auth/otp/{request,verify} flow. The legacy endpoints remain mounted
 * but should not be called by new clients.
 *
 * Body: { phone, password, role, deviceId }
 * Returns: same shape as /auth/otp/verify (user + tokens).
 */
const loginBody = z.object({
  phone: phoneSchema,
  password: z.string().min(4).max(64),
  role: z.enum(['rider', 'captain', 'admin']),
  deviceId: z.string().min(8).max(128),
});

authRouter.post('/login', async (req, res) => {
  const { phone, password, role, deviceId } = loginBody.parse(req.body);
  const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim()
    || req.socket.remoteAddress
    || null;
  const ua = (req.headers['user-agent'] as string | undefined) ?? null;

  // 1. Rate-limit BEFORE looking up the user (don't reveal account existence).
  await assertNotPasswordRateLimited(phone);

  // 2. Look up the user.
  const userRow = await findUserByPhoneWithPassword(phone);

  // Unified error path so attackers can't tell "no account" from "wrong password".
  const failAuth = async (logMsg: string): Promise<never> => {
    await recordAttempt(phone, false, ip, ua);
    throw new HttpError(401, 'invalid_credentials', logMsg);
  };

  if (!userRow) {
    await failAuth('Numéro ou mot de passe incorrect');
  }
  if (!userRow!.password_hash) {
    // Account exists but admin hasn't issued a password yet.
    await recordAttempt(phone, false, ip, ua);
    throw new HttpError(
      403,
      'no_password_set',
      'Aucun mot de passe défini. Contactez l\'administrateur.',
    );
  }

  const ok = await verifyPassword(password, userRow!.password_hash);
  if (!ok) {
    await failAuth('Numéro ou mot de passe incorrect');
  }

  // 3. Role guard — same logic as the legacy OTP verify.
  if (role === 'admin' && userRow!.role !== 'admin') {
    throw new HttpError(403, 'role_mismatch', 'Not an administrator');
  }
  if (userRow!.role === 'admin' && role !== 'admin') {
    throw new HttpError(403, 'role_mismatch', 'Admin must sign in via admin app');
  }

  // 4. Mint a session.
  await recordAttempt(phone, true, ip, ua);
  const sessionId = crypto.randomUUID();
  const accessToken = signAccessToken({ sub: userRow!.id, role: userRow!.role, sid: sessionId });
  const refreshToken = signRefreshToken({ sub: userRow!.id, sid: sessionId });
  const refreshHash = await bcrypt.hash(refreshToken, 8);

  await pool.query(
    `INSERT INTO sessions (id, user_id, device_id, refresh_token_hash, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + ($6 || ' seconds')::interval)`,
    [
      sessionId,
      userRow!.id,
      deviceId,
      refreshHash,
      ua,
      env.JWT_REFRESH_TTL_SECONDS.toString(),
    ],
  );
  await pool.query('UPDATE users SET last_seen_at = now() WHERE id = $1', [userRow!.id]);

  res.json({
    user: {
      id: userRow!.id,
      phone: userRow!.phone,
      role: userRow!.role,
      fullName: userRow!.full_name,
      language: userRow!.language,
      mustResetPassword: userRow!.must_reset_password,
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

/**
 * POST /auth/push-token
 * Body: { deviceId, token, platform }
 * Upserts an Expo push token for the authenticated user + device. Called by
 * the mobile app after the user grants notification permission.
 */
const pushTokenBody = z.object({
  deviceId: z.string().min(8).max(128),
  token: z.string().min(10).max(500),
  platform: z.enum(['ios', 'android']),
});

authRouter.post('/push-token', requireAuth, async (req, res) => {
  const userId = (req as AuthedRequest).user.id;
  const { deviceId, token, platform } = pushTokenBody.parse(req.body);
  await pool.query(
    `INSERT INTO push_tokens (user_id, device_id, token, platform)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, device_id)
     DO UPDATE SET token = EXCLUDED.token, platform = EXCLUDED.platform, updated_at = now()`,
    [userId, deviceId, token, platform],
  );
  res.json({ ok: true });
});

/**
 * DELETE /auth/push-token
 * Body: { deviceId }
 * Drops the push token on logout so we stop sending notifications.
 */
authRouter.delete('/push-token', requireAuth, async (req, res) => {
  const userId = (req as AuthedRequest).user.id;
  const deviceId = z.string().min(8).max(128).parse(req.body?.deviceId);
  await pool.query(
    `DELETE FROM push_tokens WHERE user_id = $1 AND device_id = $2`,
    [userId, deviceId],
  );
  res.json({ ok: true });
});

/**
 * GET /auth/me
 * Header: Authorization: Bearer <accessToken>
 * Returns the up-to-date user record. The mobile app calls this on launch
 * (and after the captain application flow) because the cached role can be
 * stale — e.g. a rider whose application got approved server-side is now a
 * captain in the database but still has 'rider' in their local token cache.
 */
authRouter.get('/me', requireAuth, async (req, res) => {
  const auth = (req as AuthedRequest).user;
  const user = await getUserById(auth.id);
  if (!user) throw new HttpError(401, 'user_missing', 'User not found');
  res.json({
    id: user.id,
    phone: user.phone,
    role: user.role,
    fullName: user.full_name,
    language: user.language,
    mustResetPassword: user.must_reset_password ?? false,
  });
});

// --- Helpers ---

interface UserRow {
  id: string;
  phone: string;
  role: UserRole;
  full_name: string | null;
  language: 'fr' | 'ar' | 'en';
  must_reset_password?: boolean;
}

interface UserRowWithPassword extends UserRow {
  password_hash: string | null;
  must_reset_password: boolean;
}

async function findUserByPhone(phone: string): Promise<UserRow | null> {
  const { rows } = await pool.query<UserRow>(
    `SELECT id, phone, role, full_name, language FROM users WHERE phone = $1`,
    [phone],
  );
  return rows[0] ?? null;
}

async function findUserByPhoneWithPassword(phone: string): Promise<UserRowWithPassword | null> {
  const { rows } = await pool.query<UserRowWithPassword>(
    `SELECT id, phone, role, full_name, language,
            password_hash, COALESCE(must_reset_password, false) AS must_reset_password
       FROM users WHERE phone = $1`,
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
    `SELECT id, phone, role, full_name, language,
            COALESCE(must_reset_password, false) AS must_reset_password
       FROM users WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}
