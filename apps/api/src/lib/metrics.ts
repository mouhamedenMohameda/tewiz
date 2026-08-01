/**
 * Marketplace metrics, in Prometheus format.
 *
 * Why this file exists:
 *   The API already logs slow requests and slow queries, which tells us when the
 *   SERVER is unhealthy. It says nothing about whether the MARKETPLACE is
 *   healthy — and that is the number that decides whether Tewiz works: what
 *   share of ride requests find a captain, how long that takes, and where it
 *   fails. Without it we are tuning DISPATCH_RADIUS_M, DISPATCH_TOP_N and the
 *   searching timeout by intuition.
 *
 * Two kinds of metric here, on purpose:
 *
 *   1. COUNTERS / HISTOGRAMS, incremented in-process at the moment something
 *      happens. Cheap and exact, but they reset when pm2 restarts. That is fine:
 *      Prometheus detects counter resets and rate() stays correct across them.
 *
 *   2. GAUGES, refreshed from SQL every METRICS_REFRESH_MS. These are the ones
 *      that must survive a restart and must agree with the admin dashboard,
 *      because they are computed from the same rows: fill rate, p50/p95
 *      time-to-match, per-zone demand. An in-process histogram could not answer
 *      "what was the fill rate last hour" after a deploy; a SQL gauge can.
 *
 * Cardinality discipline (the way naive metrics take a server down):
 *   - No ride id, user id, phone number or captain id ever becomes a label.
 *   - HTTP routes are labelled with the Express ROUTE PATTERN (/rides/:id), never
 *     the concrete path (/rides/9f3c…), or every ride would create a time series.
 *   - Per-zone gauges use H3 resolution 7 (~5 km² cells, ~200 over Greater
 *     Nouakchott), not the resolution 9 the heatmap uses (~170 m, thousands of
 *     cells). Zone gauges are also cleared on every refresh so a cell that goes
 *     quiet disappears instead of pinning a stale value forever.
 *   - No `hour` label: Prometheus already stores a time series, so "by hour" is a
 *     query concern. Adding an hour label would multiply every series by 24 and
 *     answer nothing new.
 */

import {
  Registry,
  collectDefaultMetrics,
  Counter,
  Histogram,
  Gauge,
} from 'prom-client';
import { latLngToCell } from 'h3-js';
import { pool } from '../db/pool.js';
import { logger } from './logger.js';

export const registry = new Registry();

registry.setDefaultLabels({ service: 'tewiz-api' });

// Event-loop lag, heap, GC, open handles. On a single 1-box deployment where the
// API shares a CPU with Postgres and Redis, event-loop lag is the earliest signal
// that the box is oversubscribed.
collectDefaultMetrics({ register: registry, prefix: 'tewiz_' });

/** H3 resolution used for the per-zone gauges. See the cardinality note above. */
const ZONE_RESOLUTION = 7;

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

export const httpRequestDuration = new Histogram({
  name: 'tewiz_http_request_duration_seconds',
  help: 'HTTP request duration by route pattern',
  labelNames: ['method', 'route', 'status'] as const,
  // Buckets chosen for 2G/3G Mauritanian clients, not for a datacentre: the
  // interesting thresholds are "feels instant" (0.1), "noticeable" (0.5),
  // "the captain thinks the app froze" (3), "the client already timed out" (10).
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 3, 5, 10],
  registers: [registry],
});

// ---------------------------------------------------------------------------
// Marketplace events
// ---------------------------------------------------------------------------

export const ridesRequested = new Counter({
  name: 'tewiz_rides_requested_total',
  help: 'Rides created, by type and source',
  labelNames: ['ride_type', 'source'] as const,
  registers: [registry],
});

export const ridesAccepted = new Counter({
  name: 'tewiz_rides_accepted_total',
  help: 'Rides accepted by a captain, by type',
  labelNames: ['ride_type'] as const,
  registers: [registry],
});

export const ridesExpiredNoCaptain = new Counter({
  name: 'tewiz_rides_expired_no_captain_total',
  help: 'Rides auto-cancelled because no captain accepted before the timeout',
  registers: [registry],
});

export const rideAcceptRejected = new Counter({
  name: 'tewiz_ride_accept_rejected_total',
  help: 'Accept taps refused by the server, by reason',
  // These reasons are a fixed, small set defined in acceptRide() — safe as a
  // label. 'balance_too_low' rising is a business problem (captains cannot
  // afford to work); 'not_searching' rising is a dispatch problem (too many
  // captains racing for the same ride).
  labelNames: ['reason'] as const,
  registers: [registry],
});

export const timeToMatch = new Histogram({
  name: 'tewiz_time_to_match_seconds',
  help: 'Seconds between ride request and captain acceptance',
  labelNames: ['ride_type'] as const,
  // A rider staring at a spinner gives up somewhere around a minute. Fine
  // resolution below 60s, coarse above, because past 120s the only question is
  // "did it ever match".
  buckets: [5, 10, 15, 20, 30, 45, 60, 90, 120, 300],
  registers: [registry],
});

export const dispatchInboxDuration = new Histogram({
  name: 'tewiz_dispatch_inbox_duration_seconds',
  help: 'Duration of the captain inbox dispatch query',
  // This is the hottest query in the system: every online captain runs it on a
  // poll loop, and it does PostGIS distance work against every searching ride.
  // When this degrades, dispatch degrades for everyone at once.
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2],
  registers: [registry],
});

export const pushTickets = new Counter({
  name: 'tewiz_push_tickets_total',
  help: 'Expo push tickets by outcome — one per device, not per ride',
  // The blind spot this closes: a 200 from Expo only means the REQUEST was
  // accepted. Each device gets its own ticket, and a ticket can fail on its own.
  // Production logs were full of `InvalidCredentials` — Android push had been
  // dead in every build because google-services.json never reached the EAS
  // builder — and nothing counted it, so nobody knew.
  //
  // 'status' is mapped to a closed set (see PUSH_TICKET_STATUSES): Expo's error
  // codes are few, but `ticket.message` is free text and would be unbounded.
  labelNames: ['status'] as const,
  registers: [registry],
});

export const dispatchEligibleDuration = new Histogram({
  name: 'tewiz_dispatch_eligible_duration_seconds',
  help: 'Duration of captain selection for a new ride, by geo source',
  // THE metric for the Redis migration. tewiz_dispatch_inbox_duration_seconds
  // measures captainInbox, which scans `rides` and never touched captain_state —
  // it cannot show this change at all. This one covers eligibleCaptainsForRide,
  // the query that actually moved.
  //
  // Labelled by source so `postgres` and `redis` are directly comparable on one
  // graph, and so the shadow window (which runs both, and is therefore expected
  // to be the slowest) is not mistaken for a regression.
  labelNames: ['source'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2],
  registers: [registry],
});

export const redisGeosearchDuration = new Histogram({
  name: 'tewiz_redis_geosearch_duration_seconds',
  help: 'Duration of the Redis GEOSEARCH used to find nearby captains',
  // This is the half of captain selection we moved out of PostGIS. Buckets sit
  // an order of magnitude below the inbox histogram on purpose: if these two
  // ever overlap, the move stopped paying for itself and we should know.
  buckets: [0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1],
  registers: [registry],
});

export const dispatchGeoFallback = new Counter({
  name: 'tewiz_dispatch_geo_fallback_total',
  help: 'Times captain selection fell back to PostGIS instead of using the geo index, by reason',
  // Dispatch must never stop because Redis is down, but a silent fallback is how
  // you end up running on the slow path for a month without noticing. This is
  // the metric that makes the degradation loud.
  //
  // The reason label exists because the unlabelled version conflated two very
  // different events on the first shadow ride in production: it read as "Redis
  // failed" when the cause could equally have been a ride with no pickup point,
  // which is not a Redis problem at all. A fallback counter you cannot act on is
  // only marginally better than no counter.
  //   redis_error → GEOSEARCH/ZMSCORE threw; the geo index is degraded
  //   no_pickup   → the ride has no pickup_location, so there is nothing to
  //                 search around; PostGIS would find nobody either
  labelNames: ['reason'] as const,
  registers: [registry],
});

export const dispatchGeoMismatch = new Counter({
  name: 'tewiz_dispatch_geo_mismatch_total',
  help: 'Rides where the Redis and PostGIS candidate sets disagreed (shadow mode)',
  // 'missing'  → PostGIS found a captain Redis did not (the dangerous direction:
  //              in redis mode that captain would never have been notified)
  // 'extra'    → Redis found one PostGIS did not (harmless but worth watching)
  labelNames: ['direction'] as const,
  registers: [registry],
});

// ---------------------------------------------------------------------------
// SQL-derived gauges
// ---------------------------------------------------------------------------

const ridesSearchingNow = new Gauge({
  name: 'tewiz_rides_searching_now',
  help: 'Rides currently in status=searching',
  registers: [registry],
});

const captainsOnlineNow = new Gauge({
  name: 'tewiz_captains_online_now',
  help: 'Captains with presence online/on_ride',
  labelNames: ['presence'] as const,
  registers: [registry],
});

const captainsOnlineStaleLocation = new Gauge({
  name: 'tewiz_captains_online_stale_location',
  help:
    'Online captains whose last location fix is older than DISPATCH_MAX_LOCATION_AGE_S, ' +
    'i.e. old enough that dispatch skips them when freshness is enforced',
  registers: [registry],
});

const dispatchMaxLocationAgeSeconds = new Gauge({
  name: 'tewiz_dispatch_max_location_age_seconds',
  help: 'The DISPATCH_MAX_LOCATION_AGE_S threshold the stale-location gauge is measured against',
  registers: [registry],
});

const dispatchFreshnessEnforced = new Gauge({
  name: 'tewiz_dispatch_location_freshness_enforced',
  help:
    '1 when dispatch actually applies the stale-location guard (app_settings.track_offline_enabled), ' +
    '0 when it is disabled and no captain is skipped for a stale fix',
  registers: [registry],
});

const fillRate1h = new Gauge({
  name: 'tewiz_fill_rate_1h',
  help: 'Share of rides requested in the last hour that a captain accepted (0-1)',
  registers: [registry],
});

const noCaptainRate1h = new Gauge({
  name: 'tewiz_no_captain_rate_1h',
  help: 'Share of rides requested in the last hour cancelled for no_captain_accepted (0-1)',
  registers: [registry],
});

const timeToMatchQuantile1h = new Gauge({
  name: 'tewiz_time_to_match_seconds_1h',
  help: 'Time-to-match quantiles over the last hour, computed in SQL',
  labelNames: ['quantile'] as const,
  registers: [registry],
});

const zoneRequests1h = new Gauge({
  name: 'tewiz_zone_rides_requested_1h',
  help: 'Rides requested in the last hour, by H3 res-7 pickup cell',
  labelNames: ['h3'] as const,
  registers: [registry],
});

const zoneUnfilled1h = new Gauge({
  name: 'tewiz_zone_rides_unfilled_1h',
  help: 'Rides requested in the last hour that never got a captain, by H3 res-7 pickup cell',
  labelNames: ['h3'] as const,
  registers: [registry],
});

const captainsBlockedLowBalance = new Gauge({
  name: 'tewiz_captains_blocked_low_balance',
  help: 'Captains whose wallet is below the go-online threshold',
  registers: [registry],
});

const walletLedgerDrift = new Gauge({
  name: 'tewiz_wallet_ledger_drift_rows',
  help: 'Wallets whose balance disagrees with the sum of their transactions (must stay 0)',
  registers: [registry],
});

const dbBackupAgeSeconds = new Gauge({
  name: 'tewiz_db_backup_age_seconds',
  help: 'Age of the newest local Postgres dump, in seconds (-1 when none is found)',
  registers: [registry],
});

const walArchiveSegments = new Gauge({
  name: 'tewiz_wal_archive_segments',
  help:
    'WAL segments present in the local archive dir. NOT a backlog: ship-wal.sh keeps ' +
    'already-shipped segments for WAL_KEEP_DAYS, so this climbs into the thousands ' +
    'in normal operation. Use tewiz_wal_last_ship_age_seconds to detect a stuck shipper.',
  registers: [registry],
});

const walLastShipAgeSeconds = new Gauge({
  name: 'tewiz_wal_last_ship_age_seconds',
  help: 'Seconds since ship-wal.sh last succeeded (-1 when it never has)',
  // The real health signal for off-site WAL shipping, and the one to alert on.
  // The first version alerted on tewiz_wal_archive_segments > 200 instead, and
  // fired 30 hours in on a perfectly healthy system: that directory retains
  // WAL_KEEP_DAYS of shipped segments, so its size measures retention, not
  // backlog. This mirrors tewiz_db_backup_age_seconds, which works because an
  // age cannot be confused with a healthy accumulation.
  registers: [registry],
});

const metricsRefreshDuration = new Gauge({
  name: 'tewiz_metrics_refresh_duration_seconds',
  help: 'Duration of the last SQL gauge refresh',
  registers: [registry],
});

const metricsRefreshFailures = new Counter({
  name: 'tewiz_metrics_refresh_failures_total',
  help: 'SQL gauge refresh ticks that threw',
  registers: [registry],
});

// ---------------------------------------------------------------------------
// Refresh
// ---------------------------------------------------------------------------

/**
 * Recompute every SQL-derived gauge. Exported so a test can call it directly
 * without waiting on a timer.
 *
 * All statements are read-only and scoped to a 1-hour window. They run on the
 * shared pool, on the same box as everything else — hence one pass every
 * METRICS_REFRESH_MS (default 30s) rather than computing on each /metrics
 * scrape, which would let an aggressive scraper add load to dispatch.
 */
export async function refreshSqlGauges(): Promise<void> {
  const started = process.hrtime.bigint();

  // --- Live counts ---------------------------------------------------------
  // The staleness threshold MUST be the one dispatch itself uses
  // (DISPATCH_MAX_LOCATION_AGE_S, default 900s), not a number of our own. The
  // whole point of this gauge is the gap between advertised and USABLE supply,
  // and "usable" is defined by the guard in dispatch.service.eligibleCaptainsForRide.
  // Measuring at a tighter threshold reports ghosts that dispatch is perfectly
  // happy to use — which is exactly how a monitoring system trains people to
  // ignore it.
  const maxLocationAgeS = Number(process.env.DISPATCH_MAX_LOCATION_AGE_S ?? 900);
  dispatchMaxLocationAgeSeconds.set(maxLocationAgeS);

  const live = await pool.query<{
    searching: string;
    online: string;
    on_ride: string;
    stale_location: string;
    freshness_enforced: boolean;
  }>(
    `SELECT
       (SELECT count(*) FROM rides WHERE status = 'searching')            AS searching,
       (SELECT count(*) FROM captain_state WHERE presence = 'online')     AS online,
       (SELECT count(*) FROM captain_state WHERE presence = 'on_ride')    AS on_ride,
       (SELECT count(*) FROM captain_state
          WHERE presence IN ('online','on_ride')
            AND (location_updated_at IS NULL
                 OR location_updated_at < now() - make_interval(secs => $1))) AS stale_location,
       -- Read straight from the table rather than importing the settings service,
       -- to keep this module free of domain imports (rides and dispatch already
       -- import IT, so any import back would risk a cycle).
       COALESCE((SELECT track_offline_enabled FROM app_settings LIMIT 1), false)
                                                                          AS freshness_enforced`,
    [maxLocationAgeS],
  );
  // A scalar-aggregate SELECT always returns exactly one row, but the pg types
  // cannot know that — assert rather than silently skipping the update, since a
  // gauge that quietly stops being written looks identical to a healthy zero.
  const l = live.rows[0]!;
  ridesSearchingNow.set(Number(l.searching));
  captainsOnlineNow.set({ presence: 'online' }, Number(l.online));
  captainsOnlineNow.set({ presence: 'on_ride' }, Number(l.on_ride));
  // A captain who is "online" but whose stored fix is older than the dispatch
  // threshold is invisible to push dispatch in practice. This gauge is the gap
  // between advertised and usable supply — but read it together with
  // tewiz_dispatch_location_freshness_enforced: when that is 0, dispatch applies
  // no freshness guard at all and nobody is actually skipped.
  captainsOnlineStaleLocation.set(Number(l.stale_location));
  dispatchFreshnessEnforced.set(l.freshness_enforced ? 1 : 0);

  // --- Fill rate + quantiles over the last hour ----------------------------
  // `accepted_at IS NOT NULL` is the definition of matched: it is stamped once,
  // when a captain wins the race in acceptRide().
  const window = await pool.query<{
    requested: string;
    matched: string;
    no_captain: string;
    p50: string | null;
    p95: string | null;
  }>(
    `WITH w AS (
       SELECT accepted_at, requested_at, status, cancel_reason
         FROM rides
        WHERE requested_at > now() - interval '1 hour'
     )
     SELECT count(*)                                              AS requested,
            count(*) FILTER (WHERE accepted_at IS NOT NULL)        AS matched,
            count(*) FILTER (WHERE status = 'cancelled_by_system'
                               AND cancel_reason = 'no_captain_accepted') AS no_captain,
            percentile_disc(0.5) WITHIN GROUP (
              ORDER BY extract(epoch FROM (accepted_at - requested_at))
            ) FILTER (WHERE accepted_at IS NOT NULL)               AS p50,
            percentile_disc(0.95) WITHIN GROUP (
              ORDER BY extract(epoch FROM (accepted_at - requested_at))
            ) FILTER (WHERE accepted_at IS NOT NULL)               AS p95
       FROM w`,
  );
  const w = window.rows[0]!;
  const requested = Number(w.requested);
  // With no rides in the window a rate is undefined, not zero. Reporting 0 would
  // fire "fill rate collapsed" alerts every night at 4am. Report 1 (nothing
  // failed) and let the requested-count series carry the "no traffic" signal.
  fillRate1h.set(requested === 0 ? 1 : Number(w.matched) / requested);
  noCaptainRate1h.set(requested === 0 ? 0 : Number(w.no_captain) / requested);
  if (w.p50 !== null) timeToMatchQuantile1h.set({ quantile: '0.5' }, Number(w.p50));
  if (w.p95 !== null) timeToMatchQuantile1h.set({ quantile: '0.95' }, Number(w.p95));

  // --- Per-zone demand and failure ----------------------------------------
  // Aggregating in JS rather than SQL because H3 indexing lives in h3-js (the
  // database has PostGIS but no H3 extension) — the same approach heatmap.service
  // already takes. One hour of pickups is a small result set.
  const pickups = await pool.query<{ lat: number; lng: number; unfilled: boolean }>(
    `SELECT ST_Y(pickup_location::geometry) AS lat,
            ST_X(pickup_location::geometry) AS lng,
            (accepted_at IS NULL
             AND status IN ('cancelled_by_system','searching')) AS unfilled
       FROM rides
      WHERE requested_at > now() - interval '1 hour'
        AND pickup_location IS NOT NULL`,
  );
  const perZone = new Map<string, { total: number; unfilled: number }>();
  for (const row of pickups.rows) {
    const cell = latLngToCell(Number(row.lat), Number(row.lng), ZONE_RESOLUTION);
    const acc = perZone.get(cell) ?? { total: 0, unfilled: 0 };
    acc.total += 1;
    if (row.unfilled) acc.unfilled += 1;
    perZone.set(cell, acc);
  }
  // Reset before re-setting: a cell with no rides this hour must vanish from the
  // exposition, not keep reporting last hour's value forever.
  zoneRequests1h.reset();
  zoneUnfilled1h.reset();
  for (const [cell, v] of perZone) {
    zoneRequests1h.set({ h3: cell }, v.total);
    zoneUnfilled1h.set({ h3: cell }, v.unfilled);
  }

  // --- Money --------------------------------------------------------------
  // Column names are post-0017 (balance_mru / amount_mru), and both wallet tables
  // key on captain_id. See db/migrations/0017_money_in_mru.sql — README.md still
  // describes the older khoums storage.
  const money = await pool.query<{ blocked: string; drift: string }>(
    `SELECT
       (SELECT count(*) FROM wallets WHERE balance_mru < $1) AS blocked,
       (SELECT count(*)
          FROM wallets w
          LEFT JOIN (
            SELECT captain_id, COALESCE(sum(amount_mru), 0) AS s
              FROM wallet_transactions GROUP BY captain_id
          ) t ON t.captain_id = w.captain_id
         WHERE w.balance_mru <> COALESCE(t.s, 0))            AS drift`,
    [minBalanceToGoOnline()],
  );
  const m = money.rows[0]!;
  captainsBlockedLowBalance.set(Number(m.blocked));
  // Should be identically 0: trg_wallet_balance_consistency enforces it on every
  // write. Alert on `> 0` — a single non-zero sample means the ledger and the
  // balances disagree, which is money owed to captains being wrong.
  walletLedgerDrift.set(Number(m.drift));

  await refreshBackupGauges();

  metricsRefreshDuration.set(Number(process.hrtime.bigint() - started) / 1e9);
}

/**
 * Surface the state of the backup system as metrics, so the four manual checks in
 * docs/runbook-backup-restore.md become Grafana alerts instead of a weekly chore
 * somebody forgets.
 *
 * Reads the filesystem rather than a database table because that IS the artefact
 * we care about: a row saying "backup succeeded" is worth nothing if the file is
 * not on disk. The API runs on the same box as Postgres and the archive dirs, so
 * this is a local stat, not a network call.
 *
 * Never throws: a missing directory reports -1 / 0, which is exactly the "no
 * backups here" signal you want to alert on, and must not take the whole refresh
 * down with it.
 */
async function refreshBackupGauges(): Promise<void> {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');

  const backupDir = process.env.BACKUP_DIR ?? '/var/backups/tewiz-db';
  try {
    const files = (await fs.readdir(backupDir)).filter(
      (f) => f.startsWith('tewiz-') && f.endsWith('.dump'),
    );
    let newest = 0;
    for (const f of files) {
      const st = await fs.stat(path.join(backupDir, f));
      if (st.mtimeMs > newest) newest = st.mtimeMs;
    }
    // -1, not 0: a 0 would read as "a backup was taken this very second", the
    // most reassuring possible value for the most alarming possible state.
    dbBackupAgeSeconds.set(newest === 0 ? -1 : Math.round((Date.now() - newest) / 1000));
  } catch {
    dbBackupAgeSeconds.set(-1);
  }

  const walDir = process.env.WAL_ARCHIVE_DIR ?? '/var/backups/tewiz-wal';
  try {
    const segments = (await fs.readdir(walDir)).filter((f) => f.endsWith('.gz'));
    // Informational only. This number reflects WAL_KEEP_DAYS of retention far
    // more than it reflects any backlog — see the gauge's help text.
    walArchiveSegments.set(segments.length);
  } catch {
    walArchiveSegments.set(0);
  }

  try {
    const st = await fs.stat(path.join(walDir, '.last-ship'));
    walLastShipAgeSeconds.set(Math.round((Date.now() - st.mtimeMs) / 1000));
  } catch {
    // -1, not 0: a 0 would read as "shipped this very second", the most
    // reassuring value for the state where shipping has never worked at all.
    walLastShipAgeSeconds.set(-1);
  }
}

/**
 * Read lazily rather than at import time so tests can construct the module
 * without a fully-populated environment.
 */
function minBalanceToGoOnline(): number {
  return Number(process.env.MIN_BALANCE_TO_GO_ONLINE_MRU ?? -10);
}

let refreshTimer: ReturnType<typeof setInterval> | null = null;

export function startMetricsRefresh(intervalMs: number): void {
  if (refreshTimer) return;
  const tick = async () => {
    try {
      await refreshSqlGauges();
    } catch (err) {
      // Metrics must never take the API down. A failing refresh shows up as a
      // rising tewiz_metrics_refresh_failures_total and as gauges going stale —
      // both visible in Grafana, neither fatal here.
      metricsRefreshFailures.inc();
      logger.warn({ err }, 'metrics refresh failed');
    }
  };
  // Delay the first pass so it does not compete with startup work.
  setTimeout(tick, 5_000);
  refreshTimer = setInterval(tick, intervalMs);
  refreshTimer.unref();
}

export function stopMetricsRefresh(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Helpers used by the domain code
// ---------------------------------------------------------------------------

/**
 * Record a match. Called from acceptRide once the transaction has committed, so
 * a rolled-back accept never inflates the numbers.
 */
export function recordMatch(rideType: string, requestedAt: Date | string | null): void {
  ridesAccepted.inc({ ride_type: rideType });
  if (!requestedAt) return;
  const seconds = (Date.now() - new Date(requestedAt).getTime()) / 1000;
  // Guard against a clock skew or a bad row producing a negative observation,
  // which would silently corrupt the histogram's sum.
  if (Number.isFinite(seconds) && seconds >= 0) {
    timeToMatch.observe({ ride_type: rideType }, seconds);
  }
}

/**
 * Express middleware recording request duration against the ROUTE PATTERN.
 *
 * Must be registered before the routers so `res.on('finish')` fires after Express
 * has resolved `req.route`. Requests that match no route are bucketed under
 * 'unmatched' rather than their raw path — otherwise a scanner probing random
 * URLs would create one time series per probe.
 */
export function metricsMiddleware(): (
  req: import('express').Request,
  res: import('express').Response,
  next: import('express').NextFunction,
) => void {
  return (req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      const pattern = req.route?.path
        ? `${req.baseUrl ?? ''}${req.route.path}`
        : 'unmatched';
      httpRequestDuration.observe(
        { method: req.method, route: pattern, status: String(res.statusCode) },
        seconds,
      );
    });
    next();
  };
}
