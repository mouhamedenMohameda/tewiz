import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { pinoHttp } from 'pino-http';
import pino from 'pino';
import { env } from './config/env.js';
import { healthRouter } from './modules/health/health.routes.js';
import { devRouter } from './modules/health/dev.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { captainRouter } from './modules/captain/captain.routes.js';
import { riderRouter } from './modules/rider/rider.routes.js';
import { adminRouter } from './modules/admin/admin.routes.js';
import { partnerRouter } from './modules/partners/partner.routes.js';
import { publicRouter } from './modules/public/public.routes.js';
import { roadReportsRouter } from './modules/reports/road-reports.routes.js';
import { geocodeRouter } from './modules/geocode/geocode.routes.js';
import { userNotificationsRouter } from './modules/notifications/user.routes.js';
import { startHeatmapCron } from './modules/heatmap/heatmap.service.js';
import { startRideExpiryCron } from './modules/rides/expiry.service.js';
import { carpoolingRouter } from './modules/carpooling/carpooling.routes.js';
import { startCarpoolingCron } from './modules/carpooling/carpooling.service.js';
import { listingsRouter } from './modules/listings/listings.routes.js';
import { startListingsCron } from './modules/listings/listings.service.js';
import { roadsideRouter } from './modules/roadside/roadside.routes.js';
import { startRoadsideCron } from './modules/roadside/roadside.service.js';
import { carRentalRouter } from './modules/car-rental/car-rental.routes.js';
import { convoyageRouter } from './modules/convoyage/convoyage.routes.js';
import { freightRouter } from './modules/freight/freight.routes.js';
import { errorHandler, notFound } from './middleware/error.js';

const logger = pino({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  transport:
    env.NODE_ENV === 'production'
      ? undefined
      : { target: 'pino-pretty', options: { colorize: true } },
});

const app = express();

// Behind nginx (which terminates TLS and reverse-proxies to 127.0.0.1), trust
// the first proxy hop so req.ip and express-rate-limit see the real client IP
// from X-Forwarded-For instead of 127.0.0.1.
app.set('trust proxy', 1);

app.use(helmet());

// --- Response compression (gzip) ---
// Native clients run on 2G/3G links across Mauritania, so shrinking JSON on the
// wire is the single biggest perceived-latency win. gzip cuts our list/inbox/
// history payloads by ~70–90%. `threshold` skips tiny bodies where the CPU cost
// isn't worth it; a client can opt out per-request with `x-no-compression`.
app.use(
  compression({
    threshold: 1024,
    filter(req, res) {
      if (req.headers['x-no-compression']) return false;
      return compression.filter(req, res);
    },
  }),
);

// --- CORS ---
// Lock the API to known browser origins (the admin-web). Native clients
// (mobile app, curl, server-to-server) send no Origin header and are allowed.
const allowedOrigins = env.CORS_ORIGINS.split(',')
  .map((o) => o.trim())
  .filter(Boolean);
if (allowedOrigins.length === 0) {
  logger.warn(
    'CORS_ORIGINS is empty — the API currently accepts requests from ANY ' +
      'origin. Set CORS_ORIGINS (comma-separated) in production to lock it down.',
  );
}
app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true); // non-browser client (mobile/curl)
      if (allowedOrigins.length === 0) return cb(null, true); // permissive fallback (see warning)
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error('Not allowed by CORS'));
    },
    credentials: true,
  }),
);

app.use(express.json({ limit: '1mb' }));
app.use(pinoHttp({ logger }));

// --- Rate limiting ---
// Tight limiter on credential endpoints. The per-phone DB throttle stops a
// targeted attack on ONE account; this stops an attacker spraying many phone
// numbers from a single IP. Deliberately scoped to /auth only — a global
// limiter would risk false 429s for mobile users behind carrier-grade NAT.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'rate_limited', message: 'Trop de requêtes, réessayez plus tard.' } },
});

// --- Public legal docs (privacy policy, terms) ---
// Required by the App Store and Google Play for the store listings.
// Served from the repo's docs/legal/ so there's a single source of truth
// for the HTML and it's covered by the same TLS cert as the API.
//
// Path is resolved relative to this source file so it survives any cwd
// (pm2 starts the process from /opt/tewiz/apps/api but tsx can be launched
// from anywhere). `../../../docs/legal` walks src → apps/api → apps → repo root.
const __dirname = dirname(fileURLToPath(import.meta.url));
const LEGAL_DIR = resolve(__dirname, '../../../docs/legal');
app.use(
  '/legal',
  express.static(LEGAL_DIR, {
    // Browsers and the App Store reviewer will follow /legal/privacy-policy
    // (no extension); resolve those to the .html file.
    extensions: ['html'],
    // 1h cache is enough — these docs change rarely but we want updates to
    // propagate within a working session, not stay pinned for a day.
    maxAge: '1h',
    // Force a 404 (handled below) instead of falling through to the SPA
    // notFound handler if someone probes /legal/secret.env.
    fallthrough: false,
  }),
);

app.use(healthRouter);
app.use('/dev', devRouter);
app.use('/auth', authLimiter, authRouter);
app.use('/public', publicRouter);
app.use('/captain', captainRouter);
app.use('/rider', riderRouter);
app.use('/admin', adminRouter);
// Partner dashboard (agencies / restaurants / individual members) — the
// near-real-time earnings view that keeps the program dispute-free.
app.use('/partner', partnerRouter);
// Shared by riders and captains
app.use('/road-reports', roadReportsRouter);
// Shared geocoding proxy (auth required) — used by rider app and admin web
app.use('/geocode', geocodeRouter);
// User inbox for notifications (any signed-in user can read their own).
app.use('/notifications', userNotificationsRouter);
app.use('/carpooling', carpoolingRouter);
app.use('/listings', listingsRouter);
app.use('/roadside', roadsideRouter);
app.use('/car-rental', carRentalRouter);
app.use('/convoyage', convoyageRouter);
app.use('/freight', freightRouter);

app.use(notFound);
app.use(errorHandler);

// Bind to loopback only — nginx terminates TLS on tewiz-api.radar-mr.com
// and reverse-proxies to 127.0.0.1, so the port should never be exposed.
app.listen(env.PORT, '127.0.0.1', () => {
  logger.info(`Tewiz API listening on http://127.0.0.1:${env.PORT}`);
  logger.info(`Health: http://127.0.0.1:${env.PORT}/health`);
  // Recompute the demand heatmap every 5 min so captains always see fresh data.
  startHeatmapCron();
  // Auto-cancel rides that no captain accepted within the configured timeout.
  startRideExpiryCron();
  // Expire old trips + send 2h reminders for inter-city carpooling.
  startCarpoolingCron();
  // Expire service listings ("annonces") past their visibility window.
  startListingsCron();
  // Expand roadside SOS search radius + fall back to the hotline on timeout.
  startRoadsideCron();
});
