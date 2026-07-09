-- Service listings ("annonces") — a classified-ads marketplace modeled on
-- carpooling (Ervdni). A captain (provider) publishes an ad for a service in a
-- category (car rental, private driver, moving, freight, etc.), sets their own
-- price and how long the ad should stay visible, and pays a fixed publication
-- fee from their wallet. Once paid, the ad is visible until published_until.
-- Buyers browse by category and reveal the provider's phone to call directly.
-- No dispatch, no ride lifecycle, no commission-on-fare.

BEGIN;

ALTER TYPE wallet_tx_type ADD VALUE IF NOT EXISTS 'listing_publication';

-- Per-category config: on/off toggle + the fixed publication fee we charge.
CREATE TABLE listing_categories (
  category            text PRIMARY KEY,
  label               text NOT NULL,
  enabled             boolean NOT NULL DEFAULT false,
  publication_fee_mru integer NOT NULL DEFAULT 200 CHECK (publication_fee_mru >= 0)
);

INSERT INTO listing_categories (category, label, enabled, publication_fee_mru) VALUES
  ('private_driver',      'Chauffeur Privé',      true, 200),
  ('convoyage',           'Convoyage',            true, 200),
  ('car_rental',          'Location Auto',        true, 300),
  ('roadside_assistance', 'Assistance Routière',  true, 150),
  ('light_moving',        'Déménagement Léger',   true, 200),
  ('intercity_freight',   'Fret Intercité',       true, 250),
  ('equipment_rental',    'Location Équipement',  true, 200);

CREATE TABLE service_listings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id         uuid NOT NULL REFERENCES users(id),
  category            text NOT NULL REFERENCES listing_categories(category),
  title               text NOT NULL,
  description         text,
  price_mru           integer NOT NULL CHECK (price_mru > 0),
  price_unit          text NOT NULL DEFAULT 'fixed'
                      CHECK (price_unit IN ('fixed','per_hour','per_day','per_km','per_trip')),
  provider_phone      text NOT NULL,
  publication_fee_mru integer NOT NULL,
  window_days         integer NOT NULL CHECK (window_days BETWEEN 1 AND 90),
  published_until     timestamptz NOT NULL,
  views_count         integer NOT NULL DEFAULT 0,
  status              text NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','expired','cancelled')),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX service_listings_browse_idx
  ON service_listings (category, published_until)
  WHERE status = 'active';

CREATE INDEX service_listings_provider_idx ON service_listings (provider_id);

COMMIT;
