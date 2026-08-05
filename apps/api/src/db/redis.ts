import { Redis } from 'ioredis';
import { env } from '../config/env.js';

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  // Connect on first command, not on import.
  //
  // Without this, merely importing any module that touches Redis opens a socket
  // — including from unit tests, which then sit retrying a connection they will
  // never use. It became visible once the cron lock spread this import across
  // five more services; the tests still passed, because the `error` handler
  // below swallows the failure, which is exactly what makes it worth fixing
  // rather than tolerating.
  //
  // Runtime behaviour is unchanged: ioredis connects transparently on the first
  // command, and every caller of this client issues one. The only difference is
  // that a connection problem surfaces at first use instead of at boot, and it
  // is reported through the same handler either way.
  lazyConnect: true,
});

redis.on('error', (err: Error) => {
  console.error('[redis] error:', err.message);
});
