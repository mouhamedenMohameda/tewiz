/**
 * Server-trusted GPS meter for open rides ("course ouverte").
 *
 * The captain app pushes a GPS sample every ~5 s while the ride is
 * in_progress. We accept the sample only if it looks plausible (no teleport,
 * accuracy within bounds) and append it to `ride_locations`. Distance is the
 * sum of haversine segments between accepted samples; duration is the wall
 * clock between started_at and the latest sample (or now). The live fare is
 * derived from the tariff snapshot stored on the ride row.
 *
 * Keeping distance computation on the server (vs trusting the captain app)
 * is what makes the meter "fiable" — a tampered client can't inflate the
 * fare, because PostGIS recomputes it on every read.
 */

import type pg from 'pg';
import { pool } from '../../db/pool.js';
import { HttpError } from '../../middleware/error.js';
import { openFareMru, type OpenTariff } from './pricing.js';
import { getPricingSettings } from '../admin/app-settings.service.js';

// Hard caps on a single sample-to-sample segment:
// - 60 m/s ≈ 216 km/h. Anything faster is a GPS spike (urban road taxi).
// - 5 km in one segment is treated as a teleport regardless of speed.
const MAX_SPEED_MPS = 60;
const MAX_JUMP_M = 5_000;
// Reject samples with a worse-than-this accuracy radius. Mostly drops the
// "first fix" indoor sample that has accuracy=500 m.
const MAX_ACCURACY_M = 100;
// Drop micro-segments shorter than this (sub-meter GPS noise when stopped).
const MIN_SEGMENT_M = 3;

export interface LocationSample {
  lat: number;
  lng: number;
  accuracyM?: number | null;
  speedMps?: number | null;
  /** Sample timestamp from the device (ms epoch). Defaults to server now. */
  recordedAt?: Date;
}

export interface IngestResult {
  /** true if the sample was stored, false if it was dropped (teleport/noise). */
  accepted: boolean;
  /** Reason for rejection, when accepted=false. */
  reason?: 'too_inaccurate' | 'teleport' | 'too_close' | 'before_start';
  /** Current cumulative distance and duration after this sample. */
  distanceM: number;
  durationS: number;
}

/**
 * Append one GPS sample. Returns the current meter state regardless of
 * whether the sample was accepted — the captain app keeps polling, so
 * dropped samples shouldn't surface as errors.
 */
export async function ingestLocation(
  client: pg.PoolClient,
  rideId: string,
  sample: LocationSample,
): Promise<IngestResult> {
  // Read the ride + the last accepted sample in one round-trip.
  const head = await client.query<{
    started_at: Date | null;
    last_lat: number | null;
    last_lng: number | null;
    last_recorded: Date | null;
  }>(
    `SELECT r.started_at,
            ST_Y(l.point::geometry) AS last_lat,
            ST_X(l.point::geometry) AS last_lng,
            l.recorded_at            AS last_recorded
       FROM rides r
       LEFT JOIN LATERAL (
         SELECT point, recorded_at
           FROM ride_locations
          WHERE ride_id = r.id
          ORDER BY recorded_at DESC
          LIMIT 1
       ) l ON true
      WHERE r.id = $1`,
    [rideId],
  );
  const h = head.rows[0];
  if (!h) throw new HttpError(404, 'not_found', 'Ride not found');
  if (!h.started_at) {
    return { accepted: false, reason: 'before_start', distanceM: 0, durationS: 0 };
  }

  const recordedAt = sample.recordedAt ?? new Date();

  // Accuracy gate (when reported). Captain devices that don't report accuracy
  // get a free pass — we still rely on the speed gate to reject teleports.
  if (sample.accuracyM != null && sample.accuracyM > MAX_ACCURACY_M) {
    const meter = await readMeter(client, rideId, h.started_at);
    return { accepted: false, reason: 'too_inaccurate', ...meter };
  }

  // Teleport / micro-segment gate vs previous accepted sample.
  if (h.last_lat != null && h.last_lng != null && h.last_recorded) {
    const dM = haversineM(h.last_lat, h.last_lng, sample.lat, sample.lng);
    const dt = Math.max(0.001, (recordedAt.getTime() - h.last_recorded.getTime()) / 1000);
    if (dM > MAX_JUMP_M || dM / dt > MAX_SPEED_MPS) {
      const meter = await readMeter(client, rideId, h.started_at);
      return { accepted: false, reason: 'teleport', ...meter };
    }
    if (dM < MIN_SEGMENT_M) {
      // Vehicle is stopped — record the "I'm still here" by bumping duration
      // via the meter read, but don't store the sample (saves DB volume).
      const meter = await readMeter(client, rideId, h.started_at);
      return { accepted: false, reason: 'too_close', ...meter };
    }
  }

  await client.query(
    `INSERT INTO ride_locations (ride_id, point, accuracy_m, speed_mps, recorded_at)
     VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, $4, $5, $6)`,
    [
      rideId,
      sample.lng,
      sample.lat,
      sample.accuracyM ?? null,
      sample.speedMps ?? null,
      recordedAt,
    ],
  );

  const meter = await readMeter(client, rideId, h.started_at);
  return { accepted: true, ...meter };
}

/** Sum of segment lengths along the accepted GPS trail (server-trusted). */
export async function computeDistanceM(
  client: pg.PoolClient | typeof pool,
  rideId: string,
): Promise<number> {
  const r = await client.query<{ distance_m: string | null }>(
    `WITH ordered AS (
       SELECT point::geometry AS g,
              ROW_NUMBER() OVER (ORDER BY recorded_at) AS rn
         FROM ride_locations
        WHERE ride_id = $1
     )
     SELECT COALESCE(
              SUM(ST_Distance(a.g::geography, b.g::geography)),
              0
            )::text AS distance_m
       FROM ordered a
       JOIN ordered b ON b.rn = a.rn + 1`,
    [rideId],
  );
  return Math.round(Number(r.rows[0]?.distance_m ?? 0));
}

/** Wall-clock duration since started_at, capped by the latest sample. */
async function computeDurationS(
  client: pg.PoolClient,
  rideId: string,
  startedAt: Date,
): Promise<number> {
  const r = await client.query<{ last_recorded: Date | null }>(
    `SELECT MAX(recorded_at) AS last_recorded
       FROM ride_locations WHERE ride_id = $1`,
    [rideId],
  );
  const end = r.rows[0]?.last_recorded ?? new Date();
  return Math.max(0, Math.round((end.getTime() - startedAt.getTime()) / 1000));
}

async function readMeter(
  client: pg.PoolClient,
  rideId: string,
  startedAt: Date,
): Promise<{ distanceM: number; durationS: number }> {
  const [distanceM, durationS] = await Promise.all([
    computeDistanceM(client, rideId),
    computeDurationS(client, rideId, startedAt),
  ]);
  return { distanceM, durationS };
}

/**
 * Public-read variant for the rider/captain "current ride" endpoint —
 * computes distance + duration + fare from the latest stored trail without
 * needing a writeable transaction.
 */
export async function readLiveMeter(input: {
  rideId: string;
  startedAt: Date;
  tariff: OpenTariff;
  endAt?: Date;
}): Promise<{ distanceM: number; durationS: number; fareMru: number }> {
  const distanceM = await computeDistanceM(pool, input.rideId);
  const settings = await getPricingSettings();
  // For the live meter we use wall-clock time while the ride is running.
  // GPS uploads can be delayed/intermittent; tying duration to last_recorded
  // freezes the price for the rider even though time is passing.
  const end = input.endAt ?? new Date();
  const durationS = Math.max(0, Math.round((end.getTime() - input.startedAt.getTime()) / 1000));
  const fareMru = openFareMru(input.tariff, distanceM, durationS, {
    enabled: settings.nightPricingEnabled,
    multiplier: settings.nightPriceMultiplier,
    startHour: settings.nightPriceStartHour,
    endHour: settings.nightPriceEndHour,
  }, end);
  return { distanceM, durationS, fareMru };
}

/** Last accepted GPS point on the trail, used to fill dropoff at completion. */
export async function lastTrailPoint(
  client: pg.PoolClient,
  rideId: string,
): Promise<{ lat: number; lng: number } | null> {
  const r = await client.query<{ lat: number; lng: number }>(
    `SELECT ST_Y(point::geometry) AS lat, ST_X(point::geometry) AS lng
       FROM ride_locations
      WHERE ride_id = $1
      ORDER BY recorded_at DESC LIMIT 1`,
    [rideId],
  );
  return r.rows[0] ?? null;
}

/** Haversine distance in meters. Faster than a round-trip to PostGIS for the gate. */
function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}
