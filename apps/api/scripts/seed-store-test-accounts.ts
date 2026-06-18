/**
 * Seed the App Store / Google Play reviewer accounts.
 *
 *   pnpm --filter @tewiz/api seed:store-test
 *
 * Why:
 *   Self-signup is disabled (admin-only). Apple and Google reviewers MUST
 *   be able to log in or they reject the submission with no further review.
 *   This script provisions two fixed accounts in the production DB:
 *
 *     - Rider:   +22244000001 / Demo2026!
 *     - Captain: +22244000002 / Demo2026!   (KYC approved + active vehicle)
 *
 *   The captain account has a pre-approved KYC application, a captains row,
 *   and an active vehicle so the captain mode toggle and ride accept flow
 *   are immediately reachable from the home screen.
 *
 * Idempotent:
 *   Re-running this script is safe — it upserts the users and the
 *   captain_applications / captains / vehicles rows. Use it after every
 *   schema migration that might wipe state, or to reset the test password
 *   if you suspect it leaked.
 *
 * Cleanup:
 *   After App Store and Google Play have approved the build, you can
 *   either keep these accounts for future updates (recommended — same
 *   credentials in every submission) or wipe them via the admin UI.
 */
import { pool } from '../src/db/pool.js';
import { hashPassword } from '../src/modules/auth/password.js';

interface TestAccount {
  phone: string;
  password: string;
  fullName: string;
  role: 'rider' | 'captain';
}

// Phone numbers picked from the +22244 prefix which is not currently
// assigned by any Mauritanian carrier — won't collide with a real user.
const RIDER: TestAccount = {
  phone: '+22244000001',
  password: 'Demo2026!',
  fullName: 'Reviewer Rider',
  role: 'rider',
};

const CAPTAIN: TestAccount = {
  phone: '+22244000002',
  password: 'Demo2026!',
  fullName: 'Reviewer Captain',
  role: 'captain',
};

// Fake but plausible identifiers. The unique-on-approved indexes mean we
// can't reuse a real NNI / plate; the 9999... pattern is reserved for tests.
const CAPTAIN_NNI = '99999999992';
const CAPTAIN_PLATE = 'TEST-002-MR';

async function upsertUser(acc: TestAccount): Promise<string> {
  const passwordHash = await hashPassword(acc.password);
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (phone, role, full_name, password_hash,
                        password_updated_at, must_reset_password, status)
     VALUES ($1, $2, $3, $4, now(), false, 'active')
     ON CONFLICT (phone) DO UPDATE
       SET role                 = EXCLUDED.role,
           full_name            = EXCLUDED.full_name,
           password_hash        = EXCLUDED.password_hash,
           password_updated_at  = now(),
           must_reset_password  = false,
           status               = 'active'
     RETURNING id`,
    [acc.phone, acc.role, acc.fullName, passwordHash],
  );
  return rows[0]!.id;
}

async function ensureApprovedCaptain(userId: string): Promise<void> {
  // 1. captain_applications — approved.
  // The partial unique index on (phone) WHERE status IN (open) means we
  // can have multiple historical rows but only one open. We force-approve
  // any existing open app first.
  await pool.query(
    `UPDATE captain_applications
        SET status = 'approved', reviewed_at = now()
      WHERE phone = $1
        AND status IN ('draft', 'submitted', 'under_review', 'needs_correction')`,
    [CAPTAIN.phone],
  );

  const appRes = await pool.query<{ id: string }>(
    `SELECT id FROM captain_applications
      WHERE phone = $1 AND status = 'approved'
      ORDER BY created_at DESC
      LIMIT 1`,
    [CAPTAIN.phone],
  );

  let appId: string;
  if (appRes.rows.length > 0) {
    appId = appRes.rows[0]!.id;
    // Refresh fields so subsequent admin views show consistent data.
    await pool.query(
      `UPDATE captain_applications
          SET user_id = $1, full_name = $2, nni = $3,
              vehicle_plate = $4, vehicle_brand = 'Toyota',
              vehicle_model = 'Corolla', vehicle_year = 2018,
              vehicle_color = 'Blanc', vehicle_seats = 4,
              reviewed_at = COALESCE(reviewed_at, now())
        WHERE id = $5`,
      [userId, CAPTAIN.fullName, CAPTAIN_NNI, CAPTAIN_PLATE, appId],
    );
  } else {
    const ins = await pool.query<{ id: string }>(
      `INSERT INTO captain_applications
         (phone, user_id, status, full_name, nni,
          vehicle_plate, vehicle_brand, vehicle_model,
          vehicle_year, vehicle_color, vehicle_seats,
          submitted_at, reviewed_at)
       VALUES ($1, $2, 'approved', $3, $4,
               $5, 'Toyota', 'Corolla',
               2018, 'Blanc', 4,
               now(), now())
       RETURNING id`,
      [CAPTAIN.phone, userId, CAPTAIN.fullName, CAPTAIN_NNI, CAPTAIN_PLATE],
    );
    appId = ins.rows[0]!.id;
  }

  // 2. captains row.
  await pool.query(
    `INSERT INTO captains (user_id, application_id, status)
     VALUES ($1, $2, 'active')
     ON CONFLICT (user_id) DO UPDATE
       SET application_id = EXCLUDED.application_id,
           status         = 'active'`,
    [userId, appId],
  );

  // 3. Wallet row. The wallet table has captain_id as PK; the captain UI
  //    queries GET /captain/wallet which 404s ("no_wallet") without this row.
  //    Real captains get their wallet created at first top-up, but the
  //    reviewer will tap the wallet screen before topping up — so we
  //    pre-create it with a zero balance.
  await pool.query(
    `INSERT INTO wallets (captain_id, balance_khoums)
     VALUES ($1, 0)
     ON CONFLICT (captain_id) DO NOTHING`,
    [userId],
  );

  // 4. Active vehicle. Deactivate any previous active one first so the
  //    partial unique index on (captain_id) WHERE is_active doesn't fire.
  await pool.query(
    `UPDATE vehicles SET is_active = false
      WHERE captain_id = $1 AND is_active = true AND plate <> $2`,
    [userId, CAPTAIN_PLATE],
  );
  await pool.query(
    `INSERT INTO vehicles (captain_id, plate, brand, model, year, color, seats, is_active)
     VALUES ($1, $2, 'Toyota', 'Corolla', 2018, 'Blanc', 4, true)
     ON CONFLICT (plate) DO UPDATE
       SET captain_id = EXCLUDED.captain_id,
           is_active  = true`,
    [userId, CAPTAIN_PLATE],
  );
}

async function main() {
  console.log('Seeding store reviewer accounts...');

  const riderId = await upsertUser(RIDER);
  console.log(`  rider:   ${RIDER.phone}  →  user_id=${riderId}`);

  const captainId = await upsertUser(CAPTAIN);
  await ensureApprovedCaptain(captainId);
  console.log(`  captain: ${CAPTAIN.phone}  →  user_id=${captainId}  (KYC approved + vehicle active)`);

  console.log('\nReviewer credentials (paste into App Store Connect / Play Console):');
  console.log(`  ${RIDER.phone}    /   ${RIDER.password}    (rider)`);
  console.log(`  ${CAPTAIN.phone}    /   ${CAPTAIN.password}    (captain)`);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
