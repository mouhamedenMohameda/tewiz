#!/usr/bin/env bash
# One-time setup of Point-In-Time Recovery on the Tewiz Postgres box.
#
# What a nightly dump gives you:  "restore to 02:00 last night".
# What PITR gives you:            "restore to 14:37:12, one second before the
#                                  admin ran that UPDATE without a WHERE".
#
# The gap between those two is every ride, wallet top-up and commission recorded
# since the last dump. On a ride-hailing platform that is real money owed to real
# captains, so PITR is not a luxury here.
#
# How it works once installed:
#   1. Postgres writes every change to a WAL segment.
#   2. archive_command copies each completed segment, gzipped, into
#      WAL_ARCHIVE_DIR — a LOCAL directory, so it cannot fail on network trouble.
#   3. scripts/ship-wal.sh (cron, every 5 min) pushes that directory off-site.
#   4. A weekly pg_basebackup gives the starting point WAL replays from.
#   Recovery = restore the newest base backup, then replay WAL up to the target
#   timestamp. See docs/runbook-backup-restore.md.
#
# MUST run on the database host, as root:
#   sudo bash scripts/setup-pitr.sh
#
# ⚠️  This RESTARTS PostgreSQL. `wal_level` and `archive_mode` cannot be changed
#     with a reload — a restart is required. Expect a few seconds of API 5xx.
#     Run it during a quiet window (early morning), not at 19:00.
#
# Idempotent: re-running only rewrites the config drop-in and re-checks state.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

log() { echo "[setup-pitr] $*"; }
die() { echo "[setup-pitr] ERROR $*" >&2; exit 1; }

[ "$(id -u)" = "0" ] || die "must run as root (sudo bash scripts/setup-pitr.sh)"

PG_VERSION="${PG_VERSION:-16}"
PG_CONF_DIR="/etc/postgresql/$PG_VERSION/main"
CONF_D="$PG_CONF_DIR/conf.d"
WAL_ARCHIVE_DIR="${WAL_ARCHIVE_DIR:-/var/backups/tewiz-wal}"
BASEBACKUP_DIR="${BASEBACKUP_DIR:-/var/backups/tewiz-basebackup}"
# Bounds RPO during idle hours: without this, a low-traffic night never fills a
# 16MB segment, so nothing is archived and the recovery point stays stale.
ARCHIVE_TIMEOUT="${ARCHIVE_TIMEOUT:-300}"

[ -d "$PG_CONF_DIR" ] || die "$PG_CONF_DIR not found — is this the DB host, and is PG_VERSION=$PG_VERSION right?"

# --- 1. Archive directories, owned by postgres --------------------------------
log "creating $WAL_ARCHIVE_DIR and $BASEBACKUP_DIR"
mkdir -p "$WAL_ARCHIVE_DIR" "$BASEBACKUP_DIR"
chown postgres:postgres "$WAL_ARCHIVE_DIR" "$BASEBACKUP_DIR"
chmod 700 "$WAL_ARCHIVE_DIR" "$BASEBACKUP_DIR"

# --- 2. Check disk headroom before turning archiving on -----------------------
# Turning on archiving with no room is how you take the database down while
# trying to protect it: if archive_command cannot write, WAL piles up in pg_wal.
AVAIL_MB="$(df -Pm "$WAL_ARCHIVE_DIR" | awk 'NR==2 {print $4}')"
log "free space on $(df -Pm "$WAL_ARCHIVE_DIR" | awk 'NR==2 {print $6}'): ${AVAIL_MB}MB"
if [ "$AVAIL_MB" -lt 5120 ]; then
  die "less than 5GB free. Gzipped WAL for this workload is small, but a
       broken off-site shipper means the archive grows unbounded. Free space or
       mount a volume first."
fi

# --- 3. Config drop-in --------------------------------------------------------
# A drop-in under conf.d rather than editing postgresql.conf: package upgrades
# rewrite postgresql.conf, and a separate file makes what we changed obvious and
# revertible (delete the file, restart).
mkdir -p "$CONF_D"
if ! grep -qE "^\s*include_dir\s*=\s*'conf\.d'" "$PG_CONF_DIR/postgresql.conf"; then
  log "enabling include_dir = 'conf.d' in postgresql.conf"
  echo "include_dir = 'conf.d'" >> "$PG_CONF_DIR/postgresql.conf"
fi

DROPIN="$CONF_D/50-tewiz-pitr.conf"
log "writing $DROPIN"
cat > "$DROPIN" <<EOF
# Managed by scripts/setup-pitr.sh — do not edit by hand.
# Delete this file and restart postgres to disable PITR.

# 'replica' is the minimum that produces WAL usable for archive recovery, and is
# already the default in PG16 — stated explicitly so an upstream default change
# cannot silently break recovery.
wal_level = replica
archive_mode = on

# Archive to a LOCAL dir only. The 'test ! -f' guard makes the command safe to
# retry: Postgres may re-issue archive_command for a segment it is unsure about,
# and overwriting an already-archived segment would corrupt the archive.
# gzip because WAL is highly compressible (~4-6x) and the off-site link is thin.
archive_command = 'test ! -f $WAL_ARCHIVE_DIR/%f.gz && gzip -c %p > $WAL_ARCHIVE_DIR/%f.gz'

# Force a segment switch every ARCHIVE_TIMEOUT seconds so quiet periods still
# produce a recovery point. Costs one mostly-empty 16MB segment per interval
# while idle; gzip flattens those to a few KB.
archive_timeout = ${ARCHIVE_TIMEOUT}s

# Keep enough WAL that a replica (step 8 of the plan) can be added later without
# an immediate re-sync, and that a slow archiver has slack.
wal_keep_size = 1024MB
EOF
chown postgres:postgres "$DROPIN"

# --- 4. Restart ---------------------------------------------------------------
log "restarting postgresql-$PG_VERSION (brief API downtime)"
systemctl restart "postgresql@$PG_VERSION-main" 2>/dev/null || systemctl restart postgresql

sleep 3
sudo -u postgres psql -tAX -c 'SELECT 1' >/dev/null || die "postgres did not come back up — check: journalctl -u postgresql"

# --- 5. Prove archiving actually works ----------------------------------------
# Do not trust the config; force a segment switch and confirm a file appears.
# A wrong path or permission bit shows up here, not in six months.
log "forcing a WAL switch to test archive_command"
sudo -u postgres psql -qX -c 'SELECT pg_switch_wal()' >/dev/null
sleep 5

ARCHIVED="$(find "$WAL_ARCHIVE_DIR" -type f -name '*.gz' | wc -l | tr -d ' ')"
FAILED="$(sudo -u postgres psql -tAX -c 'SELECT failed_count FROM pg_stat_archiver')"
LAST_FAIL="$(sudo -u postgres psql -tAX -c "SELECT COALESCE(last_failed_wal,'-') FROM pg_stat_archiver")"

if [ "$ARCHIVED" = "0" ]; then
  die "no segment appeared in $WAL_ARCHIVE_DIR. pg_stat_archiver failures=$FAILED last_failed=$LAST_FAIL
       Check permissions on the archive dir and: journalctl -u postgresql | tail -50"
fi
log "archiving works: $ARCHIVED segment(s) present, archiver failures=$FAILED"

# --- 6. First base backup -----------------------------------------------------
# WAL alone cannot rebuild a database; replay has to start from a base backup.
# Without this, everything above is useless.
BB="$BASEBACKUP_DIR/base-$(date -u +%Y%m%dT%H%M%SZ)"
log "taking the first base backup -> $BB (this can take a few minutes)"
sudo -u postgres pg_basebackup --pgdata="$BB" --format=tar --gzip --wal-method=stream --progress \
  || die "pg_basebackup failed"
log "base backup ok: $(du -sh "$BB" | cut -f1)"

# --- 7. Cron ------------------------------------------------------------------
# Installed as files in /etc/cron.d rather than a user crontab so they are
# visible in git-managed docs and survive a user being recreated.
log "installing cron jobs"
cat > /etc/cron.d/tewiz-backup <<EOF
# Managed by scripts/setup-pitr.sh
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# Ship WAL off-site every 5 minutes. THIS interval is your real RPO.
*/5 * * * * root cd $REPO_ROOT && bash scripts/ship-wal.sh >> /var/log/tewiz-ship-wal.log 2>&1

# Nightly verified dump, off-site. Runs at 02:10 UTC (03:10 Nouakchott) — the
# quietest hour for a ride-hailing workload.
10 2 * * * root cd $REPO_ROOT && bash scripts/backup-db.sh >> /var/log/tewiz-backup-db.log 2>&1

# Weekly base backup, Sunday 03:00 UTC. Bounds how much WAL a recovery replays.
0 3 * * 0 postgres pg_basebackup --pgdata=$BASEBACKUP_DIR/base-\$(date -u +\%Y\%m\%dT\%H\%M\%SZ) --format=tar --gzip --wal-method=stream >> /var/log/tewiz-basebackup.log 2>&1

# Monthly restore DRILL, 1st of the month 04:00 UTC. Restores the newest dump
# into a scratch DB and verifies it against its manifest. If this ever mails you
# a failure, your backups are already broken — act the same day.
0 4 1 * * root cd $REPO_ROOT && bash scripts/restore-db.sh >> /var/log/tewiz-restore-drill.log 2>&1
EOF
chmod 644 /etc/cron.d/tewiz-backup

log "logrotate for the backup logs"
cat > /etc/logrotate.d/tewiz-backup <<'EOF'
/var/log/tewiz-ship-wal.log /var/log/tewiz-backup-db.log /var/log/tewiz-basebackup.log /var/log/tewiz-restore-drill.log {
  weekly
  rotate 8
  compress
  missingok
  notifempty
  copytruncate
}
EOF

echo
log "PITR is ON."
log "  WAL archive:    $WAL_ARCHIVE_DIR"
log "  base backups:   $BASEBACKUP_DIR"
log "  RPO:            ~5 min (the ship-wal cron interval)"
log ""
# Check rather than assume: the previous wording told everyone to go set an
# off-site target, including people who had already set one, which trains you to
# skim past the closing message of a script whose closing message matters.
if bash "$SCRIPT_DIR/ship-wal.sh" >/dev/null 2>&1; then
  log "Off-site WAL shipping is configured and working."
  log "One thing left: run a drill —  bash scripts/restore-db.sh"
else
  log "PITR IS INCOMPLETE — off-site shipping is not working."
  log "  Set BACKUP_S3_BUCKET, BACKUP_SSH_TARGET or BACKUP_RCLONE_REMOTE in .env."
  log "  Until then ship-wal.sh exits 1 every 5 minutes and nothing leaves this box."
  log "  Diagnose with:  bash scripts/ship-wal.sh"
  log "Then run a drill:  bash scripts/restore-db.sh"
fi
log ""
log "Old base backups are NOT auto-pruned — deleting one that WAL still needs"
log "would break recovery silently. Review $BASEBACKUP_DIR monthly and keep at"
log "least the two most recent."
