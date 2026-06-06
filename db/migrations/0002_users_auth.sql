-- Users: shared identity across all roles.
CREATE TYPE user_role AS ENUM ('rider', 'captain', 'admin');
CREATE TYPE user_status AS ENUM ('active', 'suspended', 'banned', 'deleted');
CREATE TYPE language_code AS ENUM ('fr', 'ar', 'en');

CREATE TABLE users (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone        CITEXT NOT NULL UNIQUE,           -- E.164: +222XXXXXXXX
  role         user_role NOT NULL,
  status       user_status NOT NULL DEFAULT 'active',
  full_name    TEXT,
  language     language_code NOT NULL DEFAULT 'fr',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ
);

CREATE INDEX users_role_idx ON users(role) WHERE status = 'active';

-- One-time passwords for phone verification.
-- We never store the OTP plaintext; only a salted hash.
CREATE TABLE otp_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       CITEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  purpose     TEXT NOT NULL,                     -- 'login', 'passenger_confirm', etc.
  expires_at  TIMESTAMPTZ NOT NULL,
  attempts    INT NOT NULL DEFAULT 0,
  consumed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX otp_codes_phone_idx ON otp_codes(phone, created_at DESC);

-- Refresh-token sessions. Access tokens are short-lived JWTs (not stored).
CREATE TABLE sessions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id          TEXT NOT NULL,
  refresh_token_hash TEXT NOT NULL,
  user_agent         TEXT,
  expires_at         TIMESTAMPTZ NOT NULL,
  last_used_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at         TIMESTAMPTZ
);

CREATE INDEX sessions_user_idx ON sessions(user_id) WHERE revoked_at IS NULL;

-- Push notification tokens (FCM / Expo).
CREATE TABLE push_tokens (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id  TEXT NOT NULL,
  token      TEXT NOT NULL,
  platform   TEXT NOT NULL,                       -- 'ios' | 'android'
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, device_id)
);
