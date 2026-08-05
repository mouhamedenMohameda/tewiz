-- Keep a trace on the ride when a captain drops it.
--
-- When an assigned captain cancels, the ride goes back to 'searching' and the
-- row is reset clean: captain_id, accepted_at and arrived_at are nulled. That
-- reset is correct — the ride really is unassigned again — but it left no
-- evidence at all. Support looking at a ride could not tell a captain
-- cancellation apart from a ride nobody had ever taken, and the rider had no
-- way to learn why their screen rewound from "un captain arrive" to
-- "recherche en cours".
--
-- captain_cancel_events already records the event for fraud detection, but it
-- is keyed by (captain, ride) and is not read on any rider-facing path. These
-- two columns put the last cancellation where anyone reading the ride will
-- see it.
--
-- Deliberately "last", not a history: a ride re-broadcast several times keeps
-- only the most recent drop, which is what the rider needs to be told. The
-- full history stays in captain_cancel_events.

BEGIN;

ALTER TABLE rides
  ADD COLUMN IF NOT EXISTS last_captain_cancel_reason text,
  ADD COLUMN IF NOT EXISTS last_captain_cancel_at     timestamptz;

COMMIT;
