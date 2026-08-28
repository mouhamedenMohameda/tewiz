#!/usr/bin/env python3
"""
Aloo — générateur d'annonces sociales 1080 × 1080.

Tout se pilote depuis `posters.json` : les textes, l'écran affiché dans le
téléphone, les puces. Aucun besoin de toucher au Python pour sortir une
nouvelle affiche.

Tout ce qui est visible vient des vrais assets du projet — icône de l'app,
badges de stores, captures d'écran, palette « Sahara Solaire », polices
Sora + Cairo. Rien n'est redessiné à la main.

    python3 build.py     # posters.json -> *.html + index.html
    ./render.sh          # *.html -> *.png 2160 × 2160
"""

from __future__ import annotations

import html
import json
import re
import sys
from pathlib import Path

import segno

import decors
import scenes

HERE = Path(__file__).parent
SCREENS_DIR = HERE / "assets" / "screens"
HERO_DIR = HERE / "assets" / "hero"
PHOTOS_DIR = HERE / "assets" / "photos"
CONFIG = HERE / "posters.json"

INK = "#2C1D10"

# Emplacements possibles d'une puce, du plus utile au plus rare. La clé est ce
# qu'on écrit dans posters.json ; la valeur est la classe CSS correspondante.
PLACES = {
    "haut-droite":    "at-tr",
    "haut-gauche":    "at-tl",
    "bas-droite":     "at-br",
    "bas-gauche":     "at-bl",
    "milieu-droite":  "at-mr",
    "milieu-gauche":  "at-ml",
}

# Bibliothèque d'icônes. Pour en ajouter une : une entrée ici, tracée dans une
# grille 24 × 24, `currentColor` pour la couleur — la puce s'occupe du reste.
ICONS = {
    "bouclier": """<svg viewBox="0 0 24 24" fill="none">
        <path d="M12 2.5 20 5.5v6c0 5-3.4 9-8 10.5C7.4 20.5 4 16.5 4 11.5v-6L12 2.5Z" fill="currentColor"/>
        <path d="m8.4 11.8 2.5 2.5 4.7-5" stroke="#FFFCF6" stroke-width="2.1"
              stroke-linecap="round" stroke-linejoin="round"/></svg>""",

    "epingle": """<svg viewBox="0 0 24 24" fill="none">
        <path d="M12 2.4c-4 0-7 3-7 6.8 0 5 7 12.4 7 12.4s7-7.4 7-12.4c0-3.8-3-6.8-7-6.8Z" fill="currentColor"/>
        <circle cx="12" cy="9.2" r="2.7" fill="#FFFCF6"/></svg>""",

    "etoile": """<svg viewBox="0 0 24 24"><path fill="currentColor"
        d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5L2.6 9.4l6.5-.9L12 2.6Z"/></svg>""",

    "eclair": """<svg viewBox="0 0 24 24"><path fill="currentColor"
        d="M13.5 2 4 13.2h6.2L9.6 22 20 10.5h-6.4L13.5 2Z"/></svg>""",

    "portefeuille": """<svg viewBox="0 0 24 24" fill="none">
        <rect x="2.6" y="5.4" width="18.8" height="13.6" rx="3.4" fill="currentColor"/>
        <circle cx="17" cy="12.2" r="1.9" fill="#FFFCF6"/></svg>""",

    "micro": """<svg viewBox="0 0 24 24" fill="none">
        <rect x="9" y="2.2" width="6" height="11.4" rx="3" fill="currentColor"/>
        <path d="M5.4 11.2a6.6 6.6 0 0 0 13.2 0M12 17.8V21.8" stroke="currentColor"
              stroke-width="2.1" stroke-linecap="round"/></svg>""",

    "globe": """<svg viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="9.2" fill="currentColor"/>
        <path d="M3.4 9.6h17.2M3.4 14.4h17.2M12 2.9c-5 6-5 12.2 0 18.2M12 2.9c5 6 5 12.2 0 18.2"
              stroke="#FFFCF6" stroke-width="1.6"/></svg>""",

    "horloge": """<svg viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="9.2" fill="currentColor"/>
        <path d="M12 6.6V12l3.6 2.4" stroke="#FFFCF6" stroke-width="2.1"
              stroke-linecap="round" stroke-linejoin="round"/></svg>""",

    "cadeau": """<svg viewBox="0 0 24 24" fill="none">
        <rect x="3" y="9.4" width="18" height="11.6" rx="2.6" fill="currentColor"/>
        <rect x="2" y="6" width="20" height="4.6" rx="1.8" fill="currentColor"/>
        <path d="M12 6v15" stroke="#FFFCF6" stroke-width="2.1"/>
        <path d="M12 6S10.4 2.6 8.2 3.2 7.4 6.4 12 6Zm0 0s1.6-3.4 3.8-2.8S16.6 6.4 12 6Z"
              fill="currentColor"/></svg>""",

    "pourcent": """<svg viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="9.2" fill="currentColor"/>
        <path d="M8.6 15.4 15.4 8.6" stroke="#FFFCF6" stroke-width="2.1" stroke-linecap="round"/>
        <circle cx="9.2" cy="9.2" r="1.7" fill="#FFFCF6"/>
        <circle cx="14.8" cy="14.8" r="1.7" fill="#FFFCF6"/></svg>""",

    "personnes": """<svg viewBox="0 0 24 24" fill="none">
        <circle cx="9" cy="8" r="3.6" fill="currentColor"/>
        <circle cx="17" cy="9.4" r="2.8" fill="currentColor"/>
        <path d="M2.4 19.6c0-3.4 3-5.6 6.6-5.6s6.6 2.2 6.6 5.6Z" fill="currentColor"/>
        <path d="M17 13.6c2.8 0 4.6 1.6 4.6 4.2h-4.2Z" fill="currentColor"/></svg>""",

    "whatsapp": """<svg viewBox="0 0 24 24"><path fill="currentColor"
        d="M12 2.2a9.7 9.7 0 0 0-8.3 14.7L2.2 21.8l5.1-1.4A9.7 9.7 0 1 0 12 2.2Zm5.6 13.7c-.24.66-1.4 1.28-1.92 1.32
           -.5.05-.96.24-3.24-.67-2.72-1.08-4.44-3.86-4.58-4.04-.13-.18-1.1-1.44-1.1-2.75 0-1.3.7-1.94.94-2.2
           .25-.28.54-.34.72-.34h.52c.16 0 .4-.06.62.48.23.56.78 1.94.85 2.08.07.14.11.3.02.48
           -.09.18-.14.29-.27.45l-.4.46c-.13.13-.27.28-.12.55.15.26.67 1.1 1.44 1.79.99.88 1.83 1.15 2.09 1.28
           .26.14.41.12.56-.07l.8-.94c.2-.26.37-.2.62-.11l1.77.84c.26.13.43.19.5.3.06.11.06.63-.18 1.29Z"/></svg>""",

    "restaurant": """<svg viewBox="0 0 24 24" fill="none">
        <path d="M6.2 2.6v7.2M9 2.6v7.2M7.6 2.6v19M7.6 9.8a2.6 2.6 0 0 0 2.6-2.6M7.6 9.8A2.6 2.6 0 0 1 5 7.2"
              stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/>
        <path d="M16.8 2.6c-1.6 0-2.6 2-2.6 4.6s1 3.6 2.6 3.6 2.6-1 2.6-3.6-1-4.6-2.6-4.6ZM16.8 10.8v10.8"
              stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/></svg>""",

    "colis": """<svg viewBox="0 0 24 24" fill="none">
        <path d="M12 2.4 21.2 7v10L12 21.6 2.8 17V7L12 2.4Z" fill="currentColor"/>
        <path d="M2.8 7 12 11.6 21.2 7M12 11.6v10" stroke="#FFFCF6" stroke-width="1.7"/></svg>""",

    "camion": """<svg viewBox="0 0 24 24" fill="none">
        <rect x="1.6" y="6.4" width="12.4" height="9.6" rx="1.8" fill="currentColor"/>
        <path d="M14 9.4h3.6l3.4 3.6v3h-7V9.4Z" fill="currentColor"/>
        <circle cx="6.6" cy="17.6" r="2.4" fill="currentColor"/>
        <circle cx="17.4" cy="17.6" r="2.4" fill="currentColor"/>
        <circle cx="6.6" cy="17.6" r="0.9" fill="#FFFCF6"/>
        <circle cx="17.4" cy="17.6" r="0.9" fill="#FFFCF6"/></svg>""",

    "cle": """<svg viewBox="0 0 24 24" fill="none">
        <circle cx="7.6" cy="7.6" r="4.6" fill="currentColor"/>
        <circle cx="7.6" cy="7.6" r="1.7" fill="#FFFCF6"/>
        <path d="m11 11 8.6 8.6M16.4 15.2l2 2M14 12.8l2 2" stroke="currentColor"
              stroke-width="2.4" stroke-linecap="round"/></svg>""",

    "outils": """<svg viewBox="0 0 24 24" fill="none">
        <path d="M20 5.4a5 5 0 0 1-6.6 6.6L6 19.4a2.4 2.4 0 0 1-3.4-3.4L10 8.6A5 5 0 0 1 16.6 2L13.4 5.2l1.4 4 4 1.4L20 5.4Z"
              fill="currentColor"/></svg>""",

    "volant": """<svg viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="9.2" fill="currentColor"/>
        <circle cx="12" cy="12" r="3.2" fill="#FFFCF6"/>
        <path d="M12 2.8v6M3.4 15.4l5.6-2.4M20.6 15.4l-5.6-2.4" stroke="#FFFCF6" stroke-width="1.9"/></svg>""",

    "remorque": """<svg viewBox="0 0 24 24" fill="none">
        <path d="M2.4 15.6v-2.4l1.4-3.2c.3-.7.9-1.2 1.7-1.2h7c.8 0 1.4.5 1.7 1.2l1.4 3.2v2.4H2.4Z" fill="currentColor"/>
        <path d="M15.6 12.4h3.2l2.8 2.4v2h-6v-4.4Z" fill="currentColor" opacity="0.55"/>
        <circle cx="6.4" cy="17.4" r="2" fill="currentColor"/>
        <circle cx="14.4" cy="17.4" r="2" fill="currentColor"/></svg>""",

    "carton": """<svg viewBox="0 0 24 24" fill="none">
        <rect x="2.6" y="7.4" width="18.8" height="13" rx="2" fill="currentColor"/>
        <path d="M2.6 7.4 5 3.4h14l2.4 4" fill="currentColor" opacity="0.6"/>
        <path d="M9.4 11.4h5.2" stroke="#FFFCF6" stroke-width="2" stroke-linecap="round"/></svg>""",

    "voiture": """<svg viewBox="0 0 24 24" fill="none">
        <path d="M3 16.4v-3l1.8-4.2C5.2 8.2 6 7.6 7 7.6h10c1 0 1.8.6 2.2 1.6L21 13.4v3c0 .7-.5 1.2-1.2 1.2h-.9
                 c-.7 0-1.2-.5-1.2-1.2v-.6H6.3v.6c0 .7-.5 1.2-1.2 1.2h-.9c-.7 0-1.2-.5-1.2-1.2Z" fill="currentColor"/>
        <circle cx="7.2" cy="13" r="1.5" fill="#FFFCF6"/>
        <circle cx="16.8" cy="13" r="1.5" fill="#FFFCF6"/></svg>""",
}


# ---------------------------------------------------------------- utilitaires
def die(message: str) -> None:
    """Un message qu'on peut corriger sans lire le code, puis on s'arrête."""
    print(f"\n  ✗ {message}\n", file=sys.stderr)
    sys.exit(1)


def emphasise(text: str) -> str:
    """`mot *en orange*` -> le segment étoilé passe en ember.

    Le texte est échappé AVANT d'insérer le balisage : on veut pouvoir écrire
    une esperluette dans un titre sans casser la page.
    """
    escaped = html.escape(text)
    return re.sub(r"\*(.+?)\*", r"<em>\1</em>", escaped)


def qr_svg(url: str) -> str:
    """QR en SVG inline, encre espresso, sans quiet zone (la carte en fournit une).

    segno écrit `width`/`height` en modules mais pas de `viewBox` : sans lui le
    dessin reste à sa taille intrinsèque (33 px) quoi qu'en dise le CSS, et le
    QR se tasse dans un coin de sa carte. On le rajoute.
    """
    qr = segno.make(url, error="m")
    svg = qr.svg_inline(dark=INK, light=None, border=0)
    side = qr.symbol_size(border=0)[0]
    return svg.replace(
        "<svg ",
        f'<svg viewBox="0 0 {side} {side}" preserveAspectRatio="xMidYMid meet" '
        f'shape-rendering="crispEdges" ',
        1,
    )


def available_screens() -> dict[str, str]:
    """Tout PNG déposé dans assets/screens/ devient utilisable par son nom."""
    return {p.stem: p.name for p in sorted(SCREENS_DIR.glob("*.png"))}


# ---------------------------------------------------------------- fragments
def render_chip(chip: dict, where: str) -> str:
    icon_name = chip.get("icone", "")
    if icon_name not in ICONS:
        die(
            f"{where} : icône « {icon_name} » inconnue.\n"
            f"    Disponibles : {', '.join(sorted(ICONS))}"
        )

    # `place` ne sert qu'au gabarit centré, où les puces flottent. Les autres
    # les empilent en liste, dans l'ordre d'écriture.
    place = chip.get("place", "haut-droite")
    if place not in PLACES:
        die(
            f"{where} : place « {place} » inconnue.\n"
            f"    Disponibles : {', '.join(PLACES)}"
        )

    # Une puce peut porter un accent : doré pour l'argent (comme les soldes dans
    # l'app), vert pour WhatsApp — sinon elle reste en ember.
    accent = " money" if chip.get("or") else (" green" if chip.get("vert") else "")
    return f"""
      <div class="chip {PLACES[place]}">
        <div class="chip-ic{accent}">{ICONS[icon_name]}</div>
        <div class="chip-tx">
          <b>{html.escape(chip.get("titre", ""))}</b>
          <span>{html.escape(chip.get("sous", ""))}</span>
        </div>
      </div>"""


PHONE_GLYPH = (
    '<svg viewBox="0 0 24 24"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2'
    "c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.8 21 3 "
    "13.2 3 3.9c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.6.1.4 0 .8-.3 1"
    'l-2.2 2.3z"/></svg>'
)

# --- morceaux réutilisés par tous les gabarits -------------------------------

BRAND = """  <div class="brand{inline}">
    <img src="assets/logo-icon.png" alt="Aloo">
    <div class="wordmark">Aloo</div>
  </div>"""

STAGE = """  <div class="stage">
    <div class="puck"></div>
    <div class="phone{tilt}">
      <div class="notch"></div>
      <div class="screen"><img src="assets/screens/{screen}" alt=""></div>
      <div class="sheen"></div>
    </div>
    {chips}
  </div>"""

# Deux stores, donc deux QR — c'est le parti de la carte de visite. Un QR
# unique obligerait à passer par un service de redirection : une dépendance de
# plus, et un lien qui casse si le service meurt, sur un support imprimé.
QR_DUO = """<div class="qr-duo">
        <div class="qr-item"><div class="qr">{qr_ios}</div>
          <img src="assets/appstore.png" alt="App Store"></div>
        <div class="qr-item"><div class="qr">{qr_and}</div>
          <img src="assets/playstore.png" alt="Google Play"></div>
      </div>"""

# Pied du gabarit centré : QR d'un côté, téléphone de l'autre, sur le sable.
FOOTER_SPLIT = """  <div class="footer-left">
    <div class="dl">
      <div class="lbl">لتحميل التطبيق</div>
      """ + QR_DUO + """
    </div>
  </div>

  <div class="footer-right">
    <div class="call">للاتصال أو الاستفسار</div>
    <div class="phone-row">
      <div class="ic">""" + PHONE_GLYPH + """</div>
      <div class="num"><span class="pref">{prefix}</span>{phone}</div>
    </div>
  </div>"""

# Bande espresso pleine largeur : tout le bloc « télécharger » d'un seul tenant.
BAND = """  <div class="band">
    <div class="qr-row">
      <div class="dl">
        <div class="lbl">لتحميل التطبيق</div>
        """ + QR_DUO + """
      </div>
    </div>
    <div class="contact">
      <div class="call">للاتصال أو الاستفسار</div>
      <div class="num"><span class="pref">{prefix}</span>{phone}</div>
    </div>
  </div>"""

PAGE = """<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<title>Aloo — {slug}</title>
<link rel="stylesheet" href="brand.css">
<link rel="stylesheet" href="stage.css">
<link rel="stylesheet" href="layouts.css">
<link rel="stylesheet" href="theme-nuit.css">
<link rel="stylesheet" href="format-story.css">
</head>
<body class="{fclass}">
<div class="poster {gclass}{theme}">
{body}
</div>
</body>
</html>
"""

# Chaque gabarit décrit seulement l'ordre et les variantes de ses morceaux.
GABARITS = {
    # Le gabarit d'origine : tout centré, puces flottant autour du téléphone.
    "centre": {
        "class": "",
        "inline": False,
        "start": False,
        "features": False,
        "footer": FOOTER_SPLIT,
        "road": False,
    },
    # Fiche produit : titre puis trois atouts alignés, téléphone à l'opposé.
    "liste": {
        "class": "g-liste",
        "inline": True,
        "start": True,
        "features": True,
        "footer": BAND,
        "road": False,
    },
    # Message unique : grand titre, téléphone incliné, bande basse.
    "bande": {
        "class": "g-bande",
        "inline": True,
        "start": True,
        "features": False,
        "footer": BAND,
        "road": False,
    },
    # Carrousel : N cartes de 1080 qui, mises bout à bout, ne forment qu'une
    # seule image. La marque n'apparaît que sur la première, le bloc de
    # téléchargement que sur la dernière — le répéter sur chaque carte
    # alourdirait un format dont l'intérêt est justement la continuité.
    "carrousel": {
        "class": "g-carrousel",
        "inline": True,
        "start": True,
        "features": False,
        "footer": BAND,
        "road": False,
    },
    # Fenêtre : la photo n'apparaît qu'à l'intérieur d'un mot géant. Le reste
    # est un aplat. Demande un mot court et une police très grasse — à travers
    # des jambages fins, une photo devient une bouillie.
    "fenetre": {
        "class": "g-fenetre",
        "inline": True,
        "start": True,
        "features": False,
        "footer": BAND,
        "road": False,
    },
    # Éditorial : la photo occupe le haut, le message un aplat plein en bas.
    # Aucune superposition texte/photo — donc aucun voile, donc une image nette.
    "editorial": {
        "class": "g-editorial",
        "inline": True,
        "start": True,
        "features": False,
        "footer": BAND,
        "road": False,
    },
    # Sommaire : une grille de services. Le gabarit qui répond à « qu'est-ce
    # que fait cette application ? » en une image.
    "sommaire": {
        "class": "g-sommaire",
        "inline": True,
        "start": True,
        "features": False,
        "footer": BAND,
        "road": False,
    },
    # La PHOTO est l'affiche : plein cadre, titre géant en bas, rien d'autre.
    "affiche": {
        "class": "g-affiche",
        "inline": True,
        "start": True,
        "features": False,
        "footer": BAND,
        "road": False,
    },
    # La scène EST l'affiche : image plein cadre, titre posé dessus, CTA.
    "scene": {
        "class": "g-scene",
        "inline": True,
        "start": True,
        "features": False,
        "footer": BAND,
        "road": False,
    },
    # Beaucoup de vide, arc de route en fond, pastille d'appel à l'action.
    "large": {
        "class": "g-large",
        "inline": True,
        "start": True,
        "features": True,
        "footer": FOOTER_SPLIT,
        "road": True,
    },
}


def render_feature(chip: dict, where: str) -> str:
    """La même puce, mais posée en liste : ni carte, ni ombre, ni position."""
    icon_name = chip.get("icone", "")
    if icon_name not in ICONS:
        die(
            f"{where} : icône « {icon_name} » inconnue.\n"
            f"    Disponibles : {', '.join(sorted(ICONS))}"
        )
    accent = " money" if chip.get("or") else (" green" if chip.get("vert") else "")
    return f"""
      <div class="feature">
        <div class="ic{accent}">{ICONS[icon_name]}</div>
        <div class="tx">
          <b>{html.escape(chip.get("titre", ""))}</b>
          <span>{html.escape(chip.get("sous", ""))}</span>
        </div>
      </div>"""


INDEX_TEMPLATE = """<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Aloo — planche des annonces</title>
<style>
  body {{ margin:0; padding:48px; background:#2A1A0E; color:#FBEFDD;
         font:16px/1.5 -apple-system, system-ui, sans-serif; }}
  h1 {{ font-size:26px; margin:0 0 6px; font-weight:800; }}
  p.sub {{ margin:0 0 40px; color:#C9B49A; }}
  .grid {{ display:grid; grid-template-columns:repeat(auto-fill, minmax(340px,1fr));
           gap:40px; }}
  figure {{ margin:0; }}
  .frame {{ width:100%; aspect-ratio:1; border-radius:16px; overflow:hidden;
            background:#FBF3E7; position:relative;
            box-shadow:0 18px 40px -14px rgba(0,0,0,.55); }}
  .frame iframe {{ position:absolute; top:0; left:0; width:1080px; height:1080px;
                   border:0; transform-origin:top left; }}
  figcaption {{ margin-top:14px; font-size:14px; color:#C9B49A; }}
  figcaption b {{ display:block; color:#FBEFDD; font-size:16px; }}
</style>
</head>
<body>
  <h1>Aloo — planche des annonces</h1>
  <p class="sub">{count} affiches · 1080 × 1080 · générées depuis posters.json</p>
  <div class="grid">{cards}</div>
<script>
  // Les aperçus sont les vraies pages, réduites — ce que vous voyez est ce qui
  // sortira en PNG, pas une capture qui pourrait dater.
  const fit = () => document.querySelectorAll('.frame').forEach(f => {{
    const s = f.clientWidth / 1080;
    f.querySelector('iframe').style.transform = `scale(${{s}})`;
  }});
  addEventListener('resize', fit); fit();
</script>
</body>
</html>
"""


# ---------------------------------------------------------------- programme
def main() -> None:
    if not CONFIG.exists():
        die(f"posters.json introuvable dans {HERE}")

    try:
        cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        die(f"posters.json est mal formé — ligne {exc.lineno}, colonne {exc.colno} :\n    {exc.msg}")

    contact = cfg.get("contact", {})
    posters = cfg.get("affiches", [])
    if not posters:
        die("posters.json ne contient aucune affiche (clé « affiches »).")

    screens = available_screens()
    if not screens:
        die(f"aucun écran dans {SCREENS_DIR} — déposez-y au moins un PNG.")

    # Un QR par store. `lien_qr` reste accepté pour ne pas casser une config
    # existante, mais les deux clés dédiées priment.
    url_and = contact.get("lien_android") or contact.get("lien_qr", "")
    url_ios = contact.get("lien_ios", "")
    if not url_ios:
        die("contact : « lien_ios » manquant dans posters.json.")
    if not url_and:
        die("contact : « lien_android » manquant dans posters.json.")
    qr_ios, qr_and = qr_svg(url_ios), qr_svg(url_and)
    written: list[tuple[str, str]] = []
    tailles: list[tuple[str, int, int]] = []

    # Dépliage des carrousels. Une entrée à `cartes` devient N affiches, chacune
    # portant son décalage dans le panorama. Le faire ici plutôt que dans la
    # boucle garde le reste du générateur ignorant du format.
    deplie: list[dict] = []
    for a in posters:
        if a.get("gabarit") != "carrousel":
            deplie.append(a)
            continue
        cartes = a.get("cartes") or []
        if len(cartes) < 2:
            die(f"affiche « {a.get('fichier')} » : un carrousel demande au moins deux cartes.")
        for n, carte in enumerate(cartes):
            fille = {k: v for k, v in a.items() if k not in ("cartes", "fichier")}
            fille.update(carte)
            fille["fichier"] = f"{a['fichier']}-{n + 1}"
            fille["_carte"] = n
            fille["_cartes"] = len(cartes)
            deplie.append(fille)
    posters = deplie

    for i, p in enumerate(posters, 1):
        slug = p.get("fichier") or die(f"affiche n°{i} : clé « fichier » manquante.")
        where = f"affiche « {slug} »"

        gname = p.get("gabarit", "centre")
        if gname not in GABARITS:
            die(
                f"{where} : gabarit « {gname} » inconnu.\n"
                f"    Disponibles : {', '.join(GABARITS)}"
            )
        g = GABARITS[gname]

        # Deux cas n'affichent aucun téléphone — le gabarit « scene », et toute
        # affiche portée par un visuel (`sans_telephone`). Leur réclamer un
        # écran n'aurait pas de sens ; partout ailleurs la clé reste obligatoire.
        screen = p.get("ecran", "")
        # Trois cas n'affichent aucun téléphone : la scène, une affiche portée par
        # un visuel, et le sommaire — qui est une grille de services.
        if gname in ("scene", "sommaire", "editorial", "fenetre", "carrousel") or p.get("sans_telephone"):
            if screen and screen not in screens:
                die(
                    f"{where} : écran « {screen} » introuvable.\n"
                    f"    Disponibles : {', '.join(sorted(screens))}"
                )
            screen = screen or next(iter(sorted(screens)))
        elif screen not in screens:
            die(
                f"{where} : écran « {screen} » introuvable.\n"
                f"    Disponibles : {', '.join(sorted(screens))}\n"
                f"    (déposez un PNG dans assets/screens/ pour en ajouter un)"
            )

        puces = p.get("puces", [])
        if g["features"]:
            # Empilées en liste : le gabarit les place, pas la puce.
            inner = "".join(
                render_feature(c, f"{where}, atout n°{j}")
                for j, c in enumerate(puces, 1)
            )
            chips, features = "", f'  <div class="features">{inner}</div>'
        else:
            chips = "".join(
                render_chip(c, f"{where}, puce n°{j}")
                for j, c in enumerate(puces, 1)
            )
            features = ""

        fond = ""
        if p.get("fond"):
            name = p["fond"]
            found = next(
                (q for ext in (".jpg", ".jpeg", ".png", ".webp")
                 for q in [PHOTOS_DIR / f"{name}{ext}"] if q.exists()),
                None,
            )
            if found is None:
                dispo = sorted({q.stem for q in PHOTOS_DIR.glob("*") if q.is_file()})
                die(
                    f"{where} : photo « {name} » introuvable.\n"
                    f"    Disponibles : {', '.join(dispo) or '(aucune)'}\n"
                    f"    (déposez un .jpg ou .png dans assets/photos/)"
                )
            if p.get("gabarit") == "carrousel":
                n, total = p.get("_carte", 0), p.get("_cartes", 1)
                fond = (
                    f'  <div class="pano" style="width:{total * 1080}px;'
                    f'left:{-n * 1080}px">'
                    f'<img src="assets/photos/{found.name}" alt=""></div>\n'
                    f'  <div class="voile"></div>'
                )
            elif p.get("gabarit") == "fenetre":
                fond = (f'  <style>.g-fenetre .mot {{ background-image:'
                        f' url("assets/photos/{found.name}"); }}</style>')
            else:
                fond = (f'  <img class="fond" src="assets/photos/{found.name}" alt="">\n'
                        f'  <div class="voile"></div>')

        visuel = ""
        if p.get("visuel"):
            path = HERO_DIR / f"{p['visuel']}.png"
            if not path.exists():
                die(
                    f"{where} : visuel « {p['visuel']} » introuvable.\n"
                    f"    Attendu : {path}\n"
                    f"    (déposez un PNG à fond transparent dans assets/hero/)"
                )
            visuel = f'  <img class="hero" src="assets/hero/{path.name}" alt="">'

        fmt = p.get("format", "carre")
        if fmt not in ("carre", "story"):
            die(f"{where} : format « {fmt} » inconnu. Disponibles : carre, story")

        cta = (
            f'  <div class="cta">{html.escape(p["cta"])}</div>'
            if p.get("cta") and (fmt == "story"
                                 or gname in ("bande", "large", "scene", "affiche", "editorial", "fenetre", "carrousel"))
            else ""
        )

        # Une offre se lit en deux temps : le chiffre qu'on retient, et la
        # condition qui le rend vrai. Les séparer évite le titre-fleuve.
        # Le mot-fenêtre. La photo passe par une variable CSS plutôt que par
        # <img class="fond"> : ici elle ne couvre rien, elle ne remplit que les
        # contours des lettres.
        mot = ""
        if gname == "fenetre":
            if not p.get("mot"):
                die(f"{where} : le gabarit « fenetre » exige une clé « mot ».")
            if not p.get("fond"):
                die(f"{where} : le gabarit « fenetre » exige une clé « fond ».")
            taille = p.get("taille_mot", 320)
            mot = (f'  <div class="mot" style="font-size:{taille}px">'
                   f'{html.escape(p["mot"])}</div>')

        # Grille de services : chaque case est une icône et un libellé. Les
        # libellés viennent de l'app (rider.home.modules), pas d'une invention.
        grille = ""
        if p.get("services"):
            cases = []
            for j, sv in enumerate(p["services"], 1):
                ic = sv.get("icone", "")
                if ic not in ICONS:
                    die(f"{where}, service n°{j} : icône « {ic} » inconnue.\n"
                        f"    Disponibles : {', '.join(sorted(ICONS))}")
                cases.append(
                    f'<div class="case"><div class="ic">{ICONS[ic]}</div>'
                    f'<b>{html.escape(sv.get("nom",""))}</b></div>')
            cols = p.get("colonnes", 3)
            # La grille vit entre 292 et 868 px. On la centre dans cette bande
            # selon son nombre de rangées : six services ancrés en haut
            # laissaient 300 px de vide sous eux.
            rangees = -(-len(cases) // cols)
            haut_dispo, case_h, gap = 576, 132, 16
            hauteur = rangees * case_h + (rangees - 1) * gap
            haut = 292 + max(0, (haut_dispo - hauteur)) // 2
            grille = (f'  <div class="grille" style="--cols:{cols};top:{haut}px">'
                      + "".join(cases) + "</div>")

        # Un badge chiffré (« ÷2 », « 33322777 ») porte à 124 px ; un badge mot
        # à la même taille rivalise avec le titre et se lit comme une 3e ligne.
        # On distingue les deux sur le contenu, pas sur une clé de plus.
        if p.get("badge"):
            txt = str(p["badge"])
            mot = "" if all(c in "0123456789÷%+.-  " for c in txt) else " mot"
            badge = (
                f'  <div class="badge{mot}"><b>{html.escape(txt)}</b>'
                f'<span>{html.escape(p.get("badge_note", ""))}</span></div>'
            )
        else:
            badge = ""
        detail = (
            f'  <div class="detail">{html.escape(p["detail"])}</div>'
            if p.get("detail") else ""
        )

        nuit = p.get("theme", "jour") == "nuit"
        if p.get("theme", "jour") not in ("jour", "nuit"):
            die(f"{where} : thème « {p['theme']} » inconnu. Disponibles : jour, nuit")

        decor_name = p.get("decor", "")
        if decor_name and decor_name not in decors.NOMS:
            die(
                f"{where} : décor « {decor_name} » inconnu.\n"
                f"    Disponibles : {', '.join(decors.NOMS)}"
            )

        scene_name = p.get("scene", "")
        if scene_name and scene_name not in scenes.NOMS:
            die(
                f"{where} : scène « {scene_name} » inconnue.\n"
                f"    Disponibles : {', '.join(scenes.NOMS)}"
            )
        if scene_name and decor_name:
            die(f"{where} : « scene » et « decor » s'excluent — la scène est déjà un fond.")

        headline = (
            f"""  <div class="headline{" start" if g["start"] else ""}"""
            f"""{" tight" if p.get("surtitre_long") else ""}"""
            f"""{" tight2" if p.get("titre_long") else ""}">
    <div class="l1">{emphasise(p.get("surtitre", ""))}</div>
    <div class="l2">{emphasise(p.get("titre", ""))}</div>
  </div>"""
        )

        # Le gabarit « affiche » empile titre, badge, conditions et pastille dans
        # un seul flux ancré au bas. Positionnés en absolu, ces blocs supposaient
        # un titre d'une ligne : dès qu'il en prenait deux, il recouvrait le
        # badge. Une pile ne peut pas se chevaucher elle-même.
        if gname in ("affiche", "editorial"):
            corps = "\n".join(b for b in (headline, badge, detail, cta) if b)
            pile = f'  <div class="pile">\n{corps}\n  </div>'
            headline = badge = detail = cta = ""
        else:
            pile = ""

        blocks = [
            fond,
            scenes.horizon(nuit) if scene_name == "horizon" else "",
            decors.decor(decor_name, nuit),
            ("" if gname == "carrousel" and p.get("_carte", 0) != 0
             else BRAND.format(inline=" inline" if g["inline"] else "")),
            '  <div class="road"></div>' if g["road"] and not decor_name else "",
            headline,
            features,
            visuel,
            STAGE.format(
                tilt=" tilt" if p.get("incline") else "",
                screen=screens[screen],
                chips=chips,
            ),
            (f'  <div class="compteur">{p["_carte"] + 1}/{p["_cartes"]}</div>'
             if gname == "carrousel" else ""),
            mot,
            grille,
            badge,
            detail,
            cta,
            pile,
            ("" if gname == "carrousel"
                   and p.get("_carte", 0) != p.get("_cartes", 1) - 1
             else g["footer"]).format(
                qr_ios=qr_ios,
                qr_and=qr_and,
                phone=html.escape(str(contact.get("telephone", ""))),
                prefix=html.escape(str(contact.get("indicatif", ""))),
            ),
        ]

        html_out = PAGE.format(
            slug=slug,
            gclass=g["class"] + (" sans-pied" if gname == "carrousel"
                                 and p.get("_carte", 0) != p.get("_cartes", 1) - 1 else ""),
            fclass="story" if fmt == "story" else "",
            theme=(" story" if fmt == "story" else "") + (" nuit" if nuit else "") + (" avec-hero" if p.get("sans_telephone") or gname in ("sommaire", "editorial", "fenetre", "carrousel") else ""),
            body="\n\n".join(b for b in blocks if b),
        )
        (HERE / f"{slug}.html").write_text(html_out, encoding="utf-8")
        written.append((slug, p.get("titre", "")))
        tailles.append((slug, 1080, 1920 if fmt == "story" else 1080))
        print(f"  ✓ {slug}.html")

    cards = "".join(
        f'<figure><div class="frame"><iframe src="{s}.html" scrolling="no" '
        f'loading="lazy"></iframe></div>'
        f'<figcaption><b>{s}</b>{html.escape(t.replace("*", ""))}</figcaption></figure>'
        for s, t in written
    )
    (HERE / "index.html").write_text(
        INDEX_TEMPLATE.format(count=len(written), cards=cards), encoding="utf-8"
    )
    print("  ✓ index.html (planche de contact)")
    # render.sh lit ce manifeste pour dimensionner sa fenêtre : sans lui, une
    # story sortirait rognée à 1080 × 1080.
    (HERE / "tailles.txt").write_text(
        "".join(f"{s} {w} {h}\n" for s, w, h in tailles), encoding="utf-8")

    print(f"\n{len(written)} affiches")
    print(f"  QR App Store  → {url_ios}")
    print(f"  QR Play Store → {url_and}")


if __name__ == "__main__":
    main()
