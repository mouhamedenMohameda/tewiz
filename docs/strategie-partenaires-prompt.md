# Prompt — Système de partenaires avec attribution de courses et partage de commission

> Copier-coller ce document tel quel comme prompt dans une session Claude Code
> ouverte à la racine du monorepo. Il contient le contexte business, l'état
> actuel du code, et la spécification technique complète à implémenter.

---

## 1. Contexte business (à lire avant de coder)

Nous lançons deux stratégies de croissance pour notre plateforme VTC/livraison
en Mauritanie (app "Tewiz"). Les deux reposent sur le **partage d'un
pourcentage de NOTRE commission** (jamais du prix de la course) avec des
partenaires qui nous apportent de l'offre (livreurs) ou de la demande
(courses), avec une **condition de fin certaine et écrite d'avance** pour
chaque type de partenaire.

### Stratégie 1 — Agences de livraison & Restaurants (principale)

**Agences** : on signe avec le directeur d'une agence de livraison. L'agence
enregistre ses livreurs sur notre app (chaque livreur rattaché à son agence
via un code agence). Sur chaque course complétée par un livreur affilié,
l'agence touche un pourcentage de notre commission.

*Condition de fin certaine — la "fenêtre de gain par livreur"* : l'agence
touche sa part sur les courses de chaque livreur pendant **12 mois après
l'inscription du livreur OU jusqu'à ses 300 premières courses complétées**
(le premier des deux atteint). Après, le livreur est "acquis" et ne génère
plus de commission pour l'agence. Le contrat ne se termine jamais : chaque
nouveau livreur apporté ouvre une nouvelle fenêtre. Garde-fou obligatoire :
**une seule fenêtre par livreur à vie** (liée à son identité — téléphone +
pièce d'identité), sinon l'agence désinscrit/réinscrit les mêmes livreurs
pour rouvrir des fenêtres. Une petite **prime de clôture** est versée quand
un livreur finit sa fenêtre en règle.

**Restaurants** : le restaurant reçoit les appels de ses clients comme avant,
mais lance lui-même la course depuis notre app avec un compte "restaurant"
dédié (il remplace notre call center). Il touche un pourcentage de notre
commission sur chaque course qu'il crée et qui est complétée. **Pas de
fenêtre de fin pour les restaurants** : leur travail est continu (chaque
course créée), contrairement aux agences dont le travail est ponctuel
(recruter). Leur extinction est naturelle : quand le client final commande
lui-même depuis l'app, la course ne passe plus par le restaurant.

### Stratégie 2 — Membres particuliers via Facebook/WhatsApp (complémentaire)

Des particuliers recrutés via les réseaux sociaux apprennent à lancer des
courses depuis l'app pour leur entourage, et touchent un pourcentage de
notre commission sur chaque course qu'ils créent et qu'un chauffeur termine.

*Conditions de fin certaines (doubles)* :
1. **Quota** : le membre touche sa part sur ses **100 premières courses
   créées, complétées et payées, OU pendant 6 mois** (le premier atteint).
2. **Extinction par conversion** : dès qu'un client final commande lui-même
   avec son propre compte, ses courses ne passent plus par le membre —
   automatique par construction.
3. **Prime de conversion** : le membre touche un bonus fixe quand un de
   "ses" clients installe l'app et complète sa première course seul. Ça
   aligne le membre avec notre objectif (autonomiser les clients) au lieu
   de l'inciter à rester intermédiaire.

### Règles transversales

- **Cumul** : une course peut avoir DEUX partenaires — un côté création
  (restaurant ou membre qui a lancé la course) et un côté chauffeur (agence
  du livreur). Chacun touche sa part de la commission plateforme,
  indépendamment, mais la somme des parts versées sur une course ne doit
  jamais dépasser un plafond global configurable (défaut : 50 % de la
  commission).
- **Transparence** : chaque partenaire voit ses courses attribuées et ses
  gains en quasi temps réel (dashboard), le paiement reste mensuel.
- **Anti-fraude dès le jour 1** : détection des paires client↔chauffeur
  récurrentes, courses anormalement courtes, rafales de création. Les gains
  suspects sont gelés (`on_hold`), pas supprimés — un admin tranche.
- Tous les pourcentages sont en **basis points** (100 bps = 1 %), tous les
  montants en **khoums** (conventions existantes du code).

---

## 2. État actuel du code (monorepo)

- `db/migrations/` — SQL brut numéroté. Dernière : `0040_night_pricing_settings.sql`.
  Acquis réutilisables :
  - `0006_rides.sql` : `rides.commission_rate_bps` (snapshot à la création),
    `rides.commission_khoums` (calculé à la complétion).
  - `0005_wallet.sql` + `0017_money_in_mru.sql` : wallet chauffeur,
    `wallet_transactions` typées (`commission`, `commission_refund`),
    montants en khoums.
  - `0022_long_distance_and_operator_commission.sql` : `app_settings` porte
    déjà des taux de commission par origine (`operator_*_commission_bps`).
  - `0023_ride_source.sql` : `rides.source` ∈ `('app','operator')` avec
    CHECK + index — **à étendre**, ne pas dupliquer.
  - `0020_restaurants.sql` : table `restaurants` = annuaire éditorial
    affiché dans l'app rider (PK slug, pas de compte, pas de lien users).
  - `0016_guest_users.sql`, `0014_password_auth.sql`, `0029_admin_roles.sql`.
- `apps/api/src/modules/` — API Node/TypeScript par modules :
  `admin/`, `auth/`, `captain/`, `rides/`, `restaurants/`, `wallet/`,
  `rider/`, `jobs/`, etc. Suivre ce découpage.
- `apps/admin-web/` — back-office React (React Query + AppShell, pattern
  des pages liste établi, ex. la page users).
- `apps/mobile/` — app Expo React Native (riders + captains).
- `packages/shared-types/` — types partagés entre apps.

---

## 3. Ce qu'il faut construire

### Phase A — Schéma (une migration `0041_partners.sql`)

1. **Table `partners`**
   - `id uuid PK`, `type text CHECK IN ('agency','restaurant','individual')`,
     `name`, `phone`, `code text UNIQUE` (code court saisi/partagé, ex.
     `AGX-04`), `user_id uuid NULL REFERENCES users(id)` (compte de
     connexion du partenaire), `restaurant_id text NULL REFERENCES
     restaurants(id)` (lien vers l'annuaire pour type='restaurant'),
     `status text CHECK IN ('active','suspended','ended') DEFAULT 'active'`,
     audit (`created_at`, `created_by`, …).
   - Termes contractuels snapshotés PAR partenaire (pas seulement globaux,
     chaque contrat peut différer) : `share_bps integer` (part de la
     commission plateforme), et selon le type :
     - agency : `window_months integer DEFAULT 12`,
       `window_max_courses integer DEFAULT 300`,
       `closure_bonus_khoums bigint DEFAULT 0`.
     - individual : `quota_courses integer DEFAULT 100`,
       `quota_months integer DEFAULT 6`,
       `conversion_bonus_khoums bigint DEFAULT 0`.
   - CHECK : `share_bps BETWEEN 0 AND 5000`.

2. **Table `captain_partner_links`** (fenêtre de gain par livreur)
   - `captain_id uuid UNIQUE` ← **UNIQUE = une seule fenêtre par livreur à
     vie**, c'est le garde-fou anti-réinscription. `partner_id uuid`,
     `attached_at timestamptz DEFAULT now()`,
     `expires_at timestamptz` (= attached_at + window_months, figé à la
     création), `courses_counted integer DEFAULT 0`,
     `closed_at timestamptz NULL`, `closure_bonus_paid boolean DEFAULT false`.
   - La fenêtre est **ouverte** si `closed_at IS NULL AND now() < expires_at
     AND courses_counted < window_max_courses` (du partenaire).

3. **Colonnes sur `rides`**
   - `origin_partner_id uuid NULL REFERENCES partners(id)` — le partenaire
     qui a CRÉÉ la course (restaurant ou membre). NULL = client direct.
   - Étendre le CHECK de `rides.source` : `('app','operator','restaurant','partner')`
     (`restaurant` = compte restaurant, `partner` = membre individuel).

4. **Table `partner_earnings`** (le registre — source de vérité des gains)
   - `id uuid PK`, `partner_id`, `ride_id`,
     `role text CHECK IN ('ride_creator','captain_provider','closure_bonus','conversion_bonus')`,
     `base_commission_khoums bigint`, `share_bps integer`,
     `amount_khoums bigint`,
     `status text CHECK IN ('pending','on_hold','settled','cancelled') DEFAULT 'pending'`,
     `settlement_id uuid NULL`, `created_at`.
   - `UNIQUE (ride_id, partner_id, role)` — idempotence : re-jouer la
     complétion d'une course ne crédite jamais deux fois.

5. **Table `partner_settlements`** (paiements mensuels)
   - `id uuid PK`, `partner_id`, `period_start date`, `period_end date`,
     `total_khoums bigint`, `status CHECK IN ('draft','paid') DEFAULT 'draft'`,
     `paid_at`, `paid_by uuid`, `note text`.

6. **Table `partner_beneficiaries`** (pour la prime de conversion, stratégie 2)
   - `partner_id`, `phone text`, `first_served_at`, `converted_at NULL`,
     `conversion_ride_id NULL`. `UNIQUE (phone)` — un bénéficiaire n'est
     rattaché qu'à un seul membre (le premier qui l'a servi).

7. **`app_settings`** : ajouter
   `partner_total_share_cap_bps integer DEFAULT 5000` (plafond de cumul),
   `partner_defaults jsonb` optionnel pour pré-remplir les termes à la
   création d'un partenaire.

### Phase B — API (`apps/api/src/modules/partners/`)

Nouveau module suivant le pattern des modules existants (routes + service +
queries typées).

1. **Attribution à la complétion de course** — s'accrocher à l'endroit
   existant où `rides.commission_khoums` est calculé (module `rides/`,
   flux de complétion). Après le calcul de la commission plateforme :
   - *Côté création* : si `origin_partner_id` est non nul et le partenaire
     `active` — pour un `individual`, vérifier le quota (compteur de
     earnings `ride_creator` < `quota_courses` ET `created_at` du partenaire
     + `quota_months` non dépassé), sinon ne rien créditer. Insérer une
     ligne `partner_earnings(role='ride_creator')`.
   - *Côté chauffeur* : chercher `captain_partner_links` du captain ; si la
     fenêtre est ouverte, insérer `partner_earnings(role='captain_provider')`
     et incrémenter `courses_counted` **dans la même transaction**. Si le
     compteur atteint `window_max_courses` (ou si `expires_at` est dépassé
     au moment du check) : poser `closed_at = now()` et insérer la ligne
     `closure_bonus` si configurée.
   - *Plafond de cumul* : si `somme des share_bps` des deux lignes >
     `partner_total_share_cap_bps`, réduire proportionnellement les deux
     montants pour tenir sous le plafond.
   - Tout ce bloc est **best-effort transactionnel** : une erreur
     d'attribution ne doit JAMAIS faire échouer la complétion de la course
     (logger + continuer).
   - Annulation/remboursement de course : passer les earnings liés en
     `cancelled` (miroir de `commission_refund`).

2. **Création de course par un partenaire** :
   - Restaurant : compte `users` avec rôle partenaire, lié via
     `partners.user_id`. Endpoint de création de course (réutiliser le flux
     admin/rider existant le plus proche) qui pose `source='restaurant'` et
     `origin_partner_id`. La commission plateforme de la course utilise le
     taux par source, comme le fait déjà `operator_*_commission_bps` —
     ajouter les taux `restaurant_*` et `partner_*` dans `app_settings` sur
     le même modèle que la migration 0022.
   - Membre individuel : même mécanique, `source='partner'`. À la création,
     upsert du `partner_beneficiaries` avec le téléphone du client final
     (premier membre servant ce numéro = propriétaire).

3. **Prime de conversion** : à la première course complétée d'un utilisateur
   rider dont le téléphone existe dans `partner_beneficiaries` avec
   `converted_at IS NULL` et `source='app'` (il a commandé LUI-MÊME) :
   poser `converted_at`, insérer `partner_earnings(role='conversion_bonus')`.

4. **Rattachement des livreurs** : à l'inscription/validation KYC d'un
   captain, un champ optionnel "code agence" crée le
   `captain_partner_links`. Si le captain a déjà eu une fenêtre (violation
   du UNIQUE), refuser avec un message clair — c'est voulu.

5. **Endpoints admin** (`modules/admin/`, protégés par les rôles existants) :
   - CRUD partenaires (+ suspension), liste des liens captain↔agence,
   - registre des earnings avec filtres (partenaire, période, statut),
   - génération d'un settlement mensuel (regrouper les `pending` de la
     période → `draft`, puis marquer `paid`),
   - actions de modération : `on_hold` ↔ `pending`, `cancelled`.

6. **Endpoints partenaire** (dashboard, auth = compte `users` du partenaire) :
   - `GET /partner/me` (termes, statut, progression quota/fenêtres),
   - `GET /partner/earnings?period=` (courses attribuées + montants, quasi
     temps réel — c'est l'outil anti-litige),
   - `GET /partner/settlements`.

7. **Anti-fraude** (job périodique dans `modules/jobs/`, même pattern que
   les jobs existants) : marquer `on_hold` les earnings dont la course
   matche au moins un signal — même paire rider↔captain > N fois sur 7
   jours, distance < seuil minimal, > M courses créées par le même
   partenaire individuel en 1 h. Seuils dans `app_settings`. Un rapport
   admin liste les earnings gelés avec le signal déclencheur.

### Phase C — Admin web (`apps/admin-web/`)

Suivre le pattern de la page users (React Query + AppShell + route dédiée) :
1. Page **Partenaires** : liste (type, code, statut, gains du mois), création
   avec termes pré-remplis par type, détail avec onglets — infos/termes,
   livreurs rattachés (avec progression de fenêtre : X/300 courses, expire
   le …), earnings, settlements.
2. Page **Règlements** : générer le settlement du mois par partenaire,
   marquer payé.
3. Section **Fraude** : earnings `on_hold` avec le signal, actions
   valider/annuler.
4. Lien de navigation dans l'AppShell.

### Phase D — Mobile (`apps/mobile/`)

1. Inscription captain : champ optionnel "Code agence" (validé côté API).
2. Compte restaurant/membre : un mode de création de course simplifié
   (client final = nom + téléphone + adresses, réutiliser le flux guest
   existant de `0016_guest_users.sql`) accessible aux comptes partenaires.
   Si c'est trop lourd pour la V1, fallback acceptable : les partenaires
   utilisent une page web mobile servie par l'admin-web — mais l'attribution
   API doit être identique.
3. Écran "Mes gains" pour le partenaire connecté (liste earnings + totaux),
   consommant les endpoints `/partner/*`.

### Types partagés

Ajouter dans `packages/shared-types` : `Partner`, `PartnerType`,
`PartnerEarning`, `PartnerSettlement`, statuts, et l'extension de
`RideSource`.

---

## 4. Ordre d'exécution et critères d'acceptation

Implémenter dans l'ordre A → B → C → D. À chaque phase, compiler et faire
tourner les tests existants avant de passer à la suivante.

Le système est correct quand :
1. Une course complétée par un livreur affilié crée UNE ligne
   `captain_provider` ; la rejouer n'en crée pas une deuxième.
2. La 300ᵉ course (ou le passage de la date d'expiration) ferme la fenêtre,
   verse la prime de clôture une seule fois, et la 301ᵉ course ne crédite
   rien.
3. Un captain ne peut jamais avoir deux fenêtres, même après suppression et
   réinscription.
4. Une course créée par un restaurant et livrée par un livreur d'agence crée
   DEUX lignes, dont la somme respecte le plafond de cumul.
5. Un membre individuel à 100 courses (ou à 6 mois) ne génère plus de ligne
   `ride_creator`.
6. La première course auto-commandée d'un bénéficiaire déclenche la prime de
   conversion une seule fois, et ses courses suivantes ne créditent plus
   personne.
7. Un échec dans l'attribution ne bloque jamais la complétion de la course
   (le chauffeur est payé quoi qu'il arrive).
8. Les montants sont en khoums, les taux en bps, partout.
