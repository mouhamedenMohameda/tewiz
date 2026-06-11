import { Router } from 'express';
import { z } from 'zod';
import { type AuthedRequest } from '../../middleware/auth.js';
import { audit } from '../admin/audit.js';
import * as rides from './rides.service.js';

// Parent (adminRouter) already enforces requireAuth + requireRole('admin').
export const adminRidesRouter = Router();

const locationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  label: z.string().min(1).max(200).optional(),
});

const createBody = z.object({
  pickup: locationSchema,
  dropoff: locationSchema,
  rideType: z.enum(['passenger', 'colis']).default('passenger'),
  paymentMethod: z.enum(['cash', 'wallet']).default('cash'),
  // Passenger reached the operator by phone — they don't have an app.
  // We reuse the "course pour quelqu'un d'autre" flow: an SMS confirmation
  // code is sent and the passenger confirms via /public/rides/:id/confirm.
  passengerName: z.string().min(2).max(100),
  passengerPhone: z.string().min(8).max(20),
});

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
 * GET /admin/rides/:id
 * Single-ride detail (any ride). Used by the post-create page so the operator
 * can watch the ride move through its lifecycle.
 */
adminRidesRouter.get('/:id', async (req, res) => {
  const adminId = (req as AuthedRequest).user.id;
  res.json(await rides.getRideForUser(req.params.id!, adminId, 'admin'));
});

/**
 * POST /admin/rides
 * Admin books a ride on behalf of a passenger who called by phone.
 * The admin becomes the booker; the passenger is identified by name+phone.
 * SMS confirmation is skipped (the passenger called us — they've consented).
 */
adminRidesRouter.post('/', async (req, res) => {
  const adminId = (req as AuthedRequest).user.id;
  const body = createBody.parse(req.body);
  const ride = await rides.createRide({
    bookerId: adminId,
    pickup: body.pickup,
    dropoff: body.dropoff,
    rideType: body.rideType,
    paymentMethod: body.paymentMethod,
    passengerName: body.passengerName,
    passengerPhone: body.passengerPhone,
    // The admin operator is booking on behalf of a passenger who called by
    // phone — they have already consented, so we go straight to "searching"
    // (visible by captains) without the return SMS confirmation step.
    skipBookerActiveCheck: true,
    skipPassengerConfirm: true,
  });
  await audit({
    adminId,
    action: 'create_phone_ride',
    targetType: 'ride',
    targetId: ride.id,
    after: {
      passengerPhone: body.passengerPhone,
      pickup: body.pickup.label,
      dropoff: body.dropoff.label,
    },
  });
  res.json(ride);
});
