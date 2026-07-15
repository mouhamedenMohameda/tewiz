-- Reduce the captain onboarding to the essential documents.
--
-- Why:
--   Captains had to upload 14 photos (selfie, NNI recto+verso, permis
--   recto+verso, carte grise, assurance, vignette, visite technique, and five
--   car angles). Most of that is redundant — the information is already on the
--   papers, and the interior/side car shots add friction without helping the
--   review. The new policy keeps only the five documents an operator actually
--   needs to validate a driver:
--     nni_front · license_front · assurance · carte_grise · car_front
--
-- Effect:
--   Optional document types can still be uploaded by the captain; they simply
--   no longer gate submission (mobile) or approval (admin). This is the same
--   switch the admin can flip by hand in /settings/documents — pinned here so
--   every environment starts from the trimmed policy. Reversible from that
--   same admin page.
--
--   `updated_by` stays NULL to denote a system/migration change (the column is
--   nullable and ON DELETE SET NULL).

BEGIN;

UPDATE document_requirements
   SET is_required = false,
       updated_at  = now()
 WHERE type IN (
   'selfie',
   'nni_back',
   'license_back',
   'vignette',
   'visite_technique',
   'car_back',
   'car_left',
   'car_right',
   'car_interior'
 );

-- Make the essential five explicitly required (idempotent — they were already
-- required by the 0026 seed, but a re-run of this migration must restore them).
UPDATE document_requirements
   SET is_required = true,
       updated_at  = now()
 WHERE type IN (
   'nni_front',
   'license_front',
   'assurance',
   'carte_grise',
   'car_front'
 );

COMMIT;
