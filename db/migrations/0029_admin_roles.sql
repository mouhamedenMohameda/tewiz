-- Admin sub-roles (RBAC inside the admin panel).
--
-- We keep the top-level user_role enum (rider | captain | admin) untouched,
-- and add a second dimension `admin_role` that is set only when role='admin'.
-- This avoids breaking any existing query that branches on role.
--
-- Roles:
--   super_admin   — full access, only role allowed to manage other admins
--                   and global settings / document requirements
--   ops_manager   — operations head; everything except admin management,
--                   global settings, and detailed finance figures
--   dispatcher    — creates/dispatches rides, handles voice requests
--   kyc_reviewer  — reviews driver KYC applications
--   finance       — wallet top-ups, commission bonuses, revenue stats
--   support       — read-only customer-support agent

BEGIN;

CREATE TYPE admin_role AS ENUM (
  'super_admin',
  'ops_manager',
  'dispatcher',
  'kyc_reviewer',
  'finance',
  'support'
);

ALTER TABLE users
  ADD COLUMN admin_role admin_role;

-- Existing admins keep full access by default. New admin sub-roles are
-- assigned explicitly via the admin UI from now on.
UPDATE users
   SET admin_role = 'super_admin'
 WHERE role = 'admin';

-- Invariant: admin_role is set iff the user is an admin.
ALTER TABLE users
  ADD CONSTRAINT users_admin_role_matches_role
  CHECK (
    (role = 'admin' AND admin_role IS NOT NULL) OR
    (role <> 'admin' AND admin_role IS NULL)
  );

CREATE INDEX users_admin_role_idx
  ON users(admin_role)
  WHERE admin_role IS NOT NULL;

COMMIT;
