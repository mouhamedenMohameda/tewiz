-- "Carte des routes bloquées" — crowdsourced road obstructions.

CREATE TYPE road_report_reason AS ENUM (
  'sand',
  'flood',
  'construction',
  'police_checkpoint',
  'accident',
  'protest',
  'other'
);

CREATE TYPE road_report_status AS ENUM ('active', 'expired', 'dismissed', 'admin_removed');

CREATE TABLE road_reports (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id       UUID NOT NULL REFERENCES users(id),
  reporter_role     user_role NOT NULL,
  location          GEOGRAPHY(POINT, 4326) NOT NULL,
  radius_m          INT NOT NULL DEFAULT 50 CHECK (radius_m BETWEEN 20 AND 500),
  reason            road_report_reason NOT NULL,
  note              TEXT,
  photo_storage_key TEXT,

  reported_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ NOT NULL,            -- typically reported_at + 6h

  confirmations     INT NOT NULL DEFAULT 0,
  dismissals        INT NOT NULL DEFAULT 0,
  status            road_report_status NOT NULL DEFAULT 'active'
);

CREATE INDEX road_reports_active_gix
  ON road_reports USING GIST (location)
  WHERE status = 'active';

CREATE INDEX road_reports_active_expiry_idx
  ON road_reports(expires_at)
  WHERE status = 'active';

-- Per-user confirmations to prevent double-confirming.
CREATE TABLE road_report_votes (
  report_id   UUID NOT NULL REFERENCES road_reports(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vote        SMALLINT NOT NULL CHECK (vote IN (-1, 1)), -- 1 = confirm, -1 = dismiss
  voted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (report_id, user_id)
);
