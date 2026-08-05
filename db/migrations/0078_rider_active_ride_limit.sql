-- Cap how many rides one account may hold open at the same time.
--
-- The limit existed once and was removed on purpose, because a hotel or a
-- restaurant partner legitimately dispatches several cars at once. The product
-- reason was sound; what was never put back is any other brake.
--
-- Every ride created broadcasts to every eligible captain within the dispatch
-- radius, so a single account looping ride creation floods the inbox and the
-- push channel of every captain in the city — on the same channel that carries
-- real work. The /rider routes sit outside the only rate limiter in the app,
-- which is scoped to /auth.
--
-- Two allowances rather than one, so raising the cap for partners never means
-- raising it for everyone:
--   max_active_rides_per_booker  — ordinary accounts
--   max_active_rides_per_partner — active restaurant / agency / member partners
--
-- 0 disables the limit entirely, which is the pre-migration behaviour.

BEGIN;

ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS max_active_rides_per_booker  integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS max_active_rides_per_partner integer NOT NULL DEFAULT 20;

COMMIT;
