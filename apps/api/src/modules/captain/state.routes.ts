import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { env } from '../../config/env.js';
import { type AuthedRequest } from '../../middleware/auth.js';
import { HttpError } from '../../middleware/error.js';
import { getBalance } from '../wallet/wallet.service.js';
import * as goingHome from '../home/going-home.service.js';

// Parent enforces auth + role=captain.
export const captainStateRouter = Router();

const onlineBody = z.object({
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});

/**
 * POST /captain/state/online
 * Goes online iff wallet balance >= MIN_BALANCE_TO_GO_ONLINE_KHOUMS and not
 * already on a ride.
 */
captainStateRouter.post('/online', async (req, res) => {
  const userId = (req as AuthedRequest).user.id;
  const body = onlineBody.parse(req.body ?? {});

  // 1. Ensure captain row exists and is active.
  const captain = await pool.query<{ status: string }>(
    `SELECT status FROM captains WHERE user_id = $1`,
    [userId],
  );
  if (!captain.rows[0]) {
    throw new HttpError(404, 'not_captain', 'You are not an active captain');
  }
  if (captain.rows[0].status !== 'active') {
    throw new HttpError(403, 'captain_suspended',
      `Captain account is ${captain.rows[0].status}`);
  }

  // 2. Balance gate.
  const balance = await getBalance(userId);
  if (balance < env.MIN_BALANCE_TO_GO_ONLINE_KHOUMS) {
    throw new HttpError(402, 'balance_too_low',
      `Solde insuffisant pour aller en ligne (min ${env.MIN_BALANCE_TO_GO_ONLINE_KHOUMS} khoums, actuel ${balance})`,
      { balance, minRequired: env.MIN_BALANCE_TO_GO_ONLINE_KHOUMS });
  }

  // 3. Already on a ride? Don't downgrade.
  const current = await pool.query<{ presence: string }>(
    `SELECT presence FROM captain_state WHERE captain_id = $1`,
    [userId],
  );
  if (current.rows[0]?.presence === 'on_ride') {
    throw new HttpError(409, 'on_ride', 'Vous êtes en course, ne peut pas changer manuellement');
  }

  // 4. Update state.
  const loc = body.lat !== undefined && body.lng !== undefined
    ? `ST_SetSRID(ST_MakePoint(${Number(body.lng)}, ${Number(body.lat)}), 4326)::geography`
    : 'location';

  const sql = `
    INSERT INTO captain_state (captain_id, presence, location, updated_at)
    VALUES ($1, 'online', ${body.lat !== undefined && body.lng !== undefined
      ? 'ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography'
      : 'NULL'}, now())
    ON CONFLICT (captain_id) DO UPDATE
      SET presence = 'online',
          location = ${body.lat !== undefined && body.lng !== undefined
            ? 'EXCLUDED.location'
            : 'captain_state.location'},
          updated_at = now()
    RETURNING captain_id, presence, updated_at
  `;
  const params = body.lat !== undefined && body.lng !== undefined
    ? [userId, body.lng, body.lat]
    : [userId];

  const r = await pool.query(sql, params);
  res.json({ ...r.rows[0], balanceKhoums: balance });
});

/**
 * POST /captain/state/offline
 */
captainStateRouter.post('/offline', async (req, res) => {
  const userId = (req as AuthedRequest).user.id;

  const current = await pool.query<{ presence: string }>(
    `SELECT presence FROM captain_state WHERE captain_id = $1`,
    [userId],
  );
  if (current.rows[0]?.presence === 'on_ride') {
    throw new HttpError(409, 'on_ride',
      'Cannot go offline while on a ride');
  }

  const r = await pool.query(
    `UPDATE captain_state
        SET presence = 'offline', updated_at = now()
      WHERE captain_id = $1
   RETURNING captain_id, presence, updated_at`,
    [userId],
  );
  if (!r.rows[0]) throw new HttpError(404, 'no_state', 'No state row');
  res.json(r.rows[0]);
});

/**
 * GET /captain/state
 */
captainStateRouter.get('/', async (req, res) => {
  const userId = (req as AuthedRequest).user.id;
  const r = await pool.query(
    `SELECT presence, updated_at,
            ST_X(location::geometry) AS lng,
            ST_Y(location::geometry) AS lat
       FROM captain_state WHERE captain_id = $1`,
    [userId],
  );
  if (!r.rows[0]) throw new HttpError(404, 'no_state', 'No state row');
  res.json(r.rows[0]);
});

/**
 * POST /captain/state/going-home
 * Start a going-home session. Rides bringing the captain closer to home will
 * be prioritized in the dispatch.
 */
captainStateRouter.post('/going-home', async (req, res) => {
  const userId = (req as AuthedRequest).user.id;
  res.json(await goingHome.startSession(userId));
});

/**
 * DELETE /captain/state/going-home
 * Cancel the active going-home session.
 */
captainStateRouter.delete('/going-home', async (req, res) => {
  const userId = (req as AuthedRequest).user.id;
  res.json(await goingHome.endSession({ captainId: userId, reason: 'cancelled' }));
});

/**
 * GET /captain/state/going-home
 * Return the active session (204 if none).
 */
captainStateRouter.get('/going-home', async (req, res) => {
  const userId = (req as AuthedRequest).user.id;
  const s = await goingHome.getActiveSession(userId);
  if (!s) {
    res.status(204).end();
    return;
  }
  res.json(s);
});
