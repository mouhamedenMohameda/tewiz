#!/usr/bin/env python3
"""
Aloo — mise aux couleurs de la marque.

Une photo de banque d'images arrive avec ses couleurs à elle. Posée telle
quelle sous un titre, elle fait deux dégâts : elle concurrence l'ember et elle
rend le texte illisible là où elle est claire.

Le remède n'est pas d'assombrir davantage — un voile épais tue la photo. C'est
de la REMAPPER : on la réduit en niveaux de gris, puis on rejoue ces gris entre
deux teintes de la charte. L'image garde sa matière et sa lumière, mais elle
n'a plus qu'une seule famille de couleurs — la vôtre.

    python3 teinte.py source.jpg sortie.jpg --pano
"""

import argparse
import sys
from pathlib import Path

from PIL import Image, ImageEnhance, ImageOps

Image.MAX_IMAGE_PIXELS = 260_000_000

HERE = Path(__file__).parent

# Bornes du remappage, prises dans « Sahara Solaire ».
#
# Le thème jour est un TRITONE, pas un duotone : ombres espresso, médiums
# ember, hautes lumières sable. Un duotone à deux bornes brunes donnait un
# sépia mou, sans rapport avec la marque ; en plaçant l'ember au milieu, la
# couleur de l'application se retrouve là où une photo a le plus de matière.
NUIT = ("#100A04", "#C08A52", None)
JOUR = ("#2C1D10", "#FBF3E7", "#C4661F")


def luminance(rgb: tuple[int, int, int]) -> float:
    """Luminance relative WCAG, pour mesurer un contraste."""
    def canal(v: float) -> float:
        v /= 255
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = (canal(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contraste(a: tuple[int, int, int], b: tuple[int, int, int]) -> float:
    la, lb = luminance(a), luminance(b)
    if la < lb:
        la, lb = lb, la
    return (la + 0.05) / (lb + 0.05)


def teinter(im: Image.Image, bas: str, haut: str, mid: str | None = None,
            force: float = 1.12, melange: int = 100) -> Image.Image:
    """Remappe l'image entre deux teintes de la charte.

    `melange` dose l'effet. À 100 l'image n'a plus qu'une famille de couleurs —
    c'est ce qu'il faut pour un paysage quelconque. Mais quand une couleur EST
    le message (des taxis jaunes, une enseigne), la teinte intégrale l'efface :
    on descend alors vers 50-60, ce qui suffit à chasser les dominantes vertes
    ou bleues sans tuer le sujet.
    """
    gris = ImageOps.grayscale(im)
    gris = ImageEnhance.Contrast(gris).enhance(force)
    duo = (ImageOps.colorize(gris, black=bas, white=haut, mid=mid,
                             blackpoint=0, midpoint=118, whitepoint=255)
           if mid else ImageOps.colorize(gris, black=bas, white=haut))
    if melange >= 100:
        return duo
    return Image.blend(im, duo, melange / 100)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("source")
    ap.add_argument("sortie")
    ap.add_argument("--theme", choices=("nuit", "jour"), default="nuit")
    ap.add_argument("--pano", type=int, metavar="N",
                    help="recadre en panorama de N cartes (N × 1080 × 1080)")
    ap.add_argument("--carre", type=int, default=2600, metavar="PX",
                    help="côté du carré si --pano n'est pas donné")
    ap.add_argument("--bande", type=float, default=None, metavar="Y",
                    help="position verticale de la bande gardée, 0 = haut. "
                         "Sans --pano, décale aussi le carré : par défaut il "
                         "est centré, ce qui pose le titre au milieu du sujet.")
    ap.add_argument("--melange", type=int, default=100, metavar="PCT",
                    help="dose de teinte, 0 = photo d'origine, 100 = duotone plein")
    ap.add_argument("--miroir", action="store_true",
                    help="retourne l'image horizontalement — la page étant en RTL, "
                         "le texte se pose à droite : un sujet placé à droite dans "
                         "la photo se retrouve sous le titre. Le miroir le renvoie "
                         "à gauche. À n'utiliser que sur une image sans texte ni "
                         "signalétique lisible, qu'il inverserait.")
    args = ap.parse_args()

    src = Path(args.source)
    if not src.exists():
        src = HERE / "assets" / "_sources" / args.source
    if not src.exists():
        sys.exit(f"  ✗ source introuvable : {args.source}")

    im = Image.open(src).convert("RGB")
    if args.miroir:
        im = ImageOps.mirror(im)
    W, H = im.size

    if args.pano:
        rapport = args.pano                      # N cartes carrées => N:1
        h = min(H, int(W / rapport))
        bande = 0.34 if args.bande is None else args.bande
        y = max(0, min(int(H * bande), H - h))
        im = im.crop((0, y, W, y + h)).resize((args.pano * 1080, 1080), Image.LANCZOS)
    else:
        c = min(W, H)
        x = (W - c) // 2
        # --bande vaut aussi pour le carré : sur une source en hauteur, le carré
        # centré pose le titre en plein milieu du sujet. Le décaler vers le bas
        # remonte le sujet et laisse au titre une zone calme. Sans --bande on
        # reste centré, pour ne pas déplacer les photos déjà réglées.
        y = (H - c) // 2 if args.bande is None else max(0, min(int(H * args.bande), H - c))
        im = im.crop((x, y, x + c, y + c))
        im = im.resize((args.carre, args.carre), Image.LANCZOS)

    bas, haut, mid = NUIT if args.theme == "nuit" else JOUR
    im = teinter(im, bas, haut, mid, melange=args.melange)

    dst = Path(args.sortie)
    if not dst.is_absolute() and dst.parent == Path("."):
        dst = HERE / "assets" / "photos" / dst.name
    im.save(dst, quality=92)

    # Contrôle : le texte du titre est-il lisible sur cette image ?
    # On mesure dans la bande où les gabarits posent le titre.
    encre = (255, 246, 234) if args.theme == "nuit" else (44, 29, 16)
    zone = im.crop((0, int(im.height * 0.62), im.width, int(im.height * 0.86)))
    px = list(zone.resize((60, 20)).get_flattened_data())
    moy = tuple(sum(c[i] for c in px) // len(px) for i in range(3))
    ratio = contraste(encre, moy)

    print(f"  ✓ {dst.name}  {im.size[0]} × {im.size[1]}  ({args.theme})")
    print(f"    fond moyen sous le titre : rgb{moy}")
    print(f"    contraste avec l'encre   : {ratio:.1f}:1", end="  ")
    print("OK" if ratio >= 4.5 else "INSUFFISANT — le voile devra compenser")


if __name__ == "__main__":
    main()
