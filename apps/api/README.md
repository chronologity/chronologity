# apps/api

Chronologity's authoritative backend: commands, domain invariants, authorization, authoritative events, and operational queries.

It is not the Timeline read service. High-volume Timeline composition over derived read models belongs to `apps/feed-aggregator`.

## Running locally

The API needs the Phase 1 infrastructure running:

```bash
pnpm infra:up
pnpm --filter @chronologity/api build
pnpm --filter @chronologity/api start
```

`pnpm --filter @chronologity/api dev` restarts on rebuild.

## Health

| Endpoint        | Answers                                    |
| --------------- | ------------------------------------------ |
| `/health/live`  | Is the process running?                    |
| `/health/ready` | Can this instance serve traffic right now? |

These are deliberately different questions. Liveness consults nothing, because a database outage should stop traffic being routed here — not cause an orchestrator to kill and restart a healthy process. Readiness performs a real round trip to PostgreSQL and Kafka on every request, returns 503 when any of them fails, and names which one, so an operator sees the scope of an outage rather than only its first symptom.

## Structure

```text
src/
├── index.ts        process entry: compose, start, handle signals
├── server/         application construction, separate from process startup
├── config/         environment schema and typed configuration
├── plugins/        cross-cutting Fastify concerns
├── lib/            infrastructure boundaries and shared primitives
└── features/       feature modules, each owning its own routes
```

Application construction is separate from process startup so integration tests build a fully wired application and use Fastify injection rather than binding a port. A test suite that needs a free port is a test suite that fails when run in parallel.

## Errors

Every failure crossing the boundary uses the stable envelope from `@chronologity/contracts`: `code`, `message`, `traceId`, and optional `details`.

Only errors that deliberately describe themselves contribute a message. Anything else becomes `INTERNAL_ERROR`, with the detail available in the logs under the same trace identifier. Stack traces, SQL errors, event-store errors, and provider failures never reach a client.

Every response carries `x-trace-id`. An inbound one is honoured so a trace survives the hop from client to API.

## Configuration

Configuration is parsed and validated once at startup, and the process exits with every problem listed rather than starting in an unknown state. Feature code receives typed configuration and never reads `process.env`.

## Not here yet

Authentication, authorization, domain features, workers, projections, and messaging producers arrive in Phases 4 and 5. This application currently establishes the runtime, its infrastructure boundaries, and the conventions those phases build on.
