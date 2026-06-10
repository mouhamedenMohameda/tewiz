/**
 * Admin endpoints for user management.
 *
 *   GET    /admin/users                       — paged list with filters
 *   POST   /admin/users                       — create a new user, returns
 *                                                the generated password
 *                                                (shown ONCE)
 *   POST   /admin/users/:id/regenerate-password
 *                                              — rotates the password
 *
 * All endpoints require admin role (enforced by the parent adminRouter).
 */

import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { HttpError } from '../../middleware/error.js';
import type { AuthedRequest } from '../../middleware/auth.js';
import { generatePassword, hashPassword } from '../auth/password.js';
import { phoneSchema } from '../auth/phone.js';
import { audit } from './audit.js';

export const adminUsersRouter = Router();

// ---------------------------------------------------------------------------
// GET /admin/users
// ---------------------------------------------------------------------------

const listQuery = z.object({
  role: z.enum(['rider', 'captain', 'admin']).optional(),
  search: z.string().trim().min(1).optional(),     // matches phone or full_name
  limit: z.coerce.number().min(1).max(200).default(50),
  offset: z.coerce.number().min(0).default(0),
});

adminUsersRouter.get('/', async (req, res) => {
  const q = listQuery.parse(req.query);

  const where: string[] = [];
  const params: unknown[] = [];
  if (q.role) {
    params.push(q.role);
    where.push(`role = $${params.length}`);
  }
  if (q.search) {
    params.push(`%${q.search}%`);
    where.push(`(phone ILIKE $${params.length} OR full_name ILIKE $${params.length})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  params.push(q.limit);
  params.push(q.offset);

  const { rows } = await pool.query(
    `SELECT id, phone, role, status, full_name, language,
            (password_hash IS NOT NULL) AS has_password,
            must_reset_password,
            password_updated_at, last_seen_at, created_at
       FROM users
       ${whereSql}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  const { rows: countRows } = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM users ${whereSql}`,
    params.slice(0, params.length - 2),
  );
  res.json({
    users: rows,
    total: parseInt(countRows[0]?.count ?? '0', 10),
    limit: q.limit,
    offset: q.offset,
  });
});

// ---------------------------------------------------------------------------
// POST /admin/users
// Creates a new user with an admin-generated initial password.
// The password is returned in the response (and ONLY in the response).
// ---------------------------------------------------------------------------

const createBody = z.object({
  phone: phoneSchema,
  role: z.enum(['rider', 'captain', 'admin']),
  fullName: z.string().min(2).max(100),
  language: z.enum(['fr', 'ar', 'en']).default('fr'),
});

adminUsersRouter.post('/', async (req, res) => {
  const body = createBody.parse(req.body);
  const adminId = (req as AuthedRequest).user.id;

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
    `INSERT INTO users (phone, role, full_name, language,
                        password_hash, password_updated_at,
                        must_reset_password, created_by_admin_id)
     VALUES ($1, $2, $3, $4, $5, now(), false, $6)
     RETURNING id`,
    [body.phone, body.role, body.fullName, body.language, hash, adminId],
  );

  const userId = rows[0]!.id;
  await audit({
    adminId,
    action: 'user.create',
    targetType: 'user',
    targetId: userId,
    after: { role: body.role, phone: body.phone, fullName: body.fullName },
  });

  res.status(201).json({
    user: {
      id: userId,
      phone: body.phone,
      role: body.role,
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
  const adminId = (req as AuthedRequest).user.id;

  const user = await pool.query<{ phone: string; full_name: string | null }>(
    `SELECT phone, full_name FROM users WHERE id = $1 LIMIT 1`,
    [id],
  );
  if (!user.rows[0]) {
    throw new HttpError(404, 'user_not_found', 'Utilisateur introuvable');
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
