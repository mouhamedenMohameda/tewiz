#!/usr/bin/env bash
# Ship archived WAL segments off the VPS, then prune the ones already shipped
# AND already covered by a base backup.
#
# Why it is a separate script from archive_command:
#   Postgres' archive_command must be fast and near-certain to succeed. If it
#   fails, Postgres keeps the segment in pg_wal and retries forever — correct
#   behaviour, but on a small VPS a network outage would quietly fill the disk
#   and take the database down. So archive_command only ever writes to a LOCAL
#   directory (an operation that cannot fail for network reasons), and this
#   script — run from cron every few minutes — is what crosses the network.
#
# The consequence, stated plainly: your real RPO is the cron interval, not
# archive_timeout. Every 5 minutes = you can lose at most ~5 minutes of rides.
#
# Usage (as the postgres user, or root):
#   scripts/ship-wal.sh
#
# Config (from .env, same keys as backup-db.sh):
#   BACKUP_S3_BUCKET / BACKUP_S3_ENDPOINT / BACKUP_S3_ACCESS_KEY /
#   BACKUP_S3_SECRET_KEY [/ BACKUP_S3_REGION]
#   BACKUP_SSH_TARGET=user@host:/path/to/dir
#   WAL_ARCHIVE_DIR (default /var/backups/tewiz-wal)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

log() { echo "[ship-wal] $*"; }
die() { echo "[ship-wal] ERROR $*" >&2; exit 1; }

env_get() {
  [ -f "$REPO_ROOT/.env" ] || return 0
  # `|| true` — see the note in backup-db.sh: without it, pipefail turns a missing
  # .env key into a silent exit 1.
  grep -E "^$1=" "$REPO_ROOT/.env" | tail -1 | cut -d= -f2- | tr -d '"' | tr -d "'" || true
}

WAL_ARCHIVE_DIR="${WAL_ARCHIVE_DIR:-$(env_get WAL_ARCHIVE_DIR)}"
WAL_ARCHIVE_DIR="${WAL_ARCHIVE_DIR:-/var/backups/tewiz-wal}"
BACKUP_S3_BUCKET="${BACKUP_S3_BUCKET:-$(env_get BACKUP_S3_BUCKET)}"
BACKUP_S3_ENDPOINT="${BACKUP_S3_ENDPOINT:-$(env_get BACKUP_S3_ENDPOINT)}"
BACKUP_S3_ACCESS_KEY="${BACKUP_S3_ACCESS_KEY:-$(env_get BACKUP_S3_ACCESS_KEY)}"
BACKUP_S3_SECRET_KEY="${BACKUP_S3_SECRET_KEY:-$(env_get BACKUP_S3_SECRET_KEY)}"
BACKUP_S3_REGION="${BACKUP_S3_REGION:-$(env_get BACKUP_S3_REGION)}"
BACKUP_SSH_TARGET="${BACKUP_SSH_TARGET:-$(env_get BACKUP_SSH_TARGET)}"
BACKUP_RCLONE_REMOTE="${BACKUP_RCLONE_REMOTE:-$(env_get BACKUP_RCLONE_REMOTE)}"

# Keep local WAL for this many days after shipping. Must comfortably exceed the
# interval between base backups, or PITR has segments it cannot replay from.
WAL_KEEP_DAYS="${WAL_KEEP_DAYS:-8}"

[ -d "$WAL_ARCHIVE_DIR" ] || die "WAL archive dir not found: $WAL_ARCHIVE_DIR (run setup-pitr.sh first)"

# One shipper at a time — cron every 5 min plus a slow link would otherwise
# stack up uploads of the same segments.
LOCK="/tmp/tewiz-ship-wal.lock"
if command -v flock >/dev/null; then
  exec 9>"$LOCK"
  flock -n 9 || { log "another shipper is running — skipping this tick"; exit 0; }
fi

SHIPPED=0

if [ -n "$BACKUP_S3_BUCKET" ]; then
  command -v aws >/dev/null || die "BACKUP_S3_BUCKET set but the aws CLI is missing"
  S3_ARGS=()
  [ -n "$BACKUP_S3_ENDPOINT" ] && S3_ARGS+=(--endpoint-url "$BACKUP_S3_ENDPOINT")
  # `sync` is idempotent: already-uploaded segments are skipped by size+mtime,
  # so a re-run after a partial failure costs nothing. WAL files are immutable
  # once archived, which is what makes size-based comparison safe here.
  if AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY" \
     AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_KEY" \
     AWS_DEFAULT_REGION="${BACKUP_S3_REGION:-auto}" \
     aws s3 sync "$WAL_ARCHIVE_DIR" "s3://$BACKUP_S3_BUCKET/wal/" \
         "${S3_ARGS[@]}" --only-show-errors; then
    SHIPPED=1
  else
    die "s3 sync of WAL failed — RPO is degrading, fix this now"
  fi
fi

if [ -n "$BACKUP_SSH_TARGET" ]; then
  command -v rsync >/dev/null || die "BACKUP_SSH_TARGET set but rsync is missing"
  if rsync -a --partial -e 'ssh -o BatchMode=yes -o ConnectTimeout=15' \
      "$WAL_ARCHIVE_DIR/" "$BACKUP_SSH_TARGET/wal/"; then
    SHIPPED=1
  else
    die "rsync of WAL failed — RPO is degrading, fix this now"
  fi
fi

if [ -n "$BACKUP_RCLONE_REMOTE" ]; then
  command -v rclone >/dev/null || die "BACKUP_RCLONE_REMOTE set but rclone is missing"
  # `copy`, not `sync`: sync mirrors deletions, so the local WAL_KEEP_DAYS prune
  # below would wipe the off-site segments too. `copy` is also idempotent — WAL
  # files are immutable once archived, so already-uploaded segments are skipped.
  #
  # --transfers 4: Google Drive is slow per-file and this runs every 5 minutes.
  # Serial uploads of a backlog would still be uploading when the next tick fires.
  if rclone copy "$WAL_ARCHIVE_DIR" "$BACKUP_RCLONE_REMOTE/wal/" \
      --config "${RCLONE_CONFIG:-$HOME/.config/rclone/rclone.conf}" \
      --transfers 4 --no-traverse; then
    SHIPPED=1
  else
    die "rclone copy of WAL failed — RPO is degrading, fix this now.
       Token expired? rclone config reconnect ${BACKUP_RCLONE_REMOTE%%:*}:"
  fi
fi

if [ "$SHIPPED" -eq 0 ]; then
  die "no off-site target configured — WAL archiving without off-site shipping
       protects you from a bad UPDATE but not from losing the machine."
fi

COUNT="$(find "$WAL_ARCHIVE_DIR" -type f -name '0*' | wc -l | tr -d ' ')"
log "shipped ok segments_local=$COUNT"

# Prune only what has been shipped (everything, at this point) and is older than
# the retention window. -mtime is on the archive copy, which Postgres never
# rewrites, so it is a faithful "archived at" timestamp.
PRUNED="$(find "$WAL_ARCHIVE_DIR" -type f -name '0*' -mtime "+$WAL_KEEP_DAYS" -print -delete | wc -l | tr -d ' ')"
[ "$PRUNED" != "0" ] && log "pruned $PRUNED local segment(s) older than ${WAL_KEEP_DAYS}d"

# --- Remote retention ---------------------------------------------------------
# Nothing else prunes the off-site WAL: BACKUP_REMOTE_KEEP_DAYS in backup-db.sh
# only covers db/. With archive_timeout at 5 min, an idle database still produces
# ~288 segments a day, so wal/ grows for as long as the system runs and will
# eventually fill a Drive quota.
#
# ⚠️ WAL is only useful with a base backup to replay from, and deleting a segment
# an existing base backup still needs breaks recovery SILENTLY — it looks fine
# until the day it is needed. Two guards:
#   - opt-in: unset means never prune the remote (the safe default);
#   - a floor of 14 days, twice the weekly base-backup cadence, so a typo like
#     "2" cannot quietly destroy the ability to recover.
BACKUP_REMOTE_KEEP_DAYS="${BACKUP_REMOTE_KEEP_DAYS:-$(env_get BACKUP_REMOTE_KEEP_DAYS)}"
WAL_REMOTE_KEEP_MIN_DAYS=14

if [ -n "$BACKUP_REMOTE_KEEP_DAYS" ] && [ -n "$BACKUP_RCLONE_REMOTE" ]; then
  if [ "$BACKUP_REMOTE_KEEP_DAYS" -lt "$WAL_REMOTE_KEEP_MIN_DAYS" ]; then
    log "WARN BACKUP_REMOTE_KEEP_DAYS=$BACKUP_REMOTE_KEEP_DAYS is below the"
    log "WARN ${WAL_REMOTE_KEEP_MIN_DAYS}-day floor — NOT pruning remote WAL."
    log "WARN Base backups are weekly; pruning WAL that recent could leave a"
    log "WARN base backup with no segments to replay."
  else
    rclone delete "$BACKUP_RCLONE_REMOTE/wal/" \
      --config "${RCLONE_CONFIG:-$HOME/.config/rclone/rclone.conf}" \
      --min-age "${BACKUP_REMOTE_KEEP_DAYS}d" \
      --drive-use-trash=false \
      >/dev/null 2>&1 \
      || log "WARN remote WAL prune failed — segments kept, quota may fill up"
  fi
fi

exit 0
