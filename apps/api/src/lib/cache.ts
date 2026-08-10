import { redis } from '../db/redis.js';
import { logger } from './logger.js';

/**
 * Cache-aside over the Redis client we already run.
 *
 * Redis has been in the stack since the cron locks landed, but nothing ever
 * cached a read with it: every request that needed pricing settings, public
 * config or a restaurant list went to Postgres, every time. The in-memory cache
 * in `app-settings.service.ts` was the one exception, and it shows the limits of
 * that approach — it is per-process, so it is lost on every deploy and
 * duplicated once a second instance exists.
 *
 * Two rules govern everything below.
 *
 * FAIL OPEN. Redis is an optimisation here, never a source of truth. Any Redis
 * error — unreachable, timeout, corrupt payload — degrades to "call the loader",
 * which is exactly the behaviour we had before this file existed. The same
 * reasoning as `cluster-lock.ts`: a cache that can turn a blip into a failed
 * booking is worse than no cache at all.
 *
 * COALESCE. Concurrent misses on one key run the loader ONCE. Without this, a
 * cache is actively harmful under load: the moment a hot key expires, every
 * in-flight request misses simultaneously and they all stampede the thing the
 * cache was meant to protect — which, for the geocoder, is an upstream billed
 * per call.
 */

/** Prefixed so a shared Redis cannot collide with `cron-lock:` or the geo sets. */
const KEY_PREFIX = 'cache:';

/**
 * Keys whose loader is currently running, so concurrent callers can await the
 * same promise instead of each starting their own. Entries live only for the
 * duration of one loader call — this is a stampede guard, not a second cache.
 */
const inflight = new Map<string, Promise<unknown>>();

/** Distinguishes "cached value is null" from "not in the cache", which JSON cannot. */
const MISS = Symbol('cache-miss');

async function readThrough(key: string): Promise<unknown | typeof MISS> {
  let raw: string | null;
  try {
    raw = await redis.get(key);
  } catch (err) {
    logger.warn({ err, key }, 'cache: redis get failed, serving uncached');
    return MISS;
  }
  if (raw === null) return MISS;

  try {
    return JSON.parse(raw);
  } catch {
    // A corrupt entry is a miss, not an error. Anything else would let one bad
    // write keep failing every read of that key until its TTL ran out.
    logger.warn({ key }, 'cache: corrupt entry, treating as miss');
    return MISS;
  }
}

/**
 * Return `key` from the cache, or compute it with `loader` and store it.
 *
 * `null` IS cached — a known-absent row is a real answer, and re-querying for it
 * on every request is the miss this helper exists to avoid. `undefined` is not,
 * because it cannot survive a JSON round-trip.
 *
 * A loader that throws is never cached and never leaves an in-flight entry
 * behind; the next caller retries from scratch.
 */
export async function cached<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<T> {
  const fullKey = `${KEY_PREFIX}${key}`;

  const hit = await readThrough(fullKey);
  if (hit !== MISS) return hit as T;

  return singleFlight(fullKey, async () => {
    const value = await loader();

    if (value !== undefined) {
      try {
        await redis.set(fullKey, JSON.stringify(value), 'PX', Math.max(1, Math.round(ttlMs)));
      } catch (err) {
        // The caller already has its answer. A failed write costs a cache miss
        // next time, which is not worth failing a request over.
        logger.warn({ err, key: fullKey }, 'cache: redis set failed');
      }
    }

    return value;
  });
}

/**
 * Drop a cached key. Call this from the write path, in the same place the
 * in-memory caches already bust themselves.
 *
 * Never throws: a bust that fails must not roll back the write that triggered
 * it. The stale entry expires on its own TTL.
 */
export async function invalidate(key: string): Promise<void> {
  try {
    await redis.del(`${KEY_PREFIX}${key}`);
  } catch (err) {
    logger.warn({ err, key }, 'cache: invalidate failed, entry will expire on TTL');
  }
}

/**
 * Run `work` under `key`, sharing the result with any concurrent caller.
 *
 * Useful on its own, without Redis, wherever duplicate concurrent work is the
 * cost worth removing — ten riders searching the same place at once should
 * produce one billed Google Places call, not ten.
 */
export function singleFlight<T>(key: string, work: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;

  // Chain the cleanup BEFORE storing, so the entry is removed whether the work
  // resolves or rejects. A rejected promise left in the map would be handed to
  // every future caller of this key — a permanent outage from one transient one.
  const promise = (async () => work())().finally(() => {
    inflight.delete(key);
  });

  inflight.set(key, promise);
  return promise;
}

/** Test-only: drop all in-flight entries so cases cannot leak into each other. */
export function __resetInflight(): void {
  inflight.clear();
}
