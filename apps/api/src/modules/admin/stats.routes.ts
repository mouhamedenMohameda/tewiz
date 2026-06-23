/**
 * Admin stats endpoints — operator/app split, acceptance rates and average
 * time-to-accept for the last 7 days.
 *
 * Why:
 *   The operator needs a quick way to gauge call-center activity vs self-served
 *   bookings without writing SQL: how many phone rides today, are they being
 *   accepted, how fast captains pick them up.
 *
 * Computation lives entirely in Postgres so the endpoint stays cheap and we
 * don't ship raw ride rows to the browser.
 */

import { Router } from 'express';
import { pool } from '../../db/pool.js';

export const adminStatsRouter = Router();

interface DayStatRow {
  day: Date;
  source: 'app' | 'operator';
  total: string;
  accepted: string;
  completed: string;
  auto_cancelled: string;
  avg_accept_s: string | null;
}

/**
 * GET /admin/stats/operator
 *
 * Returns one row per (day, source) for the last 7 days, plus a small summary.
 * Days with zero rides are NOT emitted — the UI can fill the gap if needed.
 */
adminStatsRouter.get('/operator', async (_req, res) => {
  const { rows } = await pool.query<DayStatRow>(
    `SELECT date_trunc('day', requested_at) AS day,
            source,
            COUNT(*)                                                  AS total,
            COUNT(*) FILTER (WHERE accepted_at IS NOT NULL)           AS accepted,
            COUNT(*) FILTER (WHERE status = 'completed')              AS completed,
            COUNT(*) FILTER (WHERE status = 'cancelled_by_system')    AS auto_cancelled,
            AVG(EXTRACT(EPOCH FROM (accepted_at - requested_at)))
              FILTER (WHERE accepted_at IS NOT NULL)                  AS avg_accept_s
       FROM rides
      WHERE requested_at >= now() - interval '7 days'
      GROUP BY 1, 2
      ORDER BY 1 DESC, 2`,
  );

  const days = rows.map((r) => ({
    day: r.day.toISOString().slice(0, 10),
    source: r.source,
    total: Number(r.total),
    accepted: Number(r.accepted),
    completed: Number(r.completed),
    autoCancelled: Number(r.auto_cancelled),
    avgAcceptSeconds: r.avg_accept_s === null ? null : Number(r.avg_accept_s),
  }));

  // Compact summary over the whole 7-day window.
  const sum = (pred: (d: typeof days[number]) => boolean, field: 'total' | 'accepted' | 'completed' | 'autoCancelled') =>
    days.filter(pred).reduce((acc, d) => acc + d[field], 0);

  const total = sum(() => true, 'total');
  const totalApp = sum((d) => d.source === 'app', 'total');
  const totalOperator = sum((d) => d.source === 'operator', 'total');
  const accepted = sum(() => true, 'accepted');
  const completed = sum(() => true, 'completed');
  const autoCancelled = sum(() => true, 'autoCancelled');

  // Weighted average accept time over the window.
  const acceptedWithTime = days.filter((d) => d.avgAcceptSeconds !== null);
  const weightedAvgAcceptS = acceptedWithTime.length === 0
    ? null
    : acceptedWithTime.reduce((acc, d) => acc + d.avgAcceptSeconds! * d.accepted, 0)
      / acceptedWithTime.reduce((acc, d) => acc + d.accepted, 0);

  res.json({
    summary: {
      windowDays: 7,
      total,
      totalApp,
      totalOperator,
      accepted,
      completed,
      autoCancelled,
      acceptanceRate: total === 0 ? 0 : accepted / total,
      avgAcceptSeconds: weightedAvgAcceptS,
    },
    days,
  });
});
