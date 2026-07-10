-- Backfill: recover phone numbers that were mistakenly typed into the
-- `description` column and move them into the new `phones` list.
--
-- Historically the admin form had no phone field, so operators dropped the
-- restaurant's number(s) into "description". Now that we have a proper
-- `phones text[]`, we extract every Mauritanian number found there and store
-- it normalized to +222, then clear the description when it held nothing but
-- phone-ish noise.
--
-- Extraction rules (matches the app's "with or without +222" acceptance):
--   * a valid number is 8 local digits, optionally grouped in 2-2-2-2 with a
--     single space/dot/dash/underscore between groups (so "36 772971" reads as
--     one number),
--   * an optional +222 / 222 country prefix is tolerated and dropped,
--   * NEWLINES are NOT valid group separators, so numbers on separate lines and
--     short junk fragments (e.g. "03674", "006286") never bridge together,
--   * everything is stored as +222XXXXXXXX.
--
-- Only rows whose `phones` is still empty are touched, so any number entered
-- through the new form is never overwritten.

BEGIN;

WITH extracted AS (
  SELECT r.id,
         (SELECT array_agg(DISTINCT n ORDER BY n)
            FROM (
              SELECT '+222' || regexp_replace(m[1], '\D', '', 'g') AS n
                FROM regexp_matches(
                       r.description,
                       '(?:\+?222[ \t._-]*)?(\d{2}[ \t._-]?\d{2}[ \t._-]?\d{2}[ \t._-]?\d{2})',
                       'g'
                     ) AS m
            ) s
         ) AS nums
    FROM restaurants r
   WHERE r.description IS NOT NULL
     AND r.description <> ''
     AND cardinality(r.phones) = 0
)
UPDATE restaurants r
   SET phones = e.nums,
       phone  = COALESCE(r.phone, e.nums[1]),
       -- Clear the description only when nothing but phone-ish noise remains
       -- after stripping digits, separators and the "واتساب"/whatsapp label —
       -- this preserves any genuine prose that happens to also carry a number.
       description = CASE
         WHEN nullif(trim(regexp_replace(
                r.description,
                '[0-9\s+._\-/|,;:()]+|واتساب|whatsapp|whats|واتس|tél|tel|téléphone|phone',
                '', 'gi')), '') IS NULL
           THEN NULL
         ELSE r.description
       END,
       updated_at = now()
  FROM extracted e
 WHERE r.id = e.id
   AND e.nums IS NOT NULL
   AND cardinality(e.nums) > 0;

COMMIT;
