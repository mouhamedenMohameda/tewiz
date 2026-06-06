#!/usr/bin/env bash
# End-to-end ride flow:
#   - Rider books a ride
#   - Captain (online with balance) sees it in inbox
#   - Accept → arrive → start (with code) → complete
#   - Commission debited from captain wallet
set -euo pipefail

API=${API:-http://localhost:3000}
PHONE_CAPT="+22245888888"
PHONE_RIDER="+22245777777"
PHONE_ADMIN="+22245999999"

# Nouakchott landmarks (Tevragh Zeina → Sebkha-ish).
PICKUP_LAT=18.0860
PICKUP_LNG=-15.9785
DROPOFF_LAT=18.0700
DROPOFF_LNG=-15.9650

pyjson() { python3 -c "import sys,json;d=json.load(sys.stdin);$1"; }
step() { printf "\n\033[1;36m▶ %s\033[0m\n" "$*"; }
ok()   { printf "  \033[0;32m✓\033[0m %s\n" "$*"; }
fail() { printf "  \033[0;31m✗\033[0m %s\n" "$*"; exit 1; }

# Pre-flight: ensure captain is approved AND has a funded wallet.
step "Pre-flight: approved captain + funded wallet"
bash /Users/mohameda/Desktop/course/scripts/test-wallet-flow.sh >/dev/null 2>&1
ok "Captain approved + wallet credited"

# Clean previous test rider
pnpm --silent --filter @tewiz/api clean:test-rider "$PHONE_RIDER" >/dev/null
ok "Test rider cleaned"

# Rider login
step "Rider login"
R=$(curl -sX POST "$API/auth/otp/request" -H 'Content-Type: application/json' -d "{\"phone\":\"$PHONE_RIDER\"}")
CODE=$(echo "$R" | pyjson 'print(d["_devCode"])')
R=$(curl -sX POST "$API/auth/otp/verify" -H 'Content-Type: application/json' \
     -d "{\"phone\":\"$PHONE_RIDER\",\"code\":\"$CODE\",\"role\":\"rider\",\"deviceId\":\"ride-rider-001\",\"fullName\":\"Test Rider\"}")
RIDER_TOKEN=$(echo "$R" | pyjson 'print(d["tokens"]["accessToken"])')
ok "Rider token acquired"

# Captain login + go online at pickup location
step "Captain login + go online"
R=$(curl -sX POST "$API/auth/otp/request" -H 'Content-Type: application/json' -d "{\"phone\":\"$PHONE_CAPT\"}")
CODE=$(echo "$R" | pyjson 'print(d["_devCode"])')
R=$(curl -sX POST "$API/auth/otp/verify" -H 'Content-Type: application/json' \
     -d "{\"phone\":\"$PHONE_CAPT\",\"code\":\"$CODE\",\"role\":\"captain\",\"deviceId\":\"ride-captain-001\"}")
CAPT_TOKEN=$(echo "$R" | pyjson 'print(d["tokens"]["accessToken"])')
R=$(curl -sX POST "$API/captain/state/online" \
     -H "Authorization: Bearer $CAPT_TOKEN" -H 'Content-Type: application/json' \
     -d "{\"lat\":$PICKUP_LAT,\"lng\":$PICKUP_LNG}")
PRESENCE=$(echo "$R" | pyjson 'print(d["presence"])')
[ "$PRESENCE" = "online" ] || fail "Captain not online: $PRESENCE"
BAL_BEFORE=$(echo "$R" | pyjson 'print(d["balanceKhoums"])')
ok "Captain online @ pickup. Balance: $BAL_BEFORE khoums"

# Rider creates a ride
step "Rider creates a ride"
R=$(curl -sX POST "$API/rider/rides" \
     -H "Authorization: Bearer $RIDER_TOKEN" -H 'Content-Type: application/json' \
     -d "{
       \"pickup\":{\"lat\":$PICKUP_LAT,\"lng\":$PICKUP_LNG,\"label\":\"Tevragh Zeina\"},
       \"dropoff\":{\"lat\":$DROPOFF_LAT,\"lng\":$DROPOFF_LNG,\"label\":\"Sebkha\"}
     }")
RIDE_ID=$(echo "$R" | pyjson 'print(d["id"])')
RIDE_STATUS=$(echo "$R" | pyjson 'print(d["status"])')
VCODE=$(echo "$R" | pyjson 'print(d["verificationCode"])')
FARE=$(echo "$R" | pyjson 'print(d["fareEstimateKhoums"])')
DIST=$(echo "$R" | pyjson 'print(d["distanceM"])')
[ "$RIDE_STATUS" = "searching" ] || fail "Ride status: $RIDE_STATUS"
ok "Ride created: id=$RIDE_ID, status=searching"
ok "  code=$VCODE, fare estimate=$FARE khoums (= $((FARE/5)) MRU), distance~${DIST}m"

# Try to create a second ride → must fail
step "Try to create a second active ride (should fail)"
HTTP=$(curl -s -o /tmp/resp -w "%{http_code}" -X POST "$API/rider/rides" \
        -H "Authorization: Bearer $RIDER_TOKEN" -H 'Content-Type: application/json' \
        -d "{\"pickup\":{\"lat\":$PICKUP_LAT,\"lng\":$PICKUP_LNG},\"dropoff\":{\"lat\":$DROPOFF_LAT,\"lng\":$DROPOFF_LNG}}")
[ "$HTTP" = "409" ] && ok "409 (ride_in_progress)" || fail "Expected 409, got $HTTP"

# Captain inbox sees the ride
step "Captain inbox sees the ride"
INBOX=$(curl -sX GET "$API/captain/rides/inbox" -H "Authorization: Bearer $CAPT_TOKEN")
N=$(echo "$INBOX" | pyjson 'print(len(d))')
[ "$N" -ge 1 ] || fail "Inbox empty"
ok "$N ride(s) in inbox"
echo "$INBOX" | pyjson '
for r in d[:3]:
    print("     {} dist={}m fare={}kh".format(r["id"][:8], r["distanceToPickupM"], r["fareEstimateKhoums"]))
'

# Captain accepts
step "Captain accepts"
R=$(curl -sX POST "$API/captain/rides/$RIDE_ID/accept" -H "Authorization: Bearer $CAPT_TOKEN")
S=$(echo "$R" | pyjson 'print(d["status"])')
[ "$S" = "accepted" ] || fail "Status: $S"
ok "Accepted. Captain presence is now on_ride."

# Captain marks arrived
step "Captain marks arrived"
R=$(curl -sX POST "$API/captain/rides/$RIDE_ID/arrive" -H "Authorization: Bearer $CAPT_TOKEN")
S=$(echo "$R" | pyjson 'print(d["status"])')
[ "$S" = "arrived" ] || fail "Status: $S"
ok "Arrived at pickup"

# Try to start with wrong code → must fail
step "Start with WRONG code (should fail)"
HTTP=$(curl -s -o /tmp/resp -w "%{http_code}" -X POST "$API/captain/rides/$RIDE_ID/start" \
        -H "Authorization: Bearer $CAPT_TOKEN" -H 'Content-Type: application/json' \
        -d '{"code":"0000"}')
[ "$HTTP" = "400" ] && ok "Refused (invalid_code)" || fail "Expected 400, got $HTTP"

# Start with right code
step "Start with correct code"
R=$(curl -sX POST "$API/captain/rides/$RIDE_ID/start" \
     -H "Authorization: Bearer $CAPT_TOKEN" -H 'Content-Type: application/json' \
     -d "{\"code\":\"$VCODE\"}")
S=$(echo "$R" | pyjson 'print(d["status"])')
[ "$S" = "in_progress" ] || fail "Status: $S"
ok "Ride in_progress"

# Complete
step "Complete ride (5 km actual distance)"
R=$(curl -sX POST "$API/captain/rides/$RIDE_ID/complete" \
     -H "Authorization: Bearer $CAPT_TOKEN" -H 'Content-Type: application/json' \
     -d '{"actualDistanceM":5000,"actualDurationS":900}')
S=$(echo "$R" | pyjson 'print(d["ride"]["status"])')
FINAL_FARE=$(echo "$R" | pyjson 'print(d["ride"]["fareFinalKhoums"])')
COMM=$(echo "$R" | pyjson 'print(d["commissionKhoums"])')
BAL_AFTER=$(echo "$R" | pyjson 'print(d["captainBalanceAfter"])')
[ "$S" = "completed" ] || fail "Status: $S"
ok "Completed. Final fare=$FINAL_FARE kh ($((FINAL_FARE/5)) MRU), commission=$COMM kh"
ok "Captain balance: $BAL_BEFORE → $BAL_AFTER khoums (debit of $COMM)"
[ "$((BAL_BEFORE - COMM))" = "$BAL_AFTER" ] || fail "Balance math wrong: $BAL_BEFORE - $COMM != $BAL_AFTER"

# Captain should be back to online
step "Captain presence after complete"
R=$(curl -sX GET "$API/captain/state" -H "Authorization: Bearer $CAPT_TOKEN")
P=$(echo "$R" | pyjson 'print(d["presence"])')
[ "$P" = "online" ] || fail "Presence: $P"
ok "Presence: online"

# Rider history should show the completed ride
step "Rider history"
R=$(curl -sX GET "$API/rider/rides/history" -H "Authorization: Bearer $RIDER_TOKEN")
N=$(echo "$R" | pyjson 'print(len(d))')
ok "$N ride(s) in history"

printf "\n\033[1;32m✔ End-to-end ride flow OK\033[0m\n"
