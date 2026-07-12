/**
 * Off-ride captain breadcrumb trail — ingestion, retention and read.
 *
 * Fed by the mobile background TaskManager while a captain is online but not on
 * a ride (see `captain_track` in migration 0066). The philosophy mirrors
 * `meter.service`: the server is authoritative and drops noisy samples BEFORE
 * they hit the table, so a stopped car costs zero storage and the drawn
 * polyline stays clean.
 */

import type pg from 'pg';
import { pool } from '../../db/pool.js';
import { haversineM } from '../../lib/geo.js';

// Same gates as the ride meter, tuned for the coarser off-ride cadence
// (~50 m / 30 s). See meter.service for the rationale.
const MAX_SPEED_MPS = 60;        // ≈ 216 km/h — anything faster is a GPS spike
const MAX_JUMP_M = 5_000;        // one-segment teleport regardless of speed
const MAX_ACCURACY_M = 100;      // reject the indoor "first fix" (accuracy≈500)
const MIN_SEGMENT_M = 25;        // below this the captain hasn't really moved

/** How long the off-ride trail is kept before its partition is dropped. */
export const TRACK_RETENTION_DAYS = 14;

export interface TrackSample {
  lat: number;
  lng: number;
  accuracyM?: number | null;
  speedMps?: number | null;
  /** Device timestamp (ms epoch). */
  recordedAt: number;
}

/** True when off-ride tracking is switched on in app_settings. */
export async function isTrackingEnabled(): Promise<boolean> {
  const r = await pool.query<{ on: boolean }>(
    `SELECT track_offline_enabled AS on FROM app_settings LIMIT 1`,
  );
  return r.rows[0]?.on ?? false;
}

/**
 * Store a batch of off-ride samples for one captain, dropping noise.
 *
 * Filtering is done in JS against the previous ACCEPTED point (starting from
 * the captain's last stored trail point) so a batch that arrives after a gap
 * is de-noised consistently with the live stream. Returns how many points were
 * actually stored.
 */
export async function ingestTrackBatch(
  captainId: string,
  samples: TrackSample[],
): Promise<{ accepted: number; dropped: number }> {
  if (samples.length === 0) return { accepted: 0, dropped: 0 };

  // Chronological order — the device may batch out of order after a retry.
  const ordered = [...samples].sort((a, b) => a.recordedAt - b.recordedAt);

  // Seed the "previous accepted" reference from the last stored point so the
  // first sample of a new batch isn't blindly accepted next to the old one.
  const prevRow = await pool.query<{ lat: number; lng: number; t: string }>(
    `SELECT ST_Y(point::geometry) AS lat,
            ST_X(point::geometry) AS lng,
            extract(epoch from recorded_at) * 1000 AS t
       FROM captain_track
      WHERE captain_id = $1
      ORDER BY recorded_at DESC
      LIMIT 1`,
    [captainId],
  );
  let prev = prevRow.rows[0]
    ? { lat: prevRow.rows[0].lat, lng: prevRow.rows[0].lng, t: Number(prevRow.rows[0].t) }
    : null;

  const kept: TrackSample[] = [];
  for (const s of ordered) {
    if (s.accuracyM != null && s.accuracyM > MAX_ACCURACY_M) continue;
    if (prev) {
      const dM = haversineM(prev.lat, prev.lng, s.lat, s.lng);
      const dt = Math.max(0.001, (s.recordedAt - prev.t) / 1000);
      if (dM > MAX_JUMP_M || dM / dt > MAX_SPEED_MPS) continue; // teleport
      if (dM < MIN_SEGMENT_M) continue;                          // not moving
    }
    kept.push(s);
    prev = { lat: s.lat, lng: s.lng, t: s.recordedAt };
  }

  if (kept.length > 0) {
    // Single multi-row INSERT. Postgres routes each row to the right daily
    // partition; the pre-created partitions cover the plausible timestamp
    // range, and the reap job keeps tomorrow's partition ready.
    const values: string[] = [];
    const params: unknown[] = [captainId];
    let p = 2;
    for (const s of kept) {
      values.push(
        `($1, ST_SetSRID(ST_MakePoint($${p}, $${p + 1}), 4326)::geography, $${p + 2}, $${p + 3}, to_timestamp($${p + 4} / 1000.0))`,
      );
      params.push(s.lng, s.lat, s.accuracyM ?? null, s.speedMps ?? null, s.recordedAt);
      p += 5;
    }
    await pool.query(
      `INSERT INTO captain_track (captain_id, point, accuracy_m, speed_mps, recorded_at)
       VALUES ${values.join(', ')}`,
      params,
    );
  }

  return { accepted: kept.length, dropped: ordered.length - kept.length };
}

export interface TrackPoint {
  lat: number;
  lng: number;
  accuracyM: number | null;
  speedMps: number | null;
  recordedAt: string;
}

/** Ordered breadcrumb trail of one captain within [from, to]. */
export async function readTrack(
  captainId: string,
  from: Date,
  to: Date,
): Promise<TrackPoint[]> {
  const r = await pool.query<{
    lat: number;
    lng: number;
    accuracy_m: number | null;
    speed_mps: number | null;
    recorded_at: Date;
  }>(
    `SELECT ST_Y(point::geometry) AS lat,
            ST_X(point::geometry) AS lng,
            accuracy_m,
            speed_mps,
            recorded_at
       FROM captain_track
      WHERE captain_id = $1
        AND recorded_at >= $2
        AND recorded_at <= $3
      ORDER BY recorded_at`,
    [captainId, from, to],
  );
  return r.rows.map((x) => ({
    lat: x.lat,
    lng: x.lng,
    accuracyM: x.accuracy_m,
    speedMps: x.speed_mps,
    recordedAt: x.recorded_at.toISOString(),
  }));
}

/**
 * Retention + partition maintenance. Idempotent, safe to run frequently from
 * cron. Ensures the next day's partition exists (so ingestion never fails at
 * midnight) and DROPs any daily partition entirely older than the retention
 * window (O(1), no row-by-row DELETE, no bloat).
 */
export async function reapTrackPartitions(
  client: pg.PoolClient | typeof pool = pool,
): Promise<{ created: string[]; dropped: string[] }> {
  // Make sure today..+1 exist (covers a cron that only runs daily).
  await client.query(`SELECT ensure_captain_track_partition((now() AT TIME ZONE 'UTC')::date)`);
  await client.query(`SELECT ensure_captain_track_partition((now() AT TIME ZONE 'UTC')::date + 1)`);

  // Find child partitions whose day is older than the retention cutoff and
  // drop them. Partition names are captain_track_YYYYMMDD.
  const parts = await client.query<{ child: string }>(
    `SELECT c.relname AS child
       FROM pg_inherits i
       JOIN pg_class c    ON c.oid = i.inhrelid
       JOIN pg_class p    ON p.oid = i.inhparent
      WHERE p.relname = 'captain_track'`,
  );

  const cutoff = new Date();
  cutoff.setUTCHours(0, 0, 0, 0);
  cutoff.setUTCDate(cutoff.getUTCDate() - TRACK_RETENTION_DAYS);

  const dropped: string[] = [];
  for (const { child } of parts.rows) {
    const m = /^captain_track_(\d{4})(\d{2})(\d{2})$/.exec(child);
    if (!m) continue;
    const day = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    if (day < cutoff) {
      // Identifier is derived from pg_class + our own regex, not user input.
      await client.query(`DROP TABLE IF EXISTS ${child}`);
      dropped.push(child);
    }
  }

  return { created: [], dropped };
}

/**
 * In-process daily cron for track retention, mirroring the other
 * `start*Cron()` jobs wired in index.ts. Runs once a day at ~03:30 local time
 * (low-traffic window): ensures tomorrow's partition exists and drops
 * partitions past the retention window. Idempotent, so a missed/duplicate run
 * is harmless.
 */
export function startCaptainTrackReapCron(): void {
  const tick = async () => {
    try {
      const r = await reapTrackPartitions();
      // eslint-disable-next-line no-console
      console.log(`[captain-track] reap ok, dropped ${r.dropped.length} partition(s)`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[captain-track] reap failed', err);
    }
  };

  // Fire first at the next 03:30, then every 24 h.
  const now = new Date();
  const next = new Date(now);
  next.setHours(3, 30, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const msUntilNext = next.getTime() - now.getTime();

  setTimeout(() => {
    void tick();
    setInterval(() => void tick(), 24 * 60 * 60 * 1000).unref();
  }, msUntilNext).unref();
}
