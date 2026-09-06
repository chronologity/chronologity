#!/usr/bin/env bash
#
# Start Chronologity's local infrastructure and make it usable.
#
# `docker compose up --wait` returns a healthy stack, which is not the same as
# a working one. PostgreSQL arrives with its database already created, because
# the image does that from `POSTGRES_DB`. Object storage has no equivalent, so
# the media bucket has to be created explicitly — and until it was, it existed
# only because whichever integration suite ran first happened to create it.
#
# That was not a theory. `account-deletion.integration.test.ts` sorts before
# `media-checker.integration.test.ts`, which is the only suite that created the
# bucket, so on a stack with fresh storage account erasure always ran first and
# always failed: erasing a Moment deletes its media, storage answered "The
# specified bucket does not exist", and the erasure retried forever. It failed
# every CI run and no local run, because a developer's storage volume already
# had the bucket in it from the last time.
#
# Usage: pnpm infra:up

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE=(bash "$ROOT/scripts/compose.sh")

"${COMPOSE[@]}" up --detach --wait

# Read after `compose.sh` has had its chance to seed .env from .env.example, so
# a first run on a fresh clone reads the file that call just created.
set -a
# shellcheck disable=SC1091
[ -f "$ROOT/.env" ] && . "$ROOT/.env"
set +a

S3_BUCKET="${S3_BUCKET:-chronologity-media}"

# Through `weed shell` rather than the S3 API, which would mean signing a
# request from bash. Creating a bucket that already exists succeeds and changes
# nothing, so this runs on every `infra:up` rather than only the first.
#
# **Attempted repeatedly, because healthy is not the same as ready.** The
# healthcheck asks the S3 gateway for a response and gets one; creating a bucket
# needs the filer, which connects to the master separately and a few seconds
# later. On a developer's machine the volume already holds the bucket from last
# time, so the gap is invisible; on CI, where storage is always fresh, it is a
# race — and it was lost on 2026-09-06, with the run failing on a change that
# touched nothing to do with storage.
#
# Each attempt is bounded, because `weed shell` retries an unreachable master
# rather than giving up, and an `infra:up` that hangs is worse on CI than one
# that fails: the job is killed at its limit with nothing said about why.
attempt=1
until [ "${attempt}" -gt 12 ]; do
  "${COMPOSE[@]}" exec -T storage \
    sh -c "echo 's3.bucket.create -name ${S3_BUCKET}' | timeout 30 weed shell -master=localhost:9333" \
    > /dev/null 2>&1 || true

  # Asked for rather than assumed. `weed shell` exits zero whatever happens — a
  # bogus command, an unreachable master, a bucket it never created — so its
  # status says nothing and checking it would be a guard that cannot fail.
  # Listing the buckets and looking for this one is a question with a real
  # answer.
  if "${COMPOSE[@]}" exec -T storage \
    sh -c "echo 's3.bucket.list' | timeout 30 weed shell -master=localhost:9333" 2>&1 \
    | grep -q "[[:space:]]${S3_BUCKET}[[:space:]]"; then
    echo "Storage bucket '${S3_BUCKET}' ready"
    exit 0
  fi

  attempt=$((attempt + 1))
  sleep 5
done

echo "Storage came up but bucket '${S3_BUCKET}' does not exist after a minute." >&2
echo "Media uploads and erasure will both fail until it does." >&2
exit 1
