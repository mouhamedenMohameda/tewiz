/**
 * Mint or promote a dataset-collection tester.
 *
 *   pnpm --filter @tewiz/api create:tester +22245999999 "Fatimetou"
 *
 * Creates a rider account with a generated password and the is_tester flag,
 * then prints the credentials once. Idempotent on the phone number: an existing
 * account is promoted rather than duplicated, and its password is left alone
 * unless --reset-password is passed.
 *
 * Why a script and not raw SQL: the password is bcrypt-hashed, so an INSERT by
 * hand produces an account with a NULL password_hash — one that exists, passes
 * every foreign key, and can never log in.
 *
 * The plaintext password is shown exactly once, here. Nothing stores it, and
 * there is no endpoint that reads it back; losing it means regenerating.
 */
import { pool } from '../src/db/pool.js';
import { generatePassword, hashPassword } from '../src/modules/auth/password.js';

interface Existing {
  id: string;
  role: string;
  is_tester: boolean;
  password_hash: string | null;
}

async function main() {
  const args = process.argv.slice(2);
  const resetPassword = args.includes('--reset-password');
  const positional = args.filter((a) => !a.startsWith('--'));
  const phone = positional[0];
  const name = positional[1] ?? 'Testeur';

  if (!phone) {
    console.error('Usage: tsx scripts/create-tester.ts <phone> [fullName] [--reset-password]');
    process.exit(1);
  }

  const normalized = phone.startsWith('+') ? phone : `+${phone}`;
  // Same shape the API's phoneSchema enforces, so a number minted here can
  // actually log in through /auth/login.
  if (!/^\+222[234]\d{7}$/.test(normalized)) {
    console.error('Numéro mauritanien invalide:', normalized);
    process.exit(1);
  }

  const { rows } = await pool.query<Existing>(
    `SELECT id, role, COALESCE(is_tester, false) AS is_tester, password_hash
       FROM users WHERE phone = $1`,
    [normalized],
  );
  const existing = rows[0];

  // An admin promoted to tester would be locked out of the collection screen
  // anyway: /rider/* requires role rider or captain. Better to say so than to
  // set a flag that silently does nothing.
  if (existing && existing.role === 'admin') {
    console.error(
      `${normalized} est un compte admin. L'écran de collecte vit sous /rider/*, `
      + 'qui refuse le rôle admin. Utilisez un compte rider distinct.',
    );
    process.exit(1);
  }

  // Only mint a password when there is none, or when explicitly asked. A
  // promotion must not silently invalidate the credentials a tester is already
  // signed in with.
  const needsPassword = !existing?.password_hash || resetPassword;
  const password = needsPassword ? generatePassword() : null;
  const hash = password ? await hashPassword(password) : null;

  const result = await pool.query<{
    id: string; phone: string; full_name: string | null; role: string; is_tester: boolean;
  }>(
    `INSERT INTO users (phone, role, full_name, language, is_tester,
                        password_hash, password_updated_at, must_reset_password)
     VALUES ($1, 'rider', $2, 'fr', true, $3, now(), false)
     ON CONFLICT (phone) DO UPDATE
       SET is_tester = true,
           full_name = COALESCE(users.full_name, EXCLUDED.full_name),
           password_hash = COALESCE($3, users.password_hash),
           password_updated_at = CASE
             WHEN $3 IS NULL THEN users.password_updated_at ELSE now()
           END
     RETURNING id, phone, full_name, role, is_tester`,
    [normalized, name, hash],
  );

  const user = result.rows[0]!;
  const wasPromoted = Boolean(existing);

  console.log('');
  console.log(wasPromoted ? '  Compte promu testeur' : '  Compte testeur créé');
  console.log('  ─────────────────────────────────────────');
  console.log(`  id       ${user.id}`);
  console.log(`  téléphone ${user.phone}`);
  console.log(`  nom      ${user.full_name ?? '—'}`);
  console.log(`  rôle     ${user.role} (testeur: ${user.is_tester})`);
  if (password) {
    console.log(`  mot de passe ${password}`);
    console.log('');
    console.log('  Notez-le maintenant — il n\'est stocké nulle part en clair.');
  } else {
    console.log('  mot de passe inchangé (--reset-password pour en générer un)');
  }
  console.log('');
  console.log('  L\'écran apparaît dans Réglages > Collecte vocale APRÈS un');
  console.log('  redémarrage de l\'app: le flag est relu depuis /auth/me au boot,');
  console.log('  il n\'est pas porté par le token.');
  console.log('');

  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await pool.end().catch(() => {});
  process.exit(1);
});
