import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { type AuthedRequest } from '../../middleware/auth.js';
import { HttpError } from '../../middleware/error.js';
import * as rides from './rides.service.js';
import * as dispatch from './dispatch.service.js';

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
  const userId = (req as AuthedRequest).user.id;
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
  const userId = (req as AuthedRequest).user.id;
  const r = await rides.getCurrentRideForCaptain(userId);
  if (!r) {
    res.status(204).end();
    return;
  }
  res.json(r);
});

captainRidesRouter.get('/history', async (req, res) => {
  const userId = (req as AuthedRequest).user.id;
  res.json(await rides.listCaptainHistory(userId, 30));
});

captainRidesRouter.get('/:id', async (req, res) => {
  const userId = (req as AuthedRequest).user.id;
  res.json(await rides.getRideForUser(req.params.id!, userId, 'captain'));
});

captainRidesRouter.post('/:id/accept', async (req, res) => {
  const userId = (req as AuthedRequest).user.id;
  res.json(await rides.acceptRide(req.params.id!, userId));
});

captainRidesRouter.post('/:id/arrive', async (req, res) => {
  const userId = (req as AuthedRequest).user.id;
  res.json(await rides.arriveRide(req.params.id!, userId));
});

const startBody = z.object({ code: z.string().regex(/^\d{4}$/) });
captainRidesRouter.post('/:id/start', async (req, res) => {
  const userId = (req as AuthedRequest).user.id;
  const body = startBody.parse(req.body);
  res.json(await rides.startRide(req.params.id!, userId, body.code));
});

const completeBody = z.object({
  actualDistanceM: z.coerce.number().int().min(0).optional(),
  actualDurationS: z.coerce.number().int().min(0).optional(),
  dropOtp: z.string().regex(/^\d{4}$/).optional(),  // required for colis
});
captainRidesRouter.post('/:id/complete', async (req, res) => {
  const userId = (req as AuthedRequest).user.id;
  const body = completeBody.parse(req.body ?? {});
  res.json(await rides.completeRide({
    rideId: req.params.id!,
    captainId: userId,
    actualDistanceM: body.actualDistanceM,
    actualDurationS: body.actualDurationS,
    dropOtp: body.dropOtp,
  }));
});

const cancelBody = z.object({ reason: z.string().min(2).max(500) });
captainRidesRouter.post('/:id/cancel', async (req, res) => {
  const userId = (req as AuthedRequest).user.id;
  const body = cancelBody.parse(req.body);
  res.json(await rides.cancelRide({
    rideId: req.params.id!,
    userId,
    role: 'captain',
    reason: body.reason,
  }));
});
