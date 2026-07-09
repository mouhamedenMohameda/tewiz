import { Router } from 'express';
import { z } from 'zod';
import * as rides from '../rides/rides.service.js';
import { getPricingSettings } from '../admin/app-settings.service.js';
import { defaultStorage } from '../storage/local-disk.js';
import { StorageNotFoundError } from '../storage/storage.js';
import { env } from '../../config/env.js';

// Public — NO auth. Used by passengers who don't have an app, only an SMS.
export const publicRouter = Router();

// App versions allowed to see the reviewer demo-login buttons, parsed once at
// startup from DEMO_BUTTONS_ALLOWED_VERSIONS. The demo buttons are gated on
// BOTH the showDemoButtons master toggle AND the requesting app's version
// (sent in the X-App-Version header). Any build that doesn't send a matching
// version — including every already-shipped binary, which sends no header at
// all — is treated as not allowed, so enabling the toggle for a store review
// can never surface the buttons to real users on older versions.
const DEMO_BUTTON_VERSIONS: ReadonlySet<string> = new Set(
  env.DEMO_BUTTONS_ALLOWED_VERSIONS.split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0),
);

/**
 * GET /public/config
 *
 * Minimal public config read by the mobile app on launch, before the user
 * authenticates. Currently only exposes feature flags that the welcome / login
 * screens need before any session exists.
 *
 * showDemoButtons — controlled via PUT /admin/settings { showDemoButtons: bool }
 *   (the master toggle) AND gated on the requesting app's X-App-Version header:
 *   the flag is only ever returned `true` when the toggle is on AND the caller's
 *   version is in DEMO_BUTTONS_ALLOWED_VERSIONS. Older / already-shipped builds
 *   send no version header, so they always receive `false` — enabling the toggle
 *   for a store review cannot leak the buttons to real users on older versions.
 *   true  → show the one-tap reviewer demo-login buttons (set before a store review).
 *   false → hide them (set after the build is approved so real users never see them).
 * captainAlert* — captain alert intensity knobs controlled from the same
 *   admin settings screen.
 *
 * Values are cached server-side for 30 s (same TTL as app_settings). The
 * mobile app additionally caches in AsyncStorage so first paint is instant even
 * on a slow connection; the cached value is refreshed on every cold launch.
 */
publicRouter.get('/config', async (req, res) => {
  const s = await getPricingSettings();
  const appVersion = (req.get('x-app-version') ?? '').trim();
  const showDemoButtons = s.showDemoButtons && DEMO_BUTTON_VERSIONS.has(appVersion);
  // The response is version-dependent (it varies on X-App-Version). Tell any
  // intermediary (nginx/CDN/browser) never to cache it, and to key on the
  // version header if it ever does. Without this, a proxy could cache the
  // `false` served to a header-less request and hand it back to the 1.1.12
  // reviewer build — hiding the demo buttons and re-triggering Guideline 2.1.
  res.setHeader('Cache-Control', 'no-store');
  res.vary('X-App-Version'); // appends to the existing Vary (e.g. Origin from CORS)
  res.json({
    showDemoButtons,
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

/**
 * GET /public/restaurant-photos/:filename
 *
 * Publicly streams a restaurant photo uploaded from the back office. Photos
 * MUST be served without auth because they are shown to unauthenticated
 * customers in the mobile app (and in <img> tags that can't send a JWT). The
 * file lives under the same `restaurants/` storage prefix the admin upload
 * writes to.
 */
publicRouter.get('/restaurant-photos/:filename', async (req, res) => {
  const filename = req.params.filename ?? '';
  // Only allow the exact shape our upload endpoint produces (<uuid>.webp).
  if (!/^[a-zA-Z0-9._-]+\.webp$/.test(filename)) {
    return res.status(404).json({ error: { code: 'not_found' } });
  }
  try {
    const buf = await defaultStorage.get(`restaurants/${filename}`);
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    // Override helmet's default `same-origin` CORP so the admin-web browser
    // (a different origin than the API) can embed this photo in an <img>.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    return res.send(buf);
  } catch (e) {
    if (e instanceof StorageNotFoundError) {
      return res.status(404).json({ error: { code: 'not_found' } });
    }
    throw e;
  }
});

/**
 * GET /public/car-photos/:filename
 * Publicly streams a car-rental listing photo (same storage pattern as
 * restaurant photos; shown in the catalog to any user).
 */
publicRouter.get('/car-photos/:filename', async (req, res) => {
  const filename = req.params.filename ?? '';
  if (!/^[a-zA-Z0-9._-]+\.webp$/.test(filename)) {
    return res.status(404).json({ error: { code: 'not_found' } });
  }
  try {
    const buf = await defaultStorage.get(`cars/${filename}`);
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    return res.send(buf);
  } catch (e) {
    if (e instanceof StorageNotFoundError) {
      return res.status(404).json({ error: { code: 'not_found' } });
    }
    throw e;
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
