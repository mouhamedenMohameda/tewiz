import { Router } from 'express';
import * as svc from './recurring.service.js';

// Parent: adminRouter (auth + role=admin)
export const adminRecurringRouter = Router();

/**
 * POST /admin/recurring/process
 * Schedule missing occurrences for the next 7 days, and dispatch ones due
 * within 30 min. Intended to be triggered by cron every 5 minutes.
 */
adminRecurringRouter.post('/process', async (_req, res) => {
  res.json(await svc.processOccurrences());
});
