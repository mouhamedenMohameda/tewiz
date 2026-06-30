import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { HttpError } from '../../middleware/error.js';

// Parent router enforces requireAuth + requireRole('captain'). These endpoints
// let an already-approved captain change two preferences at any time without
// re-submitting the KYC application:
//   - acceptsColis        → can be offered colis (parcel) rides
//   - acceptsLongDistance → can be offered inter-city rides (above the admin
//                           configurable distance threshold)
//
// They update the live `captains` row, which is what the dispatcher reads.
// The KYC application snapshot is intentionally NOT touched — those values
// represent what the captain declared at onboarding, kept for the audit trail.

export const captainPreferencesRouter = Router();

interface PreferencesRow {
  vehicle_type: 'car' | 'moto';
  accepts_colis: boolean;
  accepts_long_distance: boolean;
}

interface Preferences {
  vehicleType: 'car' | 'moto';
  acceptsColis: boolean;
  acceptsLongDistance: boolean;
}

function shape(r: PreferencesRow): Preferences {
  return {
    vehicleType: r.vehicle_type,
    acceptsColis: r.accepts_colis,
    acceptsLongDistance: r.accepts_long_distance,
  };
}

captainPreferencesRouter.get('/', async (req, res) => {
  const userId = req.user!.id;
  const r = await pool.query<PreferencesRow>(
    `SELECT vehicle_type, accepts_colis, accepts_long_distance
       FROM captains WHERE user_id = $1`,
    [userId],
  );
  if (!r.rows[0]) throw new HttpError(404, 'not_captain', 'You are not an active captain');
  res.json(shape(r.rows[0]));
});

const patchBody = z.object({
  acceptsColis: z.boolean().optional(),
  acceptsLongDistance: z.boolean().optional(),
});

captainPreferencesRouter.patch('/', async (req, res) => {
  const userId = req.user!.id;
  const body = patchBody.parse(req.body ?? {});
  if (body.acceptsColis === undefined && body.acceptsLongDistance === undefined) {
    throw new HttpError(400, 'no_fields', 'Nothing to update');
  }
  const cur = await pool.query<PreferencesRow>(
    `SELECT vehicle_type, accepts_colis, accepts_long_distance
       FROM captains WHERE user_id = $1`,
    [userId],
  );
  if (!cur.rows[0]) throw new HttpError(404, 'not_captain', 'You are not an active captain');

  let nextAcceptsColis = body.acceptsColis ?? cur.rows[0].accepts_colis;
  let nextAcceptsLongDistance = body.acceptsLongDistance ?? cur.rows[0].accepts_long_distance;
  if (cur.rows[0].vehicle_type === 'moto') {
    // Moto captains are colis-only, so keep these flags coherent.
    nextAcceptsColis = true;
    nextAcceptsLongDistance = false;
  }

  const r = await pool.query<PreferencesRow>(
    `UPDATE captains
        SET accepts_colis         = $1,
            accepts_long_distance = $2
      WHERE user_id = $3
  RETURNING vehicle_type, accepts_colis, accepts_long_distance`,
    [nextAcceptsColis, nextAcceptsLongDistance, userId],
  );
  if (!r.rows[0]) throw new HttpError(404, 'not_captain', 'You are not an active captain');
  res.json(shape(r.rows[0]));
});
