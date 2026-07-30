# Runbook — sauvegarde & restauration

> À lire **avant** l'incident. Pendant l'incident, aller directement à la
> section « Scénarios » et suivre les commandes sans réfléchir.

## Pourquoi ce runbook existe

Aujourd'hui l'API, PostgreSQL, Redis et `UPLOAD_DIR` tournent sur **une seule
machine** (Contabo, `5.189.153.144`). Un seul disque mort fait disparaître :

- toutes les courses et l'historique de commission,
- le registre du wallet (donc l'argent dû aux captains),
- les documents KYC et les captures Bankily/Masrivi,
- la base POI construite par le service voix — l'actif le plus difficile à
  reconstituer, parce qu'il s'accumule requête par requête.

Aucune de ces données n'est dans git.

## Ce qui est en place

| Quoi | Fréquence | Où | Script |
|---|---|---|---|
| Dump vérifié + hors-site | quotidien 02:10 UTC | local + S3/SSH | `scripts/backup-db.sh` |
| Dump avant migrations | à chaque déploiement | local + S3/SSH | `scripts/deploy.sh` étape 2/9 |
| Archivage WAL (PITR) | continu, `archive_timeout` 5 min | `/var/backups/tewiz-wal` | `archive_command` |
| Expédition WAL hors-site | toutes les 5 min | S3/SSH | `scripts/ship-wal.sh` |
| Base backup | hebdo, dimanche 03:00 UTC | `/var/backups/tewiz-basebackup` | `pg_basebackup` (cron) |
| Snapshot uploads | à chaque déploiement | `/var/backups/tewiz-uploads` | `scripts/backup-uploads.sh` |
| **Exercice de restauration** | mensuel, le 1er 04:00 UTC | base jetable | `scripts/restore-db.sh` |

**RPO** (perte maximale) : ~5 minutes — l'intervalle du cron `ship-wal`.
**RTO** (temps de remise en service) : mesuré par l'exercice mensuel. Relever le
`restore_seconds` affiché et l'écrire ici :

```
RTO base de données mesuré : ______ s   (mis à jour le ______)
```

Un RTO non mesuré n'est pas un RTO. C'est tout l'objet de l'exercice mensuel.

## Installation (une seule fois, sur le VPS)

```bash
ssh root@5.189.153.144
```

**1. Choisir une cible hors-site et la mettre dans `.env`.** Sans ça,
`backup-db.sh` sort en erreur toutes les nuits et `ship-wal.sh` toutes les 5
minutes — volontairement, pour que le silence ne passe pas pour un succès.

Trois options, cumulables (chaque cible configurée doit réussir) :

### Option A — Cloudflare R2 / Backblaze B2 (recommandé)

Pas de frais de sortie chez R2 : restaurer pendant une panne ne coûte rien. Et une
règle de cycle de vie côté bucket purge les vieilles copies sans script.

```bash
apt install -y awscli
```

```
BACKUP_S3_BUCKET=tewiz-backups
BACKUP_S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
BACKUP_S3_ACCESS_KEY=...
BACKUP_S3_SECRET_KEY=...
BACKUP_S3_REGION=auto
```

### Option B — Google Drive (ou Dropbox / OneDrive) via rclone

```bash
curl https://rclone.org/install.sh | sudo bash
```

Puis, **une seule fois**, la configuration interactive. Elle demande d'ouvrir une
URL dans un navigateur pour autoriser l'accès :

```bash
rclone config
```

- `n` (new remote) → nom : `gdrive` → type : `drive`
- client_id / client_secret : laisser vide (fonctionne, mais plus lent — les
  quotas partagés de rclone s'appliquent ; créer ses propres identifiants OAuth
  Google accélère nettement si les envois deviennent lourds)
- scope : `1` (accès complet) ou `3` (fichiers créés par rclone uniquement — plus
  prudent, suffisant ici)
- `Use web browser to automatically authenticate?` → `y` si tu as un navigateur
  sur la machine, sinon `n` et suivre la procédure `rclone authorize` depuis ton
  Mac

**Chiffrer, parce que ce sont des données sensibles.** Les dumps contiennent des
numéros de téléphone, des NNI, les documents KYC et le grand livre des
portefeuilles. Sur un Drive personnel, ajoute un second remote de type `crypt`
par-dessus le premier :

- `rclone config` → `n` → nom : `gcrypt` → type : `crypt`
- remote : `gdrive:tewiz-backups`
- chiffrer les noms de fichiers : `y`
- laisser rclone générer les mots de passe, **et les sauvegarder dans ton
  gestionnaire de mots de passe** — sans eux les sauvegardes sont illisibles, y
  compris par toi

Puis dans `/opt/tewiz/.env` :

```
BACKUP_RCLONE_REMOTE=gcrypt:
RCLONE_CONFIG=/root/.config/rclone/rclone.conf
BACKUP_REMOTE_KEEP_DAYS=30
```

`RCLONE_CONFIG` est explicite parce que cron tourne avec un environnement nu :
sans ça, rclone cherche sa config par rapport à un `$HOME` parfois absent et
échoue sur « didn't find section in config file ».

`BACKUP_REMOTE_KEEP_DAYS` est nécessaire sur Drive : il n'a **pas** de règle de
cycle de vie, donc rien ne purge tout seul et les 15 Go gratuits se rempliront.
Laissé vide, rien n'est jamais supprimé (choix sûr, mais le quota finit par
saturer).

Deux limites de Drive à connaître : il est lent avec beaucoup de petits fichiers,
et l'autorisation OAuth peut être révoquée (changement de mot de passe Google,
inactivité). Les scripts échouent alors franchement en affichant la commande de
reconnexion — ils ne font jamais semblant d'avoir réussi. Une combinaison
raisonnable : Drive pour le dump nocturne, R2 pour le flux WAL.

### Option C — un second serveur en SSH

```
BACKUP_SSH_TARGET=tewiz@autre-machine:/srv/backups/tewiz
```

Nécessite une clé sans mot de passe : cron ne peut pas répondre à une invite.

**2. Vérifier qu'un dump part bien hors-site**, avant d'activer PITR :

```bash
cd /opt/tewiz && bash scripts/backup-db.sh
```

Attendu : `ok bytes=… objects=…` puis `uploading to s3://…` puis `done offsite=1`.

**3. Activer PITR.** ⚠️ Redémarre PostgreSQL (`wal_level` et `archive_mode` ne
se rechargent pas à chaud). Quelques secondes de 5xx sur l'API. À faire tôt le
matin, pas à 19h.

```bash
cd /opt/tewiz && sudo bash scripts/setup-pitr.sh
```

Le script pose les crons, force une bascule de WAL et **vérifie qu'un segment
apparaît réellement** dans l'archive. S'il ne sort pas `PITR is ON`, ne pas
passer à la suite.

**4. Faire l'exercice tout de suite**, sans attendre le 1er du mois :

```bash
cd /opt/tewiz && bash scripts/restore-db.sh
```

Sans danger : restaure dans une base jetable, compare les comptages au manifeste,
vérifie l'invariant du wallet, puis supprime la base.

## Scénarios

### A. « J'ai lancé un UPDATE sans WHERE » / mauvaise migration

C'est le cas où PITR sert. On restaure à l'instant d'avant la bêtise.

1. **Arrêter l'API immédiatement** — chaque seconde d'écriture supplémentaire
   complique la récupération :
   ```bash
   pm2 stop tewiz-api tewiz-admin
   ```
2. Noter l'heure exacte (UTC) juste avant l'incident.
3. Arrêter Postgres et mettre l'ancien répertoire de données de côté — **ne pas
   le supprimer**, c'est la seule copie des dernières secondes :
   ```bash
   systemctl stop postgresql
   mv /var/lib/postgresql/16/main /var/lib/postgresql/16/main.broken
   ```
4. Restaurer le base backup le plus récent :
   ```bash
   ls -1t /var/backups/tewiz-basebackup/
   mkdir -p /var/lib/postgresql/16/main
   tar -xzf /var/backups/tewiz-basebackup/base-<TS>/base.tar.gz -C /var/lib/postgresql/16/main
   chown -R postgres:postgres /var/lib/postgresql/16/main
   chmod 700 /var/lib/postgresql/16/main
   ```
5. Configurer le rejeu jusqu'à la cible :
   ```bash
   cat >> /etc/postgresql/16/main/conf.d/60-recovery.conf <<'EOF'
   restore_command = 'gunzip -c /var/backups/tewiz-wal/%f.gz > %p'
   recovery_target_time = '2026-07-30 14:37:00+00'
   recovery_target_action = 'pause'
   EOF
   touch /var/lib/postgresql/16/main/recovery.signal
   chown postgres:postgres /var/lib/postgresql/16/main/recovery.signal
   systemctl start postgresql
   ```
   `recovery_target_action = 'pause'` laisse la base en lecture seule à la cible :
   on peut **vérifier** avant de valider. Si la cible est mauvaise, ajuster
   `recovery_target_time` et recommencer depuis l'étape 4.
6. Vérifier, puis valider :
   ```bash
   sudo -u postgres psql tewiz -c "SELECT count(*) FROM rides WHERE requested_at > now() - interval '2 hours'"
   sudo -u postgres psql -c "SELECT pg_wal_replay_resume()"   # sort du mode recovery
   ```
7. Supprimer `60-recovery.conf`, redémarrer Postgres, relancer l'API :
   ```bash
   rm /etc/postgresql/16/main/conf.d/60-recovery.conf
   systemctl restart postgresql && pm2 start tewiz-api tewiz-admin
   ```
8. Ne supprimer `main.broken` qu'après plusieurs jours de fonctionnement normal.

### B. Le VPS est perdu (disque mort, compte suspendu)

RPO ~5 min via le WAL hors-site ; en repli, le dump de la nuit.

1. Commander un VPS neuf, lancer `scripts/setup-contabo.sh`.
2. Récupérer le hors-site. Depuis un bucket S3 :
   ```bash
   aws s3 sync s3://tewiz-backups/db/  /var/backups/tewiz-db/  --endpoint-url <endpoint>
   aws s3 sync s3://tewiz-backups/wal/ /var/backups/tewiz-wal/ --endpoint-url <endpoint>
   ```
   Depuis Drive via rclone — il faut d'abord réinstaller rclone **et remettre le
   fichier `rclone.conf`** (avec les mots de passe du remote `crypt`), sinon les
   sauvegardes sont illisibles :
   ```bash
   curl https://rclone.org/install.sh | sudo bash
   rclone copy gcrypt:db/  /var/backups/tewiz-db/
   rclone copy gcrypt:wal/ /var/backups/tewiz-wal/
   ```
   ⚠️ Garder une copie de `rclone.conf` **ailleurs que sur le VPS** (gestionnaire
   de mots de passe). C'est le piège du chiffrement : perdre ce fichier revient à
   perdre les sauvegardes.
3. Voie rapide (perte = depuis le dernier dump) :
   ```bash
   cd /opt/tewiz && bash scripts/restore-db.sh /var/backups/tewiz-db/tewiz-<TS>.dump --into tewiz
   ```
   La base cible est vide sur une machine neuve : aucun `--force` nécessaire.
4. Voie complète (perte ~5 min) : suivre le scénario A à partir de l'étape 4, en
   utilisant le base backup hors-site et **sans** `recovery_target_time` — le
   rejeu va alors jusqu'au bout du WAL disponible.
5. Restaurer les uploads :
   ```bash
   tar -xzf /var/backups/tewiz-uploads/uploads-<TS>.tar.gz -C /var/lib/tewiz/
   ```
6. Faire pointer le DNS de `tewiz-api.radar-mr.com` vers la nouvelle IP, réémettre
   le certificat Let's Encrypt.

**Redis n'est pas sauvegardé, et c'est volontaire** : il ne contient aujourd'hui
rien de durable (cf. son usage limité au `/health`). Si un état durable y arrive
un jour, ce runbook doit être mis à jour le même jour.

### C. L'exercice mensuel a échoué

Traiter comme un incident de production, le jour même. Les sauvegardes sont déjà
cassées ; on l'a juste appris avant d'en avoir besoin.

```bash
tail -50 /var/log/tewiz-restore-drill.log
bash scripts/restore-db.sh                        # rejouer à la main
KEEP_SCRATCH=1 bash scripts/restore-db.sh         # garder la base pour inspecter
```

Un écart de comptage sur `wallet_transactions` ou une violation de l'invariant du
wallet est le plus grave : c'est l'argent des captains.

## Surveillance sans attendre le pire

```bash
# L'archiveur échoue-t-il ?  failed_count doit rester stable.
sudo -u postgres psql -tAX -c 'SELECT * FROM pg_stat_archiver'

# Le hors-site part-il bien ?  Doit contenir une ligne toutes les 5 min.
tail -20 /var/log/tewiz-ship-wal.log

# Âge du dernier dump. Plus de 26h = alerte.
ls -lt /var/backups/tewiz-db/*.dump | head -3

# L'archive WAL grossit-elle sans être expédiée ?  (= expéditeur cassé)
du -sh /var/backups/tewiz-wal
```

Ces quatre vérifications deviendront des alertes Grafana à l'étape 2 du plan
(métriques). En attendant, les faire une fois par semaine.

## Notes de conception

- **`backup-db.sh` échoue franchement, contrairement à `backup-uploads.sh`.**
  Le snapshot des uploads sort en 0 quand le dossier est absent, pour ne jamais
  bloquer un déploiement sur du cosmétique. Le dump DB, lui, précède les
  migrations : sans point de restauration, on ne touche pas au schéma.
- **Le dump est vérifié via `pg_restore --list`.** Un dump tronqué (disque plein,
  `pg_dump` tué par l'OOM killer) sort quand même en 0 et ressemble à un fichier
  plausible. La quasi-totalité des « on avait des sauvegardes » sont exactement
  ça.
- **Un manifeste accompagne chaque dump** : comptages de `users`, `captains`,
  `rides`, `wallets`, `wallet_transactions`, plus les sommes du wallet. La
  restauration correspond au manifeste ou elle échoue — pas de « à peu près ».
- **La rotation intervient après vérification et expédition**, jamais avant : on
  ne supprime pas un bon dump ancien pour faire de la place à un mauvais dump
  neuf.
- **Les base backups ne sont pas purgés automatiquement.** Supprimer un base
  backup dont le WAL a encore besoin casse la récupération en silence. Revue
  mensuelle à la main, garder au moins les deux plus récents.
- **`archive_command` n'écrit qu'en local.** S'il pouvait échouer pour une raison
  réseau, PostgreSQL réessaierait indéfiniment et `pg_wal` remplirait le disque —
  on aurait fait tomber la base en essayant de la protéger.
- **On utilise `rclone copyto` / `rclone copy`, jamais `rclone sync`.** `sync`
  reproduit les suppressions côté distant : la rotation locale (`KEEP=7`)
  effacerait alors aussi les copies hors-site, soit exactement le contraire de ce
  à quoi sert un second emplacement. Vérifié par un test : avec `KEEP=1`, il reste
  1 dump en local et les 4 copies distantes sont intactes.
