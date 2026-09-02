#!/usr/bin/env bash
#
# Thin wrapper around `docker compose` for Chronologity's local infrastructure.
#
# It exists so that the compose file and .env.example cannot drift apart: local
# overrides always come from a real .env, which is seeded from .env.example on
# first use. The compose file also carries defaults matching .env.example, so a
# missing variable degrades to the documented value rather than to an empty one.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ ! -f "$ROOT/.env" ]; then
  cp "$ROOT/.env.example" "$ROOT/.env"
  echo "Created .env from .env.example"
fi

exec docker compose --env-file "$ROOT/.env" -f "$ROOT/docker/compose.yaml" "$@"
