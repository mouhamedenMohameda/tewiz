import { pool } from '../db/pool.js';

// Throttle: at most one UPDATE per user per HEARTBEAT_INTERVAL_MS.
// Kept in-memory because the worst case (process restart) is a single extra
// UPDATE per active user — negligible.
const HEARTBEAT_INTERVAL_MS = 60_000;
const lastBump = new Map<string, number>();

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
