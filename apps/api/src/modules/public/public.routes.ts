import { Router } from 'express';
import { z } from 'zod';
import * as rides from '../rides/rides.service.js';

// Public — NO auth. Used by passengers who don't have an app, only an SMS.
export const publicRouter = Router();

const confirmBody = z.object({
  code: z.string().regex(/^\d{4}$/),
});

/**
 * POST /public/rides/:id/confirm
 * The passenger confirms a "course pour quelqu'un d'autre" using the 4-digit
 * code they received by SMS.
 */
publicRouter.post('/rides/:id/confirm', async (req, res) => {
  const body = confirmBody.parse(req.body);
  const ride = await rides.confirmPassengerRide({
    rideId: req.params.id!,
    code: body.code,
  });
  // Return minimal info — passenger has no account.
  res.json({
    id: ride.id,
    status: ride.status,
    pickup: ride.pickup,
    dropoff: ride.dropoff,
    fareEstimateKhoums: ride.fareEstimateKhoums,
  });
});
