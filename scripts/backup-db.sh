#!/usr/bin/env bash
# Dump the Tewiz Postgres database, VERIFY the dump is restorable, rotate old
# ones, and push a copy OFF the VPS.
#
# Why:
#   Today the API, Postgres, Redis and UPLOAD_DIR all live on the same Contabo
#   box. A single dead SSD loses the entire platform AND its data, with no way
#   back. scripts/backup-uploads.sh covers the files on disk; this covers the
#   database. Both are useless if the copy never leaves the machine — hence the
#   mandatory off-site step below.
#
# Three things this does that a bare `pg_dump` does not:
#   1. VERIFIES the archive with `pg_restore --list` before declaring success.
#      A truncated dump (disk full, OOM-killed pg_dump) still exits 0 and still
#      looks like a plausible file. Most "we had backups" post-mortems are
#      exactly this.
#   2. Writes a MANIFEST next to the dump: row counts of the tables that carry
#      money and identity. scripts/restore-db.sh replays them after a restore,
#      so a restore either matches the manifest or fails loudly.
#   3. Refuses to exit 0 when no off-site target is configured. A backup on the
#      disk you are protecting against is not a backup.
#
# Where it runs:
#   - From scripts/deploy.sh, BEFORE migrations (so a bad migration is undoable).
#   - From cron on the VPS, nightly.
#
# Usage:
#   scripts/backup-db.sh                       # uses .env + defaults
#   KEEP=14 scripts/backup-db.sh               # keep last 14 local dumps
#   ALLOW_LOCAL_ONLY=1 scripts/backup-db.sh    # dev escape hatch, see below
#
# Off-site target — configure AT LEAST ONE of these in .env. Setting several is
# fine and gives you independent copies; every one configured must succeed.
#   BACKUP_S3_BUCKET / BACKUP_S3_ENDPOINT / BACKUP_S3_ACCESS_KEY /
#   BACKUP_S3_SECRET_KEY [/ BACKUP_S3_REGION]      -> needs the `aws` CLI
#   BACKUP_SSH_TARGET=user@host:/path/to/dir       -> needs ssh keys + rsync
#   BACKUP_RCLONE_REMOTE=gdrive:tewiz-backups      -> needs `rclone` configured
#
# Google Drive / Dropbox / OneDrive go through the rclone option. Two notes that
# matter for Drive specifically:
#   - Dumps contain phone numbers, NNI, KYC documents and the wallet ledger. On a
#     personal Drive, wrap the remote in an rclone `crypt` remote so Google only
#     ever holds ciphertext. That is configuration, not code: point
#     BACKUP_RCLONE_REMOTE at the crypt remote and this script needs no key.
#   - Drive has no lifecycle rules, so nothing prunes old copies for you. Set
#     BACKUP_REMOTE_KEEP_DAYS to enable remote pruning (see below); left empty,
#     the remote grows forever, which is the safe default but will eventually
#     fill the free 15GB.
#
# Exit codes:
#   0  dump written, verified, and copied off-site
#   1  something failed — the deploy MUST abort on this
#
# Unlike backup-uploads.sh (which exits 0 on a missing dir so a deploy is never
# blocked by cosmetics), this script is fail-fast on purpose. If we cannot take
# a recovery point, we do not run migrations.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

log() { echo "[backup-db] $*"; }
die() { echo "[backup-db] ERROR $*" >&2; exit 1; }

# --- Config ------------------------------------------------------------------
# Read .env keys individually rather than sourcing the file: sourcing would pull
# every secret (JWT, Twilio, OpenAI) into this shell and into any child process.
env_get() {
  [ -f "$REPO_ROOT/.env" ] || return 0
  # The trailing `|| true` is load-bearing. With `set -o pipefail`, a key that is
  # absent from .env makes grep return 1, which makes the whole pipeline return 1,
  # which makes `VAR="$(env_get KEY)"` fail, which makes `set -e` kill the script
  # — silently, with no log line and exit 1. A nightly cron would then "fail" for
  # weeks with an empty log. A missing optional key must read as empty, not fatal.
  grep -E "^$1=" "$REPO_ROOT/.env" | tail -1 | cut -d= -f2- | tr -d '"' | tr -d "'" || true
}

DATABASE_URL="${DATABASE_URL:-$(env_get DATABASE_URL)}"
[ -n "$DATABASE_URL" ] || die "DATABASE_URL not set (env or .env)"

BACKUP_DIR="${BACKUP_DIR:-/var/backups/tewiz-db}"
KEEP="${KEEP:-7}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
BASE="$BACKUP_DIR/tewiz-$TS"
DUMP="$BASE.dump"
MANIFEST="$BASE.manifest"

BACKUP_S3_BUCKET="${BACKUP_S3_BUCKET:-$(env_get BACKUP_S3_BUCKET)}"
BACKUP_S3_ENDPOINT="${BACKUP_S3_ENDPOINT:-$(env_get BACKUP_S3_ENDPOINT)}"
BACKUP_S3_ACCESS_KEY="${BACKUP_S3_ACCESS_KEY:-$(env_get BACKUP_S3_ACCESS_KEY)}"
BACKUP_S3_SECRET_KEY="${BACKUP_S3_SECRET_KEY:-$(env_get BACKUP_S3_SECRET_KEY)}"
BACKUP_S3_REGION="${BACKUP_S3_REGION:-$(env_get BACKUP_S3_REGION)}"
BACKUP_SSH_TARGET="${BACKUP_SSH_TARGET:-$(env_get BACKUP_SSH_TARGET)}"
BACKUP_RCLONE_REMOTE="${BACKUP_RCLONE_REMOTE:-$(env_get BACKUP_RCLONE_REMOTE)}"
BACKUP_REMOTE_KEEP_DAYS="${BACKUP_REMOTE_KEEP_DAYS:-$(env_get BACKUP_REMOTE_KEEP_DAYS)}"
ALLOW_LOCAL_ONLY="${ALLOW_LOCAL_ONLY:-$(env_get ALLOW_LOCAL_ONLY)}"

command -v pg_dump    >/dev/null || die "pg_dump not found — install postgresql-client-16"
command -v pg_restore >/dev/null || die "pg_restore not found — install postgresql-client-16"

# --- Serialise concurrent runs ----------------------------------------------
# A nightly cron and a deploy can collide. Two pg_dumps at once on a 1-box
# setup is exactly the kind of IO spike that makes the API time out.
LOCK="/tmp/tewiz-backup-db.lock"
if command -v flock >/dev/null; then
  exec 9>"$LOCK"
  flock -n 9 || die "another backup-db run holds $LOCK — refusing to pile on"
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"  # dumps contain phone numbers, NNI, wallet history

# --- 1. Manifest (taken BEFORE the dump, from the live DB) -------------------
# These are the tables where a silent row loss is unacceptable: money, identity,
# and the ride ledger commission is computed from. Anything that restores with a
# different count than the manifest is a failed restore, not a partial one.
#
# Column names are the POST-0017 ones (balance_mru / amount_mru). Migration
# 0017_money_in_mru.sql renamed every *_khoums column and divided the values by
# 5; README.md and docs/features.md still describe the old khoums storage, so do
# not take them as the schema's source of truth here.
#
# Uses a single round-trip. `-t` = tuples only, `-A` = unaligned, so the output
# is stable `table=count` lines that restore-db.sh can diff mechanically.
log "reading manifest from live DB"
MANIFEST_SQL="
SELECT 'users='            || (SELECT count(*) FROM users)
UNION ALL SELECT 'captains='            || (SELECT count(*) FROM captains)
UNION ALL SELECT 'rides='               || (SELECT count(*) FROM rides)
UNION ALL SELECT 'wallets='             || (SELECT count(*) FROM wallets)
UNION ALL SELECT 'wallet_transactions=' || (SELECT count(*) FROM wallet_transactions)
UNION ALL SELECT 'topup_requests='      || (SELECT count(*) FROM topup_requests)
UNION ALL SELECT 'wallet_balance_sum='  || (SELECT COALESCE(sum(balance_mru),0) FROM wallets)
UNION ALL SELECT 'wallet_txn_sum='      || (SELECT COALESCE(sum(amount_mru),0) FROM wallet_transactions)
"
# Connectivity and schema are checked separately: a renamed column must not be
# reported as "the database is down", or the next schema change quietly turns the
# manifest into an empty file and nobody notices until a restore.
psql "$DATABASE_URL" -tAX -c 'SELECT 1' >/dev/null 2>&1 \
  || die "cannot reach the database — aborting before we pretend to have a backup"
if ! LIVE_MANIFEST="$(psql "$DATABASE_URL" -tAX -c "$MANIFEST_SQL" 2>&1)"; then
  die "the manifest query failed against the live schema. A migration probably
       renamed a column — update MANIFEST_SQL here AND the matching checks in
       scripts/restore-db.sh, then re-run. psql said:
       $(printf '%s' "$LIVE_MANIFEST" | head -3)"
fi

# --- 2. Dump ------------------------------------------------------------------
# -Fc  custom format: compressed, and lets restore-db.sh restore a single table.
# --no-owner / --no-privileges: restorable into a DB owned by any role, which is
#   what you want at 3am on a fresh box with a different postgres user.
log "dumping -> $DUMP"
START=$(date +%s)
if ! pg_dump "$DATABASE_URL" \
      --format=custom \
      --no-owner --no-privileges \
      --file="$DUMP.partial"; then
  rm -f "$DUMP.partial"
  die "pg_dump failed"
fi
mv "$DUMP.partial" "$DUMP"
ELAPSED=$(( $(date +%s) - START ))

# --- 3. Verify the archive is actually readable --------------------------------
# `pg_restore --list` parses the archive's table of contents. A truncated or
# corrupt dump fails here instead of six months from now.
log "verifying archive"
# Two distinct failures, kept distinct so the log says which one happened:
# unreadable archive (corrupt / truncated) vs. readable but implausibly small
# (we dumped the wrong or an empty database).
if ! TOC_LISTING="$(pg_restore --list "$DUMP" 2>&1)"; then
  die "pg_restore --list failed — the dump is corrupt. NOT rotating old dumps.
       $(printf '%s' "$TOC_LISTING" | head -3)"
fi
TOC_LINES="$(printf '%s\n' "$TOC_LISTING" | grep -c '^[0-9]' || true)"
# A Tewiz dump has hundreds of TOC entries (77 migrations' worth of tables,
# indexes, constraints, PostGIS objects). Anything tiny means we dumped an empty
# or wrong database. Overridable only so the scripts can be exercised against a
# small scratch cluster — never lower it on the production box.
MIN_TOC_OBJECTS="${MIN_TOC_OBJECTS:-50}"
if [ "$TOC_LINES" -lt "$MIN_TOC_OBJECTS" ]; then
  die "dump has only $TOC_LINES objects (expected >= $MIN_TOC_OBJECTS) — wrong
       database? NOT rotating old dumps."
fi

SIZE_BYTES="$(wc -c < "$DUMP" | tr -d ' ')"
SHA="$( (command -v sha256sum >/dev/null && sha256sum "$DUMP" | cut -d' ' -f1) \
        || shasum -a 256 "$DUMP" | cut -d' ' -f1 )"

{
  echo "# tewiz db backup manifest"
  echo "created_at=$TS"
  echo "dump_file=$(basename "$DUMP")"
  echo "dump_bytes=$SIZE_BYTES"
  echo "dump_sha256=$SHA"
  echo "dump_seconds=$ELAPSED"
  echo "toc_objects=$TOC_LINES"
  # Just the numeric version. `awk '{print $NF}'` would capture "(Homebrew)" on a
  # dev Mac. The version matters at restore time: pg_restore refuses an archive
  # produced by a NEWER pg_dump than itself.
  echo "pg_dump_version=$(pg_dump --version | grep -oE '[0-9]+(\.[0-9]+)+' | head -1)"
  echo "$LIVE_MANIFEST"
} > "$MANIFEST"

log "ok bytes=$SIZE_BYTES objects=$TOC_LINES seconds=$ELAPSED sha=${SHA:0:12}"

# --- 4. Off-site copy ---------------------------------------------------------
# This is the whole point. Everything above only protects against a bad
# migration; only this step protects against losing the machine.
OFFSITE_DONE=0

if [ -n "$BACKUP_S3_BUCKET" ]; then
  command -v aws >/dev/null || die "BACKUP_S3_BUCKET set but the aws CLI is missing"
  log "uploading to s3://$BACKUP_S3_BUCKET/db/"
  # Scope the credentials to this command only — never export them into the
  # shell where the rest of the script (and any child) could leak them.
  S3_ARGS=()
  [ -n "$BACKUP_S3_ENDPOINT" ] && S3_ARGS+=(--endpoint-url "$BACKUP_S3_ENDPOINT")
  for f in "$DUMP" "$MANIFEST"; do
    if ! AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY" \
         AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_KEY" \
         AWS_DEFAULT_REGION="${BACKUP_S3_REGION:-auto}" \
         aws s3 cp "$f" "s3://$BACKUP_S3_BUCKET/db/$(basename "$f")" \
             "${S3_ARGS[@]}" --only-show-errors; then
      die "off-site upload failed for $(basename "$f")"
    fi
  done
  OFFSITE_DONE=1
fi

if [ -n "$BACKUP_SSH_TARGET" ]; then
  command -v rsync >/dev/null || die "BACKUP_SSH_TARGET set but rsync is missing"
  log "rsync -> $BACKUP_SSH_TARGET"
  # -e 'ssh -o BatchMode=yes' so a missing key fails immediately instead of
  # hanging a cron job on a password prompt forever.
  if ! rsync -a --partial -e 'ssh -o BatchMode=yes -o ConnectTimeout=15' \
        "$DUMP" "$MANIFEST" "$BACKUP_SSH_TARGET/"; then
    die "off-site rsync failed"
  fi
  OFFSITE_DONE=1
fi

if [ -n "$BACKUP_RCLONE_REMOTE" ]; then
  command -v rclone >/dev/null || die "BACKUP_RCLONE_REMOTE set but rclone is missing.
       Install it with: curl https://rclone.org/install.sh | sudo bash
       Then configure the remote once: rclone config"
  log "rclone copy -> $BACKUP_RCLONE_REMOTE/db/"
  # `copyto` with an explicit destination filename, one file at a time, rather
  # than `sync` on the directory: sync would MIRROR local deletions to the remote,
  # so the local KEEP rotation would silently delete the off-site copies too — the
  # exact opposite of what a second location is for.
  #
  # --config is passed explicitly because cron runs with a bare environment and
  # rclone would otherwise look for its config relative to a $HOME that may not be
  # set, then fail with "didn't find section in config file".
  RCLONE_ARGS=(--config "${RCLONE_CONFIG:-$HOME/.config/rclone/rclone.conf}")
  for f in "$DUMP" "$MANIFEST"; do
    if ! rclone copyto "$f" "$BACKUP_RCLONE_REMOTE/db/$(basename "$f")" \
          "${RCLONE_ARGS[@]}" --no-traverse; then
      die "rclone upload failed for $(basename "$f").
       If this used to work, the OAuth token may have expired or been revoked —
       re-run: rclone config reconnect ${BACKUP_RCLONE_REMOTE%%:*}:"
    fi
  done

  # Remote retention. Opt-in only: pruning is destructive, and a misconfigured
  # value here would delete the only copies that survive losing the VPS. Empty
  # means "never prune", which fills the quota but never loses data.
  if [ -n "$BACKUP_REMOTE_KEEP_DAYS" ]; then
    log "pruning remote copies older than ${BACKUP_REMOTE_KEEP_DAYS}d"
    # --drive-use-trash=false so deletions actually free Drive quota instead of
    # sitting in the trash still counting against it. Ignored by other backends.
    rclone delete "$BACKUP_RCLONE_REMOTE/db/" \
      "${RCLONE_ARGS[@]}" \
      --min-age "${BACKUP_REMOTE_KEEP_DAYS}d" \
      --drive-use-trash=false \
      || log "WARN remote prune failed — copies kept, quota may fill up"
  fi
  OFFSITE_DONE=1
fi

if [ "$OFFSITE_DONE" -eq 0 ]; then
  if [ "$ALLOW_LOCAL_ONLY" = "1" ]; then
    log "WARN no off-site target configured — ALLOW_LOCAL_ONLY=1, continuing."
    log "WARN this dump lives on the same disk it is meant to protect."
  else
    die "no off-site target configured (BACKUP_S3_BUCKET, BACKUP_SSH_TARGET or
       BACKUP_RCLONE_REMOTE). A dump that never leaves the VPS does not survive
       losing the VPS. Set one in .env, or pass ALLOW_LOCAL_ONLY=1 for local
       dev only."
  fi
fi

# --- 5. Rotate ----------------------------------------------------------------
# Only reached once the new dump is verified AND off-site, so we never delete a
# good old dump to make room for a bad new one.
{ ls -1t "$BACKUP_DIR"/tewiz-*.dump 2>/dev/null || true; } \
  | tail -n +$((KEEP + 1)) \
  | while read -r old; do
      log "rotating out $(basename "$old")"
      rm -f "$old" "${old%.dump}.manifest"
    done

log "done keep_last=$KEEP offsite=$OFFSITE_DONE"
