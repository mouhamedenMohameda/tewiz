/**
 * Live captain positions, in Redis.
 *
 * Why this exists:
 *   Every online captain pushes their position on a loop, and each push used to
 *   be an UPDATE on `captain_state` — the same PostGIS table dispatch scans to
 *   find nearby captains. The most-written table was also the one on the hottest
 *   read path, on a box that already shares a CPU with Redis, studara-api and
 *   tewiz-voice-api. This moves the expensive half (distance over every captain)
 *   into memory.
 *
 * What lives here and what does NOT:
 *   Redis answers exactly one question — "which captains are within X metres and
 *   have a fresh position?". Every business rule (vehicle type, colis, long
 *   distance, declines, presence) stays in Postgres. Duplicating those rules
 *   here would buy microseconds and cost us a second place to keep them correct.
 *
 * Two keys, not one:
 *   captains:geo   GEO (a sorted set)  member = captain_id, value = lng/lat
 *   captains:seen  sorted set          member = captain_id, score = epoch ms
 *
 *   A GEO key has no per-member TTL, so a captain who kills their phone would
 *   otherwise sit at their last position forever. `captains:seen` carries the
 *   freshness, and a stale entry is filtered on read (and purged in one command).
 *
 * Requires Redis >= 6.2 for GEOSEARCH and ZMSCORE. The server runs Redis 7.
 */

import { redis } from '../../db/redis.js';
import { pool } from '../../db/pool.js';
import { logger } from '../../lib/logger.js';
import { redisGeosearchDuration } from '../../lib/metrics.js';

export const GEO_KEY = 'captains:geo';
export const SEEN_KEY = 'captains:seen';

/**
 * Record a captain's current position.
 *
 * Deliberately never throws: this sits on the position-report path, which must
 * keep working when Redis is down. Postgres remains the source of truth while
 * DISPATCH_GEO_SOURCE is `postgres` or `shadow`, so a dropped write costs
 * freshness, not correctness — and `shadow` mode is what surfaces the drift
 * before we ever trust Redis to serve reads.
 */
export async function setLiveLocation(
  captainId: string,
  lat: number,
  lng: number,
  /**
   * When this position was actually fixed, in epoch ms. Defaults to now, which
   * is right for a position the captain just reported.
   *
   * Callers mirroring an OLDER position — `/online` re-seeding a captain from the
   * row Postgres kept — must pass the real `location_updated_at`. Stamping such a
   * position as just-seen would make Redis consider fresh what PostGIS considers
   * stale, and `redis` mode would notify captains `postgres` mode filters out.
   */
  seenMs: number = Date.now(),
): Promise<void> {
  try {
    await redis
      .multi()
      .geoadd(GEO_KEY, lng, lat, captainId) // note the order: lng BEFORE lat
      .zadd(SEEN_KEY, seenMs, captainId)
      .exec();
  } catch (err) {
    logger.warn({ err, captainId }, 'live-location: redis write failed (position not mirrored)');
  }
}

/**
 * Drop a captain from the live index — called when they go offline.
 *
 * A GEO key IS a sorted set, so ZREM is the correct removal for both keys.
 */
export async function clearLiveLocation(captainId: string): Promise<void> {
  try {
    await redis
      .multi()
      .zrem(GEO_KEY, captainId)
      .zrem(SEEN_KEY, captainId)
      .exec();
  } catch (err) {
    logger.warn({ err, captainId }, 'live-location: redis clear failed (captain may linger in geo index)');
  }
}

/**
 * Captain ids within `radiusM` of a point, nearest first.
 *
 * `maxAgeS` of `null` skips the freshness filter entirely. That is not a
 * convenience knob — it mirrors the PostGIS path, which only applies its
 * stale-position guard while off-ride tracking is on (tracking is what keeps
 * positions current; with it off the guard would drop everybody). If this
 * filter ran unconditionally, `redis` mode would silently stop notifying
 * captains that `postgres` mode still reaches, and shadow mode would report
 * mismatches forever.
 *
 * Throws if Redis is unreachable — callers decide whether to fall back to
 * PostGIS. That distinction matters: an empty array means "nobody is nearby"
 * and must NOT trigger a fallback, while an error means "we don't know" and
 * must.
 */
export async function captainsNear(
  lat: number,
  lng: number,
  radiusM: number,
  maxAgeS: number | null,
): Promise<string[]> {
  const started = process.hrtime.bigint();
  const ids = (await redis.geosearch(
    GEO_KEY, 'FROMLONLAT', lng, lat, 'BYRADIUS', radiusM, 'm', 'ASC',
  )) as string[];
  redisGeosearchDuration.observe(Number(process.hrtime.bigint() - started) / 1e9);

  if (ids.length === 0 || maxAgeS === null) return ids;

  // Freshness filter: an id with no score, or one too old, is dropped. A member
  // can be in the geo key without a `seen` score if a write was interrupted
  // between the two commands, so a missing score is treated as stale, not fresh.
  const cutoff = Date.now() - maxAgeS * 1000;
  const scores = await redis.zmscore(SEEN_KEY, ...ids);
  return ids.filter((_, i) => scores[i] !== null && Number(scores[i]) >= cutoff);
}

/**
 * Reload the live index from `captain_state`.
 *
 * Redis starts empty. Without this, the first deploy leaves nobody in
 * `captains:geo` — so in `redis` mode no captain is reachable by notification
 * until each one happens to report a position again. Idempotent (GEOADD and
 * ZADD both overwrite), so it is safe to run on every boot.
 *
 * Never throws: a warm-up failure must not stop the API from starting.
 */
export async function warmLiveLocations(): Promise<number> {
  try {
    const { rows } = await pool.query<{
      captain_id: string; lat: string | null; lng: string | null; seen_ms: string | null;
    }>(`
      SELECT captain_id,
             ST_Y(location::geometry) AS lat,
             ST_X(location::geometry) AS lng,
             EXTRACT(epoch FROM location_updated_at) * 1000 AS seen_ms
        FROM captain_state
       WHERE presence <> 'offline' AND location IS NOT NULL`);

    if (rows.length === 0) {
      logger.info('live-location: warm-up found no online captains with a position');
      return 0;
    }

    const pipeline = redis.pipeline();
    for (const row of rows) {
      // The `null` checks are not redundant with Number.isFinite: Number(null)
      // is 0, which is perfectly finite, so a row with no position would be
      // warmed in at (0, 0) — the Gulf of Guinea — and then handed to dispatch
      // as a captain 4000 km from every real pickup.
      if (row.lat === null || row.lng === null) continue;
      const lat = Number(row.lat);
      const lng = Number(row.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      pipeline.geoadd(GEO_KEY, lng, lat, row.captain_id);
      // A row with no location_updated_at (legacy) is seeded as "just seen"
      // rather than dropped: the alternative is to warm a captain into the geo
      // key that the freshness filter immediately discards, which is strictly
      // worse than trusting a position Postgres already considers current.
      const seenMs = row.seen_ms === null ? Date.now() : Number(row.seen_ms);
      pipeline.zadd(SEEN_KEY, seenMs, row.captain_id);
    }
    await pipeline.exec();

    logger.info({ captains: rows.length }, 'live-location: warmed redis geo index from captain_state');
    return rows.length;
  } catch (err) {
    logger.error({ err }, 'live-location: warm-up failed — geo index may be incomplete until captains report again');
    return 0;
  }
}
