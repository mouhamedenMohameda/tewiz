import { Router } from 'express';
import { z } from 'zod';
import * as docExpiry from './doc-expiry.service.js';
import * as heatmap from '../heatmap/heatmap.service.js';
import * as reports from '../reports/road-reports.service.js';
import * as recurring from '../recurring/recurring.service.js';
import * as goingHome from '../home/going-home.service.js';
import { scanPartnerEarnings } from '../partners/fraud.service.js';
import { reapTrackPartitions } from '../captain/track.service.js';
import { drawFreeDaysForAllCaptains } from '../rides/free-days.service.js';

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
 *   - reap-captain-track every  1 day at 03:30 Africa/Nouakchott
 *   - draw-free-days     every  1 day at 00:05 Africa/Nouakchott
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

// Off-ride track retention: ensure tomorrow's partition exists and DROP any
// daily partition older than the retention window. Suggested schedule: every
// 1 day at 03:30 Africa/Nouakchott.
adminJobsRouter.post('/reap-captain-track', async (_req, res) => {
  res.json(await reapTrackPartitions());
});

const expiringQuery = z.object({ days: z.coerce.number().int().min(1).max(90).default(14) });
adminJobsRouter.get('/expiring-documents', async (req, res) => {
  const q = expiringQuery.parse(req.query);
  res.json(await docExpiry.listExpiringSoon(q.days));
});

// Draw each active captain's commission-free days for the current ISO week
// (migration 0086) and push them the list. Idempotent — a week already drawn
// is never re-rolled — so a daily run is both safe and desirable: it also
// covers captains activated mid-week. Ride completion draws lazily as a
// fallback if this never runs.
adminJobsRouter.post('/draw-free-days', async (_req, res) => {
  res.json(await drawFreeDaysForAllCaptains());
});
