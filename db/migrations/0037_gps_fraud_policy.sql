BEGIN;

CREATE TABLE captain_gps_violations (
  id                    bigserial PRIMARY KEY,
  captain_id            uuid NOT NULL REFERENCES captains(user_id) ON DELETE CASCADE,
  ride_id               uuid NOT NULL UNIQUE REFERENCES rides(id) ON DELETE CASCADE,
  base_commission_mru   integer NOT NULL CHECK (base_commission_mru >= 0),
  charged_commission_mru integer NOT NULL CHECK (charged_commission_mru >= 0),
  action                text NOT NULL CHECK (action IN (
    'warning_1',
    'warning_2',
    'double_commission',
    'recovery_suspend'
  )),
  recovered_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX captain_gps_violations_captain_time_idx
  ON captain_gps_violations(captain_id, created_at);

CREATE INDEX captain_gps_violations_unrecovered_idx
  ON captain_gps_violations(captain_id, recovered_at)
  WHERE recovered_at IS NULL;

COMMIT;