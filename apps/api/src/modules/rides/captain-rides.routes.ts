import { Router } from 'express';
import { z } from 'zod';
import { CAPTAIN_RIDE_CANCEL_REASONS, RIDE_CANCEL_REASON_LABEL_FR } from '@tewiz/shared-types';
import { pool, withTx } from '../../db/pool.js';
import { type AuthedRequest } from '../../middleware/auth.js';
import { HttpError } from '../../middleware/error.js';
import * as rides from './rides.service.js';
import * as dispatch from './dispatch.service.js';
import { getRideInsights } from './ride-insights.service.js';
import { ingestLocation } from './meter.service.js';

// Parent (captainRouter) already enforces requireAuth + requireRole('captain').
export const captainRidesRouter = Router();

const inboxQuery = z.object({
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  radiusM: z.coerce.number().int().min(100).max(20_000).optional(),
});

/**
 * GET /captain/rides/inbox
 * Lists nearby searching rides (sorted by distance to pickup).
 * If the captain didn't pass a location, we use their last known state.
 */
captainRidesRouter.get('/inbox', async (req, res) => {
  const userId = req.user!.id;
  const q = inboxQuery.parse(req.query);

  let lat = q.lat;
  let lng = q.lng;
  if (lat === undefined || lng === undefined) {
    const r = await pool.query(
      `SELECT ST_X(location::geometry) AS lng, ST_Y(location::geometry) AS lat
         FROM captain_state WHERE captain_id = $1 AND location IS NOT NULL`,
      [userId],
    );
    if (!r.rows[0]) {
      throw new HttpError(400, 'no_location',
        'Pass lat/lng or go online with a location first');
    }
    lat = Number(r.rows[0].lat);
    lng = Number(r.rows[0].lng);
  }

  const items = await dispatch.captainInbox({
    captainId: userId,
    lat,
    lng,
    radiusM: q.radiusM,
  });
  res.json(items);
});

captainRidesRouter.get('/current', async (req, res) => {
  const userId = req.user!.id;
  const r = await rides.getCurrentRideForCaptain(userId);
  if (!r) {
    res.status(204).end();
    return;
  }
  res.json(r);
});

captainRidesRouter.get('/history', async (req, res) => {
  const userId = req.user!.id;
  res.json(await rides.listCaptainHistory(userId, 30));
});

captainRidesRouter.get('/:id', async (req, res) => {
  const userId = req.user!.id;
  res.json(await rides.getRideForUser(req.params.id!, userId, 'captain'));
});

/**
 * GET /captain/rides/:id/insights
 * Returns rich pre-acceptance context: destination zone demand (rides in the
 * last 2 h vs same time yesterday) + rider lifetime stats (completion, no-show,
 * average rating, member since). Used by the alert modal to encourage accept.
 *
 * Auth: the ride must currently be 'searching' (open to any nearby captain),
 * OR it must be the captain's own accepted/ongoing ride. We don't expose a
 * stranger's ride history to any captain on demand.
 */
captainRidesRouter.get('/:id/insights', async (req, res) => {
  const userId = req.user!.id;
  const rideId = req.params.id!;
  const r = await pool.query<{ status: string; captain_id: string | null }>(
    `SELECT status, captain_id FROM rides WHERE id = $1`,
    [rideId],
  );
  if (!r.rows[0]) throw new HttpError(404, 'not_found', 'Ride not found');
  const { status, captain_id } = r.rows[0];
  const isSearchingOpen = status === 'searching';
  const isMyRide = captain_id === userId;
  if (!isSearchingOpen && !isMyRide) {
    throw new HttpError(403, 'forbidden', 'Not authorized to view this ride');
  }
  res.json(await getRideInsights(rideId));
});

captainRidesRouter.post('/:id/accept', async (req, res) => {
  const userId = req.user!.id;
  res.json(await rides.acceptRide(req.params.id!, userId));
});

/**
 * POST /captain/rides/:id/decline
 * The captain explicitly refuses a ride. Idempotent — re-pressing "Refuser"
 * is a no-op. After this call the ride is filtered out of this captain's
 * future inbox queries and broadcast notifications.
 */
captainRidesRouter.post('/:id/decline', async (req, res) => {
  const userId = req.user!.id;
  const rideId = req.params.id!;
  // ON CONFLICT DO NOTHING because the client might fire decline twice
  // (network retry, fast-refresh, etc.).
  await pool.query(
    `INSERT INTO ride_declines (ride_id, captain_id)
     VALUES ($1, $2)
     ON CONFLICT (ride_id, captain_id) DO NOTHING`,
    [rideId, userId],
  );
  res.json({ ok: true });
});

captainRidesRouter.post('/:id/arrive', async (req, res) => {
  const userId = req.user!.id;
  res.json(await rides.arriveRide(req.params.id!, userId));
});

captainRidesRouter.post('/:id/start', async (req, res) => {
  const userId = req.user!.id;
  res.json(await rides.startRide(req.params.id!, userId));
});

const completeBody = z.object({
  actualDistanceM: z.coerce.number().int().min(0).optional(),
  actualDurationS: z.coerce.number().int().min(0).optional(),
  dropOtp: z.string().regex(/^\d{4}$/).optional(),  // required for colis
});
captainRidesRouter.post('/:id/complete', async (req, res) => {
  const userId = req.user!.id;
  const body = completeBody.parse(req.body ?? {});
  res.json(await rides.completeRide({
    rideId: req.params.id!,
    captainId: userId,
    actualDistanceM: body.actualDistanceM,
    actualDurationS: body.actualDurationS,
    dropOtp: body.dropOtp,
  }));
});

/**
 * POST /captain/rides/:id/location
 * GPS sample from the captain device while the ride is in_progress. Body:
 *   { lat, lng, accuracyM?, speedMps?, recordedAt? (ms epoch) }
 * The captain app should fire this every ~5 s. The server validates the
 * sample (rejects teleports and bad-accuracy fixes) and returns the current
 * meter state regardless — that way the app gets fresh telemetry even when
 * a sample is dropped.
 */
const locationBody = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracyM: z.number().min(0).max(10_000).optional(),
  speedMps: z.number().min(-1).max(200).optional(),
  recordedAt: z.number().int().positive().optional(),
});
captainRidesRouter.post('/:id/location', async (req, res) => {
  const userId = req.user!.id;
  const rideId = req.params.id!;
  const body = locationBody.parse(req.body);

  // Auth: only the assigned captain of an in_progress ride may ping.
  const r = await pool.query<{ captain_id: string | null; status: string }>(
    `SELECT captain_id, status FROM rides WHERE id = $1`,
    [rideId],
  );
  const row = r.rows[0];
  if (!row) throw new HttpError(404, 'not_found', 'Ride not found');
  if (row.captain_id !== userId) throw new HttpError(403, 'forbidden', 'Not your ride');
  if (row.status !== 'in_progress') throw new HttpError(409, 'wrong_status',
    `Ride is ${row.status}, location telemetry only runs while in_progress`);

  const result = await withTx((client) => ingestLocation(client, rideId, {
    lat: body.lat,
    lng: body.lng,
    accuracyM: body.accuracyM ?? null,
    speedMps: body.speedMps ?? null,
    recordedAt: body.recordedAt ? new Date(body.recordedAt) : undefined,
  }));
  res.json(result);
});

const cancelBody = z.object({
  reason: z.string().min(2).max(500).optional(),
  reasonKey: z.enum(CAPTAIN_RIDE_CANCEL_REASONS).optional(),
}).refine(
  (body) => !!(body.reason || body.reasonKey),
  { message: 'A cancel reason is required' },
);
captainRidesRouter.post('/:id/cancel', async (req, res) => {
  const userId = req.user!.id;
  const body = cancelBody.parse(req.body);
  res.json(await rides.cancelRide({
    rideId: req.params.id!,
    userId,
    role: 'captain',
    reason: body.reasonKey ? RIDE_CANCEL_REASON_LABEL_FR[body.reasonKey] : body.reason!,
  }));
});
