import type { RequestHandler } from 'express';
import { pool } from '../db/pool.js';
import { HttpError } from './error.js';
import type { AuthedRequest } from './auth.js';

/**
 * Use AFTER requireAuth. Blocks the action unless the authenticated user has a
 * phone number on file. Guest riders start without one (see POST /auth/guest);
 * they must set it via POST /auth/me/phone before booking a ride, so the captain
 * has a way to reach them. This is the server-side backstop — the mobile app
 * prompts for the number first.
 */
export const requirePhone: RequestHandler = async (req, _res, next) => {
  try {
    const userId = req.user!.id;
    const { rows } = await pool.query<{ phone: string | null }>(
      `SELECT phone FROM users WHERE id = $1`,
      [userId],
    );
    if (!rows[0]?.phone) {
      return next(new HttpError(
        400,
        'phone_required',
        'Ajoutez votre numéro de téléphone avant de commander une course.',
      ));
    }
    next();
  } catch (err) {
    next(err);
  }
};
