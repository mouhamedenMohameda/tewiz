#!/usr/bin/env bash
# Redeploy the Tewiz stack on the prod server.
#
# Steps (in order, fail-fast):
#   1. Snapshot the uploads dir  (so a bad deploy never costs us user docs)
#   2. Verified DB dump          (so a bad MIGRATION never costs us data)
#   3. git pull
#   4. pnpm install --frozen-lockfile (incl. devDeps — needed for tsc/tsx)
#   5. pnpm --filter @tewiz/api build
#   6. pnpm -r --if-present test                   (gate — see note below)
#   7. pnpm --filter @tewiz/api migrate            (apply pending SQL)
#   8. pnpm --filter @tewiz/api seed:restaurants   (idempotent — UPSERT only)
#   9. pnpm --filter @tewiz/admin-web build
#  10. pm2 restart tewiz-api tewiz-admin --update-env
#
# Run from the repo root:  bash scripts/deploy.sh
#
# Notes:
#   - Step 1 calls scripts/backup-uploads.sh; if it fails the deploy is
#     aborted before any code changes, so the previous version + uploads
#     stay intact.
#   - Step 2 is the one that matters most. Step 7 applies SQL migrations, and a
#     migration that drops or rewrites a column is NOT revertible by
#     `git revert` — the data is gone. Taking a verified recovery point first
#     turns "we lost the wallet ledger" into "we restore and retry". It is
#     fail-fast on purpose: no recovery point, no migrations.
#   - Step 6 runs BEFORE the migrations on purpose, not just before the
#     restart. The CI protects merges into main; this gate protects manual
#     deploys, which is where a hotfix pushed straight to the server lands.
#     Putting it ahead of step 7 means a failing test costs a re-run, not an
#     irreversible schema change. The tests stub `pool`, so no database is
#     touched. Set SKIP_TESTS=1 to override during an outage — it says so
#     loudly in the log.
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

# Fingerprint this script BEFORE the pull can replace it. See step 3.5 for why.
SELF_HASH_BEFORE="$(sha256sum "$SCRIPT_DIR/deploy.sh" 2>/dev/null | cut -d' ' -f1 || true)"

echo "==> 1/10 Backup uploads"
bash "$SCRIPT_DIR/backup-uploads.sh"

echo "==> 2/10 Backup database (verified + off-site)"
# Deliberately NOT tolerant of failure: step 7 runs migrations, and there is no
# `git revert` for a dropped column. If we cannot take a recovery point, we do
# not touch the schema. Set ALLOW_LOCAL_ONLY=1 only on a dev box with no
# off-site target configured.
bash "$SCRIPT_DIR/backup-db.sh"

echo "==> 3/10 git pull"
git pull --ff-only

# --- Did the pull change THIS script? -----------------------------------------
# bash reads a script incrementally, and `git pull` replaces the file rather than
# rewriting it in place, so the already-running shell keeps executing the OLD
# deploy.sh. Any change to the deploy procedure therefore takes effect on the
# NEXT run, not this one — silently.
#
# That bit us once already: the deploy that introduced the step-2 database backup
# ran the previous 8-step version, so no recovery point was taken. It was
# harmless only because that run had no pending migrations.
#
# We warn instead of re-exec'ing: re-running from the top would redo the uploads
# snapshot and the dump, and a self-re-executing deploy script is a much better
# way to create a loop than to fix a footgun. A loud line is enough — the steps
# that protect data (uploads + database backup) already run BEFORE the pull, so
# an out-of-date deploy.sh can never skip them.
SELF_HASH_AFTER="$(sha256sum "$SCRIPT_DIR/deploy.sh" 2>/dev/null | cut -d' ' -f1 || true)"
if [ -n "$SELF_HASH_BEFORE" ] && [ "$SELF_HASH_BEFORE" != "$SELF_HASH_AFTER" ]; then
  echo
  echo "  ############################################################"
  echo "  #  deploy.sh CHANGED in this pull.                         #"
  echo "  #  The version running right now is the PREVIOUS one.      #"
  echo "  #  Re-run 'bash scripts/deploy.sh' to apply the new steps. #"
  echo "  ############################################################"
  echo
fi

echo "==> 4/10 pnpm install (incl. devDeps)"
# --prod=false belt-and-suspenders in case some wrapper re-exports NODE_ENV.
pnpm install --frozen-lockfile --prod=false

echo "==> 5/10 build api"
pnpm --filter @tewiz/api build

echo "==> 6/10 test"
if [ "${SKIP_TESTS:-0}" = "1" ]; then
  echo "  !! SKIP_TESTS=1 — test gate bypassed, deploying unverified code."
else
  pnpm -r --if-present test
fi

echo "==> 7/10 db migrate"
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

echo "==> 8/10 seed restaurants (idempotent UPSERT)"
# Deterministic OSM slugs make this safe to re-run on every deploy —
# rows already in DB are merged in place; new entries from OSM appear.
pnpm --filter @tewiz/api seed:restaurants \
  "$REPO_ROOT/apps/api/seeds/restaurants-nouakchott-full.json"

echo "==> 9/10 build admin-web"
pnpm --filter @tewiz/admin-web build

echo "==> 10/10 pm2 restart"
pm2 restart tewiz-api tewiz-admin --update-env

echo "==> deploy ok"
pm2 describe tewiz-api | grep -E "status|restart|exec cwd" || true
