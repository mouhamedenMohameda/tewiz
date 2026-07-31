# Tewiz feature list

## Core

- **Three roles**: rider, captain, admin
- **Phone+OTP auth** (no passwords). 6-digit code, bcrypt-hashed, 5-min TTL, 5 attempts max.
- **Captain KYC** — manual review. Captain uploads photos, admin approves/rejects per document. Doc expiry tracked for assurance/vignette/visite technique with auto-suspend.
- **Wallet** — prepaid commission model. Captain tops up via Bankily/Masrivi screenshot; admin verifies and credits. Each completed ride deducts 7% commission (10% for colis). Captain blocked from going online below 20 MRU; soft float to -50 MRU.
- **Basic ride flow** — request → match → track → complete → rate.
- **Home + Going-home mode** — captain sets home once (30-day lock, GPS-verified at setup). Activates "Je rentre chez moi" → dispatch boosts rides that bring him closer to home. Max 2/day, 2h timeout, ends within 500m of home.

## Differentiators

### 📦 Envoyer un colis
- `ride_type = colis`
- Sender enters recipient name + phone + description
- Captain photos package at pickup
- 4-digit OTP confirms delivery
- Higher commission (10%)

### 👨‍👩‍👧 Mes Captains (favorite captains)
- Rider prompts to add captain after 5-star rating
- Dispatch tries favorites first (30s window) before falling back
- Captain sees "Vous êtes favori de X clients"

### 📅 Course récurrente
- Rider proposes weekly schedule
- One captain accepts and is locked for the period
- System auto-creates ride 15 min before each occurrence
- 5% rider discount, captain pays normal commission

### 🏖️ Carte des routes bloquées
- Captains/riders report sand/flood/construction/police/accident
- 6h expiry, crowdsourced confirmations/dismissals
- Shown on map; routing avoids active areas

### 📊 Zones chaudes
- H3 hex grid (res 9, ~170m) heatmap of recent ride requests
- Recomputed every 5 min
- Captain sees colored overlay → knows where to park

### 👵 Course pour quelqu'un d'autre
- Booker books for a passenger who has no app
- SMS to passenger with confirmation YES/NO
- Booker pays from wallet; passenger doesn't need account
- Captain calls passenger's number, not booker's

## Small UX wins (not yet planned but cheap)

- **Voice verification code** before ride starts (anti-scam)
- **J'ai la monnaie** flag (captain has change for 1000/2000/5000)
- **Course honnête** — post-ride GPS trace + fare breakdown shown to rider

## Future (v2+)

- Inter-city long-distance rides (BlaBlaCar-style)
- Cooperative onboarding (taxi union partnerships)
- Friday/Ramadan modes
- Earnings goal coach
- Maintenance reminders
- Discreet SOS

## Conventions

- All money is integer **MRU**, in `BIGINT` columns suffixed `_mru`. Never floats.
  (Amounts were stored in khoums until migration `0017_money_in_mru.sql`, which
  renamed every column and divided the values by 5.)
- All locations are PostGIS `GEOGRAPHY(POINT, 4326)`.
- All timestamps are `TIMESTAMPTZ`.
- Commission stored at ride creation as `commission_rate_bps` (basis points: 700 = 7.00%). Future rate changes don't affect existing rides.
- All admin actions logged to `admin_audit_log`.
- Wallet integrity: `trg_wallet_balance_consistency` asserts
  `wallets.balance_mru == SUM(wallet_transactions.amount_mru)` after every wallet
  update. Both tables key on `captain_id` — there is no `wallets.id` and no
  `wallet_transactions.wallet_id`. The trigger only fires on writes, so a restore
  re-checks the invariant explicitly (see `scripts/restore-db.sh`), and
  `tewiz_wallet_ledger_drift_rows` exposes it continuously.
