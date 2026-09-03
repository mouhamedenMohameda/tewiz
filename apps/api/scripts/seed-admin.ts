/**
 * Mint or promote a user to admin.
 *
 *   pnpm --filter @tewiz/api seed:admin +22245999999 "Admin Mohamed"
 *
 * Idempotent: if the phone exists, role is updated to admin.
 *
 * A password is ISSUED when the account has none. Without it the row exists
 * but /auth/login answers 403 no_password_set ("compte non activé") and the
 * account is unusable — there is no self-service reset, and the panel that
 * could regenerate one requires being logged in as a super_admin already.
 * An account that already has a password keeps it (re-running to fix a role
 * must not lock the holder out).
 */
import { pool } from '../src/db/pool.js';
import { generatePassword, hashPassword } from '../src/modules/auth/password.js';

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

  const existing = await pool.query<{ has_password: boolean }>(
    `SELECT (password_hash IS NOT NULL) AS has_password FROM users WHERE phone = $1`,
    [normalized],
  );
  const needsPassword = !existing.rows[0]?.has_password;
  const password = needsPassword ? generatePassword() : null;
  const passwordHash = password ? await hashPassword(password) : null;

  // Seed scripts mint super_admins by default — they bootstrap the panel
  // and can then assign narrower sub-roles to other admins via the UI.
  const r = await pool.query(
    `INSERT INTO users (phone, role, admin_role, full_name,
                        password_hash, password_updated_at, must_reset_password)
     VALUES ($1, 'admin', 'super_admin', $2, $3,
             CASE WHEN $3::text IS NULL THEN NULL ELSE now() END, false)
     ON CONFLICT (phone) DO UPDATE
       SET role       = 'admin',
           admin_role = COALESCE(users.admin_role, 'super_admin'),
           full_name  = COALESCE(EXCLUDED.full_name, users.full_name),
           status     = 'active',
           password_hash       = COALESCE(users.password_hash, EXCLUDED.password_hash),
           password_updated_at = CASE WHEN users.password_hash IS NULL AND $3::text IS NOT NULL
                                      THEN now() ELSE users.password_updated_at END,
           must_reset_password = CASE WHEN users.password_hash IS NULL AND $3::text IS NOT NULL
                                      THEN false ELSE users.must_reset_password END
     RETURNING id, phone, role, admin_role, full_name`,
    [normalized, name, passwordHash],
  );
  console.log('Admin ready:', r.rows[0]);
  if (password) {
    console.log(`Mot de passe (affiché une seule fois) : ${password}`);
    console.log('Connexion : panneau admin (admin-web), pas l\'app Captain.');
  } else {
    console.log('Mot de passe existant conservé.');
  }
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
