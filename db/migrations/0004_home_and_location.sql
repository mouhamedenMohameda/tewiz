-- Captain home (30-day lock) + going-home sessions + live captain state.

-- One home per captain. The 30-day lock is enforced in application code,
-- by checking locked_until before any UPDATE.
CREATE TABLE captain_home (
  captain_id     UUID PRIMARY KEY REFERENCES captains(user_id) ON DELETE CASCADE,
  location       GEOGRAPHY(POINT, 4326) NOT NULL,
  address_label  TEXT NOT NULL,
  set_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_until   TIMESTAMPTZ NOT NULL,  -- typically set_at + 30 days
  -- Allow one free correction within first 48h after setup.
  correction_used BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX captain_home_location_gix ON captain_home USING GIST (location);

CREATE TYPE going_home_status AS ENUM ('active', 'completed', 'cancelled', 'expired');

CREATE TABLE captain_going_home_sessions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  captain_id          UUID NOT NULL REFERENCES captains(user_id) ON DELETE CASCADE,
  -- Snapshot home position at session start to avoid mid-session drift if
  -- home ever changes via admin override.
  home_snapshot       GEOGRAPHY(POINT, 4326) NOT NULL,
  started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at            TIMESTAMPTZ,
  status              going_home_status NOT NULL DEFAULT 'active',
  end_reason          TEXT
);

CREATE INDEX cghs_captain_active_idx
  ON captain_going_home_sessions(captain_id)
  WHERE status = 'active';

-- One active going-home session per captain at a time.
CREATE UNIQUE INDEX cghs_one_active_per_captain
  ON captain_going_home_sessions(captain_id)
  WHERE status = 'active';

-- Live captain online/offline state. Updated frequently.
-- For super-hot data (last position, heading), prefer Redis; this table is
-- the durable fallback and stores the last known state.
CREATE TYPE captain_presence AS ENUM ('offline', 'online', 'on_ride', 'paused');

CREATE TABLE captain_state (
  captain_id        UUID PRIMARY KEY REFERENCES captains(user_id) ON DELETE CASCADE,
  presence          captain_presence NOT NULL DEFAULT 'offline',
  location          GEOGRAPHY(POINT, 4326),
  heading_deg       REAL,
  speed_mps         REAL,
  battery_pct       INT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX captain_state_online_loc_gix
  ON captain_state USING GIST (location)
  WHERE presence IN ('online', 'on_ride');
