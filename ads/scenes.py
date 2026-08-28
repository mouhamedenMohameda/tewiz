"""
Aloo — scènes plein cadre.

Les décors de `decors.py` sont des fonds discrets. Les scènes, elles, SONT
l'affiche : une route qui fuit vers un point de fuite, une skyline sur
l'horizon, une épingle posée sur la ville. C'est le genre des publicités
Bolt / Careem / AtlasCabs — l'image porte le message, le téléphone n'est plus
qu'un objet parmi d'autres, parfois absent.

La perspective est calculée, pas dessinée à vue : les pointillés de la ligne
médiane se resserrent vers l'horizon selon une puissance, sinon la route est
plate et l'œil ne « rentre » pas dedans.
"""

HZ = 520          # hauteur de l'horizon, en px depuis le haut
BAS = 1080        # bas du cadre
DEMI_BAS = 630    # demi-largeur de la route au premier plan
DEMI_HZ = 11      # demi-largeur au point de fuite (jamais 0 : sinon ça pique)
CX = 540          # abscisse du point de fuite


def _y(s: float) -> float:
    """Profondeur -> ordonnée. La puissance donne le tassement vers l'horizon."""
    return HZ + (BAS - HZ) * (s ** 2.35)


def _demi(y: float) -> float:
    """Demi-largeur de la route à une ordonnée donnée (interpolation linéaire)."""
    k = (y - HZ) / (BAS - HZ)
    return DEMI_HZ + (DEMI_BAS - DEMI_HZ) * k


def _pointilles(n: int = 13, plein: float = 0.52) -> str:
    """Ligne médiane en perspective : chaque tiret est un trapèze, pas un trait."""
    out = []
    for i in range(n):
        y0, y1 = _y(i / n), _y((i + plein) / n)
        if y1 - y0 < 1.2:            # trop court pour se voir : on saute
            continue
        # largeur du tiret proportionnelle à celle de la route à cette distance
        w0, w1 = _demi(y0) * 0.030, _demi(y1) * 0.030
        out.append(
            f'<path d="M{CX - w0:.1f} {y0:.1f} L{CX + w0:.1f} {y0:.1f} '
            f'L{CX + w1:.1f} {y1:.1f} L{CX - w1:.1f} {y1:.1f} Z"/>'
        )
    return "".join(out)


def _skyline() -> str:
    """Nouakchott en ombre chinoise : immeubles bas, une mosquée, deux minarets."""
    b = []
    blocs = [(96, 44, 62), (150, 30, 96), (186, 58, 48), (250, 38, 74),
             (300, 26, 58), (700, 34, 66), (742, 52, 44), (800, 30, 88),
             (852, 44, 54), (912, 24, 70), (952, 40, 46)]
    for x, w, h in blocs:
        b.append(f'<rect x="{x}" y="{HZ - h}" width="{w}" height="{h}"/>')
    # mosquée : coupole + deux minarets, la silhouette qui situe la ville
    b.append(f'<path d="M392 {HZ} v-42 a34 34 0 0 1 68 0 v42 Z"/>')
    b.append(f'<circle cx="426" cy="{HZ - 82}" r="9"/>')
    b.append(f'<rect x="368" y="{HZ - 96}" width="13" height="96"/>')
    b.append(f'<rect x="470" y="{HZ - 96}" width="13" height="96"/>')
    b.append(f'<rect x="596" y="{HZ - 74}" width="12" height="74"/>')
    return "".join(b)


def _voiture(s_prof: float = 0.55) -> str:
    """Une berline vue de dos, dimensionnée par la perspective de la route.

    Sans véhicule, la scène est une affiche de route ; avec, c'est une affiche
    de taxi. La largeur se déduit de celle de la chaussée à cette profondeur —
    la poser « à l'œil » la ferait flotter au-dessus du bitume.
    """
    y = _y(s_prof)
    demi = _demi(y)
    w = demi * 0.68           # la voiture occupe ~2/3 d'une demi-chaussée
    h = w * 0.66
    x0, x1 = CX - w / 2, CX + w / 2
    toit = w * 0.17           # retrait du pavillon par rapport aux flancs
    hb = h * 0.54             # hauteur de la caisse sous le pavillon

    return f"""
  <g>
    <ellipse cx="{CX:.1f}" cy="{y:.1f}" rx="{w * 0.62:.1f}" ry="{h * 0.13:.1f}"
             fill="#000" opacity="0.45"/>
    <path d="M{x0 + toit:.1f} {y - h:.1f}
             L{x1 - toit:.1f} {y - h:.1f}
             L{x1:.1f} {y - hb:.1f}
             L{x1:.1f} {y - h * 0.10:.1f}
             L{x0:.1f} {y - h * 0.10:.1f}
             L{x0:.1f} {y - hb:.1f} Z"
          fill="{{caisse}}"/>
    <path d="M{x0 + toit * 1.5:.1f} {y - h * 0.94:.1f}
             L{x1 - toit * 1.5:.1f} {y - h * 0.94:.1f}
             L{x1 - toit * 0.5:.1f} {y - hb * 1.06:.1f}
             L{x0 + toit * 0.5:.1f} {y - hb * 1.06:.1f} Z"
          fill="{{vitre}}" opacity="0.55"/>
    <rect x="{x0 + w * 0.07:.1f}" y="{y - hb * 0.80:.1f}"
          width="{w * 0.20:.1f}" height="{h * 0.13:.1f}" rx="{h * 0.05:.1f}"
          fill="{{feu}}"/>
    <rect x="{x1 - w * 0.27:.1f}" y="{y - hb * 0.80:.1f}"
          width="{w * 0.20:.1f}" height="{h * 0.13:.1f}" rx="{h * 0.05:.1f}"
          fill="{{feu}}"/>
    <ellipse cx="{x0 + w * 0.17:.1f}" cy="{y - hb * 0.74:.1f}"
             rx="{w * 0.26:.1f}" ry="{h * 0.17:.1f}" fill="{{feu}}" opacity="{{halo}}"/>
    <ellipse cx="{x1 - w * 0.17:.1f}" cy="{y - hb * 0.74:.1f}"
             rx="{w * 0.26:.1f}" ry="{h * 0.17:.1f}" fill="{{feu}}" opacity="{{halo}}"/>
  </g>"""


GABARIT = """
<svg class="scene" viewBox="0 0 1080 1080" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="ciel" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0"    stop-color="{ciel_haut}"/>
      <stop offset="0.62" stop-color="{ciel_mid}"/>
      <stop offset="1"    stop-color="{ciel_bas}"/>
    </linearGradient>
    <radialGradient id="lueur" cx="0.5" cy="1" r="0.62">
      <stop offset="0"   stop-color="{lueur}" stop-opacity="{op_lueur}"/>
      <stop offset="1"   stop-color="{lueur}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="sol" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="{sol_loin}"/>
      <stop offset="1" stop-color="{sol_pres}"/>
    </linearGradient>
    <linearGradient id="bitume" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0"    stop-color="{bit_loin}"/>
      <stop offset="0.30" stop-color="{bit_mid}"/>
      <stop offset="1"    stop-color="{bit_pres}"/>
    </linearGradient>
  </defs>

  <rect width="1080" height="{hz}" fill="url(#ciel)"/>
  <ellipse cx="540" cy="{hz}" rx="520" ry="235" fill="url(#lueur)"/>
  <g fill="{silhouette}" opacity="{op_silhouette}">{skyline}</g>

  <rect y="{hz}" width="1080" height="{sol_h}" fill="url(#sol)"/>

  <path d="M{cx_g} {hz} L{cx_d} {hz} L{bas_d} 1080 L{bas_g} 1080 Z" fill="url(#bitume)"/>
  <path d="M{cx_g} {hz} L{bas_g} 1080" stroke="{bord}" stroke-opacity="{op_bord}" stroke-width="3" fill="none"/>
  <path d="M{cx_d} {hz} L{bas_d} 1080" stroke="{bord}" stroke-opacity="{op_bord}" stroke-width="3" fill="none"/>
  <g fill="{ligne}" opacity="{op_ligne}">{pointilles}</g>
  {voiture}
</svg>
"""

JOUR = dict(
    ciel_haut="#F7E4CF", ciel_mid="#F6C98F", ciel_bas="#F2A25A",
    lueur="#FFFFFF", op_lueur="0.75",
    silhouette="#8A6A4C", op_silhouette="0.34",
    sol_loin="#C9A87F", sol_pres="#8E6E4E",
    bit_loin="#B7A695", bit_mid="#6E6157", bit_pres="#413931",
    bord="#FFFCF6", op_bord="0.50",
    ligne="#FFFCF6", op_ligne="0.92",
    caisse="#2E2620", vitre="#BFD3DE", feu="#E03A22", halo="0.20",
)

NUIT = dict(
    ciel_haut="#0B0603", ciel_mid="#2A1608", ciel_bas="#7A3410",
    lueur="#FF8348", op_lueur="0.62",
    silhouette="#0A0503", op_silhouette="0.88",
    sol_loin="#2A1B0D", sol_pres="#0E0804",
    bit_loin="#3B2C1D", bit_mid="#1E150C", bit_pres="#0B0704",
    bord="#FF8348", op_bord="0.34",
    ligne="#FCD07A", op_ligne="0.90",
    caisse="#120C07", vitre="#5A4A3A", feu="#FF4A2A", halo="0.42",
)


def horizon(nuit: bool) -> str:
    """Route en fuite vers l'horizon, skyline de Nouakchott, ciel dégradé."""
    p = dict(NUIT if nuit else JOUR)
    p.update(
        hz=HZ, sol_h=BAS - HZ,
        cx_g=CX - DEMI_HZ, cx_d=CX + DEMI_HZ,
        bas_g=CX - DEMI_BAS, bas_d=CX + DEMI_BAS,
        skyline=_skyline(), pointilles=_pointilles(),
        voiture=_voiture().format(**(NUIT if nuit else JOUR)),
    )
    return GABARIT.format(**p)


NOMS = ("horizon",)
