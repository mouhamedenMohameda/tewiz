-- Wallet, transactions, and top-up requests.
-- All amounts are integer khoums. 1 MRU = 5 khoums.

CREATE TABLE wallets (
  captain_id       UUID PRIMARY KEY REFERENCES captains(user_id) ON DELETE CASCADE,
  balance_khoums   BIGINT NOT NULL DEFAULT 0,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TYPE topup_provider AS ENUM ('bankily', 'masrivi', 'sedad', 'cash_office');
CREATE TYPE topup_status   AS ENUM ('pending', 'approved', 'partial', 'rejected', 'duplicate');

CREATE TABLE topup_requests (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  captain_id             UUID NOT NULL REFERENCES captains(user_id) ON DELETE CASCADE,
  provider               topup_provider NOT NULL,
  -- Generated, shown to captain so admin can match the Bankily/Masrivi entry.
  reference_code         TEXT NOT NULL UNIQUE,
  claimed_amount_khoums  BIGINT NOT NULL CHECK (claimed_amount_khoums > 0),
  -- What the captain entered as the provider's reference (e.g. Bankily txn ID).
  provider_ref_number    TEXT,
  screenshot_storage_key TEXT NOT NULL,
  -- sha256 of the screenshot, used to reject re-submission of the same image.
  screenshot_hash        TEXT UNIQUE,

  status                 topup_status NOT NULL DEFAULT 'pending',
  approved_amount_khoums BIGINT,
  reject_reason          TEXT,
  reviewed_by            UUID REFERENCES users(id),
  reviewed_at            TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX topup_requests_status_idx ON topup_requests(status, created_at)
  WHERE status = 'pending';

-- The ledger. Single source of truth for balance.
-- balance_after is a snapshot taken inside the same transaction that updated
-- the wallet, for audit. Never UPDATE rows here; only INSERT.
CREATE TYPE wallet_tx_type AS ENUM (
  'topup',
  'commission',
  'commission_refund',
  'manual_adjustment',
  'bonus'
);

CREATE TABLE wallet_transactions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  captain_id         UUID NOT NULL REFERENCES captains(user_id) ON DELETE RESTRICT,
  type               wallet_tx_type NOT NULL,
  amount_khoums      BIGINT NOT NULL,           -- signed: positive = credit, negative = debit
  balance_after      BIGINT NOT NULL,
  ride_id            UUID,                       -- FK added in rides migration
  topup_id           UUID REFERENCES topup_requests(id),
  reason             TEXT,
  created_by         UUID REFERENCES users(id),  -- NULL = system
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX wallet_tx_captain_time_idx
  ON wallet_transactions(captain_id, created_at DESC);

-- Idempotency: only one ledger row per (topup, type) and per (ride, type).
CREATE UNIQUE INDEX wallet_tx_unique_topup
  ON wallet_transactions(topup_id) WHERE topup_id IS NOT NULL;
