-- Rattrapage : des riders "réels" étaient invisibles dans l'admin.
--
-- POST /auth/me/phone (le rider capture son numéro avant sa première course)
-- ne remettait jamais is_guest à false. Résultat : dès qu'un guest posait son
-- numéro, son compte restait marqué "anonyme" pour toujours — sauf promotion
-- capitaine. GET /admin/users masque is_guest=true par défaut (et l'UI admin
-- n'expose aucun moyen de désactiver ce filtre), donc TOUS ces riders,
-- pourtant identifiés par un numéro de téléphone bien réel, étaient
-- introuvables dans le panel admin. Un rider qui perdait sa session (mise à
-- jour de l'app, réinstallation...) tombait alors dans une impasse : son
-- ancien numéro est pris (phone_taken) par un compte sans mot de passe
-- (jamais admin-créé) que l'admin ne pouvait ni retrouver ni débloquer.
--
-- Corrigé côté code dans la même série de commits (auth.routes.ts met
-- désormais is_guest=false en même temps que le téléphone). Cette migration
-- rattrape les comptes déjà piégés par l'ancien comportement : un compte avec
-- un numéro de téléphone n'est par définition plus un "guest anonyme".

UPDATE users
   SET is_guest = false
 WHERE COALESCE(is_guest, false) = true
   AND phone IS NOT NULL;
