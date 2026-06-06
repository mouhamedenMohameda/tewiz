/**
 * Mint or promote a user to admin.
 *
 *   pnpm --filter @tewiz/api seed:admin +22245999999 "Admin Mohamed"
 *
 * Idempotent: if the phone exists, role is updated to admin.
 */
import { pool } from '../src/db/pool.js';

async function main() {
  const phone = process.argv[2];
  const name = process.argv[3] ?? 'Admin';
  if (!phone) {
    console.error('Usage: tsx scripts/seed-admin.ts <phone> [fullName]');
    process.exit(1);
  }
  const normalized = phone.startsWith('+') ? phone : `+${phone}`;
  if (!/^\+222[234]\d{7}$/.test(normalized)) {
    console.error('Invalid Mauritanian phone:', normalized);
    process.exit(1);
  }
  const r = await pool.query(
    `INSERT INTO users (phone, role, full_name)
     VALUES ($1, 'admin', $2)
     ON CONFLICT (phone) DO UPDATE
       SET role = 'admin', full_name = COALESCE(EXCLUDED.full_name, users.full_name)
     RETURNING id, phone, role, full_name`,
    [normalized, name],
  );
  console.log('Admin ready:', r.rows[0]);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
