#!/usr/bin/env bash
#
# Create a migration file with a UTC timestamp prefix.
#
# Usage: ./scripts/new-migration.sh add_moments

set -euo pipefail

if [ $# -ne 1 ]; then
  echo "Usage: $0 <name>   (lowercase, words separated by underscores)" >&2
  exit 1
fi

NAME="$1"

if ! printf '%s' "$NAME" | grep -Eq '^[a-z0-9]+(_[a-z0-9]+)*$'; then
  echo "Name must be lowercase words separated by underscores, e.g. add_moments" >&2
  exit 1
fi

DIRECTORY="$(cd "$(dirname "$0")/.." && pwd)/migrations"
# UTC, not local time: migrations are ordered by this, and a contributor in
# another timezone must not be able to write a migration that sorts before one
# already applied.
FILE="$DIRECTORY/$(date -u +%Y%m%d%H%M%S)_${NAME}.sql"

cat > "$FILE" <<TEMPLATE
-- ${NAME}
--
-- Applied in filename order, once, inside a transaction. Editing this file
-- after it has been applied anywhere changes nothing: write a new migration.
TEMPLATE

echo "Created ${FILE#"$(cd "$(dirname "$0")/../../.." && pwd)/"}"
