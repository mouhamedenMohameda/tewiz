-- Captain KYC: applications, documents, approved captains, vehicles.

CREATE TYPE application_status AS ENUM (
  'draft',           -- captain still filling in
  'submitted',       -- waiting for admin review
  'under_review',    -- admin currently looking at it
  'needs_correction',-- admin sent back with reasons; captain re-uploads
  'approved',
  'rejected'
);

CREATE TYPE document_type AS ENUM (
  'selfie',
  'nni_front',
  'nni_back',
  'license_front',
  'license_back',
  'carte_grise',
  'assurance',
  'vignette',
  'visite_technique',
  'car_front',
  'car_back',
  'car_left',
  'car_right',
  'car_interior'
);

CREATE TYPE document_status AS ENUM ('pending', 'approved', 'rejected', 'expired');

CREATE TABLE captain_applications (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Phone is captured BEFORE a user row exists, since the captain has no
  -- account yet. On approval we create the users row and link it.
  phone              CITEXT NOT NULL,
  user_id            UUID REFERENCES users(id),  -- filled on approval
  status             application_status NOT NULL DEFAULT 'draft',

  -- Personal info (validated when submitted)
  full_name          TEXT,
  nni                TEXT,                       -- Mauritanian national ID number
  date_of_birth      DATE,
  address_label      TEXT,
  emergency_contact_name  TEXT,
  emergency_contact_phone CITEXT,

  -- Vehicle info
  vehicle_plate      TEXT,
  vehicle_brand      TEXT,
  vehicle_model      TEXT,
  vehicle_year       INT,
  vehicle_color      TEXT,
  vehicle_seats      INT,

  -- Captain preferences (used after approval)
  accepts_colis      BOOLEAN NOT NULL DEFAULT false,
  accepts_long_distance BOOLEAN NOT NULL DEFAULT false,

  -- Review
  submitted_at       TIMESTAMPTZ,
  reviewed_by        UUID REFERENCES users(id),
  reviewed_at        TIMESTAMPTZ,
  rejection_reason   TEXT,
  correction_notes   TEXT,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A captain can't have two open applications at the same time.
CREATE UNIQUE INDEX captain_applications_open_one
  ON captain_applications(phone)
  WHERE status IN ('draft', 'submitted', 'under_review', 'needs_correction');

-- Prevent re-registering with an already-approved NNI.
CREATE UNIQUE INDEX captain_applications_unique_approved_nni
  ON captain_applications(nni)
  WHERE status = 'approved' AND nni IS NOT NULL;

CREATE UNIQUE INDEX captain_applications_unique_approved_plate
  ON captain_applications(vehicle_plate)
  WHERE status = 'approved' AND vehicle_plate IS NOT NULL;

CREATE TABLE application_documents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  UUID NOT NULL REFERENCES captain_applications(id) ON DELETE CASCADE,
  type            document_type NOT NULL,
  storage_key     TEXT NOT NULL,                 -- S3/R2 object key (private bucket)
  content_hash    TEXT,                          -- sha256, deters duplicate uploads
  status          document_status NOT NULL DEFAULT 'pending',
  -- Used for assurance / vignette / visite_technique
  expires_at      DATE,
  reject_reason   TEXT,
  reviewed_by     UUID REFERENCES users(id),
  reviewed_at     TIMESTAMPTZ,
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX application_documents_one_per_type
  ON application_documents(application_id, type);

-- Approved captains. Created on application approval.
CREATE TYPE captain_status AS ENUM ('active', 'suspended', 'banned');

CREATE TABLE captains (
  user_id            UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  application_id     UUID NOT NULL REFERENCES captain_applications(id),
  status             captain_status NOT NULL DEFAULT 'active',
  rating_avg         NUMERIC(3,2) NOT NULL DEFAULT 0,
  rating_count       INT NOT NULL DEFAULT 0,
  total_rides        INT NOT NULL DEFAULT 0,
  accepts_colis      BOOLEAN NOT NULL DEFAULT false,
  accepts_long_distance BOOLEAN NOT NULL DEFAULT false,
  suspended_reason   TEXT,
  suspended_until    TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The current vehicle the captain operates.
-- (Future: a captain could have multiple vehicles; for MVP, one active.)
CREATE TABLE vehicles (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  captain_id   UUID NOT NULL REFERENCES captains(user_id) ON DELETE CASCADE,
  plate        TEXT NOT NULL UNIQUE,
  brand        TEXT NOT NULL,
  model        TEXT NOT NULL,
  year         INT NOT NULL,
  color        TEXT NOT NULL,
  seats        INT NOT NULL CHECK (seats BETWEEN 1 AND 8),
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX vehicles_one_active_per_captain
  ON vehicles(captain_id) WHERE is_active = true;
