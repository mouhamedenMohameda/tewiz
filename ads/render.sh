#!/usr/bin/env bash
# Aloo — .html -> .png 2160 × 2160 (1080 @2x) via Chrome headless.
# Le serveur local est nécessaire : Chrome refuse de charger les polices et les
# images en file:// depuis une page file://.
set -euo pipefail

# Chrome d'abord ; à défaut, un autre Chromium. Le rendu est identique — ce
# sont les mêmes moteurs — mais Chrome reste prioritaire pour ne rien changer
# aux sorties déjà validées. Sans cette liste, la disparition de Chrome fait
# échouer le rendu en silence si l'on redirige la sortie.
CANDIDATS=(
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  "/Applications/Chromium.app/Contents/MacOS/Chromium"
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
)
CHROME=""
for c in "${CANDIDATS[@]}"; do [ -x "$c" ] && { CHROME="$c"; break; }; done
PORT=4399
HERE="$(cd "$(dirname "$0")" && pwd)"

if [ -z "$CHROME" ]; then
  echo "Aucun navigateur Chromium trouvé. Cherchés :"
  printf '  %s\n' "${CANDIDATS[@]}"
  exit 1
fi
echo "Moteur de rendu : $CHROME"

# Deux rendus lancés en même temps se disputent Chrome et se bloquent l'un
# l'autre — chacun attend une instance que l'autre tient. Un verrou évite ça.
LOCK="$HERE/.render.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  echo "Un rendu est déjà en cours (verrou : $LOCK)."
  echo "S'il s'agit d'un reliquat, supprimez-le : rmdir '$LOCK'"
  exit 1
fi
STARTED=""
# Un seul trap : un second effacerait celui-ci, et le verrou resterait posé.
cleanup() {
  [ -n "$STARTED" ] && kill "$STARTED" 2>/dev/null
  rmdir "$LOCK" 2>/dev/null
  return 0
}
trap cleanup EXIT

# Serveur jetable si rien n'écoute déjà sur le port.
if ! curl -sf "http://localhost:$PORT/" -o /dev/null 2>&1; then
  python3 -m http.server "$PORT" --directory "$HERE" >/dev/null 2>&1 &
  STARTED=$!
  sleep 1
fi

for f in "$HERE"/*.html; do
  slug="$(basename "$f" .html)"
  # index.html est la planche de contact, pas une affiche : elle se consulte
  # dans un navigateur et n'a rien à faire en PNG carré.
  [ "$slug" = "index" ] && continue
  # Chaque affiche porte sa taille dans tailles.txt — une story fait 1920 de
  # haut et sortirait rognée avec une fenêtre carrée.
  taille="$(awk -v s="$slug" '$1==s {print $2","$3}' "$HERE/tailles.txt")"
  [ -n "$taille" ] || taille="1080,1080"
  # Certains Chromium (Brave) réservent ~80 px de hauteur pour leur interface :
  # le viewport est alors plus court que --window-size, et `overflow:hidden`
  # rogne le bas de l'affiche — pied de page et QR coupés, donc illisibles. On
  # rend plus haut que nécessaire, puis on recadre à la taille exacte. Sans
  # effet sur un moteur qui ne rogne pas.
  larg="${taille%,*}"; haut="${taille#*,}"
  "$CHROME" --headless --disable-gpu --hide-scrollbars \
    --force-device-scale-factor=2 --window-size="$larg,$((haut + 200))" \
    --virtual-time-budget=6000 \
    --screenshot="$HERE/$slug.png" \
    "http://localhost:$PORT/$slug.html" 2>/dev/null
  "$HERE/.venv/bin/python" - "$HERE/$slug.png" "$larg" "$haut" <<'PYCROP'
import sys
from PIL import Image
f, w, h = sys.argv[1], int(sys.argv[2]) * 2, int(sys.argv[3]) * 2
im = Image.open(f)
if im.size != (w, h):
    im.crop((0, 0, w, h)).save(f)
PYCROP
  echo "  ✓ $slug.png"
done

echo
echo "PNG 2160 × 2160 prêts dans $HERE"
