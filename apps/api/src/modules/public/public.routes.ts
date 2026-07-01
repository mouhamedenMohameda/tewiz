import { Router } from 'express';
import { z } from 'zod';
import * as rides from '../rides/rides.service.js';
import { getPricingSettings } from '../admin/app-settings.service.js';

// Public — NO auth. Used by passengers who don't have an app, only an SMS.
export const publicRouter = Router();

/**
 * GET /public/config
 *
 * Minimal public config read by the mobile app on launch, before the user
 * authenticates. Currently only exposes feature flags that the welcome / login
 * screens need before any session exists.
 *
 * showDemoButtons — controlled via PUT /admin/settings { showDemoButtons: bool }.
 *   true  → show the one-tap reviewer demo-login buttons (set before a store review).
 *   false → hide them (set after the build is approved so real users never see them).
 * captainAlert* — captain alert intensity knobs controlled from the same
 *   admin settings screen.
 *
 * Values are cached server-side for 30 s (same TTL as app_settings). The
 * mobile app additionally caches in AsyncStorage so first paint is instant even
 * on a slow connection; the cached value is refreshed on every cold launch.
 */
publicRouter.get('/config', async (_req, res) => {
  const s = await getPricingSettings();
  res.json({
    showDemoButtons: s.showDemoButtons,
    captainAlertSoundMode: s.captainAlertSoundMode,
    captainAlertRepeatIntervalS: s.captainAlertRepeatIntervalS,
    captainAlertSoundUrl: s.captainAlertSoundUrl,
  });
});

/**
 * GET /public/captain-alert-sound
 *
 * Streams the currently configured captain alert sound through our own API
 * domain. This avoids iOS/ATS playback issues against some third-party hosts.
 */
publicRouter.get('/captain-alert-sound', async (_req, res) => {
  const s = await getPricingSettings();
  const url = s.captainAlertSoundUrl?.trim();
  if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
    return res.status(404).json({ error: { code: 'alert_sound_not_configured' } });
  }

  try {
    const upstream = await fetch(url, { redirect: 'follow' });
    if (!upstream.ok) {
      return res.status(502).json({ error: { code: 'alert_sound_upstream_error' } });
    }
    const contentType = upstream.headers.get('content-type') ?? 'audio/mpeg';
    const body = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('content-type', contentType);
    res.setHeader('cache-control', 'public, max-age=300');
    return res.status(200).send(body);
  } catch {
    return res.status(502).json({ error: { code: 'alert_sound_fetch_failed' } });
  }
});

const confirmBody = z.object({
  code: z.string().regex(/^\d{4}$/),
});

/**
 * POST /public/rides/:id/confirm
 * The passenger confirms a "course pour quelqu'un d'autre" using the 4-digit
 * code they received by SMS.
 */
publicRouter.post('/rides/:id/confirm', async (req, res) => {
  const body = confirmBody.parse(req.body);
  const ride = await rides.confirmPassengerRide({
    rideId: req.params.id!,
    code: body.code,
  });
  // Return minimal info — passenger has no account.
  res.json({
    id: ride.id,
    status: ride.status,
    pickup: ride.pickup,
    dropoff: ride.dropoff,
    fareEstimateMru: ride.fareEstimateMru,
  });
});
