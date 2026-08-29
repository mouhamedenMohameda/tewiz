import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { env } from '../../config/env.js';
import { type AuthedRequest } from '../../middleware/auth.js';
import { HttpError } from '../../middleware/error.js';
import { getBalance } from '../wallet/wallet.service.js';
import * as goingHome from '../home/going-home.service.js';
import { ingestTrackBatch, isTrackingEnabled } from './track.service.js';
import { getOnboardingStatus } from './onboarding.service.js';
import { setLiveLocation, clearLiveLocation } from './live-location.js';

// Parent enforces auth + role=captain.
export const captainStateRouter = Router();

const onlineBody = z.object({
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});

/**
 * POST /captain/state/online
 * Goes online iff wallet balance >= MIN_BALANCE_TO_GO_ONLINE_MRU and not
 * already on a ride.
 */
captainStateRouter.post('/online', async (req, res) => {
  const userId = req.user!.id;
  const body = onlineBody.parse(req.body ?? {});

  // 1. Ensure captain row exists and is active.
  const captain = await pool.query<{ status: string }>(
    `SELECT status FROM captains WHERE user_id = $1`,
    [userId],
  );
  if (!captain.rows[0]) {
    throw new HttpError(404, 'not_captain', 'You are not an active captain');
  }
  if (captain.rows[0].status !== 'active') {
    throw new HttpError(403, 'captain_suspended',
      `Captain account is ${captain.rows[0].status}`);
  }

  // 2. Onboarding v3 : le captain est accepté sur son permis et sa carte grise,
  //    le reste (véhicule déclaré + vérifié, assurance, photo du véhicule) est
  //    exigé ici, avant la première course. C'est aussi ce qui fait revalider
  //    l'assurance à chaque échéance, au lieu d'un contrôle unique le jour de
  //    l'inscription.
  const onboarding = await getOnboardingStatus(userId);
  if (!onboarding.canGoOnline) {
    throw new HttpError(403, 'onboarding_incomplete',
      "Complétez votre profil Captain avant de passer en ligne.", {
        vehicleMissing: !onboarding.vehicle,
        vehicleUnverified: !!onboarding.vehicle && !onboarding.vehicle.verifiedAt,
        docs: onboarding.onlineGaps,
      });
  }

  // 3. Balance gate.
  const balance = await getBalance(userId);
  if (balance < env.MIN_BALANCE_TO_GO_ONLINE_MRU) {
    throw new HttpError(402, 'balance_too_low',
      `Solde insuffisant pour aller en ligne (min ${env.MIN_BALANCE_TO_GO_ONLINE_MRU} MRU, actuel ${balance} MRU)`,
      { balance, minRequired: env.MIN_BALANCE_TO_GO_ONLINE_MRU });
  }

  // 4. Already on a ride? Don't downgrade.
  const current = await pool.query<{ presence: string }>(
    `SELECT presence FROM captain_state WHERE captain_id = $1`,
    [userId],
  );
  if (current.rows[0]?.presence === 'on_ride') {
    throw new HttpError(409, 'on_ride', 'Vous êtes en course, ne peut pas changer manuellement');
  }

  // 5. Update state. When a fresh location is supplied we also stamp
  //    location_updated_at — the freshness signal dispatch trusts (see
  //    migration 0071). When it isn't, we keep the previous position and its
  //    freshness stamp untouched.
  const hasLoc = body.lat !== undefined && body.lng !== undefined;

  const sql = `
    INSERT INTO captain_state (captain_id, presence, location, location_updated_at, updated_at)
    VALUES ($1, 'online', ${hasLoc ? 'ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography' : 'NULL'}, ${hasLoc ? 'now()' : 'NULL'}, now())
    ON CONFLICT (captain_id) DO UPDATE
      SET presence = 'online',
          location = ${hasLoc ? 'EXCLUDED.location' : 'captain_state.location'},
          location_updated_at = ${hasLoc ? 'now()' : 'captain_state.location_updated_at'},
          updated_at = now()
    RETURNING captain_id, presence, updated_at,
              ST_Y(location::geometry) AS eff_lat,
              ST_X(location::geometry) AS eff_lng,
              EXTRACT(epoch FROM location_updated_at) * 1000 AS eff_seen_ms
  `;
  const params = hasLoc ? [userId, body.lng, body.lat] : [userId];

  const r = await pool.query(sql, params);

  // Dual write: Postgres stays the source of truth, Redis gets a mirror. Doing
  // both means rolling DISPATCH_GEO_SOURCE back to `postgres` needs no data
  // migration — captain_state was never allowed to go stale.
  //
  // Mirror the EFFECTIVE position the row now holds, not the request body. When
  // a captain goes online without sending coordinates, the UPSERT above keeps
  // their previous position and PostGIS still considers them eligible — but
  // going offline earlier removed them from the geo index. Mirroring only when
  // `hasLoc` left those captains invisible to `redis` mode until their first
  // track push, and produced a permanent stream of shadow-mode 'missing'
  // mismatches, which would have kept the counter from ever reaching zero and
  // blocked the promotion the whole rollout is built around.
  //
  // `eff_seen_ms` carries the row's real freshness stamp, so a re-seeded old
  // position stays as stale in Redis as it is in Postgres. A legacy row with a
  // location but no stamp is seeded as just-seen, matching both the PostGIS
  // guard (which treats NULL as fresh) and warmLiveLocations.
  const { eff_lat, eff_lng, eff_seen_ms, ...state } = r.rows[0] ?? {};
  if (eff_lat !== null && eff_lat !== undefined && eff_lng !== null && eff_lng !== undefined) {
    const lat = Number(eff_lat);
    const lng = Number(eff_lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      await setLiveLocation(
        userId, lat, lng,
        eff_seen_ms === null || eff_seen_ms === undefined ? Date.now() : Number(eff_seen_ms),
      );
    }
  }

  // Respond with the original shape: eff_* exist only to feed the mirror above
  // and must not leak into the client contract.
  res.json({ ...state, balanceMru: balance });
});

/**
 * POST /captain/state/offline
 */
captainStateRouter.post('/offline', async (req, res) => {
  const userId = req.user!.id;

  const current = await pool.query<{ presence: string }>(
    `SELECT presence FROM captain_state WHERE captain_id = $1`,
    [userId],
  );
  if (current.rows[0]?.presence === 'on_ride') {
    throw new HttpError(409, 'on_ride',
      'Cannot go offline while on a ride');
  }

  const r = await pool.query(
    `UPDATE captain_state
        SET presence = 'offline', updated_at = now()
      WHERE captain_id = $1
   RETURNING captain_id, presence, updated_at`,
    [userId],
  );
  if (!r.rows[0]) throw new HttpError(404, 'no_state', 'No state row');

  // Drop them from the live geo index. A GEO key has no per-member TTL, so
  // without this a captain who goes offline keeps sitting at their last
  // position and would still be picked by GEOSEARCH.
  await clearLiveLocation(userId);

  res.json(r.rows[0]);
});

/**
 * GET /captain/state
 */
captainStateRouter.get('/', async (req, res) => {
  const userId = req.user!.id;
  const r = await pool.query(
    `SELECT presence, updated_at,
            ST_X(location::geometry) AS lng,
            ST_Y(location::geometry) AS lat
       FROM captain_state WHERE captain_id = $1`,
    [userId],
  );
  if (!r.rows[0]) throw new HttpError(404, 'no_state', 'No state row');
  res.json(r.rows[0]);
});

/**
 * POST /captain/state/track
 * Batch of off-ride GPS breadcrumbs from the mobile background TaskManager
 * (Level B). Body: { points: [{ lat, lng, accuracyM?, speedMps?, recordedAt }] }.
 *
 * The captain app buffers points (~50 m / 30 s) and flushes them here. The
 * server drops noise (immobile / teleport / bad accuracy) and stores the rest
 * in the daily-partitioned `captain_track`. Also refreshes the live location
 * in `captain_state` so the back-office marker stays current between rides.
 *
 * Returns { stored } even when tracking is disabled (stored: 0) so the client
 * can quietly stop pushing without treating it as an error.
 */
const trackBody = z.object({
  points: z.array(z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    accuracyM: z.number().min(0).max(10_000).optional(),
    speedMps: z.number().min(-1).max(200).optional(),
    recordedAt: z.number().int().positive(),
  })).min(1).max(200),
});
captainStateRouter.post('/track', async (req, res) => {
  const userId = req.user!.id;

  if (!(await isTrackingEnabled())) {
    res.json({ stored: 0, disabled: true });
    return;
  }

  const body = trackBody.parse(req.body);
  const result = await ingestTrackBatch(userId, body.points);

  // Keep the live marker fresh from the most recent accepted-looking point
  // (the latest one in the batch), without downgrading an on_ride presence.
  const latest = body.points.reduce((a, b) => (b.recordedAt > a.recordedAt ? b : a));
  const marker = await pool.query(
    `UPDATE captain_state
        SET location            = ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
            location_updated_at = now(),
            updated_at          = now()
      WHERE captain_id = $1
        AND presence <> 'offline'`,
    [userId, latest.lng, latest.lat],
  );

  // Mirror to Redis only when the Postgres marker actually moved. The UPDATE
  // above is a no-op for an offline captain, and writing to the geo index
  // regardless would resurrect them as a dispatch candidate.
  if ((marker.rowCount ?? 0) > 0) {
    await setLiveLocation(userId, latest.lat, latest.lng);
  }

  res.json({ stored: result.accepted, dropped: result.dropped });
});

/**
 * POST /captain/state/track-permission
 * The captain app reports whether it holds the background ("Always") location
 * permission that off-ride tracking needs. Stored on captain_state so the
 * back-office can tell "declined" (never emits) apart from merely "not moving".
 * Body: { granted: boolean }.
 */
const trackPermBody = z.object({ granted: z.boolean() });
captainStateRouter.post('/track-permission', async (req, res) => {
  const userId = req.user!.id;
  const { granted } = trackPermBody.parse(req.body);
  await pool.query(
    `UPDATE captain_state
        SET track_perm = $2, track_perm_at = now()
      WHERE captain_id = $1`,
    [userId, granted ? 'granted' : 'denied'],
  );
  res.json({ ok: true, trackPerm: granted ? 'granted' : 'denied' });
});

/**
 * POST /captain/state/going-home
 * Start a going-home session. Rides bringing the captain closer to home will
 * be prioritized in the dispatch.
 */
captainStateRouter.post('/going-home', async (req, res) => {
  const userId = req.user!.id;
  res.json(await goingHome.startSession(userId));
});

// Dev-only: wipe all going-home history so the 24h cooldown can be retested.
captainStateRouter.delete('/going-home/reset', async (req, res) => {
  const userId = req.user!.id;
  await goingHome.resetSessions(userId);
  res.status(204).end();
});

/**
 * DELETE /captain/state/going-home
 * Cancel the active going-home session.
 */
captainStateRouter.delete('/going-home', async (req, res) => {
  const userId = req.user!.id;
  res.json(await goingHome.endSession({ captainId: userId, reason: 'cancelled' }));
});

/**
 * GET /captain/state/going-home
 * Return the active session (204 if none).
 */
captainStateRouter.get('/going-home', async (req, res) => {
  const userId = req.user!.id;
  const s = await goingHome.getActiveSession(userId);
  if (!s) {
    res.status(204).end();
    return;
  }
  res.json(s);
});
