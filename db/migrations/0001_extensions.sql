-- Required extensions
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid(), crypt()
CREATE EXTENSION IF NOT EXISTS citext;     -- case-insensitive text (phones, refs)
