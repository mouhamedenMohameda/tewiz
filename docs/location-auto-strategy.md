# Location Auto — Stratégie de confiance & monétisation

> Même logique que **Tfag (covoiturage)** : on retire le risque au vendeur au
> lancement, on fait de l'app **la source de vérité** de chaque location, et on
> ne prend une commission **qu'au succès**. Ce document décrit la stratégie et
> le plan d'implémentation, ancrés sur le code existant.
>
> Module de référence déjà implémenté : `apps/api/src/modules/carpooling/` +
> `apps/mobile/app/(app)/carpooling/`. La location auto **réutilise le même
> patron** (booking horodaté → acceptation → OTP → commission → notation →
> pénalité no-show), avec en plus les spécificités « objet de valeur » :
> **caution**, **état des lieux photo**, et **double preuve (remise + retour)**.

---

## 0. Où on en est aujourd'hui (code existant)

Fichiers : `apps/api/src/modules/car-rental/car-rental.service.ts` + `.routes.ts`,
`apps/mobile/app/(app)/car-rental/*`, `apps/mobile/lib/carRental.ts`,
migrations `0045_car_rental.sql` (legacy sur `rides`) et `0053_car_rental.sql`
(le module « bespoke » à étendre).

**Déjà en place :**
- `car_listings` : le propriétaire liste une voiture (prix/jour, `deposit_mru`,
  avec/sans chauffeur, photos, statut). **La mise en ligne est déjà gratuite**
  (aucun frais de publication) → le levier « pas de pay-to-post » est acquis.
- `car_bookings` : le locataire réserve des dates (`start_date`, `end_date`,
  `days`, `total_mru`), statuts `pending → confirmed / declined / cancelled /
  completed`. Le propriétaire est notifié à la demande (reçu horodaté partiel).
  Les téléphones sont révélés **à la confirmation**.
- Réglage `car_rental_commission_bps` (défaut **500 = 5 %**) existe déjà côté
  admin… **mais il n'est jamais prélevé** (voir le commentaire dans `0053`).

**Ce qui manque (les trous de confiance) :**
1. Aucune **commission au succès** n'est réellement prélevée.
2. Aucune **preuve de remise ni de retour** du véhicule (OTP).
3. Aucune **caution suivie** (le champ `deposit_mru` existe mais rien ne trace
   son encaissement / sa restitution).
4. Aucun **état des lieux** (photos à la remise et au retour) → litiges dégâts
   parole contre parole.
5. Aucune **notation bilatérale**.
6. Aucune **pénalité no-show / non-retour**.

---

## 1. Les problèmes spécifiques à la location auto

En plus des problèmes classiques de marketplace (œuf-et-poule, « le vendeur ne
veut pas payer d'avance », « j'ai rien reçu comme demande »), la voiture ajoute
des risques **haute valeur** :

| # | Problème | Qui subit |
|---|----------|-----------|
| A | Le propriétaire ne veut pas payer pour lister sans être sûr d'avoir des locataires | Propriétaire |
| B | « J'ai jamais reçu la demande » (pour discréditer l'app / éviter la commission) | Plateforme |
| C | Le locataire dit « je prends » puis ne se présente pas (no-show) | Propriétaire |
| D | **Le locataire ne rend pas la voiture** (ou en retard) | Propriétaire |
| E | **Litige sur l'état** : rayures, panne, carburant, km — « c'était déjà comme ça » | Les deux |
| F | Litige sur la **caution** : montant, retenue, restitution | Les deux |
| G | Contournement : ils se contactent puis concluent hors app (pas de commission) | Plateforme |
| H | « Ta commission pour rien » si la location ne se fait finalement pas | Propriétaire |

Les points **D, E, F** sont propres à l'objet de valeur et exigent des
mécanismes que Tfag n'avait pas besoin d'avoir.

---

## 2. La stratégie — 6 leviers (adaptés)

Principe directeur (identique à Tfag) : **au lancement, zéro risque pour le
propriétaire ; l'app est la preuve de chaque location ; commission seulement au
succès.**

### Levier 1 — Mise en ligne gratuite
Déjà acquis (aucun frais sur `car_listings`). On le garde : lister une voiture
ne coûte rien, jamais. → répond à **A**.

### Levier 2 — Concentration
Une seule ville, un catalogue **plein** plutôt qu'un catalogue vide. Amorçage
manuel du côté demande (comme Tfag).

### Levier 3 — L'app = source de vérité
Chaque location passe par des **statuts obligatoires horodatés**, confirmés des
deux côtés :

```
Demande → Acceptée → Voiture remise (OTP remise) → En cours
        → Voiture rendue (OTP retour) → Terminée → Notation
```

- **Reçu horodaté** dès la demande + notification au propriétaire → tue **B**.
- **Contact révélé seulement après acceptation** (déjà le cas) → limite **G**.

### Levier 4 — Double preuve : remise ET retour (le cœur voiture)
Deux points de contrôle par **code OTP**, sur le modèle Tfag mais dédoublé :

- **OTP de remise** : le **locataire** détient le code, le **propriétaire** le
  saisit au moment de donner les clés → statut `in_progress`. Preuve que la
  location a réellement démarré → tue **C**.
- **OTP de retour** : le **propriétaire** détient le code, le **locataire** le
  saisit au moment de rendre la voiture → statut `completed`. Preuve que la
  voiture est revenue → tue **D**, et c'est **le seul moment où la commission
  est prélevée**.

### Levier 5 — Caution + état des lieux (anti-litige objet de valeur)
- **Caution suivie** : au moment de la remise, on enregistre que la caution
  (`deposit_mru`) a été **remise en cash au propriétaire** (l'app ne détient pas
  l'argent, elle **trace l'accord**). Au retour sans dégât, l'app rappelle au
  propriétaire de **restituer la caution**. → cadre **F**.
- **État des lieux photo** : photos obligatoires **à la remise** (par le
  propriétaire) et **au retour** (par le locataire *et* le propriétaire).
  Horodatées, stockées. → preuve objective pour **E**.
- **Litige** : un statut `disputed` déclenchable au retour ; l'admin tranche
  avec les photos avant/après.

### Levier 6 — Commission au succès + réputation + pénalité
- **Commission** : `car_rental_commission_bps` prélevée du **wallet du
  propriétaire** uniquement à `completed` (retour confirmé par OTP). Réglable
  admin, peut démarrer à **0 %** au lancement. → répond à **H**.
- **Notation bilatérale** après `completed` (propriétaire ↔ locataire) →
  réputation visible sur les fiches voiture, décourage les mauvais
  comportements.
- **Pénalité no-show / non-retour** : un locataire qui accumule des `no_show`
  ou un `no_return` sur une fenêtre glissante est **bloqué temporairement**
  (même mécanisme que le no-show Tfag). Le `no_return` est grave → flag admin
  immédiat.

---

## 3. Cycle de vie d'une location (state machine)

```
                       LOCATAIRE                         PROPRIÉTAIRE
demande de location  ──────────────▶ 🔔 reçu horodaté (tue "j'ai rien reçu")
   (pending)                              │
                                          ├─ Accepter ─▶ (confirmed)
   ◀── 🔔 "accepté" ───────────────────── ┘  • téléphones révélés
                                             • caution due affichée
                                             • OTP REMISE généré (locataire)
   … rendez-vous, photos état des lieux (remise) …
                                          ├─ saisit OTP REMISE
   ── donne le code remise ─────────────▶ │  (in_progress)
                                             • caution encaissée (tracée)
                                             • OTP RETOUR généré (propriétaire)
   … période de location …
   … retour, photos état des lieux (retour) …
   ── saisit OTP RETOUR ────────────────▶ (completed)
                                             • commission prélevée (wallet)
                                             • rappel: rendre la caution
                                             • notation ouverte (2 côtés)
   ─ ou: no_show (locataire absent) / no_return (pas rendu) / disputed (litige)
```

---

## 4. Plan d'implémentation concret

> On **copie** le module Tfag, on **adapte** au double checkpoint + caution +
> photos. Chaque brique renvoie à son équivalent covoiturage déjà écrit.

### 4.1 Base de données (nouvelle migration `00XX_car_rental_trust.sql`)

Sur `car_bookings`, ajouter :
```sql
ALTER TABLE car_bookings
  ADD COLUMN status_v2         text,              -- voir statuts étendus ci-dessous
  ADD COLUMN pickup_otp        text,              -- détenu par le locataire
  ADD COLUMN return_otp        text,              -- détenu par le propriétaire
  ADD COLUMN commission_mru    integer NOT NULL DEFAULT 0,
  ADD COLUMN deposit_taken     boolean NOT NULL DEFAULT false,
  ADD COLUMN deposit_returned  boolean NOT NULL DEFAULT false,
  ADD COLUMN pickup_photos     text[] NOT NULL DEFAULT '{}',
  ADD COLUMN return_photos      text[] NOT NULL DEFAULT '{}',
  ADD COLUMN picked_up_at      timestamptz,
  ADD COLUMN returned_at       timestamptz,
  ADD COLUMN cancelled_by      text CHECK (cancelled_by IN ('renter','owner','system'));
```
Étendre le `CHECK` de `status` :
`pending, confirmed, declined, cancelled, in_progress, completed, no_show, no_return, disputed`.

Notation (calquée sur `carpooling_ratings` de `0060`) :
```sql
CREATE TABLE car_rental_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES car_bookings(id) ON DELETE CASCADE,
  rater_id uuid NOT NULL REFERENCES users(id),
  ratee_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL CHECK (role IN ('renter','owner')),
  stars integer NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX car_rental_ratings_one_per_rater ON car_rental_ratings (booking_id, rater_id);
```
Réputation : réutiliser `users.carpooling_rating_avg/count` **ou** ajouter
`car_rental_rating_avg/count` (recommandé : colonnes dédiées, la réputation
« location » et « covoiturage » ne se mélangent pas).

Réglages admin (mêmes 9 points de câblage que `carpoolingCommissionBps`, cf.
`app-settings.service.ts`) — la plupart existent déjà :
- `car_rental_commission_bps` — **existe**, à **appliquer** (mettre 0 au lancement).
- `car_rental_no_show_limit integer DEFAULT 0` — **à ajouter** (comme `carpooling_no_show_limit`).

### 4.2 API (`car-rental.service.ts` + `.routes.ts`)

Réutiliser tel quel : `createCar`, `updateCar`, `browseCars`, `getCarDetail`,
`requestBooking`, `respondBooking` (confirm/decline).

À **ajouter** (miroir des fonctions Tfag) :
| Fonction | Équivalent Tfag | Rôle |
|----------|-----------------|------|
| `pickupBooking(ownerId, id, otp, photos)` | `completeBooking` (OTP) | propriétaire saisit l'OTP remise → `in_progress`, encaisse caution, stocke photos |
| `returnBooking(renterId, id, otp)` + `confirmReturn(ownerId, id, photos)` | `completeBooking` | valide le retour → `completed` → **prélève la commission** du wallet proprio |
| `markNoShow(ownerId, id)` | `markBookingNoShow` | locataire absent à la remise |
| `markNoReturn(ownerId, id)` | *(nouveau)* | voiture pas rendue → `no_return` + flag admin |
| `openDispute(userId, id, photos)` | *(nouveau)* | litige état → `disputed` |
| `rateBooking(userId, id, stars, comment)` | `rateBooking` | notation bilatérale sur `completed` |

Commission (dans `returnBooking`), copié de Tfag :
```ts
const commission = Math.round(booking.total_mru * settings.carRentalCommissionBps / 10_000);
if (commission > 0) await debitWallet({ captainId: ownerId, amountMru: commission,
  type: 'car_rental_commission', reason: `Commission location ${...}`, createdBy: ownerId }, client);
```
> Ajouter `'car_rental_commission'` au type `WalletTxType`
> (`packages/shared-types/src/index.ts`) + enum SQL `wallet_tx_type`, comme on
> l'a fait pour `carpooling_commission`.

Blocage no-show (dans `requestBooking`) : identique à Tfag (compter les
`no_show` du locataire sur 30 jours glissants ; refuser si ≥ limite).

Routes à ajouter : `POST /car-rental/bookings/:id/pickup`, `/return`,
`/confirm-return`, `/no-show`, `/no-return`, `/dispute`, `/rate`.

### 4.3 Mobile (`app/(app)/car-rental/*` + `lib/carRental.ts`)

- **Entrée** : comme Tfag option 1 — tout le monde arrive sur **Louer** (browse
  + `my-bookings`) ; l'espace **Propriétaire** (`my-cars`, `add-car`,
  bookings entrants) n'apparaît que pour un compte autorisé à lister.
- **Locataire** (`my-bookings.tsx`) : afficher le statut + **code OTP remise**
  quand `confirmed`, bouton **« Rendre (code retour) »** quand `in_progress`,
  section **« À noter »** quand `completed`.
- **Propriétaire** (`my-cars.tsx` / bookings entrants) : Accepter/Refuser,
  **« Remettre (saisir code) » + photos**, **« Confirmer retour » + photos**,
  **No-show / Non-rendu**, **Noter**.
- Modales : saisie OTP (réutiliser celle de Tfag), sélecteur d'étoiles
  (réutiliser `RatingModal`), upload photos état des lieux.
- Fiche voiture : afficher **⭐ réputation du propriétaire** (comme la note
  conducteur sur les cartes de trajet Tfag).

### 4.4 Admin (`apps/admin-web/src/app/settings/page.tsx`)

- **Commission location (%)** : le champ `carRentalCommissionPct` existe déjà —
  vérifier qu'il est bien câblé, laisser à **0 %** au lancement.
- **Limite absences (30j)** : ajouter `carRentalNoShowLimit` (même patron que
  `carpoolingNoShowLimit`).
- Vue **litiges** : liste des bookings `disputed` avec photos avant/après pour
  arbitrer (Phase 2).

---

## 5. Phasage recommandé

**Phase 1 — Confiance de base (copie de Tfag)**
1. Commission au succès réellement prélevée (à 0 % au lancement).
2. OTP **retour** unique (comme l'OTP de fin Tfag) → `completed` + commission.
3. Reçu horodaté renforcé + notifications à chaque étape.
4. Notation bilatérale.
5. Blocage no-show.

**Phase 2 — Spécificités objet de valeur**
6. OTP **remise** (double checkpoint) + statut `in_progress`.
7. **Caution** suivie (encaissée / restituée) + rappels.
8. **État des lieux** photos remise + retour.
9. Statut `no_return` (+ flag admin) et `disputed` (+ vue arbitrage admin).

> Phase 1 seule règle déjà A, B, C, G, H. Phase 2 règle D, E, F (les risques
> haute-valeur).

---

## 6. Résumé en une phrase

> **Lister reste gratuit ; chaque location passe par demande horodatée →
> acceptation → OTP de remise → OTP de retour, avec caution tracée et état des
> lieux photo ; la commission n'est prélevée qu'au retour confirmé, et la
> réputation + le blocage no-show disciplinent les deux côtés.**

C'est le même moteur de confiance que Tfag, étendu au fait qu'ici **la valeur
revient physiquement** — donc on prouve **le départ ET le retour**.
