-- One-shot delivery of an auto-generated captain password.
--
-- When an admin approves a captain application and the captain has no password
-- yet, the API generates one on the spot. We stash the plain-text value here
-- briefly so the freshly approved captain can read it back from their own
-- mobile session, copy it, then ack — at which point the column is cleared.
-- The hashed copy still lives on users.password_hash; this column only exists
-- to bridge the seconds/minutes between approval and the captain seeing it.

ALTER TABLE captain_applications
  ADD COLUMN delivered_password TEXT,
  ADD COLUMN delivered_password_at TIMESTAMPTZ;
