#!/bin/bash
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is not set" >&2
  exit 1
fi

FILENAME="backup_$(date +%Y%m%d_%H%M%S).sql"

pg_dump "$DATABASE_URL" > "$FILENAME"

echo "Backup saved to $FILENAME"
