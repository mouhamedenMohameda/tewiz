import crypto from 'node:crypto';
import { redis } from '../db/redis.js';
import { logger } from './logger.js';

/**
 * A best-effort mutex shared by every API process.
 *
 * Why this exists: `index.ts` starts seven crons in-process on `listen` —
 * heatmap, ride expiry, carpooling, listings, roadside, track reap, metrics.
 * Each was a bare `setInterval`, so a second instance behind nginx ran all seven
 * a second time: double expiry, double heatmap, double carpooling reminders.
 *
 * That capped the API at ONE process, which is a bigger problem than it sounds.
 * With one process, every deploy and every crash is a full dispatch outage
 * rather than a rolling restart — the whole marketplace stops matching rides
 * for as long as the box takes to come back.
 *
 * The guarantee here is deliberately weak: "usually only one instance runs this
 * tick". That is exactly right for periodic maintenance work, where a missed
 * tick costs 30 seconds and a duplicated tick costs a double notification. It
 * is NOT strong enough for anything involving money — those paths use
 * `SELECT … FOR UPDATE` inside a transaction, and should keep doing so.
 */

/** Prefixed so a shared Redis cannot collide with application keys. */
const KEY_PREFIX = 'cron-lock:';

/**
 * Release only if we still hold it. Compare-and-delete, because a naive DEL
 * would let a slow tick delete the lock a DIFFERENT instance has since acquired
 * — turning a mutex into a suggestion at exactly the moment it matters.
 */
const RELEASE_SCRIPT = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  else
    return 0
  end
`;

export type LockOutcome<T> = { ran: true; result: T } | { ran: false };

/**
 * Run `fn` if this process can take the named lock; otherwise do nothing.
 *
 * `ttlMs` must be longer than the work normally takes and shorter than the
 * interval between ticks. Too short and two instances overlap anyway; too long
 * and a process killed mid-tick blocks the job until the TTL expires.
 *
 * Fails OPEN. If Redis itself is unreachable we run the work rather than skip
 * it: a single-instance deployment — which is every deployment today — must not
 * silently stop expiring rides because the cache blipped. The cost of that
 * choice is a possible duplicate tick during a Redis outage on a multi-instance
 * deployment, which is the cheaper of the two failures.
 */
export async function withClusterLock<T>(
  name: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<LockOutcome<T>> {
  const key = `${KEY_PREFIX}${name}`;
  const token = crypto.randomUUID();

  let acquired = true;
  try {
    // SET key token PX ttl NX — atomic "take it only if free, and never keep it
    // forever". The NX is the mutex; the PX is what makes a crashed holder
    // recoverable without an operator.
    const res = await redis.set(key, token, 'PX', Math.max(1, Math.round(ttlMs)), 'NX');
    acquired = res === 'OK';
  } catch (err) {
    logger.warn({ err, lock: name }, 'cluster-lock: redis unavailable, running unlocked');
    acquired = true;
  }

  // Losing the lock is the NORMAL outcome, not an error: with three instances,
  // two lose it on every single tick. Logging that at warn level would bury the
  // logs that actually matter.
  if (!acquired) return { ran: false };

  try {
    return { ran: true, result: await fn() };
  } finally {
    try {
      await redis.eval(RELEASE_SCRIPT, 1, key, token);
    } catch {
      // Nothing to do: the TTL will free it. Never let a release failure mask
      // the outcome of the work itself.
    }
  }
}
