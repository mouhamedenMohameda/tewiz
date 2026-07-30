import { pool } from '../../db/pool.js';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import {
  dispatchInboxDuration,
  dispatchEligibleDuration,
  dispatchGeoFallback,
  dispatchGeoMismatch,
} from '../../lib/metrics.js';
import { getPricingSettings } from '../admin/app-settings.service.js';
import { isTrackingEnabled } from '../captain/track.service.js';
import { captainsNear } from '../captain/live-location.js';

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
  const { longDistanceThresholdM } = await getPricingSettings();

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
      SELECT vehicle_type, accepts_colis, accepts_long_distance FROM captains WHERE user_id = $5
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
      r.source,
      r.is_for_other,
      r.pickup_label,
      r.dropoff_label,
      ST_Y(r.pickup_location::geometry)  AS pickup_lat,
      ST_X(r.pickup_location::geometry)  AS pickup_lng,
      ST_Y(r.dropoff_location::geometry) AS dropoff_lat,
      ST_X(r.dropoff_location::geometry) AS dropoff_lng,
      r.fare_estimate_mru,
      r.distance_m,
      r.is_open,
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
      ) AS homeward_progress_m,
      pd.booked_duration_h,
      cv.vehicle_plate,
      cv.vehicle_description
    FROM rides r
    CROSS JOIN me
    CROSS JOIN cap
    LEFT JOIN private_driver_details pd ON pd.ride_id = r.id
    LEFT JOIN convoyage_details cv ON cv.ride_id = r.id
    WHERE r.status = 'searching'
      AND ST_DWithin(r.pickup_location, me.pt, $3)
      AND (
        (r.ride_type = 'colis' AND (cap.vehicle_type = 'moto' OR cap.accepts_colis = true))
        OR (r.ride_type <> 'colis' AND cap.vehicle_type = 'car')
      )
      -- Long-distance gate: rides whose total trip is >= the admin threshold
      -- are only offered to captains who opted in. distance_m may be null on
      -- legacy rows — treat null as "not long-distance" to stay permissive.
      AND (COALESCE(r.distance_m, 0) < $6 OR cap.accepts_long_distance = true)
      -- A captain who booked a ride in rider mode must never be offered their own ride.
      AND r.booker_id <> $5
      -- A captain who already pressed "Refuser" on this ride should never see
      -- it again — neither in the inbox list nor in the alert modal.
      AND NOT EXISTS (
        SELECT 1 FROM ride_declines d
         WHERE d.ride_id = r.id AND d.captain_id = $5
      )
      -- If in going-home mode: drop rides that move us AWAY from home.
      -- Open rides have no dropoff to compare against — they pass through
      -- this gate by default (captain decides en route whether to take it).
      AND (
        NOT EXISTS (SELECT 1 FROM gh)
        OR r.dropoff_location IS NULL
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

  // Timed because this is the hottest query in the system: every online captain
  // runs it on a poll loop, and it does PostGIS distance work against every
  // searching ride. When its p95 degrades, dispatch degrades for every captain
  // simultaneously — and on a single box that shares CPU with Postgres, this is
  // the query that will show it first.
  const queryStarted = process.hrtime.bigint();
  const r = await pool.query(sql, [input.lng, input.lat, radius, limit, input.captainId, longDistanceThresholdM]);
  dispatchInboxDuration.observe(Number(process.hrtime.bigint() - queryStarted) / 1e9);
  return r.rows.map((row) => ({
    id: row.id,
    rideType: row.ride_type,
    source: row.source,
    isForOther: row.is_for_other,
    pickup: { lat: row.pickup_lat, lng: row.pickup_lng, label: row.pickup_label },
    dropoff: { lat: row.dropoff_lat, lng: row.dropoff_lng, label: row.dropoff_label },
    fareEstimateMru: Number(row.fare_estimate_mru),
    distanceM: row.distance_m,
    distanceToPickupM: row.distance_to_pickup_m,
    requestedAt: row.requested_at,
    isFavorite: row.is_favorite,
    homewardProgressM: row.homeward_progress_m === null ? null : Number(row.homeward_progress_m),
    isOpen: !!row.is_open,
    bookedDurationH: row.booked_duration_h ?? null,
    vehiclePlate: row.vehicle_plate ?? null,
    vehicleDescription: row.vehicle_description ?? null,
  }));
}

/**
 * The business half of captain selection, shared verbatim by both geo sources.
 *
 * These rules stay in Postgres and in ONE string on purpose. Redis answers only
 * "who is nearby and fresh"; if these predicates were duplicated per path, the
 * PostGIS and Redis routes could silently start disagreeing about who is
 * eligible — which is exactly what shadow mode is supposed to be able to rule
 * out. $1 = ride id, $2 = long-distance threshold in both queries.
 */
const ELIGIBILITY_RULES = `
       AND (
         (r.ride_type = 'colis' AND (c.vehicle_type = 'moto' OR c.accepts_colis = true))
         OR (r.ride_type <> 'colis' AND c.vehicle_type = 'car')
       )
       AND (COALESCE(r.distance_m, 0) < $2 OR c.accepts_long_distance = true)
       AND s.captain_id <> r.booker_id
       AND NOT EXISTS (
         SELECT 1 FROM ride_declines d
          WHERE d.ride_id = r.id AND d.captain_id = s.captain_id
       )`;

/**
 * Candidate selection via PostGIS — the original path.
 *
 * Kept as the fallback for `redis` mode, so this is deliberately NOT dead code:
 * dispatch must never stop because Redis is unavailable.
 */
async function eligibleViaPostgres(
  rideId: string,
  longDistanceThresholdM: number,
): Promise<string[]> {
  // Freshness guard: only trust a captain's stored position while off-ride
  // tracking is on (that's what keeps it current). When tracking is off we
  // can't keep positions fresh, so skip the guard to avoid dropping everyone.
  const enforceFreshness = await isTrackingEnabled();
  const { rows } = await pool.query<{ captain_id: string }>(
    `
    WITH r AS (
      SELECT id, booker_id, ride_type, pickup_location, distance_m
        FROM rides WHERE id = $1
    )
    SELECT s.captain_id
      FROM captain_state s
      JOIN captains   c ON c.user_id = s.captain_id
      CROSS JOIN r
     WHERE s.presence = 'online'
       AND s.location IS NOT NULL
       AND ST_DWithin(s.location, r.pickup_location, $3)
       -- Stale-position guard: skip captains whose location hasn't refreshed
       -- recently (they may have moved without the tracker catching up).
       AND (
         NOT $4::boolean
         OR s.location_updated_at IS NULL
         OR s.location_updated_at > now() - make_interval(secs => $5)
       )${ELIGIBILITY_RULES}
    `,
    [rideId, longDistanceThresholdM, env.DISPATCH_RADIUS_M, enforceFreshness, env.DISPATCH_MAX_LOCATION_AGE_S],
  );
  return rows.map((row) => row.captain_id);
}

/**
 * Candidate selection given an id list Redis already narrowed by distance and
 * freshness. Same business rules, no ST_DWithin, no freshness predicate — those
 * two are precisely the work that moved into memory.
 */
async function eligibleViaCandidateIds(
  rideId: string,
  longDistanceThresholdM: number,
  candidateIds: string[],
): Promise<string[]> {
  if (candidateIds.length === 0) return [];
  const { rows } = await pool.query<{ captain_id: string }>(
    `
    WITH r AS (
      SELECT id, booker_id, ride_type, pickup_location, distance_m
        FROM rides WHERE id = $1
    )
    SELECT s.captain_id
      FROM captain_state s
      JOIN captains   c ON c.user_id = s.captain_id
      CROSS JOIN r
     WHERE s.captain_id = ANY($3::uuid[])
       AND s.presence = 'online'${ELIGIBILITY_RULES}
    `,
    [rideId, longDistanceThresholdM, candidateIds],
  );
  return rows.map((row) => row.captain_id);
}

/** Pickup coordinates for a ride — a PK lookup, needed to query the geo index. */
async function ridePickup(rideId: string): Promise<{ lat: number; lng: number } | null> {
  const { rows } = await pool.query<{ lat: string | null; lng: string | null }>(
    `SELECT ST_Y(pickup_location::geometry) AS lat,
            ST_X(pickup_location::geometry) AS lng
       FROM rides WHERE id = $1`,
    [rideId],
  );
  const row = rows[0];
  if (!row || row.lat === null || row.lng === null) return null;
  const lat = Number(row.lat);
  const lng = Number(row.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

/**
 * Returns the user_ids of every captain currently eligible to receive a
 * push notification for the given ride. Mirrors the same filters as the
 * inbox query (online, within radius, filtered by vehicle type and colis
 * preference, not the booker themselves).
 *
 * The "who is nearby" half comes from either PostGIS or the Redis geo index,
 * per DISPATCH_GEO_SOURCE. See that flag's note in config/env.ts for the
 * rollout order — the short version is that `shadow` proves the two agree
 * before `redis` is allowed to serve.
 */
export async function eligibleCaptainsForRide(rideId: string): Promise<string[]> {
  const source = env.DISPATCH_GEO_SOURCE;
  const started = process.hrtime.bigint();
  try {
    return await selectEligibleCaptains(rideId, source);
  } finally {
    // In a `finally` so a fallback or a thrown error is still timed. A migration
    // measured only on its happy path tells you nothing about the day it breaks.
    dispatchEligibleDuration.observe(
      { source },
      Number(process.hrtime.bigint() - started) / 1e9,
    );
  }
}

async function selectEligibleCaptains(
  rideId: string,
  source: 'postgres' | 'shadow' | 'redis',
): Promise<string[]> {
  const { longDistanceThresholdM } = await getPricingSettings();

  if (source === 'postgres') {
    return eligibleViaPostgres(rideId, longDistanceThresholdM);
  }

  // Ask Redis for the nearby+fresh candidates, then apply the business rules to
  // them. `null` means Redis could not answer (an empty array is a real answer:
  // nobody is nearby, which must NOT trigger a fallback).
  let viaRedis: string[] | null = null;
  try {
    const pickup = await ridePickup(rideId);
    if (pickup) {
      // Mirror the PostGIS freshness rule exactly: the stale-position guard only
      // applies while off-ride tracking keeps positions current. Diverging here
      // would make the two sources disagree by construction.
      const maxAgeS = (await isTrackingEnabled()) ? env.DISPATCH_MAX_LOCATION_AGE_S : null;
      const nearby = await captainsNear(pickup.lat, pickup.lng, env.DISPATCH_RADIUS_M, maxAgeS);
      viaRedis = await eligibleViaCandidateIds(rideId, longDistanceThresholdM, nearby);
    }
  } catch (err) {
    logger.warn({ err, rideId }, 'dispatch: redis geo lookup failed, falling back to PostGIS');
  }

  if (source === 'shadow') {
    // Serve Postgres, compare, count. Both sets have been through the same
    // business rules, so any difference is a genuine geo/freshness divergence
    // and not an artifact of comparing different things.
    const viaPostgres = await eligibleViaPostgres(rideId, longDistanceThresholdM);
    if (viaRedis === null) {
      dispatchGeoFallback.inc();
    } else {
      const redisSet = new Set(viaRedis);
      const postgresSet = new Set(viaPostgres);
      const missing = viaPostgres.filter((id) => !redisSet.has(id)).length;
      const extra = viaRedis.filter((id) => !postgresSet.has(id)).length;
      if (missing > 0) dispatchGeoMismatch.inc({ direction: 'missing' }, missing);
      if (extra > 0) dispatchGeoMismatch.inc({ direction: 'extra' }, extra);
      if (missing > 0 || extra > 0) {
        logger.warn({ rideId, missing, extra }, 'dispatch: shadow mismatch between redis and postgis');
      }
    }
    return viaPostgres;
  }

  // source === 'redis'
  if (viaRedis === null) {
    dispatchGeoFallback.inc();
    return eligibleViaPostgres(rideId, longDistanceThresholdM);
  }
  return viaRedis;
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
