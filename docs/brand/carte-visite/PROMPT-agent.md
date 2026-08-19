# Prompt à donner à un agent IA — carte de visite Aloo

Ce fichier contient un prompt autonome : il embarque toutes les données de
marque extraites du code (palette, polices, logo, slogans, identifiants store),
pour qu'un agent qui n'a pas accès au dépôt puisse produire la carte.

**Avant de l'envoyer**, remplace les 4 valeurs de la section « À REMPLIR ».

---

Tu es directeur artistique et tu maîtrises la préparation de fichiers pour
l'impression. Produis-moi une carte de visite recto/verso, prête pour
l'imprimeur.

## Livrables attendus

1. `carte-recto.png` — 300 dpi
2. `carte-verso.png` — 300 dpi
3. `carte-print.pdf` — 2 pages (recto puis verso), **vectoriel**, c'est le
   fichier qui part chez l'imprimeur

Méthode libre (HTML+CSS rendu en PDF par un navigateur headless, SVG, ou un
outil de mise en page), mais le PDF doit rester vectoriel : pas une image
collée dans une page.

## Format et contraintes d'impression — non négociables

- Coupe **85 × 55 mm**
- **Fond perdu 3 mm** sur chaque bord → page de **91 × 61 mm**
- **Marge de sécurité 4 mm** depuis la coupe : aucun texte ni QR à moins de
  7 mm du bord de la page
- Les aplats de couleur doivent aller jusqu'au bord de la page (dans le fond
  perdu), jamais s'arrêter à la ligne de coupe
- Rien ne doit déborder de la page : vérifie qu'aucun bloc n'est tronqué

Attention au piège classique : une bande décorative de 2 mm posée dans un fond
perdu de 3 mm disparaît entièrement au massicot. Toute bande de bord doit faire
`3 mm + la largeur qu'on veut voir après coupe`.

## La marque

**Nom** : Aloo (en arabe : ألو)
**Positionnement** : l'app de course (VTC) mauritanienne, à Nouakchott
**Slogan FR** : Parle. On t'amène.
**Slogan AR** : احكي... ونوصّلوك
**Promesses** : on commande **à la voix**, on paie **en cash**, **première
course offerte**

### Palette (design system « Sahara Solaire »)

| Rôle | Hex |
|---|---|
| Ember — orange de marque, accents et CTA | `#F2682C` |
| Espresso — fond sombre | `#2A1A0E` |
| Sable — fond clair | `#FBF3E7` |
| Blanc chaud — cartons/encarts | `#FFFCF6` |
| Encre — texte sur fond clair | `#2C1D10` |
| Encre secondaire | `#6B5740` |
| Texte tertiaire / labels | `#9C886E` |
| Filet, hairline | `#E1CFB2` |
| Texte sur espresso | `#FBEFDD` |
| Texte discret sur espresso | `#C9B49A` |

Règle : **l'orange est un accent, jamais un fond plein**. En aplat sur 85 mm il
vire au rouge brique et devient agressif.

### Typographie

- **Sora** pour le latin (Google Fonts) — 400 / 600 / 700 / 800
- **Cairo** pour l'arabe (Google Fonts) — Sora n'a aucun glyphe arabe, donc
  toute chaîne arabe doit être en Cairo, avec `direction: rtl`

### Logo

Monogramme « A » : trois traits arrondis, à reproduire exactement.

```svg
<svg viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <g fill="none" stroke="COULEUR" stroke-width="43"
     stroke-linecap="round" stroke-linejoin="round">
    <path d="M150 380 L256 143"/>
    <path d="M362 380 L256 143"/>
    <path d="M194 298 L318 298"/>
  </g>
</svg>
```

Sur le recto, place-le dans une tuile carrée à coins arrondis (rayon ≈ 22 % du
côté) remplie en ember, monogramme en sable — c'est l'icône de l'app, celle que
les gens chercheront dans le store après avoir scanné.

## À REMPLIR avant d'envoyer ce prompt

- Nom : `PRÉNOM NOM`
- Fonction : `Fondateur & Directeur Général` — en arabe : `المؤسس والمدير العام`
- Téléphone / WhatsApp : `+222 00 00 00 00`
- E-mail : `prenom@aloo.mr`
- Site : `aloo.mr`

Si téléphone et WhatsApp sont le même numéro, ne l'écris **qu'une fois**,
annoté « · WhatsApp ». Répéter le même numéro sur une carte qui en compte six
lignes, c'est du bruit.

## Contenu — recto

Fond espresso plein bord à bord. Bloc centré :

1. La tuile ember avec le monogramme (≈ 15 mm de côté)
2. « Aloo » en Sora 800, gros, en sable
3. Un court filet ember horizontal
4. « Parle. On t'amène. » en Sora 600, en `#C9B49A`
5. « احكي... ونوصّلوك » en Cairo, légèrement plus discret

Une bande ember en fond perdu sur le bord **droit** (3 mm de fond perdu +
2,5 mm visibles). Décale le bloc centré pour qu'il reste optiquement centré
dans la zone lisible restante.

## Contenu — verso

Fond sable. Bande ember en fond perdu sur le bord **gauche**, même largeur :
carte retournée, c'est le même bord physique qui reste orange.

De haut en bas :

1. Monogramme ember (petit) + « Aloo » + un point séparateur + « L'APP DE
   COURSE MAURITANIENNE » en petites capitales, `#9C886E`
2. Le nom, en Sora 700
3. La fonction en français (en ember) suivie de la fonction en arabe (Cairo,
   `#9C886E`), sur la même ligne
4. Le téléphone en gros et gras — c'est la ligne la plus lue de la carte —
   puis e-mail et site sur une ligne discrète
5. Un filet hairline `#E1CFB2`
6. En bas, deux colonnes :
   - **à gauche**, l'invitation : « Scanne, télécharge, demande ta course. »
     puis « **La première est offerte.** » en ember
   - **à droite**, les deux QR côte à côte, avec sous chacun un label court :
     « iPhone » et « Android »

## Les deux QR — la partie où tout se joue

- **iPhone** → `https://apps.apple.com/app/idAPP_STORE_ID`
  ⚠️ Je n'ai pas encore l'App Store ID numérique (il n'existe qu'une fois
  l'app créée dans App Store Connect). Utilise un gabarit visible et
  signale-moi noir sur blanc que ce QR ne mène nulle part tant qu'il n'est pas
  remplacé.
- **Android** → `https://play.google.com/store/apps/details?id=mr.tewiz.app`
  (lien réel, valide dès la publication)

Contraintes techniques, à respecter à la lettre :

- **Correction d'erreur : M (15 %).** Ne monte pas en Q ou H « pour plus de
  sécurité » : à surface constante, une correction plus forte ajoute des
  modules et donc les **rétrécit**. Sur une carte de visite, la contrainte est
  la place, pas la saleté — monter la correction dégrade la lisibilité.
- **Taille de module ≥ 0,40 mm.** En dessous, l'engraissement du point à
  l'impression ferme les blancs et le symbole meurt sur le papier, alors qu'il
  reste parfait à l'écran. L'URL Play Store fait 33 modules : il lui faut donc
  au moins **13,2 mm de symbole**, soit un cadre d'environ 16 mm avec sa marge.
- **Zone de silence** : ≈ 3 à 4 modules de blanc autour du symbole. Sans elle,
  le scanner ne délimite pas le code.
- Si tu encadres le QR, attention au modèle de boîte : avec `box-sizing:
  border-box`, une bordure se prélève **sur le symbole** et réduit
  silencieusement la taille de module. Vérifie la taille réelle du symbole
  rendu, pas celle du conteneur.
- QR en vectoriel, en `#2A1A0E` sur fond clair (jamais d'orange : le contraste
  est insuffisant pour beaucoup de scanners).

## Vérifications à faire avant de me livrer

Ne me dis pas que c'est prêt sans avoir contrôlé, et montre-moi les résultats :

1. **Débordement** : aucun élément ne dépasse de la page, et tout le contenu
   lisible est à ≥ 7 mm du bord de la page (= 4 mm de la coupe). Donne-moi les
   distances mesurées.
2. **QR conformes** : relis le **PNG exporté** (pas ton fichier source),
   localise chaque symbole, ré-échantillonne sa grille et compare-la module par
   module à la matrice attendue pour l'URL. Un QR peut sortir joli et faux :
   rogné d'une rangée, décalé d'un demi-module, ou généré depuis la mauvaise
   URL — rien de tout ça ne se voit à l'œil.
3. **Taille de module réelle**, mesurée sur le PNG exporté, pour les deux QR.
4. **Dimensions du PNG** : à 300 dpi, 91 × 61 mm donne 1075 × 721 px.
5. Les polices sont bien rendues en Sora et Cairo, pas en police système de
   remplacement — l'arabe est le piège habituel.

## Ce que j'attends en plus des fichiers

- La liste des valeurs qu'il me reste à remplir avant impression
- Les recommandations papier et couleur pour l'imprimeur
- Un moyen de régénérer la carte quand j'aurai l'App Store ID, sans tout
  refaire à la main

## Suggestion, à me proposer et non à décider seul

Les URLs de stores sont longues, donc les QR sont denses. Si mon domaine est en
service, deux redirections courtes (`aloo.mr/ios`, `aloo.mr/android`)
donneraient des QR bien plus aérés et des clics mesurables. Signale-le-moi, mais
livre d'abord une version qui fonctionne avec les URLs brutes, sans dépendre
d'infrastructure que je n'ai peut-être pas.
