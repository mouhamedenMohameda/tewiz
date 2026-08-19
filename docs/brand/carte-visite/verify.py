#!/usr/bin/env python3
"""
Contrôle le PNG exporté : les QR imprimés correspondent-ils vraiment aux URLs ?

    ./verify.py

Pourquoi ce script existe : un QR peut sortir joli et faux. Rogné d'une
rangée, décalé d'un demi-module, mis à l'échelle avec un mauvais arrondi,
ou tout simplement généré depuis l'ancienne URL — rien de tout ça ne se voit
à l'œil, et ça ne se découvre qu'avec 500 cartes déjà imprimées.

On relit donc le PNG final, on localise chaque symbole, on ré-échantillonne
sa grille et on la compare module par module à la matrice que segno produit
pour l'URL attendue. On vérifie aussi la taille physique du module.

Dépendances : segno, pillow.
"""

from __future__ import annotations

import sys
from pathlib import Path

import segno
from PIL import Image

HERE = Path(__file__).resolve().parent

# Doit rester aligné avec CARTE dans build.py.
from build import CARTE, MODULE_MIN_MM  # noqa: E402

PNG = HERE / "carte-visite-verso.png"
CARD_W_MM = 91.0  # largeur du PNG, fond perdu compris
SEUIL = 128  # au-delà, le pixel est « clair »

# Fenêtres de recherche (mm, repère PNG) : assez larges pour tolérer un
# redécoupage de la maquette, assez serrées pour ne contenir qu'un seul QR.
FENETRES = [
    ("iOS", CARTE["url_ios"], 46.0, 66.0, 33.0, 54.0),
    ("Android", CARTE["url_android"], 66.0, 86.0, 33.0, 54.0),
]


def dark_bbox(img, x0, y0, x1, y1):
    """Boîte englobante des pixels sombres d'une fenêtre. None si vide."""
    xs_min = ys_min = 10**9
    xs_max = ys_max = -1
    for y in range(int(y0), int(y1)):
        for x in range(int(x0), int(x1)):
            if img.getpixel((x, y)) < SEUIL:
                if x < xs_min:
                    xs_min = x
                if x > xs_max:
                    xs_max = x
                if y < ys_min:
                    ys_min = y
                if y > ys_max:
                    ys_max = y
    if xs_max < 0:
        return None
    return xs_min, ys_min, xs_max, ys_max


def main() -> int:
    if not PNG.exists():
        print(f"{PNG.name} manquant — lance ./export.sh d'abord", file=sys.stderr)
        return 1

    img = Image.open(PNG).convert("L")
    ppmm = img.size[0] / CARD_W_MM

    echecs = 0
    for label, url, xa, xb, ya, yb in FENETRES:
        attendu = segno.make(url, error="m").matrix
        n = len(attendu)

        box = dark_bbox(img, xa * ppmm, ya * ppmm, xb * ppmm, yb * ppmm)
        if box is None:
            print(f"{label:8} AUCUN symbole trouvé dans la fenêtre")
            echecs += 1
            continue
        bx0, by0, bx1, by1 = box

        # Les trois repères d'angle occupent les bords gauche, haut, droit et
        # bas du symbole : la boîte des pixels sombres EST le symbole, ce qui
        # donne l'échelle sans rien présumer de la mise en page.
        larg = bx1 - bx0 + 1
        haut = by1 - by0 + 1
        mod_px = larg / n
        mod_mm = mod_px / ppmm

        faux = 0
        for r in range(n):
            for c in range(n):
                px = bx0 + (c + 0.5) * (larg / n)
                py = by0 + (r + 0.5) * (haut / n)
                lu = 1 if img.getpixel((round(px), round(py))) < SEUIL else 0
                if lu != attendu[r][c]:
                    faux += 1

        ok_grille = faux == 0
        ok_taille = mod_mm >= MODULE_MIN_MM - 1e-9
        if not (ok_grille and ok_taille):
            echecs += 1

        print(
            f"{label:8} {n}x{n}  {larg}x{haut} px  module {mod_mm:.3f} mm  "
            f"[{'grille OK' if ok_grille else f'{faux} modules FAUX'}] "
            f"[{'taille OK' if ok_taille else 'TROP DENSE'}]"
        )
        print(f"         -> {url}")

    if echecs:
        print(f"\n{echecs} QR non conforme(s) — NE PAS IMPRIMER.", file=sys.stderr)
        return 1
    print("\nLes deux QR sont conformes aux URLs et imprimables.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
