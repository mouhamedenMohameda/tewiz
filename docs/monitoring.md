# Monitoring — santé de la marketplace

## Pourquoi

Les logs actuels (`SLOW_QUERY_MS`, `SLOW_REQUEST_MS`) disent quand le **serveur**
va mal. Ils ne disent rien sur la santé de la **marketplace**, qui est la seule
chose qui décide si Tewiz marche :

- quelle part des demandes trouve un captain,
- en combien de temps,
- et **où** ça échoue.

Sans ces chiffres, `DISPATCH_RADIUS_M`, `DISPATCH_TOP_N` et le délai d'expiration
sont réglés à l'intuition. C'est là qu'Uber a une vraie avance : pas leur code,
leur mesure.

## Activation

**1. Générer un token et le mettre dans `.env` sur le serveur :**

```bash
openssl rand -hex 32
```

```
METRICS_TOKEN=<le token>
```

Puis `pm2 restart tewiz-api --update-env`.

Tant que `METRICS_TOKEN` est vide, `GET /metrics` répond 404 et l'API log un
avertissement au démarrage. L'exposition contient la demande par zone et l'offre
de captains — donc jamais ouverte par défaut.

**2. Vérifier.** ⚠️ **Le port n'est pas 3000 sur le serveur de production.** Le
défaut de `env.ts` est 3000, mais ce port est occupé par `studara-api` (l'autre
application de la machine, en cluster sur 6 processus), donc Tewiz écoute sur
**3001** via `PORT` dans `/opt/tewiz/.env`. Ne pas le supposer — le lire :

```bash
PORT=$(grep -E '^PORT=' /opt/tewiz/.env | cut -d= -f2 | tr -d ' ')
curl -s -H "Authorization: Bearer $METRICS_TOKEN" http://127.0.0.1:${PORT:-3000}/metrics | head -40
```

Pour lever tout doute sur qui écoute où :

```bash
ss -tlnp | grep node
```

Un `/health` qui répond `{"ai_summary":…}` au lieu de
`{"ok":true,"checks":{"postgres":"ok",…}}` signifie que tu interroges
`studara-api` et non Tewiz.

**3. Brancher Grafana Cloud** (offre gratuite : 10k séries, largement suffisant —
on en produit quelques centaines). Créer un compte, récupérer l'endpoint Prometheus
« remote write », puis installer Grafana Alloy sur le VPS avec ce scrape :

```yaml
prometheus.scrape "tewiz_api" {
  // 3001, pas 3000 : studara-api occupe le 3000 sur cette machine.
  targets    = [{ __address__ = "127.0.0.1:3001" }]
  metrics_path = "/metrics"
  # Le token vit dans le fichier de config d'Alloy (chmod 600), pas dans l'URL :
  # une URL se retrouve dans les logs d'accès.
  bearer_token = "<METRICS_TOKEN>"
  scrape_interval = "30s"
  forward_to = [prometheus.remote_write.grafana.receiver]
}
```

`scrape_interval` à 30 s : les jauges sont recalculées toutes les
`METRICS_REFRESH_MS` (30 s par défaut), scraper plus vite ne donne rien de plus.

## Les métriques qui comptent

### Santé de la marketplace

| Métrique | Ce que ça dit |
|---|---|
| `tewiz_fill_rate_1h` | Part des courses de la dernière heure qui ont trouvé un captain. **Le chiffre n°1.** |
| `tewiz_no_captain_rate_1h` | Part annulée faute de captain. L'échec vu par le rider. |
| `tewiz_time_to_match_seconds_1h{quantile}` | p50 / p95 du temps de matching, calculés en SQL (survivent aux redémarrages). |
| `tewiz_rides_requested_total{ride_type,source}` | Demande, par type et par canal (app / restaurant / partenaire). |
| `tewiz_zone_rides_requested_1h{h3}` | Demande par cellule H3 res 7 (~5 km²). |
| `tewiz_zone_rides_unfilled_1h{h3}` | **Où** on échoue. C'est la carte de recrutement des captains. |

### Offre

| Métrique | Ce que ça dit |
|---|---|
| `tewiz_captains_online_now{presence}` | Offre annoncée. |
| `tewiz_captains_online_stale_location` | Captains « en ligne » dont le point GPS a plus de 2 min — invisibles pour le dispatch. **L'écart entre les deux explique « il y avait des captains mais personne n'a été servi ».** |
| `tewiz_captains_blocked_low_balance` | Captains sous le seuil de solde : ils ne peuvent pas travailler. |

### Dispatch et contention

| Métrique | Ce que ça dit |
|---|---|
| `tewiz_dispatch_inbox_duration_seconds` | La requête la plus chaude du système : chaque captain en ligne la lance en boucle. Sa p95 est le premier signe que la machine sature. **Attention : elle scanne `rides` et n'a jamais lu `captain_state`** — elle ne bougera donc pas d'un pouce avec la migration Redis. Ne pas s'en servir pour juger l'étape 3. |
| `tewiz_dispatch_eligible_duration_seconds{source}` | La sélection des captains à la création d'une course — **la requête réellement déplacée**. C'est celle-ci qu'on compare entre `postgres` et `redis`. Le mode `shadow` exécute les deux, il est donc normalement le plus lent des trois : ce n'est pas une régression. |
| `tewiz_ride_accept_rejected_total{reason}` | `not_searching` qui grimpe = trop de captains se disputent la même course (le broadcast est trop large). `balance_too_low` qui grimpe = problème de wallet, pas de dispatch. |
| `tewiz_push_tickets_total{status}` | Livraison des notifications, **un ticket par appareil**. Un `200` d'Expo ne prouve rien : chaque appareil a son propre ticket. `InvalidCredentials` = Expo ne peut pas joindre le service de push de la plateforme (clé FCM absente pour Android) et **toutes** les notifications échouent. `DeviceNotRegistered` = jeton périmé, l'API le supprime tout seul. |
| `tewiz_redis_geosearch_duration_seconds` | La moitié « qui est à proximité ? » de la sélection, sortie de PostGIS. Si sa p95 rejoint celle de `dispatch_inbox`, le déplacement en mémoire ne paie plus. |
| `tewiz_dispatch_geo_fallback_total{reason}` | Repli sur PostGIS. `redis_error` = l'index géo est dégradé, à régler avant toute bascule. `no_pickup` = la course n'a pas de point de ramassage, ce qui n'est pas un problème Redis. Le dispatch continue — c'est le but — mais un taux non nul veut dire qu'on tourne sur le chemin lent sans s'en apercevoir. |
| `tewiz_dispatch_geo_mismatch_total{direction}` | Écarts entre Redis et PostGIS en mode `shadow`. `missing` = un captain que PostGIS a trouvé et pas Redis : en mode `redis` il n'aurait **jamais** été notifié. C'est ce compteur qui doit rester à zéro plusieurs jours avant de passer `DISPATCH_GEO_SOURCE=redis`. |

> ⚠️ **Ne jamais lire `geo_mismatch` sans lire `geo_fallback` à côté.** Une course
> qui part en repli ne produit **aucune** série de mismatch — ce qui se lit
> exactement comme « les deux sources sont d'accord », alors que ça veut dire
> « Redis n'a jamais répondu ». La première course en mode ombre en production
> est tombée précisément dans ce piège. La lecture correcte est :
>
> ```promql
> # Part des selections qui ont reellement ete comparees.
> 1 - (
>   sum(tewiz_dispatch_geo_fallback_total)
>   / sum(tewiz_dispatch_eligible_duration_seconds_count{source="shadow"})
> )
> ```
>
> Tant que ce ratio n'est pas proche de 1, le compteur d'écarts ne prouve rien.

### Argent et sauvegardes

| Métrique | Ce que ça dit |
|---|---|
| `tewiz_wallet_ledger_drift_rows` | Doit valoir **0** en permanence. Un seul échantillon non nul = les soldes et le grand livre divergent, donc l'argent dû aux captains est faux. |
| `tewiz_db_backup_age_seconds` | Âge du dernier dump. `-1` = aucun dump trouvé. |
| `tewiz_wal_last_ship_age_seconds` | Secondes depuis la dernière expédition WAL réussie (`-1` = jamais). **C'est le signal de santé** de l'expédition hors-site. |
| `tewiz_wal_archive_segments` | Segments présents dans l'archive locale. **Ce n'est PAS un retard** : `ship-wal.sh` conserve `WAL_KEEP_DAYS` de segments **déjà expédiés**, donc ce nombre monte à plusieurs milliers en fonctionnement normal. Informatif seulement. |

Ces trois dernières remplacent les vérifications manuelles hebdomadaires listées
dans [le runbook de sauvegarde](runbook-backup-restore.md).

## Alertes à créer (dans cet ordre de priorité)

```promql
# 1. Le grand livre du wallet diverge. Gravité maximale : c'est de l'argent.
tewiz_wallet_ledger_drift_rows > 0

# 2. Plus de sauvegarde depuis 26h (ou aucune).
tewiz_db_backup_age_seconds > 93600 or tewiz_db_backup_age_seconds < 0

# 3. L'expedition WAL est cassee : l'archive locale s'accumule.
# NE PAS alerter sur tewiz_wal_archive_segments : ce compteur monte
# legitimement a plusieurs milliers (retention de WAL_KEEP_DAYS). La
# premiere version de cette alerte le faisait et a sonne 30 h apres
# l'activation de PITR, sur un systeme parfaitement sain.
tewiz_wal_last_ship_age_seconds > 900 or tewiz_wal_last_ship_age_seconds < 0

# 4. Le taux de remplissage s'effondre, mais seulement s'il y a du trafic.
#    La condition sur le volume evite de se faire reveiller a 4h du matin.
tewiz_fill_rate_1h < 0.7
  and sum(increase(tewiz_rides_requested_total[1h])) > 10

# 5. Le matching devient trop lent pour qu'un rider attende.
tewiz_time_to_match_seconds_1h{quantile="0.95"} > 120

# 6. L'offre est fantome : la moitie des captains "en ligne" ont un GPS perime.
tewiz_captains_online_stale_location
  / clamp_min(tewiz_captains_online_now{presence="online"}, 1) > 0.5

# 7. La requete de dispatch se degrade -> elle se degrade pour tous a la fois.
histogram_quantile(0.95,
  rate(tewiz_dispatch_inbox_duration_seconds_bucket[5m])) > 0.5

# 8. L'API n'est plus scrapee du tout (process mort, ou box perdue).
up{job="tewiz_api"} == 0

# 9. Les notifications n'arrivent plus sur les telephones.
#    InvalidCredentials = Expo ne peut pas joindre le service de push de la
#    plateforme (cle FCM absente cote projet EAS) : TOUTES les alertes de
#    course echouent pendant que la creation de course parait saine.
#    C'est reste invisible pendant des mois faute de compteur.
sum(rate(tewiz_push_tickets_total{status="InvalidCredentials"}[15m])) > 0
```

Les alertes 1 à 3 sont des **incidents** : elles se traitent le jour même.
Les 4 à 7 sont des **signaux produit** : elles se lisent, elles se règlent.

## Les questions auxquelles ça permet enfin de répondre

Ce sont les décisions qui étaient prises à l'aveugle jusqu'ici :

```promql
# Où faut-il recruter des captains ? (zones ou l'on echoue le plus)
topk(5, tewiz_zone_rides_unfilled_1h)

# DISPATCH_RADIUS_M est-il trop petit ? Comparer le fill rate au nombre de
# captains en ligne : beaucoup de captains + fill rate bas = probleme de rayon
# ou de fraicheur GPS, pas de penurie.
tewiz_fill_rate_1h and tewiz_captains_online_now{presence="online"}

# Le broadcast provoque-t-il de la cherry-picking ? Un ratio eleve de courses
# perdues a la course signifie que N captains se battent pour la meme course —
# l'argument chiffre pour passer a l'offre exclusive en cascade (etape 5).
rate(tewiz_ride_accept_rejected_total{reason="not_searching"}[1h])
  / rate(tewiz_rides_accepted_total[1h])

# Le seuil de solde bloque-t-il l'offre aux heures de pointe ?
tewiz_captains_blocked_low_balance

# Quelle est la vraie courbe de demande par heure ? (le "par heure" est gratuit :
# Prometheus stocke deja une serie temporelle, d'ou l'absence de label `hour`)
sum(rate(tewiz_rides_requested_total[1h])) by (ride_type)
```

## Notes de conception

- **Deux familles de métriques.** Les compteurs/histogrammes sont incrémentés en
  mémoire au moment de l'événement : exacts, mais remis à zéro par un redémarrage
  pm2 (Prometheus gère les resets, `rate()` reste juste). Les jauges sont
  recalculées en SQL : elles survivent aux redémarrages et concordent avec le
  dashboard admin, puisqu'elles viennent des mêmes lignes. Un histogramme en
  mémoire ne peut pas répondre à « quel était le fill rate la dernière heure »
  après un déploiement ; une jauge SQL, oui.
- **Discipline de cardinalité.** Aucun id de course, d'utilisateur ou de captain
  ne devient un label. Les routes HTTP sont étiquetées par **motif** Express
  (`/rides/:id`), jamais par chemin concret. Les zones utilisent H3 res 7
  (~200 cellules sur le Grand Nouakchott), pas la res 9 de la heatmap (des
  milliers). Les jauges de zone sont remises à zéro à chaque rafraîchissement :
  une zone qui s'éteint disparaît au lieu de figer sa dernière valeur.
- **Pas de label `hour`.** Prometheus stocke déjà une série temporelle ; « par
  heure » est une question de requête. Un label horaire multiplierait chaque série
  par 24 sans rien apprendre.
- **Fenêtre vide = fill rate 1, pas 0.** À 4h du matin il n'y a pas de trafic ;
  0/0 est indéfini. Publier 0 déclencherait « effondrement du fill rate » chaque
  nuit. C'est la série du volume de demandes qui porte le signal « pas de trafic ».
- **Le match est compté après le COMMIT.** Compter dans la transaction gonflerait
  le compteur et l'histogramme à chaque commit échoué — et un histogramme ne se
  décrémente pas.
- **Un rafraîchissement qui échoue ne fait pas tomber l'API.** Il se voit comme
  `tewiz_metrics_refresh_failures_total` qui monte et des jauges qui stagnent.
