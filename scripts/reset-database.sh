#!/usr/bin/env bash
#
# Drop the local development database, recreate it, and migrate it.
#
# CI starts from nothing every run; a developer's machine does not, and the
# difference is not cosmetic. Integration suites create Users, Moments,
# Locations and search documents and almost none of them clean up — the state
# accumulates for as long as the volume lives. Past a certain size it stops
# being harmless and starts producing failures that belong to the database
# rather than to the code: a bounded page filling with other runs' rows before
# it reaches the row under test, or a "did you mean" correction finding a real
# match among thirty thousand accumulated names.
#
# Those failures cost an hour each to chase and none of them means anything.
# This makes a clean start cheap, so the local suite can be trusted the way the
# CI one is.
#
# Both stores, because resetting one is worse than resetting neither. The
# Timeline projection in ClickHouse describes Moments in PostgreSQL, so dropping
# only the relational database leaves rows asserting the existence and occurrence
# time of history that no longer exists — a projection of a database that has
# been wiped. A rebuild would clear it, and a rebuild is not what somebody
# reaching for a reset is asking for.
#
# Everything else is left alone. Kafka keeps its log and object storage keeps
# its objects: both are addressed by identifiers this run will not reuse, so
# neither causes the interference above. `pnpm infra:reset` is still the way to
# discard those, and it discards the containers with them.
#
# Usage: pnpm db:reset, or pnpm test:integration:clean to reset and then run
# the suite. Deliberately not wired into `test:integration`: running one file
# while chasing a failure should stay fast, and the state a failure left behind
# is often the thing worth looking at.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Seeded the same way `compose.sh` does it, so running this first on a fresh
# clone behaves rather than reading an absent file.
if [ ! -f "$ROOT/.env" ]; then
  cp "$ROOT/.env.example" "$ROOT/.env"
  echo "Created .env from .env.example"
fi

set -a
# shellcheck disable=SC1091
. "$ROOT/.env"
set +a

POSTGRES_HOST="${POSTGRES_HOST:-localhost}"
POSTGRES_USER="${POSTGRES_USER:-chronologity}"
POSTGRES_DATABASE="${POSTGRES_DATABASE:-chronologity}"

CLICKHOUSE_URL="${CLICKHOUSE_URL:-http://localhost:8123}"
CLICKHOUSE_DATABASE="${CLICKHOUSE_DATABASE:-chronologity}"
CLICKHOUSE_USERNAME="${CLICKHOUSE_USERNAME:-chronologity}"

# The host alone, for the same guard the relational one gets. `http://host:8123`
# with the scheme and then the port or path removed; a bare host survives both.
CLICKHOUSE_HOST="${CLICKHOUSE_URL#*://}"
CLICKHOUSE_HOST="${CLICKHOUSE_HOST%%[:/]*}"

# The one guard that matters. This drops a database, and the only database it
# may ever drop is one running on this machine for this developer. A .env
# pointing anywhere else is a mistake worth refusing rather than interpreting.
for target in "postgres:$POSTGRES_HOST" "clickhouse:$CLICKHOUSE_HOST"; do
  case "${target#*:}" in
    localhost | 127.0.0.1 | ::1 | postgres | clickhouse) ;;
    *)
      echo "Refusing to drop the ${target%%:*} database on '${target#*:}'." >&2
      echo "This resets local development only." >&2
      exit 1
      ;;
  esac
done

echo "Resetting '$POSTGRES_DATABASE' on $POSTGRES_HOST"

# Through the container rather than a host `psql`, which is not something a
# contributor should have to install to run the test suite. `postgres` is the
# maintenance database to connect to, since the one being dropped cannot be.
#
# Sessions are terminated first: a dropped database must have no connections,
# and a stray one left by an editor or a still-running worker is the ordinary
# case rather than the exceptional one.
bash "$ROOT/scripts/compose.sh" exec -T postgres psql \
  --username "$POSTGRES_USER" \
  --dbname postgres \
  --quiet \
  --set ON_ERROR_STOP=1 \
  --command "SELECT pg_terminate_backend(pid) FROM pg_stat_activity
              WHERE datname = '$POSTGRES_DATABASE' AND pid <> pg_backend_pid()" \
  --command "DROP DATABASE IF EXISTS \"$POSTGRES_DATABASE\"" \
  --command "CREATE DATABASE \"$POSTGRES_DATABASE\" OWNER \"$POSTGRES_USER\"" \
  > /dev/null

# The projection store, dropped the same way and for the same reason. A
# `DROP DATABASE` rather than a truncation of each table, so a table left behind
# by a migration that has since been rewritten goes too — the relational path
# gets that property from dropping the database, and this should not be the half
# that quietly accumulates.
#
# Credentials travel as environment rather than as arguments: `clickhouse-client`
# reads CLICKHOUSE_USER and CLICKHOUSE_PASSWORD itself, and a password in a
# command line is a password in every process listing on the machine.
echo "Resetting '$CLICKHOUSE_DATABASE' on $CLICKHOUSE_HOST"

bash "$ROOT/scripts/compose.sh" exec -T \
  -e CLICKHOUSE_USER="$CLICKHOUSE_USERNAME" \
  -e CLICKHOUSE_PASSWORD \
  clickhouse clickhouse-client \
  --query "DROP DATABASE IF EXISTS \"$CLICKHOUSE_DATABASE\"" \
  > /dev/null

bash "$ROOT/scripts/compose.sh" exec -T \
  -e CLICKHOUSE_USER="$CLICKHOUSE_USERNAME" \
  -e CLICKHOUSE_PASSWORD \
  clickhouse clickhouse-client \
  --query "CREATE DATABASE \"$CLICKHOUSE_DATABASE\"" \
  > /dev/null

echo "Recreated. Migrating."

# The migration runner is compiled, so the build has to be current or this runs
# yesterday's schema against today's empty database. Through turbo rather than
# a filter, because the API's own build does not build the packages it imports
# and a worktree that has never been built fails on those rather than on
# anything to do with the schema. Cached, so the usual cost of saying so is
# nothing — and left unsilenced, because a build that fails quietly here looks
# exactly like a migration that did not run.
pnpm build
pnpm --filter @chronologity/api migrate

# The projection tables, from the second runner. Separate from the relational
# one because every statement it holds is repeatable and takes no lock, which is
# not true of the migrations above.
pnpm --filter @chronologity/api clickhouse:migrate

echo "Done. '$POSTGRES_DATABASE' is empty and migrated."
