# apps/feed-aggregator

Chronologity's read-only Timeline composition service. It turns the derived read models in ClickHouse into GraphQL responses shaped for the client, and it is authoritative for nothing.

Despite the name, it is not a conventional social-media feed. There is no ranking here, and there will not be: the Timeline is chronological, and this application composes that chronology efficiently rather than deciding what somebody should see first.

## What it must never do

It has no mutations and never will have — a GraphQL mutation surface is not added merely because GraphQL supports one. Commands belong to `apps/api`, which also owns Sessions, moderation decisions, privacy changes and every projection that fills the tables read here.

It creates no Session, refreshes none and revokes none. It verifies a token and asks whether the Session it names still authenticates. If the answer is no, the read is refused and the client goes to the API.

It never imports from `apps/api`. Where the two need the same vocabulary, the shared type lives in `packages/contracts`.

## Running locally

```bash
pnpm infra:up
pnpm --filter @chronologity/feed-aggregator build
pnpm --filter @chronologity/feed-aggregator start
```

`pnpm --filter @chronologity/feed-aggregator dev` restarts on rebuild.

It listens on `FEED_AGGREGATOR_PORT`, 4000 by default, so it can run alongside the API on 3000.

## Health

| Endpoint        | Answers                                    |
| --------------- | ------------------------------------------ |
| `/health/live`  | Is the process running?                    |
| `/health/ready` | Can this instance serve traffic right now? |

Two different questions. Liveness consults nothing: this service cannot answer a Timeline query with ClickHouse down, but that is a reason to route traffic elsewhere rather than to kill and restart a healthy process. Readiness performs a real round trip to ClickHouse and PostgreSQL on every request, returns 503 when either fails, and names which one.

## GraphQL

`POST /graphql`. GraphiQL is served at `/graphiql` outside production.

The schema is written as SDL under `src/graphql/schema/` and resolvers are attached to it, rather than the schema being derived from code. It is a read contract in product terms — it does not mirror ClickHouse columns, and mobile never learns a storage detail from it.

## Structure

```text
src/
├── index.ts        process entry: compose, start, handle signals
├── server/         application construction, separate from process startup
├── config/         environment schema and typed configuration
├── plugins/        cross-cutting Fastify concerns
├── graphql/        the read contract: schema, resolvers, request context
├── auth/           who is asking, established per request
├── read-models/    the store boundaries this service reads through
├── observability/  logging
└── errors/         the failures a client can be told about
```

Application construction is separate from process startup so integration tests build a fully wired application and use Fastify injection rather than binding a port. A test suite that needs a free port is a test suite that fails when run in parallel.

Timeline composition — head, slices, Moment depth, temporal zoom, historical jumps — is not here yet. It arrives with Phase 9, and the directories that will hold it are absent until it does.
