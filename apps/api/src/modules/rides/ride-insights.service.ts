/**
 * Rich pre-acceptance context for the captain alert screen.
 *
 * Two angles, both designed to encourage acceptance:
 *
 *   1. Destination demand — "if I go there, will I find another ride?"
 *      We count rides that LAUNCHED from within a few km of THIS ride's
 *      dropoff, both in the last 2 hours and in a 2-hour window centered on
 *      the same clock-hour yesterday. The captain can compare "right now" to
 *      "what it usually looks like" before committing.
 *
 *   2. Rider trust — "is this passenger reliable?"
 *      We aggregate the booker's lifetime stats: total rides, completion
 *      rate, no-show rate, average star rating, and how long they've been
 *      a member. This is the same signal Uber/Bolt show to drivers.
 *
 * Everything runs in a single Postgres roundtrip per section (no N+1) and
 * skips rides created by guests (which have no meaningful history).
 */

import { pool } from '../../db/pool.js';

const DEST_RADIUS_M = 2_000; // 2 km around the dropoff
const RECENT_WINDOW_S = 2 * 60 * 60; // 2 hours
const YESTERDAY_HALF_WINDOW_S = 60 * 60; // ±1h around the same clock-hour yesterday
// POI enrichment: when the rider didn't pick a proper place (label is null or
// a generic "Pin on map"), we hunt for the nearest named POI within this
// radius and use it as a "Près de X" overlay so the captain isn't staring at
// "Point sur la carte". For the higher-level neighborhood, we look further
// because OSM `place` nodes (quartiers/villes) are scarcer.
const POI_NEAR_RADIUS_M = 800;
const NEIGHBORHOOD_RADIUS_M = 5_000;

export interface PoiLite {
  name: string;
  distanceM: number;
  // Human-friendly category derived from OSM tags (Marché, Restaurant, Mosquée…).
  // Null when the tag combination doesn't map to a known label.
  category: string | null;
}

export interface EndpointEnrichment {
  // The nearest popular POI within ~800 m (any category). Used to build a
  // "Près de Marché Capitale" label when the original is generic.
  nearestPoi: PoiLite | null;
  // The nearest OSM `place` node (city / town / suburb / neighbourhood / quarter
  // / village) within ~5 km — used as a coarse "moughataa"-ish locator.
  neighborhood: PoiLite | null;
}

export interface RideInsights {
  destination: {
    radiusKm: number;
    ridesLast2h: number;
    ridesYesterdaySameHour: number;
    // Convenience trend label so the client doesn't re-derive it.
    trend: 'hotter' | 'cooler' | 'similar';
    // Up to 8 popular POIs within 1.5 km of the dropoff, sorted by a blended
    // popularity × proximity score. Powers the "Voir plus" expandable list so
    // the captain knows what awaits at the destination.
    nearbyPois: PoiLite[];
  };
  rider: {
    // Null for guest bookers (no account history to show).
    userId: string | null;
    fullName: string | null;
    memberSince: string | null;       // ISO date, when the rider account was created
    totalRides: number;               // any status, lifetime
    completedRides: number;
    cancelledByRiderRides: number;
    noShowRides: number;
    completionRate: number;           // 0..1, completed / (total - searching/active)
    avgRating: number | null;         // 1..5, null if no ratings yet
    ratingsCount: number;
  };
  pickup: EndpointEnrichment;
  // null for open rides (no upfront dropoff).
  dropoff: EndpointEnrichment | null;
}

interface DestRow {
  rides_last_2h: string;
  rides_yesterday: string;
}

interface RiderRow {
  user_id: string | null;
  full_name: string | null;
  created_at: Date | null;
  total: string;
  completed: string;
  cancelled_by_rider: string;
  no_show: string;
  avg_rating: string | null;
  ratings_count: string;
}

/**
 * Map an OSM (kind, value) pair to a friendly French category label. We keep
 * this list narrow on purpose: anything not mapped → category = null and the
 * client just shows the POI name. Adding more entries here is cheap.
 */
function osmToCategory(osmKind: string, osmValue: string | null): string | null {
  const key = `${osmKind}:${osmValue ?? ''}`;
  const map: Record<string, string> = {
    'amenity:marketplace':   'Marché',
    'amenity:place_of_worship': 'Mosquée',
    'amenity:hospital':      'Hôpital',
    'amenity:clinic':        'Clinique',
    'amenity:pharmacy':      'Pharmacie',
    'amenity:school':        'École',
    'amenity:university':    'Université',
    'amenity:fuel':          'Station-service',
    'amenity:restaurant':    'Restaurant',
    'amenity:cafe':          'Café',
    'amenity:bank':          'Banque',
    'amenity:police':        'Police',
    'amenity:taxi':          'Station taxi',
    'shop:supermarket':      'Supermarché',
    'shop:bakery':           'Boulangerie',
    'shop:mall':             'Centre commercial',
    'tourism:hotel':         'Hôtel',
    'leisure:park':          'Parc',
    'leisure:stadium':       'Stade',
    'office:government':     'Administration',
  };
  if (map[key]) return map[key];
  // Fallback by top-level kind.
  const byKind: Record<string, string> = {
    amenity: 'Service',
    shop: 'Commerce',
    tourism: 'Tourisme',
    leisure: 'Loisirs',
    office: 'Bureau',
  };
  return byKind[osmKind] ?? null;
}

interface PoiRow {
  name: string;
  dist_m: string;
  osm_kind: string;
  osm_value: string | null;
}

/**
 * Find the nearest named POI to (lat, lng) within `radiusM`. When
 * `placesOnly` is true, restrict to `osm_kind = 'place'` (= cities, towns,
 * suburbs, neighbourhoods, quarters, villages) — used for the coarse
 * "neighbourhood" label.
 *
 * Returns null if nothing matches. Best-effort: on any DB error, we resolve
 * to null so the insights endpoint never fails because of POI enrichment.
 */
async function nearestPoi(
  lat: number,
  lng: number,
  radiusM: number,
  placesOnly: boolean,
): Promise<PoiLite | null> {
  try {
    const placeFilter = placesOnly ? `AND p.osm_kind = 'place'` : '';
    const { rows } = await pool.query<PoiRow>(
      `SELECT COALESCE(p.name_fr, p.name_default) AS name,
              ST_Distance(
                ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326)::geography,
                ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
              )::int AS dist_m,
              p.osm_kind, p.osm_value
         FROM voiceloc_pois p
        WHERE p.lat BETWEEN $2 - 0.06 AND $2 + 0.06
          AND p.lng BETWEEN $1 - 0.06 AND $1 + 0.06
          ${placeFilter}
          AND ST_DWithin(
            ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326)::geography,
            ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
            $3
          )
        ORDER BY ST_Distance(
            ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326)::geography,
            ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
          ) ASC
        LIMIT 1`,
      [lng, lat, radiusM],
    );
    if (!rows[0]) return null;
    return {
      name: rows[0].name,
      distanceM: Number(rows[0].dist_m),
      category: osmToCategory(rows[0].osm_kind, rows[0].osm_value),
    };
  } catch {
    return null;
  }
}

/**
 * Top-N popular POIs around a point. Ranked by `popularity DESC` first, then
 * `distance ASC` — so a big landmark a few hundred meters away beats a tiny
 * corner shop right next door. Used to populate the "Voir plus" panel on the
 * captain alert modal.
 *
 * Excludes `osm_kind = 'place'` because those are administrative tags, not
 * destinations a captain or rider would think of.
 */
async function nearbyPois(
  lat: number,
  lng: number,
  radiusM: number,
  limit: number,
): Promise<PoiLite[]> {
  try {
    const { rows } = await pool.query<PoiRow>(
      `SELECT COALESCE(p.name_fr, p.name_default) AS name,
              ST_Distance(
                ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326)::geography,
                ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
              )::int AS dist_m,
              p.osm_kind, p.osm_value
         FROM voiceloc_pois p
        WHERE p.lat BETWEEN $2 - 0.06 AND $2 + 0.06
          AND p.lng BETWEEN $1 - 0.06 AND $1 + 0.06
          AND p.osm_kind <> 'place'
          AND ST_DWithin(
            ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326)::geography,
            ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
            $3
          )
        ORDER BY p.popularity DESC,
                 ST_Distance(
                   ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326)::geography,
                   ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
                 ) ASC
        LIMIT $4`,
      [lng, lat, radiusM, limit],
    );
    return rows.map((r) => ({
      name: r.name,
      distanceM: Number(r.dist_m),
      category: osmToCategory(r.osm_kind, r.osm_value),
    }));
  } catch {
    return [];
  }
}

async function enrichEndpoint(lat: number, lng: number): Promise<EndpointEnrichment> {
  const [near, nbh] = await Promise.all([
    nearestPoi(lat, lng, POI_NEAR_RADIUS_M, false),
    nearestPoi(lat, lng, NEIGHBORHOOD_RADIUS_M, true),
  ]);
  return { nearestPoi: near, neighborhood: nbh };
}

/**
 * Returns the full insights bundle for one ride. The caller must ensure the
 * captain is allowed to see this ride — this function does NOT check perms.
 */
export async function getRideInsights(rideId: string): Promise<RideInsights> {
  // Pull pickup + dropoff + booker_id once. Everything else hangs off these.
  const head = await pool.query<{
    booker_id: string;
    pickup_lat: number;
    pickup_lng: number;
    dropoff_lat: number | null;
    dropoff_lng: number | null;
  }>(
    `SELECT booker_id,
            ST_Y(pickup_location::geometry)  AS pickup_lat,
            ST_X(pickup_location::geometry)  AS pickup_lng,
            ST_Y(dropoff_location::geometry) AS dropoff_lat,
            ST_X(dropoff_location::geometry) AS dropoff_lng
       FROM rides WHERE id = $1`,
    [rideId],
  );
  if (!head.rows[0]) {
    throw new Error(`ride ${rideId} not found`);
  }
  const {
    booker_id: bookerId,
    pickup_lat:  puLat,  pickup_lng:  puLng,
    dropoff_lat: lat,    dropoff_lng: lng,
  } = head.rows[0];
  // Open rides have no destination → no "destination zone demand" to compute.
  // Use the pickup as the zone of interest so the captain still gets some
  // useful context (recent activity near the rider).
  const hasDestination = lat != null && lng != null;
  const destLat = hasDestination ? lat : puLat;
  const destLng = hasDestination ? lng : puLng;

  // ─── Destination demand ──────────────────────────────────────────────────
  // Excludes the current ride itself from the counts; we only count rides
  // that actually started "for real" (status not pending_passenger_confirm).
  const destPromise = pool.query<DestRow>(
    `WITH dest AS (
       SELECT ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography AS pt
     )
     SELECT
       COUNT(*) FILTER (
         WHERE r.requested_at >= now() - make_interval(secs => $4)
       ) AS rides_last_2h,
       COUNT(*) FILTER (
         WHERE r.requested_at BETWEEN
               (now() - interval '1 day') - make_interval(secs => $5)
           AND (now() - interval '1 day') + make_interval(secs => $5)
       ) AS rides_yesterday
       FROM rides r, dest
      WHERE r.id <> $6
        AND r.status <> 'pending_passenger_confirm'
        AND ST_DWithin(r.dropoff_location, dest.pt, $3)`,
    [destLng, destLat, DEST_RADIUS_M, RECENT_WINDOW_S, YESTERDAY_HALF_WINDOW_S, rideId],
  );

  // ─── Rider stats ─────────────────────────────────────────────────────────
  // Subquery-per-metric so we always return exactly one row, even when the
  // booker is a guest (no users entry). The previous WITH+FULL OUTER JOIN
  // version was both fragile (could yield 0 rows depending on data shape)
  // and inefficient (cross-joined the entire users table).
  const riderPromise = pool.query<RiderRow>(
    `SELECT
        (SELECT id         FROM users WHERE id = $1)                                                AS user_id,
        (SELECT full_name  FROM users WHERE id = $1)                                                AS full_name,
        (SELECT created_at FROM users WHERE id = $1)                                                AS created_at,
        (SELECT COUNT(*)                       FROM rides   WHERE booker_id = $1)                   AS total,
        (SELECT COUNT(*) FILTER (WHERE status = 'completed')           FROM rides WHERE booker_id = $1) AS completed,
        (SELECT COUNT(*) FILTER (WHERE status = 'cancelled_by_rider')  FROM rides WHERE booker_id = $1) AS cancelled_by_rider,
        (SELECT COUNT(*) FILTER (WHERE status = 'no_show')             FROM rides WHERE booker_id = $1) AS no_show,
        (SELECT AVG(stars)::numeric(3,2)       FROM ratings WHERE ratee_id = $1)                    AS avg_rating,
        (SELECT COUNT(*)                       FROM ratings WHERE ratee_id = $1)                    AS ratings_count`,
    [bookerId],
  );

  const [destRes, riderRes, pickupEnr, dropoffEnr, destNearbyPois] = await Promise.all([
    destPromise,
    riderPromise,
    enrichEndpoint(puLat, puLng),
    hasDestination ? enrichEndpoint(lat!, lng!) : Promise.resolve(null),
    // Top 8 popular landmarks around the dropoff — shown in the modal under
    // a "Voir plus" expander. Skipped for open rides (no dropoff yet).
    hasDestination ? nearbyPois(lat!, lng!, 1_500, 8) : Promise.resolve([]),
  ]);
  const dest = destRes.rows[0]!;
  // The rider query is built so it always returns exactly one row, even for
  // a guest booker (user_id will be null in that case).
  const rider = riderRes.rows[0]!;

  const ridesLast2h = Number(dest.rides_last_2h);
  const ridesYesterdaySameHour = Number(dest.rides_yesterday);

  // Trend: meaningful only if there's at least one ride in either window.
  let trend: 'hotter' | 'cooler' | 'similar' = 'similar';
  if (ridesLast2h > ridesYesterdaySameHour * 1.2) trend = 'hotter';
  else if (ridesLast2h < ridesYesterdaySameHour * 0.8) trend = 'cooler';

  const total = Number(rider.total);
  const completed = Number(rider.completed);
  const cancelledByRider = Number(rider.cancelled_by_rider);
  const noShow = Number(rider.no_show);
  // Denominator excludes the current ride and any other still-searching/active
  // rides because they aren't a verdict yet. We approximate "resolved rides"
  // as completed + cancelled_by_rider + no_show.
  const resolved = completed + cancelledByRider + noShow;
  const completionRate = resolved === 0 ? 0 : completed / resolved;

  return {
    destination: {
      radiusKm: DEST_RADIUS_M / 1_000,
      ridesLast2h,
      ridesYesterdaySameHour,
      trend,
      nearbyPois: destNearbyPois,
    },
    rider: {
      userId: rider.user_id ?? null,
      fullName: rider.full_name ?? null,
      memberSince: rider.created_at ? rider.created_at.toISOString() : null,
      totalRides: total,
      completedRides: completed,
      cancelledByRiderRides: cancelledByRider,
      noShowRides: noShow,
      completionRate,
      avgRating: rider.avg_rating === null ? null : Number(rider.avg_rating),
      ratingsCount: Number(rider.ratings_count),
    },
    pickup: pickupEnr,
    dropoff: dropoffEnr,
  };
}
