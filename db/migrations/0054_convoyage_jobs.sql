-- Convoyage — a dedicated job board (not a generic ad). A client posts a job
-- (drive my vehicle from A to B on a date). Convoyeurs browse open jobs and
-- submit a proposal (optional price + note, carrying their rating). The client
-- reviews proposals and PICKS one; on selection the two phone numbers are
-- revealed and the job is assigned. No commission — paid directly.

BEGIN;

CREATE TABLE convoyage_jobs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pickup_location      geography(Point, 4326),
  pickup_label         text NOT NULL,
  dropoff_label        text NOT NULL,
  vehicle_plate        text NOT NULL,
  vehicle_model        text,
  desired_date         date,
  note                 text,
  status               text NOT NULL DEFAULT 'open'
                       CHECK (status IN ('open','assigned','completed','cancelled','expired')),
  assigned_provider_id uuid REFERENCES users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  assigned_at          timestamptz,
  completed_at         timestamptz
);

CREATE INDEX convoyage_jobs_open_idx ON convoyage_jobs (status, created_at) WHERE status = 'open';
CREATE INDEX convoyage_jobs_client_idx ON convoyage_jobs (client_id);

CREATE TABLE convoyage_proposals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id      uuid NOT NULL REFERENCES convoyage_jobs(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  price_mru   integer CHECK (price_mru IS NULL OR price_mru >= 0),
  note        text,
  status      text NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','accepted','rejected','withdrawn')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, provider_id)
);

CREATE INDEX convoyage_proposals_job_idx ON convoyage_proposals (job_id);
CREATE INDEX convoyage_proposals_provider_idx ON convoyage_proposals (provider_id);

COMMIT;
