BEGIN;

-- Bilateral post-trip ratings for Tfag (carpooling). After a booking is
-- confirmed completed (OTP), the passenger can rate the driver and the driver
-- can rate the passenger — one each. Reputation discourages no-shows and bad
-- behaviour on both sides.

CREATE TABLE carpooling_ratings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid NOT NULL REFERENCES carpooling_bookings(id) ON DELETE CASCADE,
  rater_id    uuid NOT NULL REFERENCES users(id),
  ratee_id    uuid NOT NULL REFERENCES users(id),
  -- Which side the rater is on ('passenger' rates the driver, 'driver' rates
  -- the passenger). Fixed per side, so it also enforces one rating per side.
  role        text NOT NULL CHECK (role IN ('passenger', 'driver')),
  stars       integer NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment     text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- One rating per rater per booking.
CREATE UNIQUE INDEX carpooling_ratings_one_per_rater
  ON carpooling_ratings (booking_id, rater_id);

CREATE INDEX carpooling_ratings_ratee_idx ON carpooling_ratings (ratee_id);

-- Denormalized reputation per user, recomputed on each new rating (ratings are
-- infrequent so recompute-on-write is fine).
ALTER TABLE users
  ADD COLUMN carpooling_rating_avg   numeric(3, 2) NOT NULL DEFAULT 0,
  ADD COLUMN carpooling_rating_count integer       NOT NULL DEFAULT 0;

COMMIT;
