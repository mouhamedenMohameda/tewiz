import crypto from 'node:crypto';
import type pg from 'pg';
import { pool, withTx } from '../../db/pool.js';
import { HttpError } from '../../middleware/error.js';
import { env } from '../../config/env.js';
import { estimateFareMru, commissionMru } from './pricing.js';
import { getPricingSettings } from '../admin/app-settings.service.js';
import { distanceMeters, eligibleCaptainsForRide } from './dispatch.service.js';
import { debitWallet } from '../wallet/wallet.service.js';
import { sms } from '../auth/sms.js';
import { notifyCaptainsNewRide } from '../push/expo-push.js';
import type { RideStatus, RideType, PaymentMethod } from '@tewiz/shared-types';

// Normalize MR phones (same logic as auth/phone.ts but inline for the service).
function normalizeMrPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 8 && /^[234]/.test(digits)) return `+222${digits}`;
  if (digits.length === 11 && digits.startsWith('222')) return `+${digits}`;
  return raw.startsWith('+') ? raw : `+${digits}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Public types

export interface CreateRideInput {
  bookerId: string;
  pickup: { lat: number; lng: number; label?: string };
  dropoff: { lat: number; lng: number; label?: string };
  rideType?: RideType;
  paymentMethod?: PaymentMethod;
  // For "course pour quelqu'un d'autre"
  passengerName?: string;
  passengerPhone?: string;
  // For colis (when rideType='colis')
  recipientName?: string;
  recipientPhone?: string;
  packageDescription?: string;
  // Kept for backwards compatibility with callers. The booker active-ride
  // limit was removed (a passenger may book multiple rides at once).
  skipBookerActiveCheck?: boolean;
  // Admin-only: skip the SMS "course pour quelqu'un d'autre" confirmation step.
  // When a passenger calls the operator, they have already consented — the ride
  // can go straight to "searching" without a return SMS.
  skipPassengerConfirm?: boolean;
}

interface RideRow {
  id: string;
  booker_id: string;
  passenger_user_id: string | null;
  passenger_name: string | null;
  passenger_phone: string | null;
  is_for_other: boolean;
  passenger_confirmed_at: Date | null;
  captain_id: string | null;
  ride_type: RideType;
  status: RideStatus;
  pickup_lat: number;
  pickup_lng: number;
  pickup_label: string | null;
  dropoff_lat: number;
  dropoff_lng: number;
  dropoff_label: string | null;
  fare_estimate_mru: string | null;
  fare_final_mru: string | null;
  commission_rate_bps: number;
  commission_mru: string | null;
  payment_method: PaymentMethod;
  distance_m: number | null;
  duration_s: number | null;
  verification_code: string | null;
  requested_at: Date;
  accepted_at: Date | null;
  arrived_at: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
  cancel_reason: string | null;
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers

const RIDE_COLUMNS = `
  id, booker_id, passenger_user_id, passenger_name, passenger_phone,
  is_for_other, passenger_confirmed_at, captain_id, ride_type, status,
  ST_Y(pickup_location::geometry)  AS pickup_lat,
  ST_X(pickup_location::geometry)  AS pickup_lng,
  pickup_label,
  ST_Y(dropoff_location::geometry) AS dropoff_lat,
  ST_X(dropoff_location::geometry) AS dropoff_lng,
  dropoff_label,
  fare_estimate_mru, fare_final_mru,
  commission_rate_bps, commission_mru,
  payment_method, distance_m, duration_s, verification_code,
  requested_at, accepted_at, arrived_at, started_at, completed_at,
  cancelled_at, cancel_reason
`;

function generateVerificationCode(): string {
  // 4-digit (with leading zero)
  return crypto.randomInt(0, 10_000).toString().padStart(4, '0');
}

function shape(r: RideRow, opts: { revealCode: boolean } = { revealCode: false }) {
  return {
    id: r.id,
    bookerId: r.booker_id,
    passengerUserId: r.passenger_user_id,
    passengerName: r.passenger_name,
    passengerPhone: r.passenger_phone,
    isForOther: r.is_for_other,
    passengerConfirmedAt: r.passenger_confirmed_at,
    captainId: r.captain_id,
    rideType: r.ride_type,
    status: r.status,
    pickup: { lat: r.pickup_lat, lng: r.pickup_lng, label: r.pickup_label },
    dropoff: { lat: r.dropoff_lat, lng: r.dropoff_lng, label: r.dropoff_label },
    fareEstimateMru: r.fare_estimate_mru === null ? null : Number(r.fare_estimate_mru),
    fareFinalMru: r.fare_final_mru === null ? null : Number(r.fare_final_mru),
    commissionRateBps: r.commission_rate_bps,
    commissionMru: r.commission_mru === null ? null : Number(r.commission_mru),
    paymentMethod: r.payment_method,
    distanceM: r.distance_m,
    durationS: r.duration_s,
    verificationCode: opts.revealCode ? r.verification_code : undefined,
    requestedAt: r.requested_at,
    acceptedAt: r.accepted_at,
    arrivedAt: r.arrived_at,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    cancelledAt: r.cancelled_at,
    cancelReason: r.cancel_reason,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Create

export async function createRide(input: CreateRideInput) {
  // A passenger (including a captain who books as a rider) may have multiple
  // active rides at once — no booker-side limit.

  // 2. Pricing
  const dStraight = await distanceMeters(
    input.pickup.lat, input.pickup.lng,
    input.dropoff.lat, input.dropoff.lng,
  );
  if (dStraight < 50) {
    throw new HttpError(400, 'distance_too_short',
      'Pickup and dropoff are too close (<50 m)');
  }
  const rideType = input.rideType ?? 'passenger';
  const { fareMru, distanceEstimateM } = await estimateFareMru(dStraight, rideType);

  const settings = await getPricingSettings();
  const commissionBps = rideType === 'colis'
    ? settings.colisCommissionBps
    : settings.defaultCommissionBps;

  // Validate colis-specific inputs
  if (rideType === 'colis') {
    if (!input.recipientName || !input.recipientPhone) {
      throw new HttpError(400, 'colis_missing_recipient',
        'Colis rides require recipientName and recipientPhone');
    }
  }

  // "Course pour quelqu'un d'autre": passenger is someone other than the booker.
  // Status starts at pending_passenger_confirm; we send an SMS to the passenger
  // and only after they reply YES (POST /public/rides/:id/confirm) do we move to searching.
  const isForOther = !!(input.passengerName && input.passengerPhone);
  if (isForOther && rideType === 'colis') {
    throw new HttpError(400, 'colis_for_other',
      'Colis rides cannot be booked "for someone else" (the recipient field already serves that purpose)');
  }
  const normalizedPassengerPhone = input.passengerPhone
    ? normalizeMrPhone(input.passengerPhone)
    : null;

  const verificationCode = generateVerificationCode();
  // "course pour quelqu'un d'autre" normally waits for SMS confirmation.
  // Two reasons to bypass that loop:
  //   1. the caller asked for it (admin operator booking a phone-in passenger
  //      who already consented),
  //   2. the SMS provider isn't actually wired up (env.SMS_PROVIDER === 'mock'),
  //      in which case the passenger would never receive the SMS and the ride
  //      would stay invisible to captains forever.
  // The check switches itself off automatically the day we plug Twilio /
  // Chinguitel and flip SMS_PROVIDER.
  const smsConfirmAvailable = env.SMS_PROVIDER !== 'mock';
  const needsPassengerConfirm =
    isForOther && !input.skipPassengerConfirm && smsConfirmAvailable;
  const initialStatus: RideStatus = needsPassengerConfirm ? 'pending_passenger_confirm' : 'searching';

  return withTx(async (client) => {
    // For "for other" rides, passenger_user_id stays NULL (passenger has no account).
    const passengerUserId = isForOther ? null : input.bookerId;
    const r = await client.query<RideRow>(
      `INSERT INTO rides (
         booker_id, passenger_user_id, passenger_name, passenger_phone,
         is_for_other, ride_type, status,
         pickup_location, pickup_label,
         dropoff_location, dropoff_label,
         fare_estimate_mru, commission_rate_bps,
         distance_m, payment_method, verification_code
       )
       VALUES (
         $1::uuid, $14::uuid, $15, $16, $13, $2, $17,
         ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography, $5,
         ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography, $8,
         $9, $10, $11, $12, $18
       )
       RETURNING ${RIDE_COLUMNS}`,
      [
        input.bookerId, rideType,
        input.pickup.lng, input.pickup.lat, input.pickup.label ?? null,
        input.dropoff.lng, input.dropoff.lat, input.dropoff.label ?? null,
        fareMru, commissionBps, distanceEstimateM,
        input.paymentMethod ?? 'cash',
        isForOther,
        passengerUserId,
        input.passengerName ?? null,
        normalizedPassengerPhone,
        initialStatus,
        verificationCode,
      ],
    );
    const ride = r.rows[0]!;

    // Colis details
    if (rideType === 'colis') {
      await client.query(
        `INSERT INTO colis_details (ride_id, recipient_name, recipient_phone, package_description)
         VALUES ($1, $2, $3, $4)`,
        [
          ride.id,
          input.recipientName!,
          normalizeMrPhone(input.recipientPhone!),
          input.packageDescription ?? null,
        ],
      );
    }

    // SMS notifications (mocked in dev) — only when we actually need the
    // passenger to confirm. Admin operator rides skip this entirely.
    if (needsPassengerConfirm && normalizedPassengerPhone) {
      // 4-digit confirmation code stored in otp_codes for the passenger
      const confirmCode = crypto.randomInt(0, 10_000).toString().padStart(4, '0');
      const bcrypt = await import('bcryptjs');
      const hash = await bcrypt.default.hash(confirmCode, 8);
      await client.query(
        `INSERT INTO otp_codes (phone, code_hash, purpose, expires_at)
         VALUES ($1, $2, 'passenger_confirm:' || $3, now() + interval '15 minutes')`,
        [normalizedPassengerPhone, hash, ride.id],
      );
      await sms.send(
        normalizedPassengerPhone,
        `Tewiz: ${input.passengerName ?? 'quelqu\'un'} a commandé un taxi pour vous. Code: ${confirmCode}. Répondez ou ouvrez l'app pour confirmer.`,
      );
    }

    const shaped = shape(ride, { revealCode: true });
    // Fire-and-forget push to nearby captains. We only do it when the ride
    // is immediately 'searching' — for SMS-confirmed rides we push from
    // confirmPassengerRide once the passenger has agreed.
    if (ride.status === 'searching') {
      void (async () => {
        try {
          const captainIds = await eligibleCaptainsForRide(ride.id);
          await notifyCaptainsNewRide(captainIds, {
            id: ride.id,
            rideType: ride.ride_type,
            fareEstimateMru: ride.fare_estimate_mru,
          });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('[rides] notifyCaptainsNewRide failed', err);
        }
      })();
    }
    return shaped;
  });
}

/**
 * Confirm a "course pour quelqu'un d'autre" using the 4-digit SMS code.
 * Public endpoint — the passenger has no app.
 */
export async function confirmPassengerRide(input: {
  rideId: string;
  code: string;
}) {
  return withTx(async (client) => {
    const r = await client.query<RideRow>(
      `SELECT ${RIDE_COLUMNS} FROM rides WHERE id = $1 FOR UPDATE`,
      [input.rideId],
    );
    const ride = r.rows[0];
    if (!ride) throw new HttpError(404, 'not_found', 'Ride not found');
    if (ride.status !== 'pending_passenger_confirm') {
      throw new HttpError(409, 'wrong_status', `Ride is ${ride.status}`);
    }
    if (!ride.passenger_phone) {
      throw new HttpError(400, 'no_passenger_phone', 'Ride has no passenger phone');
    }

    // Verify code
    const codeRow = await client.query<{ id: string; code_hash: string; expires_at: Date; attempts: number }>(
      `SELECT id, code_hash, expires_at, attempts FROM otp_codes
        WHERE phone = $1 AND purpose = 'passenger_confirm:' || $2
              AND consumed_at IS NULL
        ORDER BY created_at DESC LIMIT 1`,
      [ride.passenger_phone, ride.id],
    );
    const c = codeRow.rows[0];
    if (!c) throw new HttpError(400, 'no_code', 'No active confirmation code');
    if (c.expires_at.getTime() < Date.now()) {
      throw new HttpError(400, 'code_expired', 'Code expired');
    }
    const bcrypt = await import('bcryptjs');
    const ok = await bcrypt.default.compare(input.code, c.code_hash);
    if (!ok) {
      await client.query(`UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1`, [c.id]);
      throw new HttpError(400, 'invalid_code', 'Invalid code');
    }
    await client.query(`UPDATE otp_codes SET consumed_at = now() WHERE id = $1`, [c.id]);

    const upd = await client.query<RideRow>(
      `UPDATE rides
          SET status = 'searching', passenger_confirmed_at = now()
        WHERE id = $1
      RETURNING ${RIDE_COLUMNS}`,
      [ride.id],
    );
    const updated = upd.rows[0]!;
    void (async () => {
      try {
        const captainIds = await eligibleCaptainsForRide(updated.id);
        await notifyCaptainsNewRide(captainIds, {
          id: updated.id,
          rideType: updated.ride_type,
          fareEstimateMru: updated.fare_estimate_mru,
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[rides] notifyCaptainsNewRide failed', err);
      }
    })();
    return shape(updated, { revealCode: true });
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Reads

export async function getRideForUser(
  rideId: string,
  userId: string,
  role: 'rider' | 'captain' | 'admin',
) {
  const r = await pool.query<RideRow>(
    `SELECT ${RIDE_COLUMNS} FROM rides WHERE id = $1`,
    [rideId],
  );
  const ride = r.rows[0];
  if (!ride) throw new HttpError(404, 'not_found', 'Ride not found');

  // Authorization: booker or captain (once accepted) or admin.
  if (role !== 'admin'
      && ride.booker_id !== userId
      && ride.captain_id !== userId) {
    throw new HttpError(403, 'forbidden', 'Not your ride');
  }

  // Code reveal rules:
  //   - Booker (rider) always sees it (they need to read it to the captain)
  //   - Captain sees it only AFTER accept (so they can verify identity at pickup)
  //   - Admin always
  const revealCode =
    role === 'admin' ||
    ride.booker_id === userId ||
    (ride.captain_id === userId && ride.status !== 'searching');
  const shaped = shape(ride, { revealCode });

  // The assigned captain gets the rider's contact (name + phone) so they can
  // call at pickup. The rider gets the captain's details. Admin gets neither
  // here (the admin console joins separately).
  if (role === 'captain' && ride.captain_id === userId) {
    return enrichWithBooker(shaped);
  }
  if (role === 'rider' && ride.booker_id === userId) {
    return enrichWithCaptain(shaped);
  }
  return shaped;
}

export async function getCurrentRideForRider(userId: string) {
  // Active rides AND completed-but-not-yet-rated rides from the last 24 h.
  // Keeping a completed ride "current" lets the rider see the fare summary
  // and rate the captain right where they were tracking.
  const r = await pool.query<RideRow>(
    `SELECT ${RIDE_COLUMNS} FROM rides
      WHERE booker_id = $1
        AND (
          status IN ('searching','accepted','arrived','in_progress')
          OR (status = 'completed'
              AND completed_at > now() - interval '24 hours'
              AND NOT EXISTS (
                SELECT 1 FROM ratings r
                 WHERE r.ride_id = rides.id AND r.rater_id = $1
              ))
        )
      ORDER BY requested_at DESC LIMIT 1`,
    [userId],
  );
  if (!r.rows[0]) return null;
  const ride = shape(r.rows[0], { revealCode: true });
  return enrichWithCaptain(ride);
}

/**
 * Adds `captain` (and `vehicle`) onto a ride when one is assigned, so the
 * rider can see the driver's name + phone + plate at a glance and tap to
 * call. Private (used only by rider-facing endpoints).
 */
interface CaptainInfo {
  id: string;
  fullName: string | null;
  phone: string;
  ratingAvg: number;
  totalRides: number;
  vehicle: {
    plate: string;
    brand: string;
    model: string;
    color: string;
  } | null;
}

async function enrichWithCaptain<T extends { captainId: string | null }>(
  ride: T,
): Promise<T & { captain: CaptainInfo | null }> {
  if (!ride.captainId) return { ...ride, captain: null };
  const r = await pool.query<{
    id: string;
    full_name: string | null;
    phone: string;
    rating_avg: string;
    total_rides: number;
    plate: string | null;
    brand: string | null;
    model: string | null;
    color: string | null;
  }>(
    `SELECT u.id, u.full_name, u.phone,
            c.rating_avg, c.total_rides,
            v.plate, v.brand, v.model, v.color
       FROM users u
       JOIN captains c ON c.user_id = u.id
  LEFT JOIN vehicles v ON v.captain_id = c.user_id AND v.is_active = true
      WHERE u.id = $1`,
    [ride.captainId],
  );
  const row = r.rows[0];
  if (!row) return { ...ride, captain: null };
  return {
    ...ride,
    captain: {
      id: row.id,
      fullName: row.full_name,
      phone: row.phone,
      ratingAvg: Number(row.rating_avg),
      totalRides: row.total_rides,
      vehicle: row.plate
        ? { plate: row.plate, brand: row.brand!, model: row.model!, color: row.color! }
        : null,
    },
  };
}

/**
 * Adds `rider` (the person the captain must call at pickup) onto a ride. For a
 * normal ride that's the booker; for a "course pour quelqu'un d'autre" it's the
 * passenger. Private — used only by captain-facing endpoints AFTER the captain
 * is assigned, so riders stay anonymous to captains while the ride is still in
 * the open inbox.
 */
interface RiderInfo {
  id: string;
  fullName: string | null;
  phone: string | null;
}

async function enrichWithBooker<
  T extends {
    bookerId: string;
    isForOther: boolean;
    passengerName: string | null;
    passengerPhone: string | null;
  },
>(ride: T): Promise<T & { rider: RiderInfo }> {
  if (ride.isForOther && ride.passengerPhone) {
    return {
      ...ride,
      rider: { id: ride.bookerId, fullName: ride.passengerName, phone: ride.passengerPhone },
    };
  }
  const r = await pool.query<{ full_name: string | null; phone: string | null }>(
    `SELECT full_name, phone FROM users WHERE id = $1`,
    [ride.bookerId],
  );
  const row = r.rows[0];
  return {
    ...ride,
    rider: { id: ride.bookerId, fullName: row?.full_name ?? null, phone: row?.phone ?? null },
  };
}

export async function getCurrentRideForCaptain(captainId: string) {
  const r = await pool.query<RideRow>(
    `SELECT ${RIDE_COLUMNS} FROM rides
      WHERE captain_id = $1
        AND status IN ('accepted','arrived','in_progress')
      ORDER BY accepted_at DESC LIMIT 1`,
    [captainId],
  );
  return r.rows[0] ? enrichWithBooker(shape(r.rows[0], { revealCode: true })) : null;
}

/**
 * Admin-wide list with optional filters. `status='active'` is a shortcut for
 * any ride still in progress (searching/accepted/arrived/in_progress).
 * `status='done'` covers terminal states. Otherwise we accept any concrete
 * RideStatus value.
 */
export async function listAdminRides(input: {
  status?: 'active' | 'done' | RideStatus;
  limit?: number;
  before?: Date; // cursor: only rides requested before this timestamp
}) {
  const limit = Math.min(input.limit ?? 50, 200);
  const wheres: string[] = [];
  const params: unknown[] = [];

  if (input.status === 'active') {
    wheres.push(
      `status IN ('pending_passenger_confirm','searching','accepted','arrived','in_progress')`,
    );
  } else if (input.status === 'done') {
    wheres.push(
      `status IN ('completed','cancelled_by_rider','cancelled_by_captain','cancelled_by_system','no_show')`,
    );
  } else if (input.status) {
    params.push(input.status);
    wheres.push(`status = $${params.length}`);
  }
  if (input.before) {
    params.push(input.before);
    wheres.push(`requested_at < $${params.length}`);
  }

  params.push(limit);
  const sql = `
    SELECT ${RIDE_COLUMNS}
      FROM rides
      ${wheres.length ? `WHERE ${wheres.join(' AND ')}` : ''}
     ORDER BY requested_at DESC
     LIMIT $${params.length}
  `;
  const r = await pool.query<RideRow>(sql, params);
  return r.rows.map((row) => shape(row));
}

/**
 * Rider rates the captain of a completed ride. Upserts into ratings (one row
 * per rider+ride pair) and recomputes the captain's running average.
 * Returns the captain's fresh aggregate so the client can confirm and show
 * a "thanks" toast.
 */
export async function rateCaptain(input: {
  rideId: string; riderId: string; stars: number; comment?: string;
}) {
  return withTx(async (client) => {
    // Lock + validate the ride.
    const rideRes = await client.query<RideRow>(
      `SELECT ${RIDE_COLUMNS} FROM rides WHERE id = $1 FOR UPDATE`,
      [input.rideId],
    );
    const ride = rideRes.rows[0];
    if (!ride) throw new HttpError(404, 'not_found', 'Ride not found');
    if (ride.booker_id !== input.riderId) {
      throw new HttpError(403, 'forbidden', 'Not your ride');
    }
    if (ride.status !== 'completed') {
      throw new HttpError(409, 'wrong_status', 'Only completed rides can be rated');
    }
    if (!ride.captain_id) {
      throw new HttpError(409, 'no_captain', 'Ride has no captain');
    }

    // Upsert the rating.
    await client.query(
      `INSERT INTO ratings (ride_id, rater_id, ratee_id, stars, comment)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (ride_id, rater_id)
       DO UPDATE SET stars = EXCLUDED.stars, comment = EXCLUDED.comment`,
      [input.rideId, input.riderId, ride.captain_id, input.stars, input.comment ?? null],
    );

    // Recompute the captain's running average from all their ratings.
    const agg = await client.query<{ avg: string; cnt: number }>(
      `SELECT COALESCE(AVG(stars), 0)::numeric(3,2) AS avg,
              COUNT(*)::int AS cnt
         FROM ratings WHERE ratee_id = $1`,
      [ride.captain_id],
    );
    const row = agg.rows[0]!;
    await client.query(
      `UPDATE captains SET rating_avg = $1, rating_count = $2 WHERE user_id = $3`,
      [row.avg, row.cnt, ride.captain_id],
    );

    return {
      stars: input.stars,
      captainRatingAvg: Number(row.avg),
      captainRatingCount: row.cnt,
    };
  });
}

/**
 * Returns true if the given rider has already rated the given ride.
 */
export async function hasRated(rideId: string, riderId: string): Promise<boolean> {
  const r = await pool.query(
    `SELECT 1 FROM ratings WHERE ride_id = $1 AND rater_id = $2 LIMIT 1`,
    [rideId, riderId],
  );
  return r.rowCount! > 0;
}

export async function listRiderHistory(userId: string, limit = 30) {
  const r = await pool.query<RideRow>(
    `SELECT ${RIDE_COLUMNS} FROM rides
      WHERE booker_id = $1
      ORDER BY requested_at DESC LIMIT $2`,
    [userId, limit],
  );
  return r.rows.map((row) => shape(row));
}

export async function listCaptainHistory(captainId: string, limit = 30) {
  const r = await pool.query<RideRow>(
    `SELECT ${RIDE_COLUMNS} FROM rides
      WHERE captain_id = $1
      ORDER BY requested_at DESC LIMIT $2`,
    [captainId, limit],
  );
  return r.rows.map((row) => shape(row));
}

// ────────────────────────────────────────────────────────────────────────────
// State transitions — all use SELECT FOR UPDATE for atomicity.

async function lockRide(client: pg.PoolClient, rideId: string): Promise<RideRow> {
  const r = await client.query<RideRow>(
    `SELECT ${RIDE_COLUMNS} FROM rides WHERE id = $1 FOR UPDATE`,
    [rideId],
  );
  if (!r.rows[0]) throw new HttpError(404, 'not_found', 'Ride not found');
  return r.rows[0];
}

/**
 * Re-push the "new ride" notification to currently-eligible captains for a
 * ride still in 'searching'. No state change — just another broadcast for an
 * operator that calls back asking why no captain has accepted yet.
 */
export async function rebroadcastRide(rideId: string): Promise<{ captainsNotified: number }> {
  const r = await pool.query<{ status: RideStatus; ride_type: RideType; fare_estimate_mru: number | null }>(
    `SELECT status, ride_type, fare_estimate_mru FROM rides WHERE id = $1`,
    [rideId],
  );
  const ride = r.rows[0];
  if (!ride) throw new HttpError(404, 'not_found', 'Ride not found');
  if (ride.status !== 'searching') {
    throw new HttpError(409, 'not_searching',
      `Ride is ${ride.status}, only 'searching' rides can be rebroadcast`);
  }
  const captainIds = await eligibleCaptainsForRide(rideId);
  if (captainIds.length > 0) {
    await notifyCaptainsNewRide(captainIds, {
      id: rideId,
      rideType: ride.ride_type,
      fareEstimateMru: ride.fare_estimate_mru,
    });
  }
  return { captainsNotified: captainIds.length };
}

export async function acceptRide(rideId: string, captainId: string) {
  return withTx(async (client) => {
    const ride = await lockRide(client, rideId);

    if (ride.status !== 'searching') {
      throw new HttpError(409, 'not_searching',
        `Ride is ${ride.status}, cannot accept`);
    }

    // Captain must not have another active ride.
    const busy = await client.query(
      `SELECT 1 FROM rides
        WHERE captain_id = $1
          AND status IN ('accepted','arrived','in_progress')
        LIMIT 1`,
      [captainId],
    );
    if ((busy.rowCount ?? 0) > 0) {
      throw new HttpError(409, 'captain_busy',
        'You already have an active ride');
    }

    // Colis: captain must accept colis rides
    if (ride.ride_type === 'colis') {
      const cap = await client.query<{ accepts_colis: boolean }>(
        `SELECT accepts_colis FROM captains WHERE user_id = $1`,
        [captainId],
      );
      if (!cap.rows[0]?.accepts_colis) {
        throw new HttpError(403, 'colis_not_allowed',
          "Vous n'acceptez pas les courses colis");
      }
    }

    const upd = await client.query<RideRow>(
      `UPDATE rides
          SET captain_id = $1,
              status = 'accepted',
              accepted_at = now()
        WHERE id = $2
      RETURNING ${RIDE_COLUMNS}`,
      [captainId, rideId],
    );

    // Mark captain on_ride.
    await client.query(
      `UPDATE captain_state SET presence = 'on_ride', updated_at = now()
        WHERE captain_id = $1`,
      [captainId],
    );

    // Colis: generate the drop OTP and SMS it to the recipient.
    if (ride.ride_type === 'colis') {
      const dropOtp = crypto.randomInt(0, 10_000).toString().padStart(4, '0');
      const colis = await client.query<{ recipient_phone: string; recipient_name: string }>(
        `UPDATE colis_details SET drop_otp_code = $1 WHERE ride_id = $2
       RETURNING recipient_phone, recipient_name`,
        [dropOtp, ride.id],
      );
      if (colis.rows[0]) {
        await sms.send(
          colis.rows[0].recipient_phone,
          `Tewiz Colis: un livreur est en route. Code de livraison: ${dropOtp}. Donnez-le au chauffeur à l'arrivée.`,
        );
      }
    }

    return shape(upd.rows[0]!, { revealCode: true });
  });
}

export async function arriveRide(rideId: string, captainId: string) {
  return withTx(async (client) => {
    const ride = await lockRide(client, rideId);
    if (ride.captain_id !== captainId) {
      throw new HttpError(403, 'forbidden', 'Not your ride');
    }
    if (ride.status !== 'accepted') {
      throw new HttpError(409, 'wrong_status',
        `Ride is ${ride.status}, cannot mark arrived`);
    }
    const upd = await client.query<RideRow>(
      `UPDATE rides
          SET status = 'arrived', arrived_at = now()
        WHERE id = $1
      RETURNING ${RIDE_COLUMNS}`,
      [rideId],
    );
    return shape(upd.rows[0]!, { revealCode: true });
  });
}

export async function startRide(rideId: string, captainId: string, code: string) {
  return withTx(async (client) => {
    const ride = await lockRide(client, rideId);
    if (ride.captain_id !== captainId) {
      throw new HttpError(403, 'forbidden', 'Not your ride');
    }
    if (ride.status !== 'arrived') {
      throw new HttpError(409, 'wrong_status',
        `Captain must mark arrived first (current: ${ride.status})`);
    }
    if (!ride.verification_code || ride.verification_code !== code) {
      throw new HttpError(400, 'invalid_code',
        'Verification code does not match');
    }
    const upd = await client.query<RideRow>(
      `UPDATE rides
          SET status = 'in_progress', started_at = now()
        WHERE id = $1
      RETURNING ${RIDE_COLUMNS}`,
      [rideId],
    );
    return shape(upd.rows[0]!, { revealCode: true });
  });
}

interface CompleteInput {
  rideId: string;
  captainId: string;
  actualDistanceM?: number;
  actualDurationS?: number;
  // For colis: the 4-digit code from the recipient
  dropOtp?: string;
}

export async function completeRide(input: CompleteInput) {
  return withTx(async (client) => {
    const ride = await lockRide(client, input.rideId);
    if (ride.captain_id !== input.captainId) {
      throw new HttpError(403, 'forbidden', 'Not your ride');
    }
    if (ride.status !== 'in_progress') {
      throw new HttpError(409, 'wrong_status',
        `Ride is ${ride.status}, cannot complete`);
    }

    // For colis rides: must validate the drop OTP from the recipient.
    if (ride.ride_type === 'colis') {
      if (!input.dropOtp) {
        throw new HttpError(400, 'drop_otp_required',
          'Code de livraison du destinataire requis');
      }
      const colis = await client.query<{ drop_otp_code: string | null }>(
        `SELECT drop_otp_code FROM colis_details WHERE ride_id = $1`,
        [ride.id],
      );
      if (!colis.rows[0]?.drop_otp_code || colis.rows[0].drop_otp_code !== input.dropOtp) {
        throw new HttpError(400, 'invalid_drop_otp', 'Code de livraison incorrect');
      }
      await client.query(
        `UPDATE colis_details SET recipient_confirmed_at = now() WHERE ride_id = $1`,
        [ride.id],
      );
    }

    // Compute final fare. If captain reports actual distance, use it.
    // For Phase 4 we trust captain — Phase 7 will compute from GPS trace.
    const finalDistanceM = input.actualDistanceM ?? ride.distance_m ?? 0;
    const finalDurationS = input.actualDurationS ?? null;

    // Recompute fare from final distance (if actual provided), else use estimate.
    let fareFinalMru = Number(ride.fare_estimate_mru ?? 0);
    if (input.actualDistanceM && input.actualDistanceM !== ride.distance_m) {
      const { estimateFareMru: estimate } = await import('./pricing.js');
      const { fareMru } = await estimate(
        input.actualDistanceM / env.ROUTE_MULTIPLIER,
        ride.ride_type,
      );
      fareFinalMru = fareMru;
    }

    const commission = commissionMru(fareFinalMru, ride.commission_rate_bps);

    // Debit the captain wallet for the commission (atomically inside this tx).
    // When commission is 0 (e.g. admin set rate to 0%), there's nothing to debit;
    // skip the wallet write so we don't hit the "amount must be positive" guard.
    const debit = commission > 0
      ? await debitWallet({
          captainId: input.captainId,
          amountMru: commission,
          type: 'commission',
          rideId: ride.id,
          reason: `Commission ${(ride.commission_rate_bps / 100).toFixed(2)}% on ride ${ride.id}`,
        }, client)
      : { transactionId: null, balanceAfter: await (async () => {
          const r = await client.query<{ balance_mru: string }>(
            `SELECT balance_mru FROM wallets WHERE captain_id = $1`,
            [input.captainId],
          );
          return r.rows[0] ? Number(r.rows[0].balance_mru) : 0;
        })() };

    const upd = await client.query<RideRow>(
      `UPDATE rides
          SET status = 'completed',
              completed_at = now(),
              fare_final_mru = $1,
              commission_mru = $2,
              distance_m = $3,
              duration_s = $4
        WHERE id = $5
      RETURNING ${RIDE_COLUMNS}`,
      [fareFinalMru, commission, finalDistanceM, finalDurationS, ride.id],
    );

    // Captain goes back to "online".
    await client.query(
      `UPDATE captain_state SET presence = 'online', updated_at = now()
        WHERE captain_id = $1`,
      [input.captainId],
    );

    return {
      ride: shape(upd.rows[0]!, { revealCode: true }),
      commissionMru: commission,
      captainBalanceAfter: debit.balanceAfter,
    };
  });
}

interface CancelInput {
  rideId: string;
  userId: string;
  role: 'rider' | 'captain';
  reason: string;
}

export async function cancelRide(input: CancelInput) {
  return withTx(async (client) => {
    const ride = await lockRide(client, input.rideId);

    // Authorization
    if (input.role === 'rider' && ride.booker_id !== input.userId) {
      throw new HttpError(403, 'forbidden', 'Not your ride');
    }
    if (input.role === 'captain' && ride.captain_id !== input.userId) {
      throw new HttpError(403, 'forbidden', 'Not your ride');
    }

    if (!['searching', 'accepted', 'arrived'].includes(ride.status)) {
      throw new HttpError(409, 'wrong_status',
        `Cannot cancel from ${ride.status}`);
    }

    const newStatus = input.role === 'rider'
      ? 'cancelled_by_rider'
      : 'cancelled_by_captain';

    const upd = await client.query<RideRow>(
      `UPDATE rides
          SET status = $1,
              cancelled_at = now(),
              cancel_reason = $2
        WHERE id = $3
      RETURNING ${RIDE_COLUMNS}`,
      [newStatus, input.reason, ride.id],
    );

    // If captain was assigned, return them to "online".
    if (ride.captain_id) {
      await client.query(
        `UPDATE captain_state SET presence = 'online', updated_at = now()
          WHERE captain_id = $1 AND presence = 'on_ride'`,
        [ride.captain_id],
      );
    }
    return shape(upd.rows[0]!, { revealCode: true });
  });
}
