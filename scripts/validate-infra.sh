#!/usr/bin/env bash
#
# Validate Chronologity's local development infrastructure.
#
# Phase 1 requires more than "the containers are running": each service must be
# reachable from the host and must perform a representative operation. Every
# check below therefore reads or writes real data and cleans up after itself.
#
# Usage: pnpm infra:validate

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE=(bash "$ROOT/scripts/compose.sh")
[ -f "$ROOT/.env" ] && set -a && . "$ROOT/.env" && set +a

POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_USER="${POSTGRES_USER:-chronologity}"
POSTGRES_DATABASE="${POSTGRES_DATABASE:-chronologity}"
KAFKA_PORT="${KAFKA_PORT:-9092}"
CLICKHOUSE_HTTP_PORT="${CLICKHOUSE_HTTP_PORT:-8123}"
CLICKHOUSE_USERNAME="${CLICKHOUSE_USERNAME:-chronologity}"
CLICKHOUSE_PASSWORD="${CLICKHOUSE_PASSWORD:-chronologity}"
CLICKHOUSE_DATABASE="${CLICKHOUSE_DATABASE:-chronologity}"
S3_PORT="${S3_PORT:-8333}"

FAILURES=0
RUN_ID="probe_$(date +%s)"

pass() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail() {
  printf '  \033[31m✗\033[0m %s\n' "$1"
  FAILURES=$((FAILURES + 1))
}
section() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# Host-side TCP reachability, independent of any client library.
host_can_reach() {
  local host="$1" port="$2"
  (exec 3<>"/dev/tcp/${host}/${port}") 2>/dev/null && exec 3>&- && return 0
  return 1
}

# ─────────────────────────────────────────────────────────────────
section "PostgreSQL (localhost:${POSTGRES_PORT})"

if host_can_reach 127.0.0.1 "$POSTGRES_PORT"; then
  pass "host reaches port ${POSTGRES_PORT}"
else
  fail "host cannot reach port ${POSTGRES_PORT}"
fi

if "${COMPOSE[@]}" exec -T postgres psql -v ON_ERROR_STOP=1 -q \
  -U "$POSTGRES_USER" -d "$POSTGRES_DATABASE" -c "
    CREATE TABLE ${RUN_ID} (id int primary key, occurred_at timestamptz not null);
    INSERT INTO ${RUN_ID} VALUES (1, now());
    SELECT count(*) FROM ${RUN_ID};
    DROP TABLE ${RUN_ID};" >/dev/null 2>&1; then
  pass "create table, insert, select, drop"
else
  fail "could not complete a write/read cycle"
fi

# ─────────────────────────────────────────────────────────────────
section "Kafka (localhost:${KAFKA_PORT})"

if host_can_reach 127.0.0.1 "$KAFKA_PORT"; then
  pass "host reaches port ${KAFKA_PORT}"
else
  fail "host cannot reach port ${KAFKA_PORT}"
fi

KBIN=/opt/kafka/bin
if "${COMPOSE[@]}" exec -T kafka "${KBIN}/kafka-topics.sh" \
  --bootstrap-server localhost:9092 --create --topic "$RUN_ID" \
  --partitions 1 --replication-factor 1 >/dev/null 2>&1; then
  pass "create topic"
else
  fail "could not create a topic"
fi

if echo "probe-message" | "${COMPOSE[@]}" exec -T kafka "${KBIN}/kafka-console-producer.sh" \
  --bootstrap-server localhost:9092 --topic "$RUN_ID" >/dev/null 2>&1 &&
  "${COMPOSE[@]}" exec -T kafka "${KBIN}/kafka-console-consumer.sh" \
    --bootstrap-server localhost:9092 --topic "$RUN_ID" \
    --from-beginning --max-messages 1 --timeout-ms 15000 2>/dev/null | grep -q "probe-message"; then
  pass "produce and consume a message"
else
  fail "could not round-trip a message"
fi

"${COMPOSE[@]}" exec -T kafka "${KBIN}/kafka-topics.sh" \
  --bootstrap-server localhost:9092 --delete --topic "$RUN_ID" >/dev/null 2>&1

# ─────────────────────────────────────────────────────────────────
section "ClickHouse (localhost:${CLICKHOUSE_HTTP_PORT})"

CH="http://127.0.0.1:${CLICKHOUSE_HTTP_PORT}"
CH_AUTH=(--user "${CLICKHOUSE_USERNAME}:${CLICKHOUSE_PASSWORD}")

if host_can_reach 127.0.0.1 "$CLICKHOUSE_HTTP_PORT"; then
  pass "host reaches port ${CLICKHOUSE_HTTP_PORT}"
else
  fail "host cannot reach port ${CLICKHOUSE_HTTP_PORT}"
fi

if curl --fail --silent "${CH}/ping" | grep -q "Ok"; then
  pass "responds to ping"
else
  fail "ping did not respond"
fi

ch_query() { curl --fail --silent "${CH_AUTH[@]}" "${CH}/?database=${CLICKHOUSE_DATABASE}" --data-binary "$1"; }

if ch_query "CREATE TABLE ${RUN_ID} (id UInt64, occurred_at DateTime64(3)) ENGINE = MergeTree ORDER BY (occurred_at, id)" >/dev/null 2>&1 &&
  ch_query "INSERT INTO ${RUN_ID} VALUES (1, now64(3))" >/dev/null 2>&1 &&
  [ "$(ch_query "SELECT count() FROM ${RUN_ID}" 2>/dev/null | tr -d '[:space:]')" = "1" ]; then
  pass "create MergeTree table, insert, select"
  ch_query "DROP TABLE ${RUN_ID}" >/dev/null 2>&1
else
  fail "could not complete a write/read cycle"
  ch_query "DROP TABLE IF EXISTS ${RUN_ID}" >/dev/null 2>&1
fi

# ─────────────────────────────────────────────────────────────────
section "Object storage (localhost:${S3_PORT})"

if host_can_reach 127.0.0.1 "$S3_PORT"; then
  pass "TCP reachable from the host"
else
  fail "TCP unreachable from the host"
fi

# An unsigned request must be refused. A 403 proves the gateway is serving and
# authenticating; anything else means it is not ready, or worse, is open.
S3_STATUS="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  "http://127.0.0.1:${S3_PORT}/" 2>/dev/null)"

if [ "$S3_STATUS" = "403" ]; then
  pass "S3 gateway serving and refusing unsigned requests"
else
  fail "S3 gateway answered ${S3_STATUS:-nothing}, expected 403"
fi

# A real round trip through a presigned URL, which is how media is actually
# uploaded. Signing by hand in bash is not worth it, so this uses the SDK the
# application uses, via the API workspace where it is installed.
if S3_PROBE="$(cd "$ROOT/apps/api" && S3_PORT="$S3_PORT" node --input-type=module -e '
import { S3Client, CreateBucketCommand, PutObjectCommand, HeadObjectCommand,
         DeleteObjectCommand, DeleteBucketCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Fixed rather than unique per run. Every bucket becomes a SeaweedFS
// collection that claims volumes of its own, so a fresh name each time
// leaks a collection per validation until nothing can allocate.
const bucket = "infra-probe";
const key = "uploads/probe/original";
const client = new S3Client({
  endpoint: `http://127.0.0.1:${process.env.S3_PORT}`,
  region: process.env.S3_REGION ?? "us-east-1",
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "chronologity",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "chronologity-local-secret",
  },
});

try {
  await client.send(new CreateBucketCommand({ Bucket: bucket }));
} catch (error) {
  // Left behind by a previous run that failed before cleaning up. Reusing it
  // is the point of a fixed name.
  const name = error?.name;
  if (name !== "BucketAlreadyOwnedByYou" && name !== "BucketAlreadyExists") throw error;
}
const url = await getSignedUrl(client,
  new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: "image/jpeg" }),
  { expiresIn: 120 });

const put = await fetch(url, { method: "PUT", body: Buffer.from("probe"),
  headers: { "content-type": "image/jpeg" } });
if (!put.ok) throw new Error(`presigned PUT returned ${put.status}`);

const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
if (head.ContentLength !== 5) throw new Error(`stored ${head.ContentLength} bytes, expected 5`);

// The property the whole upload design rests on: one signature, one key.
const tampered = url.replace("/original?", "/elsewhere?");
const bad = await fetch(tampered, { method: "PUT", body: Buffer.from("probe"),
  headers: { "content-type": "image/jpeg" } });
if (bad.status !== 403) throw new Error(`a tampered key returned ${bad.status}, expected 403`);

await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
await client.send(new DeleteBucketCommand({ Bucket: bucket }));
client.destroy();
' 2>&1)"; then
  pass "presigned upload, verify, tamper-refusal, and delete"
else
  fail "presigned upload cycle failed: ${S3_PROBE}"
fi

# ─────────────────────────────────────────────────────────────────
if [ "$FAILURES" -eq 0 ]; then
  printf '\n\033[32mAll services reachable and operational.\033[0m\n'
  exit 0
fi

printf '\n\033[31m%d check(s) failed.\033[0m\n' "$FAILURES"
exit 1
