-- Up Migration
-- Anonymous "guest" rider accounts.
--
-- Product decision (relaxes part of 0014): riders no longer need an
-- admin-created account. On first launch the mobile app provisions a guest
-- rider (POST /auth/guest) with NO phone and NO password, so it can browse and
-- use the authed rider endpoints immediately. A phone number is captured the
-- first time it is actually needed — before the first ride, or before a captain
-- application — via POST /auth/me/phone. The admin is only involved when a guest
-- decides to become a captain (existing KYC flow).
--
-- Security: account creation is reintroduced for the 'rider' role ONLY, with
-- the role hard-coded server-side in /auth/guest. The original OTP flaw
-- (unauthenticated creation of admin/captain accounts) does NOT return.

-- 1. Phone becomes optional — a guest starts without one. It stays UNIQUE, and
--    Postgres allows multiple NULLs under a UNIQUE constraint, so many guests
--    can coexist with a NULL phone.
ALTER TABLE users ALTER COLUMN phone DROP NOT NULL;

-- 2. Flag guest accounts so we can distinguish them, and clear the flag when a
--    guest is promoted to a real captain.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_guest boolean NOT NULL DEFAULT false;

-- Lightweight index to find/clean orphan guests later (reinstalls leave the
-- old guest behind). Partial — only guests are indexed.
CREATE INDEX IF NOT EXISTS users_guest_idx ON users(created_at) WHERE is_guest = true;
