# Local Development Infrastructure

Chronologity's canonical backend services, reproducible locally.

These containers are for development only. Credentials are weak and non-secret, TLS is disabled, replication factors are 1, and nothing here implies a production vendor — production hosting is decided in Phase 16.

## Commands

All commands run from the repository root.

| Command               | Effect                                                   |
| --------------------- | -------------------------------------------------------- |
| `pnpm infra:up`       | Start everything, wait until healthy, and provision the bucket |
| `pnpm infra:ps`       | Show service status and published ports                  |
| `pnpm infra:logs`     | Follow logs from all services                            |
| `pnpm infra:down`     | Stop and remove containers, **keeping** data volumes     |
| `pnpm infra:reset`    | Stop and remove containers **and** data volumes          |
| `pnpm infra:validate` | Connect to each service from the host and exercise it    |
| `pnpm db:reset`       | Drop the PostgreSQL database, recreate it, and migrate it |

`infra:up` exits non-zero if any service fails to become healthy, so it is safe to chain.

### The media bucket

A healthy stack is not the same as a usable one. PostgreSQL arrives with its database already created, because the image does that from `POSTGRES_DB`; object storage has no equivalent, so `infra:up` creates the media bucket itself.

Until it did, the bucket existed only because whichever integration suite ran first happened to create it — and on a stack with fresh storage that was not the suite that needed it. Account erasure runs earlier in the alphabet than the media worker's tests, so it always ran first, always found no bucket, and always failed: erasing a Moment deletes its media, storage answered "The specified bucket does not exist", and the erasure retried forever. It failed every CI run and no local one, because a developer's storage volume already held the bucket from the last time.

Creating a bucket that already exists changes nothing, so this runs every time rather than only the first. The bucket is then asked for rather than assumed: `weed shell` exits zero whatever happens — a bogus command, an unreachable master, a bucket it never created — so its exit status is worth nothing and the script lists the buckets and looks for this one instead.

### Starting from nothing

CI runs the integration suite against an empty database every time. A developer's machine does not, and the difference eventually shows: the suites create Users, Moments, Locations and search documents, and almost none of them clean up. Past a certain volume that stops being harmless — a bounded page fills with other runs' rows before it reaches the row under test, and a "did you mean" correction finds a real match among tens of thousands of accumulated names. Those failures cost an hour each to chase and none of them means anything.

`pnpm db:reset` makes a clean start cheap: about twenty seconds, against a suite that takes rather longer. `pnpm test:integration:clean` does it and then runs the suite.

It is not wired into `test:integration` itself, deliberately. Running one file while chasing a failure should stay fast, and the state a failure left behind is often the thing worth looking at.

It touches PostgreSQL only. Kafka keeps its log and object storage keeps its objects, because both are addressed by identifiers a later run will not reuse — accumulation there does not interfere with anything. `infra:reset` is still how those go, and it takes the containers with them.

## Services

| Service        | Image                                        | Host port  | Purpose                             |
| -------------- | -------------------------------------------- | ---------- | ----------------------------------- |
| PostgreSQL     | `postgres:18.6-alpine`                       | 5432       | Authoritative state, for every feature |
| Kafka          | `apache/kafka:4.3.1`                         | 9092       | Asynchronous transport              |
| ClickHouse     | `clickhouse/clickhouse-server:26.4.5-alpine` | 8123       | Derived read models                 |
| Mailpit        | `axllent/mailpit:v1.30.7`                    | 1025, 8025 | Outbound mail, captured not sent    |
| Object storage | `chrislusf/seaweedfs:3.95`                   | 8333       | Media, over an S3-compatible API    |

PostgreSQL holds authoritative state for every feature (ADR-092); nothing else here is a source of truth. Redis is not part of the canonical infrastructure (ADR-042).

Every image is pinned to an exact patch version so that recreating the stack produces the same infrastructure rather than whatever `latest` resolved to that day.

## Configuration

`scripts/compose.sh` seeds a root `.env` from `.env.example` on first use and passes it to Compose, so local overrides and the documented contract cannot drift apart. The compose file also carries defaults matching `.env.example`, so an absent variable degrades to the documented value rather than to an empty string.

To change a port or credential, edit `.env` — not the compose file.

## Validation

`pnpm infra:validate` does more than check that containers are running, because a running container proves very little:

- **PostgreSQL** — creates a table, inserts, selects, drops.
- **Kafka** — creates a topic, produces a message, consumes it, deletes the topic.
- **ClickHouse** — creates a MergeTree table, inserts, selects, drops.
- **Object storage** — creates a bucket, writes an object, reads it back, removes both.

Each service is also checked for host-side TCP reachability independently of any client library. PostgreSQL and Kafka run their operations through the container's own client because the host is not assumed to have `psql` or the Kafka CLI installed; ClickHouse and object storage are exercised entirely from the host over HTTP.

## Kafka listeners

Kafka advertises two listeners:

```text
kafka:29092      other containers on the compose network
localhost:9092   the host
```

Application workers added in later phases run on the host during development and use `localhost:9092`. If a worker is ever containerised into this compose file, it must use `kafka:29092` instead.

## Notes

- ClickHouse publishes only its HTTP interface (8123). The native port is deliberately unpublished: nothing uses it yet, and 9000 is where object storage will want to live in Phase 5E.
- ClickHouse's health check targets `127.0.0.1` rather than `localhost`, because inside the container `localhost` resolves to `::1` while ClickHouse listens on IPv4 only.
- Data survives `infra:down` and is destroyed by `infra:reset`. Both behaviors are verified.

## Port conflicts

A service already running natively on the host wins the port, and the symptom is confusing: the container is healthy, but clients reach the other server. A native PostgreSQL binding `127.0.0.1:5432` beats the container's wildcard `*:5432`, so an application connecting to `localhost` gets the native one and reports errors like `role "chronologity" does not exist`.

Check with `lsof -nP -iTCP:5432 -sTCP:LISTEN`. Fix by changing the port in `.env` rather than in the compose file — the same variable moves both the published port and every application that reads it.
