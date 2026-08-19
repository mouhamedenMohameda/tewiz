-- WhatsApp entry points shown in the mobile app.
--
-- Three admin-managed values, all living on the single-row app_settings table
-- next to the other remote-config knobs (download links, min version, …):
--
--   whatsapp_order_phone   — the number a rider taps "Demander via WhatsApp" to
--     reach on the ride-request screen. They send a voice note with their
--     pickup/destination instead of filling the map form. Seeded with the
--     launch number so the button works the moment this ships; the admin can
--     repoint it without a release. NULL hides the button.
--
--   whatsapp_community_url — invite link to the public WhatsApp group any user
--     may join, shown on the same ride-request screen. NULL hides the link.
--
--   whatsapp_captain_url   — invite link to the Captains-only WhatsApp group.
--     Served ONLY through the captain-authenticated endpoint (never in the
--     public /config payload), so a non-captain can't discover it. NULL hides
--     the link.
--
-- All three are plain TEXT: WhatsApp deep links (wa.me/…, chat.whatsapp.com/…)
-- and phone numbers don't fit a stricter type, and validation lives in the
-- admin API layer.

BEGIN;

ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS whatsapp_order_phone   TEXT DEFAULT '+22233322777',
  ADD COLUMN IF NOT EXISTS whatsapp_community_url TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_captain_url   TEXT;

COMMIT;
