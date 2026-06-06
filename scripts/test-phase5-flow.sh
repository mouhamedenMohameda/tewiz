#!/usr/bin/env bash
# Phase 5 differentiators e2e:
#   1. Favorites — rider marks captain favorite, dispatch should boost
#   2. Home + going-home mode — set home, toggle, dispatch homeward bonus
#   3. Colis — recipient OTP at delivery
#   4. Course pour quelqu'un d'autre — SMS confirmation by passenger
#   5. Course récurrente — propose, accept, processOccurrences
set -euo pipefail

API=${API:-http://localhost:3000}
PHONE_CAPT="+22245888888"
PHONE_RIDER="+22245777777"
PHONE_ADMIN="+22245999999"
PHONE_PASSENGER="+22245666666"   # "For someone else" passenger (no app)
PHONE_RECIPIENT="+22245555555"   # Colis recipient (no app)

# Tevragh Zeina → Sebkha
PICKUP_LAT=18.0860; PICKUP_LNG=-15.9785
DROPOFF_LAT=18.0700; DROPOFF_LNG=-15.9650
# Captain's "home" (somewhere south of Sebkha, so a Sebkha-bound ride brings them closer)
HOME_LAT=18.0500; HOME_LNG=-15.9500

pyjson() { python3 -c "import sys,json;d=json.load(sys.stdin);$1"; }
step() { printf "\n\033[1;36m▶ %s\033[0m\n" "$*"; }
ok()   { printf "  \033[0;32m✓\033[0m %s\n" "$*"; }
fail() { printf "  \033[0;31m✗\033[0m %s\n" "$*"; exit 1; }

# Pre-flight: approved captain with wallet
step "Pre-flight: approved captain + wallet"
bash /Users/mohameda/Desktop/course/scripts/test-wallet-flow.sh >/dev/null 2>&1
ok "Captain ready"

# Cleanup
pnpm --silent --filter @tewiz/api clean:test-rider "$PHONE_RIDER" >/dev/null 2>&1 || true
pnpm --silent --filter @tewiz/api clean:test-rider "$PHONE_PASSENGER" >/dev/null 2>&1 || true
PGPASSWORD='ceYt3lpVFlWnUl9Cwc1NagvUQc77u9IU9gV6m9hAXRk=' psql -h localhost -U tewiz -d tewiz \
  -c "DELETE FROM otp_codes WHERE phone IN ('$PHONE_PASSENGER','$PHONE_RECIPIENT','$PHONE_ADMIN','$PHONE_CAPT','$PHONE_RIDER')" >/dev/null

# Tokens
get_token() {
  local PHONE=$1; local ROLE=$2; local DEV=$3
  local R=$(curl -sX POST "$API/auth/otp/request" -H 'Content-Type: application/json' -d "{\"phone\":\"$PHONE\"}")
  local CODE=$(echo "$R" | pyjson 'print(d["_devCode"])')
  R=$(curl -sX POST "$API/auth/otp/verify" -H 'Content-Type: application/json' \
       -d "{\"phone\":\"$PHONE\",\"code\":\"$CODE\",\"role\":\"$ROLE\",\"deviceId\":\"$DEV\"}")
  echo "$R" | pyjson 'print(d["tokens"]["accessToken"])'
}

step "Tokens"
RIDER_TOKEN=$(get_token "$PHONE_RIDER" rider phase5-rider)
CAPT_TOKEN=$(get_token "$PHONE_CAPT" captain phase5-captain)
ok "Rider + captain tokens"

# ──────────────────────────────────────────────────────────────────────────
step "1) Favorites"

# Get captain id (from a quick ride to know it, or query). We'll fetch the captain's user id via /captain endpoint indirectly.
# Easier: query DB.
CAPT_ID=$(PGPASSWORD='ceYt3lpVFlWnUl9Cwc1NagvUQc77u9IU9gV6m9hAXRk=' psql -h localhost -U tewiz -d tewiz -t -A -c "SELECT id FROM users WHERE phone = '$PHONE_CAPT'")
ok "Captain id: $CAPT_ID"

R=$(curl -sX POST "$API/rider/favorites" \
     -H "Authorization: Bearer $RIDER_TOKEN" -H 'Content-Type: application/json' \
     -d "{\"captainId\":\"$CAPT_ID\",\"nickname\":\"Mohamed mon chauffeur\"}")
echo "$R" | grep -q "$CAPT_ID" && ok "Favorite added" || fail "Add favorite failed: $R"

N=$(curl -sX GET "$API/rider/favorites" -H "Authorization: Bearer $RIDER_TOKEN" | pyjson 'print(len(d))')
[ "$N" -ge 1 ] && ok "Favorites count: $N" || fail "List favorites failed"

# ──────────────────────────────────────────────────────────────────────────
step "2) Home + Going-home"

# Captain online at "home" location first
curl -sX POST "$API/captain/state/online" -H "Authorization: Bearer $CAPT_TOKEN" \
     -H 'Content-Type: application/json' \
     -d "{\"lat\":$HOME_LAT,\"lng\":$HOME_LNG}" >/dev/null

# Set home (captain must be physically there)
R=$(curl -sX POST "$API/captain/home" \
     -H "Authorization: Bearer $CAPT_TOKEN" -H 'Content-Type: application/json' \
     -d "{\"lat\":$HOME_LAT,\"lng\":$HOME_LNG,\"label\":\"Arafat\",\"currentLat\":$HOME_LAT,\"currentLng\":$HOME_LNG}")
echo "$R" | grep -q lockedUntil && ok "Home set, locked 30d" || fail "Set home failed: $R"

# Move captain back near pickup, then start going-home
curl -sX POST "$API/captain/state/online" -H "Authorization: Bearer $CAPT_TOKEN" \
     -H 'Content-Type: application/json' \
     -d "{\"lat\":$PICKUP_LAT,\"lng\":$PICKUP_LNG}" >/dev/null

R=$(curl -sX POST "$API/captain/state/going-home" -H "Authorization: Bearer $CAPT_TOKEN")
echo "$R" | grep -q '"status":"active"' && ok "Going-home session active" || fail "Going-home failed: $R"

# ──────────────────────────────────────────────────────────────────────────
step "3) Inbox should boost Sebkha-bound ride (homeward) + favorite"

# Rider creates a ride dropping at Sebkha (which is between pickup and home)
R=$(curl -sX POST "$API/rider/rides" \
     -H "Authorization: Bearer $RIDER_TOKEN" -H 'Content-Type: application/json' \
     -d "{
       \"pickup\":{\"lat\":$PICKUP_LAT,\"lng\":$PICKUP_LNG,\"label\":\"Tevragh Zeina\"},
       \"dropoff\":{\"lat\":$DROPOFF_LAT,\"lng\":$DROPOFF_LNG,\"label\":\"Sebkha\"}
     }")
RIDE_ID=$(echo "$R" | pyjson 'print(d["id"])')
VCODE=$(echo "$R" | pyjson 'print(d["verificationCode"])')
ok "Ride created: $RIDE_ID"

INBOX=$(curl -sX GET "$API/captain/rides/inbox" -H "Authorization: Bearer $CAPT_TOKEN")
echo "$INBOX" | pyjson 'print("    inbox items:", len(d))'
echo "$INBOX" | pyjson '
for r in d:
    print("     {} fav={} homeward_m={}".format(r["id"][:8], r["isFavorite"], r["homewardProgressM"]))
'
echo "$INBOX" | pyjson 'assert d[0]["isFavorite"] is True, "Top ride should be favorite"' && ok "Top inbox item is favorite"
echo "$INBOX" | pyjson 'assert d[0]["homewardProgressM"] is not None and d[0]["homewardProgressM"] > 0, "Should bring captain closer to home"' && ok "Ride brings captain closer to home"

# End going-home (don't pollute later tests)
curl -sX DELETE "$API/captain/state/going-home" -H "Authorization: Bearer $CAPT_TOKEN" >/dev/null

# ──────────────────────────────────────────────────────────────────────────
step "4) Captain accepts and completes (normal flow still works)"

curl -sX POST "$API/captain/rides/$RIDE_ID/accept" -H "Authorization: Bearer $CAPT_TOKEN" >/dev/null
curl -sX POST "$API/captain/rides/$RIDE_ID/arrive" -H "Authorization: Bearer $CAPT_TOKEN" >/dev/null
curl -sX POST "$API/captain/rides/$RIDE_ID/start" -H "Authorization: Bearer $CAPT_TOKEN" \
     -H 'Content-Type: application/json' -d "{\"code\":\"$VCODE\"}" >/dev/null
R=$(curl -sX POST "$API/captain/rides/$RIDE_ID/complete" -H "Authorization: Bearer $CAPT_TOKEN" \
     -H 'Content-Type: application/json' -d '{"actualDistanceM":2500}')
S=$(echo "$R" | pyjson 'print(d["ride"]["status"])')
[ "$S" = "completed" ] && ok "Ride completed" || fail "Status: $S"

# ──────────────────────────────────────────────────────────────────────────
step "5) Course pour quelqu'un d'autre"

# Reset captain to online state
curl -sX POST "$API/captain/state/online" -H "Authorization: Bearer $CAPT_TOKEN" \
     -H 'Content-Type: application/json' \
     -d "{\"lat\":$PICKUP_LAT,\"lng\":$PICKUP_LNG}" >/dev/null

R=$(curl -sX POST "$API/rider/rides" \
     -H "Authorization: Bearer $RIDER_TOKEN" -H 'Content-Type: application/json' \
     -d "{
       \"pickup\":{\"lat\":$PICKUP_LAT,\"lng\":$PICKUP_LNG},
       \"dropoff\":{\"lat\":$DROPOFF_LAT,\"lng\":$DROPOFF_LNG},
       \"passengerName\":\"Fatma\",
       \"passengerPhone\":\"$PHONE_PASSENGER\"
     }")
OTHER_RIDE=$(echo "$R" | pyjson 'print(d["id"])')
S=$(echo "$R" | pyjson 'print(d["status"])')
[ "$S" = "pending_passenger_confirm" ] && ok "Status: pending_passenger_confirm" || fail "Status: $S"

# Fetch the OTP from DB (since SMS is mocked)
OTP=$(PGPASSWORD='ceYt3lpVFlWnUl9Cwc1NagvUQc77u9IU9gV6m9hAXRk=' psql -h localhost -U tewiz -d tewiz -t -A -c "
  SELECT 'check_from_log' AS msg
")
# Code is hashed in DB; for testing we read it from the API log (mock SMS prints it).
OTP=$(curl -sG --data-urlencode "phone=$PHONE_PASSENGER" "$API/dev/mock-sms" \
       | pyjson 'import re
for m in reversed(d):
    mm = re.search(r"Code: (\d{4,})", m["message"])
    if mm: print(mm.group(1)); break')
[ -n "$OTP" ] && ok "Captured passenger OTP from logs: $OTP" || fail "Could not find passenger OTP"

# Passenger confirms via public endpoint (no auth)
R=$(curl -sX POST "$API/public/rides/$OTHER_RIDE/confirm" \
     -H 'Content-Type: application/json' -d "{\"code\":\"$OTP\"}")
S=$(echo "$R" | pyjson 'print(d["status"])')
[ "$S" = "searching" ] && ok "Passenger confirmed → searching" || fail "Status: $S"

# Rider cancels to clean state
curl -sX POST "$API/rider/rides/$OTHER_RIDE/cancel" -H "Authorization: Bearer $RIDER_TOKEN" \
     -H 'Content-Type: application/json' -d '{"reason":"test cleanup"}' >/dev/null
ok "Cleaned"

# ──────────────────────────────────────────────────────────────────────────
step "6) Colis (with recipient OTP)"

R=$(curl -sX POST "$API/rider/rides" \
     -H "Authorization: Bearer $RIDER_TOKEN" -H 'Content-Type: application/json' \
     -d "{
       \"pickup\":{\"lat\":$PICKUP_LAT,\"lng\":$PICKUP_LNG},
       \"dropoff\":{\"lat\":$DROPOFF_LAT,\"lng\":$DROPOFF_LNG},
       \"rideType\":\"colis\",
       \"recipientName\":\"Khadija\",
       \"recipientPhone\":\"$PHONE_RECIPIENT\",
       \"packageDescription\":\"Documents importants\"
     }")
COLIS_ID=$(echo "$R" | pyjson 'print(d["id"])')
VCODE_C=$(echo "$R" | pyjson 'print(d["verificationCode"])')
ok "Colis ride created: $COLIS_ID"

curl -sX POST "$API/captain/rides/$COLIS_ID/accept" -H "Authorization: Bearer $CAPT_TOKEN" >/dev/null
ok "Captain accepted colis"

# Grab the drop OTP from the mock SMS log
DROP_OTP=$(curl -sG --data-urlencode "phone=$PHONE_RECIPIENT" "$API/dev/mock-sms" \
            | pyjson 'import re
for m in reversed(d):
    mm = re.search(r"Code de livraison: (\d{4,})", m["message"])
    if mm: print(mm.group(1)); break')
[ -n "$DROP_OTP" ] && ok "Captured drop OTP: $DROP_OTP" || fail "Could not find drop OTP"

curl -sX POST "$API/captain/rides/$COLIS_ID/arrive" -H "Authorization: Bearer $CAPT_TOKEN" >/dev/null
curl -sX POST "$API/captain/rides/$COLIS_ID/start" -H "Authorization: Bearer $CAPT_TOKEN" \
     -H 'Content-Type: application/json' -d "{\"code\":\"$VCODE_C\"}" >/dev/null

# Try to complete WITHOUT drop OTP → must fail
HTTP=$(curl -s -o /tmp/resp -w "%{http_code}" -X POST "$API/captain/rides/$COLIS_ID/complete" \
        -H "Authorization: Bearer $CAPT_TOKEN" -H 'Content-Type: application/json' -d '{"actualDistanceM":3000}')
[ "$HTTP" = "400" ] && ok "Refused without drop OTP" || fail "Expected 400, got $HTTP"

# Complete WITH drop OTP
R=$(curl -sX POST "$API/captain/rides/$COLIS_ID/complete" \
     -H "Authorization: Bearer $CAPT_TOKEN" -H 'Content-Type: application/json' \
     -d "{\"actualDistanceM\":3000,\"dropOtp\":\"$DROP_OTP\"}")
S=$(echo "$R" | pyjson 'print(d["ride"]["status"])')
COMM=$(echo "$R" | pyjson 'print(d["commissionKhoums"])')
[ "$S" = "completed" ] && ok "Colis completed. Commission=$COMM khoums (10%)" || fail "Status: $S"

# ──────────────────────────────────────────────────────────────────────────
step "7) Course récurrente"

R=$(curl -sX POST "$API/rider/recurring-rides" \
     -H "Authorization: Bearer $RIDER_TOKEN" -H 'Content-Type: application/json' \
     -d "{
       \"pickup\":{\"lat\":$PICKUP_LAT,\"lng\":$PICKUP_LNG,\"label\":\"Home\"},
       \"dropoff\":{\"lat\":$DROPOFF_LAT,\"lng\":$DROPOFF_LNG,\"label\":\"Office\"},
       \"daysOfWeek\":31,
       \"timeOfDay\":\"07:30\",
       \"validFrom\":\"$(date -v+1d +%Y-%m-%d 2>/dev/null || date -d 'tomorrow' +%Y-%m-%d)\"
     }")
REC_ID=$(echo "$R" | pyjson 'print(d["id"])')
LOCKED=$(echo "$R" | pyjson 'print(d["lockedFareKhoums"])')
ok "Recurring proposed: $REC_ID, locked fare $LOCKED khoums (5% discount)"

# Captain sees it
N=$(curl -sX GET "$API/captain/recurring-rides" -H "Authorization: Bearer $CAPT_TOKEN" | pyjson 'print(len(d))')
[ "$N" -ge 1 ] && ok "Captain sees $N recurring schedule(s)" || fail "Captain sees none"

# Captain accepts → locked in
R=$(curl -sX POST "$API/captain/recurring-rides/$REC_ID/accept" -H "Authorization: Bearer $CAPT_TOKEN")
S=$(echo "$R" | pyjson 'print(d["status"])')
[ "$S" = "active" ] && ok "Captain locked in" || fail "Status: $S"

# Admin triggers processOccurrences
ADMIN_TOKEN=$(get_token "$PHONE_ADMIN" admin phase5-admin)
R=$(curl -sX POST "$API/admin/recurring/process" -H "Authorization: Bearer $ADMIN_TOKEN")
echo "$R" | pyjson 'print("    processed:", d)'
ok "Recurring occurrences processed"

printf "\n\033[1;32m✔ Phase 5 differentiators OK\033[0m\n"
