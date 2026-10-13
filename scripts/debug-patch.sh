#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
FILE=${2:-"$SCRIPT_DIR/../dtf.user.js"}
BACKUP="$FILE.debug-backup"
CHECKSUM="$FILE.debug-checksum"
MODE=${1:-apply}

if [ ! -f "$FILE" ]; then
  echo "File not found: $FILE" >&2
  exit 1
fi

case "$MODE" in
  apply)
    if grep -q 'DTF_DEBUG_PATCH' "$FILE"; then
      echo "Debug patch already applied: $FILE"
      exit 0
    fi
    if [ -e "$BACKUP" ] || [ -e "$CHECKSUM" ]; then
      echo "Backup already exists: $BACKUP; restore it before applying again." >&2
      exit 1
    fi
    cp -p "$FILE" "$BACKUP"
    if ! python3 - "$FILE" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
source = path.read_text()
replacements = {
    '  "use strict";\n': '''  "use strict";\n\n  // DTF_DEBUG_PATCH\n  const __dtfTrace = (event, details = {}) => {\n    const traces = (window.__DTF_TRACE__ ||= []);\n    const record = { time: new Date().toISOString(), event, ...details };\n    traces.push(record);\n    if (traces.length > 500) traces.shift();\n    console.debug("[DTF trace]", record);\n  };\n''',
    '    const initialCount = feedPosts().length;\n': '    const initialCount = feedPosts().length;\n    __dtfTrace("feed.load.start", { initialCount, target });\n',
    '        feedPageSize = count - previousCount;\n': '        feedPageSize = count - previousCount;\n        __dtfTrace("feed.page.loaded", { previousCount, count, pageSize: feedPageSize });\n',
    '      feedLoading = false;\n': '      feedLoading = false;\n      __dtfTrace("feed.load.finish", { count: feedPosts().length });\n',
}
for anchor, replacement in replacements.items():
    count = source.count(anchor)
    if count != 1:
        print(f"Expected one patch anchor, found {count}: {anchor.strip()}", file=sys.stderr)
        sys.exit(1)
    source = source.replace(anchor, replacement, 1)
tmp = path.with_name(path.name + ".debug-tmp")
tmp.write_text(source)
tmp.replace(path)
PY
    then
      rm -f "$BACKUP" "$CHECKSUM"
      exit 1
    fi
    sha256sum "$FILE" > "$CHECKSUM"
    echo "Debug patch applied. Original saved as: $BACKUP"
    ;;
  restore)
    if [ ! -f "$BACKUP" ]; then
      echo "Backup not found: $BACKUP" >&2
      exit 1
    fi
    if [ ! -f "$CHECKSUM" ] || ! sha256sum --check --status "$CHECKSUM"; then
      echo "Patched file changed; refusing to overwrite local edits." >&2
      exit 1
    fi
    mv "$BACKUP" "$FILE"
    rm -f "$CHECKSUM"
    echo "Original restored: $FILE"
    ;;
  *)
    echo "Usage: $0 [apply|restore] [path/to/dtf.user.js]" >&2
    exit 2
    ;;
esac
