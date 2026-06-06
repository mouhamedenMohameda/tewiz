-- Rides: passenger rides and package (colis) rides share this table.
-- Booking for someone else is supported via booker vs passenger fields.

CREATE TYPE ride_type AS ENUM ('passenger', 'colis');

CREATE TYPE ride_status AS ENUM (
  'pending_passenger_confirm',  -- "for someone else" awaiting SMS YES
  'searching',                  -- looking for a captain
  'accepted',                   -- captain accepted, en route to pickup
  'arrived',                    -- captain at pickup
  'in_progress',                -- moving toward dropoff
  'completed',
  'cancelled_by_rider',
  'cancelled_by_captain',
  'cancelled_by_system',        -- timeout, no captain, etc.
  'no_show'
);

CREATE TYPE payment_method AS ENUM ('cash', 'wallet');

CREATE TABLE rides (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who BOOKED the ride. Pays from their wallet if applicable.
  booker_id                UUID NOT NULL REFERENCES users(id),

  -- Who is the actual passenger. NULL when same as booker.
  -- For "course pour quelqu'un d'autre": filled with name/phone, may not be a user.
  passenger_user_id        UUID REFERENCES users(id),
  passenger_name           TEXT,
  passenger_phone          CITEXT,
  is_for_other             BOOLEAN NOT NULL DEFAULT false,
  passenger_confirmed_at   TIMESTAMPTZ,        -- when SMS YES was received

  captain_id               UUID REFERENCES captains(user_id),

  ride_type                ride_type NOT NULL DEFAULT 'passenger',
  status                   ride_status NOT NULL DEFAULT 'searching',

  -- Locations
  pickup_location          GEOGRAPHY(POINT, 4326) NOT NULL,
  pickup_label             TEXT,
  dropoff_location         GEOGRAPHY(POINT, 4326) NOT NULL,
  dropoff_label            TEXT,

  -- Pricing
  fare_estimate_khoums     BIGINT,
  fare_final_khoums        BIGINT,
  commission_rate_bps      INT NOT NULL,        -- snapshot at creation, e.g. 700 = 7%
  commission_khoums        BIGINT,              -- computed at completion
  payment_method           payment_method NOT NULL DEFAULT 'cash',

  -- Trip metrics
  distance_m               INT,
  duration_s               INT,

  -- Verification code: captain enters this to start the ride.
  -- Prevents the wrong-pickup scam.
  verification_code        CHAR(4),

  -- Timestamps for each state transition (useful for analytics + disputes)
  requested_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at              TIMESTAMPTZ,
  arrived_at               TIMESTAMPTZ,
  started_at               TIMESTAMPTZ,
  completed_at             TIMESTAMPTZ,
  cancelled_at             TIMESTAMPTZ,
  cancel_reason            TEXT,

  -- Source: did this come from a recurring schedule?
  recurring_ride_id        UUID                  -- FK added later
);

CREATE INDEX rides_booker_time_idx  ON rides(booker_id, requested_at DESC);
CREATE INDEX rides_captain_time_idx ON rides(captain_id, requested_at DESC);
CREATE INDEX rides_status_idx       ON rides(status) WHERE status IN ('searching', 'accepted', 'arrived', 'in_progress');
CREATE INDEX rides_pickup_gix       ON rides USING GIST (pickup_location);
CREATE INDEX rides_dropoff_gix      ON rides USING GIST (dropoff_location);

-- Wire wallet -> rides FK now that rides exists.
ALTER TABLE wallet_transactions
  ADD CONSTRAINT wallet_tx_ride_fk
  FOREIGN KEY (ride_id) REFERENCES rides(id);

CREATE UNIQUE INDEX wallet_tx_unique_ride_commission
  ON wallet_transactions(ride_id)
  WHERE ride_id IS NOT NULL AND type = 'commission';

-- Colis-specific fields (only present when ride_type = 'colis').
CREATE TABLE colis_details (
  ride_id                  UUID PRIMARY KEY REFERENCES rides(id) ON DELETE CASCADE,
  recipient_name           TEXT NOT NULL,
  recipient_phone          CITEXT NOT NULL,
  package_description      TEXT,
  pickup_photo_key         TEXT,
  drop_photo_key           TEXT,
  drop_otp_code            CHAR(4),             -- recipient gives this to captain at delivery
  recipient_confirmed_at   TIMESTAMPTZ
);

-- Ratings: rider rates captain, captain rates rider. One of each per ride.
CREATE TABLE ratings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id     UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  rater_id    UUID NOT NULL REFERENCES users(id),
  ratee_id    UUID NOT NULL REFERENCES users(id),
  stars       INT NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ratings_one_per_rater_per_ride
  ON ratings(ride_id, rater_id);

-- GPS trace of the ride for the "course honnête" feature (rider sees the
-- actual path post-trip). Stored as a polyline.
-- For storage efficiency we store the simplified line, not every GPS sample.
CREATE TABLE ride_traces (
  ride_id      UUID PRIMARY KEY REFERENCES rides(id) ON DELETE CASCADE,
  path         GEOGRAPHY(LINESTRING, 4326) NOT NULL,
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
