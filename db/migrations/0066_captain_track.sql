-- Off-ride captain breadcrumb trail (Level B background tracking).
--
-- Unlike `captain_state` (one row per captain, overwritten each tick — "where
-- is he now") and `ride_locations` (the trusted meter trail of ONE ride), this
-- table keeps the continuous position history of a captain while online, even
-- outside any ride. It is fed by the mobile background TaskManager and read by
-- the back-office to draw the captain's path as a polyline.
--
-- Design constraints (see the "eliminate the downsides" strategy):
--   - Volume: the ingestion endpoint drops noise (immobile / teleport / bad
--     accuracy) BEFORE inserting, so a stopped car writes nothing.
--   - Write cost: no GIST index here — the back-office reads a single
--     captain's trail ordered by time, so a plain (captain_id, recorded_at)
--     btree is all we need. Nearest-captain search stays on captain_state.
--   - Retention / privacy: PARTITION BY day. Purge = DROP the old partition
--     (O(1), no VACUUM), driven by the reap-captain-track cron. Default
--     retention is 14 days.
--   - Consent gate: `app_settings.track_offline_enabled` lets ops disable the
--     whole feature without a deploy.

BEGIN;

-- Master switch. Off by default so upgrading an environment never starts
-- collecting off-ride location until an admin explicitly opts in.
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS track_offline_enabled boolean NOT NULL DEFAULT false;

-- Parent partitioned table. No rows live here directly — every row lands in a
-- daily child partition.
CREATE TABLE captain_track (
  captain_id   uuid        NOT NULL REFERENCES captains(user_id) ON DELETE CASCADE,
  point        geography(POINT, 4326) NOT NULL,
  accuracy_m   real,
  speed_mps    real,
  recorded_at  timestamptz NOT NULL DEFAULT now()
) PARTITION BY RANGE (recorded_at);

-- The read path is always "one captain, a time window", so index the child
-- partitions on (captain_id, recorded_at). Declaring it on the parent makes
-- every future partition inherit it automatically.
CREATE INDEX captain_track_captain_time_idx
  ON captain_track (captain_id, recorded_at);

-- Create (if missing) the daily partition covering `day`. Idempotent, so both
-- the migration and the cron can call it freely. Partition name is
-- captain_track_YYYYMMDD; bounds are [day 00:00, day+1 00:00).
CREATE OR REPLACE FUNCTION ensure_captain_track_partition(day date)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  part_name text := 'captain_track_' || to_char(day, 'YYYYMMDD');
  -- Pin bounds to UTC midnights so the partition's name (a UTC date) always
  -- matches its actual [from, to) instants, independent of the server's
  -- timezone. The reap job relies on this name↔range correspondence.
  lo text := to_char(day, 'YYYY-MM-DD') || ' 00:00:00+00';
  hi text := to_char(day + 1, 'YYYY-MM-DD') || ' 00:00:00+00';
BEGIN
  IF to_regclass(part_name) IS NULL THEN
    EXECUTE format(
      'CREATE TABLE %I PARTITION OF captain_track FOR VALUES FROM (%L) TO (%L)',
      part_name, lo, hi
    );
  END IF;
END;
$$;

-- Pre-create yesterday..+2 days so ingestion works immediately after deploy
-- regardless of when the cron first runs. Yesterday covers late-arriving
-- batches whose device timestamp is just before midnight.
SELECT ensure_captain_track_partition((now() AT TIME ZONE 'UTC')::date - 1);
SELECT ensure_captain_track_partition((now() AT TIME ZONE 'UTC')::date);
SELECT ensure_captain_track_partition((now() AT TIME ZONE 'UTC')::date + 1);
SELECT ensure_captain_track_partition((now() AT TIME ZONE 'UTC')::date + 2);

COMMIT;
