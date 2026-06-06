import { pool, withTx } from '../../db/pool.js';
import { HttpError } from '../../middleware/error.js';
import { env } from '../../config/env.js';
import { estimateFareKhoums } from '../rides/pricing.js';
import { distanceMeters } from '../rides/dispatch.service.js';
import type { RecurringStatus } from '@tewiz/shared-types';

interface RecurringRow {
  id: string;
  rider_id: string;
  captain_id: string | null;
  pickup_lat: number;
  pickup_lng: number;
  pickup_label: string | null;
  dropoff_lat: number;
  dropoff_lng: number;
  dropoff_label: string | null;
  days_of_week: number;
  time_of_day: string;
  timezone: string;
  locked_fare_khoums: string;
  status: RecurringStatus;
  valid_from: string;
  valid_until: string | null;
  created_at: Date;
  updated_at: Date;
}

const RR_COLS = `
  id, rider_id, captain_id,
  ST_Y(pickup_location::geometry)  AS pickup_lat,
  ST_X(pickup_location::geometry)  AS pickup_lng,
  pickup_label,
  ST_Y(dropoff_location::geometry) AS dropoff_lat,
  ST_X(dropoff_location::geometry) AS dropoff_lng,
  dropoff_label,
  days_of_week, time_of_day, timezone,
  locked_fare_khoums, status,
  valid_from, valid_until, created_at, updated_at
`;

function shape(r: RecurringRow) {
  return {
    id: r.id,
    riderId: r.rider_id,
    captainId: r.captain_id,
    pickup: { lat: r.pickup_lat, lng: r.pickup_lng, label: r.pickup_label },
    dropoff: { lat: r.dropoff_lat, lng: r.dropoff_lng, label: r.dropoff_label },
    daysOfWeek: r.days_of_week,
    timeOfDay: r.time_of_day,
    timezone: r.timezone,
    lockedFareKhoums: Number(r.locked_fare_khoums),
    status: r.status,
    validFrom: r.valid_from,
    validUntil: r.valid_until,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

interface ProposeInput {
  riderId: string;
  pickup: { lat: number; lng: number; label?: string };
  dropoff: { lat: number; lng: number; label?: string };
  daysOfWeek: number;
  timeOfDay: string;        // "HH:MM"
  validFrom: string;        // YYYY-MM-DD
  validUntil?: string;
}

export async function proposeRecurring(input: ProposeInput) {
  const dStraight = await distanceMeters(
    input.pickup.lat, input.pickup.lng,
    input.dropoff.lat, input.dropoff.lng,
  );
  // Locked fare with 5% rider discount (incentive for committing).
  const { fareKhoums } = estimateFareKhoums(dStraight);
  const lockedFare = Math.round(fareKhoums * 0.95);

  const r = await pool.query<RecurringRow>(
    `INSERT INTO recurring_rides
       (rider_id, pickup_location, pickup_label,
        dropoff_location, dropoff_label,
        days_of_week, time_of_day, locked_fare_khoums,
        status, valid_from, valid_until)
     VALUES (
       $1,
       ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, $4,
       ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography, $7,
       $8, $9, $10, 'proposed', $11, $12
     )
     RETURNING ${RR_COLS}`,
    [
      input.riderId,
      input.pickup.lng, input.pickup.lat, input.pickup.label ?? null,
      input.dropoff.lng, input.dropoff.lat, input.dropoff.label ?? null,
      input.daysOfWeek, input.timeOfDay, lockedFare,
      input.validFrom, input.validUntil ?? null,
    ],
  );
  return shape(r.rows[0]!);
}

export async function listMyRecurring(riderId: string) {
  const r = await pool.query<RecurringRow>(
    `SELECT ${RR_COLS} FROM recurring_rides WHERE rider_id = $1
      ORDER BY created_at DESC`,
    [riderId],
  );
  return r.rows.map(shape);
}

/**
 * Captain-side: see proposed schedules and the ones they're locked into.
 */
export async function listForCaptain(captainId: string) {
  const r = await pool.query<RecurringRow>(
    `SELECT ${RR_COLS} FROM recurring_rides
      WHERE status = 'proposed'
         OR (status = 'active' AND captain_id = $1)
      ORDER BY status DESC, created_at DESC`,
    [captainId],
  );
  return r.rows.map(shape);
}

export async function acceptByCaptain(recurringId: string, captainId: string) {
  return withTx(async (client) => {
    const r = await client.query<RecurringRow>(
      `SELECT ${RR_COLS} FROM recurring_rides WHERE id = $1 FOR UPDATE`,
      [recurringId],
    );
    const rr = r.rows[0];
    if (!rr) throw new HttpError(404, 'not_found', 'Schedule not found');
    if (rr.status !== 'proposed') {
      throw new HttpError(409, 'wrong_status', `Schedule is ${rr.status}`);
    }
    const upd = await client.query<RecurringRow>(
      `UPDATE recurring_rides
          SET status = 'active', captain_id = $1
        WHERE id = $2 RETURNING ${RR_COLS}`,
      [captainId, recurringId],
    );
    return shape(upd.rows[0]!);
  });
}

export async function cancelByRider(recurringId: string, riderId: string) {
  const r = await pool.query<RecurringRow>(
    `UPDATE recurring_rides
        SET status = 'cancelled'
      WHERE id = $1 AND rider_id = $2 AND status IN ('proposed','active','paused')
   RETURNING ${RR_COLS}`,
    [recurringId, riderId],
  );
  if (!r.rows[0]) throw new HttpError(409, 'wrong_status', 'Cannot cancel');
  return shape(r.rows[0]);
}

/**
 * Admin/cron: for each active recurring ride, ensure occurrences are scheduled
 * for the next 7 days, and that occurrences within the next 30 minutes are
 * dispatched as real rides.
 *
 * Idempotent: safe to run frequently (every 5 minutes).
 */
export async function processOccurrences() {
  // 1. Schedule missing occurrences for the next 7 days.
  // SQL trick: generate dates, intersect with days_of_week bitmap.
  await pool.query(`
    INSERT INTO recurring_ride_occurrences (recurring_ride_id, scheduled_at)
    SELECT rr.id, sched.at
      FROM recurring_rides rr
      CROSS JOIN LATERAL (
        SELECT (d::date + rr.time_of_day) AT TIME ZONE rr.timezone AS at,
               EXTRACT(ISODOW FROM d)::int AS isodow
          FROM generate_series(
                 GREATEST(rr.valid_from, current_date),
                 LEAST(COALESCE(rr.valid_until, current_date + 7), current_date + 7),
                 '1 day'::interval
               ) d
      ) sched
     WHERE rr.status = 'active'
       AND (rr.days_of_week & (1 << (sched.isodow - 1))) > 0
       AND sched.at > now()
       AND NOT EXISTS (
         SELECT 1 FROM recurring_ride_occurrences o
          WHERE o.recurring_ride_id = rr.id AND o.scheduled_at = sched.at
       )
  `);

  // 2. Dispatch occurrences whose scheduled_at is within the next 30 minutes
  //    and not yet dispatched.
  const due = await pool.query<{
    id: string; recurring_ride_id: string; scheduled_at: Date;
    rider_id: string; captain_id: string;
    pickup_lng: number; pickup_lat: number; pickup_label: string | null;
    dropoff_lng: number; dropoff_lat: number; dropoff_label: string | null;
    locked_fare_khoums: string;
  }>(`
    SELECT o.id, o.recurring_ride_id, o.scheduled_at,
           rr.rider_id, rr.captain_id,
           ST_X(rr.pickup_location::geometry)  AS pickup_lng,
           ST_Y(rr.pickup_location::geometry)  AS pickup_lat,
           rr.pickup_label,
           ST_X(rr.dropoff_location::geometry) AS dropoff_lng,
           ST_Y(rr.dropoff_location::geometry) AS dropoff_lat,
           rr.dropoff_label,
           rr.locked_fare_khoums
      FROM recurring_ride_occurrences o
      JOIN recurring_rides rr ON rr.id = o.recurring_ride_id
     WHERE o.status = 'scheduled'
       AND o.scheduled_at < now() + interval '30 minutes'
       AND o.scheduled_at > now() - interval '5 minutes'
       AND rr.status = 'active'
       AND rr.captain_id IS NOT NULL
  `);

  let dispatched = 0;
  for (const occ of due.rows) {
    try {
      await withTx(async (client) => {
        // Re-check status (race)
        const recheck = await client.query<{ status: string }>(
          `SELECT status FROM recurring_ride_occurrences WHERE id = $1 FOR UPDATE`,
          [occ.id],
        );
        if (recheck.rows[0]?.status !== 'scheduled') return;

        // Create the ride directly assigned to the locked captain.
        const code = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
        const ride = await client.query<{ id: string }>(
          `INSERT INTO rides (
             booker_id, passenger_user_id, ride_type, status,
             pickup_location, pickup_label,
             dropoff_location, dropoff_label,
             fare_estimate_khoums, commission_rate_bps,
             distance_m, payment_method, verification_code,
             captain_id, accepted_at, recurring_ride_id
           )
           VALUES (
             $1, $1, 'passenger', 'accepted',
             ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, $4,
             ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography, $7,
             $8, $9, 0, 'cash', $10,
             $11, now(), $12
           )
           RETURNING id`,
          [
            occ.rider_id,
            occ.pickup_lng, occ.pickup_lat, occ.pickup_label,
            occ.dropoff_lng, occ.dropoff_lat, occ.dropoff_label,
            Number(occ.locked_fare_khoums), env.DEFAULT_COMMISSION_BPS,
            code, occ.captain_id, occ.recurring_ride_id,
          ],
        );

        await client.query(
          `UPDATE recurring_ride_occurrences
              SET status = 'dispatched', ride_id = $1
            WHERE id = $2`,
          [ride.rows[0]!.id, occ.id],
        );
        dispatched++;
      });
    } catch (e) {
      console.error('[recurring] dispatch failed for occurrence', occ.id, e);
    }
  }

  return { dispatched, scheduledForReview: due.rowCount ?? 0 };
}
