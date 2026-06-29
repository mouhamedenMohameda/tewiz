#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_FILE="$ROOT_DIR/docs/project-tree.md"
GENERATED_AT="$(date -u +"%Y-%m-%d %H:%M:%S UTC")"

cd "$ROOT_DIR"

find . -maxdepth 4 \
  \( -name node_modules -o -name .git -o -name .next -o -name dist -o -name build -o -name coverage -o -name .expo -o -name .turbo -o -name .cache \) -prune \
  -o -print \
  | sed 's#^\./##' \
  | grep -v '^$' \
  | grep -v '\.DS_Store$' \
  | awk -F/ 'NF{indent=""; for(i=1;i<NF;i++) indent=indent "  "; print indent $NF}' \
  > /tmp/project-tree.txt

cat > "$OUT_FILE" <<EOF
# Project Tree Snapshot

- Generated: $GENERATED_AT
- Root: $(basename "$ROOT_DIR")
- Source: scripts/update-project-tree.sh


The snapshot below is depth-limited to keep it readable and cheap to refresh.

\`\`\`text
$(cat /tmp/project-tree.txt)
\`\`\`
EOF

rm -f /tmp/project-tree.txt

echo "Updated $OUT_FILE"
