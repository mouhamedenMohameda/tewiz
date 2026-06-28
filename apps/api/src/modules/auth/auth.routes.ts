import { Router } from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { pool, withTx } from '../../db/pool.js';
import { env } from '../../config/env.js';
import { HttpError } from '../../middleware/error.js';
import { phoneSchema } from './phone.js';
import {
  assertNotRateLimited as assertNotPasswordRateLimited,
  recordAttempt,
  verifyPassword,
} from './password.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from './jwt.js';
import { requireAuth, type AuthedRequest } from '../../middleware/auth.js';
import type { UserRole, AdminRole } from '@tewiz/shared-types';

export const authRouter = Router();

// ─── SECURITY ────────────────────────────────────────────────────────────────
// The legacy OTP endpoints (POST /auth/otp/request and /auth/otp/verify) were
// removed. They allowed UNAUTHENTICATED account creation — including the
// `admin` role — for any phone number, and returned the OTP in the HTTP
// response when NODE_ENV=development (full remote admin takeover).
//
// Two account-creation paths exist now, both safe:
//   * POST /auth/login (below) — password auth for existing users.
//   * POST /auth/guest (below) — creates an anonymous account with the role
//     HARD-CODED to 'rider'. It can never mint a captain or admin, so the
//     original flaw does not return. Promotion to captain still requires the
//     admin-reviewed KYC flow.
// Do not add any account-creation path that lets the caller choose the role.

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
  const { accessToken, refreshToken } = await issueSession(
    { id: userRow!.id, role: userRow!.role, admin_role: userRow!.admin_role },
    deviceId,
    ua,
  );

  res.json({
    user: {
      id: userRow!.id,
      phone: userRow!.phone,
      role: userRow!.role,
      adminRole: userRow!.admin_role,
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
 * POST /auth/guest
 *
 * Creates an anonymous "guest" rider and returns a session, so the mobile app
 * can enter the rider experience on first launch without any sign-up. The role
 * is HARD-CODED to 'rider' (see the SECURITY note above) — this path can never
 * create a captain or admin. The account has no phone and no password yet; the
 * app captures the phone (POST /auth/me/phone) before the first ride.
 *
 * Body: { deviceId }
 * Returns: same shape as /auth/login (user + tokens), with phone null.
 */
const guestBody = z.object({
  deviceId: z.string().min(8).max(128),
});

authRouter.post('/guest', async (req, res) => {
  const { deviceId } = guestBody.parse(req.body);
  const ua = (req.headers['user-agent'] as string | undefined) ?? null;

  const { rows } = await pool.query<{ id: string; role: UserRole }>(
    `INSERT INTO users (role, status, is_guest, must_reset_password)
     VALUES ('rider', 'active', true, false)
     RETURNING id, role`,
  );
  const user = rows[0]!;
  const { accessToken, refreshToken } = await issueSession(
    { id: user.id, role: user.role, admin_role: null },
    deviceId,
    ua,
  );

  res.status(201).json({
    user: {
      id: user.id,
      phone: null,
      role: user.role,
      adminRole: null,
      fullName: null,
      language: 'fr',
      isGuest: true,
      mustResetPassword: false,
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
 * POST /auth/me/phone
 *
 * Sets (or updates) the authenticated user's phone number. A guest rider calls
 * this the first time a phone is needed — before booking a ride or starting a
 * captain application. No SMS verification (product decision); we only guard
 * uniqueness so two accounts can't claim the same number.
 *
 * Body: { phone }
 */
const setPhoneBody = z.object({ phone: phoneSchema });

authRouter.post('/me/phone', requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const { phone } = setPhoneBody.parse(req.body);

  const dup = await pool.query<{ id: string }>(
    `SELECT id FROM users WHERE phone = $1 AND id <> $2 LIMIT 1`,
    [phone, userId],
  );
  if (dup.rows[0]) {
    throw new HttpError(409, 'phone_taken', 'Ce numéro est déjà utilisé.');
  }

  const { rows } = await pool.query<UserRow>(
    `UPDATE users SET phone = $1
      WHERE id = $2
      RETURNING id, phone, role, full_name, language,
                COALESCE(must_reset_password, false) AS must_reset_password`,
    [phone, userId],
  );
  const u = rows[0];
  if (!u) throw new HttpError(401, 'user_missing', 'User not found');
  res.json({
    id: u.id,
    phone: u.phone,
    role: u.role,
    fullName: u.full_name,
    language: u.language,
    mustResetPassword: u.must_reset_password ?? false,
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

  const accessToken = signAccessToken({
    sub: user.id,
    role: user.role,
    adminRole: user.admin_role,
    sid: payload.sid,
  });
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
  const userId = req.user!.id;
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
  const userId = req.user!.id;
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
  const auth = req.user!;
  const user = await getUserById(auth.id);
  if (!user) throw new HttpError(401, 'user_missing', 'User not found');
  res.json({
    id: user.id,
    phone: user.phone,
    role: user.role,
    adminRole: user.admin_role,
    fullName: user.full_name,
    language: user.language,
    isGuest: user.is_guest ?? false,
    mustResetPassword: user.must_reset_password ?? false,
  });
});

/**
 * PATCH /auth/me
 *
 * Self-service updates of the authenticated user's profile. Used by the mobile
 * Settings screen to change the display name and the preferred language. Both
 * fields are optional so the client can send only what changed.
 *
 * Role/phone/password are intentionally excluded: role escalation is admin-only,
 * phone is set via POST /auth/me/phone (with uniqueness checks), and passwords
 * are issued by the admin.
 */
const patchMeBody = z.object({
  fullName: z.string().trim().min(1).max(80).nullable().optional(),
  language: z.enum(['fr', 'ar', 'en']).optional(),
});

authRouter.patch('/me', requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const body = patchMeBody.parse(req.body);

  const sets: string[] = [];
  const params: unknown[] = [];
  if (body.fullName !== undefined) {
    params.push(body.fullName);
    sets.push(`full_name = $${params.length}`);
  }
  if (body.language !== undefined) {
    params.push(body.language);
    sets.push(`language = $${params.length}`);
  }
  if (sets.length === 0) {
    // Nothing to change — return current record so the client stays in sync.
    const user = await getUserById(userId);
    if (!user) throw new HttpError(401, 'user_missing', 'User not found');
    res.json({
      id: user.id,
      phone: user.phone,
      role: user.role,
      adminRole: user.admin_role,
      fullName: user.full_name,
      language: user.language,
      isGuest: user.is_guest ?? false,
      mustResetPassword: user.must_reset_password ?? false,
    });
    return;
  }

  params.push(userId);
  const { rows } = await pool.query<UserRow>(
    `UPDATE users SET ${sets.join(', ')}
      WHERE id = $${params.length}
      RETURNING id, phone, role, admin_role, full_name, language,
                COALESCE(is_guest, false) AS is_guest,
                COALESCE(must_reset_password, false) AS must_reset_password`,
    params,
  );
  const u = rows[0];
  if (!u) throw new HttpError(401, 'user_missing', 'User not found');
  res.json({
    id: u.id,
    phone: u.phone,
    role: u.role,
    adminRole: u.admin_role,
    fullName: u.full_name,
    language: u.language,
    isGuest: u.is_guest ?? false,
    mustResetPassword: u.must_reset_password ?? false,
  });
});

/**
 * DELETE /auth/me
 * Header: Authorization: Bearer <accessToken>
 *
 * In-app account deletion — required by App Store guideline 5.1.1(v) and the
 * Google Play account-deletion policy.
 *
 * This is a SOFT delete: the row is kept (wallet ledger, completed rides and
 * audit trails must survive for accounting/legal reasons) but all personal
 * data is stripped and access is cut:
 *  - status -> 'deleted', phone -> NULL (frees the number for reuse),
 *    full_name -> NULL, is_guest -> false
 *  - every refresh session is revoked
 *  - push tokens are removed so notifications stop immediately
 *
 * A deleted account can no longer authenticate; returning users start fresh.
 */
authRouter.delete('/me', requireAuth, async (req, res) => {
  const userId = req.user!.id;

  await withTx(async (client) => {
    await client.query(
      `UPDATE users
          SET status = 'deleted', phone = NULL, full_name = NULL, is_guest = false
        WHERE id = $1`,
      [userId],
    );
    await client.query(
      `UPDATE sessions SET revoked_at = now()
        WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );
    await client.query(`DELETE FROM push_tokens WHERE user_id = $1`, [userId]);
  });

  res.json({ ok: true });
});

// --- Helpers ---

/**
 * Mint a refresh-token session for a user and return the access + refresh
 * tokens. Shared by /auth/login and /auth/guest so the session bookkeeping
 * (sessions row + last_seen_at) stays in one place.
 */
async function issueSession(
  user: { id: string; role: UserRole; admin_role: AdminRole | null },
  deviceId: string,
  ua: string | null,
): Promise<{ accessToken: string; refreshToken: string }> {
  const sessionId = crypto.randomUUID();
  const accessToken = signAccessToken({
    sub: user.id,
    role: user.role,
    adminRole: user.admin_role,
    sid: sessionId,
  });
  const refreshToken = signRefreshToken({ sub: user.id, sid: sessionId });
  const refreshHash = await bcrypt.hash(refreshToken, 8);

  await pool.query(
    `INSERT INTO sessions (id, user_id, device_id, refresh_token_hash, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + ($6 || ' seconds')::interval)`,
    [sessionId, user.id, deviceId, refreshHash, ua, env.JWT_REFRESH_TTL_SECONDS.toString()],
  );
  await pool.query('UPDATE users SET last_seen_at = now() WHERE id = $1', [user.id]);

  return { accessToken, refreshToken };
}

interface UserRow {
  id: string;
  phone: string | null;
  role: UserRole;
  admin_role: AdminRole | null;
  full_name: string | null;
  language: 'fr' | 'ar' | 'en';
  is_guest?: boolean;
  must_reset_password?: boolean;
}

interface UserRowWithPassword extends UserRow {
  password_hash: string | null;
  must_reset_password: boolean;
}

async function findUserByPhoneWithPassword(phone: string): Promise<UserRowWithPassword | null> {
  const { rows } = await pool.query<UserRowWithPassword>(
    `SELECT id, phone, role, admin_role, full_name, language,
            password_hash, COALESCE(must_reset_password, false) AS must_reset_password
       FROM users WHERE phone = $1`,
    [phone],
  );
  return rows[0] ?? null;
}

async function getUserById(id: string): Promise<UserRow | null> {
  const { rows } = await pool.query<UserRow>(
    `SELECT id, phone, role, admin_role, full_name, language,
            COALESCE(is_guest, false) AS is_guest,
            COALESCE(must_reset_password, false) AS must_reset_password
       FROM users WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}
