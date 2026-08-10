import express from 'express';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { errorHandler, notFound } from '../src/middleware/error.js';
import { perUserLimiter } from '../src/middleware/rate-limit.js';
import { api } from './helpers/app.js';

/**
 * perUserLimiter guards the routes that cost money per call (Google Places) or
 * disk (audio uploads). The property that matters is not just "it throttles" —
 * it is WHO it throttles. Mauritanian mobile traffic arrives through a handful
 * of carrier-grade NAT addresses, so a limiter that keyed on the IP would cut
 * off a whole city as soon as one person searched too fast. These tests pin the
 * per-user isolation so that never regresses into an IP-keyed limiter.
 */

/**
 * Mounts the limiter on a throwaway app that reads the caller's identity from
 * an `x-test-user` header, standing in for what requireAuth attaches upstream.
 * Sending no header exercises the unauthenticated fallback.
 */
async function startLimiterApp(limit: number) {
  const app = express();
  app.use((req, _res, next) => {
    const id = req.headers['x-test-user'];
    if (typeof id === 'string') {
      req.user = { id, role: 'rider', adminRole: null, sid: 'sid-test' };
    }
    next();
  });
  app.use(perUserLimiter({ windowMs: 60_000, limit, message: 'Trop de requêtes.' }));
  app.get('/thing', (_req, res) => { res.json({ ok: true }); });
  app.use(notFound);
  app.use(errorHandler);

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('Cannot resolve test server port');
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    close: () => new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res()))),
  };
}

let handle: { baseUrl: string; close: () => Promise<void> } | null = null;
afterEach(async () => {
  await handle?.close();
  handle = null;
});

describe('perUserLimiter', () => {
  it('allows requests up to the limit, then answers 429 with the rate_limited code', async () => {
    handle = await startLimiterApp(3);
    const as = { 'x-test-user': 'user-a' };

    for (let i = 0; i < 3; i++) {
      const r = await api(handle.baseUrl, 'GET', '/thing', undefined, as);
      expect(r.status).toBe(200);
    }

    const blocked = await api(handle.baseUrl, 'GET', '/thing', undefined, as);
    expect(blocked.status).toBe(429);
    // Clients branch on the code, so it must match the shape the error handler
    // produces everywhere else rather than express-rate-limit's default string.
    expect(blocked.body.error.code).toBe('rate_limited');
  });

  it('gives each user their own budget instead of a shared one', async () => {
    handle = await startLimiterApp(2);

    // Exhaust user A.
    for (let i = 0; i < 2; i++) {
      await api(handle.baseUrl, 'GET', '/thing', undefined, { 'x-test-user': 'user-a' });
    }
    const aBlocked = await api(handle.baseUrl, 'GET', '/thing', undefined, { 'x-test-user': 'user-a' });
    expect(aBlocked.status).toBe(429);

    // B shares A's IP (both are 127.0.0.1 here, exactly as two riders behind the
    // same carrier NAT would be) and must be unaffected.
    const bFirst = await api(handle.baseUrl, 'GET', '/thing', undefined, { 'x-test-user': 'user-b' });
    expect(bFirst.status).toBe(200);
  });

  it('falls back to the IP when no user is attached', async () => {
    handle = await startLimiterApp(1);

    const first = await api(handle.baseUrl, 'GET', '/thing');
    expect(first.status).toBe(200);

    const second = await api(handle.baseUrl, 'GET', '/thing');
    expect(second.status).toBe(429);
  });
});
