# Phrases prêtes à copier

Chaque bloc se colle tel quel dans une nouvelle session.

La structure est toujours la même :
1. `Lis ads/PASSATION.md.` — charge tout le contexte
2. Ce que vous voulez, avec **cherche** (photo Pexels), **dessine** (SVG) ou
   **change** (texte seul)
3. La ligne finale — elle évite de brûler des tokens à ouvrir chaque image

---

## 1. Recrutement de chauffeurs

```
Lis ads/PASSATION.md.

Fais-moi une affiche pour recruter des chauffeurs.
Cherche sur Pexels une photo claire de berline blanche ou grise, sans visage.
Gabarit : editorial. Titre en arabe littéraire.

Rends par lot et vérifie le contraste par script, ne regarde pas chaque image.
```

## 2. Commande vocale

```
Lis ads/PASSATION.md.

Fais-moi une affiche sur la commande vocale — on dit sa destination, la voiture vient.
Utilise la capture accueil, gabarit bande, avec le téléphone incliné.
Titre en arabe littéraire, court et frappant.

Rends par lot et vérifie le contraste par script, ne regarde pas chaque image.
```

## 3. Commande par WhatsApp

```
Lis ads/PASSATION.md.

Fais-moi une affiche : commander sans installer l'application, par WhatsApp.
Gabarit : centre, capture accueil, deux puces dont une avec l'icône whatsapp en vert.
Titre en arabe littéraire.

Rends par lot et vérifie le contraste par script, ne regarde pas chaque image.
```

## 4. ارفدني — le covoiturage

```
Lis ads/PASSATION.md.

Fais-moi une affiche pour ارفدني, le partage de trajet, prix au siège.
Cherche sur Pexels une photo claire d'intérieur de voiture avec sièges libres, sans visage.
Gabarit : affiche, avec une ligne de conditions.
Reprends les libellés de l'app, pas des promesses inventées.

Rends par lot et vérifie le contraste par script, ne regarde pas chaque image.
```

## 5. Assistance sur la route

```
Lis ads/PASSATION.md.

Fais-moi une affiche pour المساعدة على الطريق.
Cherche sur Pexels une photo claire de voiture en panne ou de triangle de détresse, sans visage.
Gabarit : affiche. Dis que le prix est connu avant de confirmer.

Rends par lot et vérifie le contraste par script, ne regarde pas chaque image.
```

## 6. L'offre commission ÷2 — en story

```
Lis ads/PASSATION.md.

Fais-moi une story 9:16 pour l'offre chauffeurs : 500 MRU en 8 jours, commission divisée par deux.
Format : story. Gabarit : affiche, avec un badge ÷2.
Ne dis que l'essentiel, rien de plus.

Rends par lot et vérifie le contraste par script, ne regarde pas chaque image.
```

## 7. Un carrousel sur toute la ville

```
Lis ads/PASSATION.md.

Fais-moi un carrousel de 3 cartes sur le thème « une ville, une application ».
Cherche sur Pexels une photo large et claire d'avenue vue du ciel avec des voitures.
Fabrique le panorama 3240×1080 avec teinte.py, puis vérifie les coutures.

Rends par lot et vérifie le contraste par script, ne regarde pas chaque image.
```

## 8. Un texte-fenêtre

```
Lis ads/PASSATION.md.

Fais-moi une affiche gabarit fenetre avec le mot سرعة.
Cherche sur Pexels une photo contrastée de route ou de circulation.
Rappel : en thème jour, la photo doit faire la partie SOMBRE du glyphe.

Rends par lot et vérifie le contraste par script, ne regarde pas chaque image.
```

## 9. Une scène dessinée, sans photo

```
Lis ads/PASSATION.md.

Dessine dans scenes.py une scène « avenue de Nouakchott au crépuscule, deux voitures ».
Reste dans la palette, contraste bon par construction.
Fais-en une affiche avec le gabarit scene.

Rends par lot et vérifie le contraste par script, ne regarde pas chaque image.
```

## 10. Corriger un texte existant

```
Lis ads/PASSATION.md.

Change le titre de 05-restaurants en : الطعام *في دقائق*
Ne touche à rien d'autre.

Reconstruis et renvoie-moi seulement ce PNG.
```

---

## Les trois verbes

| Verbe | Ce qu'il obtient |
|---|---|
| **cherche** | une vraie photo, prise sur Pexels, teintée aux couleurs de la marque |
| **dessine** | un visuel tracé en SVG — pas de licence, pas de visage |
| **change** | uniquement du texte dans `posters.json` |

**Ne dites jamais « génère ».** Aucune session ne peut produire une
photographie ni un rendu 3D. Ce mot ne mène qu'à un refus.

---

## Précisions qui font gagner un aller-retour

Ajoutez-les quand elles comptent :

- `sans visage` — Pexels ne fournit aucune autorisation des personnes
- `photo claire` — le thème jour a besoin de lumière
- `format : story` — sinon c'est carré par défaut
- `reprends les libellés de l'app` — évite les promesses inventées
- `arabe littéraire` — jamais de darija
- `renvoie-moi seulement ce PNG` — pour une simple correction
