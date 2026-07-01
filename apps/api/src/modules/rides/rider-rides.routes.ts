import { Router } from 'express';
import { z } from 'zod';
import { RIDER_RIDE_CANCEL_REASONS, RIDE_CANCEL_REASON_LABEL_FR } from '@tewiz/shared-types';
import { type AuthedRequest } from '../../middleware/auth.js';
import { requirePhone } from '../../middleware/require-phone.js';
import { HttpError } from '../../middleware/error.js';
import * as rides from './rides.service.js';
import { distanceMeters } from './dispatch.service.js';
import { estimateFareMru } from './pricing.js';
import { getPricingSettings } from '../admin/app-settings.service.js';

// Parent (riderRouter) enforces requireAuth + requireRole('rider', 'captain').
// A captain in rider mode books rides exactly like a regular rider.
export const riderRidesRouter = Router();

const locationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  label: z.string().min(1).max(200).optional(),
});

const createBody = z.object({
  pickup: locationSchema,
  // Open rides (isOpen=true) have no upfront destination; the meter runs
  // from GPS once the ride starts. Closed rides require dropoff.
  dropoff: locationSchema.optional(),
  isOpen: z.boolean().optional(),
  rideType: z.enum(['passenger', 'colis']).default('passenger'),
  pricingMode: z.enum(['solo', 'shared']).optional(),
  sharedSeats: z.number().int().min(2).max(20).optional(),
  paymentMethod: z.enum(['cash', 'wallet']).default('cash'),
  // For "course pour quelqu'un d'autre"
  passengerName: z.string().min(2).max(100).optional(),
  passengerPhone: z.string().min(8).max(20).optional(),
  // For colis
  recipientName: z.string().min(2).max(100).optional(),
  recipientPhone: z.string().min(8).max(20).optional(),
  packageDescription: z.string().min(2).max(500).optional(),
});

/**
 * POST /rider/rides/estimate
 * Returns a fare + distance estimate WITHOUT creating a ride. Used by the
 * "Confirmer ?" step so the rider sees the price before tapping create.
 */
const estimateBody = z.object({
  pickup: locationSchema,
  dropoff: locationSchema,
  // Optional so older mobile builds (which don't send it) still work and get
  // the passenger tariff by default.
  rideType: z.enum(['passenger', 'colis']).default('passenger'),
  pricingMode: z.enum(['solo', 'shared']).optional(),
  sharedSeats: z.number().int().min(2).max(20).optional(),
});

riderRidesRouter.post('/estimate', async (req, res) => {
  const body = estimateBody.parse(req.body);
  const crow = await distanceMeters(
    body.pickup.lat, body.pickup.lng,
    body.dropoff.lat, body.dropoff.lng,
  );
  const quote = await estimateFareMru(crow, body.rideType, {
    pricingMode: body.pricingMode,
    sharedSeats: body.sharedSeats,
  });
  res.json({
    fareMru: quote.fareMru,
    distanceM: quote.distanceEstimateM,
    pricingMode: quote.pricingModeApplied,
    sharedSeats: quote.sharedSeatsApplied,
    soloFareMru: quote.soloFareMru,
    isIntercityPricing: quote.isIntercityPricing,
  });
});

/**
 * POST /rider/rides
 * Create a new ride request.
 */
riderRidesRouter.post('/', requirePhone, async (req, res) => {
  const userId = req.user!.id;
  const body = createBody.parse(req.body);
  const ride = await rides.createRide({
    bookerId: userId,
    pickup: body.pickup,
    dropoff: body.dropoff,
    isOpen: body.isOpen,
    rideType: body.rideType,
    pricingMode: body.pricingMode,
    sharedSeats: body.sharedSeats,
    paymentMethod: body.paymentMethod,
    passengerName: body.passengerName,
    passengerPhone: body.passengerPhone,
    recipientName: body.recipientName,
    recipientPhone: body.recipientPhone,
    packageDescription: body.packageDescription,
  });
  res.json(ride);
});

/**
 * GET /rider/rides/open-quote
 * Returns the current open-ride tariff (base/per-km/per-min/min) plus a
 * "feature on?" flag. The rider screen uses this to (a) decide whether to
 * show the "course ouverte" toggle and (b) display the rate clearly before
 * booking, so they don't get a surprise.
 */
riderRidesRouter.get('/open-quote', async (_req, res) => {
  const s = await getPricingSettings();
  res.json({
    enabled: s.allowOpenRides,
    baseFareMru: s.openBaseFareMru,
    perKmMru: s.openPerKmMru,
    perMinuteMru: s.openPerMinuteMru,
    minFareMru: s.openMinFareMru,
  });
});

riderRidesRouter.get('/current', async (req, res) => {
  const userId = req.user!.id;
  const ride = await rides.getCurrentRideForRider(userId);
  if (!ride) {
    res.status(204).end();
    return;
  }
  res.json(ride);
});

riderRidesRouter.get('/history', async (req, res) => {
  const userId = req.user!.id;
  res.json(await rides.listRiderHistory(userId, 30));
});

riderRidesRouter.get('/:id', async (req, res) => {
  const userId = req.user!.id;
  res.json(await rides.getRideForUser(req.params.id!, userId, 'rider'));
});

/**
 * POST /rider/rides/:id/rating
 * Body: { stars (1-5), comment? }
 * Rider rates the captain after a completed ride. Idempotent — re-posting
 * updates the existing rating. Recomputes captains.rating_avg + rating_count
 * from scratch (cheap; each captain has at most ~1k ratings).
 */
const ratingBody = z.object({
  stars: z.number().int().min(1).max(5),
  comment: z.string().max(500).optional(),
});
riderRidesRouter.post('/:id/rating', async (req, res) => {
  const userId = req.user!.id;
  const body = ratingBody.parse(req.body);
  res.json(await rides.rateCaptain({
    rideId: req.params.id!,
    riderId: userId,
    stars: body.stars,
    comment: body.comment,
  }));
});

const cancelBody = z.object({
  reason: z.string().min(2).max(500).optional(),
  reasonKey: z.enum(RIDER_RIDE_CANCEL_REASONS).optional(),
}).refine(
  (body) => !!(body.reason || body.reasonKey),
  { message: 'A cancel reason is required' },
);

riderRidesRouter.post('/:id/cancel', async (req, res) => {
  const userId = req.user!.id;
  const body = cancelBody.parse(req.body);
  res.json(await rides.cancelRide({
    rideId: req.params.id!,
    userId,
    role: 'rider',
    reason: body.reasonKey ? RIDE_CANCEL_REASON_LABEL_FR[body.reasonKey] : body.reason!,
  }));
});
