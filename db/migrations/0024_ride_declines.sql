-- Track captain "decline" actions so the same ride is never re-offered to a
-- captain who already explicitly refused it.
--
-- Why:
--   When the alert modal pops up, the captain can accept, refuse or pause. So
--   far "refuse" was purely client-side (the watcher marked the ride as
--   "seen" in AsyncStorage). That means:
--     - if the captain reinstalled the app, the ride could re-alert,
--     - the dispatcher kept the ride in this captain's inbox card list,
--     - we had no record of refusal rates for analytics.
--   Tracking declines server-side fixes all three.
--
-- Shape:
--   ride_id    — references rides(id) so a decline disappears with the ride.
--   captain_id — references users(id), the refusing captain.
--   declined_at default now()
--   UNIQUE (ride_id, captain_id) so re-pressing "Refuser" is idempotent.

BEGIN;

CREATE TABLE ride_declines (
  ride_id     uuid NOT NULL REFERENCES rides(id)  ON DELETE CASCADE,
  captain_id  uuid NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  declined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ride_id, captain_id)
);

CREATE INDEX ride_declines_captain_idx ON ride_declines (captain_id);

COMMIT;
