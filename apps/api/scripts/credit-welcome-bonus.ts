/**
 * Credit a welcome bonus to the first N captains who have completed at least
 * one ride. Idempotent per captain via the `reason` marker: re-running skips
 * captains that already received this specific bonus.
 *
 *   pnpm --filter @tewiz/api tsx scripts/credit-welcome-bonus.ts
 *   pnpm --filter @tewiz/api tsx scripts/credit-welcome-bonus.ts --dry-run
 */
import { pool } from '../src/db/pool.js';
import { creditWallet } from '../src/modules/wallet/wallet.service.js';

const AMOUNT_MRU = 100;
const LIMIT = 100;
const REASON = 'Welcome bonus - 100 premiers chauffeurs';

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  const { rows: candidates } = await pool.query<{
    user_id: string;
    full_name: string | null;
    phone: string;
    created_at: Date;
    already_credited: boolean;
  }>(
    `SELECT c.user_id,
            u.full_name,
            u.phone,
            c.created_at,
            EXISTS (
              SELECT 1 FROM wallet_transactions wt
              WHERE wt.captain_id = c.user_id AND wt.reason = $1
            ) AS already_credited
       FROM captains c
       JOIN users u ON u.id = c.user_id
      WHERE EXISTS (
        SELECT 1 FROM rides r
        WHERE r.captain_id = c.user_id AND r.status = 'completed'
      )
      ORDER BY c.created_at ASC
      LIMIT $2`,
    [REASON, LIMIT],
  );

  console.log(`Found ${candidates.length} eligible captains.`);
  const toCredit = candidates.filter((c) => !c.already_credited);
  const skipped = candidates.length - toCredit.length;
  console.log(`- ${toCredit.length} to credit`);
  console.log(`- ${skipped} already credited (skipped)`);

  if (dryRun) {
    console.log('\n[dry-run] Would credit:');
    for (const c of toCredit) {
      console.log(`  ${c.phone.padEnd(15)} ${c.full_name ?? '(no name)'}`);
    }
    await pool.end();
    return;
  }

  let ok = 0;
  let failed = 0;
  for (const c of toCredit) {
    try {
      const res = await creditWallet({
        captainId: c.user_id,
        amountMru: AMOUNT_MRU,
        type: 'bonus',
        reason: REASON,
        createdBy: null,
      });
      ok++;
      console.log(`OK  ${c.phone} -> balance ${res.balanceAfter} MRU`);
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`ERR ${c.phone}: ${msg}`);
    }
  }

  console.log(`\nDone. Credited=${ok} Failed=${failed} Skipped=${skipped}`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
