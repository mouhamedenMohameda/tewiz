/**
 * Mint a new API key for a client.
 *
 * Usage:
 *   pnpm --filter @tewiz/voice-location-api create-key "ACME Rides" --quota 50000
 *
 * The plaintext key is printed ONCE to stdout. Store it somewhere safe and
 * hand it to the client — it cannot be recovered later (only the hash is kept).
 */
import { pool } from '../src/db/pool.js';
import { generateKey } from '../src/db/keys.js';
import { env } from '../src/config.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const clientName = args.find((a) => !a.startsWith('--'));
  const quotaIdx = args.indexOf('--quota');
  const quota =
    quotaIdx >= 0 ? Number(args[quotaIdx + 1]) : env.DEFAULT_MONTHLY_QUOTA;

  if (!clientName) {
    console.error('Usage: create-key "<Client name>" [--quota <monthly requests>]');
    process.exit(1);
  }
  if (!Number.isFinite(quota) || quota < 0) {
    console.error(`Invalid quota: ${quota}`);
    process.exit(1);
  }

  const { key, prefix, hash } = generateKey();

  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO voiceloc_api_keys (client_name, key_prefix, key_hash, monthly_quota)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [clientName, prefix, hash, quota],
  );

  console.log('\n  ✓ API key created');
  console.log(`    id           : ${rows[0]?.id}`);
  console.log(`    client       : ${clientName}`);
  console.log(`    prefix       : ${prefix}`);
  console.log(`    monthly_quota: ${quota === 0 ? 'unlimited' : quota}`);
  console.log('\n  ⚠ Give this key to the client and store it safely.');
  console.log('    It will never be shown again:\n');
  console.log(`    ${key}\n`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
