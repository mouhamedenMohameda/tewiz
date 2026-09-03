/**
 * Reset a user's password from the server terminal.
 *
 *   pnpm --filter @tewiz/api reset:password +22245999999
 *   pnpm --filter @tewiz/api reset:password +22245999999 "MonMotDePasse"
 *
 * Voie de secours pour un compte verrouillé dehors — typiquement le dernier
 * super_admin, que plus personne ne peut débloquer via le panneau (la route
 * /admin/users/:id/regenerate-password exige d'être déjà connecté en admin).
 *
 * Sans second argument, un mot de passe est tiré au sort et affiché une fois.
 * Toutes les sessions actives sont révoquées, comme le fait le panneau.
 */
import { pool } from '../src/db/pool.js';
import { generatePassword, hashPassword } from '../src/modules/auth/password.js';

async function main() {
  const phone = process.argv[2];
  const explicit = process.argv[3];
  if (!phone) {
    console.error('Usage: tsx scripts/reset-password.ts <phone> [password]');
    process.exit(1);
  }
  const normalized = phone.startsWith('+') ? phone : `+${phone}`;

  // Même contrainte que le login (zod .min(4).max(64)) : un mot de passe
  // refusé par l'API serait accepté ici, et le compte resterait inutilisable.
  if (explicit && (explicit.length < 4 || explicit.length > 64)) {
    console.error('Le mot de passe doit faire entre 4 et 64 caractères.');
    process.exit(1);
  }

  const password = explicit ?? generatePassword();
  const passwordHash = await hashPassword(password);

  const { rows } = await pool.query<{
    id: string; phone: string; role: string; admin_role: string | null;
    full_name: string | null; status: string;
  }>(
    `UPDATE users
        SET password_hash       = $2,
            password_updated_at = now(),
            must_reset_password = false
      WHERE phone = $1 AND status <> 'deleted'
      RETURNING id, phone, role, admin_role, full_name, status`,
    [normalized, passwordHash],
  );

  const user = rows[0];
  if (!user) {
    console.error(`Aucun compte actif pour ${normalized}.`);
    await pool.end();
    process.exit(1);
  }

  const revoked = await pool.query(
    `UPDATE sessions SET revoked_at = now()
      WHERE user_id = $1 AND revoked_at IS NULL`,
    [user.id],
  );

  console.log('Compte :', user);
  console.log(`Sessions révoquées : ${revoked.rowCount}`);
  console.log(`Mot de passe : ${password}`);
  if (user.status !== 'active') {
    console.log(`⚠️  status = '${user.status}' → la connexion sera refusée (account_suspended).`);
  }
  if (user.role === 'admin') {
    console.log('Connexion : panneau admin (admin-web), pas les apps mobiles.');
  }
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
