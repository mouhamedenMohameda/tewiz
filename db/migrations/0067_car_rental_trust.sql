-- Car rental ("Location Auto") trust layer — same engine as Ervdni
-- (carpooling, migrations 0058/0060/0061), extended for a high-value object:
-- the car physically leaves AND comes back, so we prove BOTH ends.
--
--   1. Free listing stays free (no change to car_listings).
--   2. Every booking is already a timestamped receipt; we add the missing
--      trust steps on top of it:
--        • pickup OTP  — held by the renter, entered by the owner  -> in_progress
--        • return OTP  — held by the owner, entered by the renter  -> completed
--      Commission is charged from the owner wallet ONLY on the confirmed
--      return (completed). Rate starts at 0 during launch.
--   3. Deposit is tracked (handed to the owner in cash at pickup, returned at
--      the end) — the app records the agreement, it never holds the money.
--   4. Photo état-des-lieux at pickup and return -> objective damage evidence.
--   5. Bilateral rating, no-show / no-return deterrent, and a disputable state.

BEGIN;

-- 2b. No-show / no-return deterrent limit (rolling 30 days). 0 disables it.
ALTER TABLE app_settings
  ADD COLUMN car_rental_no_show_limit integer NOT NULL DEFAULT 0;

-- 2c. Wallet transaction type for the success commission on a returned car.
ALTER TYPE wallet_tx_type ADD VALUE IF NOT EXISTS 'car_rental_commission';

-- 2d. Extended booking lifecycle. The old CHECK only allowed the pre-trust
-- statuses; widen it to the full state machine.
ALTER TABLE car_bookings DROP CONSTRAINT IF EXISTS car_bookings_status_check;
ALTER TABLE car_bookings
  ADD CONSTRAINT car_bookings_status_check
  CHECK (status IN (
    'pending', 'confirmed', 'declined', 'cancelled',
    'in_progress', 'completed', 'no_show', 'no_return', 'disputed'
  ));

-- 2e. Trust columns on the booking.
ALTER TABLE car_bookings
  ADD COLUMN pickup_otp        text,                                  -- held by the renter, entered by the owner
  ADD COLUMN return_otp        text,                                  -- held by the owner, entered by the renter
  ADD COLUMN commission_mru    integer NOT NULL DEFAULT 0,
  ADD COLUMN deposit_mru       integer NOT NULL DEFAULT 0,            -- snapshot of the caution at booking time
  ADD COLUMN deposit_taken     boolean NOT NULL DEFAULT false,
  ADD COLUMN deposit_returned  boolean NOT NULL DEFAULT false,
  ADD COLUMN pickup_photos     text[]  NOT NULL DEFAULT '{}',         -- état des lieux at handover (owner)
  ADD COLUMN return_photos     text[]  NOT NULL DEFAULT '{}',         -- état des lieux at return (both sides)
  ADD COLUMN picked_up_at      timestamptz,
  ADD COLUMN returned_at       timestamptz,
  ADD COLUMN cancelled_by      text CHECK (cancelled_by IN ('renter', 'owner', 'system'));

-- 4. Bilateral post-rental ratings (mirror carpooling_ratings from 0060).
CREATE TABLE car_rental_ratings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid NOT NULL REFERENCES car_bookings(id) ON DELETE CASCADE,
  rater_id    uuid NOT NULL REFERENCES users(id),
  ratee_id    uuid NOT NULL REFERENCES users(id),
  -- 'renter' rates the owner, 'owner' rates the renter. Fixed per side, so it
  -- also enforces one rating per side.
  role        text NOT NULL CHECK (role IN ('renter', 'owner')),
  stars       integer NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment     text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- One rating per rater per booking.
CREATE UNIQUE INDEX car_rental_ratings_one_per_rater
  ON car_rental_ratings (booking_id, rater_id);

CREATE INDEX car_rental_ratings_ratee_idx ON car_rental_ratings (ratee_id);

-- Denormalized car-rental reputation per user (kept separate from the
-- carpooling reputation — a good driver isn't necessarily a good car owner).
ALTER TABLE users
  ADD COLUMN car_rental_rating_avg   numeric(3, 2) NOT NULL DEFAULT 0,
  ADD COLUMN car_rental_rating_count integer       NOT NULL DEFAULT 0;

COMMIT;
