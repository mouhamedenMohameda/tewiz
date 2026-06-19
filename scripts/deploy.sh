#!/usr/bin/env bash
# Redeploy the Tewiz stack on the prod server.
#
# Steps (in order, fail-fast):
#   1. Snapshot the uploads dir  (so a bad deploy never costs us user docs)
#   2. git pull
#   3. pnpm install --frozen-lockfile
#   4. pnpm --filter @tewiz/api build
#   5. pnpm --filter @tewiz/api migrate            (apply pending SQL)
#   6. pnpm --filter @tewiz/admin-web build
#   7. pm2 restart tewiz-api tewiz-admin --update-env
#
# Run from the repo root:  bash scripts/deploy.sh
#
# Notes:
#   - Step 1 calls scripts/backup-uploads.sh; if it fails the deploy is
#     aborted before any code changes, so the previous version + uploads
#     stay intact.
#   - --update-env is required for pm2 to re-read .env on restart.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

echo "==> 1/7 Backup uploads"
bash "$SCRIPT_DIR/backup-uploads.sh"

echo "==> 2/7 git pull"
git pull --ff-only

echo "==> 3/7 pnpm install"
pnpm install --frozen-lockfile

echo "==> 4/7 build api"
pnpm --filter @tewiz/api build

echo "==> 5/7 db migrate"
pnpm --filter @tewiz/api migrate

echo "==> 6/7 build admin-web"
pnpm --filter @tewiz/admin-web build

echo "==> 7/7 pm2 restart"
pm2 restart tewiz-api tewiz-admin --update-env

echo "==> deploy ok"
pm2 describe tewiz-api | grep -E "status|restart|exec cwd" || true
