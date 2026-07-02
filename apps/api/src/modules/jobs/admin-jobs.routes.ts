import { Router } from 'express';
import { z } from 'zod';
import * as docExpiry from './doc-expiry.service.js';
import * as heatmap from '../heatmap/heatmap.service.js';
import * as reports from '../reports/road-reports.service.js';
import * as recurring from '../recurring/recurring.service.js';
import * as goingHome from '../home/going-home.service.js';
import { scanPartnerEarnings } from '../partners/fraud.service.js';

// Parent: adminRouter (auth + role=admin)
export const adminJobsRouter = Router();

/**
 * Each endpoint is idempotent and safe to call frequently from cron.
 *
 * Suggested schedule:
 *   - process-recurring  every  5 min
 *   - compute-heatmap    every  5 min
 *   - expire-road-reports every 30 min
 *   - reap-going-home    every  5 min
 *   - expire-documents   every  1 day at 03:00 Africa/Nouakchott
 *   - partner-fraud-scan every 30 min
 */
adminJobsRouter.post('/process-recurring', async (_req, res) => {
  res.json(await recurring.processOccurrences());
});

adminJobsRouter.post('/compute-heatmap', async (_req, res) => {
  res.json(await heatmap.compute());
});

adminJobsRouter.post('/expire-road-reports', async (_req, res) => {
  res.json(await reports.expireOld());
});

adminJobsRouter.post('/reap-going-home', async (_req, res) => {
  await goingHome.reapStaleSessions();
  res.json({ ok: true });
});

adminJobsRouter.post('/expire-documents', async (_req, res) => {
  res.json(await docExpiry.expireDocumentsAndSuspendCaptains());
});

// Freeze suspicious partner earnings (pair recurrence, short rides, creation
// bursts) — thresholds in app_settings. Frozen lines surface in the admin
// fraud report (/admin/partners/earnings?status=on_hold).
adminJobsRouter.post('/partner-fraud-scan', async (_req, res) => {
  res.json(await scanPartnerEarnings());
});

const expiringQuery = z.object({ days: z.coerce.number().int().min(1).max(90).default(14) });
adminJobsRouter.get('/expiring-documents', async (req, res) => {
  const q = expiringQuery.parse(req.query);
  res.json(await docExpiry.listExpiringSoon(q.days));
});
