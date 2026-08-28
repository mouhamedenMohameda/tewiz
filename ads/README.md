# Aloo — annonces sociales

Affiches carrées 1080 × 1080 pour Facebook et Instagram, exportées en
2160 × 2160. Tout se pilote depuis **`posters.json`** : vous n'avez jamais à
ouvrir le Python.

```bash
.venv/bin/python build.py   # posters.json  ->  *.html + index.html
./render.sh          # *.html        ->  *.png 2160 × 2160
```

Ouvrez **`index.html`** dans un navigateur : c'est la planche de contact, elle
affiche les vraies pages en direct. Ce que vous y voyez est exactement ce qui
sortira en PNG.

---

## Changer un texte

Ouvrez `posters.json`, modifiez, relancez `build.py`.

```json
{
  "fichier": "01-securite",
  "surtitre": "كل رحلة مع سائق موثّق…",
  "titre": "أمان *لعائلتك*",
  "ecran": "home",
  "puces": [
    { "icone": "bouclier", "titre": "سائق موثّق", "sous": "هوية مؤكَّدة", "place": "haut-droite" }
  ]
}
```

| Clé | Effet |
|---|---|
| `fichier` | nom du `.html` et du `.png` produits |
| `gabarit` | la mise en page — voir « Les gabarits » ci-dessous. Par défaut `centre`. |
| `surtitre` | la ligne fine, en brun |
| `titre` | la grosse ligne. **Les `*astérisques*` passent le segment en orange.** |
| `ecran` | quelle capture montrer dans le téléphone (voir plus bas) |
| `puces` | 0 à 3 cartes flottantes ; au-delà ça s'entasse |
| `incline` | `true` incline le téléphone de 7° — pour varier au sein d'une série |
| `surtitre_long` | `true` réduit le surtitre quand il énumère et frôle les bords |
| `titre_long` | `true` réduit le titre quand il passe sur trois lignes et descend sur le téléphone |

Ajouter une affiche = ajouter un bloc dans `affiches`. Il n'y a pas de limite.

---

## Les gabarits

Quatre mises en page, à choisir avec `"gabarit"`. Voyez-les côte à côte dans
`index.html` (`08-`, `09-`, `10-`).

| Gabarit | Structure | Bon pour |
|---|---|---|
| `centre` *(défaut)* | logo et titre centrés, puces flottant autour du téléphone | un message simple, très lisible en petit |
| `liste` | logo en haut, titre puis **trois atouts alignés**, téléphone à l'opposé, bande de téléchargement en bas | une fiche produit : plusieurs arguments d'un coup |
| `bande` | grand titre, téléphone incliné, pastille d'action, bande en bas | un message unique qu'on veut frappant |
| `large` | beaucoup de vide, arc de route en fond, liste courte, pastille d'action | une annonce aérée, style campagne |

Deux clés servent uniquement aux gabarits non centrés :

| Clé | Effet |
|---|---|
| `cta` | le texte de la pastille orange (`bande` et `large` seulement) |
| `visuel` | un PNG **détouré** de `assets/hero/`, posé derrière le téléphone |

---

## Thème et décor

Deux réglages qui changent radicalement l'allure, indépendamment du gabarit.

### `theme`

| Valeur | Rendu |
|---|---|
| `jour` *(défaut)* | fond sable, texte espresso |
| `nuit` | fond brun torréfié, texte crème, ember remonté |

Le thème nuit n'est pas le thème clair inversé : ce sont les valeurs du schéma
sombre de `palette.ts` — le désert la nuit. Le QR, lui, garde toujours son fond
clair : un code inversé ne se scanne pas sur tous les téléphones.

```json
{ "theme": "nuit", "…": "…" }
```

### `decor`

| Valeur | Rendu |
|---|---|
| *(absent)* | fond nu |
| `route` | ruban de route en perspective, ligne médiane pointillée |
| `grille` | grille isométrique façon plan de ville |

C'est le procédé des publicités Bolt et Careem : une route qui serpente et
porte le regard vers le téléphone. Les décors sont dessinés en SVG dans
`decors.py` et s'accordent seuls au thème.

```json
{ "theme": "nuit", "decor": "route", "…": "…" }
```

**Ce que les décors ne font pas :** les voitures, les personnages et les
épingles volumétriques des références sont des rendus 3D. Ils passent par
`visuel`, pas par `decor`.

Dans `centre` et `bande`, les `puces` flottent et leur `place` compte. Dans
`liste` et `large`, elles s'empilent en liste dans l'ordre d'écriture et
`place` est ignorée.

### Les emplacements pour vraies images

**Voir `BRIEF-IMAGES.md`** — il donne les tailles exactes, les prises de vue à
rapporter et les précautions de droits.

| Clé | Dossier | Usage |
|---|---|---|
| `fond` | `assets/photos/` | photo plein cadre + voile automatique |
| `visuel` | `assets/hero/` | objet détouré, posé en bas au centre |
| `sans_telephone` | — | `true` efface le téléphone pour laisser la place au visuel |

### L'emplacement `visuel`

C'est le seul endroit prévu pour un rendu 3D ou une photo détourée — voiture,
personne, épingle — comme sur les publicités Bolt ou Uber. **Le CSS ne fabrique
pas ces images.** Déposez un PNG à fond transparent dans `assets/hero/` et
appelez-le par son nom :

```json
{ "gabarit": "bande", "visuel": "voiture-3d", "…": "…" }
```

Sans `visuel`, les gabarits restent propres — ils ne montrent simplement que le
téléphone.

### Les puces

| Clé | Effet |
|---|---|
| `icone` | voir la liste ci-dessous |
| `titre` | la ligne en gras |
| `sous` | la ligne grise en dessous |
| `place` | `haut-droite`, `haut-gauche`, `bas-droite`, `bas-gauche`, `milieu-droite`, `milieu-gauche` |
| `or` | `true` passe l'icône en doré — réservé à l'argent, comme dans l'app |
| `vert` | `true` passe l'icône en vert — réservé à WhatsApp |

**Icônes disponibles :** `bouclier`, `epingle`, `etoile`, `eclair`,
`portefeuille`, `micro`, `globe`, `horloge`, `cadeau`, `pourcent`,
`personnes`, `voiture`, `whatsapp`, `restaurant`.

Pour en ajouter une : une entrée dans le dictionnaire `ICONS` de `build.py`,
tracée dans une grille 24 × 24, avec `currentColor` comme couleur.

---

## Changer l'écran du téléphone

Déposez un PNG dans **`assets/screens/`**. Son nom de fichier devient son nom
dans `posters.json` — `promo.png` s'utilise avec `"ecran": "promo"`.

Actuellement disponibles :

| Nom | Contenu |
|---|---|
| `accueil` | accueil passager — طلب رحلة، اطلب بالصوت، اطلب عبر واتساب |
| `chauffeur` | tableau de bord capitaine — غير متصل، الرصيد، مجموعة واتساب للكباتن |
| `restaurants` | المطاعم — نواكشوط, avec catégories et vignettes |
| `recharge` | شحن جديد — Bankily, Masrvi, Sedad, Bureau Aloo. **⚠ affiche le numéro Bankily de rechargement.** |
| `profil` | الاسم واللغة — sélection de l'arabe. **⚠ affiche un nom de compte et un numéro.** |
| `telecharger` | تنزيل التطبيق — badges stores, « صُنع بحب في نواكشوط » |

Toutes sont des captures iPhone réelles en arabe, 1170 × 2532. Prenez-les en
**portrait, sans arrondi ni cadre** : le gabarit fournit le châssis, l'encoche
et le reflet.

**Avant d'en publier une, regardez ce qu'elle contient.** Une capture d'app
embarque souvent un solde, un numéro, un nom de compte ou un identifiant de
transaction. Ce qui est normal dans l'app ne l'est pas forcément sur une
publication Facebook.

Si vous vous trompez de nom, `build.py` s'arrête et vous liste les noms
valides — il ne produit jamais une affiche à moitié juste.

---

## Contact et QR

```json
"contact": {
  "telephone": "33322777",
  "indicatif": "222",
  "lien_ios":     "https://apps.apple.com/app/aloo/id6782893228",
  "lien_android": "https://play.google.com/store/apps/details?id=mr.tewiz.app"
}
```

**Deux stores, deux QR**, chacun sous son badge — c'est le parti de la carte de
visite. Un QR unique aurait imposé un service de redirection : une dépendance
de plus, et un lien mort si le service ferme, sur un support déjà imprimé.

Les QR sont régénérés à chaque `build.py` : ils ne peuvent pas se désynchroniser
des liens. Pour les relire depuis les PNG exportés :

```bash
.venv/bin/pip install opencv-python-headless
```

**Scannez-les tout de même une fois avec un vrai téléphone avant toute
campagne** — un QR peut sortir net et faux.

---

---

## D'où vient chaque chose

Rien n'est redessiné à la main — c'est ce qui garde les affiches raccord avec
l'app.

| Élément | Source |
|---|---|
| Logo | `apps/mobile/assets/icon.png` |
| Badges stores | `apps/mobile/assets/stores/` |
| Couleurs | `apps/mobile/theme/palette.ts` — « Sahara Solaire », schéma clair |
| Polices | Sora + Cairo, depuis `node_modules/@expo-google-fonts/` |
| Captures | captures iPhone réelles de l'app en arabe |

Si la palette de l'app bouge, reportez les valeurs dans le bloc `:root` de
`brand.css` — c'est le seul endroit où elles sont écrites.

---

## Dépannage

**Les polices ne s'affichent pas / le QR est minuscule** — vous avez ouvert le
`.html` en `file://`. Chrome y bloque le chargement des polices et des images.
Passez par `./render.sh`, ou servez le dossier :

```bash
python3 -m http.server 4399 --directory ads
```

**`render.sh` ne trouve pas Chrome** — le chemin est en dur en haut du script.
Corrigez-le si Chrome est installé ailleurs.

**Il faut `segno`** pour générer les QR :

```bash
python3 -m venv .venv && .venv/bin/pip install segno
```

---

## Gabarit `scene` — quand l'image porte l'affiche

Les gabarits précédents montrent tous une capture d'app dans un téléphone.
`scene` change de genre : une route fuit vers l'horizon, une skyline de
Nouakchott se découpe dessus, une voiture roule au milieu. Pas de téléphone,
pas de puces — l'image dit tout, le titre se pose sur le ciel.

```json
{
  "fichier": "20-scene-nuit",
  "gabarit": "scene",
  "theme": "nuit",
  "scene": "horizon",
  "surtitre": "من نواكشوط، في أي وقت…",
  "titre": "الطريق *ما توقف*",
  "cta": "اطلب رحلتك الآن"
}
```

La clé `ecran` devient inutile ici, et `scene` s'exclut de `decor` : une scène
est déjà un fond.

### Comment la perspective est faite

Elle est **calculée**, pas dessinée à vue. Dans `scenes.py`, l'horizon est à
520 px et chaque tiret de la ligne médiane est un trapèze dont la position suit
`y = 520 + 560 × profondeur^2.35`. C'est l'exposant qui donne le tassement vers
le lointain ; dessinés à intervalles réguliers, les tirets aplatissent la route
et l'œil n'y entre pas.

La voiture obéit à la même règle : sa largeur se déduit de celle de la chaussée
à sa profondeur. La poser « à l'œil » la ferait flotter au-dessus du bitume.

### Ce que ça ne fait pas

Les rendus 3D, les photos de vraies voitures et les personnages des références
Pinterest ne sortent pas d'un SVG. Le gabarit `scene` en donne la **composition**
— fuite, profondeur, silhouette, feux — pas le photoréalisme. Pour aller plus
loin, il faut une vraie image détourée dans `assets/hero/` et la clé `visuel`.

---

## Le gabarit `fenetre` — la photo dans les lettres

```json
{
  "fichier": "F1-fenetre-aman",
  "gabarit": "fenetre",
  "theme": "nuit",
  "fond": "dune-famille",
  "surtitre": "كل رحلة، وكل عائلة…",
  "mot": "أمان",
  "taille_mot": 300,
  "detail": "كابتن موثّق، وتتبّع لحظة بلحظة، في كل رحلة.",
  "cta": "حمّل التطبيق"
}
```

Ici, `titre` ne sert pas : **le mot EST le titre**. Trois clés lui suffisent —
`mot`, `taille_mot`, et une `fond` qui fournit l'image découpée.

### Trois conditions, non négociables

1. **Un mot court.** Trois à cinq lettres. Au-delà, le corps tombe sous 200 px
   et l'image ne se lit plus dans les contours.
2. **Une photo plus claire que l'aplat.** Une image de nuit dans des lettres
   posées sur de l'espresso donne des lettres invisibles — il n'y a aucun
   contraste entre l'intérieur et l'extérieur du glyphe. Sur thème nuit,
   prendre une photo de plein jour ou de coucher de soleil.
3. **Une image lisible en petit.** Les meilleures sont celles qui ont un motif
   à leur échelle : l'échangeur vu du ciel marche parce qu'on y reconnaît des
   voitures même à travers une lettre.

`taille_mot` se règle à l'œil : 300 px pour trois lettres, 225 pour six,
420 pour deux en story.

---

## Le gabarit `carrousel` — plusieurs cartes, une seule image

Une entrée à `cartes` se déplie en autant d'affiches. Mises bout à bout dans le
fil Facebook, elles se rejoignent au pixel : le lecteur fait glisser et l'image
continue.

```json
{
  "fichier": "C1-carrousel",
  "gabarit": "carrousel",
  "theme": "nuit",
  "fond": "pano-nouakchott",
  "cartes": [
    { "surtitre": "نواكشوط، من الشمال إلى الجنوب…", "titre": "مدينة *واحدة*" },
    { "surtitre": "رحلات، طرود، مطاعم…",            "titre": "تطبيق *واحد*" },
    { "surtitre": "اسحب، واطلب من مكانك…", "titre": "Aloo *معك*", "cta": "حمّل التطبيق" }
  ]
}
```

Produit `C1-carrousel-1.png`, `-2`, `-3`. **Publiez-les dans cet ordre.**

### La photo doit être panoramique

Trois cartes exigent **3240 × 1080** ; quatre, 4320 × 1080. Une image carrée
étirée sur trois cartes serait floue. Pour en fabriquer une depuis une photo
large :

```python
from PIL import Image
im = Image.open("assets/_sources/ma-photo.jpg").convert("RGB")
W, H = im.size
h = W // 3                       # rapport 3:1
y = int(H * 0.34)                # la bande qu'on garde
im.crop((0, y, W, y + h)).resize((3240, 1080), Image.LANCZOS).save(
    "assets/photos/pano-xxx.jpg", quality=92)
```

### Ce que le gabarit décide tout seul

- **La marque n'apparaît que sur la première carte**, le bloc de téléchargement
  que sur la dernière. Les répéter alourdirait un format dont l'intérêt est
  justement la continuité.
- Un **compteur `1/3`** en haut : il dit au lecteur qu'il y a une suite.
- Toutes les cartes gardent la **même ligne de titre**, y compris celles qui
  portent une pastille — sinon la ligne de base saute d’une carte à
  l'autre et le fil cesse de se lire d'un trait.
