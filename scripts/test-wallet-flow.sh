#!/usr/bin/env bash
# End-to-end test of the wallet (top-up + commission gate) flow.
# Builds on top of the captain registration test — re-runs it to ensure
# an approved captain exists.
set -euo pipefail

API=${API:-http://localhost:3000}
IMG_DIR=/tmp/tewiz-test-images
PHONE_CAPT="+22245888888"
PHONE_ADMIN="+22245999999"

pyjson() { python3 -c "import sys,json;d=json.load(sys.stdin);$1"; }
step() { printf "\n\033[1;36m▶ %s\033[0m\n" "$*"; }
ok()   { printf "  \033[0;32m✓\033[0m %s\n" "$*"; }
warn() { printf "  \033[0;33m!\033[0m %s\n" "$*"; }
fail() { printf "  \033[0;31m✗\033[0m %s\n" "$*"; exit 1; }

# 0. Ensure the test captain is fully approved.
step "Pre-flight: ensure approved test captain (re-runs captain-flow if needed)"
bash /Users/mohameda/Desktop/course/scripts/test-captain-flow.sh >/dev/null 2>&1
# Also clear admin OTPs once more so the wallet-test admin login doesn't get rate-limited
PGPASSWORD='ceYt3lpVFlWnUl9Cwc1NagvUQc77u9IU9gV6m9hAXRk=' psql -h localhost -U tewiz -d tewiz \
  -c "DELETE FROM otp_codes WHERE phone = '$PHONE_ADMIN'" >/dev/null 2>&1 || true
ok "Test captain is approved"

# 1. Captain login
step "Captain login"
R=$(curl -sX POST "$API/auth/otp/request" -H 'Content-Type: application/json' \
     -d "{\"phone\":\"$PHONE_CAPT\"}")
CODE=$(echo "$R" | pyjson 'print(d["_devCode"])')
R=$(curl -sX POST "$API/auth/otp/verify" -H 'Content-Type: application/json' \
     -d "{\"phone\":\"$PHONE_CAPT\",\"code\":\"$CODE\",\"role\":\"captain\",\"deviceId\":\"wallet-dev-001\"}")
CAPT_TOKEN=$(echo "$R" | pyjson 'print(d["tokens"]["accessToken"])')
ok "Captain token acquired"

# 2. Read initial wallet
step "Read initial wallet"
W=$(curl -sX GET "$API/captain/wallet" -H "Authorization: Bearer $CAPT_TOKEN")
INIT_BAL=$(echo "$W" | pyjson 'print(d["balanceKhoums"])')
ok "Initial balance: $INIT_BAL khoums"

# 3. Try to go online with low balance → must be refused
step "Try to go online with insufficient balance"
HTTP=$(curl -s -o /tmp/resp -w "%{http_code}" -X POST "$API/captain/state/online" \
        -H "Authorization: Bearer $CAPT_TOKEN" -H 'Content-Type: application/json' -d '{}')
if [ "$HTTP" = "402" ]; then
  ok "Refusé avec 402 Payment Required (correct)"
else
  fail "Attendu 402, reçu $HTTP. Body: $(cat /tmp/resp)"
fi

# 4. Generate a fresh top-up screenshot (unique content hash each run)
step "Generate top-up screenshot"
SHOT="/tmp/tewiz-test-images/topup-$(date +%s)-$RANDOM.jpg"
STAMP="$(date +%s)-$RANDOM"
(
  cd /Users/mohameda/Desktop/course/apps/api
  node -e "
    import('sharp').then(async ({default: sharp}) => {
      const svg = '<svg width=\"800\" height=\"600\"><rect width=\"800\" height=\"600\" fill=\"#1976d2\"/><text x=\"400\" y=\"280\" font-family=\"sans-serif\" font-size=\"56\" fill=\"white\" text-anchor=\"middle\">Bankily</text><text x=\"400\" y=\"360\" font-family=\"sans-serif\" font-size=\"40\" fill=\"white\" text-anchor=\"middle\">Topup $STAMP</text></svg>';
      await sharp(Buffer.from(svg)).jpeg({quality: 90}).toFile('$SHOT');
    });
  "
)
[ -f "$SHOT" ] || fail "Could not generate screenshot"
ok "Generated $SHOT"

# 5. Captain creates a top-up: 500 MRU = 2500 khoums
step "Create top-up (Bankily, 500 MRU = 2500 khoums)"
T=$(curl -sX POST "$API/captain/wallet/topups" \
      -H "Authorization: Bearer $CAPT_TOKEN" \
      -F "file=@$SHOT" \
      -F "provider=bankily" \
      -F "claimedAmountKhoums=2500" \
      -F "providerRefNumber=BNK-TEST-001")
TOPUP_ID=$(echo "$T" | pyjson 'print(d["id"])')
REF=$(echo "$T" | pyjson 'print(d["referenceCode"])')
ok "Top-up created: id=$TOPUP_ID, ref=$REF"

# 6. Try to create a second pending top-up with the same screenshot → must fail
step "Try duplicate top-up (same screenshot)"
HTTP=$(curl -s -o /tmp/resp -w "%{http_code}" -X POST "$API/captain/wallet/topups" \
        -H "Authorization: Bearer $CAPT_TOKEN" \
        -F "file=@$SHOT" \
        -F "provider=bankily" \
        -F "claimedAmountKhoums=2500")
if [ "$HTTP" = "409" ] || [ "$HTTP" = "400" ]; then
  ok "Refusé avec $HTTP (pending exists or duplicate)"
else
  fail "Attendu 409/400, reçu $HTTP. Body: $(cat /tmp/resp)"
fi

# 7. Admin login
step "Admin login"
R=$(curl -sX POST "$API/auth/otp/request" -H 'Content-Type: application/json' \
     -d "{\"phone\":\"$PHONE_ADMIN\"}")
CODE=$(echo "$R" | pyjson 'print(d["_devCode"])')
R=$(curl -sX POST "$API/auth/otp/verify" -H 'Content-Type: application/json' \
     -d "{\"phone\":\"$PHONE_ADMIN\",\"code\":\"$CODE\",\"role\":\"admin\",\"deviceId\":\"wallet-admin-001\"}")
ADMIN_TOKEN=$(echo "$R" | pyjson 'print(d["tokens"]["accessToken"])')
ok "Admin token acquired"

# 8. Admin lists pending top-ups
step "Admin lists pending top-ups"
COUNT=$(curl -sX GET "$API/admin/topups?status=pending" \
         -H "Authorization: Bearer $ADMIN_TOKEN" | pyjson 'print(len(d))')
ok "$COUNT pending top-up(s)"

# 9. Admin reads the top-up detail
step "Admin reads top-up detail"
DETAIL=$(curl -sX GET "$API/admin/topups/$TOPUP_ID" -H "Authorization: Bearer $ADMIN_TOKEN")
echo "$DETAIL" | pyjson 'print("  provider={} ref={} claimed={} captain={}".format(d["provider"], d["referenceCode"], d["claimedAmountKhoums"], d["captain"]["phone"]))'

# 10. Admin downloads the screenshot
step "Admin downloads the screenshot"
SIZE=$(curl -sX GET "$API/admin/topups/$TOPUP_ID/screenshot" \
        -H "Authorization: Bearer $ADMIN_TOKEN" -o /tmp/topup-screenshot.jpg -w "%{size_download}")
ok "$SIZE bytes downloaded"

# 11. Admin approves
step "Admin approves the top-up"
R=$(curl -sX POST "$API/admin/topups/$TOPUP_ID/approve" \
     -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
     -d '{"providerRefNumber":"BNK-CONFIRMED-001"}')
NEW_BAL=$(echo "$R" | pyjson 'print(d["balanceAfter"])')
STATUS=$(echo "$R" | pyjson 'print(d["topup"]["status"])')
[ "$STATUS" = "approved" ] || fail "Topup status: $STATUS"
ok "Top-up approved. New balance: $NEW_BAL khoums (= $((NEW_BAL/5)) MRU)"

# 12. Read wallet — verify ledger
step "Read wallet — verify transaction"
W=$(curl -sX GET "$API/captain/wallet" -H "Authorization: Bearer $CAPT_TOKEN")
BAL=$(echo "$W" | pyjson 'print(d["balanceKhoums"])')
TX_COUNT=$(echo "$W" | pyjson 'print(len(d["transactions"]))')
[ "$BAL" = "2500" ] || fail "Balance: $BAL"
[ "$TX_COUNT" -ge "1" ] || fail "No transactions"
ok "Balance: $BAL khoums, $TX_COUNT transaction(s) logged"
echo "$W" | pyjson '
for t in d["transactions"][:3]:
    print("     {:>12}  {:>+7} -> balance {}".format(t["type"], t["amountKhoums"], t["balanceAfter"]))
'

# 13. Now go online — should succeed
step "Go online (balance is now sufficient)"
R=$(curl -sX POST "$API/captain/state/online" \
     -H "Authorization: Bearer $CAPT_TOKEN" -H 'Content-Type: application/json' \
     -d '{"lat":18.0859,"lng":-15.9785}')
PRESENCE=$(echo "$R" | pyjson 'print(d["presence"])')
[ "$PRESENCE" = "online" ] || fail "Presence: $PRESENCE"
ok "Captain is now online"

# 14. Go offline
step "Go offline"
R=$(curl -sX POST "$API/captain/state/offline" -H "Authorization: Bearer $CAPT_TOKEN")
PRESENCE=$(echo "$R" | pyjson 'print(d["presence"])')
[ "$PRESENCE" = "offline" ] || fail "Presence: $PRESENCE"
ok "Captain is offline"

printf "\n\033[1;32m✔ End-to-end wallet flow OK\033[0m\n"
