#!/usr/bin/env bash
# Redeploy the Tewiz stack on the prod server.
#
# Steps (in order, fail-fast):
#   1. Snapshot the uploads dir  (so a bad deploy never costs us user docs)
#   2. Verified DB dump          (so a bad MIGRATION never costs us data)
#   3. git pull
#   4. pnpm install --frozen-lockfile (incl. devDeps — needed for tsc/tsx)
#   5. pnpm --filter @tewiz/api build
#   6. pnpm --filter @tewiz/api migrate            (apply pending SQL)
#   7. pnpm --filter @tewiz/api seed:restaurants   (idempotent — UPSERT only)
#   8. pnpm --filter @tewiz/admin-web build
#   9. pm2 restart tewiz-api tewiz-admin --update-env
#
# Run from the repo root:  bash scripts/deploy.sh
#
# Notes:
#   - Step 1 calls scripts/backup-uploads.sh; if it fails the deploy is
#     aborted before any code changes, so the previous version + uploads
#     stay intact.
#   - Step 2 is the one that matters most. Step 6 applies SQL migrations, and a
#     migration that drops or rewrites a column is NOT revertible by
#     `git revert` — the data is gone. Taking a verified recovery point first
#     turns "we lost the wallet ledger" into "we restore and retry". It is
#     fail-fast on purpose: no recovery point, no migrations.
#   - We explicitly unset NODE_ENV at the top so `pnpm install` keeps the
#     devDeps. pm2 / systemd will re-export NODE_ENV=production when the
#     apps start (via .env or the pm2 ecosystem file). Without this,
#     `node-pg-migrate`, `tsx`, `tsc`, @types/* all get pruned and the
#     migrate + build + seed steps blow up.
#   - --update-env is required for pm2 to re-read .env on restart.

set -euo pipefail

# Force a fresh dev-aware shell — pnpm reads this to decide whether to
# install devDependencies.
unset NODE_ENV

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

echo "==> 1/9 Backup uploads"
bash "$SCRIPT_DIR/backup-uploads.sh"

echo "==> 2/9 Backup database (verified + off-site)"
# Deliberately NOT tolerant of failure: step 6 runs migrations, and there is no
# `git revert` for a dropped column. If we cannot take a recovery point, we do
# not touch the schema. Set ALLOW_LOCAL_ONLY=1 only on a dev box with no
# off-site target configured.
bash "$SCRIPT_DIR/backup-db.sh"

echo "==> 3/9 git pull"
git pull --ff-only

echo "==> 4/9 pnpm install (incl. devDeps)"
# --prod=false belt-and-suspenders in case some wrapper re-exports NODE_ENV.
pnpm install --frozen-lockfile --prod=false

echo "==> 5/9 build api"
pnpm --filter @tewiz/api build

echo "==> 6/9 db migrate"
# --no-check-order: ignore node-pg-migrate's order sanity check.
# It can throw false positives when several migrations share the same
# run_on timestamp (batch insert), even though all files are applied.
# All real ordering safety comes from the numeric filename prefix.
#
# The grep -v filters the "Can't determine timestamp for 000X" log lines
# the runner emits because our migrations use sequential 0001_, 0002_…
# prefixes instead of Unix timestamps. They're warnings, not errors —
# every migration still applies in numerical order. We use PIPESTATUS to
# keep the script fail-fast on actual migrate failures.
set -o pipefail
pnpm --filter @tewiz/api exec node-pg-migrate \
  -m ../../db/migrations --envPath ../../.env \
  --migration-file-language sql --no-check-order up \
  2>&1 | grep -v "^Can't determine timestamp for"

echo "==> 7/9 seed restaurants (idempotent UPSERT)"
# Deterministic OSM slugs make this safe to re-run on every deploy —
# rows already in DB are merged in place; new entries from OSM appear.
pnpm --filter @tewiz/api seed:restaurants \
  "$REPO_ROOT/apps/api/seeds/restaurants-nouakchott-full.json"

echo "==> 8/9 build admin-web"
pnpm --filter @tewiz/admin-web build

echo "==> 9/9 pm2 restart"
pm2 restart tewiz-api tewiz-admin --update-env

echo "==> deploy ok"
pm2 describe tewiz-api | grep -E "status|restart|exec cwd" || true
