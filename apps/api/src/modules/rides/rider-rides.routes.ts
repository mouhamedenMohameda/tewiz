import { Router } from 'express';
import { z } from 'zod';
import { type AuthedRequest } from '../../middleware/auth.js';
import { HttpError } from '../../middleware/error.js';
import * as rides from './rides.service.js';

// Parent (riderRouter) already enforces requireAuth + requireRole('rider').
export const riderRidesRouter = Router();

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
  // For "course pour quelqu'un d'autre"
  passengerName: z.string().min(2).max(100).optional(),
  passengerPhone: z.string().min(8).max(20).optional(),
  // For colis
  recipientName: z.string().min(2).max(100).optional(),
  recipientPhone: z.string().min(8).max(20).optional(),
  packageDescription: z.string().min(2).max(500).optional(),
});

/**
 * POST /rider/rides
 * Create a new ride request. Returns the ride with the verification code,
 * which the rider must read aloud to the captain before the ride starts.
 */
riderRidesRouter.post('/', async (req, res) => {
  const userId = (req as AuthedRequest).user.id;
  const body = createBody.parse(req.body);
  const ride = await rides.createRide({
    bookerId: userId,
    pickup: body.pickup,
    dropoff: body.dropoff,
    rideType: body.rideType,
    paymentMethod: body.paymentMethod,
    passengerName: body.passengerName,
    passengerPhone: body.passengerPhone,
    recipientName: body.recipientName,
    recipientPhone: body.recipientPhone,
    packageDescription: body.packageDescription,
  });
  res.json(ride);
});

riderRidesRouter.get('/current', async (req, res) => {
  const userId = (req as AuthedRequest).user.id;
  const ride = await rides.getCurrentRideForRider(userId);
  if (!ride) {
    res.status(204).end();
    return;
  }
  res.json(ride);
});

riderRidesRouter.get('/history', async (req, res) => {
  const userId = (req as AuthedRequest).user.id;
  res.json(await rides.listRiderHistory(userId, 30));
});

riderRidesRouter.get('/:id', async (req, res) => {
  const userId = (req as AuthedRequest).user.id;
  res.json(await rides.getRideForUser(req.params.id!, userId, 'rider'));
});

const cancelBody = z.object({ reason: z.string().min(2).max(500) });

riderRidesRouter.post('/:id/cancel', async (req, res) => {
  const userId = (req as AuthedRequest).user.id;
  const body = cancelBody.parse(req.body);
  res.json(await rides.cancelRide({
    rideId: req.params.id!,
    userId,
    role: 'rider',
    reason: body.reason,
  }));
});
