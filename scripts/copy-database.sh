#!/usr/bin/env bash
# Copies one Postgres database into another, empty one. Needs Docker.
# Asks for both addresses without showing them, so passwords stay out of the terminal history.
set -euo pipefail

[ -n "${SOURCE_URL:-}" ] || { read -rsp "Address of the database to copy from: " SOURCE_URL; echo; }
[ -n "${TARGET_URL:-}" ] || { read -rsp "Address of the empty database to copy into: " TARGET_URL; echo; }
export SOURCE_URL TARGET_URL

counts="SELECT 'users ' || count(*) FROM users UNION ALL SELECT 'trips ' || count(*) FROM trips UNION ALL SELECT 'files ' || count(*) FROM files UNION ALL SELECT 'file_blobs ' || count(*) FROM file_blobs UNION ALL SELECT 'migrations ' || count(*) FROM _prisma_migrations"

docker run --rm -e SOURCE_URL -e TARGET_URL -e counts="$counts" postgres:17 bash -c '
  set -euo pipefail
  existing=$(psql "$TARGET_URL" -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema = '\''public'\''")
  if [ "$existing" != "0" ]; then
    echo "Stopped: the target already has $existing tables, and it must be empty." >&2
    exit 1
  fi
  echo "Copying..."
  pg_dump "$SOURCE_URL" --no-owner --no-acl | psql "$TARGET_URL" --quiet --single-transaction -v ON_ERROR_STOP=1 > /dev/null
  echo "Source:"
  psql "$SOURCE_URL" -Atc "$counts"
  echo "Target:"
  psql "$TARGET_URL" -Atc "$counts"
'
echo "Done."
