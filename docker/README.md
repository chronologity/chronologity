# Local Development Infrastructure

Chronologity's canonical backend services, reproducible locally.

These containers are for development only. Credentials are weak and non-secret, TLS is disabled, replication factors are 1, and nothing here implies a production vendor — production hosting is decided in Phase 16.

## Commands

All commands run from the repository root.

| Command               | Effect                                                   |
| --------------------- | -------------------------------------------------------- |
| `pnpm infra:up`       | Start everything and wait until every service is healthy |
| `pnpm infra:ps`       | Show service status and published ports                  |
| `pnpm infra:logs`     | Follow logs from all services                            |
| `pnpm infra:down`     | Stop and remove containers, **keeping** data volumes     |
| `pnpm infra:reset`    | Stop and remove containers **and** data volumes          |
| `pnpm infra:validate` | Connect to each service from the host and exercise it    |

`infra:up` exits non-zero if any service fails to become healthy, so it is safe to chain.

## Services

| Service      | Image                                        | Host port | Purpose                                        |
| ------------ | -------------------------------------------- | --------- | ---------------------------------------------- |
| PostgreSQL   | `postgres:18.6-alpine`                       | 5432      | Relational and operational authoritative state |
| EventStoreDB | `eventstore/eventstore:24.10.14`             | 2113      | Authoritative event history                    |
| Kafka        | `apache/kafka:4.3.1`                         | 9092      | Asynchronous transport                         |
| ClickHouse   | `clickhouse/clickhouse-server:26.4.5-alpine` | 8123      | Derived read models                            |

Object storage is absent by design: it arrives with the media subsystem in Phase 5E. Redis is not part of the canonical infrastructure (ADR-042).

Every image is pinned to an exact patch version so that recreating the stack produces the same infrastructure rather than whatever `latest` resolved to that day.

## Configuration

`scripts/compose.sh` seeds a root `.env` from `.env.example` on first use and passes it to Compose, so local overrides and the documented contract cannot drift apart. The compose file also carries defaults matching `.env.example`, so an absent variable degrades to the documented value rather than to an empty string.

To change a port or credential, edit `.env` — not the compose file.

## Validation

`pnpm infra:validate` does more than check that containers are running, because a running container proves very little:

- **PostgreSQL** — creates a table, inserts, selects, drops.
- **EventStoreDB** — appends an event to a scratch stream, reads it back, deletes the stream.
- **Kafka** — creates a topic, produces a message, consumes it, deletes the topic.
- **ClickHouse** — creates a MergeTree table, inserts, selects, drops.

Each service is also checked for host-side TCP reachability independently of any client library. PostgreSQL and Kafka run their operations through the container's own client because the host is not assumed to have `psql` or the Kafka CLI installed; EventStoreDB and ClickHouse are exercised entirely from the host over HTTP.

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
- EventStoreDB runs with `EVENTSTORE_INSECURE=true` and standard projections enabled, since projection replay is exercised from Phase 4 onward.
- Data survives `infra:down` and is destroyed by `infra:reset`. Both behaviors are verified.
