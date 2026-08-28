"""
Aloo — décors de fond.

Les publicités qui servent de référence (Bolt, Careem, AtlasCabs) reposent
presque toutes sur le même procédé : une route qui serpente en perspective et
porte le regard vers le téléphone. C'est le seul de leurs effets « 3D » qui se
dessine honnêtement en SVG — un ruban à largeur variable, une ligne médiane
pointillée qui suit la même courbe, et un dégradé qui simule l'éloignement.

Ce qui ne se dessine PAS ici, et qu'il faut passer par `visuel` : les voitures,
les personnages, les épingles volumétriques.
"""

# Le ruban part petit au loin (en haut) et s'élargit au premier plan (en bas).
# Les deux bords sont deux courbes de Bézier qui partagent la même inflexion ;
# la médiane suit exactement le milieu, sinon la route « glisse ».
ROUTE = """
<svg class="decor decor-route" viewBox="0 0 1080 1080" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="asphalte" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0"    stop-color="{loin}"/>
      <stop offset="0.45" stop-color="{mid}"/>
      <stop offset="1"    stop-color="{pres}"/>
    </linearGradient>
    <linearGradient id="fondu" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0"    stop-color="#fff" stop-opacity="0"/>
      <stop offset="0.28" stop-color="#fff" stop-opacity="1"/>
      <stop offset="1"    stop-color="#fff" stop-opacity="1"/>
    </linearGradient>
    <mask id="m-route">
      <rect width="1080" height="1080" fill="url(#fondu)"/>
    </mask>
  </defs>

  <g mask="url(#m-route)">
    <!-- le ruban : bord droit descendant, bord gauche remontant -->
    <path d="M 596 196
             C 470 372, 792 470, 700 646
             C 636 770, 372 796, 300 1080
             L 12 1080
             C 96 742, 404 726, 470 612
             C 528 512, 250 396, 402 194 Z"
          fill="url(#asphalte)"/>

    <!-- ligne médiane, même courbe, décalée au centre du ruban -->
    <path d="M 499 195
             C 375 380, 634 486, 585 629
             C 540 762, 240 800, 156 1080"
          fill="none" stroke="{ligne}" stroke-opacity="{op_ligne}"
          stroke-width="9" stroke-linecap="round"
          stroke-dasharray="34 40"/>
  </g>
</svg>
"""

# Grille isométrique — le fond « plan de ville » des références Careem.
GRILLE = """
<svg class="decor decor-grille" viewBox="0 0 1080 1080" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <pattern id="iso" width="120" height="70" patternUnits="userSpaceOnUse"
             patternTransform="translate(0 0)">
      <path d="M0 35 L60 0 L120 35 L60 70 Z" fill="none"
            stroke="{ligne}" stroke-opacity="{op_ligne}" stroke-width="2"/>
    </pattern>
    <radialGradient id="g-fade" cx="0.5" cy="0.42" r="0.62">
      <stop offset="0"   stop-color="#fff" stop-opacity="1"/>
      <stop offset="1"   stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
    <mask id="m-grille"><rect width="1080" height="1080" fill="url(#g-fade)"/></mask>
  </defs>
  <rect width="1080" height="1080" fill="url(#iso)" mask="url(#m-grille)"/>
</svg>
"""


def decor(name: str, nuit: bool) -> str:
    """Rend un décor, accordé au thème. Renvoie "" si le nom est vide."""
    if not name:
        return ""

    if nuit:
        palette = dict(
            loin="#241708", mid="#2E1E0C", pres="#3A2615",
            ligne="#FCD07A", op_ligne="0.55",
        )
        grille = dict(ligne="#FF8348", op_ligne="0.16")
    else:
        palette = dict(
            loin="#E7D6C4", mid="#C9B199", pres="#A98D6E",
            ligne="#FFFCF6", op_ligne="0.85",
        )
        grille = dict(ligne="#D9531B", op_ligne="0.16")

    if name == "route":
        return ROUTE.format(**palette)
    if name == "grille":
        return GRILLE.format(**grille)
    return ""


NOMS = ("route", "grille")
