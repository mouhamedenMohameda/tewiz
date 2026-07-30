#!/usr/bin/env bash
# Restore a Tewiz dump and PROVE it worked, by diffing the restored row counts
# against the manifest that scripts/backup-db.sh wrote next to the dump.
#
# Why this script exists:
#   A backup you have never restored is not a backup, it is a hope. The failure
#   mode is always the same: the dumps were fine, but nobody knew the restore
#   needed PostGIS created first / a different postgres role / 40 minutes, and
#   they found out during the outage. Running this monthly against the latest
#   dump turns disaster recovery from an unknown into a measured number.
#
# Default mode is a DRILL and is safe to run on the prod box:
#   it restores into a throwaway database, verifies, prints the timing, drops it.
#   The live `tewiz` database is never touched.
#
# Usage:
#   # Monthly drill against the newest local dump (safe):
#   scripts/restore-db.sh
#
#   # Drill a specific dump:
#   scripts/restore-db.sh /var/backups/tewiz-db/tewiz-20260730T020000Z.dump
#
#   # Keep the scratch DB afterwards to poke at it:
#   KEEP_SCRATCH=1 scripts/restore-db.sh
#
#   # REAL disaster recovery on a fresh box, into the real database name:
#   scripts/restore-db.sh <dump> --into tewiz
#     (refuses if that database already has tables, unless --force)
#
# Exit codes:
#   0  restored and every manifest check matched
#   1  restore failed, or the restored data does not match the manifest

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

log()  { echo "[restore-db] $*"; }
die()  { echo "[restore-db] ERROR $*" >&2; exit 1; }

env_get() {
  [ -f "$REPO_ROOT/.env" ] || return 0
  # `|| true` — see the note in backup-db.sh: without it, pipefail turns a missing
  # .env key into a silent exit 1.
  grep -E "^$1=" "$REPO_ROOT/.env" | tail -1 | cut -d= -f2- | tr -d '"' | tr -d "'" || true
}

DATABASE_URL="${DATABASE_URL:-$(env_get DATABASE_URL)}"
[ -n "$DATABASE_URL" ] || die "DATABASE_URL not set (env or .env)"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/tewiz-db}"

# --- Args --------------------------------------------------------------------
DUMP=""
TARGET_DB=""
FORCE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --into)  TARGET_DB="${2:-}"; shift 2 ;;
    --force) FORCE=1; shift ;;
    -*)      die "unknown flag: $1" ;;
    *)       DUMP="$1"; shift ;;
  esac
done

# Newest local dump by default.
if [ -z "$DUMP" ]; then
  # shellcheck disable=SC2012  # names are ours (tewiz-<timestamp>.dump), no spaces
  DUMP="$(ls -1t "$BACKUP_DIR"/tewiz-*.dump 2>/dev/null | head -1 || true)"
  [ -n "$DUMP" ] || die "no dump found in $BACKUP_DIR — pass one explicitly"
  log "using newest dump: $DUMP"
fi
[ -f "$DUMP" ] || die "dump not found: $DUMP"

MANIFEST="${DUMP%.dump}.manifest"
if [ ! -f "$MANIFEST" ]; then
  log "WARN no manifest beside this dump — restoring, but nothing to verify against"
fi

command -v pg_restore >/dev/null || die "pg_restore not found — install postgresql-client-16"
command -v psql       >/dev/null || die "psql not found — install postgresql-client-16"

DRILL=1
if [ -n "$TARGET_DB" ]; then
  DRILL=0
else
  TARGET_DB="tewiz_restore_drill_$(date -u +%Y%m%d%H%M%S)"
fi

# Swap the database name in a URL, preserving user/host/port/params. Postgres has
# no "create database" over a connection to that same database, so DDL goes
# through the maintenance `postgres` database.
url_with_db() {
  echo "$2" | sed -E "s#(://[^/]+)/[^?]*#\1/$1#"
}

# Restoring needs CREATEDB, which the application role deliberately may not have.
# Two ways to give this script that right:
#
#   1. Grant the app role the right — the practical default on this stack:
#        sudo -u postgres psql -c 'ALTER ROLE tewiz CREATEDB;'
#      It is a real widening, but a modest one: CREATEDB lets the role create
#      databases, nothing more. A holder of that role already reads every ride
#      and wallet row, so this changes little about a compromise.
#
#   2. RESTORE_ADMIN_URL in .env — a separate connection holding CREATEDB, used
#      ONLY by this script, leaving the app role untouched.
#      ⚠️ NOT simply the postgres superuser over the unix socket. A stock Debian
#      pg_hba.conf authenticates local connections with `peer`, so the postgres
#      role is reachable only from the postgres OS user — and this script runs as
#      root (both from cron and by hand), where peer auth refuses. Option 2 needs
#      a password-authenticated admin role over TCP, e.g.
#        CREATE ROLE tewiz_restore LOGIN PASSWORD '…' CREATEDB;
#        RESTORE_ADMIN_URL=postgres://tewiz_restore:…@127.0.0.1:5432/postgres
#
# When RESTORE_ADMIN_URL is set, the TARGET url is derived from it too: a database
# created by one role is not necessarily restorable by another.
RESTORE_ADMIN_URL="${RESTORE_ADMIN_URL:-$(env_get RESTORE_ADMIN_URL)}"
BASE_URL="${RESTORE_ADMIN_URL:-$DATABASE_URL}"
ADMIN_URL="$(url_with_db postgres "$BASE_URL")"
TARGET_URL="$(url_with_db "$TARGET_DB" "$BASE_URL")"

if ! ADMIN_PROBE="$(psql "$ADMIN_URL" -tAX -c 'SELECT 1' 2>&1)"; then
  # Name WHICH connection failed. The generic "cannot connect" sent someone
  # hunting a database outage when the real answer was peer authentication.
  if [ -n "$RESTORE_ADMIN_URL" ]; then
    die "RESTORE_ADMIN_URL is set but unusable. psql said:
       $(printf '%s' "$ADMIN_PROBE" | head -2)

       If that mentions peer authentication: a stock Debian pg_hba.conf lets the
       postgres role in only from the postgres OS user, and this script runs as
       root. Either remove RESTORE_ADMIN_URL from .env and grant the app role
       the right instead:
         sudo -u postgres psql -c 'ALTER ROLE tewiz CREATEDB;'
       or point RESTORE_ADMIN_URL at a password-authenticated admin role over
       TCP (see the header of this script)."
  fi
  die "cannot connect to the postgres maintenance database with DATABASE_URL.
       psql said: $(printf '%s' "$ADMIN_PROBE" | head -2)"
fi

# Check the privilege up front rather than letting CREATE DATABASE fail with a
# bare psql error. The monthly drill runs unattended: a failure there must say
# what to do, not just what went wrong.
CAN_CREATEDB="$(psql "$ADMIN_URL" -tAX -c \
  "SELECT rolcreatedb OR rolsuper FROM pg_roles WHERE rolname = current_user" 2>/dev/null || echo f)"
if [ "$CAN_CREATEDB" != "t" ]; then
  die "the role this script connects as cannot create databases, so the restore
       drill cannot run. Pick one:

         1. Grant the app role the right (simplest, and what production uses):
              sudo -u postgres psql -c 'ALTER ROLE tewiz CREATEDB;'

         2. Or give the drill a dedicated admin role over TCP, and put it in .env:
              sudo -u postgres psql -c \"CREATE ROLE tewiz_restore LOGIN PASSWORD 'x' CREATEDB\"
              RESTORE_ADMIN_URL=postgres://tewiz_restore:x@127.0.0.1:5432/postgres
            (the postgres superuser over the unix socket will NOT work from root
             — peer authentication refuses it)

       Then re-run:  bash scripts/restore-db.sh"
fi

# --- Guard the real database -------------------------------------------------
if [ "$DRILL" -eq 0 ]; then
  EXISTING_TABLES="$(psql "$TARGET_URL" -tAX -c \
    "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" 2>/dev/null || echo "nodb")"
  if [ "$EXISTING_TABLES" != "nodb" ] && [ "$EXISTING_TABLES" != "0" ]; then
    if [ "$FORCE" -ne 1 ]; then
      die "database '$TARGET_DB' already has $EXISTING_TABLES tables.
       Restoring into it would overwrite live data. If that is genuinely what
       you want, re-run with --force. On a fresh recovery box the target should
       be empty, which needs no flag."
    fi
    log "WARN --force: restoring over $EXISTING_TABLES existing tables in '$TARGET_DB'"
    printf "[restore-db] type the database name to confirm: "
    read -r CONFIRM
    [ "$CONFIRM" = "$TARGET_DB" ] || die "confirmation did not match — aborted"
  fi
fi

# shellcheck disable=SC2329  # invoked indirectly by the EXIT trap below
cleanup() {
  if [ "$DRILL" -eq 1 ] && [ "${KEEP_SCRATCH:-0}" != "1" ]; then
    log "dropping scratch database $TARGET_DB"
    psql "$ADMIN_URL" -qX -c "DROP DATABASE IF EXISTS \"$TARGET_DB\"" >/dev/null 2>&1 || true
  elif [ "$DRILL" -eq 1 ]; then
    log "KEEP_SCRATCH=1 — leaving $TARGET_DB in place. Drop it yourself:"
    log "  psql \"\$ADMIN_URL\" -c 'DROP DATABASE \"$TARGET_DB\"'"
  fi
}
trap cleanup EXIT

# --- Create the target -------------------------------------------------------
if [ "$DRILL" -eq 1 ]; then
  log "creating scratch database $TARGET_DB"
  psql "$ADMIN_URL" -qX -c "CREATE DATABASE \"$TARGET_DB\"" >/dev/null
else
  psql "$ADMIN_URL" -qX -c "CREATE DATABASE \"$TARGET_DB\"" >/dev/null 2>&1 || true
fi

# PostGIS must exist before the geography columns are restored. The dump does
# contain CREATE EXTENSION, but creating it up front means a role without
# superuser still gets a clean restore when the extension is pre-whitelisted,
# and makes the failure legible when it is not.
#
# Gated on the archive actually referencing postgis, so this script also works on
# a dump that predates it. Every real Tewiz dump does reference it — locations are
# GEOGRAPHY(POINT, 4326) throughout — so on the production box this always runs.
POSTGIS_OWNED_BY_SUPERUSER=0
if pg_restore --list "$DUMP" 2>/dev/null | grep -qi 'postgis'; then
  log "dump requires postgis — creating the extension first"
  # PostGIS is not a "trusted" extension, so CREATE EXTENSION needs superuser.
  # The application role is not one, and should not become one just to run a
  # drill. When this script runs as root — which it does from the monthly cron
  # and by hand on the VPS — it can borrow the postgres superuser over the local
  # socket, where Debian's peer authentication accepts it.
  #
  # Order matters: try as the connecting role first, so a setup where the role IS
  # superuser (or postgis is preinstalled) never needs sudo at all.
  if psql "$TARGET_URL" -qX -c "CREATE EXTENSION IF NOT EXISTS postgis" >/dev/null 2>&1; then
    :
  elif [ "$(id -u)" = "0" ] && command -v sudo >/dev/null 2>&1 \
       && sudo -u postgres psql -qX -d "$TARGET_DB" \
            -c "CREATE EXTENSION IF NOT EXISTS postgis" >/dev/null 2>&1; then
    # The extension ends up owned by postgres while the tables are restored by the
    # app role. The geography columns restore and query fine — extensions install
    # into `public`, which grants USAGE to everyone — but the app role is NOT the
    # extension's owner, so two entries in the dump's TOC will fail:
    #   COMMENT ON EXTENSION postgis  -> must be owner of extension postgis
    #   COPY public.spatial_ref_sys   -> permission denied for table spatial_ref_sys
    # Both are benign, and are whitelisted below. Neither carries Tewiz data:
    # the comment is cosmetic, and CREATE EXTENSION already populated
    # spatial_ref_sys with the same ~8500 EPSG rows the dump is trying to insert.
    POSTGIS_OWNED_BY_SUPERUSER=1
    log "  created via the postgres superuser (the app role is not one)"
  else
    die "cannot create the postgis extension in $TARGET_DB.
       Tried the connecting role, then the postgres superuser over the local
       socket. Check in order:
         - is PostGIS installed?   apt install postgresql-16-postgis-3
         - is the database local?  the superuser fallback only reaches the local
           socket, so a remote DATABASE_URL cannot use it
         - running as root?        the fallback needs it (the cron does)
       This is exactly the surprise a drill is meant to find — on a real recovery
       box you would have hit it with the platform down."
  fi
fi

# --- Restore -----------------------------------------------------------------
log "restoring $(basename "$DUMP") -> $TARGET_DB"
START=$(date +%s)
RESTORE_LOG="$(mktemp)"
# --exit-on-error is deliberately NOT used: the postgis objects we created above
# collide with the dump's own, and those benign errors must not abort an
# otherwise perfect restore. We count and show the errors instead.
# -j is left off: on a 1-box setup, parallel restore starves the live API of IO.
#
# What counts as benign, and why — all three are the postgis extension, never
# Tewiz data. Note how narrow the patterns are: "permission denied for table"
# on any table other than spatial_ref_sys is a REAL failure and still fails the
# drill, which is the whole point of running one.
BENIGN_RE='extension "postgis" already exists'
BENIGN_RE="$BENIGN_RE"'|must be owner of extension postgis'
BENIGN_RE="$BENIGN_RE"'|(permission denied for|must be owner of) (table|relation) spatial_ref_sys'
if ! pg_restore --dbname="$TARGET_URL" \
      --no-owner --no-privileges \
      "$DUMP" > "$RESTORE_LOG" 2>&1; then
  ERRORS="$(grep -c 'error:' "$RESTORE_LOG" || true)"
  BENIGN="$(grep -cE "$BENIGN_RE" "$RESTORE_LOG" || true)"
  if [ "$ERRORS" -gt "$BENIGN" ]; then
    log "pg_restore reported $ERRORS error(s) ($BENIGN benign). First 20:"
    grep 'error:' "$RESTORE_LOG" | head -20 >&2
    rm -f "$RESTORE_LOG"
    die "restore failed"
  fi
  if [ "$POSTGIS_OWNED_BY_SUPERUSER" -eq 1 ]; then
    log "pg_restore: $ERRORS benign error(s) — postgis is owned by the postgres"
    log "  superuser here, so its comment and spatial_ref_sys rows were skipped."
  else
    log "pg_restore: $ERRORS benign error(s) (postgis already present) — ok"
  fi
fi
rm -f "$RESTORE_LOG"
ELAPSED=$(( $(date +%s) - START ))
log "restore finished in ${ELAPSED}s"

# --- Verify against the manifest ---------------------------------------------
FAILED=0
if [ -f "$MANIFEST" ]; then
  log "verifying row counts against manifest"
  check() {
    local key="$1" sql="$2" expected actual
    expected="$(grep -E "^$key=" "$MANIFEST" | tail -1 | cut -d= -f2- || true)"
    [ -n "$expected" ] || return 0
    actual="$(psql "$TARGET_URL" -tAX -c "$sql")"
    if [ "$actual" = "$expected" ]; then
      printf '  ok   %-22s %s\n' "$key" "$actual"
    else
      printf '  FAIL %-22s expected=%s restored=%s\n' "$key" "$expected" "$actual"
      FAILED=1
    fi
  }
  check users               "SELECT count(*) FROM users"
  check captains            "SELECT count(*) FROM captains"
  check rides               "SELECT count(*) FROM rides"
  check wallets             "SELECT count(*) FROM wallets"
  check wallet_transactions "SELECT count(*) FROM wallet_transactions"
  check topup_requests      "SELECT count(*) FROM topup_requests"
  check wallet_balance_sum  "SELECT COALESCE(sum(balance_mru),0) FROM wallets"
  check wallet_txn_sum      "SELECT COALESCE(sum(amount_mru),0) FROM wallet_transactions"
fi

# --- Verify the money invariant ----------------------------------------------
# db/migrations enforces `wallets.balance_mru == SUM(wallet_transactions.amount_mru)`
# via trg_wallet_balance_consistency, but a trigger only fires on writes — a
# restore inserts rows without re-asserting it. Since the wallet IS the commission
# model, check it explicitly: a restore that silently breaks wallet integrity is
# worse than no restore, because it looks like it worked.
#
# Both tables key on captain_id (wallets.captain_id is the PRIMARY KEY; there is
# no wallets.id and no wallet_transactions.wallet_id). Column names are post-0017.
log "checking wallet integrity invariant"
DRIFT="$(psql "$TARGET_URL" -tAX -c "
  SELECT count(*)
    FROM wallets w
    LEFT JOIN (
      SELECT captain_id, COALESCE(sum(amount_mru),0) AS s
        FROM wallet_transactions GROUP BY captain_id
    ) t ON t.captain_id = w.captain_id
   WHERE w.balance_mru <> COALESCE(t.s, 0)
" 2>/dev/null || echo "skip")"
if [ "$DRIFT" = "skip" ]; then
  # Never let this degrade to a passing run: the invariant is the one check that
  # speaks directly to money owed to captains. A schema drift here must fail.
  log "  FAIL could not run the invariant check — schema drift? Update the query"
  log "       in scripts/restore-db.sh to match the current wallet schema."
  FAILED=1
elif [ "$DRIFT" = "0" ]; then
  log "  ok   every wallet balance equals the sum of its transactions"
else
  log "  FAIL $DRIFT wallet(s) disagree with their transaction ledger"
  FAILED=1
fi

echo
if [ "$FAILED" -eq 0 ]; then
  log "RESTORE VERIFIED — dump=$(basename "$DUMP") restore_seconds=$ELAPSED"
  [ "$DRILL" -eq 1 ] && log "That ${ELAPSED}s is your real RTO for the database. Write it down."
  exit 0
else
  die "RESTORE VERIFICATION FAILED for $(basename "$DUMP") — treat this dump as unusable"
fi
