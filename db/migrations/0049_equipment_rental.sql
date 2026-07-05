ALTER TYPE ride_type ADD VALUE 'equipment_rental';

ALTER TABLE app_settings ADD COLUMN equipment_rental_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE app_settings ADD COLUMN equipment_rental_daily_rate_mru INTEGER NOT NULL DEFAULT 0;
ALTER TABLE app_settings ADD COLUMN equipment_rental_commission_bps INTEGER NOT NULL DEFAULT 500;

CREATE TABLE equipment_rental_details (
  ride_id UUID PRIMARY KEY REFERENCES rides(id) ON DELETE CASCADE,
  equipment_type VARCHAR(100) NOT NULL,
  booked_days INTEGER NOT NULL,
  daily_rate_mru INTEGER NOT NULL,
  booked_fare_mru INTEGER NOT NULL
);
