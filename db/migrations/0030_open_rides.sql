-- Open rides ("course ouverte"): rides without a fixed destination.
--
-- Why:
--   Customers often want a taxi without a precise destination yet — they're
--   running errands, deciding on the way, or just need a driver for the next
--   hour. The classic fare = base + distance × per_km can't be computed
--   up-front in that case. So an open ride switches to a metered fare:
--     fare = open_base + (km × open_per_km) + (min × open_per_minute)
--   measured server-side from GPS pings the captain app pushes during the
--   trip. The rider sees the live total in real time. The captain ends the
--   trip when the rider is ready to stop; only the captain can cancel an
--   open ride (the rider is in the car, the meter is running, so cancellation
--   from the rider side would be ambiguous).
--
-- Shape:
--   - rides.is_open BOOLEAN — flag (default false → classic fixed-fare ride)
--   - rides.dropoff_location GEOGRAPHY NULL — open rides have no upfront drop
--   - ride_locations — append-only GPS trail recorded during in_progress
--   - app_settings.open_* — pricing knobs (admin-tunable)

BEGIN;

-- ── 1. Pricing knobs on app_settings ─────────────────────────────────────────

ALTER TABLE app_settings
  ADD COLUMN allow_open_rides       boolean NOT NULL DEFAULT true,
  ADD COLUMN open_base_fare_mru     integer NOT NULL DEFAULT 50,
  ADD COLUMN open_per_km_mru        integer NOT NULL DEFAULT 40,
  ADD COLUMN open_per_minute_mru    integer NOT NULL DEFAULT 5,
  ADD COLUMN open_min_fare_mru      integer NOT NULL DEFAULT 100;

ALTER TABLE app_settings
  ADD CONSTRAINT app_settings_open_positive CHECK (
    open_base_fare_mru >= 0
    AND open_per_km_mru >= 0
    AND open_per_minute_mru >= 0
    AND open_min_fare_mru >= 0
  );

-- ── 2. Open-ride columns on rides ────────────────────────────────────────────

ALTER TABLE rides
  ADD COLUMN is_open boolean NOT NULL DEFAULT false;

-- Open rides have no upfront destination. Dropoff is filled in at completion
-- with the captain's last GPS point so analytics, history and the post-trip
-- map still work.
ALTER TABLE rides
  ALTER COLUMN dropoff_location DROP NOT NULL;

ALTER TABLE rides
  ADD CONSTRAINT rides_open_has_no_drop CHECK (
    is_open = false OR dropoff_location IS NULL OR status IN
      ('completed','cancelled_by_rider','cancelled_by_captain','cancelled_by_system','no_show')
  );

-- Snapshot of the metered tariff at creation time, so an admin tweak to
-- app_settings mid-ride never changes the price the rider was quoted.
ALTER TABLE rides
  ADD COLUMN open_base_fare_mru   integer,
  ADD COLUMN open_per_km_mru      integer,
  ADD COLUMN open_per_minute_mru  integer,
  ADD COLUMN open_min_fare_mru    integer;

-- ── 3. GPS trail (append-only) ───────────────────────────────────────────────
--
-- One row per accepted GPS sample. The captain app pushes a sample every
-- ~5 s while the ride is in_progress. The API rejects samples that look like
-- teleports (> MAX_SPEED_MPS from the previous one), so a bad fix can't
-- inflate the meter. distance_m / duration_s are recomputed from this table
-- on every read (cheap thanks to the per-ride index) and stored on the ride
-- row at completion.

CREATE TABLE ride_locations (
  id           bigserial PRIMARY KEY,
  ride_id      uuid NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  point        geography(POINT, 4326) NOT NULL,
  accuracy_m   real,
  speed_mps    real,
  recorded_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ride_locations_ride_time_idx
  ON ride_locations(ride_id, recorded_at);

CREATE INDEX ride_locations_point_gix
  ON ride_locations USING GIST (point);

COMMIT;
