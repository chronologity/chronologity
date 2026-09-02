#!/usr/bin/env bash
#
# Apply both sets of migrations to the local development stores.
#
# The relational schema and the ClickHouse projections, in that order, against
# whatever `.env` points at. Nothing is dropped: this brings an existing
# database up to date, where `db:reset` empties it first.
#
# It exists because the migration runners are compiled CLIs that read the
# process environment, and nothing puts `.env` there. Every other entry point
# solves that for itself — `compose.sh` passes `--env-file`, the integration
# vitest configs call `process.loadEnvFile`, `reset-database.sh` sources it —
# and running the runners by hand was the one path that did not, which cost a
# CI run and a local debugging session before this existed.
#
# Usage: pnpm db:migrate

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

# The migration runners are compiled, so the build has to be current or this
# applies yesterday's schema. Through turbo rather than a filter, because the
# API's own build does not build the packages it imports and a worktree that has
# never been built fails on those rather than on anything to do with the schema.
# Cached, so the usual cost of saying so is nothing.
pnpm build

pnpm --filter @chronologity/api migrate

# Separate from the relational runner because every statement it holds is
# repeatable and takes no lock, which is not true of the migrations above.
pnpm --filter @chronologity/api clickhouse:migrate

echo "Done. '${POSTGRES_DATABASE:-chronologity}' is migrated."
