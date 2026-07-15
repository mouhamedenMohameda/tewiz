import { pool } from '../db/pool.js';

// Throttle: at most one UPDATE per user per HEARTBEAT_INTERVAL_MS.
// Kept in-memory because the worst case (process restart) is a single extra
// UPDATE per active user — negligible.
const HEARTBEAT_INTERVAL_MS = 60_000;
const lastBump = new Map<string, number>();

// Eviction: this Map is a pure throttle cache — the authoritative "last seen"
// value lives in users.last_seen_at, never here. So we can drop stale entries
// freely; the only cost of evicting an entry is one extra UPDATE if that user
// happens to come back. Without eviction the Map would keep one row per user
// ever seen and grow unbounded as the user base grows.
//
// We sweep at most once per SWEEP_INTERVAL_MS (opportunistically, from within
// bumpHeartbeat) and remove any entry not touched within STALE_TTL_MS. That
// bounds the Map to roughly the set of users active in the last STALE_TTL_MS,
// and keeps the O(n) sweep cost off the per-request hot path.
const STALE_TTL_MS = 10 * 60_000;
const SWEEP_INTERVAL_MS = 5 * 60_000;
let lastSweep = 0;

function sweepStaleEntries(now: number): void {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [userId, ts] of lastBump) {
    if (now - ts >= STALE_TTL_MS) lastBump.delete(userId);
  }
}

/**
 * Fire-and-forget bump of users.last_seen_at so the admin "online" view
 * reflects real activity (any authenticated API call), not just the last
 * login. Called from requireAuth after a token is successfully verified.
 *
 * The /admin/users endpoint computes `online` as
 * `last_seen_at > now() - interval '5 min'`.
 */
export function bumpHeartbeat(userId: string): void {
  const now = Date.now();
  sweepStaleEntries(now);
  const prev = lastBump.get(userId) ?? 0;
  if (now - prev < HEARTBEAT_INTERVAL_MS) return;
  lastBump.set(userId, now);
  pool
    .query('UPDATE users SET last_seen_at = now() WHERE id = $1', [userId])
    .catch(() => {
      // Roll the cache back so the next request retries the bump.
      lastBump.delete(userId);
    });
}

/**
 * Number of throttle entries currently held in memory. Exposed for tests
 * (to assert eviction bounds the cache) and as a cheap observability hook.
 */
export function heartbeatCacheSize(): number {
  return lastBump.size;
}
