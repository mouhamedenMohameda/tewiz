BEGIN;

CREATE TABLE IF NOT EXISTS captain_cancel_events (
  id                 bigserial PRIMARY KEY,
  captain_id         uuid NOT NULL REFERENCES captains(user_id) ON DELETE CASCADE,
  ride_id            uuid NOT NULL UNIQUE REFERENCES rides(id) ON DELETE CASCADE,
  cancel_dropoff     geography(Point, 4326),
  cancelled_at       timestamptz NOT NULL DEFAULT now(),
  resolved_at        timestamptz
);

CREATE INDEX IF NOT EXISTS captain_cancel_events_captain_time_idx
  ON captain_cancel_events(captain_id, cancelled_at DESC);

CREATE INDEX IF NOT EXISTS captain_cancel_events_open_idx
  ON captain_cancel_events(captain_id, resolved_at)
  WHERE resolved_at IS NULL;

COMMIT;
