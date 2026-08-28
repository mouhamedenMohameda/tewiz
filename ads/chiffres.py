"""
Aloo — chiffres dessinés comme des routes.

Le procédé des publicités ekar / TaxiF / Anjaz : un chiffre n'est pas écrit,
il est *tracé* comme une chaussée — bitume épais, ligne médiane pointillée,
et une voiture vue de dessus posée dessus.

Chaque chiffre est décrit par sa LIGNE MÉDIANE seule. La chaussée naît de
l'épaisseur du trait, la ligne blanche est le même tracé répété plus fin et
pointillé. Décrire les deux bords à la main serait ingérable et se
désaligneraut au premier ajustement.

Repère commun : 0 0 120 190.
"""

BOITE = (120, 190)

# Lignes médianes. Un chiffre fermé (0, 8) finit par Z.
MEDIANES = {
    "0": "M60 25 C79 25 95 41 95 60 V130 C95 149 79 165 60 165 "
         "C41 165 25 149 25 130 V60 C25 41 41 25 60 25 Z",
    "1": "M30 54 L60 25 V165",
    "2": "M26 58 C26 37 44 25 62 25 C82 25 97 38 97 57 "
         "C97 90 32 120 26 165 H100",
    "3": "M28 46 C37 31 52 25 64 25 C83 25 95 37 95 53 "
         "C95 69 82 79 66 79 C84 79 99 90 99 110 "
         "C99 135 80 165 56 165 C41 165 30 157 25 146",
    "4": "M78 165 V25 L22 112 H100",
    "5": "M92 25 H40 L33 89 C44 81 56 78 66 78 C86 78 99 94 99 118 "
         "C99 145 79 165 56 165 C41 165 30 158 24 148",
    "6": "M88 32 C70 22 48 30 38 52 C30 70 27 95 27 114 "
         "C27 142 42 165 63 165 C83 165 98 148 98 124 "
         "C98 102 83 88 63 88 C46 88 33 98 28 112",
    "7": "M24 25 H98 L52 165",
    "8": "M60 25 C77 25 91 36 91 52 C91 68 77 78 60 78 "
         "C43 78 29 68 29 52 C29 36 43 25 60 25 Z"
         "M60 78 C81 78 97 92 97 116 C97 142 81 165 60 165 "
         "C39 165 23 142 23 116 C23 92 39 78 60 78 Z",
    "9": "M32 158 C50 168 72 160 82 138 C90 120 93 95 93 76 "
         "C93 48 78 25 57 25 C37 25 22 42 22 66 "
         "C22 88 37 102 57 102 C74 102 87 92 92 78",
    "%": "M34 30 A16 16 0 1 1 33.9 30 Z M86 130 A16 16 0 1 1 85.9 130 Z"
         "M96 30 L24 160",
}

LARGEUR_ROUTE = 34      # épaisseur du bitume
LARGEUR_LIGNE = 3.4     # ligne médiane
TIRETS = "13 15"


def chiffre(d: str, bitume: str, ligne: str, ombre: bool = True) -> str:
    """Un caractère, rendu en chaussée. Renvoie un <g> à poser dans un SVG."""
    p = MEDIANES[d]
    ombre_svg = (
        f'<path d="{p}" fill="none" stroke="rgba(0,0,0,0.28)" '
        f'stroke-width="{LARGEUR_ROUTE}" stroke-linecap="round" '
        f'stroke-linejoin="round" transform="translate(4 9)"/>'
        if ombre else ""
    )
    return (
        f'<g>{ombre_svg}'
        f'<path d="{p}" fill="none" stroke="{bitume}" '
        f'stroke-width="{LARGEUR_ROUTE}" stroke-linecap="round" stroke-linejoin="round"/>'
        f'<path d="{p}" fill="none" stroke="{ligne}" stroke-width="{LARGEUR_LIGNE}" '
        f'stroke-dasharray="{TIRETS}" stroke-linecap="round"/>'
        f"</g>"
    )


# Voiture vue de dessus, capot vers le haut, dans une boîte 46 × 92.
# Volontairement simple : à la taille où elle apparaît sur la chaussée, tout
# détail supplémentaire se referme en bouillie.
VOITURE = """
<g transform="translate({x} {y}) rotate({a}) scale({s})">
  <ellipse cx="0" cy="6" rx="26" ry="48" fill="rgba(0,0,0,0.34)"/>
  <rect x="-23" y="-46" width="46" height="92" rx="17" fill="{carrosserie}"/>
  <path d="M-19 -30 h38 v-4 a19 19 0 0 0 -38 0 Z" fill="{vitre}"/>
  <path d="M-19 30 h38 v6 a19 19 0 0 1 -38 0 Z" fill="{vitre}"/>
  <rect x="-17" y="-14" width="34" height="26" rx="7" fill="{vitre}" opacity="0.9"/>
  <rect x="-26" y="-26" width="6" height="16" rx="3" fill="#15100B"/>
  <rect x="20"  y="-26" width="6" height="16" rx="3" fill="#15100B"/>
  <rect x="-26" y="16"  width="6" height="16" rx="3" fill="#15100B"/>
  <rect x="20"  y="16"  width="6" height="16" rx="3" fill="#15100B"/>
  <circle cx="-13" cy="-44" r="4" fill="#FFF3D6"/>
  <circle cx="13"  cy="-44" r="4" fill="#FFF3D6"/>
</g>
"""


def voiture(x: float, y: float, angle: float = 0, echelle: float = 1,
            carrosserie: str = "#FBF3E7", vitre: str = "#2A1A0E") -> str:
    return VOITURE.format(x=x, y=y, a=angle, s=echelle,
                          carrosserie=carrosserie, vitre=vitre)


def nombre(txt: str, bitume: str, ligne: str, ecart: int = 12) -> tuple[str, int, int]:
    """Plusieurs caractères côte à côte. Renvoie (svg, largeur, hauteur)."""
    w, h = BOITE
    morceaux, x = [], 0
    for c in txt:
        morceaux.append(f'<g transform="translate({x} 0)">{chiffre(c, bitume, ligne)}</g>')
        x += w + ecart
    return "".join(morceaux), x - ecart, h
