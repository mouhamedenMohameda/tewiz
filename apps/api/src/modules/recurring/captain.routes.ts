import { Router } from 'express';
import { type AuthedRequest } from '../../middleware/auth.js';
import * as svc from './recurring.service.js';

// Parent: captainRouter (auth + role=captain)
export const captainRecurringRouter = Router();

captainRecurringRouter.get('/', async (req, res) => {
  const userId = (req as AuthedRequest).user.id;
  res.json(await svc.listForCaptain(userId));
});

captainRecurringRouter.post('/:id/accept', async (req, res) => {
  const userId = (req as AuthedRequest).user.id;
  res.json(await svc.acceptByCaptain(req.params.id!, userId));
});
