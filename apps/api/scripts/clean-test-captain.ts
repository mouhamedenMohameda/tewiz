/**
 * Wipe a test captain and all their data so the e2e test can re-run cleanly.
 *
 *   pnpm --filter @tewiz/api clean:test-captain +22245888888
 *
 * Order matters because of FK constraints. Pattern: leaves of the FK graph
 * first, roots last.
 */
import { pool } from '../src/db/pool.js';

async function main() {
  const phone = process.argv[2] ?? '+22245888888';

  // Phase 1: child rows that reference rides, topups, captains, etc.
  await pool.query(
    `DELETE FROM ratings WHERE ride_id IN (
        SELECT id FROM rides WHERE captain_id IN (SELECT id FROM users WHERE phone = $1)
                                OR booker_id IN (SELECT id FROM users WHERE phone = $1))`,
    [phone],
  );
  await pool.query(
    `DELETE FROM ride_traces WHERE ride_id IN (
        SELECT id FROM rides WHERE captain_id IN (SELECT id FROM users WHERE phone = $1)
                                OR booker_id IN (SELECT id FROM users WHERE phone = $1))`,
    [phone],
  );
  await pool.query(
    `DELETE FROM colis_details WHERE ride_id IN (
        SELECT id FROM rides WHERE captain_id IN (SELECT id FROM users WHERE phone = $1)
                                OR booker_id IN (SELECT id FROM users WHERE phone = $1))`,
    [phone],
  );

  // wallet_transactions references rides AND topup_requests. Delete it FIRST.
  await pool.query(
    `DELETE FROM wallet_transactions
      WHERE captain_id IN (SELECT id FROM users WHERE phone = $1)
         OR ride_id IN (SELECT id FROM rides WHERE captain_id IN (SELECT id FROM users WHERE phone = $1))
         OR topup_id IN (SELECT id FROM topup_requests WHERE captain_id IN (SELECT id FROM users WHERE phone = $1))`,
    [phone],
  );

  // Now safe to drop the things wallet_transactions referenced
  await pool.query(
    `DELETE FROM topup_requests
      WHERE captain_id IN (SELECT id FROM users WHERE phone = $1)`,
    [phone],
  );
  await pool.query(
    `DELETE FROM recurring_ride_occurrences WHERE recurring_ride_id IN (
        SELECT id FROM recurring_rides WHERE captain_id IN (SELECT id FROM users WHERE phone = $1))`,
    [phone],
  );
  await pool.query(
    `DELETE FROM recurring_rides
      WHERE captain_id IN (SELECT id FROM users WHERE phone = $1)`,
    [phone],
  );
  await pool.query(
    `DELETE FROM rides
      WHERE captain_id IN (SELECT id FROM users WHERE phone = $1)
         OR booker_id IN (SELECT id FROM users WHERE phone = $1)`,
    [phone],
  );

  // Wallets, captain state, going-home, home
  await pool.query(
    `DELETE FROM wallets
      WHERE captain_id IN (SELECT id FROM users WHERE phone = $1)`,
    [phone],
  );
  await pool.query(
    `DELETE FROM captain_state
      WHERE captain_id IN (SELECT id FROM users WHERE phone = $1)`,
    [phone],
  );
  await pool.query(
    `DELETE FROM captain_going_home_sessions
      WHERE captain_id IN (SELECT id FROM users WHERE phone = $1)`,
    [phone],
  );
  await pool.query(
    `DELETE FROM captain_home
      WHERE captain_id IN (SELECT id FROM users WHERE phone = $1)`,
    [phone],
  );

  // Favorites + vehicles before captains
  await pool.query(
    `DELETE FROM favorite_captains
      WHERE captain_id IN (SELECT id FROM users WHERE phone = $1)
         OR rider_id IN (SELECT id FROM users WHERE phone = $1)`,
    [phone],
  );
  await pool.query(
    `DELETE FROM vehicles
      WHERE captain_id IN (SELECT id FROM users WHERE phone = $1)`,
    [phone],
  );
  await pool.query(
    `DELETE FROM captains
      WHERE user_id IN (SELECT id FROM users WHERE phone = $1)`,
    [phone],
  );

  // KYC application data
  await pool.query(
    `DELETE FROM application_documents
      WHERE application_id IN (SELECT id FROM captain_applications WHERE phone = $1)`,
    [phone],
  );
  await pool.query(
    `DELETE FROM admin_audit_log
      WHERE target_id IN (SELECT id FROM captain_applications WHERE phone = $1)`,
    [phone],
  );
  await pool.query(`DELETE FROM captain_applications WHERE phone = $1`, [phone]);

  // Auth data + the user row itself
  await pool.query(
    `DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE phone = $1)`,
    [phone],
  );
  await pool.query(`DELETE FROM otp_codes WHERE phone = $1`, [phone]);
  await pool.query(`DELETE FROM users WHERE phone = $1`, [phone]);

  console.log('Cleaned test captain:', phone);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
