#!/usr/bin/env bash
# Repasse toutes les photos par teinte.py en thème jour.
# La table dit, pour chaque image utilisée par les affiches : sa source, son
# cadrage, et les réglages particuliers qu'elle demande.
set -e
P=".venv/bin/python"

#        sortie              source                 options
$P teinte.py triangle-route.jpg    assistance.jpg     --theme jour --bande 0.34
$P teinte.py cles.jpg              cles.jpg           --theme jour
# --bande retiré : il était inerte sur un carré avant le correctif de
# teinte.py. L'activer recadrerait cette photo (5,89 -> 2,06 sur la bande
# du titre) et changerait une affiche déjà diffusée. Recadrage à revoir
# volontairement si besoin, pas par effet de bord.
$P teinte.py route-longue.jpg      convoyage.jpg      --theme jour
$P teinte.py corolla-plage.jpg     corolla-plage.jpg  --theme jour
$P teinte.py corolla-rivage.jpg    corolla-rivage.jpg --theme jour
$P teinte.py dune-famille.jpg      dune-famille.jpg   --theme jour
$P teinte.py echangeur-abidjan.jpg echangeur.jpg      --theme jour
$P teinte.py camion-desert.jpg     fret.jpg           --theme jour
$P teinte.py vue-passager.jpg      kabten-khass.jpg   --theme jour --bande 0.10
$P teinte.py nouakchott-brut.jpg   nouakchott.jpg     --theme jour
$P teinte.py route-nuit.jpg        route-nuit.jpg     --theme jour
$P teinte.py interieur-voiture.jpg sieges.jpg         --theme jour
$P teinte.py volant-toyota.jpg     volant.jpg         --theme jour
# le jaune du taxi est le sujet : teinte dosée, et miroir pour dégager le titre
$P teinte.py taxis-jaunes.jpg      taxis.jpg          --theme jour --melange 78 --miroir --bande 0.42
# la couleur du plat EST le message (appétence) : teinte dosée comme les taxis
$P teinte.py plat-riz-poisson.jpg   plat-riz-poisson.jpg --theme jour --melange 78

# berline pour le recrutement : bandeau editorial, d'où --pano 2 (paysage)
# la blancheur de la berline EST le message (recrutement) : teinte dosée,
# sinon la carrosserie vire à l'ember et ce n'est plus une berline blanche
$P teinte.py berline-blanche.jpg    berline-blanche.jpg  --theme jour --pano 2 --bande 0.11 --melange 40

$P teinte.py sieges-libres.jpg      sieges-libres.jpg    --theme jour

# le rouge du triangle EST le signal : teinte dosée à 55 (à 85 il ne reste
# plus de rouge du tout). --bande 0.2 sert seulement à garder le triangle
# entier dans le cadre : il occupe 0,15-0,88 de la hauteur, donc aucun
# recadrage ne le sort de la zone du titre. C'est le voile qui fait le
# contraste ici, pas le cadrage.
$P teinte.py triangle-detresse.jpg  triangle-detresse.jpg --theme jour --bande 0.2 --melange 55

# panoramas
$P teinte.py avenue-palmiers.jpg   pano-avenue.jpg    --theme jour --pano 3 --bande 0.18
$P teinte.py route-horizon.jpg     pano-route.jpg     --theme jour --pano 3 --bande 0.30
