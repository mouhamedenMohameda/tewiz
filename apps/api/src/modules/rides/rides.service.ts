import crypto from 'node:crypto';
import type pg from 'pg';
import { pool, withTx } from '../../db/pool.js';
import { HttpError } from '../../middleware/error.js';
import { env } from '../../config/env.js';
import { estimateFareKhoums, commissionKhoums } from './pricing.js';
import { distanceMeters } from './dispatch.service.js';
import { debitWallet } from '../wallet/wallet.service.js';
import { sms } from '../auth/sms.js';
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
  fare_estimate_khoums: string | null;
  fare_final_khoums: string | null;
  commission_rate_bps: number;
  commission_khoums: string | null;
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
  fare_estimate_khoums, fare_final_khoums,
  commission_rate_bps, commission_khoums,
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
    fareEstimateKhoums: r.fare_estimate_khoums === null ? null : Number(r.fare_estimate_khoums),
    fareFinalKhoums: r.fare_final_khoums === null ? null : Number(r.fare_final_khoums),
    commissionRateBps: r.commission_rate_bps,
    commissionKhoums: r.commission_khoums === null ? null : Number(r.commission_khoums),
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
  // 1. The booker can't have another active ride.
  const existing = await pool.query(
    `SELECT id, status FROM rides
      WHERE booker_id = $1
        AND status IN ('pending_passenger_confirm','searching','accepted','arrived','in_progress')`,
    [input.bookerId],
  );
  if ((existing.rowCount ?? 0) > 0) {
    throw new HttpError(409, 'ride_in_progress',
      'You already have an active ride');
  }

  // 2. Pricing
  const dStraight = await distanceMeters(
    input.pickup.lat, input.pickup.lng,
    input.dropoff.lat, input.dropoff.lng,
  );
  if (dStraight < 50) {
    throw new HttpError(400, 'distance_too_short',
      'Pickup and dropoff are too close (<50 m)');
  }
  const { fareKhoums, distanceEstimateM } = estimateFareKhoums(dStraight);

  const rideType = input.rideType ?? 'passenger';
  const commissionBps = rideType === 'colis'
    ? env.COLIS_COMMISSION_BPS
    : env.DEFAULT_COMMISSION_BPS;

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
  const initialStatus: RideStatus = isForOther ? 'pending_passenger_confirm' : 'searching';

  return withTx(async (client) => {
    // For "for other" rides, passenger_user_id stays NULL (passenger has no account).
    const passengerUserId = isForOther ? null : input.bookerId;
    const r = await client.query<RideRow>(
      `INSERT INTO rides (
         booker_id, passenger_user_id, passenger_name, passenger_phone,
         is_for_other, ride_type, status,
         pickup_location, pickup_label,
         dropoff_location, dropoff_label,
         fare_estimate_khoums, commission_rate_bps,
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
        fareKhoums, commissionBps, distanceEstimateM,
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

    // SMS notifications (mocked in dev)
    if (isForOther && normalizedPassengerPhone) {
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

    return shape(ride, { revealCode: true });
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
    return shape(upd.rows[0]!, { revealCode: true });
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
  return shape(ride, { revealCode });
}

export async function getCurrentRideForRider(userId: string) {
  const r = await pool.query<RideRow>(
    `SELECT ${RIDE_COLUMNS} FROM rides
      WHERE booker_id = $1
        AND status IN ('searching','accepted','arrived','in_progress')
      ORDER BY requested_at DESC LIMIT 1`,
    [userId],
  );
  return r.rows[0] ? shape(r.rows[0], { revealCode: true }) : null;
}

export async function getCurrentRideForCaptain(captainId: string) {
  const r = await pool.query<RideRow>(
    `SELECT ${RIDE_COLUMNS} FROM rides
      WHERE captain_id = $1
        AND status IN ('accepted','arrived','in_progress')
      ORDER BY accepted_at DESC LIMIT 1`,
    [captainId],
  );
  return r.rows[0] ? shape(r.rows[0], { revealCode: true }) : null;
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
    let fareFinalKhoums = Number(ride.fare_estimate_khoums ?? 0);
    if (input.actualDistanceM && input.actualDistanceM !== ride.distance_m) {
      const { fareKhoums } = (await import('./pricing.js'))
        .estimateFareKhoums(input.actualDistanceM / env.ROUTE_MULTIPLIER);
      fareFinalKhoums = fareKhoums;
    }

    const commission = commissionKhoums(fareFinalKhoums, ride.commission_rate_bps);

    // Debit the captain wallet for the commission (atomically inside this tx).
    const debit = await debitWallet({
      captainId: input.captainId,
      amountKhoums: commission,
      type: 'commission',
      rideId: ride.id,
      reason: `Commission ${(ride.commission_rate_bps / 100).toFixed(2)}% on ride ${ride.id}`,
    }, client);

    const upd = await client.query<RideRow>(
      `UPDATE rides
          SET status = 'completed',
              completed_at = now(),
              fare_final_khoums = $1,
              commission_khoums = $2,
              distance_m = $3,
              duration_s = $4
        WHERE id = $5
      RETURNING ${RIDE_COLUMNS}`,
      [fareFinalKhoums, commission, finalDistanceM, finalDurationS, ride.id],
    );

    // Captain goes back to "online".
    await client.query(
      `UPDATE captain_state SET presence = 'online', updated_at = now()
        WHERE captain_id = $1`,
      [input.captainId],
    );

    return {
      ride: shape(upd.rows[0]!, { revealCode: true }),
      commissionKhoums: commission,
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
