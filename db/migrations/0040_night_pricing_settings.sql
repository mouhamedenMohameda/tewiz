-- Configurable night-pricing window in app_settings.
--
-- Why:
--   Operations asked to edit the night surge from admin (hours + multiplier)
--   without code deploys.
--
-- Behavior:
--   When enabled, fares are multiplied by `night_price_multiplier` for rides
--   priced during the local-hour interval [night_price_start_hour,
--   night_price_end_hour). The interval supports midnight wrap when
--   start > end (e.g., 22 -> 5).

BEGIN;

ALTER TABLE app_settings
  ADD COLUMN night_pricing_enabled   boolean        NOT NULL DEFAULT true,
  ADD COLUMN night_price_multiplier  numeric(6,2)   NOT NULL DEFAULT 2.00,
  ADD COLUMN night_price_start_hour  smallint       NOT NULL DEFAULT 0,
  ADD COLUMN night_price_end_hour    smallint       NOT NULL DEFAULT 5;

ALTER TABLE app_settings
  ADD CONSTRAINT app_settings_night_price_multiplier_bounds
    CHECK (night_price_multiplier BETWEEN 1.00 AND 10.00),
  ADD CONSTRAINT app_settings_night_price_hours_bounds
    CHECK (
      night_price_start_hour BETWEEN 0 AND 23
      AND night_price_end_hour BETWEEN 0 AND 23
      AND night_price_start_hour <> night_price_end_hour
    );

COMMIT;
