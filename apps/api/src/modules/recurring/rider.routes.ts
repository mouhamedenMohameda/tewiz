import { Router } from 'express';
import { z } from 'zod';
import { type AuthedRequest } from '../../middleware/auth.js';
import * as svc from './recurring.service.js';

// Parent: riderRouter (auth + role=rider)
export const riderRecurringRouter = Router();

const proposeBody = z.object({
  pickup: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    label: z.string().min(1).max(200).optional(),
  }),
  dropoff: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    label: z.string().min(1).max(200).optional(),
  }),
  daysOfWeek: z.number().int().min(1).max(127),  // bitmap Mon-Sun
  timeOfDay: z.string().regex(/^\d{2}:\d{2}$/),
  validFrom: z.string().date(),
  validUntil: z.string().date().optional(),
});

riderRecurringRouter.get('/', async (req, res) => {
  const userId = (req as AuthedRequest).user.id;
  res.json(await svc.listMyRecurring(userId));
});

riderRecurringRouter.post('/', async (req, res) => {
  const userId = (req as AuthedRequest).user.id;
  const body = proposeBody.parse(req.body);
  res.json(await svc.proposeRecurring({ riderId: userId, ...body }));
});

riderRecurringRouter.post('/:id/cancel', async (req, res) => {
  const userId = (req as AuthedRequest).user.id;
  res.json(await svc.cancelByRider(req.params.id!, userId));
});
