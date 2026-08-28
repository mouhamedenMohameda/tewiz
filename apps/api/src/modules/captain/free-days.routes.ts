/**
 * GET /captain/free-days — the captain's view of their commission-free days
 * for the current week (migration 0086).
 *
 * Read-only on purpose: opening the screen must never trigger a draw for a
 * week the captain may not end up working. The draw happens in the daily job,
 * or lazily on the first ride completed that week.
 *
 * Parent (captainRouter) already enforces requireAuth + requireRole('captain').
 */

import { Router } from 'express';
import { getCaptainFreeDays } from '../rides/free-days.service.js';

export const captainFreeDaysRouter = Router();

captainFreeDaysRouter.get('/', async (req, res) => {
  res.json(await getCaptainFreeDays(req.user!.id));
});
