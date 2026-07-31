# Les trois chantiers restants

1. **Brancher un tableau de bord** — être prévenu au lieu d'aller taper des commandes. ~20 min.
2. **Créer un identifiant Google** — sinon les sauvegardes s'arrêtent courant 2026. ~15 min.
3. **Changer le dispatch** — proposer la course à un captain à la fois. Plusieurs jours.

Les deux premiers sont des corvées bornées. Le troisième est le seul qui change
ce que vivent tes clients et tes captains, et c'est le seul risqué. Fais 1 et 2
d'abord : ils te donnent les yeux dont tu auras besoin pendant le 3.

---

# 1. Le tableau de bord

## Le problème

Tes chiffres existent et sont justes. Personne ne les regarde. Si la cohérence
des portefeuilles cassait cette nuit, tu l'apprendrais par un captain en colère.

Aujourd'hui tu dois taper une commande `curl` pour voir quoi que ce soit. Ça ne
tient pas dans le temps : personne ne le fait tous les jours.

## Étapes

**1. Créer un compte Grafana Cloud** (gratuit, largement suffisant — on produit
quelques centaines de séries, l'offre en accepte 10 000).

[grafana.com](https://grafana.com) → Sign up → créer une stack.

Dans **Connections → Add new connection → Hosted Prometheus metrics**, choisis
l'installation par **Grafana Alloy**. Note les trois valeurs affichées :
l'URL d'écriture, l'identifiant, et le mot de passe.

**2. Installer Alloy sur le serveur**

```bash
sudo apt-get install -y gpg
```

```bash
curl -fsSL https://apt.grafana.com/gpg.key | sudo gpg --dearmor -o /etc/apt/keyrings/grafana.gpg && echo "deb [signed-by=/etc/apt/keyrings/grafana.gpg] https://apt.grafana.com stable main" | sudo tee /etc/apt/sources.list.d/grafana.list
```

```bash
sudo apt-get update && sudo apt-get install -y alloy
```

**3. Configurer**

```bash
sudo nano /etc/alloy/config.alloy
```

```hcl
prometheus.scrape "tewiz_api" {
  // 3001, pas 3000 : studara-api occupe le 3000 sur cette machine.
  targets      = [{ __address__ = "127.0.0.1:3001", job = "tewiz_api" }]
  metrics_path = "/metrics"
  // Le token vit ici, pas dans l'URL : une URL finit dans les journaux d'accès.
  bearer_token = "TON_METRICS_TOKEN"
  // Les jauges sont recalculées toutes les 30 s côté API ; scraper plus vite
  // n'apporte rien de plus frais, seulement de la charge.
  scrape_interval = "30s"
  forward_to = [prometheus.remote_write.grafana.receiver]
}

prometheus.remote_write "grafana" {
  endpoint {
    url = "TON_URL_REMOTE_WRITE"
    basic_auth {
      username = "TON_IDENTIFIANT"
      password = "TON_MOT_DE_PASSE"
    }
  }
}
```

Le fichier contient deux secrets : verrouille-le.

```bash
sudo chmod 600 /etc/alloy/config.alloy && sudo systemctl enable --now alloy && sudo systemctl status alloy --no-pager
```

**4. Vérifier**

Dans Grafana → **Explore** → tape `tewiz_captains_online_now`. Tu dois voir une
valeur. Si rien n'apparaît au bout de 2 minutes :

```bash
sudo journalctl -u alloy -n 50 --no-pager
```

Une erreur 401 = mauvais `bearer_token`. Une erreur de connexion = mauvais port.

## Les alertes à créer

Dans **Alerting → Alert rules**, dans cet ordre de priorité. Les trois premières
sont des incidents à traiter le jour même ; les autres sont des signaux produit.

```promql
# 1. Le grand livre des portefeuilles diverge. C'est de l'argent.
tewiz_wallet_ledger_drift_rows > 0

# 2. Plus de sauvegarde depuis 26 h (ou aucune).
tewiz_db_backup_age_seconds > 93600 or tewiz_db_backup_age_seconds < 0

# 3. L'expedition des sauvegardes continues est cassee.
tewiz_wal_archive_segments > 200

# 4. Le taux de courses servies s'effondre — uniquement s'il y a du trafic,
#    sinon l'alerte sonne chaque nuit a 4 h.
tewiz_fill_rate_1h < 0.7
  and sum(increase(tewiz_rides_requested_total[1h])) > 10

# 5. Le matching devient trop lent pour qu'un client attende.
tewiz_time_to_match_seconds_1h{quantile="0.95"} > 120

# 6. L'API ne repond plus du tout.
up{job="tewiz_api"} == 0
```

Configure un **contact point** e-mail (ou Telegram) dans Grafana, sinon les
alertes se déclenchent sans prévenir personne.

## Le tableau à regarder chaque matin

Un dashboard avec ces cinq panneaux suffit :

| Panneau | Requête |
|---|---|
Courses demandées / heure | `sum(rate(tewiz_rides_requested_total[1h])) * 3600` |
Taux de courses servies | `tewiz_fill_rate_1h` |
Temps de matching (p50 / p95) | `tewiz_time_to_match_seconds_1h` |
Captains en ligne | `tewiz_captains_online_now` |
Où l'on échoue | `topk(5, tewiz_zone_rides_unfilled_1h)` |

Le détail complet des métriques est dans [monitoring.md](monitoring.md).

---

# 2. L'identifiant Google

## Le problème

rclone utilise un identifiant partagé entre tous ses utilisateurs, et il
l'annonce à chaque appel :

> This remote uses rclone's shared Google Drive client_id, which is being retired
> and **will stop working during 2026**.

On est en 2026. Sans identifiant propre, tes sauvegardes s'arrêteront — l'alerte
n°2 ci-dessus te préviendra, mais autant ne pas casser du tout.

## Étapes

1. [console.cloud.google.com](https://console.cloud.google.com) → nouveau projet,
   par ex. `tewiz-backups`.
2. **APIs & Services → Library** → chercher « Google Drive API » → **Enable**.
3. **APIs & Services → OAuth consent screen** → User type **External** → nom de
   l'app, e-mail de support → Save.
4. **Publier l'app en Production.**

   ⚠️ **C'est l'étape piège.** Laissée en « Testing », Google fait expirer
   l'autorisation **au bout de 7 jours** : tes sauvegardes casseraient chaque
   semaine. La publication ne demande **aucune vérification** de Google ici,
   parce que la permission utilisée est `drive.file` (accès aux seuls fichiers
   créés par rclone) et non l'accès complet au Drive. C'est exactement pour ça
   qu'on a choisi l'option 3 à la configuration.

5. **Credentials → Create Credentials → OAuth client ID** → type **Desktop app**
   → noter le `client_id` et le `client_secret`.
6. Sur **ton Mac** :

```bash
rclone config
```

`e` (edit existing remote) → `gdrive` → renseigner `client_id` et
`client_secret` → puis refaire l'autorisation navigateur quand il le propose.

7. Renvoyer la configuration sur le serveur :

```bash
scp ~/.config/rclone/rclone.conf root@5.189.153.144:/root/.config/rclone/rclone.conf
```

8. Vérifier :

```bash
ssh root@5.189.153.144 "cd /opt/tewiz && bash scripts/backup-db.sh"
```

L'avertissement doit avoir disparu.

**Les mots de passe de chiffrement ne changent pas** : les sauvegardes déjà sur
Drive restent lisibles.

---

# 3. Le dispatch : une course, un captain à la fois

## Le problème

Aujourd'hui, une course part vers **tous** les captains éligibles dans le rayon.
Premier qui appuie, premier servi.

Conséquences :

- **Les captains écrèment.** Course courte et rentable près d'eux : ils sautent
  dessus. Course longue, ou vers un quartier d'où ils ne repartiront pas : ils
  laissent. Ces courses-là pourrissent jusqu'à l'expiration.
- **Tous les autres perdent leur temps.** Cinq captains appuient, un gagne,
  quatre reçoivent une erreur. C'est mesuré : `tewiz_ride_accept_rejected_total{reason="not_searching"}`.
- **Aucun levier.** Tu ne peux pas favoriser un captain bien noté, ni équilibrer
  entre ceux qui attendent depuis longtemps.

Uber propose à **un seul** chauffeur, lui laisse quelques secondes, puis passe au
suivant. Tu as déjà tout le calcul de score dans ton code
([dispatch.service.ts](../apps/api/src/modules/rides/dispatch.service.ts)) — ce
qui manque, c'est la boucle d'attribution.

## Avant de coder : mesurer

**Ne commence pas sans le chiffre.** Une fois Grafana branché, regarde :

```promql
rate(tewiz_ride_accept_rejected_total{reason="not_searching"}[1h])
  / rate(tewiz_rides_accepted_total[1h])
```

C'est le nombre de captains qui perdent la course, par course gagnée.

- **Proche de 0** → personne ne se dispute les courses, tu n'as pas de problème
  de concurrence. Le chantier ne vaut pas son risque : passe à autre chose.
- **1 ou plus** → en moyenne au moins un captain appuie pour rien à chaque
  course. Le chantier est justifié.

⚠️ Tes chiffres d'avant le 31/07 sous-estiment le phénomène : les notifications
ne partaient qu'une fois sur deux (corrigé dans `d3d84cf`). Prends une mesure
fraîche.

## L'approche : des vagues, pas une file

La version « pure Uber » — une table d'offres, un processus qui les distribue et
les expire — demande un nouveau service et une refonte de l'app mobile. Trop
pour un premier pas.

**La version par vagues obtient l'essentiel du bénéfice sans nouveau processus :**
au lieu de rendre la course visible par tous immédiatement, on la révèle
progressivement.

```
t=0s    → seulement le captain n°1 du classement
t=+12s  → les captains n°1 à 3
t=+30s  → tout le monde (comportement actuel)
```

Un captain qui ignore sa vague ne bloque donc jamais la course : elle s'ouvre
toute seule. C'est ce qui rend le changement sûr — **le pire cas est le
comportement d'aujourd'hui avec 30 secondes de retard**, pas une course perdue.

### Schéma

Une table, remplie une seule fois à la création de la course.

```sql
-- db/migrations/00XX_ride_offers.sql
CREATE TABLE ride_offers (
  ride_id    UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  captain_id UUID NOT NULL REFERENCES captains(user_id) ON DELETE CASCADE,
  -- 1 = meilleur candidat. Figé à la création : un classement qui bouge à
  -- chaque interrogation rendrait la vague d'un captain imprévisible.
  rank       INT  NOT NULL,
  PRIMARY KEY (ride_id, captain_id)
);

CREATE INDEX ride_offers_ride_rank_idx ON ride_offers (ride_id, rank);
```

Pas de colonne `status` : l'acceptation vit déjà dans `rides.captain_id`, le
refus dans `ride_declines` (migration 0024), et l'expiration se déduit de
`rides.requested_at`. Ajouter un état dupliqué, c'est ajouter un état qui peut
diverger.

### Le calcul de la vague

Une seule règle, appliquée au même endroit pour tout le monde :

```
visible pour le captain X  ⇔  X.rank <= palier(now - ride.requested_at)

palier(âge) = 1   si âge < 12s
              3   si âge < 30s
              ∞   sinon
```

### Points de code à toucher

| Fichier | Changement |
|---|---|
`db/migrations/00XX_ride_offers.sql` | la table ci-dessus |
[rides.service.ts](../apps/api/src/modules/rides/rides.service.ts) `broadcastNewRide` | après le commit, écrire le classement dans `ride_offers`, puis ne notifier que le rang 1 |
[dispatch.service.ts](../apps/api/src/modules/rides/dispatch.service.ts) `captainInbox` | ajouter le filtre de vague (voir ci-dessous) |
nouveau cron, toutes les 5 s | notifier les captains dont la vague vient de s'ouvrir |
[env.ts](../apps/api/src/config/env.ts) | `DISPATCH_WAVES_ENABLED`, `DISPATCH_WAVE_1_S`, `DISPATCH_WAVE_2_S` |

Le filtre à ajouter dans `captainInbox` :

```sql
AND (
  -- Pas d'offres calculées pour cette course : on retombe sur le comportement
  -- d'avant. Indispensable pour les courses déjà en vol au moment du déploiement,
  -- et pour tout chemin de création qu'on aurait oublié d'instrumenter.
  NOT EXISTS (SELECT 1 FROM ride_offers o WHERE o.ride_id = r.id)
  OR EXISTS (
    SELECT 1 FROM ride_offers o
     WHERE o.ride_id = r.id
       AND o.captain_id = $5
       AND o.rank <= CASE
             WHEN r.requested_at > now() - make_interval(secs => $7) THEN 1
             WHEN r.requested_at > now() - make_interval(secs => $8) THEN 3
             ELSE 2147483647
           END
  )
)
```

Le repli `NOT EXISTS` n'est pas de la prudence décorative : sans lui, le jour du
déploiement, toutes les courses en cours deviennent invisibles pour tout le
monde.

### L'app mobile

**Aucun changement obligatoire.** Le captain interroge déjà son inbox toutes les
5 secondes ([CaptainRideWatcher.tsx](../apps/mobile/components/CaptainRideWatcher.tsx)) ;
il verra simplement moins de courses au début. C'est ce qui rend ce chantier
faisable côté serveur uniquement.

Une amélioration possible plus tard, une fois les vagues validées : afficher
« proposée en priorité pour vous » sur une course de rang 1. Ça vaut le coup
seulement si les chiffres montrent que les vagues fonctionnent.

## Déploiement progressif

1. **Mesurer** le ratio ci-dessus. Pas de problème mesuré → pas de chantier.
2. **Migration + code**, `DISPATCH_WAVES_ENABLED=false`. Les offres sont
   calculées et écrites, mais le filtre ne s'applique pas. Vérifie que
   `ride_offers` se remplit avec des classements plausibles.
3. **Activer avec des paliers très courts** (`WAVE_1=5s`, `WAVE_2=10s`). L'effet
   est faible, mais tout le mécanisme tourne en vrai.
4. **Allonger progressivement** vers 12 s / 30 s en surveillant, à chaque palier :
   - `tewiz_time_to_match_seconds_1h{quantile="0.95"}` — **ne doit pas monter**
   - `tewiz_fill_rate_1h` — **ne doit pas baisser**
   - `tewiz_ride_accept_rejected_total{reason="not_searching"}` — **doit baisser**
5. Si le p95 monte sans que le taux de rejet baisse : `DISPATCH_WAVES_ENABLED=false`
   et rien d'autre à faire. C'est là tout l'intérêt du drapeau.

## Ce qui peut mal tourner

**Le temps d'attente augmente.** C'est le risque principal et il est réel : tu
échanges de la rapidité contre de l'équité. Un client se moque de savoir quel
captain vient, il veut qu'il vienne vite. C'est pour ça que le p95 du temps de
matching est le critère d'arrêt, pas le taux de rejet.

**Ton volume est faible.** Avec quelques dizaines de courses par jour, il faudra
peut-être une à deux semaines par palier pour distinguer un vrai effet du bruit.
Ne conclus pas sur trois jours.

**Le classement figé peut vieillir.** Un captain n°1 qui s'éloigne pendant les
12 premières secondes reste n°1. C'est acceptable à cette échelle de temps, et
c'est le prix d'un classement prévisible. À revoir seulement si les paliers
dépassent la minute.

**Les captains hors classement.** Un captain qui se connecte 5 secondes après la
création n'est dans aucune offre : il ne verra la course qu'à l'ouverture
générale. Acceptable, et c'est justement ce que couvre le repli `NOT EXISTS`.

## Effort

Migration et backend : une à deux journées, tests compris. Le déploiement
progressif s'étale ensuite sur deux à trois semaines, mais sans travail actif —
seulement des paliers à ajuster en regardant les courbes.
