ALTER TYPE ride_type ADD VALUE 'car_rental';

ALTER TABLE app_settings ADD COLUMN car_rental_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE app_settings ADD COLUMN car_rental_daily_rate_mru INTEGER NOT NULL DEFAULT 0;
ALTER TABLE app_settings ADD COLUMN car_rental_commission_bps INTEGER NOT NULL DEFAULT 500;

CREATE TABLE car_rental_details (
  ride_id UUID PRIMARY KEY REFERENCES rides(id) ON DELETE CASCADE,
  booked_days INTEGER NOT NULL,
  daily_rate_mru INTEGER NOT NULL,
  booked_fare_mru INTEGER NOT NULL
);
