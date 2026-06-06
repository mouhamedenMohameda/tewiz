#!/usr/bin/env bash
# Phase 6 e2e:
#   1. Road reports — create, vote, list, dispatch
#   2. Heatmap — compute after rides, list cells
#   3. Doc expiry — force expiry in DB, run job, verify captain suspended
set -euo pipefail

API=${API:-http://localhost:3000}
PHONE_CAPT="+22245888888"
PHONE_RIDER="+22245777777"
PHONE_ADMIN="+22245999999"

# Nouakchott bounding box
MIN_LAT=18.04; MAX_LAT=18.12
MIN_LNG=-16.02; MAX_LNG=-15.93

# Test location somewhere in TZ
REPORT_LAT=18.0860
REPORT_LNG=-15.9785

pyjson() { python3 -c "import sys,json;d=json.load(sys.stdin);$1"; }
step() { printf "\n\033[1;36m▶ %s\033[0m\n" "$*"; }
ok()   { printf "  \033[0;32m✓\033[0m %s\n" "$*"; }
fail() { printf "  \033[0;31m✗\033[0m %s\n" "$*"; exit 1; }

export PGPASSWORD='ceYt3lpVFlWnUl9Cwc1NagvUQc77u9IU9gV6m9hAXRk='
psql_q() { psql -h localhost -U tewiz -d tewiz -c "$1"; }

# Pre-flight: approved captain + funded wallet + rider exists
step "Pre-flight (re-runs Phase 5 setup)"
bash /Users/mohameda/Desktop/course/scripts/test-phase5-flow.sh >/dev/null 2>&1
ok "Captain + rider + wallet ready"

# Cleanup leftover road reports from previous runs
psql_q "DELETE FROM road_report_votes; DELETE FROM road_reports; DELETE FROM demand_heatmap" >/dev/null

get_token() {
  local PHONE=$1; local ROLE=$2; local DEV=$3
  local R=$(curl -sX POST "$API/auth/otp/request" -H 'Content-Type: application/json' -d "{\"phone\":\"$PHONE\"}")
  local CODE=$(echo "$R" | pyjson 'print(d["_devCode"])')
  R=$(curl -sX POST "$API/auth/otp/verify" -H 'Content-Type: application/json' \
       -d "{\"phone\":\"$PHONE\",\"code\":\"$CODE\",\"role\":\"$ROLE\",\"deviceId\":\"$DEV\"}")
  echo "$R" | pyjson 'print(d["tokens"]["accessToken"])'
}

# Clear admin OTPs to avoid rate limit
psql_q "DELETE FROM otp_codes WHERE phone = '$PHONE_ADMIN'" >/dev/null

step "Tokens"
CAPT_TOKEN=$(get_token "$PHONE_CAPT" captain phase6-captain-001)
RIDER_TOKEN=$(get_token "$PHONE_RIDER" rider phase6-rider-001)
ADMIN_TOKEN=$(get_token "$PHONE_ADMIN" admin phase6-admin-001)
ok "All 3 tokens"

# ──────────────────────────────────────────────────────────────────────────
step "1) Captain creates a sand-blockage report"
R=$(curl -sX POST "$API/road-reports" \
     -H "Authorization: Bearer $CAPT_TOKEN" -H 'Content-Type: application/json' \
     -d "{\"lat\":$REPORT_LAT,\"lng\":$REPORT_LNG,\"reason\":\"sand\",\"note\":\"Bloqué après la mosquée\"}")
REPORT_ID=$(echo "$R" | pyjson 'print(d["id"])')
ok "Report id: $REPORT_ID"

step "Trying duplicate (same reason, within 50m) → must fail"
HTTP=$(curl -s -o /tmp/resp -w "%{http_code}" -X POST "$API/road-reports" \
        -H "Authorization: Bearer $CAPT_TOKEN" -H 'Content-Type: application/json' \
        -d "{\"lat\":$REPORT_LAT,\"lng\":$REPORT_LNG,\"reason\":\"sand\"}")
[ "$HTTP" = "409" ] && ok "Refused with 409 (duplicate_nearby)" || fail "Expected 409, got $HTTP"

step "Rider lists active reports in Nouakchott bbox"
N=$(curl -sX GET "$API/road-reports?minLat=$MIN_LAT&maxLat=$MAX_LAT&minLng=$MIN_LNG&maxLng=$MAX_LNG" \
     -H "Authorization: Bearer $RIDER_TOKEN" | pyjson 'print(len(d))')
[ "$N" -ge 1 ] && ok "$N report(s) visible" || fail "Expected ≥1, got $N"

step "Rider confirms the report"
R=$(curl -sX POST "$API/road-reports/$REPORT_ID/vote" \
     -H "Authorization: Bearer $RIDER_TOKEN" -H 'Content-Type: application/json' \
     -d '{"confirm":true}')
C=$(echo "$R" | pyjson 'print(d["confirmations"])')
[ "$C" = "1" ] && ok "Confirmations=1" || fail "Got $C"

step "Admin removes a report"
curl -sX DELETE "$API/admin/road-reports/$REPORT_ID" \
     -H "Authorization: Bearer $ADMIN_TOKEN" >/dev/null
ok "Admin removed"

step "Cron: expire-road-reports (idempotent)"
R=$(curl -sX POST "$API/admin/jobs/expire-road-reports" -H "Authorization: Bearer $ADMIN_TOKEN")
echo "$R" | pyjson 'print("    expired:", d["expired"])'

# ──────────────────────────────────────────────────────────────────────────
step "2) Heatmap"

# Create 3 ride requests at slightly different locations to seed the heatmap
for off in "0.001 0.001" "-0.002 0.001" "0.001 -0.002"; do
  read DLAT DLNG <<< "$off"
  PL=$(echo "$REPORT_LAT $DLAT" | awk '{print $1+$2}')
  PG=$(echo "$REPORT_LNG $DLNG" | awk '{print $1+$2}')
  curl -sX POST "$API/rider/rides" \
    -H "Authorization: Bearer $RIDER_TOKEN" -H 'Content-Type: application/json' \
    -d "{
      \"pickup\":{\"lat\":$PL,\"lng\":$PG},
      \"dropoff\":{\"lat\":18.05,\"lng\":-15.95}
    }" >/dev/null
  # Immediately cancel so the rider isn't locked in next iteration
  RID=$(curl -sX GET "$API/rider/rides/current" -H "Authorization: Bearer $RIDER_TOKEN" | pyjson 'print(d["id"])')
  curl -sX POST "$API/rider/rides/$RID/cancel" \
    -H "Authorization: Bearer $RIDER_TOKEN" -H 'Content-Type: application/json' \
    -d '{"reason":"test heatmap"}' >/dev/null
done
ok "Seeded 3 ride requests"

step "Cron: compute-heatmap"
R=$(curl -sX POST "$API/admin/jobs/compute-heatmap" -H "Authorization: Bearer $ADMIN_TOKEN")
CELLS=$(echo "$R" | pyjson 'print(d["cells"])')
RIDES=$(echo "$R" | pyjson 'print(d["recentRides"])')
[ "$CELLS" -ge "1" ] && ok "Computed: $CELLS cell(s) from $RIDES recent ride(s)" || fail "Cells=$CELLS"

step "Captain reads heatmap"
N=$(curl -sX GET "$API/captain/heatmap" -H "Authorization: Bearer $CAPT_TOKEN" | pyjson 'print(len(d))')
[ "$N" -ge "1" ] && ok "Captain sees $N hex(es)" || fail "No hexes returned"

# ──────────────────────────────────────────────────────────────────────────
step "3) Doc expiry → auto-suspend captain"

# Force an assurance doc into the past, in DB
psql_q "UPDATE application_documents
          SET expires_at = current_date - INTERVAL '1 day'
        WHERE type = 'assurance'
          AND application_id IN (
            SELECT id FROM captain_applications WHERE phone = '$PHONE_CAPT'
          )" >/dev/null
ok "Forced assurance to expired"

step "Cron: expire-documents"
R=$(curl -sX POST "$API/admin/jobs/expire-documents" -H "Authorization: Bearer $ADMIN_TOKEN")
EX=$(echo "$R" | pyjson 'print(d["expiredDocuments"])')
SU=$(echo "$R" | pyjson 'print(d["suspendedCaptains"])')
[ "$EX" -ge "1" ] && ok "Expired $EX document(s)" || fail "EX=$EX"
[ "$SU" -ge "1" ] && ok "Suspended $SU captain(s)" || fail "SU=$SU"

step "Captain tries to go online → must be refused"
HTTP=$(curl -s -o /tmp/resp -w "%{http_code}" -X POST "$API/captain/state/online" \
        -H "Authorization: Bearer $CAPT_TOKEN" -H 'Content-Type: application/json' \
        -d "{\"lat\":$REPORT_LAT,\"lng\":$REPORT_LNG}")
[ "$HTTP" = "403" ] && ok "403 (captain_suspended)" || fail "Expected 403, got $HTTP. Body: $(cat /tmp/resp)"

printf "\n\033[1;32m✔ Phase 6 (road reports + heatmap + expiry) OK\033[0m\n"
