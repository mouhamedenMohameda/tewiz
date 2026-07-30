/**
 * Prometheus scrape endpoint.
 *
 * Auth: `Authorization: Bearer $METRICS_TOKEN`. Deliberately NOT open, unlike
 * /health — the exposition includes per-zone demand, captain supply and wallet
 * state. That is a map of where Tewiz is strong and where it is failing to serve
 * riders, which is exactly what a competitor would want.
 *
 * When METRICS_TOKEN is empty the router does not answer at all (404, the same
 * response an unmounted path gives), so an unconfigured deployment leaks nothing
 * and does not advertise that the endpoint exists.
 */

import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env.js';
import { registry } from '../../lib/metrics.js';

export const metricsRouter: Router = Router();

/**
 * Constant-time comparison, so the endpoint cannot be used as an oracle to
 * recover the token byte by byte from response timing. `timingSafeEqual` throws
 * on length mismatch, hence the explicit length check first — that leaks only the
 * token's length, which is not secret.
 */
function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

metricsRouter.get('/metrics', async (req, res) => {
  if (!env.METRICS_TOKEN) {
    res.status(404).json({ error: { code: 'not_found', message: 'Not found' } });
    return;
  }

  const header = req.get('authorization') ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!provided || !tokenMatches(provided, env.METRICS_TOKEN)) {
    // No WWW-Authenticate header: this is a machine endpoint, and prompting a
    // browser for credentials only invites someone to try guessing them.
    res.status(401).json({ error: { code: 'unauthorized', message: 'Unauthorized' } });
    return;
  }

  res.set('Content-Type', registry.contentType);
  // Explicitly uncacheable — an intermediate cache serving a stale exposition
  // would make Prometheus compute rates from repeated identical samples.
  res.set('Cache-Control', 'no-store');
  res.send(await registry.metrics());
});
