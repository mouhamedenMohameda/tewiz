# Covoiturage inter-villes — Spec complète

## Concept

Service de visibilité payante pour conducteurs inter-villes.
Le conducteur paye un frais fixe pour publier son trajet. Le passager cherche, trouve, clique pour voir le numéro, et appelle lui-même. Aucun paiement côté passager.

---

## Modèle économique

- **Revenu** : frais de publication payé par le conducteur (débité du wallet Tewiz)
- **Montant** : configurable par admin (défaut: 100 MRU)
- **Option boost** : mise en avant payante (200 MRU) → trajet affiché en premier pendant 24h
- Le passager ne paye rien

---

## Base de données

### Migration `0042_carpooling.sql`

```sql
BEGIN;

CREATE TABLE carpooling_trips (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id           uuid NOT NULL REFERENCES users(id),
  origin_city         text NOT NULL,
  destination_city    text NOT NULL,
  departure_at        timestamptz NOT NULL,
  total_seats         integer NOT NULL CHECK (total_seats BETWEEN 1 AND 8),
  available_seats     integer NOT NULL CHECK (available_seats >= 0),
  price_per_seat_mru  integer NOT NULL CHECK (price_per_seat_mru > 0),
  driver_phone        text NOT NULL,
  notes               text,
  publication_fee_mru integer NOT NULL,
  is_boosted          boolean NOT NULL DEFAULT false,
  boosted_until       timestamptz,
  views_count         integer NOT NULL DEFAULT 0,
  status              text NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','full','expired','cancelled')),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX carpooling_trips_active_idx
  ON carpooling_trips (status, departure_at)
  WHERE status = 'active';

CREATE INDEX carpooling_trips_driver_idx ON carpooling_trips (driver_id);

ALTER TABLE app_settings
  ADD COLUMN carpooling_enabled          boolean NOT NULL DEFAULT true,
  ADD COLUMN carpooling_publication_fee  integer NOT NULL DEFAULT 100,
  ADD COLUMN carpooling_boost_fee        integer NOT NULL DEFAULT 200;

COMMIT;
```

Pas de table bookings. Le "réserver" = juste révéler le numéro + incrémenter views_count.

---

## API

### Fichiers à créer

```
apps/api/src/modules/carpooling/
├── carpooling.routes.ts
└── carpooling.service.ts
```

### 7 endpoints

| # | Méthode | Route | Description |
|---|---------|-------|-------------|
| 1 | POST | /carpooling/trips | Publier un trajet (paye le frais) |
| 2 | GET | /carpooling/trips | Lister les trajets actifs |
| 3 | GET | /carpooling/trips/:id | Détail d'un trajet |
| 4 | POST | /carpooling/trips/:id/reveal | Révéler le numéro (incrémente views_count) |
| 5 | PATCH | /carpooling/trips/:id/seats | Conducteur met à jour ses places (-1) |
| 6 | GET | /carpooling/my-trips | Mes publications |
| 7 | DELETE | /carpooling/trips/:id | Annuler mon trajet |

### Détail des endpoints

#### POST /carpooling/trips — Publier

```
Auth: obligatoire
Body: {
  origin_city: string,
  destination_city: string,
  departure_at: string,        // ISO 8601, > NOW() + 30min
  total_seats: number,         // 1-8
  price_per_seat_mru: number,  // > 0
  driver_phone?: string,       // défaut: téléphone du compte
  notes?: string,
  boost?: boolean              // payer le boost en plus
}

Logique:
  1. fee = app_settings.carpooling_publication_fee
     si boost: fee += app_settings.carpooling_boost_fee
  2. Vérifier solde wallet >= fee → sinon 402
  3. Débiter wallet (debitWallet existant)
  4. INSERT trip (available_seats = total_seats)
     si boost: is_boosted=true, boosted_until = NOW() + 24h
  5. Retourner 201 { trip }
```

#### GET /carpooling/trips — Lister

```
Auth: optionnelle
Query:
  origin?: string
  destination?: string
  date?: string (YYYY-MM-DD)

Logique:
  - WHERE status='active' AND departure_at > NOW()
  - ORDER BY: is_boosted DESC, boosted_until DESC, departure_at ASC
    (les boostés apparaissent en premier)
  - Retourner: id, origin_city, destination_city, departure_at,
    available_seats, price_per_seat_mru, notes, driver_name (JOIN users)
  - NE PAS retourner driver_phone dans la liste

Réponse: 200 { trips: [...] }
```

#### POST /carpooling/trips/:id/reveal — Voir le numéro

```
Auth: obligatoire
Logique:
  1. UPDATE carpooling_trips SET views_count = views_count + 1 WHERE id = $1
  2. Retourner { driver_phone, driver_name }

Réponse: 200 { driver_phone: "+222...", driver_name: "Mohamed" }
```

#### PATCH /carpooling/trips/:id/seats — Mettre à jour places

```
Auth: obligatoire (doit être le driver_id)
Body: { available_seats: number }  // 0 à total_seats

Logique:
  1. Vérifier que c'est le conducteur
  2. UPDATE available_seats
  3. Si available_seats = 0 → status = 'full'
  4. Si available_seats > 0 ET status = 'full' → status = 'active'

Réponse: 200 { trip }
```

#### GET /carpooling/my-trips — Mes publications

```
Auth: obligatoire
Réponse: 200 { trips: [...] }
  - Tous mes trajets avec views_count (le conducteur voit combien de gens ont vu son numéro)
  - Triés par created_at DESC
```

### Job CRON

```
Toutes les heures:
  UPDATE carpooling_trips SET status='expired'
  WHERE status IN ('active','full') AND departure_at < NOW() - interval '1 hour'
```

---

## Application mobile

### Pages à créer

```
apps/mobile/app/(app)/carpooling/
├── index.tsx      ← Liste + recherche
└── publish.tsx    ← Formulaire de publication
```

### Page 1: index.tsx — Liste des trajets

Structure:
- Header: "Covoiturage"
- Filtres: [Ville départ ▼] [Ville arrivée ▼] [Date] [Rechercher]
- Liste scrollable de cartes, chaque carte:
  - Origine → Destination
  - Date et heure de départ
  - Places disponibles / total
  - Prix par place
  - Nom du conducteur
  - Badge "En vedette" si is_boosted
  - Bouton [Réserver →]
- FAB en bas: [+ Publier un trajet]
- Si liste vide: "Aucun trajet trouvé"

Comportement du bouton "Réserver":
  1. Appel POST /carpooling/trips/:id/reveal
  2. Ouvrir une modal avec:
     - Numéro du conducteur affiché en gros
     - Bouton [Appeler] → Linking.openURL('tel:...')
     - Bouton [WhatsApp] → Linking.openURL('https://wa.me/222...')
     - Rappel: ville, date, prix
     - Bouton [Fermer]

### Page 2: publish.tsx — Publier un trajet

Formulaire:
- Ville de départ (dropdown liste villes)
- Ville d'arrivée (dropdown liste villes)
- Date et heure de départ (DateTimePicker)
- Nombre de places (stepper 1-8)
- Prix par place en MRU (input numérique)
- Téléphone (pré-rempli, modifiable)
- Notes (textarea, optionnel)
- Toggle "Mettre en avant (+200 MRU)" avec explication
- Encadré: "Frais de publication: 100 MRU" (ou 300 si boost)
- Bouton [Payer et publier]

Gestion d'erreurs:
- 402 → "Solde insuffisant" + bouton "Recharger mon wallet"
- Succès → toast "Trajet publié !" + retour à la liste

### Section "Mes trajets" dans publish ou page dédiée

Le conducteur voit:
- Ses trajets publiés
- Pour chacun: "X personnes ont vu votre numéro"
- Bouton [-1 place] pour décrémenter available_seats manuellement
- Bouton [Annuler] pour supprimer

### Navigation

1. Dans apps/mobile/app/(app)/index.tsx, ajouter un bouton:
   [🚗 Covoiturage inter-villes] → navigate('carpooling/')

2. Dans apps/mobile/app/(app)/_layout.tsx, ajouter:
   <Stack.Screen name="carpooling/index" />
   <Stack.Screen name="carpooling/publish" />

### Liste des villes (constante partagée)

```typescript
// apps/mobile/lib/cities.ts
export const MAURITANIA_CITIES = [
  'Nouakchott', 'Nouadhibou', 'Atar', 'Kiffa', 'Kaédi',
  'Rosso', 'Zouérate', 'Néma', 'Aleg', 'Tidjikja',
  'Sélibaby', 'Aioun el Atrouss', 'Akjoujt', 'Boutilimit',
  'Bir Moghrein', 'Timbédra', 'Guerou', 'Magta Lahjar'
];
```

---

## Admin web

### 1 page: apps/admin-web/src/app/carpooling/page.tsx

- Tableau de tous les trajets (actifs + expirés + annulés)
- Colonnes: Date, Conducteur, Trajet, Places, Prix, Vues, Statut, Payé
- Stats en haut:
  - Total trajets publiés
  - Revenue total publications (SUM publication_fee_mru)
  - Revenue boosts
  - Moyenne vues par trajet
- Lien dans AppShell sidebar: "Covoiturage"

### Paramètre dans /settings

Ajouter dans la page settings existante:
- Champ "Frais publication covoiturage" (input numérique → carpooling_publication_fee)
- Champ "Frais boost covoiturage" (input numérique → carpooling_boost_fee)
- Toggle "Covoiturage activé" (→ carpooling_enabled)

---

## Notifications push

| Événement | Destinataire | Message |
|-----------|-------------|---------|
| Quelqu'un révèle le numéro | Conducteur | "Quelqu'un s'intéresse à votre trajet NKC→NDB !" |
| Rappel 2h avant départ | Conducteur | "Votre trajet part dans 2h. X personnes ont vu votre numéro." |

### Notification future (quand il y a du volume)

Enregistrer les recherches des passagers. Quand un nouveau trajet est publié qui match une recherche récente → notifier le passager:
"Nouveau trajet Nouakchott → Atar demain à 7h — 1500 MRU/place"

(Implémentation: table `carpooling_search_alerts` avec user_id, origin, destination. Job qui vérifie les nouveaux trips toutes les 30min.)

---

## Résumé technique

| Élément | Quantité |
|---------|----------|
| Tables DB | 1 table + 1 ALTER app_settings |
| Endpoints API | 7 |
| Pages mobile | 2 + 1 modal + 1 section "mes trajets" |
| Pages admin | 1 + ajout dans settings |
| Jobs CRON | 1 (expiration) |
| Temps estimé | 2-3 semaines |

## Points clés pour le développeur

1. Pas de table bookings — "réserver" = révéler le numéro + compteur
2. Le conducteur gère ses places manuellement (bouton -1)
3. Les trajets boostés apparaissent en premier dans la liste
4. Le wallet existant est réutilisé tel quel (debitWallet)
5. Le views_count donne de la valeur au conducteur ("ça marche, je re-publie")
6. L'expiration est automatique (1h après departure_at)
