#!/usr/bin/env bash
# Snapshot UPLOAD_DIR to a timestamped tarball and rotate old snapshots.
#
# Why:
#   Captain documents and top-up screenshots live on the API server's local
#   disk (see UPLOAD_DIR in .env). They are NOT in git and NOT in the
#   Postgres dump. A bad redeploy / rm -rf / disk failure loses them
#   forever. This script is the cheapest insurance: a tarball per deploy.
#
# Where it runs:
#   - Automatically from scripts/deploy.sh before each redeploy.
#   - Optionally from cron (e.g. nightly) for an extra rolling backup.
#
# Usage:
#   scripts/backup-uploads.sh                          # uses .env + defaults
#   BACKUP_DIR=/srv/backups scripts/backup-uploads.sh  # override target
#   KEEP=14 scripts/backup-uploads.sh                  # keep last 14 snapshots
#
# Exits 0 even when UPLOAD_DIR is missing or empty — backups must never
# break the deploy. Failures are logged with a clear marker so they're
# easy to grep in CI / pm2 logs.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Pull UPLOAD_DIR from .env without sourcing the whole file (which would
# also leak DB passwords into this script's environment).
if [ -f "$REPO_ROOT/.env" ]; then
  UPLOAD_DIR="${UPLOAD_DIR:-$(grep -E '^UPLOAD_DIR=' "$REPO_ROOT/.env" | tail -1 | cut -d= -f2- | tr -d '"' | tr -d "'")}"
fi
UPLOAD_DIR="${UPLOAD_DIR:-./uploads}"

# Resolve relative paths against the API's cwd (matches how the app loads them).
case "$UPLOAD_DIR" in
  /*) ;;  # already absolute
  *)  UPLOAD_DIR="$REPO_ROOT/apps/api/$UPLOAD_DIR" ;;
esac

BACKUP_DIR="${BACKUP_DIR:-/var/backups/tewiz-uploads}"
KEEP="${KEEP:-7}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$BACKUP_DIR/uploads-$TS.tar.gz"

log() { echo "[backup-uploads] $*"; }

if [ ! -d "$UPLOAD_DIR" ]; then
  log "WARN UPLOAD_DIR not found: $UPLOAD_DIR — nothing to back up"
  exit 0
fi

if [ -z "$(ls -A "$UPLOAD_DIR" 2>/dev/null)" ]; then
  log "WARN UPLOAD_DIR is empty: $UPLOAD_DIR — nothing to back up"
  exit 0
fi

mkdir -p "$BACKUP_DIR"

log "snapshotting $UPLOAD_DIR -> $OUT"
# -C to strip the leading path so the tarball restores cleanly anywhere.
if ! tar -czf "$OUT.partial" -C "$(dirname "$UPLOAD_DIR")" "$(basename "$UPLOAD_DIR")"; then
  log "ERROR tar failed — leaving partial file for inspection: $OUT.partial"
  exit 1
fi
mv "$OUT.partial" "$OUT"

SIZE="$(du -h "$OUT" | cut -f1)"
log "ok size=$SIZE keep_last=$KEEP"

# Rotate: keep the N most recent, delete older.
# shellcheck disable=SC2012  # names are ours (uploads-<timestamp>.tar.gz), no spaces
ls -1t "$BACKUP_DIR"/uploads-*.tar.gz 2>/dev/null \
  | tail -n +$((KEEP + 1)) \
  | while read -r old; do
      log "rotating out $(basename "$old")"
      rm -f "$old"
    done
