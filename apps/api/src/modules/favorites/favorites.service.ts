import { pool } from '../../db/pool.js';
import { HttpError } from '../../middleware/error.js';

export async function addFavorite(riderId: string, captainId: string, nickname?: string) {
  // Verify the captain exists and is active.
  const c = await pool.query<{ status: string }>(
    `SELECT status FROM captains WHERE user_id = $1`,
    [captainId],
  );
  if (!c.rows[0]) throw new HttpError(404, 'captain_not_found', 'Captain not found');
  if (c.rows[0].status !== 'active') {
    throw new HttpError(409, 'captain_inactive', `Captain is ${c.rows[0].status}`);
  }

  await pool.query(
    `INSERT INTO favorite_captains (rider_id, captain_id, nickname)
     VALUES ($1, $2, $3)
     ON CONFLICT (rider_id, captain_id) DO UPDATE
       SET nickname = COALESCE(EXCLUDED.nickname, favorite_captains.nickname)`,
    [riderId, captainId, nickname ?? null],
  );
  return { riderId, captainId, nickname: nickname ?? null };
}

export async function removeFavorite(riderId: string, captainId: string) {
  const r = await pool.query(
    `DELETE FROM favorite_captains WHERE rider_id = $1 AND captain_id = $2`,
    [riderId, captainId],
  );
  if ((r.rowCount ?? 0) === 0) {
    throw new HttpError(404, 'not_a_favorite', 'Not in your favorites');
  }
}

export async function listMyFavorites(riderId: string) {
  const r = await pool.query(
    `SELECT f.captain_id,
            f.nickname,
            f.added_at,
            u.full_name AS captain_name,
            u.phone     AS captain_phone,
            c.rating_avg,
            c.total_rides
       FROM favorite_captains f
       JOIN users    u ON u.id = f.captain_id
       JOIN captains c ON c.user_id = f.captain_id
      WHERE f.rider_id = $1
      ORDER BY f.added_at DESC`,
    [riderId],
  );
  return r.rows.map((row) => ({
    captainId: row.captain_id,
    nickname: row.nickname,
    captainName: row.captain_name,
    captainPhone: row.captain_phone,
    ratingAvg: Number(row.rating_avg ?? 0),
    totalRides: row.total_rides,
    addedAt: row.added_at,
  }));
}

/**
 * Captain-side: how many riders favorited me?
 */
export async function countMyFans(captainId: string) {
  const r = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM favorite_captains WHERE captain_id = $1`,
    [captainId],
  );
  return Number(r.rows[0]?.n ?? 0);
}
