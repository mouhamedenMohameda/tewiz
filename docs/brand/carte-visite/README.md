# Carte de visite dirigeant — Aloo

Carte recto/verso qui sert d'abord à faire télécharger l'app : le verso porte
les deux QR (App Store et Play Store), l'invitation, et les coordonnées.

## Livrables

| Fichier | Pour qui |
|---|---|
| `carte-visite-print.pdf` | L'imprimeur. 2 pages (recto, verso), 91 × 61 mm, **vectoriel**. |
| `carte-visite-recto.png` | Écran, WhatsApp, validation. 1075 × 721 px, 300 dpi. |
| `carte-visite-verso.png` | idem. |

C'est le **PDF** qu'on envoie à l'imprimeur, pas les PNG : il reste vectoriel,
donc le texte et les QR s'impriment en contours nets quelle que soit la
linéature de la machine. Les PNG sont des pixels — parfaits pour montrer la
carte, mauvais pour la produire.

## Spécifications d'impression

- **Coupe** 85 × 55 mm · **fond perdu** 3 mm sur chaque bord (page 91 × 61 mm)
- **Marge de sécurité** 4 mm depuis la coupe — aucun élément lisible en deçà
- **Papier** 350 g, pelliculage soft-touch mat
- **Finition** vernis sélectif sur le monogramme du recto (facultatif, c'est
  lui qui fait la différence au toucher)
- **Couleurs** : l'ember `#F2682C` sort terne en quadri. Demander un ton direct
  **Pantone 165 C** si le budget le permet. L'espresso `#2A1A0E` doit être tiré
  en noir riche (`C60 M50 J50 N100`), sinon il grisonne.

Palette et polices reprises telles quelles du design system de l'app
(`apps/mobile/theme/palette.ts`, Sora + Cairo). Les TTF sont embarqués en
base64 dans le HTML : rien à installer chez l'imprimeur.

## Régénérer

Tout se configure dans le bloc `CARTE` en haut de `build.py` — nom, fonction,
téléphone, e-mail, et les deux URLs de téléchargement.

```bash
python3 -m venv .venv && .venv/bin/pip install segno pillow
.venv/bin/python build.py      # HTML + QR
./export.sh                    # PDF + PNG (Chrome + poppler)
.venv/bin/python verify.py     # contrôle des QR
```

`verify.py` relit le PNG exporté, retrouve chaque QR, et compare sa grille
module par module à celle attendue pour l'URL. Un QR peut sortir joli et faux :
rogné, décalé, ou généré depuis une ancienne URL. **À lancer avant chaque envoi
à l'imprimeur.**

## Avant d'imprimer

1. **Renseigner l'App Store ID.** `url_ios` vaut encore
   `id0000000000` : le QR iPhone ne mène nulle part. L'ID n'existe qu'une fois
   l'app créée dans App Store Connect. `build.py` refuse de tourner tant que le
   gabarit est là (utiliser `--force` uniquement pour une maquette de
   validation).
2. **Remplir nom, fonction, téléphone, e-mail** dans `CARTE`.
3. **Lancer `verify.py`** et vérifier que les deux QR passent.
4. **Imprimer une carte à l'unité et la scanner** avec un iPhone et un Android
   avant de lancer le tirage. C'est le seul test qui compte vraiment.

## Note sur les QR

Les URLs des stores sont longues, et une URL longue produit des modules plus
petits à surface égale. À 16 mm de côté, le QR Play Store tient à 0,408 mm par
module — au-dessus du seuil d'impression (0,40 mm), mais sans marge.

Si `aloo.mr` est en service, deux redirections `aloo.mr/ios` et
`aloo.mr/android` valent mieux : modules à 0,52 mm, QR plus aéré, et les clics
deviennent mesurables. Il suffit alors de changer les deux URLs dans `CARTE` et
de relancer le build.
