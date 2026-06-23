-- Track the origin of each ride so we can apply a dedicated commission to
-- rides that required call-center intervention.
--
-- Why:
--   When a passenger books from the mobile app the ride is fully self-served
--   (source='app'). When a passenger calls our operator and the admin books
--   the ride on their behalf via /admin/rides, the operator spends time on
--   the call (source='operator') — we want a dedicated commission rate for
--   those, configured in app_settings (migration 0022).
--
-- Shape:
--   rides.source: text, 'app' | 'operator', NOT NULL, default 'app'.
--   Existing rows are back-filled to 'app' which preserves current behaviour.

BEGIN;

ALTER TABLE rides
  ADD COLUMN source text NOT NULL DEFAULT 'app';

ALTER TABLE rides
  ADD CONSTRAINT rides_source_chk CHECK (source IN ('app', 'operator'));

CREATE INDEX rides_source_idx ON rides (source);

COMMIT;
