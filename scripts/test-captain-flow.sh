#!/usr/bin/env bash
# End-to-end test of the captain registration + admin KYC review flow.
# Assumes:
#   - SSH tunnel is up (launchd)
#   - API is running (`pnpm dev`)
#   - You are in /Users/mohameda/Desktop/course
set -euo pipefail

API=${API:-http://localhost:3000}
IMG_DIR=/tmp/tewiz-test-images
PHONE_CAPT="+22245888888"
PHONE_ADMIN="+22245999999"
EXPIRY="2027-12-31"

TYPES=(selfie nni_front nni_back license_front license_back
       carte_grise assurance vignette visite_technique
       car_front car_back car_left car_right car_interior)

pyjson() { python3 -c "import sys,json;d=json.load(sys.stdin);$1"; }

step() { printf "\n\033[1;36m▶ %s\033[0m\n" "$*"; }
ok()   { printf "  \033[0;32m✓\033[0m %s\n" "$*"; }
fail() { printf "  \033[0;31m✗\033[0m %s\n" "$*"; exit 1; }

# 0. Generate test images if missing
if [ ! -f "$IMG_DIR/selfie.jpg" ]; then
  step "Generating test images"
  node /Users/mohameda/Desktop/course/apps/api/scripts/generate-test-images.mjs
fi

# 1. Wipe previous test captain (+ admin OTPs to avoid rate limit)
step "Wipe previous test captain ($PHONE_CAPT)"
pnpm --silent --filter @tewiz/api clean:test-captain "$PHONE_CAPT" >/dev/null
# Also clear admin OTPs (the admin user persists but its OTP history must be cleared
# to avoid the rate limiter blocking after many test runs).
PGPASSWORD='ceYt3lpVFlWnUl9Cwc1NagvUQc77u9IU9gV6m9hAXRk=' psql -h localhost -U tewiz -d tewiz \
  -c "DELETE FROM otp_codes WHERE phone = '$PHONE_ADMIN'" >/dev/null 2>&1 || true
ok "Cleaned"

# 2. Captain login (creates user)
step "Captain phone+OTP login"
R=$(curl -sX POST "$API/auth/otp/request" -H 'Content-Type: application/json' \
     -d "{\"phone\":\"$PHONE_CAPT\"}")
CODE=$(echo "$R" | pyjson 'print(d["_devCode"])')
R=$(curl -sX POST "$API/auth/otp/verify" -H 'Content-Type: application/json' \
     -d "{\"phone\":\"$PHONE_CAPT\",\"code\":\"$CODE\",\"role\":\"captain\",\"deviceId\":\"test-captain-dev-001\",\"fullName\":\"Test Captain\"}")
CAPT_TOKEN=$(echo "$R" | pyjson 'print(d["tokens"]["accessToken"])')
ok "Token acquired"

# 3. Create draft application
step "Create draft application"
APP=$(curl -sX POST "$API/captain/applications" -H "Authorization: Bearer $CAPT_TOKEN")
APP_ID=$(echo "$APP" | pyjson 'print(d["id"])')
ok "App id: $APP_ID"

# 4. Update personal + vehicle info
step "Update personal + vehicle info"
curl -sX PATCH "$API/captain/applications/me" \
  -H "Authorization: Bearer $CAPT_TOKEN" -H 'Content-Type: application/json' \
  -d '{
    "fullName":"Mohamed Ould Ahmed",
    "nni":"1234567890",
    "dateOfBirth":"1990-01-15",
    "addressLabel":"Tevragh Zeina, Nouakchott",
    "emergencyContactName":"Fatma",
    "emergencyContactPhone":"+22245111222",
    "vehiclePlate":"1234-AB-00",
    "vehicleBrand":"Toyota",
    "vehicleModel":"Yaris",
    "vehicleYear":2018,
    "vehicleColor":"Blanc",
    "vehicleSeats":4,
    "acceptsColis":true
  }' >/dev/null
ok "Info saved"

# 5. Upload 14 documents
step "Upload 14 documents"
for t in "${TYPES[@]}"; do
  if [[ "$t" == "assurance" || "$t" == "vignette" || "$t" == "visite_technique" ]]; then
    R=$(curl -sX POST "$API/captain/applications/me/documents" \
          -H "Authorization: Bearer $CAPT_TOKEN" \
          -F "file=@$IMG_DIR/$t.jpg" \
          -F "type=$t" -F "expiresAt=$EXPIRY")
  else
    R=$(curl -sX POST "$API/captain/applications/me/documents" \
          -H "Authorization: Bearer $CAPT_TOKEN" \
          -F "file=@$IMG_DIR/$t.jpg" \
          -F "type=$t")
  fi
  STATUS=$(echo "$R" | pyjson 'print(d.get("status","?"))')
  printf "    %-20s %s\n" "$t" "$STATUS"
done

# 6. Submit
step "Submit application"
R=$(curl -sX POST "$API/captain/applications/me/submit" -H "Authorization: Bearer $CAPT_TOKEN")
S=$(echo "$R" | pyjson 'print(d["status"])')
[ "$S" = "submitted" ] && ok "Status: submitted" || fail "Got status: $S"

# 7. Admin: ensure exists, then login
step "Ensure admin exists"
pnpm --silent --filter @tewiz/api seed:admin "$PHONE_ADMIN" "Admin Test" >/dev/null
ok "Admin seeded"

step "Admin login"
R=$(curl -sX POST "$API/auth/otp/request" -H 'Content-Type: application/json' \
     -d "{\"phone\":\"$PHONE_ADMIN\"}")
CODE=$(echo "$R" | pyjson 'print(d["_devCode"])')
R=$(curl -sX POST "$API/auth/otp/verify" -H 'Content-Type: application/json' \
     -d "{\"phone\":\"$PHONE_ADMIN\",\"code\":\"$CODE\",\"role\":\"admin\",\"deviceId\":\"test-admin-dev-001\"}")
ADMIN_TOKEN=$(echo "$R" | pyjson 'print(d["tokens"]["accessToken"])')
ok "Admin token acquired"

# 8. List submitted apps
step "List submitted apps"
COUNT=$(curl -sX GET "$API/admin/applications?status=submitted" \
         -H "Authorization: Bearer $ADMIN_TOKEN" | pyjson 'print(len(d))')
ok "$COUNT app(s) submitted"

# 9. Claim
step "Claim the application"
curl -sX POST "$API/admin/applications/$APP_ID/claim" \
     -H "Authorization: Bearer $ADMIN_TOKEN" >/dev/null
ok "Claimed (under_review)"

# 10. Approve every document
step "Approve every document"
DOC_IDS=$(curl -sX GET "$API/admin/applications/$APP_ID" \
            -H "Authorization: Bearer $ADMIN_TOKEN" \
          | pyjson 'print(" ".join(x["id"] for x in d["documents"]))')
for DID in $DOC_IDS; do
  curl -sX PATCH "$API/admin/applications/$APP_ID/documents/$DID" \
    -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
    -d '{"status":"approved"}' >/dev/null
done
ok "All docs approved"

# 11. Approve application
step "Approve the application"
R=$(curl -sX POST "$API/admin/applications/$APP_ID/approve" \
     -H "Authorization: Bearer $ADMIN_TOKEN")
FINAL=$(echo "$R" | pyjson 'print(d["status"])')
[ "$FINAL" = "approved" ] && ok "Status: approved" || fail "Got status: $FINAL ($R)"

printf "\n\033[1;32m✔ End-to-end captain flow OK\033[0m\n"
