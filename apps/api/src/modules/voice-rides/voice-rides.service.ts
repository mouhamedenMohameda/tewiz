import crypto from 'node:crypto';
import { pool, withTx } from '../../db/pool.js';
import { HttpError } from '../../middleware/error.js';
import { defaultStorage } from '../storage/local-disk.js';
import { getRideForUser, createRide } from '../rides/rides.service.js';
import { autoSeedPoi, type PoiSource } from './poi.service.js';
import { notifyVoiceRideConfirmed } from '../push/expo-push.js';
import type { PaymentMethod } from '@tewiz/shared-types';

// ────────────────────────────────────────────────────────────────────────────
// Types

export type VoiceRideStatus = 'pending' | 'confirmed' | 'rejected' | 'cancelled';

// Row shape as returned by VOICE_RIDE_COLUMNS. lat/lng are extracted from the
// GEOGRAPHY columns the same way rides.service.ts does it.
interface VoiceRideRow {
  id: string;
  user_id: string;
  status: VoiceRideStatus;
  audio_key: string;
  audio_mime: string;
  audio_duration_s: number | null;
  transcript: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  pickup_label: string | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  dropoff_label: string | null;
  ride_id: string | null;
  processed_by: string | null;
  reject_reason: string | null;
  created_at: Date;
  processed_at: Date | null;
  cancelled_at: Date | null;
}

const VOICE_RIDE_COLUMNS = `
  id, user_id, status, audio_key, audio_mime, audio_duration_s, transcript,
  ST_Y(pickup_location::geometry)  AS pickup_lat,
  ST_X(pickup_location::geometry)  AS pickup_lng,
  pickup_label,
  ST_Y(dropoff_location::geometry) AS dropoff_lat,
  ST_X(dropoff_location::geometry) AS dropoff_lng,
  dropoff_label,
  ride_id, processed_by, reject_reason,
  created_at, processed_at, cancelled_at
`;

// Public shape. Note: audio_key (the internal storage key) is deliberately
// NOT exposed — the audio is streamed back only to admins via a dedicated
// route that resolves the key server-side.
function shape(r: VoiceRideRow) {
  return {
    id: r.id,
    userId: r.user_id,
    status: r.status,
    audioMime: r.audio_mime,
    audioDurationS: r.audio_duration_s,
    transcript: r.transcript,
    pickup:
      r.pickup_lat !== null && r.pickup_lng !== null
        ? { lat: r.pickup_lat, lng: r.pickup_lng, label: r.pickup_label }
        : null,
    dropoff:
      r.dropoff_lat !== null && r.dropoff_lng !== null
        ? { lat: r.dropoff_lat, lng: r.dropoff_lng, label: r.dropoff_label }
        : null,
    rideId: r.ride_id,
    rejectReason: r.reject_reason,
    createdAt: r.created_at,
    processedAt: r.processed_at,
    cancelledAt: r.cancelled_at,
  };
}

export type VoiceRideRequest = ReturnType<typeof shape>;

// ────────────────────────────────────────────────────────────────────────────
// Create

export async function createVoiceRideRequest(input: {
  userId: string;
  audio: { buffer: Buffer; mimetype: string };
  durationS?: number;
}): Promise<VoiceRideRequest> {
  // One open request at a time: the rider records, then watches the waiting
  // screen until an admin acts or they cancel. Mirrors the "one active ride
  // per booker" rule in rides.service.createRide.
  const pending = await pool.query(
    `SELECT 1 FROM voice_ride_requests
      WHERE user_id = $1 AND status = 'pending' LIMIT 1`,
    [input.userId],
  );
  if ((pending.rowCount ?? 0) > 0) {
    throw new HttpError(
      409,
      'voice_request_pending',
      'You already have a pending voice request',
    );
  }

  const id = crypto.randomUUID();
  const mime = input.audio.mimetype || 'audio/m4a';
  const audioKey = `voice-rides/${id}.m4a`;

  // Write the audio first, then insert. If the insert fails, delete the
  // orphaned file so we don't leak storage.
  await defaultStorage.put(audioKey, input.audio.buffer, mime);
  try {
    const r = await pool.query<VoiceRideRow>(
      `INSERT INTO voice_ride_requests
         (id, user_id, audio_key, audio_mime, audio_duration_s)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${VOICE_RIDE_COLUMNS}`,
      [id, input.userId, audioKey, mime, input.durationS ?? null],
    );
    return shape(r.rows[0]!);
  } catch (err) {
    await defaultStorage.delete(audioKey).catch(() => {});
    throw err;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Reads

/**
 * Fetch a request for its owner. When the request has been confirmed, the
 * linked ride is embedded so the waiting screen can transition straight to
 * ride-tracking without a second round-trip.
 */
export async function getVoiceRideRequestForUser(id: string, userId: string) {
  const r = await pool.query<VoiceRideRow>(
    `SELECT ${VOICE_RIDE_COLUMNS} FROM voice_ride_requests WHERE id = $1`,
    [id],
  );
  const row = r.rows[0];
  if (!row) throw new HttpError(404, 'not_found', 'Voice request not found');
  if (row.user_id !== userId) {
    throw new HttpError(403, 'forbidden', 'Not your request');
  }

  const shaped = shape(row);
  if (row.ride_id) {
    // Best-effort embed; if the ride lookup fails we still return the request.
    const ride = await getRideForUser(row.ride_id, userId, 'rider').catch(() => null);
    return { ...shaped, ride };
  }
  return { ...shaped, ride: null };
}

// ────────────────────────────────────────────────────────────────────────────
// Cancel (rider, while still pending)

export async function cancelVoiceRideRequest(id: string, userId: string) {
  return withTx(async (client) => {
    const r = await client.query<VoiceRideRow>(
      `SELECT ${VOICE_RIDE_COLUMNS} FROM voice_ride_requests WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const row = r.rows[0];
    if (!row) throw new HttpError(404, 'not_found', 'Voice request not found');
    if (row.user_id !== userId) {
      throw new HttpError(403, 'forbidden', 'Not your request');
    }
    if (row.status !== 'pending') {
      throw new HttpError(409, 'wrong_status', `Cannot cancel from ${row.status}`);
    }
    const upd = await client.query<VoiceRideRow>(
      `UPDATE voice_ride_requests
          SET status = 'cancelled', cancelled_at = now()
        WHERE id = $1
      RETURNING ${VOICE_RIDE_COLUMNS}`,
      [id],
    );
    return shape(upd.rows[0]!);
  });
}

// ════════════════════════════════════════════════════════════════════════════
// Admin (dispatcher) side
// ════════════════════════════════════════════════════════════════════════════

// Queue/detail rows carry the requester's identity so the dispatcher knows
// who is waiting without a second lookup.
interface AdminVoiceRideRow extends VoiceRideRow {
  user_full_name: string | null;
  user_phone: string;
}

const ADMIN_VOICE_RIDE_COLUMNS = `
  v.id, v.user_id, v.status, v.audio_key, v.audio_mime, v.audio_duration_s, v.transcript,
  ST_Y(v.pickup_location::geometry)  AS pickup_lat,
  ST_X(v.pickup_location::geometry)  AS pickup_lng,
  v.pickup_label,
  ST_Y(v.dropoff_location::geometry) AS dropoff_lat,
  ST_X(v.dropoff_location::geometry) AS dropoff_lng,
  v.dropoff_label,
  v.ride_id, v.processed_by, v.reject_reason,
  v.created_at, v.processed_at, v.cancelled_at,
  u.full_name AS user_full_name, u.phone AS user_phone
`;

function shapeAdmin(r: AdminVoiceRideRow) {
  return {
    ...shape(r),
    user: { id: r.user_id, fullName: r.user_full_name, phone: r.user_phone },
  };
}

export type AdminVoiceRideRequest = ReturnType<typeof shapeAdmin>;

/**
 * Admin queue + history. `status='pending'` (default) drives the 5 s-polled
 * dispatcher queue, oldest-first. Any concrete status filters history.
 */
export async function listVoiceRideRequestsForAdmin(input: {
  status?: VoiceRideStatus | 'all';
  limit?: number;
}): Promise<AdminVoiceRideRequest[]> {
  const limit = Math.min(input.limit ?? 50, 200);
  const status = input.status ?? 'pending';

  const wheres: string[] = [];
  const params: unknown[] = [];
  if (status !== 'all') {
    params.push(status);
    wheres.push(`v.status = $${params.length}`);
  }
  params.push(limit);

  // Pending queue is FIFO (oldest first); everything else newest-first.
  const order = status === 'pending' ? 'v.created_at ASC' : 'v.created_at DESC';
  const r = await pool.query<AdminVoiceRideRow>(
    `SELECT ${ADMIN_VOICE_RIDE_COLUMNS}
       FROM voice_ride_requests v
       JOIN users u ON u.id = v.user_id
      ${wheres.length ? `WHERE ${wheres.join(' AND ')}` : ''}
      ORDER BY ${order}
      LIMIT $${params.length}`,
    params,
  );
  return r.rows.map(shapeAdmin);
}

export async function getVoiceRideRequestForAdmin(id: string): Promise<AdminVoiceRideRequest> {
  const r = await pool.query<AdminVoiceRideRow>(
    `SELECT ${ADMIN_VOICE_RIDE_COLUMNS}
       FROM voice_ride_requests v
       JOIN users u ON u.id = v.user_id
      WHERE v.id = $1`,
    [id],
  );
  const row = r.rows[0];
  if (!row) throw new HttpError(404, 'not_found', 'Voice request not found');
  return shapeAdmin(row);
}

/** Fetch the raw audio bytes (admin playback). */
export async function getVoiceRideAudio(id: string): Promise<{ buffer: Buffer; mime: string }> {
  const r = await pool.query<{ audio_key: string; audio_mime: string }>(
    `SELECT audio_key, audio_mime FROM voice_ride_requests WHERE id = $1`,
    [id],
  );
  const row = r.rows[0];
  if (!row) throw new HttpError(404, 'not_found', 'Voice request not found');
  const buffer = await defaultStorage.get(row.audio_key);
  return { buffer, mime: row.audio_mime };
}

// A pin the dispatcher placed on the map, optionally carrying the POI
// candidate it came from (so we can auto-seed Google picks).
export interface ConfirmPin {
  lat: number;
  lng: number;
  label?: string;
  // POI provenance (for silent auto-seed). Present when the pin came from
  // the POI search panel rather than a freehand map click.
  placeId?: string;
  name?: string;
  source?: PoiSource;
  types?: string[];
}

/**
 * Confirm a pending request: create the real ride, link it back, silently
 * auto-seed any Google-sourced pins, and push the rider.
 *
 * Concurrency: we atomically CLAIM the row (status pending → confirmed) first,
 * so two dispatchers can't both process it. If ride creation then fails (e.g.
 * pickup/dropoff too close), we roll the row back to pending — keeping the
 * pinned locations — and rethrow so the dispatcher can fix and retry.
 */
export async function confirmVoiceRideRequest(input: {
  id: string;
  adminId: string;
  pickup: ConfirmPin;
  dropoff: ConfirmPin;
  paymentMethod?: PaymentMethod;
}): Promise<AdminVoiceRideRequest> {
  // 1. Atomic claim + record the pinned locations.
  const claim = await pool.query<{ user_id: string }>(
    `UPDATE voice_ride_requests
        SET status = 'confirmed',
            processed_by = $2,
            processed_at = now(),
            pickup_location  = ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography,
            pickup_label     = $5,
            dropoff_location = ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography,
            dropoff_label    = $8
      WHERE id = $1 AND status = 'pending'
      RETURNING user_id`,
    [
      input.id, input.adminId,
      input.pickup.lng, input.pickup.lat, input.pickup.label ?? null,
      input.dropoff.lng, input.dropoff.lat, input.dropoff.label ?? null,
    ],
  );
  if (claim.rowCount === 0) {
    // Either gone or already processed/cancelled by someone else.
    const cur = await pool.query<{ status: VoiceRideStatus }>(
      `SELECT status FROM voice_ride_requests WHERE id = $1`,
      [input.id],
    );
    if (!cur.rows[0]) throw new HttpError(404, 'not_found', 'Voice request not found');
    throw new HttpError(409, 'wrong_status', `Cannot confirm from ${cur.rows[0].status}`);
  }
  const riderId = claim.rows[0]!.user_id;

  // 2. Create the actual ride. Admin operator context: skip the booker
  //    active-ride check and the "for someone else" SMS loop.
  let rideId: string;
  try {
    const ride = await createRide({
      bookerId: riderId,
      pickup: { lat: input.pickup.lat, lng: input.pickup.lng, label: input.pickup.label },
      dropoff: { lat: input.dropoff.lat, lng: input.dropoff.lng, label: input.dropoff.label },
      paymentMethod: input.paymentMethod ?? 'cash',
      skipBookerActiveCheck: true,
      skipPassengerConfirm: true,
    });
    rideId = ride.id;
  } catch (err) {
    // Roll back the claim to pending so the dispatcher can fix the pins.
    await pool.query(
      `UPDATE voice_ride_requests
          SET status = 'pending', processed_by = NULL, processed_at = NULL
        WHERE id = $1 AND status = 'confirmed'`,
      [input.id],
    ).catch(() => {});
    throw err;
  }

  // 3. Link the ride to the request.
  await pool.query(`UPDATE voice_ride_requests SET ride_id = $2 WHERE id = $1`, [input.id, rideId]);

  // 4. Silent auto-seed of Google-sourced pins (soft-fail, never throws).
  for (const pin of [input.pickup, input.dropoff]) {
    if (pin.placeId && pin.source && pin.source !== 'local') {
      void autoSeedPoi({
        query: pin.label ?? pin.name ?? '',
        placeId: pin.placeId,
        name: pin.name ?? pin.label ?? '',
        label: pin.label ?? pin.name ?? '',
        lat: pin.lat,
        lng: pin.lng,
        types: pin.types ?? [],
        source: pin.source,
      });
    }
  }

  // 5. Push the rider ("Votre course est confirmée"). Fire-and-forget.
  void notifyVoiceRideConfirmed(riderId, { voiceRequestId: input.id, rideId });

  return getVoiceRideRequestForAdmin(input.id);
}

/** Reject a pending request (inaudible, out of zone, ...). */
export async function rejectVoiceRideRequest(input: {
  id: string;
  adminId: string;
  reason: string;
}): Promise<AdminVoiceRideRequest> {
  const upd = await pool.query(
    `UPDATE voice_ride_requests
        SET status = 'rejected', reject_reason = $3,
            processed_by = $2, processed_at = now()
      WHERE id = $1 AND status = 'pending'`,
    [input.id, input.adminId, input.reason],
  );
  if (upd.rowCount === 0) {
    const cur = await pool.query<{ status: VoiceRideStatus }>(
      `SELECT status FROM voice_ride_requests WHERE id = $1`,
      [input.id],
    );
    if (!cur.rows[0]) throw new HttpError(404, 'not_found', 'Voice request not found');
    throw new HttpError(409, 'wrong_status', `Cannot reject from ${cur.rows[0].status}`);
  }
  return getVoiceRideRequestForAdmin(input.id);
}
