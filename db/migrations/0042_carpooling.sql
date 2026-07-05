BEGIN;

ALTER TYPE wallet_tx_type ADD VALUE IF NOT EXISTS 'carpooling_publication';

CREATE TABLE carpooling_trips (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id           uuid NOT NULL REFERENCES users(id),
  origin_city         text NOT NULL,
  destination_city    text NOT NULL,
  departure_at        timestamptz NOT NULL,
  total_seats         integer NOT NULL CHECK (total_seats BETWEEN 1 AND 8),
  available_seats     integer NOT NULL CHECK (available_seats >= 0),
  price_per_seat_mru  integer NOT NULL CHECK (price_per_seat_mru > 0),
  driver_phone        text NOT NULL,
  notes               text,
  publication_fee_mru integer NOT NULL,
  boost_fee_mru       integer NOT NULL DEFAULT 0,
  is_boosted          boolean NOT NULL DEFAULT false,
  boosted_until       timestamptz,
  views_count         integer NOT NULL DEFAULT 0,
  reminder_sent_at    timestamptz,
  status              text NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','full','expired','cancelled')),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX carpooling_trips_active_idx
  ON carpooling_trips (status, departure_at)
  WHERE status = 'active';

CREATE INDEX carpooling_trips_driver_idx ON carpooling_trips (driver_id);

CREATE INDEX carpooling_trips_boost_order_idx
  ON carpooling_trips (is_boosted, boosted_until DESC, departure_at ASC)
  WHERE status = 'active';

ALTER TABLE app_settings
  ADD COLUMN carpooling_enabled          boolean NOT NULL DEFAULT true,
  ADD COLUMN carpooling_publication_fee  integer NOT NULL DEFAULT 100,
  ADD COLUMN carpooling_boost_fee        integer NOT NULL DEFAULT 200;

COMMIT;
