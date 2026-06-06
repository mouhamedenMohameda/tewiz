import { Router } from 'express';
import { pool } from '../../db/pool.js';
import { redis } from '../../db/redis.js';

export const healthRouter = Router();

healthRouter.get('/health', async (_req, res) => {
  const checks: Record<string, 'ok' | string> = {};

  try {
    const r = await pool.query('SELECT 1 AS ok');
    checks.postgres = r.rows[0]?.ok === 1 ? 'ok' : 'unexpected';
  } catch (e) {
    checks.postgres = (e as Error).message;
  }

  try {
    const pong = await redis.ping();
    checks.redis = pong === 'PONG' ? 'ok' : pong;
  } catch (e) {
    checks.redis = (e as Error).message;
  }

  // Verify PostGIS is loaded.
  try {
    const r = await pool.query("SELECT extname FROM pg_extension WHERE extname = 'postgis'");
    checks.postgis = r.rowCount === 1 ? 'ok' : 'missing';
  } catch (e) {
    checks.postgis = (e as Error).message;
  }

  const ok = Object.values(checks).every((v) => v === 'ok');
  res.status(ok ? 200 : 503).json({ ok, checks, time: new Date().toISOString() });
});
