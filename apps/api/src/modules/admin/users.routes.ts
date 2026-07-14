/**
 * Admin endpoints for user management.
 *
 *   GET    /admin/users                       — paged list with filters
 *   POST   /admin/users                       — create a new user, returns
 *                                                the generated password
 *                                                (shown ONCE)
 *   POST   /admin/users/:id/regenerate-password
 *                                              — rotates the password
 *   PATCH  /admin/users/:id/status             — suspend / ban / reactivate
 *   DELETE /admin/users/:id                    — soft-delete the account
 *
 * All endpoints require admin role (enforced by the parent adminRouter).
 * Actions targeting another admin are further restricted to super_admin
 * inside each handler.
 */

import { Router } from 'express';
import { z } from 'zod';
import { pool, withTx } from '../../db/pool.js';
import { HttpError } from '../../middleware/error.js';
import { requireAdminRole, type AuthedRequest } from '../../middleware/auth.js';
import { generatePassword, hashPassword } from '../auth/password.js';
import { phoneSchema } from '../auth/phone.js';
import { audit } from './audit.js';
import { ADMIN_ROLES } from '@tewiz/shared-types';

export const adminUsersRouter = Router();

// ---------------------------------------------------------------------------
// GET /admin/users
// ---------------------------------------------------------------------------

// A user is considered "online" if any authenticated request bumped
// last_seen_at within this window. Matches the throttle in middleware/heartbeat.
const ONLINE_WINDOW = "interval '5 minutes'";

const listQuery = z.object({
  role: z.enum(['rider', 'captain', 'admin']).optional(),
  search: z.string().trim().min(1).optional(),     // matches phone or full_name
  online: z.enum(['true', 'false']).optional(),
  // Opt-in: include anonymous guest accounts (used by the notifications composer
  // so an admin can push to a specific guest by phone). Off by default so the
  // user directory stays limited to managed accounts.
  includeGuests: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().min(1).max(200).default(50),
  offset: z.coerce.number().min(0).default(0),
});

adminUsersRouter.get('/', async (req, res) => {
  const q = listQuery.parse(req.query);

  const where: string[] = [];
  const params: unknown[] = [];
  // Anonymous guest accounts (no phone, created on first app launch) are not
  // "managed users" — hide them from the admin directory by default. They
  // reappear once promoted to a captain (is_guest is cleared on approval), or
  // when a caller explicitly opts in via includeGuests=true (notifications).
  if (q.includeGuests !== 'true') {
    where.push('COALESCE(is_guest, false) = false');
  }
  // Soft-deleted accounts (status='deleted', phone stripped) are gone from
  // the operator's point of view — never surface them in the directory.
  where.push("status <> 'deleted'");
  if (q.role) {
    params.push(q.role);
    where.push(`role = $${params.length}`);
  }
  if (q.search) {
    params.push(`%${q.search}%`);
    where.push(`(phone ILIKE $${params.length} OR full_name ILIKE $${params.length})`);
  }
  if (q.online === 'true') {
    where.push(`last_seen_at > now() - ${ONLINE_WINDOW}`);
  } else if (q.online === 'false') {
    where.push(`(last_seen_at IS NULL OR last_seen_at <= now() - ${ONLINE_WINDOW})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  params.push(q.limit);
  params.push(q.offset);

  const { rows } = await pool.query(
    `SELECT id, phone, role, admin_role, status, full_name, language,
            (password_hash IS NOT NULL) AS has_password,
            must_reset_password,
            password_updated_at, last_seen_at, created_at,
            (last_seen_at > now() - ${ONLINE_WINDOW}) AS online
       FROM users
       ${whereSql}
       ORDER BY (last_seen_at > now() - ${ONLINE_WINDOW}) DESC NULLS LAST,
                last_seen_at DESC NULLS LAST,
                created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  const { rows: countRows } = await pool.query<{ count: string; online: string }>(
    `SELECT COUNT(*) AS count,
            COUNT(*) FILTER (WHERE last_seen_at > now() - ${ONLINE_WINDOW}) AS online
       FROM users ${whereSql}`,
    params.slice(0, params.length - 2),
  );
  res.json({
    users: rows,
    total: parseInt(countRows[0]?.count ?? '0', 10),
    onlineCount: parseInt(countRows[0]?.online ?? '0', 10),
    limit: q.limit,
    offset: q.offset,
  });
});

// ---------------------------------------------------------------------------
// POST /admin/users
// Creates a new user with an admin-generated initial password.
// The password is returned in the response (and ONLY in the response).
// ---------------------------------------------------------------------------

const createBody = z
  .object({
    phone: phoneSchema,
    role: z.enum(['rider', 'captain', 'admin']),
    adminRole: z.enum(ADMIN_ROLES as unknown as [string, ...string[]]).optional(),
    fullName: z.string().min(2).max(100),
    language: z.enum(['fr', 'ar', 'en']).default('fr'),
  })
  .refine((b) => (b.role === 'admin') === !!b.adminRole, {
    message: 'adminRole is required when role=admin and forbidden otherwise',
    path: ['adminRole'],
  });

adminUsersRouter.post('/', async (req, res) => {
  const body = createBody.parse(req.body);
  const adminId = req.user!.id;
  // Only super_admin can mint other admins.
  if (body.role === 'admin' && req.user!.adminRole !== 'super_admin') {
    throw new HttpError(403, 'forbidden', 'Seul un super_admin peut créer un administrateur.');
  }

  // Reject duplicate phones cleanly so the admin can retry without
  // bumping into a 500.
  const dup = await pool.query<{ id: string }>(
    `SELECT id FROM users WHERE phone = $1 LIMIT 1`,
    [body.phone],
  );
  if (dup.rows[0]) {
    throw new HttpError(
      409,
      'phone_already_exists',
      `Un compte existe déjà pour ${body.phone}.`,
    );
  }

  const password = generatePassword();
  const hash = await hashPassword(password);

  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (phone, role, admin_role, full_name, language,
                        password_hash, password_updated_at,
                        must_reset_password, created_by_admin_id)
     VALUES ($1, $2, $3, $4, $5, $6, now(), false, $7)
     RETURNING id`,
    [
      body.phone,
      body.role,
      body.adminRole ?? null,
      body.fullName,
      body.language,
      hash,
      adminId,
    ],
  );

  const userId = rows[0]!.id;
  await audit({
    adminId,
    action: 'user.create',
    targetType: 'user',
    targetId: userId,
    after: {
      role: body.role,
      adminRole: body.adminRole ?? null,
      phone: body.phone,
      fullName: body.fullName,
    },
  });

  res.status(201).json({
    user: {
      id: userId,
      phone: body.phone,
      role: body.role,
      adminRole: body.adminRole ?? null,
      fullName: body.fullName,
      language: body.language,
    },
    // Plaintext password, shown ONCE to the admin so they can WhatsApp it.
    // Never logged, never re-fetchable.
    password,
    whatsappLink: buildWhatsAppLink(body.phone, body.fullName, password),
  });
});

// ---------------------------------------------------------------------------
// POST /admin/users/:id/regenerate-password
// ---------------------------------------------------------------------------

const idParam = z.object({ id: z.string().uuid() });

adminUsersRouter.post('/:id/regenerate-password', async (req, res) => {
  const { id } = idParam.parse(req.params);
  const adminId = req.user!.id;

  const user = await pool.query<{ phone: string; full_name: string | null; role: string }>(
    `SELECT phone, full_name, role FROM users WHERE id = $1 LIMIT 1`,
    [id],
  );
  if (!user.rows[0]) {
    throw new HttpError(404, 'user_not_found', 'Utilisateur introuvable');
  }
  // Regenerating an admin's password is super_admin only — it would
  // otherwise let any ops_manager hijack the panel.
  if (user.rows[0].role === 'admin' && req.user!.adminRole !== 'super_admin') {
    throw new HttpError(
      403,
      'forbidden',
      "Seul un super_admin peut régénérer le mot de passe d'un administrateur.",
    );
  }

  const password = generatePassword();
  const hash = await hashPassword(password);

  await pool.query(
    `UPDATE users
        SET password_hash = $1,
            password_updated_at = now(),
            must_reset_password = false
      WHERE id = $2`,
    [hash, id],
  );

  // Revoke all active sessions so the user must log in again with the
  // new password.
  await pool.query(
    `UPDATE sessions SET revoked_at = now()
      WHERE user_id = $1 AND revoked_at IS NULL`,
    [id],
  );

  await audit({
    adminId,
    action: 'user.password.regenerate',
    targetType: 'user',
    targetId: id,
  });

  res.json({
    ok: true,
    userId: id,
    password,
    whatsappLink: buildWhatsAppLink(
      user.rows[0].phone,
      user.rows[0].full_name ?? '',
      password,
    ),
  });
});

// ---------------------------------------------------------------------------
// PATCH /admin/users/:id/admin-role
// Reassigns an admin's sub-role. Super_admin only. Refuses to demote the
// last remaining super_admin so the panel can never lock itself out.
// ---------------------------------------------------------------------------

const adminRoleBody = z.object({
  adminRole: z.enum(ADMIN_ROLES as unknown as [string, ...string[]]),
});

adminUsersRouter.patch('/:id/admin-role', requireAdminRole(), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { adminRole: newRole } = adminRoleBody.parse(req.body);
  const actorId = req.user!.id;

  const target = await pool.query<{ role: string; admin_role: string | null }>(
    `SELECT role, admin_role FROM users WHERE id = $1 LIMIT 1`,
    [id],
  );
  const t = target.rows[0];
  if (!t) throw new HttpError(404, 'user_not_found', 'Utilisateur introuvable');
  if (t.role !== 'admin') {
    throw new HttpError(400, 'not_admin', "Cet utilisateur n'est pas un administrateur");
  }
  if (t.admin_role === newRole) {
    res.json({ ok: true, userId: id, adminRole: newRole });
    return;
  }

  // Lock-out guard: refuse demoting the last super_admin.
  if (t.admin_role === 'super_admin' && newRole !== 'super_admin') {
    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM users
        WHERE role = 'admin' AND admin_role = 'super_admin'
          AND status = 'active'`,
    );
    if (parseInt(rows[0]?.count ?? '0', 10) <= 1) {
      throw new HttpError(
        409,
        'last_super_admin',
        'Impossible de retirer le dernier super_admin actif.',
      );
    }
  }

  await pool.query(
    `UPDATE users SET admin_role = $1 WHERE id = $2`,
    [newRole, id],
  );

  await audit({
    adminId: actorId,
    action: 'user.admin_role.update',
    targetType: 'user',
    targetId: id,
    before: { adminRole: t.admin_role },
    after: { adminRole: newRole },
  });

  res.json({ ok: true, userId: id, adminRole: newRole });
});

// ---------------------------------------------------------------------------
// PATCH /admin/users/:id/status
// Suspend, ban, or reactivate an account. Suspending/banning cuts access
// immediately (revokes sessions + drops push tokens) so the change takes
// effect without waiting for the current access token to expire.
// ---------------------------------------------------------------------------

const statusBody = z.object({
  status: z.enum(['active', 'suspended', 'banned']),
  reason: z.string().trim().max(500).optional(),
});

adminUsersRouter.patch('/:id/status', async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { status, reason } = statusBody.parse(req.body);
  const actorId = req.user!.id;

  // Never let an admin lock themselves out of their own session.
  if (id === actorId) {
    throw new HttpError(
      400,
      'cannot_target_self',
      'Vous ne pouvez pas modifier le statut de votre propre compte.',
    );
  }

  const target = await pool.query<{
    role: string;
    admin_role: string | null;
    status: string;
  }>(
    `SELECT role, admin_role, status FROM users WHERE id = $1 LIMIT 1`,
    [id],
  );
  const t = target.rows[0];
  if (!t) throw new HttpError(404, 'user_not_found', 'Utilisateur introuvable');
  if (t.status === 'deleted') {
    throw new HttpError(409, 'user_deleted', 'Ce compte a été supprimé.');
  }
  // Changing an admin's status could hijack or disable the panel — super_admin only.
  if (t.role === 'admin' && req.user!.adminRole !== 'super_admin') {
    throw new HttpError(
      403,
      'forbidden',
      "Seul un super_admin peut modifier le statut d'un administrateur.",
    );
  }
  if (t.status === status) {
    res.json({ ok: true, userId: id, status });
    return;
  }

  // Lock-out guard: never suspend/ban the last remaining active super_admin.
  if (t.role === 'admin' && t.admin_role === 'super_admin' && status !== 'active') {
    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM users
        WHERE role = 'admin' AND admin_role = 'super_admin' AND status = 'active'`,
    );
    if (parseInt(rows[0]?.count ?? '0', 10) <= 1) {
      throw new HttpError(
        409,
        'last_super_admin',
        'Impossible de suspendre le dernier super_admin actif.',
      );
    }
  }

  await withTx(async (client) => {
    await client.query(`UPDATE users SET status = $1 WHERE id = $2`, [status, id]);
    // Cutting access: on suspend/ban, revoke sessions and stop notifications
    // immediately. Reactivation just flips the flag — the user logs in again.
    if (status !== 'active') {
      await client.query(
        `UPDATE sessions SET revoked_at = now()
          WHERE user_id = $1 AND revoked_at IS NULL`,
        [id],
      );
      await client.query(`DELETE FROM push_tokens WHERE user_id = $1`, [id]);
    }
  });

  await audit({
    adminId: actorId,
    action: 'user.status.update',
    targetType: 'user',
    targetId: id,
    before: { status: t.status },
    after: { status },
    reason: reason ?? null,
  });

  res.json({ ok: true, userId: id, status });
});

// ---------------------------------------------------------------------------
// DELETE /admin/users/:id
// Soft-delete: keeps the row (wallet ledger, rides, audit trail must survive)
// but strips personal data, frees the phone number for reuse, and cuts all
// access. Mirrors the in-app DELETE /auth/me flow.
// ---------------------------------------------------------------------------

adminUsersRouter.delete('/:id', async (req, res) => {
  const { id } = idParam.parse(req.params);
  const actorId = req.user!.id;

  if (id === actorId) {
    throw new HttpError(
      400,
      'cannot_target_self',
      'Vous ne pouvez pas supprimer votre propre compte.',
    );
  }

  const target = await pool.query<{
    role: string;
    admin_role: string | null;
    status: string;
  }>(
    `SELECT role, admin_role, status FROM users WHERE id = $1 LIMIT 1`,
    [id],
  );
  const t = target.rows[0];
  if (!t) throw new HttpError(404, 'user_not_found', 'Utilisateur introuvable');
  if (t.status === 'deleted') {
    // Already gone — treat as idempotent success.
    res.json({ ok: true, userId: id, status: 'deleted' });
    return;
  }
  if (t.role === 'admin' && req.user!.adminRole !== 'super_admin') {
    throw new HttpError(
      403,
      'forbidden',
      'Seul un super_admin peut supprimer un administrateur.',
    );
  }
  if (t.role === 'admin' && t.admin_role === 'super_admin') {
    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM users
        WHERE role = 'admin' AND admin_role = 'super_admin' AND status = 'active'`,
    );
    if (parseInt(rows[0]?.count ?? '0', 10) <= 1) {
      throw new HttpError(
        409,
        'last_super_admin',
        'Impossible de supprimer le dernier super_admin actif.',
      );
    }
  }

  await withTx(async (client) => {
    await client.query(
      `UPDATE users
          SET status = 'deleted', phone = NULL, full_name = NULL, is_guest = false
        WHERE id = $1`,
      [id],
    );
    await client.query(
      `UPDATE sessions SET revoked_at = now()
        WHERE user_id = $1 AND revoked_at IS NULL`,
      [id],
    );
    await client.query(`DELETE FROM push_tokens WHERE user_id = $1`, [id]);
  });

  await audit({
    adminId: actorId,
    action: 'user.delete',
    targetType: 'user',
    targetId: id,
    before: { role: t.role, adminRole: t.admin_role, status: t.status },
  });

  res.json({ ok: true, userId: id, status: 'deleted' });
});

// ---------------------------------------------------------------------------
// Helper: pre-fill a wa.me link the admin can tap to send the password.
// ---------------------------------------------------------------------------

function buildWhatsAppLink(phone: string, fullName: string, password: string): string {
  const clean = phone.replace(/[^\d+]/g, '').replace(/^\+/, '');
  const greeting = fullName ? `Bonjour ${fullName},` : 'Bonjour,';
  const msg = [
    greeting,
    '',
    'Voici votre mot de passe pour vous connecter à Tewiz :',
    '',
    password,
    '',
    'À ne pas partager.',
  ].join('\n');
  return `https://wa.me/${clean}?text=${encodeURIComponent(msg)}`;
}
