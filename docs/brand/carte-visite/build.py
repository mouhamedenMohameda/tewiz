#!/usr/bin/env python3
"""
Génère la carte de visite dirigeant Aloo — recto/verso, prête pour l'imprimeur.

    ./build.py            # écrit carte-dirigeant.html à côté de ce fichier

TOUT SE CONFIGURE DANS LE BLOC `CARTE` CI-DESSOUS. Les QR codes sont
re-générés à chaque build à partir des URLs : dès que l'App Store ID
existe, on change une ligne et on relance.

Dépendance : segno (pur Python, aucune image externe).
    python3 -m venv .venv && .venv/bin/pip install segno
"""

from __future__ import annotations

import base64
import io
from pathlib import Path

import segno

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]  # docs/brand/carte-visite -> repo root
OUT = HERE / "carte-dirigeant.html"

# --------------------------------------------------------------------------
# CARTE — les seules valeurs à éditer.
# --------------------------------------------------------------------------
CARTE = {
    # Identité du dirigeant.
    "nom": "PRÉNOM NOM",
    "fonction_fr": "Fondateur & Directeur Général",
    "fonction_ar": "المؤسس والمدير العام",
    # Contacts. Le téléphone est la ligne la plus lue de la carte : on la
    # garde courte et groupée par 2 chiffres, comme on la dicte à l'oral.
    "tel": "+222 00 00 00 00",
    "whatsapp": "+222 00 00 00 00",
    "email": "prenom@aloo.mr",
    "site": "aloo.mr",
    # Liens de téléchargement encodés dans les QR codes.
    #
    # iOS : l'App Store ID numérique n'existe qu'une fois l'app publiée /
    # créée dans App Store Connect. Tant qu'il vaut 0000000000, le QR iOS ne
    # mène nulle part — NE PAS ENVOYER À L'IMPRIMEUR AVANT DE L'AVOIR REMPLI.
    # Le build refuse d'ailleurs de tourner sans --force dans ce cas.
    "url_ios": "https://apps.apple.com/app/id0000000000",
    # Android : dérivé du bundleId de apps/mobile/brand.json (mr.tewiz.app).
    # Ce lien est valide dès la publication, aucun ID à récupérer.
    "url_android": "https://play.google.com/store/apps/details?id=mr.tewiz.app",
    # Ce qui est IMPRIMÉ sous les QR. Volontairement court : à 1,8 mm dans une
    # colonne de 14 mm, « iPhone · App Store » déborde. Le QR se charge
    # d'emmener la personne au bon endroit, le label sert juste à choisir.
    "label_ios": "iPhone",
    "label_android": "Android",
}

# --------------------------------------------------------------------------
# Palette — reprise telle quelle de apps/mobile/theme/palette.ts.
# --------------------------------------------------------------------------
EMBER = "#F2682C"
SUN = "#F6A623"
ESPRESSO = "#2A1A0E"
SABLE = "#FBF3E7"
SURFACE = "#FFFCF6"
INK = "#2C1D10"
INK2 = "#6B5740"
MUTED = "#9C886E"
LINE = "#E1CFB2"
ON_ESPRESSO = "#FBEFDD"
ON_ESPRESSO_MUTED = "#C9B49A"

FONTS = {
    "Sora400": "node_modules/@expo-google-fonts/sora/400Regular/Sora_400Regular.ttf",
    "Sora600": "node_modules/@expo-google-fonts/sora/600SemiBold/Sora_600SemiBold.ttf",
    "Sora700": "node_modules/@expo-google-fonts/sora/700Bold/Sora_700Bold.ttf",
    "Sora800": "node_modules/@expo-google-fonts/sora/800ExtraBold/Sora_800ExtraBold.ttf",
    "Cairo400": "node_modules/@expo-google-fonts/cairo/400Regular/Cairo_400Regular.ttf",
    "Cairo700": "node_modules/@expo-google-fonts/cairo/700Bold/Cairo_700Bold.ttf",
}


def font_face(family: str, weight: int, rel_path: str) -> str:
    """Une @font-face avec le TTF inline — la carte doit rester un seul fichier."""
    data = (REPO / rel_path).read_bytes()
    b64 = base64.b64encode(data).decode("ascii")
    return (
        f"@font-face{{font-family:'{family}';font-weight:{weight};font-style:normal;"
        f"font-display:block;"
        f"src:url(data:font/ttf;base64,{b64}) format('truetype');}}"
    )


# Géométrie d'impression des QR, en millimètres. Doivent rester synchronisées
# avec .qr .box dans la feuille de style — c'est sur ces valeurs qu'on vérifie
# la taille de module.
QR_BOX_MM = 16.0
# Marge blanche autour du symbole. Ce n'est pas de la décoration : sans « zone
# de silence », le scanner ne délimite pas le symbole. La norme demande 4
# modules ; 1,2 mm en vaut ~3 ici, et le sable clair de la carte prolonge la
# zone au-delà du cadre, ce qui couvre la différence.
QR_PAD_MM = 1.2
QR_ART_MM = QR_BOX_MM - 2 * QR_PAD_MM

# Taille minimale d'un module (le petit carré élémentaire) pour un offset
# correct. En dessous, l'engraissement du point ferme les blancs et le symbole
# devient illisible — le QR est « joli » à l'écran et mort sur le papier.
MODULE_MIN_MM = 0.40


def qr_svg(url: str, dark: str) -> str:
    """
    QR en SVG (vectoriel = net à n'importe quel DPI, contrairement à un PNG).

    ECC 'M' (15 % de redondance) : c'est le réglage d'impression courant. 'Q'
    ou 'H' ajoutent des modules, donc RÉDUISENT la taille de chaque module à
    surface constante — sur une carte de visite, où la contrainte est la place
    et non la saleté, monter la correction dégrade la lisibilité au lieu de
    l'améliorer.
    """
    qr = segno.make(url, error="m")
    buf = io.BytesIO()  # le writer SVG de segno écrit des octets, pas du texte
    qr.save(
        buf,
        kind="svg",
        dark=dark,
        light=None,  # fond transparent : le sable de la carte passe dessous
        border=0,  # la quiet zone est gérée en CSS (padding blanc autour)
        xmldecl=False,
        svgns=True,
        svgclass=None,
        lineclass=None,
        omitsize=True,  # on dimensionne en mm côté CSS
    )
    svg = buf.getvalue().decode("utf-8")
    # segno n'expose pas viewBox quand omitsize=True : on le remet à la main
    # pour que le SVG se mette à l'échelle du conteneur.
    n = qr.symbol_size(border=0)[0]
    svg = svg.replace("<svg ", f'<svg viewBox="0 0 {n} {n}" ', 1)
    return svg


def monogram(color: str, stroke: int = 43) -> str:
    """Le « A » d'Aloo — même géométrie que assets/brand/logo-mono-white.svg."""
    return (
        '<svg class="mono" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg" '
        'role="img" aria-label="Aloo">'
        f'<g fill="none" stroke="{color}" stroke-width="{stroke}" '
        'stroke-linecap="round" stroke-linejoin="round">'
        '<path d="M150 380 L256 143"/><path d="M362 380 L256 143"/>'
        '<path d="M194 298 L318 298"/></g></svg>'
    )


def build() -> str:
    faces = "".join(
        [
            font_face("Sora", 400, FONTS["Sora400"]),
            font_face("Sora", 600, FONTS["Sora600"]),
            font_face("Sora", 700, FONTS["Sora700"]),
            font_face("Sora", 800, FONTS["Sora800"]),
            font_face("Cairo", 400, FONTS["Cairo400"]),
            font_face("Cairo", 700, FONTS["Cairo700"]),
        ]
    )

    qr_ios = qr_svg(CARTE["url_ios"], ESPRESSO)
    qr_and = qr_svg(CARTE["url_android"], ESPRESSO)

    c = CARTE

    # Le même numéro écrit deux fois, c'est une ligne de bruit sur une carte
    # qui en compte six. Quand tél et WhatsApp sont identiques — le cas normal
    # ici — on le dit une fois et on l'annote.
    tel_html = f'<div class="tel">{c["tel"]}<em> · WhatsApp</em></div>'
    if c["whatsapp"].replace(" ", "") != c["tel"].replace(" ", ""):
        tel_html = (
            f'<div class="tel">{c["tel"]}</div>'
            f'<div class="row"><em>WhatsApp</em> {c["whatsapp"]}</div>'
        )
    contacts = tel_html + (
        f'<div class="row">{c["email"]} &nbsp;·&nbsp; {c["site"]}</div>'
    )
    return TEMPLATE.format(
        faces=faces,
        ember=EMBER,
        sun=SUN,
        espresso=ESPRESSO,
        sable=SABLE,
        surface=SURFACE,
        ink=INK,
        ink2=INK2,
        muted=MUTED,
        line=LINE,
        on_espresso=ON_ESPRESSO,
        on_espresso_muted=ON_ESPRESSO_MUTED,
        mono_sable=monogram(SABLE),
        mono_ember=monogram(EMBER),
        qr_ios=qr_ios,
        qr_and=qr_and,
        contacts=contacts,
        nom=c["nom"],
        fonction_fr=c["fonction_fr"],
        fonction_ar=c["fonction_ar"],
        label_ios=c["label_ios"],
        label_android=c["label_android"],
    )


TEMPLATE = """<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Aloo — carte de visite dirigeant</title>
<style>
{faces}

/* ------------------------------------------------------------------
   FORMAT
   Coupe 85 x 55 mm (standard international, celui que tout imprimeur
   à Nouakchott découpe sans poser de question).
   Fond perdu 3 mm sur chaque bord -> page de 91 x 61 mm.
   Marge de sécurité 4 mm depuis la coupe : rien de lisible en deçà.
   ------------------------------------------------------------------ */
:root {{
  --bleed: 3mm;
  --safe: 7mm;          /* fond perdu 3 mm + 4 mm de sécurité depuis la coupe */
  --safe-y: 7mm;
  --ember: {ember};
  --sun: {sun};
  --espresso: {espresso};
  --sable: {sable};
  --surface: {surface};
  --ink: {ink};
  --ink2: {ink2};
  --muted: {muted};
  --line: {line};
  --on-espresso: {on_espresso};
  --on-espresso-muted: {on_espresso_muted};
}}

* {{ box-sizing: border-box; margin: 0; padding: 0; }}

body {{
  font-family: 'Sora', system-ui, sans-serif;
  background: #171310;
  color: var(--ink);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14mm;
  padding: 18mm 6mm;
}}

.face {{
  position: relative;
  width: 91mm;
  height: 61mm;
  overflow: hidden;
  /* -webkit-print-color-adjust force l'impression des aplats : sans lui,
     Chrome « économise » l'encre et sort un espresso délavé. */
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}}

/* Repères de coupe — écran seulement, jamais imprimés. */
.trim {{
  position: absolute;
  inset: var(--bleed);
  border: 0.2mm dashed rgba(242, 104, 44, .55);
  pointer-events: none;
  z-index: 99;
}}

/* ==================================================================
   RECTO — la marque, rien d'autre.
   Fond espresso plein bord à bord : c'est lui qui fait le « premium »,
   et c'est sur lui que l'ember ressort sans agresser.
   ================================================================== */
.recto {{
  background: var(--espresso);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3.4mm;
  padding: var(--safe-y) var(--safe);
  /* La barre ember mange 2,5 mm à droite : on décale le bloc centré d'autant
     pour qu'il reste optiquement centré dans la zone lisible. */
  padding-right: calc(var(--safe) + 2.5mm);
}}

/* Barre ember sur le bord droit : la signature visuelle qu'on retrouve
   d'une carte à l'autre.
   Largeur = fond perdu + ce qu'on veut voir APRÈS la coupe. Une bande de
   2,6 mm posée dans un fond perdu de 3 mm disparaît entièrement au massicot ;
   c'est l'erreur classique. Ici : 3 + 2,5 -> 2,5 mm visibles. */
.recto::after {{
  content: '';
  position: absolute;
  top: 0; right: 0; bottom: 0;
  width: calc(var(--bleed) + 2.5mm);
  background: var(--ember);
}}

/* La tuile reprend l'icône de l'app à l'identique — c'est elle que la
   personne cherchera dans le store après avoir scanné. */
.tile {{
  width: 15mm;
  height: 15mm;
  border-radius: 3.4mm;
  background: var(--ember);
  display: flex;
  align-items: center;
  justify-content: center;
}}
.tile .mono {{ width: 11mm; height: 11mm; }}

.wordmark {{
  font-weight: 800;
  font-size: 8mm;
  line-height: 1;
  letter-spacing: -.18mm;
  color: var(--sable);
}}

.slogan {{
  font-weight: 600;
  font-size: 2.9mm;
  letter-spacing: .12mm;
  color: var(--on-espresso-muted);
}}
.slogan-ar {{
  font-family: 'Cairo', serif;
  font-weight: 400;
  font-size: 3.2mm;
  line-height: 1.5;
  color: var(--on-espresso-muted);
  opacity: .78;
  direction: rtl;
}}

.rule {{
  width: 9mm;
  height: .45mm;
  border-radius: .3mm;
  background: var(--ember);
  margin: .4mm 0 .2mm;
}}

/* ==================================================================
   VERSO — l'action : qui je suis, et comment on télécharge.
   ================================================================== */
.verso {{
  background: var(--sable);
  padding: var(--safe-y) var(--safe);
  padding-left: calc(var(--safe) + 2.5mm);
  display: flex;
  flex-direction: column;
}}
/* La barre du recto est à droite, celle du verso à gauche : carte retournée,
   c'est le même bord physique qui reste orange. Bande verticale plutôt
   qu'horizontale, aussi, parce que 61 mm de haut ne se dilapident pas. */
.verso::before {{
  content: '';
  position: absolute;
  top: 0; left: 0; bottom: 0;
  width: calc(var(--bleed) + 2.5mm);
  background: var(--ember);
}}

.v-head {{
  display: flex;
  align-items: center;
  gap: 1.5mm;
  margin-bottom: 1.5mm;
}}
.v-head .mono {{ width: 4.4mm; height: 4.4mm; }}
.v-head b {{
  font-weight: 800;
  font-size: 4mm;
  letter-spacing: -.08mm;
  color: var(--ink);
}}
.v-head .dot {{
  width: .8mm; height: .8mm; border-radius: 50%;
  background: var(--line);
}}
.v-head span {{
  font-weight: 500;
  font-size: 2.4mm;
  letter-spacing: .18mm;
  text-transform: uppercase;
  color: var(--muted);
}}

.nom {{
  font-weight: 700;
  font-size: 4mm;
  line-height: 1.08;
  letter-spacing: -.06mm;
  color: var(--ink);
}}
.fonction {{
  display: flex;
  align-items: baseline;
  gap: 2mm;
  margin-top: .8mm;
}}
.fonction .fr {{
  font-weight: 600;
  font-size: 2.5mm;
  letter-spacing: .1mm;
  color: var(--ember);
}}
.fonction .ar {{
  font-family: 'Cairo', serif;
  font-weight: 400;
  font-size: 2.6mm;
  color: var(--muted);
  direction: rtl;
}}

.contacts {{
  margin-top: 1.5mm;
  display: flex;
  flex-direction: column;
  gap: .7mm;
}}
.contacts .tel {{
  font-weight: 700;
  font-size: 3.3mm;
  line-height: 1.15;
  letter-spacing: .04mm;
  color: var(--ink);
}}
.contacts .row {{
  font-weight: 400;
  font-size: 2.5mm;
  color: var(--ink2);
}}
.contacts em {{
  font-style: normal;
  font-weight: 600;
  font-size: 2.4mm;
  color: var(--muted);
}}

.sep {{
  flex: 1 1 auto;
  min-height: 1mm;
  display: flex;
  align-items: center;
}}
.sep i {{
  display: block;
  width: 100%;
  height: .18mm;
  background: var(--line);
}}

/* Bloc téléchargement : l'invitation à gauche, les deux QR à droite. */
.dl {{
  display: flex;
  align-items: flex-end;
  gap: 3mm;
  padding-top: 1.6mm;
}}
.invite {{
  flex: 1 1 auto;
  padding-bottom: .4mm;
}}
.invite .big {{
  font-weight: 700;
  font-size: 3mm;
  line-height: 1.22;
  letter-spacing: -.04mm;
  color: var(--ink);
}}
.invite .big u {{
  text-decoration: none;
  color: var(--ember);
}}

.qrs {{ display: flex; gap: 2.4mm; }}
.qr {{ width: 16mm; text-align: center; }}
/* La quiet zone (marge blanche autour du QR) n'est pas décorative :
   sans elle, le scanner ne trouve pas les coins du symbole. 4 modules
   minimum -> ce padding + le fond clair. */
.qr .box {{
  width: 16mm;      /* = QR_BOX_MM */
  height: 16mm;
  padding: 1.2mm;   /* = QR_PAD_MM */
  background: var(--surface);
  border-radius: 1mm;
  /* Pas de bordure : avec box-sizing:border-box elle se prélève SUR le
     symbole (2 x 0,18 mm), ce qui faisait tomber le module Android à
     0,392 mm — sous le seuil d'impression — sans que rien ne le signale.
     Le cadre blanc sur le sable suffit à détacher le QR. */
}}
.qr .box svg {{ width: 100%; height: 100%; display: block; }}
.qr .lbl {{
  margin-top: .6mm;
  font-weight: 600;
  font-size: 1.8mm;
  line-height: 1.15;
  letter-spacing: .03mm;
  white-space: nowrap;   /* un label sur deux lignes déséquilibre la paire */
  color: var(--muted);
}}

/* ==================================================================
   IMPRESSION — une face par page, à la taille exacte, sans marge.
   ================================================================== */
@page {{ size: 91mm 61mm; margin: 0; }}

@media print {{
  body {{ background: #fff; padding: 0; gap: 0; display: block; }}
  .trim, .screen-only {{ display: none !important; }}
  .face {{ page-break-after: always; break-after: page; }}
  .face:last-of-type {{ page-break-after: auto; break-after: auto; }}
}}

/* Légendes de prévisualisation. */
.screen-only {{
  width: 91mm;
  color: #8b7862;
  font-size: 3mm;
  font-weight: 600;
  letter-spacing: .3mm;
  text-transform: uppercase;
  margin-bottom: -10mm;
}}
</style>
</head>
<body>

<p class="screen-only">Recto</p>
<section class="face recto">
  <div class="trim"></div>
  <div class="tile">{mono_sable}</div>
  <div class="wordmark">Aloo</div>
  <div class="rule"></div>
  <div class="slogan">Parle. On t'amène.</div>
  <div class="slogan-ar">احكي... ونوصّلوك</div>
</section>

<p class="screen-only">Verso</p>
<section class="face verso">
  <div class="trim"></div>

  <div class="v-head">
    {mono_ember}
    <b>Aloo</b>
    <i class="dot"></i>
    <span>L'app de course mauritanienne</span>
  </div>

  <div class="nom">{nom}</div>
  <div class="fonction">
    <span class="fr">{fonction_fr}</span>
    <span class="ar">{fonction_ar}</span>
  </div>

  <div class="contacts">{contacts}</div>

  <div class="sep"><i></i></div>

  <div class="dl">
    <div class="invite">
      <div class="big">Scanne, télécharge,<br>demande ta course.<br><u>La première est offerte.</u></div>
    </div>
    <div class="qrs">
      <div class="qr">
        <div class="box">{qr_ios}</div>
        <div class="lbl">{label_ios}</div>
      </div>
      <div class="qr">
        <div class="box">{qr_and}</div>
        <div class="lbl">{label_android}</div>
      </div>
    </div>
  </div>
</section>

</body>
</html>
"""


def check_modules() -> list[str]:
    """
    Vérifie que chaque QR reste imprimable à la taille prévue.

    Une URL plus longue = plus de modules = des modules plus petits, à surface
    constante. C'est le piège : on remplace un lien par un autre « juste un peu
    plus long », le HTML ne change pas d'un pixel, et la carte revient de chez
    l'imprimeur avec un QR que personne n'arrive à scanner.
    """
    warnings = []
    for label, url in (("iOS", CARTE["url_ios"]), ("Android", CARTE["url_android"])):
        n = segno.make(url, error="m").symbol_size(border=0)[0]
        mm = QR_ART_MM / n
        # Tolérance : 13.2/33 vaut 0.39999999999999997 en binaire, et pile
        # 0,400 mm doit passer.
        ok = mm >= MODULE_MIN_MM - 1e-9
        print(f"  {label:8} {n:>2} modules  {mm:.3f} mm/module  [{'ok' if ok else 'TROP DENSE'}]")
        if not ok:
            warnings.append(
                f"QR {label} : {mm:.3f} mm/module (< {MODULE_MIN_MM} mm). "
                f"Raccourcis l'URL (ex. {CARTE['site']}/"
                f"{'ios' if label == 'iOS' else 'android'} en redirection) "
                f"ou agrandis QR_BOX_MM."
            )
    return warnings


def main() -> None:
    import sys

    if "id0000000000" in CARTE["url_ios"] and "--force" not in sys.argv:
        print(
            "STOP : url_ios est encore le gabarit (id0000000000).\n"
            "Le QR iOS ne mènerait nulle part une fois imprimé.\n"
            "Renseigne l'App Store ID dans CARTE, ou relance avec --force\n"
            "pour produire une maquette de validation (à NE PAS imprimer).",
            file=sys.stderr,
        )
        raise SystemExit(1)

    warnings = check_modules()
    OUT.write_text(build(), encoding="utf-8")
    kb = OUT.stat().st_size / 1024
    print(f"OK -> {OUT}  ({kb:.0f} Ko)")
    for w in warnings:
        print(f"ATTENTION : {w}")


if __name__ == "__main__":
    main()
