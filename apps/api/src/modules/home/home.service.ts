import type pg from 'pg';
import { pool, withTx } from '../../db/pool.js';
import { env } from '../../config/env.js';
import { HttpError } from '../../middleware/error.js';

interface SetHomeInput {
  captainId: string;
  lat: number;
  lng: number;
  label: string;
  // Captain's current GPS — must be within HOME_GPS_TOLERANCE_M of the chosen point.
  currentLat: number;
  currentLng: number;
}

interface HomeRow {
  captain_id: string;
  lat: number;
  lng: number;
  address_label: string;
  set_at: Date;
  locked_until: Date;
  correction_used: boolean;
}

function shape(r: HomeRow) {
  return {
    captainId: r.captain_id,
    lat: r.lat,
    lng: r.lng,
    label: r.address_label,
    setAt: r.set_at,
    lockedUntil: r.locked_until,
    correctionUsed: r.correction_used,
  };
}

const HOME_COLS = `
  captain_id,
  ST_Y(location::geometry) AS lat,
  ST_X(location::geometry) AS lng,
  address_label, set_at, locked_until, correction_used
`;

/**
 * Get captain's home (null if not set).
 */
export async function getHome(captainId: string) {
  const r = await pool.query<HomeRow>(
    `SELECT ${HOME_COLS} FROM captain_home WHERE captain_id = $1`,
    [captainId],
  );
  return r.rows[0] ? shape(r.rows[0]) : null;
}

/**
 * Verify the captain is physically near the proposed home (anti-abuse).
 */
async function assertGpsMatchesHome(client: pg.PoolClient, input: SetHomeInput) {
  const r = await client.query<{ d: string }>(
    `SELECT ST_Distance(
       ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
       ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography
     ) AS d`,
    [input.lng, input.lat, input.currentLng, input.currentLat],
  );
  const d = Number(r.rows[0]?.d ?? 0);
  if (d > env.HOME_GPS_TOLERANCE_M) {
    throw new HttpError(400, 'too_far_from_home',
      `You must be at the location to set it (currently ${Math.round(d)} m away, max ${env.HOME_GPS_TOLERANCE_M} m)`);
  }
}

/**
 * Create the home for the first time.
 */
export async function createHome(input: SetHomeInput) {
  return withTx(async (client) => {
    const existing = await client.query(
      `SELECT 1 FROM captain_home WHERE captain_id = $1 FOR UPDATE`,
      [input.captainId],
    );
    if ((existing.rowCount ?? 0) > 0) {
      throw new HttpError(409, 'already_set',
        'Home already set. Use PATCH to correct (within 48h) or wait for the lock to expire.');
    }
    await assertGpsMatchesHome(client, input);

    const r = await client.query<HomeRow>(
      `INSERT INTO captain_home
         (captain_id, location, address_label, set_at, locked_until, correction_used)
       VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, $4,
               now(), now() + ($5 || ' days')::interval, false)
       RETURNING ${HOME_COLS}`,
      [input.captainId, input.lng, input.lat, input.label, env.HOME_LOCK_DAYS],
    );
    return shape(r.rows[0]!);
  });
}

/**
 * Update home — only allowed if:
 *   (a) locked_until has passed, OR
 *   (b) correction_used = false AND set_at within 48h.
 */
export async function updateHome(input: SetHomeInput) {
  return withTx(async (client) => {
    const r = await client.query<{
      set_at: Date;
      locked_until: Date;
      correction_used: boolean;
    }>(
      `SELECT set_at, locked_until, correction_used FROM captain_home
        WHERE captain_id = $1 FOR UPDATE`,
      [input.captainId],
    );
    const cur = r.rows[0];
    if (!cur) throw new HttpError(404, 'no_home', 'No home set');

    const now = Date.now();
    const expired = cur.locked_until.getTime() < now;
    const withinCorrectionWindow =
      !cur.correction_used && (now - cur.set_at.getTime()) < 48 * 3600_000;

    if (!expired && !withinCorrectionWindow) {
      throw new HttpError(409, 'locked',
        `Home is locked until ${cur.locked_until.toISOString()}`);
    }

    await assertGpsMatchesHome(client, input);

    // After an early correction within 48h, mark correction_used=true; do not
    // extend the lock. After a normal post-expiry update, reset the lock + flag.
    const sql = expired
      ? `UPDATE captain_home
            SET location = ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
                address_label = $3,
                set_at = now(),
                locked_until = now() + ($4 || ' days')::interval,
                correction_used = false
          WHERE captain_id = $5
        RETURNING ${HOME_COLS}`
      : `UPDATE captain_home
            SET location = ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
                address_label = $3,
                correction_used = true
          WHERE captain_id = $4
        RETURNING ${HOME_COLS}`;
    const params = expired
      ? [input.lng, input.lat, input.label, env.HOME_LOCK_DAYS, input.captainId]
      : [input.lng, input.lat, input.label, input.captainId];

    const upd = await client.query<HomeRow>(sql, params);
    return shape(upd.rows[0]!);
  });
}
