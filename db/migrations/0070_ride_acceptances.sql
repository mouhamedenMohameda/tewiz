-- Track EVERY captain who tapped "Accepter" on a ride — not just the winner.
--
-- Why:
--   A ride is offered to every online, in-radius captain at once. The first to
--   accept wins the race (rides.captain_id is set, status -> 'accepted'); any
--   captain who taps a fraction of a second later gets a 409 "not_searching"
--   and, until now, vanished without a trace. The back-office therefore could
--   only ever show the assigned captain, never the others who also wanted it.
--
--   Recording every acceptance lets the operator see the full picture on the
--   ride detail page: who got it AND who else raised their hand (name + phone),
--   which is useful for demand insight and for manually re-assigning by phone
--   when the winner cancels.
--
-- Shape (mirrors ride_declines, migration 0024):
--   ride_id     — references rides(id) so the row disappears with the ride.
--   captain_id  — references users(id), the accepting captain.
--   accepted_at default now(); the earliest row is the winner.
--   UNIQUE (ride_id, captain_id) so a double-tap is idempotent.
--
-- The assigned captain is always rides.captain_id; a row here whose captain_id
-- differs from that is an "also-accepted" (lost the race).

BEGIN;

CREATE TABLE IF NOT EXISTS ride_acceptances (
  ride_id     uuid NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  captain_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ride_id, captain_id)
);

-- The admin ride-detail lookup lists all acceptances for one ride, oldest first.
CREATE INDEX IF NOT EXISTS ride_acceptances_ride_idx
  ON ride_acceptances (ride_id, accepted_at);

COMMIT;
