import rateLimit, { ipKeyGenerator, type RateLimitRequestHandler } from 'express-rate-limit';
import type { Request } from 'express';

/**
 * Limiter for routes whose cost is not paid in CPU but in money — a billed
 * upstream call (Google Places) or disk (audio uploads). Those routes need a
 * ceiling even when the caller is a perfectly legitimate, authenticated user,
 * because the bill arrives either way.
 *
 * Keyed on the authenticated user id rather than the IP on purpose. Most of
 * Mauritania reaches us through a handful of carrier-grade NAT addresses, so an
 * IP-keyed limiter here would throttle a whole city the moment one person
 * searched too fast — the same reason the /auth limiter is deliberately scoped
 * and generous. A request that somehow arrives unauthenticated falls back to the
 * IP through `ipKeyGenerator`, which normalises IPv6 down to a /56 so a single
 * host cannot walk its own subnet for a fresh bucket on every request.
 *
 * Uses the default in-memory store, which counts per PROCESS. tewiz-api runs as
 * a single pm2 fork, so that is exactly one bucket today; moving the API to
 * cluster mode would silently multiply every limit below by the worker count and
 * is the point at which this needs a shared Redis store.
 */
export function perUserLimiter(options: {
  windowMs: number;
  limit: number;
  message: string;
}): RateLimitRequestHandler {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req: Request) => req.user?.id ?? ipKeyGenerator(req.ip ?? ''),
    message: { error: { code: 'rate_limited', message: options.message } },
  });
}
