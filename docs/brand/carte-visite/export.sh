#!/usr/bin/env bash
# Exporte la carte en fichiers livrables : un PDF vectoriel pour l'imprimeur,
# deux PNG 300 dpi pour tout le reste (WhatsApp, réseaux, validation).
#
#   ./export.sh
#
# Prérequis : Google Chrome (rendu) et pdftoppm / poppler (rastérisation).
#   brew install poppler
#
# Le PDF est la pièce maîtresse : il reste VECTORIEL, donc le texte et les QR
# sont définis par des courbes et non par des pixels. Un imprimeur qui reçoit
# le PNG imprime des pixels ; avec le PDF il imprime des contours nets quelle
# que soit sa linéature.
set -euo pipefail

cd "$(dirname "$0")"

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PORT=4324   # 4323 est pris par le serveur de prévisualisation
DPI=300

[ -f carte-dirigeant.html ] || { echo "carte-dirigeant.html manquant — lance build.py d'abord"; exit 1; }

# Chrome refuse de charger les file:// avec des polices inline dans certaines
# configurations ; on sert le fichier en HTTP le temps du rendu.
python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
sleep 1

# --virtual-time-budget laisse aux @font-face en base64 le temps de se décoder
# avant la capture, sinon la carte sort en police système.
"$CHROME" \
  --headless \
  --disable-gpu \
  --no-pdf-header-footer \
  --virtual-time-budget=5000 \
  --print-to-pdf=carte-visite-print.pdf \
  "http://127.0.0.1:$PORT/carte-dirigeant.html" 2>/dev/null

# Page 1 = recto, page 2 = verso (l'ordre du HTML).
pdftoppm -r "$DPI" -png -f 1 -l 1 carte-visite-print.pdf carte-visite-recto
pdftoppm -r "$DPI" -png -f 2 -l 2 carte-visite-print.pdf carte-visite-verso
mv -f carte-visite-recto-1.png carte-visite-recto.png
mv -f carte-visite-verso-2.png carte-visite-verso.png

echo "Généré :"
ls -lh carte-visite-print.pdf carte-visite-recto.png carte-visite-verso.png | awk '{print "  " $9 "  " $5}'
