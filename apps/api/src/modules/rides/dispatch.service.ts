import { pool } from '../../db/pool.js';
import { env } from '../../config/env.js';

/**
 * Returns nearby searching rides for a captain, scored by:
 *   1. Pickup distance (closer = better)
 *   2. Favorite bonus: rides booked by riders who marked this captain favorite
 *   3. Homeward bonus: if captain is in going-home mode, rides whose dropoff
 *      brings them closer to home are boosted; rides taking them further away
 *      are filtered out.
 *
 * All searching rides may appear in multiple captains' inboxes; first-to-accept
 * wins (handled atomically in rides.service.ts via SELECT FOR UPDATE).
 */
export async function captainInbox(input: {
  captainId: string;
  lat: number;
  lng: number;
  radiusM?: number;
  limit?: number;
}) {
  const radius = input.radiusM ?? env.DISPATCH_RADIUS_M;
  const limit = input.limit ?? env.DISPATCH_TOP_N;

  // Score model (smaller = better, since we ORDER BY ASC):
  //   raw = distance_to_pickup_m
  //   if favorite: × 0.5  (huge boost — they pop to top)
  //   if going_home and ride drops closer to home: × (1 - progress) where
  //       progress = (currentHomeDist - dropoffHomeDist) / currentHomeDist, capped at 0.8
  //   if going_home and ride takes you FURTHER from home → excluded
  const sql = `
    WITH me AS (
      SELECT ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography AS pt
    ),
    cap AS (
      SELECT accepts_colis FROM captains WHERE user_id = $5
    ),
    gh AS (
      SELECT s.home_snapshot
        FROM captain_going_home_sessions s
       WHERE s.captain_id = $5 AND s.status = 'active'
       LIMIT 1
    )
    SELECT
      r.id,
      r.ride_type,
      r.is_for_other,
      r.pickup_label,
      r.dropoff_label,
      ST_Y(r.pickup_location::geometry)  AS pickup_lat,
      ST_X(r.pickup_location::geometry)  AS pickup_lng,
      ST_Y(r.dropoff_location::geometry) AS dropoff_lat,
      ST_X(r.dropoff_location::geometry) AS dropoff_lng,
      r.fare_estimate_khoums,
      r.distance_m,
      ST_Distance(r.pickup_location, me.pt)::int AS distance_to_pickup_m,
      r.requested_at,
      EXISTS (
        SELECT 1 FROM favorite_captains f
         WHERE f.captain_id = $5 AND f.rider_id = r.booker_id
      ) AS is_favorite,
      (
        SELECT CASE
          WHEN g.home_snapshot IS NULL THEN NULL
          ELSE ST_Distance(me.pt, g.home_snapshot) -
               ST_Distance(r.dropoff_location, g.home_snapshot)
        END
        FROM (SELECT home_snapshot FROM gh) g
      ) AS homeward_progress_m
    FROM rides r, me
    CROSS JOIN cap
    WHERE r.status = 'searching'
      AND ST_DWithin(r.pickup_location, me.pt, $3)
      AND (r.ride_type <> 'colis' OR cap.accepts_colis = true)
      -- If in going-home mode: drop rides that move us AWAY from home
      AND (
        NOT EXISTS (SELECT 1 FROM gh)
        OR (SELECT ST_Distance(me.pt, g.home_snapshot) -
                   ST_Distance(r.dropoff_location, g.home_snapshot)
              FROM (SELECT home_snapshot FROM gh) g) >= 0
      )
    ORDER BY
      -- Compose a score with smaller = better.
      (
        CASE WHEN EXISTS (SELECT 1 FROM favorite_captains f
                           WHERE f.captain_id = $5 AND f.rider_id = r.booker_id)
             THEN 0.5 ELSE 1.0
        END
      ) * (
        ST_Distance(r.pickup_location, me.pt) * (
          CASE
            WHEN NOT EXISTS (SELECT 1 FROM gh) THEN 1.0
            ELSE GREATEST(0.2,
              1.0 - LEAST(0.8,
                (SELECT (ST_Distance(me.pt, g.home_snapshot) -
                         ST_Distance(r.dropoff_location, g.home_snapshot))
                      / NULLIF(ST_Distance(me.pt, g.home_snapshot), 0)
                   FROM (SELECT home_snapshot FROM gh) g)
              )
            )
          END
        )
      ) ASC,
      r.requested_at ASC
    LIMIT $4
  `;

  const r = await pool.query(sql, [input.lng, input.lat, radius, limit, input.captainId]);
  return r.rows.map((row) => ({
    id: row.id,
    rideType: row.ride_type,
    isForOther: row.is_for_other,
    pickup: { lat: row.pickup_lat, lng: row.pickup_lng, label: row.pickup_label },
    dropoff: { lat: row.dropoff_lat, lng: row.dropoff_lng, label: row.dropoff_label },
    fareEstimateKhoums: Number(row.fare_estimate_khoums),
    distanceM: row.distance_m,
    distanceToPickupM: row.distance_to_pickup_m,
    requestedAt: row.requested_at,
    isFavorite: row.is_favorite,
    homewardProgressM: row.homeward_progress_m === null ? null : Number(row.homeward_progress_m),
  }));
}

/**
 * Crow-flies distance between two points (meters), using PostGIS.
 * Cheap helper; used by ride creation to estimate the fare.
 */
export async function distanceMeters(
  fromLat: number, fromLng: number,
  toLat: number, toLng: number,
): Promise<number> {
  const r = await pool.query<{ d: string }>(
    `SELECT ST_Distance(
       ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
       ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography
     ) AS d`,
    [fromLng, fromLat, toLng, toLat],
  );
  return Number(r.rows[0]?.d ?? 0);
}
