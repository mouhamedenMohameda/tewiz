-- Admin-editable pricing & commission settings.
--
-- Why:
--   Until now PER_KM_MRU / DEFAULT_COMMISSION_BPS / etc. lived in environment
--   variables, so changing them required an SSH + server restart. Operations
--   wanted to be able to nudge the price-per-km or the commission % from the
--   admin panel without redeploying.
--
-- Shape:
--   Single-row table (id = 1, enforced by CHECK). All amounts in MRU
--   (integers; the khoums split was killed in 0017). Commission stored as
--   basis points (700 = 7.00 %).
--
-- Behaviour:
--   Existing rides are unaffected — fare_estimate_mru and commission_rate_bps
--   are written into the `rides` row at booking time. Only NEW bookings read
--   the latest settings.

BEGIN;

CREATE TABLE app_settings (
  id                       smallint    PRIMARY KEY DEFAULT 1
                                       CHECK (id = 1),

  -- Pricing (all MRU, integer)
  base_fare_mru            integer     NOT NULL DEFAULT 20,
  per_km_mru               integer     NOT NULL DEFAULT 30,
  min_fare_mru             integer     NOT NULL DEFAULT 40,

  -- Commission in basis points (10_000 = 100%)
  default_commission_bps   integer     NOT NULL DEFAULT 700,
  colis_commission_bps     integer     NOT NULL DEFAULT 1000,

  -- Audit
  updated_at               timestamptz NOT NULL DEFAULT now(),
  updated_by               uuid        REFERENCES users(id) ON DELETE SET NULL,

  CONSTRAINT app_settings_positive_amounts CHECK (
    base_fare_mru >= 0 AND per_km_mru >= 0 AND min_fare_mru >= 0
  ),
  CONSTRAINT app_settings_commission_range CHECK (
    default_commission_bps BETWEEN 0 AND 10000
    AND colis_commission_bps BETWEEN 0 AND 10000
  )
);

-- Seed the single row with the historical defaults (= same values as the
-- env-var defaults, so behaviour is identical before/after the migration).
INSERT INTO app_settings (id) VALUES (1);

COMMIT;
