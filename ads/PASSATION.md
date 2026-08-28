# Passation — générateur d'annonces Aloo

Ce fichier existe pour qu'une nouvelle session reprenne sans refaire le chemin.
Il dit **où en est le travail**, **comment le système fonctionne**, et surtout
**ce qui a déjà été essayé et raté** — c'est la partie qui coûte le plus cher à
réapprendre.

---

## 1. État au moment de la passation

**45 affiches** décrites dans `posters.json`, 47 PNG sur le disque.

### ✅ Migration jour terminée

| Étape | État |
|---|---|
| Nouvelle teinte tritone (ombres espresso / médiums ember / lumières sable) | ✅ |
| Re-teinte des 16 photos en thème jour (`./retint.sh`) | ✅ |
| Retrait de `"theme": "nuit"` dans `posters.json` | ✅ 25 affiches |
| Reconstruction + réexport | ✅ 43 PNG |
| Vérification des contrastes après migration | ✅ voir ci-dessous |

Plus aucune affiche ne porte de thème : `jour` est le défaut et le seul en
usage. `theme-nuit.css` et les règles `.nuit` restent en place — le thème
sombre marche toujours, il n'est simplement plus employé.

**Attention aux noms de fichiers.** `11-nuit-route`, `12-nuit-grille`,
`20-scene-nuit` et `71-sommaire-nuit` gardent « nuit » dans leur slug alors
qu'ils sont en jour comme les autres. Le nom ne décrit plus le thème. Les
renommer casserait les PNG déjà diffusés, donc rien n'a été touché.

### Ce que la migration a cassé, et la correction

Le passage au jour a inversé deux hypothèses du thème sombre. Les deux défauts
étaient invisibles à l'œil sur vignette et ont été trouvés à la mesure.

1. **Voile du gabarit `affiche`.** Le voile jour ne couvrait que les 24 % du
   bas, alors que la pile titre est ancrée en bas mais *grandit vers le haut* :
   un titre de deux lignes atteint la mi-hauteur. L'encre espresso tombait donc
   sur la partie sombre d'une photo à contre-jour. `S2-story-dune` mesurait
   **2,80:1**. Portée du dégradé montée de 24 % à 48 %, densité du bas
   inchangée pour ne pas délaver les photos déjà correctes.

2. **Gabarit `fenetre`, la règle s'inverse.** En nuit, l'aplat est espresso et
   la photo devait être *plus claire* que lui. En jour l'aplat est sable, donc
   c'est la photo qui doit faire la partie sombre du glyphe. Le ciel pâle en
   haut des lettres tombait à **1,50:1** — lettres invisibles. Corrigé par
   `filter: brightness(0.58) saturate(1.25)` sur
   `.poster.g-fenetre:not(.nuit) .mot`, plutôt qu'en exigeant une photo
   différente par mot. Attention : `filter` ne se cumule pas, l'ombre portée
   doit être réécrite dans la même déclaration.

### Résultats de mesure après correction

| Contrôle | Résultat |
|---|---|
| Contraste du titre (encre espresso), 43 affiches | **toutes ≥ 4,5:1**, 40 sur 43 ≥ 7:1 |
| Les trois plus basses | `S2-story-dune` 5,13 · `J1-taxis` 5,27 · `81-dune-famille` 5,47 |
| Glyphes `fenetre` contre l'aplat | 5,60 à 6,99:1 (contre 1,50–2,40 avant) |
| Coutures du carrousel | 4,4 et 1,5 sur 255 (attendu < 30) |
| Contenu des QR, relu sur les PNG | 41/43 conformes ; `C1-carrousel-1` et `-2` n'en portent pas (`sans-pied`, voulu) |

**Point ouvert : l'ember n'atteint pas 3:1.** Les segments en ember `#F2682C`
posés sur le sable `#FBF3E7` plafonnent à **2,80:1**, sous le seuil de 3:1
admis pour du grand texte. Ce n'est **pas** un effet de la migration : les
affiches déjà en jour avant (`01-securite`, `13-jour-route`, `21-scene-jour`)
donnaient déjà 2,80. C'est une propriété de la palette, donc une décision à
prendre, pas un bug à corriger — assombrir l'ember ou le réserver aux surfaces
pleines. Non tranché.

## 2. Le projet en deux commandes

```bash
cd ads
.venv/bin/python build.py    # posters.json -> *.html + index.html + tailles.txt
./render.sh                  # *.html -> *.png (2160×2160 ou 2160×3840)
```

`index.html` est une planche de contact : elle affiche les vraies pages en
direct, donc ce qu'on y voit est ce qui sortira.

**Tout se pilote depuis `posters.json`.** Le Python n'a pas à être ouvert pour
changer un texte, une photo ou un gabarit.

---

## 3. Les fichiers

| Fichier | Rôle |
|---|---|
| `posters.json` | **le seul fichier à éditer** — textes, gabarits, photos |
| `build.py` | lit le JSON, écrit les HTML, génère les QR, déplie les carrousels |
| `render.sh` | HTML → PNG via Chrome headless, avec verrou anti-concurrence |
| `teinte.py` | met une photo aux couleurs de la marque + mesure le contraste |
| `retint.sh` | repasse **toutes** les photos par `teinte.py` (la table source→sortie) |
| `brand.css` | palette et gabarit `centre` |
| `layouts.css` | tous les autres gabarits |
| `theme-nuit.css` | surcharges du thème sombre |
| `format-story.css` | surcharges du format 9:16 |
| `decors.py` | route en ruban, grille isométrique (SVG) |
| `scenes.py` | scène « horizon » : route en perspective, skyline, voiture |
| `README.md` | mode d'emploi destiné à l'utilisateur |
| `BRIEF-IMAGES.md` | cahier des charges pour rapporter des photos |

Dossiers : `assets/photos/` (fonds), `assets/hero/` (détourés),
`assets/screens/` (captures d'app), `assets/_sources/` (**originaux non
teintés — ne jamais supprimer**, c'est la base de toute re-teinte).

---

## 4. Les gabarits

| Gabarit | Ce qu'il fait |
|---|---|
| `centre` *(défaut)* | logo et titre centrés, puces autour du téléphone |
| `liste` | titre + trois atouts alignés, téléphone à l'opposé |
| `bande` | grand titre, téléphone incliné, bande basse |
| `large` | aéré, arc de route, pastille d'action |
| `scene` | route en perspective calculée, skyline, voiture — pas de téléphone |
| `affiche` | photo plein cadre, pile titre/badge/conditions/pastille |
| `editorial` | photo en haut pleine largeur, message sur aplat en bas |
| `sommaire` | grille de services (12 ou 6 cases) |
| `fenetre` | **la photo n'apparaît qu'à l'intérieur d'un mot géant** |
| `carrousel` | N cartes qui forment une seule image continue |

### Clés principales

`fichier`, `gabarit`, `surtitre`, `titre` (les `*astérisques*` passent le
segment en ember), `ecran`, `puces`, `cta`, `detail`, `badge`, `badge_note`,
`fond`, `visuel`, `sans_telephone`, `theme` (`jour`/`nuit`), `format`
(`carre`/`story`), `decor`, `scene`, `mot`, `taille_mot`, `services`,
`colonnes`, `cartes`, `incline`, `surtitre_long`, `titre_long`.

---

## 5. Ce qui a été appris — la partie qui coûte cher

### CSS et mise en page

- **Ordre des propriétés logiques.** Écrire `left: 0; right: 0` puis
  `inset-inline-start: auto` fait gagner la logique : le bloc cesse d'être
  centré. Les logiques doivent précéder les physiques. Ça a fait dériver le
  téléphone en story pendant deux cycles.

- **`inset-inline-end` sur un élément qui porte lui-même `direction: ltr`** se
  résout depuis l'élément, pas depuis le poster RTL. Le compteur du carrousel
  repartait du même côté que la marque. Corrigé en `left` physique.

- **La taille du cadre doit vivre sur `<body>`.** Posée sur `.poster`, elle
  arrivait trop bas dans l'arbre : le corps restait carré et rognait la moitié
  basse des stories.

- **Ne jamais positionner en absolu une suite de blocs qui peut grandir.** Le
  gabarit `affiche` supposait un titre d'une ligne ; à deux lignes il
  recouvrait le badge. Remplacé par une pile en flux (`.pile`), ancrée en bas.

- **Exception : le carrousel.** Une pile ancrée en bas grandit vers le haut,
  donc la carte qui porte une pastille remonte son titre. Sur un carrousel,
  c'est la **ligne de titre** qui doit être commune, pas le bas du bloc. Titre
  et pastille y sont ancrés séparément à hauteur fixe.

- **`÷2` s'affiche `2÷` en contexte RTL.** Une expression mathématique doit
  porter `direction: ltr; unicode-bidi: isolate`.

- **Le voile doit suivre le thème.** Il éclaircit sous une encre espresso, il
  assombrit sous une encre crème. Codé en dur sombre, il noircissait les
  photos claires en thème jour.

### Images

- **L'ember ne tient pas sur une photo de nourriture.** Sur
  `43-livraison-repas`, aucun recadrage ne fait monter le segment ember
  au-dessus de **1,4:1** : les demi-teintes d'un plat chaud tombent
  exactement sur la luminance de l'ember. Le balayage a testé 3 tailles de
  fenêtre × toutes les positions, le maximum est 1,39. La réponse n'est pas de
  chercher une autre photo mais de **retirer les astérisques** — le titre passe
  alors entier en espresso à 7,7:1. C'est le cas extrême du plafond ember
  décrit en §1.

- **Le surtitre est le maillon faible du gabarit `affiche`.** Mesuré sur toute
  la famille, l'encre `ink2` `#6B5740` donne **2,82 à 4,70:1** — sous 4,5 pour
  cinq affiches sur six, et c'est du petit texte, donc le seuil 3:1 des grands
  caractères ne s'applique pas. Pas causé par la migration : c'est la valeur de
  `ink2` sur photo. Non corrigé, parce que toucher `ink2` déplace les 44
  affiches — décision à prendre, pas bug à corriger.

- **« La couleur EST le message » vaut aussi pour le blanc.** Sur
  `83-recrutement-berline`, la consigne était une berline *blanche*. À
  `--melange 100` la carrosserie vire à l'ember : ce n'est plus une berline
  blanche, c'est une berline orange. Mesuré en saturation des 12 % de pixels
  les plus clairs : 0,427 à 100, contre 0,130 sur l'original. À `--melange 40`
  la carrosserie retombe à **0,129** — aussi neutre que l'original — pendant
  que la scène monte à 0,321 et reste dans la palette. Le réflexe « la couleur
  n'est pas le message ici » est faux dès que la teinte du sujet fait partie de
  la commande.

- **Reprendre un libellé de l'app ne suffit pas : il doit se suffire à
  lui-même.** `carpooling.booking.otpHint` — « أعطِ هذا الرمز للكابتن عند
  الركوب » — est juste dans l'app, où il s'affiche à côté du code réel. Sur une
  affiche, « ce code » ne désigne rien. Remplacé par
  `carpooling.passenger.requestSentBody`, qui décrit le déroulé sans rien
  désigner hors cadre. Vérifier le référent, pas seulement la source.

- **Les libellés d'ارفدني sont dans `apps/mobile/locales/ar.json`**, sous
  `carpooling` : `title` = ارفدني, `passenger.available` = الرحلات المتاحة,
  `passenger.requestBtn` = طلب مقعد, `publish.originLabel` / `destLabel`,
  `booking.metaLine` = « {{date}} · {{price}} أوقية/مقعد ». C'est la source à
  citer plutôt qu'à réinventer.

- **Le contraste dépend du gabarit, pas de l'affiche.** Trois profils, chacun
  reproductible à l'identique sur toute sa famille :

  | Gabarit | Titre | Surtitre | Segment accentué |
  |---|---|---|---|
  | `centre` (fond sable) | 14,5–14,7 | 6,07 | ember **2,80** |
  | `editorial` (aplat espresso) | 14,4–14,5 | 7,76 | `--sun` **7,11** |
  | `affiche` (sur photo) | 5,3–12,0 | **2,82–4,70** | ember **~1,1–2,8** |

  `affiche` est le seul gabarit où le fond décide, et c'est le seul qui échoue.
  Quand la photo est difficile, `editorial` ou `centre` règlent le problème par
  construction.

- **Le gabarit `editorial` met le texte hors de la photo**, sur l'aplat
  espresso, et désactive le voile. Résultat : titre **14,4:1**, surtitre
  **7,8:1**, `em` (en `--sun`, pas en ember) **7,1:1** — identiques sur les
  quatre affiches de la famille, quelle que soit la photo. C'est le seul
  gabarit où le contraste ne dépend pas du fond, et il n'a donc pas le point
  faible du surtitre de `affiche` (2,82–4,70). À préférer quand la photo est
  difficile.

- **`teinte.py` avertit à tort sur `editorial`.** Son contrôle final mesure la
  bande 0,62–0,86 de l'image en supposant que le titre s'y pose ; en
  `editorial` le titre est sur l'aplat. Le « INSUFFISANT » y est un faux
  positif, à ignorer pour ce gabarit.

- **`teinte.py` est la réponse au problème de couleur**, pas le voile. Une
  photo de banque d'images arrive avec ses dominantes ; empiler du voile
  l'éteint sans rien gagner. Le remappage la ramène dans la palette *et* règle
  le contraste à la source, ce qui permet ensuite d'**alléger** le voile.

- **Le tritone bat le duotone.** Deux bornes brunes donnaient un sépia mou. En
  plaçant l'ember au milieu (`midpoint=118`), la couleur de la marque se
  retrouve là où une photo a le plus de matière.

- **Quand une couleur EST le message, ne pas teindre à fond.** Le jaune des
  taxis disparaissait à 100 %. `--melange 78` chasse les dominantes froides
  sans tuer le sujet.

- **La page est en RTL, donc le texte se pose à droite.** Un sujet placé à
  droite dans la photo finit sous le titre. `--miroir` le renvoie à gauche —
  valable seulement sur une image sans texte ni signalétique lisible.

- **Le gabarit `fenetre` exige une image plus claire que l'aplat.** Une photo
  de nuit dans des lettres posées sur de l'espresso donne des lettres
  invisibles : aucun contraste entre l'intérieur et l'extérieur du glyphe.

- **Un carrousel demande un vrai panorama** (N × 1080 de large). Une image
  carrée étirée sur trois cartes est floue.

- **Regarder une photo en 2160 px avant de la publier.** Une « rue en
  Mauritanie avec drapeaux » s'est révélée être un **convoi militaire armé**,
  invisible sur la vignette. Elle avait déjà été traitée et montée dans deux
  affiches.

- **Pexels ne fournit aucune autorisation des personnes.** Filtre appliqué
  partout : pas de visage identifiable. C'est ce qui a fait écarter toutes les
  photos de colis, qui en montraient toutes.

### Outillage

- **Une page d'outillage dans `ads/` finit photographiée.** `render.sh` rend
  tout `*.html` sauf `index`. Une page de mesure à iframes y a fait caler
  Chrome et bloqué le verrou. La supprimer avant tout rendu.

- **Ne pas repérer le titre par « la bande la plus encrée ».** Le détecteur
  tombe sur le pied de page, identique partout, et rend la même valeur pour
  toutes les affiches. Confronté aux boîtes relevées dans le DOM il se trompait
  encore de 4 points sur `J1-taxis`. Les boîtes doivent venir du DOM.

- **Le serveur local tombe.** Chrome photographie alors une page d'erreur et
  les mesures de contraste renvoient 1,0:1 partout. **Toujours vérifier
  `curl -sf http://localhost:4399/` avant une série de rendus.**

- **`render.sh` pose un verrou.** Deux rendus simultanés se disputaient Chrome
  et se bloquaient mutuellement.

- **L'en-tête de `retint.sh` est trompeur.** Il annonce les colonnes
  `sortie source`, alors que `teinte.py` prend `source` puis `sortie`. Les
  lignes sont correctes, c'est le commentaire qui est inversé — ne pas
  « corriger » les lignes en s'y fiant.

- **Un seul `trap` par script.** Un second écrase le premier — le verrou ne se
  levait jamais.

- **`tailles.txt`** est un manifeste écrit par `build.py` : `render.sh` y lit
  la taille de fenêtre de chaque affiche, sinon une story sortirait rognée.

- **Pillow refuse les images > 178 Mpx** (garde-fou anti-bombe). Relever
  `Image.MAX_IMAGE_PIXELS` pour les sources de 14 000 px.

- **`segno` n'écrit pas de `viewBox`.** Sans lui le QR reste à 33 px quoi qu'en
  dise le CSS.

---

## 6. Vérifications automatiques — à refaire après chaque changement de fond

Ne pas juger à l'œil. Ces deux mesures ont attrapé des défauts invisibles.

### Contraste du titre

```python
from PIL import Image
import teinte
c = Image.open("01-securite.png").convert("RGB"); W, H = c.size
z = c.crop((int(W*0.35), int(H*0.60), int(W*0.95), int(H*0.72)))
px = list(z.resize((60, 12)).get_flattened_data())
m = tuple(sum(p[k] for p in px)//len(px) for k in range(3))
encre = (44, 29, 16)          # jour ; (255,246,234) en nuit
print(teinte.contraste(encre, m))   # viser >= 4.5, idéalement >= 7
```

### Continuité d'un carrousel

Comparer une bande de 6 px de part et d'autre de chaque couture, en ignorant
le tiers bas (textes). Écart moyen attendu : **< 30/255**. Les bons résultats
obtenus étaient entre 2 et 6.

### Contenu des QR

```bash
.venv/bin/pip install opencv-python-headless
```

Relire les QR **depuis les PNG exportés** — un QR peut sortir net et faux.

---

## 7. Conseil de méthode pour la suite

Le principal gaspillage de cette session a été de **rendre puis regarder chaque
PNG un par un**. À éviter :

- Rendre **par lot**, puis mesurer par script (contraste, coutures) et ne
  regarder que ce que la mesure signale.
- Pour juger une série, **coller les PNG côte à côte** en une seule planche et
  ne regarder que celle-là.
- Se fier à `index.html` plutôt qu'à des rendus intermédiaires.

**Piège de méthode rencontré.** Pour mesurer, une page d'instrumentation avait
été déposée dans `ads/` : elle chargeait les 43 affiches en `<iframe>` pour
relever la boîte de chaque titre. Or `render.sh` photographie **tout** `*.html`
du dossier sauf `index` — il a donc essayé de rendre cette page, Chrome a calé
sur les 43 iframes et le verrou est resté posé une demi-heure. Une page
d'outillage se supprime avant tout rendu, ou s'appelle `index`.

---

## 8. Décisions et points ouverts

1. ~~Finir la migration jour~~ — **faite** (voir §1). Reste ouvert : le
   contraste de l'ember à 2,80:1, décrit en fin de §1.
2. **Doublon assumé : `60-arfadni` et `63-arfadni-mocaad`.** Même gabarit,
   même service. `60` s'adresse au kabten qui publie (`انشر رحلتك`), `63` au
   passager qui réserve (`طلب مقعد`, `الرحلات المتاحة`). Deux photos
   différentes pour ne pas les confondre. Le texte de `60` est en partie
   rédigé ; celui de `63` est repris mot pour mot du fichier de langue.

3. **Doublon assumé : `03-whatsapp` et `14-whatsapp-sans-app`** disent la même
   chose (commander par WhatsApp sans installer l'application), dans le même
   gabarit, avec le même écran et la même puce verte. `14` change l'angle —
   « une seule message et la voiture arrive » plutôt que « commande par
   WhatsApp » — et sa seconde puce parle de la couverture (`رحلات وطرود`) au
   lieu d'inviter au groupe. Garder les deux ou en supprimer une : non tranché.

4. **Choisir un sommaire** parmi `70-sommaire-clair`, `71-sommaire-nuit`,
   `72-sommaire-essentiel`. L'utilisateur n'a pas tranché.
5. **`docs/brand/carte-visite/build.py`** contient encore
   `url_ios: "id0000000000"`. La carte de visite imprimée a donc un QR iOS
   mort, alors que le vrai lien existe :
   `https://apps.apple.com/app/aloo/id6782893228`.
6. **`assets/photos/route-nuit.jpg`** est une photo de nuit ; en thème jour
   elle détonne. Le thème nuit n'est plus employé nulle part, donc la réserver
   n'est plus une option : à remplacer. Même remarque pour `dune-famille.jpg`,
   un contre-jour qui reste la photo la plus difficile du jeu — c'est elle qui
   tient les deux plus mauvais scores après correction.
7. **Direction non réalisée** : le traitement risographe et l'affiche
   pédagogique « ١ ٢ ٣ » avaient été retenus par l'utilisateur mais ne sont pas
   faits.
8. **`43-livraison-repas`** utilise une photo Pexels décrite comme du **jollof
   rice nigérian** (riz, poisson grillé, brochettes ; photographe *Keesha's
   Kitchen*). Visuellement très proche du chebujin mauritanien, mais ce n'est
   pas un plat mauritanien. Pexels n'a aucun résultat mauritanien et le seul
   résultat sénégalais explicite montrait un visage, exclu par la règle §9. Une
   vraie photo locale reste préférable. `assets/_sources/plat-couscous.jpg` est
   une seconde candidate téléchargée, non utilisée.

9. **`83-recrutement-berline`** utilise une Honda Civic blanche (Pexels,
   photographe *Shuaizhi Tian*) : berline ordinaire, sans plaque ni
   signalétique lisible, conforme au cahier des charges de `BRIEF-IMAGES.md`
   qui écarte les voitures de prestige pour le message de recrutement. Deux
   autres candidates ont été écartées à la vérification en pleine résolution :
   une BMW à **plaque chinoise lisible**, et une Camry photographiée devant des
   **devantures chinoises**. Elles restent dans `/tmp`, non versées aux
   sources.

10. **L'écran `portefeuille`** affiche le taux de commission (7 % / 10 % colis)
   et des identifiants de course. Volontairement non publié — décision
   commerciale, pas graphique.

---

## 9. Faits de marque à ne pas réapprendre

- Le produit s'appelle **Aloo** (le paquet Android est resté `mr.tewiz.app`).
- Palette « Sahara Solaire », `apps/mobile/theme/palette.ts` — ember `#F2682C`,
  sable `#FBF3E7`, encre `#2C1D10`, espresso `#2A1A0E`.
- Polices **Sora** (latin) + **Cairo** (arabe), depuis
  `node_modules/@expo-google-fonts/`.
- Contact : **222 33322777**.
- Liens : App Store `id6782893228`, Play Store `mr.tewiz.app`.
- **Arabe littéraire uniquement.** Toute darija a été éliminée
  (`وين ما كنت`, `نجيوك`, `تلفونك`, `يجيك لدارك`…). Le terme retenu pour un
  chauffeur est **كابتن**, comme dans l'application.
- L'offre réelle, mot pour mot : **500 MRU de commission en 8 jours →
  commission ÷2 pendant 2 jours**, sur toutes les courses (in-app, colis,
  call-center). L'utilisateur a demandé de n'en dire **que** l'essentiel.
