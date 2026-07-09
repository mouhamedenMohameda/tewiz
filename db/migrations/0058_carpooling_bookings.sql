BEGIN;

-- Tfag (carpooling) trust layer.
--
-- Replaces the old "pay-to-post + reveal phone" model with:
--   1. Free publishing (no upfront risk for the driver).
--   2. Real seat bookings that are the source of truth for every request
--      (timestamped receipt -> kills "I never received a request").
--   3. OTP completion proof entered by the driver, held by the passenger
--      (kills "the passenger never showed up / the ride never happened").
--   4. Commission charged from the driver wallet ONLY on a confirmed ride
--      (you only earn on success). Rate starts at 0 during launch.

-- 1. Publishing becomes free. Boost stays optional/paid. Reset existing row.
ALTER TABLE app_settings
  ALTER COLUMN carpooling_publication_fee SET DEFAULT 0;
UPDATE app_settings SET carpooling_publication_fee = 0 WHERE id = 1;

-- 2. Success commission, in basis points (0 = 0 %, 1000 = 10 %). Starts at 0.
ALTER TABLE app_settings
  ADD COLUMN carpooling_commission_bps integer NOT NULL DEFAULT 0;

-- 3. Wallet transaction type for the success commission.
ALTER TYPE wallet_tx_type ADD VALUE IF NOT EXISTS 'carpooling_commission';

-- 4. Bookings: one row per seat request, the record of truth.
CREATE TABLE carpooling_bookings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id         uuid NOT NULL REFERENCES carpooling_trips(id) ON DELETE CASCADE,
  passenger_id    uuid NOT NULL REFERENCES users(id),
  seats           integer NOT NULL DEFAULT 1 CHECK (seats BETWEEN 1 AND 8),
  status          text NOT NULL DEFAULT 'requested'
                  CHECK (status IN ('requested','accepted','declined','cancelled','completed','no_show','expired')),
  -- Completion proof: the passenger holds this code, the driver enters it.
  otp_code        text,
  -- Snapshot of the agreed fare (paid cash, hand to hand) for the record.
  fare_mru        integer NOT NULL DEFAULT 0,
  commission_mru  integer NOT NULL DEFAULT 0,
  cancelled_by    text CHECK (cancelled_by IN ('passenger','driver','system')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  accepted_at     timestamptz,
  declined_at     timestamptz,
  cancelled_at    timestamptz,
  completed_at    timestamptz
);

-- At most one live request per passenger per trip; they can re-request after a
-- terminal outcome (declined / cancelled / no_show).
CREATE UNIQUE INDEX carpooling_bookings_one_active_idx
  ON carpooling_bookings (trip_id, passenger_id)
  WHERE status IN ('requested', 'accepted');

CREATE INDEX carpooling_bookings_trip_idx ON carpooling_bookings (trip_id, status);
CREATE INDEX carpooling_bookings_passenger_idx ON carpooling_bookings (passenger_id, created_at DESC);

COMMIT;
