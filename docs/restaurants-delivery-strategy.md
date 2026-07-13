# Restaurants — Commande & Livraison : stratégie de confiance & monétisation

> Même moteur de confiance que **Tfag** et **Location Auto** : lister reste
> gratuit, l'app devient **la source de vérité** de chaque commande, commission
> **au succès seulement**. La nouveauté ici : on passe de 2 à **3 parties**
> (client → restaurant → livreur) et le paiement est **cash à la livraison
> (COD)**. Le levier central devient l'**attribution** : prouver qu'une commande
> vient de l'app **et** a bien été livrée, pour que personne ne puisse dire
> « pas reçu / pas livré / pas payé ».
>
> Patron de code à réutiliser : `apps/api/src/modules/carpooling/` (booking
> horodaté → OTP → commission → notation → no-show). Backbone livraison
> existant : tarification **colis** (`0019`), **captains livreurs** (rides),
> **wallet + `debitWallet`**, notifications.

---

## 0. Où on en est aujourd'hui

- `restaurants` (`0020`, + tél/photos `0062`–`0064`) et `dishes` : un
  **catalogue** consultable (lister / voir / gérer). Seedé depuis OSM.
  **La mise en ligne est déjà gratuite** → levier « pas de pay-to-post » acquis.
- Réglages commission déjà présents : `restaurant_passenger_commission_bps`,
  `restaurant_colis_commission_bps` (pour les courses/colis liés).
- **Aucun flux de commande** (`restaurant_orders` n'existe pas), **aucune
  affectation de livreur restaurant**, **aucune preuve de livraison**, **aucune
  notation de commande**.

Autrement dit : le catalogue existe, **le moteur transactionnel est à créer** —
mais en s'appuyant sur des briques déjà là (colis, livreurs, wallet, Tfag).

---

## 1. Les problèmes spécifiques (3 parties + cash)

| # | Problème | Qui subit |
|---|----------|-----------|
| A | Le restaurant ne veut pas payer pour être listé sans preuve de demande | Restaurant |
| B | « J'ai jamais reçu la commande » (restaurant, pour éviter la commission) | Plateforme |
| C | **Attribution** : impossible de prouver que la commande vient de l'app | Plateforme |
| D | Le client commande puis **refuse à la porte** (COD non payé) → le livreur perd | Livreur |
| E | « Le livreur n'est jamais venu » / « j'ai rien reçu » | Client / Livreur |
| F | Pas de livreur disponible → commande morte, mauvaise expérience | Client |
| G | Litige qualité (plat froid, manquant, erreur) | Client |
| H | Contournement : le client rappelle le resto en direct la prochaine fois | Plateforme |
| I | « Ta commission pour rien » si la commande ne se conclut pas | Restaurant |

Le trio **C / D / E** (attribution + COD + preuve de livraison) est le cœur du
problème — c'est là que la marketplace de livraison gagne ou meurt.

---

## 2. La stratégie — 6 leviers (adaptés au 3-côtés + COD)

Principe : **au lancement, aucun risque pour le restaurant ; chaque commande a
une trace horodatée et une preuve de livraison ; la commission n'est prélevée
qu'à la livraison confirmée.**

### Levier 1 — Listing gratuit
Déjà acquis. Le restaurant ne paie jamais pour figurer au catalogue. → **A**.

### Levier 2 — Concentration
Une ville, une zone dense, **une poignée de restaurants fiables** + assez de
livreurs pour que la promesse de livraison tienne. Amorçage manuel des deux
côtés (recruter les 5-10 premiers restos, garantir des livreurs).

### Levier 3 — L'app = source de vérité (règle l'attribution)
Chaque commande est un objet `restaurant_orders` avec **statuts horodatés**
confirmés à chaque main :

```
Passée → Acceptée resto → Livreur affecté → Récupérée → Livrée (OTP) → Payée → Terminée
```

- **Reçu horodaté** + notif au restaurant dès la commande → tue **B**.
- L'**id de commande + timeline** = la preuve d'attribution opposable au resto
  ET au livreur → tue **C**.

### Levier 4 — Preuve de livraison par OTP (le cœur livraison)
- **Code OTP de livraison** : le **client** détient le code, le **livreur** le
  saisit au moment de remettre la commande → statut `delivered`. Preuve
  irréfutable que la commande est arrivée → tue **E**.
- Pas de code = pas de livraison confirmée = pas de commission (et le litige est
  tranché objectivement).

### Levier 5 — Cash à la livraison, tracé (pas d'escrow, cadré)
On n'a pas de rail de paiement : le client **paie cash au livreur** à la porte.
L'app ne détient pas l'argent, elle **trace l'encaissement** :
- Montant de la commande **verrouillé à la commande** (`total_mru`), affiché aux
  3 parties → pas de surprise, pas de marchandage.
- À la livraison, le livreur confirme **« payé »** (avec l'OTP) → l'app sait que
  le cash a circulé et peut prélever sa commission.
- **Refus à la porte (D)** : le livreur marque `refused` → la commande est
  enregistrée **contre le client** (réputation + compteur no-show).

### Levier 6 — Commission au succès + réputation + pénalité + (option) partage
- **Commission** prélevée du **wallet du restaurant** (et/ou du livreur) **à la
  livraison confirmée seulement**. Réglable admin, **0 % au lancement**. → **I**.
- **Partage de commission** (option stratégique déjà envisagée) : reverser une
  part de la commission à l'**agence de livraison / au livreur** pour les
  motiver à passer par l'app → aligne le 3ᵉ côté au lieu d'en faire un
  concurrent. Un simple `courier_commission_bps` séparé.
- **Notation** : le client note le **restaurant** ET le **livreur** ; le livreur
  peut noter le client. Réputation visible → décourage **G** et **D**.
- **Pénalité no-show client** : refus/absence répétés sur fenêtre glissante →
  **blocage temporaire de commande** (mécanisme identique au no-show Tfag).

---

## 3. Cycle de vie d'une commande (3 parties)

```
   CLIENT                 RESTAURANT                 LIVREUR
commande ─────▶ 🔔 reçu horodaté (tue "j'ai rien reçu")
 (placed)            │
                     ├─ Accepter ─▶ (accepted)  • total verrouillé
                     │                           • OTP livraison généré (client)
        ◀── 🔔 "acceptée, en préparation" ───────┘
                     └─ prête ─▶ (ready) ──────────▶ 🔔 course dispo
                                                     ├─ Prendre ─▶ (assigned)
                                                     ├─ Récupérée ─▶ (picked_up)
   … livraison …                                     │
   ── donne le code ───────────────────────────────▶ ├─ saisit OTP + "payé"
                                                     │   (delivered → paid)
        ◀── 🔔 "livrée" ──────────────────────────── ┘  • commission prélevée
                                                        • notation ouverte (resto + livreur)
   ─ ou: refused (client refuse) / no_courier (aucun livreur) / cancelled
```

---

## 4. Ce qui est malin ici (à ne pas rater)

1. **L'attribution est le produit.** L'objet commande + timeline + OTP est ce
   qui vous rend indispensable : sans lui, resto et client se recontactent en
   direct (**H**). Rendez l'app plus pratique que le contournement (suivi,
   preuve, réputation, promo fidélité perdue hors app).
2. **Cash = tracer, pas détenir.** Verrouiller le montant + confirmer « payé »
   via l'OTP suffit à asseoir la commission, sans rail de paiement.
3. **Le livreur est un allié, pas un coût.** Le partage de commission le motive
   à passer par l'app (au lieu d'être un canal parallèle).
4. **Le no-show client est LE risque COD.** Sans acompte possible, la parade est
   la **réputation + blocage glissant** (déjà codé pour Tfag).
5. **Réutilisez le backbone.** Une livraison resto ≈ un **colis** du restaurant
   vers le client : mêmes livreurs, même tarif colis, même wallet. Ne réinventez
   pas la livraison.

---

## 5. Plan d'implémentation concret

### 5.1 Base de données (`00XX_restaurant_orders.sql`)
```sql
CREATE TABLE restaurant_orders (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id  text NOT NULL REFERENCES restaurants(id),
  client_id      uuid NOT NULL REFERENCES users(id),
  courier_id     uuid REFERENCES users(id),             -- affecté à 'ready'
  status         text NOT NULL DEFAULT 'placed'
                 CHECK (status IN ('placed','accepted','ready','assigned',
                        'picked_up','delivered','paid','completed',
                        'refused','no_courier','cancelled')),
  items_total_mru    integer NOT NULL,
  delivery_fee_mru   integer NOT NULL DEFAULT 0,          -- réutiliser tarif colis
  total_mru          integer NOT NULL,                    -- verrouillé
  commission_mru     integer NOT NULL DEFAULT 0,
  delivery_otp       text,                                -- détenu par le client
  paid               boolean NOT NULL DEFAULT false,
  address            text NOT NULL,
  note               text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  accepted_at    timestamptz, ready_at timestamptz, picked_up_at timestamptz,
  delivered_at   timestamptz, cancelled_at timestamptz,
  cancelled_by   text CHECK (cancelled_by IN ('client','restaurant','system'))
);

CREATE TABLE restaurant_order_items (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id  uuid NOT NULL REFERENCES restaurant_orders(id) ON DELETE CASCADE,
  dish_id   uuid NOT NULL REFERENCES dishes(id),
  name      text NOT NULL,          -- snapshot (le plat peut changer ensuite)
  unit_mru  integer NOT NULL,
  qty       integer NOT NULL CHECK (qty > 0)
);
```
Notation (calquée sur `carpooling_ratings`) : `restaurant_order_ratings`
(role `client` / `restaurant` / `courier`) + agrégat sur `restaurants.rating`
(existe déjà) et `users.courier_rating_avg/count`.

Réglages admin (patron `carpoolingCommissionBps`) :
- `restaurant_order_commission_bps` (défaut 0 au lancement),
- `courier_commission_bps` (part reversée au livreur, option),
- `restaurant_no_show_limit` (blocage client, défaut 0).

### 5.2 API (`restaurants/orders.service.ts` + routes)
Miroir des fonctions Tfag :
| Fonction | Équivalent Tfag | Rôle |
|----------|-----------------|------|
| `placeOrder(clientId, restId, items, address)` | `requestBooking` | crée la commande, verrouille le total, notifie le resto, **bloque si no-show client ≥ limite** |
| `acceptOrder / declineOrder(restId, id)` | `accept/declineBooking` | resto accepte → génère l'OTP livraison |
| `markReady(restId, id)` | *(nouveau)* | prête → ouvre l'affectation livreur |
| `assignCourier(courierId, id)` | *(nouveau)* | un livreur prend la course (`assigned`) |
| `pickup(courierId, id)` | *(nouveau)* | `picked_up` |
| `deliver(courierId, id, otp, paid)` | `completeBooking` (OTP) | valide livraison + « payé » → `delivered/paid` → **prélève commission** (resto), reverse au livreur si activé |
| `markRefused(courierId, id)` | `markBookingNoShow` | client refuse → compteur no-show client |
| `rateOrder(userId, id, target, stars)` | `rateBooking` | client note resto + livreur |

Wallet : ajouter `'restaurant_order_commission'` (et `'courier_earning'`) au
type `WalletTxType` + enum SQL, comme `carpooling_commission`.

### 5.3 Mobile
- **Client** (`rider/restaurants`) : panier → passer commande → suivi de statut
  temps réel + **code OTP de livraison** quand `accepted` → **« À noter »**
  (resto + livreur) quand `completed`.
- **Restaurant** (nouvel espace resto, ou back-office) : commandes entrantes,
  Accepter/Refuser, « Prête ».
- **Livreur** (espace captain existant) : courses dispo → Prendre → Récupérée →
  **« Livrer (saisir code) » + payé**.
- Réutiliser : modale OTP + `RatingModal` de Tfag ; fiche resto affiche
  **⭐ réputation** (comme la note conducteur).

### 5.4 Admin
- Champs **commission commande (%)**, **part livreur (%)**, **limite no-show
  client** dans les réglages (patron `carpoolingCommissionBps` déjà appliqué 3×).
- Vue **commandes** (suivi/litiges), réutilisant les patterns admin existants.

---

## 6. Phasage

**Phase 1 — Commande + preuve (copie de Tfag)**
1. `restaurant_orders` + items, statut jusqu'à `delivered/paid`.
2. OTP de livraison + « payé » → `completed` + commission (0 % au lancement).
3. Reçu horodaté + notifications à chaque étape.
4. Notation (client → resto + livreur).
5. Blocage no-show client.

**Phase 2 — Fluidité 3-côtés & incitations**
6. Affectation livreur automatique/manuelle + intégration au flux colis existant.
7. **Partage de commission** avec livreur/agence (`courier_commission_bps`).
8. Suivi live (position livreur), litiges qualité, promos fidélité anti-contournement.

> Phase 1 seule règle A, B, C, E, I. Phase 2 règle D (mieux), F, G, H.

---

## 7. Résumé en une phrase

> **Le catalogue reste gratuit ; chaque commande devient un objet horodaté
> (client → resto → livreur) prouvé par un OTP de livraison + confirmation
> « payé » ; la commission n'est prélevée qu'à la livraison confirmée, une part
> peut être reversée au livreur pour l'aligner, et réputation + blocage no-show
> tiennent les trois côtés.**

Même moteur que Tfag/Location Auto, étendu au fait qu'ici il y a **trois
parties et du cash** — donc le nerf, c'est **l'attribution + la preuve de
livraison**.
