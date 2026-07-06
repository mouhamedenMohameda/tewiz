-- Car rental ("Location Auto") — a dedicated bespoke module (not a generic ad).
-- Anyone can list a vehicle with photos, a daily price, a deposit and an
-- optional driver. Renters browse the catalog and request a booking for
-- specific dates; the owner confirms/declines, and on confirmation the two
-- parties' phone numbers are revealed. No commission, cash/deposit handled
-- directly between them.

BEGIN;

CREATE TABLE car_listings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title               text NOT NULL,
  brand_model         text,
  year                integer CHECK (year IS NULL OR year BETWEEN 1950 AND 2100),
  city                text NOT NULL,
  price_per_day_mru   integer NOT NULL CHECK (price_per_day_mru > 0),
  deposit_mru         integer NOT NULL DEFAULT 0 CHECK (deposit_mru >= 0),
  with_driver         boolean NOT NULL DEFAULT false,
  driver_day_rate_mru integer CHECK (driver_day_rate_mru IS NULL OR driver_day_rate_mru >= 0),
  transmission        text CHECK (transmission IN ('auto','manual')),
  seats               integer CHECK (seats IS NULL OR seats BETWEEN 1 AND 60),
  description         text,
  photos              text[] NOT NULL DEFAULT '{}',
  status              text NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','paused','removed')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX car_listings_browse_idx ON car_listings (status, city) WHERE status = 'active';
CREATE INDEX car_listings_owner_idx ON car_listings (owner_id);

CREATE TABLE car_bookings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id   uuid NOT NULL REFERENCES car_listings(id) ON DELETE CASCADE,
  renter_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date   date NOT NULL,
  end_date     date NOT NULL,
  days         integer NOT NULL CHECK (days > 0),
  with_driver  boolean NOT NULL DEFAULT false,
  total_mru    integer NOT NULL CHECK (total_mru >= 0),
  status       text NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','confirmed','declined','cancelled','completed')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  CHECK (end_date >= start_date)
);

CREATE INDEX car_bookings_listing_idx ON car_bookings (listing_id, status);
CREATE INDEX car_bookings_renter_idx ON car_bookings (renter_id);

COMMIT;
