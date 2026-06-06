-- "Mes chauffeurs" (favorite captains) and recurring rides.

CREATE TABLE favorite_captains (
  rider_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  captain_id  UUID NOT NULL REFERENCES captains(user_id) ON DELETE CASCADE,
  nickname    TEXT,
  added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (rider_id, captain_id)
);

CREATE INDEX favorite_captains_captain_idx ON favorite_captains(captain_id);

-- Recurring rides: rider proposes a weekly schedule, one captain accepts
-- and is locked in for the period.
CREATE TYPE recurring_status AS ENUM (
  'proposed',   -- created by rider, waiting for a captain to accept
  'active',     -- captain locked in
  'paused',     -- temporarily paused (e.g. school holidays)
  'cancelled',
  'expired'
);

CREATE TABLE recurring_rides (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  captain_id           UUID REFERENCES captains(user_id),  -- NULL until accepted

  pickup_location      GEOGRAPHY(POINT, 4326) NOT NULL,
  pickup_label         TEXT,
  dropoff_location     GEOGRAPHY(POINT, 4326) NOT NULL,
  dropoff_label        TEXT,

  -- Bitmap of days of week. Bit 0 = Monday … bit 6 = Sunday.
  -- e.g. Mon-Fri = 0b0011111 = 31
  days_of_week         INT NOT NULL CHECK (days_of_week > 0 AND days_of_week < 128),
  time_of_day          TIME NOT NULL,
  timezone             TEXT NOT NULL DEFAULT 'Africa/Nouakchott',

  locked_fare_khoums   BIGINT NOT NULL,
  status               recurring_status NOT NULL DEFAULT 'proposed',

  valid_from           DATE NOT NULL,
  valid_until          DATE,                              -- NULL = open-ended

  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX recurring_rides_rider_idx   ON recurring_rides(rider_id)   WHERE status = 'active';
CREATE INDEX recurring_rides_captain_idx ON recurring_rides(captain_id) WHERE status = 'active';

-- Each actual occurrence (one per scheduled day). The scheduler creates these
-- ahead of time so the captain sees them on the morning of, and so missed
-- occurrences can be analyzed.
CREATE TYPE recurring_occurrence_status AS ENUM (
  'scheduled',       -- created, ride not yet spawned
  'dispatched',      -- ride row created, captain notified
  'completed',
  'cancelled_by_rider',
  'cancelled_by_captain',
  'missed'
);

CREATE TABLE recurring_ride_occurrences (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recurring_ride_id    UUID NOT NULL REFERENCES recurring_rides(id) ON DELETE CASCADE,
  scheduled_at         TIMESTAMPTZ NOT NULL,
  ride_id              UUID REFERENCES rides(id),
  status               recurring_occurrence_status NOT NULL DEFAULT 'scheduled',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX rro_unique_per_day
  ON recurring_ride_occurrences(recurring_ride_id, scheduled_at);

-- Wire rides -> recurring_rides FK
ALTER TABLE rides
  ADD CONSTRAINT rides_recurring_fk
  FOREIGN KEY (recurring_ride_id) REFERENCES recurring_rides(id);
