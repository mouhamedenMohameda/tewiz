import pg from 'pg';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { instrumentQuery } from '../lib/query-timing.js';

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  // Keep pooled sockets warm: enabling TCP keep-alive stops idle connections
  // from being silently dropped by the OS/NAT between the API's frequent polls,
  // which otherwise forces a fresh (slower) TCP+auth handshake on the next query.
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
});

// Slow-query observability. Any query at or over SLOW_QUERY_MS is logged at WARN
// with its parameter-free SQL + duration, so slow paths surface instead of
// hiding. We wrap `pool.query` (covers ~all one-shot queries) and each client
// checked out for a transaction (see instrumentClient / withTx) — never pg's
// internal connect, so the query path itself is untouched.
const slowOpts = {
  thresholdMs: env.SLOW_QUERY_MS,
  onSlow: ({ ms, sql }: { ms: number; sql: string }) =>
    logger.warn({ ms, sql }, 'slow query'),
};

pool.query = instrumentQuery(pool.query.bind(pool), slowOpts) as typeof pool.query;

/**
 * Wrap a checked-out client's `query` so transaction statements are timed too.
 * Call right after `pool.connect()`; withTx does this for you.
 */
export function instrumentClient(client: pg.PoolClient): pg.PoolClient {
  client.query = instrumentQuery(client.query.bind(client), slowOpts) as typeof client.query;
  return client;
}

pool.on('error', (err) => {
  // Unexpected error on idle client. Log and let pg recreate the client.
  logger.error({ err }, '[pg] idle client error');
});

/**
 * Run a function inside a transaction.
 * Use this for anything that touches the wallet or rides state.
 */
export async function withTx<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = instrumentClient(await pool.connect());
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
