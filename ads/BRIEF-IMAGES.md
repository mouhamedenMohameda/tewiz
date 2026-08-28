# Aloo — ce qu'il faut rapporter comme images

Le circuit est prêt et testé : deux mires de calibrage (`assets/hero/mire.png`
et `assets/photos/mire.jpg`) ont servi à vérifier le cadrage exact. Il ne
manque plus que de vraies images.

Deux emplacements, deux usages différents. **Ne les confondez pas** — une photo
de fond mise en visuel détouré ressortira avec un rectangle blanc autour.

---

## 1. Visuel détouré — `assets/hero/`

**C'est la priorité.** C'est ce qui manque pour ressembler aux publicités Bolt
ou Careem : un objet net, découpé, posé en bas de l'affiche, le titre au-dessus.

| Spécification | Valeur |
|---|---|
| Format | **PNG à fond transparent** (pas JPG — le JPG ne gère pas la transparence) |
| Taille | **2400 × 1400 px minimum**. En dessous ça pixellise : l'affiche sort en 2160 px et le visuel occupe 900 px de large en 1× donc 1800 px en 2×. |
| Proportion | entre 16:9 et 2:1, paysage |
| Détourage | **propre, au pixel** — pas de halo blanc ni de bord baveux autour des roues et du pare-brise |
| Ombre | **aucune ombre incrustée**. Le gabarit en ajoute une, calée sur la lumière de la charte. Une ombre déjà dans l'image en fera deux. |
| Lumière | venant du **haut-gauche**, comme partout ailleurs dans l'identité |

### Les prises de vue à rapporter, par ordre d'utilité

1. **Une berline blanche ou grise, 3/4 avant, roues droites.** C'est LA photo
   qui manque. Une Corolla, une Accent, une Sunny — le modèle que vos clients
   voient réellement passer à Nouakchott. Pas de coupé sport : le message
   « devenez chauffeur » ne marche pas avec une voiture que personne ne conduit
   en taxi.
2. **La même voiture de 3/4 arrière**, pour varier les affiches sans refaire
   une séance.
3. **Un chauffeur debout à côté de sa portière ouverte**, en pied, souriant.
   Sert les affiches de recrutement.
4. **Une main tenant un téléphone**, cadrée poignet compris.

### Comment photographier vous-même

C'est faisable au téléphone, et ça vaudra mieux que n'importe quel stock :

- **Fond uni et clair** : un mur blanc, ou le sable en plein soleil. Plus le
  fond est uni, plus le détourage sera propre.
- **Tôt le matin ou en fin d'après-midi.** Le soleil de midi écrase les formes
  et creuse des ombres noires sous la voiture.
- **Reculez et zoomez** plutôt que de vous approcher : ça évite de déformer
  l'avant de la voiture.
- **Photographiez à hauteur de phare**, pas debout. Vue de haut, une voiture
  paraît petite et tassée.
- Le détourage se fait ensuite — l'outil « supprimer l'arrière-plan » de
  Photos, Canva ou Preview suffit pour une forme aussi nette qu'une voiture.

---

## 2. Photo de fond — `assets/photos/`

Une image qui remplit toute l'affiche, sur laquelle le titre se pose. Le
gabarit applique automatiquement un voile dégradé, sinon aucun texte ne tiendrait.

| Spécification | Valeur |
|---|---|
| Format | JPG, PNG ou WebP |
| Taille | **2400 × 2400 px minimum** |
| Proportion | **carrée de préférence.** Une image carrée entre sans recadrage — vérifié à la mire. Une image paysage sera rognée sur les côtés, et ce qui est au bord disparaîtra. |
| Composition | **laissez du vide à droite** — c'est là que le titre se pose, la lecture étant en arabe |
| Netteté | pas de flou de bougé ; le voile assombrit, il ne rattrape pas une photo floue |

### Les scènes à rapporter

1. **Une avenue de Nouakchott en fin de journée**, lumière chaude, circulation.
   La scène qui dit « ici », pas « une ville quelconque ».
2. **L'intérieur d'un taxi vu de la banquette arrière**, pare-brise et route
   devant. Cadre le mieux les affiches « sécurité » et « suivi de course ».
3. **Un chauffeur au volant, de profil**, détendu.
4. **Une passagère consultant son téléphone à l'arrière.**
5. **Un plat mauritanien ou une devanture de restaurant**, pour les affiches
   livraison.

---

## 3. Droits d'utilisation — à lire avant de télécharger quoi que ce soit

Une publicité Facebook est une **utilisation commerciale**. Une image trouvée
sur Google, Pinterest ou un site de photos n'est pas libre parce qu'elle est
visible.

- **Le plus sûr : vos propres photos.** Vous en détenez les droits, et elles
  montrent Nouakchott plutôt qu'une ville générique.
- Si vous passez par une banque d'images, prenez une **licence commerciale**
  explicite et gardez la facture.
- **Une personne reconnaissable exige son accord écrit** pour figurer dans une
  publicité — chauffeur, passagère, client. Un simple message WhatsApp
  « j'accepte que ma photo serve dans les publicités Aloo » suffit à condition
  de le conserver.
- Ne photographiez pas de plaque d'immatriculation lisible, ou floutez-la.

---

## 4. Une fois les fichiers en main

Déposez-les, nommez-les simplement, sans espaces ni accents :

```
assets/hero/voiture-avant.png      -> "visuel": "voiture-avant"
assets/photos/avenue-nuit.jpg      -> "fond":   "avenue-nuit"
```

Puis dans `posters.json` :

```json
{
  "fichier": "30-voiture",
  "gabarit": "bande",
  "theme": "nuit",
  "fond": "avenue-nuit",
  "visuel": "voiture-avant",
  "sans_telephone": true,
  "surtitre": "من نواكشوط، في أي وقت…",
  "titre": "الطريق *ما توقف*",
  "cta": "اطلب رحلتك الآن"
}
```

| Clé | Effet |
|---|---|
| `fond` | photo plein cadre + voile automatique |
| `visuel` | objet détouré, posé en bas au centre |
| `sans_telephone` | `true` efface le téléphone pour laisser la place au visuel |

Si un nom est faux, `build.py` s'arrête et liste les fichiers disponibles.

---

## 5. Vérifier un cadrage sans vraie image

Les deux mires servent à ça. Elles ont des bords colorés — rouge en haut, vert
en bas, jaune à gauche, bleu à droite — et des repères aux coins. Si une
couleur de bord disparaît à l'écran, c'est que l'image est rognée de ce côté.

```json
{ "fond": "mire", "visuel": "mire", "…": "…" }
```


---

## Journal des images intégrées

| Fichier | Source | Traitement |
|---|---|---|
| `photos/nouakchott.jpg` | Pexels 33952951 — 8064 × 4536 | recadrée carré 2600 |
| `photos/corolla-plage.jpg` | Pexels 37620310 — 4032 × 3024 | cadrée par la droite (l'avant restait entier), **plaque floutée** |
| `photos/corolla-rivage.jpg` | Pexels 37620309 — 3024 × 4032 | cadrée haut pour dégager le ciel |
| `hero/voiture-blanche.png` | Pexels 11320433 — 14173 × 14173 | détourée, ombre et halo supprimés |

Les originaux non modifiés sont dans `assets/_sources/`. **Gardez-les** : c'est
votre trace si l'origine d'une image est un jour contestée.

**La Corolla est un modèle E140 (2008-2013)** — la génération la plus répandue
en taxi à Nouakchott, ce qui rend l'affiche crédible pour vos chauffeurs.

| `photos/echangeur.jpg` | Pexels 7381786 — Abidjan, 4000 × 3000 | recadrée carré 2600 |
| `photos/assistance.jpg` | Pexels 5056745 — 5472 × 3648 | cadrée à droite pour garder le triangle |
| `photos/sieges.jpg` | Pexels 16495991 — 4912 × 3264 | recadrée carré 2600 |
| `photos/route-nuit.jpg` | Pexels 792815 — 5015 × 3343 | recadrée carré 2600 |

Aucune de ces quatre ne montre de personne identifiable — c'est le filtre que
j'applique par défaut, Pexels ne fournissant pas d'autorisation des modèles.
