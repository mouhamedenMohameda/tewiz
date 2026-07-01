import { Router } from 'express';
import { z } from 'zod';
import { type AuthedRequest } from '../../middleware/auth.js';
import { audit } from '../admin/audit.js';
import * as rides from './rides.service.js';
import { estimateFareMru } from './pricing.js';
import { distanceMeters } from './dispatch.service.js';
import { getPricingSettings } from '../admin/app-settings.service.js';

// Parent (adminRouter) already enforces requireAuth + requireRole('admin').
export const adminRidesRouter = Router();

const locationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  label: z.string().min(1).max(200).optional(),
});

const createBody = z.object({
  pickup: locationSchema,
  // Required for closed rides; must be absent for open rides (isOpen=true).
  dropoff: locationSchema.optional(),
  isOpen: z.boolean().optional(),
  rideType: z.enum(['passenger', 'colis']).default('passenger'),
  pricingMode: z.enum(['solo', 'shared']).optional(),
  sharedSeats: z.number().int().min(2).max(20).optional(),
  paymentMethod: z.enum(['cash', 'wallet']).default('cash'),
  // Passenger reached the operator by phone — they don't have an app.
  // We reuse the "course pour quelqu'un d'autre" flow: an SMS confirmation
  // code is sent and the passenger confirms via /public/rides/:id/confirm.
  passengerName: z.string().min(2).max(100),
  passengerPhone: z.string().min(8).max(20),
  // For colis: the package recipient (distinct from the caller/sender).
  recipientName: z.string().min(2).max(100).optional(),
  recipientPhone: z.string().min(8).max(20).optional(),
  packageDescription: z.string().max(500).optional(),
}).refine(
  (v) => v.rideType !== 'colis' || (v.recipientName && v.recipientPhone),
  { message: 'Colis rides require recipientName and recipientPhone', path: ['recipientName'] },
).refine(
  // Either you give a dropoff, or you flip isOpen. Not both, not neither.
  (v) => v.isOpen ? !v.dropoff : !!v.dropoff,
  { message: 'Provide a dropoff for closed rides, or set isOpen=true for an open ride', path: ['dropoff'] },
);

/**
 * GET /admin/rides
 * Lists rides for the operator dashboard. Supports a status shortcut
 * ('active' / 'done') or any concrete RideStatus, plus a `before` cursor
 * for pagination (ISO timestamp of the last row from the previous page).
 */
const listQuery = z.object({
  status: z.union([
    z.enum(['active', 'done']),
    z.enum([
      'pending_passenger_confirm', 'searching',
      'accepted', 'arrived', 'in_progress',
      'completed', 'cancelled_by_rider', 'cancelled_by_captain',
      'cancelled_by_system', 'no_show',
    ]),
  ]).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  before: z.string().datetime().optional(),
});

adminRidesRouter.get('/', async (req, res) => {
  const q = listQuery.parse(req.query);
  const items = await rides.listAdminRides({
    status: q.status,
    limit: q.limit,
    before: q.before ? new Date(q.before) : undefined,
  });
  res.json(items);
});

/**
 * GET /admin/rides/open-quote
 * Mirrors the rider endpoint so the operator's "Nouvelle course" form can
 * display the open-ride tariff. The rider variant is gated to role=rider, so
 * the admin token would 403 against it — hence this duplicate.
 *
 * MUST be declared BEFORE the `/:id` route, or Express matches `/open-quote`
 * as `:id="open-quote"` and tries to look up a ride by that "uuid", returning
 * a 400 / 500 from Postgres before this handler ever runs.
 */
adminRidesRouter.get('/open-quote', async (_req, res) => {
  const s = await getPricingSettings();
  res.json({
    enabled: s.allowOpenRides,
    baseFareMru: s.openBaseFareMru,
    perKmMru: s.openPerKmMru,
    perMinuteMru: s.openPerMinuteMru,
    minFareMru: s.openMinFareMru,
  });
});

/**
 * GET /admin/rides/:id
 * Single-ride detail (any ride). Used by the post-create page so the operator
 * can watch the ride move through its lifecycle.
 */
adminRidesRouter.get('/:id', async (req, res) => {
  const adminId = req.user!.id;
  res.json(await rides.getRideForUser(req.params.id!, adminId, 'admin'));
});

/**
 * POST /admin/rides/estimate
 * Returns a fare + distance estimate without creating a ride. Mirrors the
 * rider /rider/rides/estimate endpoint so the admin "Nouvelle course" form
 * shows the same price the backend will actually charge — including the
 * lower colis tariff.
 */
const estimateBody = z.object({
  pickup: locationSchema,
  dropoff: locationSchema,
  rideType: z.enum(['passenger', 'colis']).default('passenger'),
  pricingMode: z.enum(['solo', 'shared']).optional(),
  sharedSeats: z.number().int().min(2).max(20).optional(),
});

adminRidesRouter.post('/estimate', async (req, res) => {
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
 * POST /admin/rides
 * Admin books a ride on behalf of a passenger who called by phone.
 * The admin becomes the booker; the passenger is identified by name+phone.
 * SMS confirmation is skipped (the passenger called us — they've consented).
 */
adminRidesRouter.post('/', async (req, res) => {
  const adminId = req.user!.id;
  const body = createBody.parse(req.body);
  const ride = await rides.createRide({
    bookerId: adminId,
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
    // The admin operator is booking on behalf of a passenger who called by
    // phone — they have already consented, so we go straight to "searching"
    // (visible by captains) without the return SMS confirmation step.
    skipBookerActiveCheck: true,
    skipPassengerConfirm: true,
    // Mark the ride as originating from the call-center so the dedicated
    // operator commission rate is used at payout time.
    source: 'operator',
  });
  await audit({
    adminId,
    action: 'create_phone_ride',
    targetType: 'ride',
    targetId: ride.id,
    after: {
      passengerPhone: body.passengerPhone,
      pickup: body.pickup.label,
      dropoff: body.isOpen ? '(course ouverte)' : body.dropoff?.label,
      isOpen: !!body.isOpen,
    },
  });
  res.json(ride);
});

/**
 * POST /admin/rides/:id/rebroadcast
 * Re-push the ride to currently-online, in-radius captains. Used when a
 * ride has been sitting in 'searching' and the passenger called back.
 */
adminRidesRouter.post('/:id/rebroadcast', async (req, res) => {
  const adminId = req.user!.id;
  const rideId = req.params.id!;
  const result = await rides.rebroadcastRide(rideId);
  await audit({
    adminId,
    action: 'rebroadcast_ride',
    targetType: 'ride',
    targetId: rideId,
    after: { captainsNotified: result.captainsNotified },
  });
  res.json(result);
});

/**
 * POST /admin/rides/:id/cancel
 * Admin override — cancel a ride from ANY non-terminal status.
 * Sets status='cancelled_by_system' and frees the assigned captain.
 */
const cancelBody = z.object({
  reason: z.string().min(1).max(500),
});

adminRidesRouter.post('/:id/cancel', async (req, res) => {
  const adminId = req.user!.id;
  const rideId = req.params.id!;
  const body = cancelBody.parse(req.body);
  const ride = await rides.adminCancelRide({ rideId, reason: body.reason });
  await audit({
    adminId,
    action: 'cancel_ride',
    targetType: 'ride',
    targetId: rideId,
    after: { reason: body.reason, status: ride.status },
  });
  res.json(ride);
});
