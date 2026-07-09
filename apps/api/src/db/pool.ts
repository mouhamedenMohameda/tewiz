import pg from 'pg';
import { env } from '../config/env.js';

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

pool.on('error', (err) => {
  // Unexpected error on idle client. Log and let pg recreate the client.
  console.error('[pg] idle client error:', err);
});

/**
 * Run a function inside a transaction.
 * Use this for anything that touches the wallet or rides state.
 */
export async function withTx<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
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
