#!/usr/bin/env bash
# لمسة عطر — *.html -> *.png (@2x) via Chrome headless.
set -uo pipefail
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
[ -x "$CHROME" ] || CHROME="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
HERE="$(cd "$(dirname "$0")" && pwd)"; PORT=4411
PY=/Users/mohameda/Desktop/course/ads/.venv/bin/python

curl -sf "http://localhost:$PORT/" -o /dev/null 2>&1 || {
  python3 -m http.server "$PORT" --directory "$HERE" >/dev/null 2>&1 & S=$!; sleep 1; }
trap '[ -n "${S:-}" ] && kill $S 2>/dev/null; true' EXIT

while read -r slug w h; do
  [ -n "$slug" ] || continue
  rm -f "$HERE/$slug.png"
  # Chrome headless ne rend pas toujours la main : on le lance en tâche de fond
  # et on le tue dès que le PNG est écrit (ou au bout de 45 s).
  "$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
    --window-size="$w,$((h+200))" --virtual-time-budget=6000 \
    --screenshot="$HERE/$slug.png" "http://localhost:$PORT/$slug.html" >/dev/null 2>&1 &
  CPID=$!
  for _ in $(seq 90); do [ -s "$HERE/$slug.png" ] && break; sleep 0.5; done
  sleep 1; kill -9 $CPID 2>/dev/null; wait $CPID 2>/dev/null
  if [ ! -s "$HERE/$slug.png" ]; then echo "  ✗ $slug — pas de rendu"; continue; fi
  "$PY" - "$HERE/$slug.png" "$w" "$h" <<'PY'
import sys
from PIL import Image
f,w,h=sys.argv[1],int(sys.argv[2])*2,int(sys.argv[3])*2
im=Image.open(f)
if im.size!=(w,h): im.crop((0,0,w,h)).save(f)
PY
  echo "  ✓ $slug.png"
done < "$HERE/tailles.txt"
