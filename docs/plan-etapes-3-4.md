# Étapes 3 et 4 — positions live dans Redis, puis intégration continue

Suite du plan de résilience. Les étapes 1 (sauvegardes + PITR) et 2 (métriques)
sont faites ; il reste à brancher Grafana pour clore la 2.

Ces deux étapes-ci sont indépendantes l'une de l'autre. La 4 est plus courte et
sans risque : c'est une bonne mise en jambe avant de toucher au dispatch.

---

# Étape 3 — Les positions live dans Redis

## Le problème

Chaque captain en ligne envoie sa position régulièrement. Aujourd'hui, chacun de
ces envois fait un `UPDATE` PostGIS dans `captain_state`
([state.routes.ts:160](../apps/api/src/modules/captain/state.routes.ts)) — sur la
**même base** qui sert à trouver les chauffeurs disponibles.

Autrement dit : la table la plus écrite est aussi celle que le dispatch interroge
en priorité, sur une machine qui héberge en plus l'API, Redis, `studara-api` et
`tewiz-voice-api`. Uber garde son index géographique en mémoire précisément pour
éviter ça.

Et Redis est déjà installé, déjà connecté
([redis.ts](../apps/api/src/db/redis.ts))… et ne sert qu'à répondre `PONG` au
health check.

## Ce qui bouge, ce qui ne bouge pas

| | Où ça vit après |
|---|---|
Position **actuelle** d'un captain en ligne | **Redis** |
Historique des trajets (`captain_track`) | Postgres — inchangé |
`captain_state.location` (marqueur du back-office) | Postgres — écrit toujours, mais plus sur le chemin critique |
Règles métier (type de véhicule, colis, longue distance, refus) | Postgres — inchangé |

**Ne déplace pas les règles métier dans Redis.** Redis répond à une seule
question, celle qui coûte cher : « quels captains sont à moins de X mètres et ont
une position fraîche ? ». Postgres filtre ensuite le reste. Garder les règles à un
seul endroit vaut mieux que la microseconde qu'on gagnerait à les dupliquer.

## Conception

Deux clés, pas une :

```
captains:geo    (GEO / sorted set)  membre = captain_id, valeur = lat/lng
captains:seen   (sorted set)        membre = captain_id, score = timestamp ms
```

Pourquoi deux : une clé GEO n'a pas de TTL par membre, donc un captain qui coupe
son téléphone resterait à sa dernière position pour toujours. Le score de
`captains:seen` donne la fraîcheur, et se purge en une commande.

Requiert **Redis ≥ 6.2** pour `GEOSEARCH` et `ZMSCORE`. Le serveur est en Redis 7,
c'est bon.

### Écriture

Dans `POST /captain/state/track` et le point d'entrée de position
([state.routes.ts](../apps/api/src/modules/captain/state.routes.ts)) :

```ts
// apps/api/src/modules/captain/live-location.ts (nouveau)
export async function setLiveLocation(captainId: string, lat: number, lng: number) {
  await redis
    .multi()
    .geoadd('captains:geo', lng, lat, captainId)      // attention : lng AVANT lat
    .zadd('captains:seen', Date.now(), captainId)
    .exec();
}

export async function clearLiveLocation(captainId: string) {
  await redis.multi()
    .zrem('captains:geo', captainId)                   // une clé GEO EST un zset
    .zrem('captains:seen', captainId)
    .exec();
}
```

`clearLiveLocation` est appelée quand le captain passe `offline`.

### Lecture

```ts
export async function captainsNear(lat: number, lng: number, radiusM: number, maxAgeS: number) {
  const ids = await redis.geosearch(
    'captains:geo', 'FROMLONLAT', lng, lat, 'BYRADIUS', radiusM, 'm', 'ASC',
  ) as string[];
  if (ids.length === 0) return [];

  // Filtre de fraîcheur : un id sans score, ou trop vieux, est écarté.
  const cutoff = Date.now() - maxAgeS * 1000;
  const scores = await redis.zmscore('captains:seen', ...ids);
  return ids.filter((_, i) => scores[i] !== null && Number(scores[i]) >= cutoff);
}
```

Puis dans
[dispatch.service.ts](../apps/api/src/modules/rides/dispatch.service.ts), la
requête `eligibleCaptainsForRide` perd son `ST_DWithin` et son test de fraîcheur,
et reçoit la liste d'ids en paramètre :

```sql
WHERE s.captain_id = ANY($6::uuid[])
  AND s.presence = 'online'
  AND ( ... les règles métier, inchangées ... )
```

## Les trois pièges

**1. Redis démarre vide.** Au premier déploiement, aucun captain n'est dans
`captains:geo` — donc plus personne n'est joignable par notification jusqu'à ce
que chacun renvoie sa position. À faire au démarrage de l'API :

```ts
// Recharge captain_state -> Redis. Idempotent, à appeler dans index.ts.
export async function warmLiveLocations() {
  const { rows } = await pool.query(`
    SELECT captain_id,
           ST_Y(location::geometry) AS lat,
           ST_X(location::geometry) AS lng,
           EXTRACT(epoch FROM location_updated_at) * 1000 AS seen_ms
      FROM captain_state
     WHERE presence <> 'offline' AND location IS NOT NULL`);
  // pipeline geoadd + zadd
}
```

**2. Redis peut tomber.** Le dispatch ne doit jamais s'arrêter pour ça. Toute la
lecture est entourée d'un `try/catch` qui retombe sur la requête PostGIS
existante — **on garde donc l'ancien code, on ne le supprime pas.** Un compteur
`tewiz_dispatch_geo_fallback_total` rend le repli visible au lieu de silencieux.

**3. On ne bascule pas d'un coup.** Un drapeau à trois valeurs :

```
DISPATCH_GEO_SOURCE=postgres   # comportement actuel (défaut)
DISPATCH_GEO_SOURCE=shadow     # calcule les deux, sert Postgres, compare
DISPATCH_GEO_SOURCE=redis      # sert Redis, repli Postgres si erreur
```

En mode `shadow`, un compteur `tewiz_dispatch_geo_mismatch_total` mesure les
écarts entre les deux ensembles de candidats. **Tu ne passes en `redis` que
lorsque ce compteur reste à zéro sur plusieurs jours.** C'est la seule façon
honnête de changer un chemin de dispatch en production.

## Marche à suivre

1. `apps/api/src/modules/captain/live-location.ts` — les quatre fonctions
   ci-dessus + les tests unitaires (Redis mocké, comme `pool` l'est déjà dans
   [metrics.test.ts](../apps/api/tests/metrics.test.ts)).
2. Écrire dans Redis **en plus** de Postgres dans `state.routes.ts` (double
   écriture : rien ne casse si on revient en arrière).
3. `warmLiveLocations()` appelée dans [index.ts](../apps/api/src/index.ts).
4. `DISPATCH_GEO_SOURCE` dans [env.ts](../apps/api/src/config/env.ts), défaut
   `postgres`.
5. Brancher la lecture dans `eligibleCaptainsForRide`, avec repli.
6. Ajouter les deux compteurs dans [metrics.ts](../apps/api/src/lib/metrics.ts)
   et un histogramme `tewiz_redis_geosearch_duration_seconds`.
7. Déployer en `shadow`. Observer plusieurs jours.
8. Passer en `redis`. Comparer la p95 de
   `tewiz_dispatch_eligible_duration_seconds{source}` entre `postgres` et
   `redis` — c'est le gain, chiffré.

   ⚠️ **Correction d'une version antérieure de ce document**, qui indiquait
   `tewiz_dispatch_inbox_duration_seconds`. C'est le mauvais indicateur :
   `captainInbox` scanne la table `rides` à partir de la position que le captain
   envoie lui-même, et n'a jamais lu `captain_state`. Il ne bougera donc pas avec
   cette migration. Mesurer la mauvaise requête, c'est le moyen le plus sûr de
   déclarer une réécriture réussie sur une preuve qui n'a jamais bougé.

   Et garde en tête l'ordre de grandeur : `eligibleCaptainsForRide` ne tourne
   qu'à la **création** d'une course (quelques dizaines de fois par jour), alors
   que l'inbox est interrogé en boucle par tous les captains en ligne. Tant que
   la double écriture est en place, cette étape **ajoute** un peu de travail au
   lieu d'en retirer. Le bénéfice arrive à l'étape 9 ; le gros morceau restant
   est la requête d'inbox.
9. Seulement ensuite : espacer les écritures Postgres de `captain_state` (le
   back-office n'a pas besoin d'une précision à la seconde).

## Comment vérifier

```bash
redis-cli ZCARD captains:geo
redis-cli GEOSEARCH captains:geo FROMLONLAT -15.9785 18.0858 BYRADIUS 3000 m ASC
```

Le compte doit correspondre au nombre de captains en ligne
(`tewiz_captains_online_now`). Un écart durable signifie que le nettoyage au
passage `offline` ne se fait pas.

## Ce que ça rapporte

La partie chère de la sélection (calcul de distance sur tous les captains) sort
de Postgres. Sur une machine partagée avec cinq autres processus, c'est le seul
changement de cette liste qui allège la base **et** accélère le dispatch en même
temps. Une demi-journée à une journée.

---

# Étape 4 — Intégration continue

## Le problème

560 tests qui ne tournent jamais avant un déploiement. `deploy.sh` construit et
redémarre sans jamais les exécuter — une régression part en production et se
découvre en usage réel.

## Le blocage à lever d'abord

`pnpm typecheck` à la racine échoue déjà, pour une raison antérieure à ce plan :

```
apps/mobile/theme/index.ts(277,50): error TS2614:
Module './fontAssets' has no exported member 'arabicFontAssets'.
```

Tant que ce n'est pas réparé, la CI échouera à chaque exécution et tout le monde
apprendra à ignorer le voyant rouge — ce qui est pire que pas de CI du tout.
Regarde si `fontAssets.ts` exporte par défaut (alors corrige l'import) ou s'il
manque l'export nommé (alors ajoute-le).

## Le workflow

`.github/workflows/ci.yml` :

```yaml
name: CI
on:
  push: { branches: [main] }
  pull_request:

# Annule les exécutions rendues obsolètes par un nouveau push.
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9.12.0 }
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm -r typecheck
      - run: pnpm -r --if-present test
      - run: pnpm --filter @tewiz/api build

  scripts:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      # Les scripts de sauvegarde décident s'il existe un point de restauration
      # avant chaque migration. Une faute de frappe qui n'y échoue pas
      # franchement est une perte de données silencieuse — shellcheck coûte
      # 10 secondes.
      - run: shellcheck scripts/*.sh
```

Points d'attention :

- **`--frozen-lockfile`** : la CI échoue si `pnpm-lock.yaml` n'est pas à jour,
  au lieu d'installer autre chose que la production.
- **Pas de base de données nécessaire.** Les tests de l'API bouchonnent `pool`
  (voir n'importe quel fichier de `apps/api/tests/`), donc aucun service
  PostgreSQL à démarrer dans le workflow.
- **`pnpm --filter @tewiz/admin-web build` est volontairement absent** : `next
  build` lit `.env.local` sur le serveur et échouera probablement en CI faute de
  `NEXT_PUBLIC_API_URL`. À ajouter dans un second temps, avec une variable
  factice, plutôt que de livrer une CI rouge dès le premier jour.
- `shellcheck` est préinstallé sur les runners `ubuntu-latest`.

## Ensuite

1. **Protéger `main`** : Settings → Branches → require status checks. Sans ça la
   CI est décorative.
2. **Faire tourner les tests dans `deploy.sh`**, entre la construction et le
   redémarrage. La CI protège les fusions ; ce garde-fou-là protège les
   déploiements manuels.

## Comment vérifier

Ouvre une pull request avec un test volontairement cassé. Elle doit passer au
rouge et bloquer la fusion. Une CI qu'on n'a jamais vue échouer n'est pas une CI
vérifiée — même logique que pour l'exercice de restauration.

Compte une heure, réparation du mobile comprise.

---

# Dans quel ordre

**L'étape 4 d'abord.** Elle est courte, sans risque, et c'est elle qui protégera
l'étape 3 : refaire le dispatch sans tests automatiques, c'est se priver du filet
au moment précis où il sert.
