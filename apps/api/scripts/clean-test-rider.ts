/**
 * Wipe a test rider's data so the e2e test can re-run cleanly.
 *
 *   pnpm --filter @tewiz/api clean:test-rider +22245777777
 */
import { pool } from '../src/db/pool.js';

async function main() {
  const phone = process.argv[2] ?? '+22245777777';
  // Rides as booker first (rides reference users via booker_id).
  // We don't cascade ride history hard — just unhook the user, leaving completed
  // ride rows for analytics. For a clean test, we delete everything.
  await pool.query(
    `DELETE FROM ratings WHERE rater_id IN (SELECT id FROM users WHERE phone = $1)
        OR ratee_id IN (SELECT id FROM users WHERE phone = $1)`,
    [phone],
  );
  await pool.query(
    `DELETE FROM ride_traces WHERE ride_id IN (
        SELECT id FROM rides WHERE booker_id IN (SELECT id FROM users WHERE phone = $1))`,
    [phone],
  );
  await pool.query(
    `DELETE FROM wallet_transactions WHERE ride_id IN (
        SELECT id FROM rides WHERE booker_id IN (SELECT id FROM users WHERE phone = $1))`,
    [phone],
  );
  await pool.query(
    `DELETE FROM rides WHERE booker_id IN (SELECT id FROM users WHERE phone = $1)`,
    [phone],
  );
  await pool.query(
    `DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE phone = $1)`,
    [phone],
  );
  await pool.query(`DELETE FROM otp_codes WHERE phone = $1`, [phone]);
  await pool.query(`DELETE FROM users WHERE phone = $1`, [phone]);
  console.log('Cleaned test rider:', phone);
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
