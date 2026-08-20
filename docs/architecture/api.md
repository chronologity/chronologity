# Chronologity API Architecture

## Purpose

This document defines the architecture of `apps/api`, Chronologity's authoritative backend application.

The API is responsible for accepting requests, enforcing authorization and domain invariants, making authoritative state transitions in PostgreSQL, exposing operational REST queries, and publishing the Integration Events from which downstream read models are derived.

This document is grounded in the canonical `apps/api` structure defined in `docs/architecture/monorepo.md`. It explains the responsibilities and dependency rules behind that structure rather than duplicating the complete directory tree.

The API is not the primary multidimensional Timeline read service. Timeline composition over ClickHouse-derived read models belongs to `apps/feed-aggregator`.

---

## Architectural Role

`apps/api` is the authoritative write application for Chronologity.

Conceptually:

```text
Client request
      ↓
Fastify route              schema-validated transport
      ↓
Authentication / authorization
      ↓
Service                    owns the transaction
      ↓
Policy                     decides the rule
      ↓
Repository                 conditional write to PostgreSQL
      ↓
Outbox                     same transaction as the change
      ↓
Kafka → downstream read models and side effects
```

The API answers the question:

> **May this state change occur, and if so, what authoritative facts result from it?**

The feed aggregator answers a different question:

> **How should already-authorized derived historical state be composed efficiently for Timeline navigation?**

Those responsibilities must remain separate.

---

# Core Responsibilities

The API owns:

- authentication and session lifecycle;
- backend-enforced authorization;
- role-based administrative authority;
- authoritative state transitions;
- domain invariants;
- authoritative state in PostgreSQL, for every feature;
- the Integration Events it chooses to publish;
- operational REST queries;
- uploads and media-processing lifecycle coordination;
- notification creation/delivery orchestration where authoritative behavior is required;
- moderation decisions and enforcement;
- external integration adapters required by API workflows;
- runtime validation of inbound data;
- server-side error mapping;
- request context and observability.

The API does **not** own:

- GraphQL Timeline composition;
- normal ClickHouse-backed Timeline reads;
- multidimensional Timeline rendering behavior;
- client presentation state;
- recommendation or Discovery ranking as authoritative truth;
- client-side role enforcement as a source of authority;
- arbitrary cross-application implementation sharing;
- a separate administrative application.

---

# Technology

The API is implemented with:

```text
Node.js
TypeScript
Fastify
PostgreSQL
Kafka / asynchronous messaging
shared contracts from packages/contracts
```

PostgreSQL holds authoritative state for every feature (ADR-092). Kafka carries
Integration Events and is never a source of truth.

Additional infrastructure may support object storage, media processing, email, push notifications, metadata extraction, observability, and projection delivery.

Technology choices must remain subordinate to domain boundaries.

Fastify is the HTTP framework.

It is not the architecture.

---

# Application Structure

The canonical API structure is organized into the following major areas:

```text
src/
├── index.ts
├── server/
├── config/
├── plugins/
├── lib/
├── types/
├── integrations/
├── workflows/
└── features/
```

Each area has a distinct responsibility.

---

# Entry Point

## `src/main.ts`

`src/main.ts` is the process entry point.

Its responsibilities should remain minimal:

1. load validated application configuration;
2. construct the Fastify application;
3. start the server;
4. install process-level shutdown/error handling where appropriate.

It should not contain:

- route definitions;
- domain behavior;
- repository queries;
- feature initialization logic that belongs elsewhere;
- business rules.

A process entry point should compose the application, not become the application.

---

# Server Composition

## `src/server/`

The server layer owns Fastify composition.

Canonical files include:

```text
server/
├── app.ts
├── server.ts
├── register-routes.ts
└── register-plugins.ts
```

### `app.ts`

Constructs and configures the Fastify application.

It should coordinate:

- base Fastify options;
- plugin registration;
- route registration;
- top-level error handling;
- lifecycle hooks that truly belong at the application boundary.

It must not contain feature-specific business logic.

### `server.ts`

Owns network-server startup and shutdown behavior.

Its concerns include:

- binding to configured host/port;
- graceful shutdown;
- draining requests where supported;
- closing database/event-store clients;
- terminating consumers or other long-lived infrastructure cleanly.

### `register-plugins.ts`

Defines the intentional order in which shared Fastify plugins are installed.

Plugin ordering matters because later plugins may depend on earlier decorations or hooks.

### `register-routes.ts`

Registers feature route modules.

It is the composition point between Fastify and feature-owned HTTP boundaries.

It should not manually enumerate individual business operations inside the server layer when those routes belong to feature modules.

---

# Configuration

## `src/config/`

Configuration is explicit, validated, and application-owned.

The canonical API configuration includes:

```text
config/
├── env.ts
├── app-config.ts
├── auth-config.ts
├── database-config.ts
└── storage-config.ts
```

Configuration should be validated at startup.

The application should fail fast when required configuration is missing or invalid.

Do not spread direct `process.env` access throughout feature code.

Instead:

```text
environment
    ↓
validated config
    ↓
application dependencies
```

Sensitive configuration must not be exposed through client-facing shared packages.

---

# Fastify Plugins

## `src/plugins/`

Canonical shared plugins include:

```text
plugins/
├── auth.plugin.ts
├── cors.plugin.ts
├── helmet.plugin.ts
├── metrics.plugin.ts
├── request-context.plugin.ts
├── swagger.plugin.ts
└── validation.plugin.ts
```

Plugins should encapsulate HTTP/application infrastructure behavior that applies across features.

They should not become a second service layer.

---

## Authentication Plugin

`auth.plugin.ts` interprets credentials and establishes authenticated request identity.

Its responsibilities may include:

- parsing credentials;
- validating session/access tokens;
- loading the minimum identity/session context required for the request;
- attaching authenticated context to the Fastify request.

Authentication answers:

> **Who is making this request?**

It does not by itself answer:

> **May this identity perform this action?**

That remains an authorization decision.

---

## Request Context Plugin

`request-context.plugin.ts` establishes request-scoped metadata such as:

- trace/request identifier;
- authenticated identity;
- session identity where relevant;
- correlation/causation metadata;
- request start time;
- other trusted request-scoped information.

Feature handlers should consume a typed request context rather than repeatedly reconstructing this information.

---

## Validation Plugin

Runtime boundary validation should be centralized enough to produce consistent behavior while schemas remain feature-owned.

TypeScript static types do not replace runtime validation.

Client data is untrusted.

---

## Metrics Plugin

Metrics instrumentation should expose request-level measurements without embedding domain policy into the plugin.

Feature-specific metrics may be emitted by the owning feature or workflow.

---

# Shared API Infrastructure

## `src/lib/`

The `lib/` directory owns API-local infrastructural primitives used by multiple features.

Canonical areas include:

```text
lib/
├── auth/
├── database/
├── messaging/
├── logger/
├── errors/
├── ids/
└── time/
```

The directory must remain small and explicit.

It must not become a generic `shared/` dumping ground.

---

# Database Access

## PostgreSQL

`lib/database/postgres.ts` establishes the API's PostgreSQL infrastructure boundary.

PostgreSQL holds authoritative state for every feature. There is no second write store to reconcile it against, which is the point: a change and the message announcing it commit together or not at all.

Feature modules should not scatter connection construction or pool configuration throughout the codebase.

Exact table ownership belongs in focused data architecture documents.

---

## ClickHouse

The canonical tree currently contains:

```text
lib/database/clickhouse.ts
```

Normal multidimensional Timeline reads belong to `apps/feed-aggregator`, not the authoritative API.

Therefore API-side ClickHouse access must have a narrowly defined reason, such as:

- projection-writing infrastructure;
- operational maintenance;
- administrative repair/rebuild tooling;
- another explicitly documented API-owned concern.

API feature queries must not gradually begin bypassing the feed aggregator for normal Timeline composition simply because a ClickHouse client exists.

If focused projection architecture demonstrates that the API does not need direct ClickHouse access, this adapter should be removed from the canonical tree.

---

# Errors

## `src/lib/errors/`

Canonical errors include:

```text
domain-error.ts
not-found-error.ts
unauthorized-error.ts
validation-error.ts
```

Feature/domain code should express meaningful errors without depending directly on HTTP status codes.

The route/application boundary maps domain/application errors into HTTP responses.

Prefer:

```text
Domain/Application error
        ↓
HTTP mapping
```

over:

```text
Domain object throws Fastify HTTP response
```

Errors should have stable codes where clients need programmatic handling.

Shared serialized error codes belong in `packages/contracts` when they cross application boundaries.

---

# IDs and Time

`lib/ids/` and `lib/time/` centralize primitives whose consistency matters across features.

Time is particularly important in Chronologity.

The API must distinguish:

- occurrence time;
- upload time;
- publication time;
- event persistence time;
- processing time;
- notification time;
- request time.

A generic `createdAt` should not silently substitute for historical occurrence semantics.

Testable time abstractions may be used where deterministic tests require them.

---

# API Types

## `src/types/`

Canonical types include:

```text
event-metadata.ts
request-context.ts
```

These are API-local architectural types.

Cross-runtime serialized contracts belong in `packages/contracts`.

Do not put an internal implementation type into `packages/contracts` merely because two files happen to use it.

---

# Integrations

## `src/integrations/`

The integration layer encapsulates external systems.

Canonical integration boundaries include:

```text
integrations/
├── email/
├── push/
├── storage/
├── transcoder/
└── metadata/
```

Integrations are adapters.

They do not own domain decisions.

---

## Storage Integration

The storage integration coordinates object-storage operations such as:

- generating authorized upload destinations;
- deleting stored objects;
- future lifecycle actions.

Large binary media must not flow through Integration Event payloads.

---

## Transcoder Integration

The transcoder integration initiates or manages video-processing work.

The API owns the authoritative workflow state.

The transcoder performs media processing.

Processing results must return through explicit, validated boundaries.

---

## Metadata Integration

Metadata extraction may provide technical or inferred information from media.

Derived metadata must preserve provenance and must not silently become authoritative historical truth.

For example:

```text
embedded capture timestamp
        ≠
authoritative occurrence time
```

without product-defined confirmation or inference semantics.

---

# Feature Architecture

## `src/features/`

Each feature owns the behaviour of one capability, and the canonical list is
maintained in `docs/architecture/monorepo.md` rather than duplicated here.

Features should remain as independently understandable as practical. A feature
is created when a capability acquires real responsibility, not to populate a
tree.

---

# Feature Structure

A feature is a flat set of files named for what they are:

```text
<feature>/
├── <feature>.routes.ts          Fastify registration and HTTP concerns
├── <feature>.service.ts         class, verb-only methods, owns transactions
├── <feature>.repository.ts      class, plain SQL
├── <feature>.policy.ts          pure rules, exhaustively unit tested
├── <feature>.policy.test.ts
├── <feature>.types.ts
└── <feature>.integration.test.ts
```

Not every feature needs every file. A feature with two nouns may carry two
services and two repositories — authentication carries `identity` and `session`
— when the nouns are genuinely distinct and the dependency between them runs
one way.

There are no `aggregates/`, `commands/`, `queries/`, `event-handlers/`, or
per-feature `projections/` directories. Those belonged to an event-sourced and
command/query-split design that ADR-091 and ADR-092 replaced.

---

# Services

A service owns a capability's behaviour. It is a class, and its methods are
named for what they do without repeating the noun the class already carries:
`locationService.record(...)`, `uploadService.finalize(...)`,
`userService.updateHandle(...)`.

A service should:

- open the transaction its writes commit in;
- call repositories for persistence;
- call pure policy modules for rules;
- construct and enqueue any Integration Event, in the same transaction as the
  change it describes;
- raise domain errors that the transport boundary maps to HTTP.

A service should not:

- know Fastify;
- write SQL inline;
- decide a rule that a pure function could decide;
- publish to Kafka directly.

Dependencies arrive through the constructor. Wiring is manual, in `src/main.ts`.
There is no container: assembling the application explicitly is what the
container ceremony was hiding.

---

# Repositories

A repository owns a feature's SQL and nothing else. It is a class holding the
pool.

**Reads take the pool; writes take a transaction.** A write's transaction is
therefore visible at the call site rather than hidden behind the method, which
is what makes the transactional outbox possible: a state change and the message
announcing it are only atomic if they share a connection.

A repository returns domain-shaped values, not rows. Column-to-field mapping
belongs here, so nothing above it knows a column name.

State transitions are conditional updates naming the state they expect to move
from, and they report whether they moved anything. See **Concurrency**.

---

# Policy

A policy module is a pure function or set of them. It takes what has been read
and answers a question: is this handle acceptable, is this Session usable, what
does this refusal mean, which derivatives are still missing.

Policy modules hold the rules precisely because they can be unit tested
exhaustively — every branch, every boundary — without a database, a network, or
a fixture. A rule that lives in a service can only be reached through
infrastructure; a rule that lives here can be enumerated.

Where a policy establishes a fact, it returns that fact rather than leaving the
caller to re-derive it. A verdict that proves a file has dimensions carries the
dimensions.

---

# Integration Events

A service that publishes constructs the external payload explicitly and
enqueues it to the transactional outbox. Nothing is published automatically,
and nothing is published as a side effect of persistence.

An Integration Event is a deliberately versioned contract with consumers
outside this application. It is not a record of everything that happened
internally: it carries what a consumer needs and nothing that would be
difficult to erase.

Internal past-tense facts that no other system consumes are not events. They are
rows, and where they matter for accountability they are audit rows written in
the same transaction as the change they describe.

---
# Routes

## `<feature>.routes.ts`

Feature routes own the HTTP boundary for that feature.

Routes should:

- declare HTTP method and path;
- bind request/response schemas;
- require the appropriate authentication level;
- call a service method with validated input;
- shape the result into a response.

Routes should not:

- contain SQL;
- perform domain calculations;
- duplicate authorization rules the service or a policy owns;
- enqueue Integration Events.

There is no controller layer. A schema-validated Fastify handler already is one,
and inserting another would add a file per operation that forwards its arguments
unchanged (ADR-091).

Routes remain thin by design. Where a route needs more than one service — account
deactivation ends the account and then its Sessions — it composes them, because
a service reaching across into another feature's concern would put ownership in
two places.

One consequence worth stating: Fastify validates a request body during its own
lifecycle, before any `preHandler` runs. A malformed body is therefore refused
as a bad request whether or not the caller is authenticated. That is acceptable
here, since clients compile against the same published schemas, but it is a
decision rather than an accident.

---

# Schemas

Validation lives in `packages/contracts`, because mobile and the API client
compile against the same definitions and two independently maintained schemas
for one contract will drift.

A feature declares a local schema only where it needs a shape no client sees —
a transport detail such as which Session a refresh names.

---
# Authentication Feature

## `features/authentication`

The authentication feature owns identity and session behaviour. It carries two
services, because it has two nouns and the dependency between them runs one way:
proving who someone is ends in granting them a Session.

- `identity.service.ts` — registration, address verification, sign-in by link or
  password, and the password lifecycle;
- `session.service.ts` — issuing, refreshing, revoking, listing, and validating
  Sessions;
- `identity.repository.ts`, `session.repository.ts`;
- `authentication.policy.ts` — address normalisation, Session usability, and why
  a refresh was refused;
- `authentication.routes.ts`.

`sessions` is the authority for whether a Session may authenticate a request
(ADR-094). Revocation is written in the request that causes it, so reading the
row is fresher than replaying a stream ever was, and it takes an extra store off
the hot path of every authenticated request.

Refresh-token rotation is a single conditional update requiring the presented
credential to still be the current one. A presented credential that is not the
current one means an already-rotated credential is in circulation, and the
Session ends rather than merely being refused.

The exact supported authentication mechanisms must be finalized in `docs/architecture/authentication.md`.

This document establishes the boundary:

```text
Authentication
    ↓
establish identity and Session truth

Authorization
    ↓
decide allowed actions
```

The two must remain separate.

---

# Authorization Feature

## `features/authorization`

The authorization feature owns authoritative role assignment, canonical permission policy, effective authorization read state, and privileged role-management operations.

Its responsibilities include:

- assigning a role to a User;
- removing a role from a User;
- enforcing invariants around role assignment, including that nobody may grant
  themselves a role — though anyone may remove one from themselves, because the
  rule is against escalation rather than against standing down;
- recording every role change, and every refusal, in the relational audit trail;
- reading current roles on each privileged request rather than trusting a token
  claim, so removing a role stops the next request rather than the next refresh;
- exposing current effective permissions for trusted consumers;
- maintaining the canonical permission registry and role-to-permission mapping;
- providing reusable authorization policies for feature/application boundaries;
- exposing privileged REST routes for role management where required.

The initial canonical model deliberately does **not** include arbitrary per-User permission grants. Roles grant permissions. Direct grants may be introduced only if a concrete product/security requirement later justifies them.

The feature remains separate from authentication:

```text
features/authentication
    → proves identity and manages Sessions

features/authorization
    → owns roles, permissions, and authorization policy
```

Resource-specific policies remain close to their owning features. The authorization feature provides the platform-wide role/permission foundation rather than absorbing every domain-specific access rule.

---

# Users Feature

## `features/users`

The users feature owns Chronologity account/profile lifecycle.

Its canonical responsibilities include:

- user creation;
- profile updates;
- username changes;
- user emails where this remains distinct from authentication identity;
- activation/deactivation;
- account deletion;
- account and profile reads, including the public view and the owner's own.

The focused identity architecture must ensure the distinction between:

```text
Chronologity User account
        ≠
historical Person
```

is preserved.

---

# Uploads Feature

## `features/uploads`

The uploads feature owns authoritative upload lifecycle.

It should model:

- upload registration, which authorises a direct write to object storage rather
  than proxying bytes through the API;
- receipt confirmation, which verifies what actually arrived;
- what opening the file established, which is authoritative over anything the
  client declared;
- readiness, failure, and deletion;
- upload status reads.

Every transition is a conditional update naming the state it expects to move
from, because the media pipeline delivers at least once and two workers may be
handed the same file. Zero rows means another worker got there first, which is
ordinary rather than exceptional.

Announcing an arrival is enqueued to the outbox in the same transaction as the
arrival itself, so the pipeline cannot be started for a state that rolled back.

The feature owns upload state.

External storage/transcoder/metadata systems perform delegated technical work.

A Moment's unlimited media semantics require upload operations to be independently bounded and retryable per media item or upload unit.

---

# Moments Feature

## `features/moments`

The moments feature owns authoritative Moment lifecycle and invariants.

The current product model requires:

- Moment as the fundamental historical unit;
- occurrence-time semantics;
- unlimited image/video membership at the product-model level;
- no recursive Sub-Moment hierarchy;
- no automatic split/merge/reparent model;
- immutable historical integrity subject to explicitly defined corrections and moderation/deletion semantics.

The canonical monorepo has already removed superseded Sub-Moment files.

Future Moment operations must not recreate that hierarchy under different names.

Moment media ordering and association must be modeled without making each media item a nested historical Moment.

---

# Reactions Feature

## `features/reactions`

The reactions feature owns authoritative Reaction lifecycle.

Its responsibilities include:

- add Reaction;
- remove Reaction;
- update Reaction if supported by product semantics;
- the Integration Events, if any, that downstream read models need;
- authorized Reaction reads where appropriate.

Reactions are social activity.

They must not change Moment occurrence time or become authoritative historical significance.

---

# Timelines Feature

## `features/timelines`

`features/timelines/` owns no service and no write operations (ADR-084).

The finalized product model establishes that the Timeline is a derived historical representation rather than an arbitrary user-created container. A derived representation has nothing to create, rename, archive, or delete: it changes when the history beneath it changes.

The feature owns what maintains Timeline read models, and nothing else — cursor
encoding and the projection logic that keeps ClickHouse in step with what
PostgreSQL has accepted.

It must **not** own high-volume Timeline composition. That belongs to
`apps/feed-aggregator`.

The earlier canonical tree carried a Timeline aggregate and five lifecycle
operations. Each was reviewed against `docs/product/timeline.md` and
`docs/product/timelines.md`, none had a product-semantic justification, and all
were removed rather than implemented ceremonially.

---

# Notifications Feature

## `features/notifications`

The notification feature owns authoritative notification state and lifecycle where appropriate.

Potential responsibilities include:

- creation of notification records;
- delivery state;
- read/unread state;
- dismissal where supported;
- notification preference integration;
- the Integration Events notifications publish or consume;
- notification reads and routes.

External push/email providers deliver messages.

They do not own notification truth.

Notification time and Moment occurrence time remain separate.

---

# Moderation Feature

## `features/moderation`

Moderation is an authoritative API concern.

The feature owns policy-enforced state transitions such as:

- reports;
- restrictions;
- removal;
- restoration;
- suspension;
- moderation case state;
- appeals where modeled;
- the Integration Events moderation publishes, so that derived read models can
  honour a restriction rather than discovering it later.

The mobile app may expose administrative interfaces to authorized roles.

The backend decides whether the action is permitted.

There is no separate admin application and no client-side administrative authority.

Moderation may change distribution/access.

It must not rewrite occurrence time or historical fact.

---

# Authorization

Authorization is enforced at trusted backend boundaries.

Authorization may depend on:

- authenticated identity;
- role;
- ownership;
- social relationship;
- resource visibility;
- moderation state;
- resource-specific policy;
- administrative permission;
- other feature-owned rules.

Do not use one global `isAdmin` boolean as a substitute for explicit permissions.

The detailed role/permission architecture belongs in `docs/architecture/authorization.md`.

---

# Administrative Operations

Administrative operations follow the same architecture as any other authoritative mutation.

Conceptually:

```text
Authorized consumer UI
        ↓
REST request
        ↓
authenticated request context
        ↓
permission check
        ↓
moderation or administration service
        ↓
authoritative state change, plus an audit row in the same transaction
```

The fact that the invoking client is the normal consumer application changes nothing about backend authority.

---

# REST Boundary

The API's public application interface is REST.

REST routes should be resource/use-case oriented and preserve Chronologity terminology.

Avoid exposing implementation details unnecessarily in URLs.

The client should not need to know:

- Kafka offsets;
- outbox message identifiers;
- database table or column names;
- object-storage keys.

Those are implementation details.

---

# Idempotency

Operations that can be retried after an ambiguous network failure should support explicit idempotency where duplicate execution could cause harm.

Examples may include:

- Moment creation;
- upload registration;
- administrative actions;
- notification-triggering operations;
- payment-like future operations if introduced.

The exact idempotency-key mechanism belongs in the API contract documentation.

Idempotency must not be assumed merely because an operation is "usually only called once."

---

# Request Lifecycle

A typical authenticated write request should follow:

```text
HTTP request
    ↓
request context
    ↓
authentication
    ↓
schema validation
    ↓
authorization prerequisites
    ↓
route
    ↓
service
    ↓
policy decides the rule
    ↓
repository writes, conditionally
    ↓
outbox message, same transaction
    ↓
result
    ↓
HTTP response
```

Downstream projection, notification, and indexing work continues asynchronously after the authoritative response, because the product does not require synchronous completion. The outbox is what makes that safe: the work is already recorded before the response is sent.

---

# Persistence Flow

```text
Validated request
      ↓
Read the current row
      ↓
Decide, using a pure policy function
      ↓
Conditional write, naming the state it expects to move from
      ↓
Zero rows means somebody else got there first
      ↓
Outbox message, in the same transaction
      ↓
Commit
```

The write is successful when PostgreSQL commits — not when every downstream read
model has converged.

Nothing is written to two stores. The change and the message announcing it share
one transaction, which is the property the previous architecture could not
offer: it committed to PostgreSQL first and appended to a second store
afterwards, so a failure between them left PostgreSQL holding a record the
supposed authority never recorded.

---

# Reliable Event Publication

A committed authoritative change must eventually reach required downstream
consumers, and an uncommitted one must never appear downstream as accepted fact.
The transactional outbox provides both (ADR-093).

```text
Service                    enqueues to outbox_messages, in its own transaction
      ↓
Commit                     the change and the message land together, or neither does
      ↓
Outbox publisher           claims a batch with FOR UPDATE SKIP LOCKED
      ↓
Kafka                      published, then marked published in the same transaction
      ↓
Consumers                  idempotent, because delivery repeats
```

Claiming with `FOR UPDATE SKIP LOCKED` means several publisher instances can run
at once without coordinating, and without the shared checkpoint the previous
mechanism needed.

A failure to publish is recorded against the message and retried. The batch's
own transaction has already rolled back at that point, so the failure is
recorded in a separate one — otherwise the record of the failure would roll back
with it.

Two things remain to be settled before real traffic: retention of published
rows, and giving up on a message that can never succeed. Both are noted under
open questions.

---

# Operational Reads

Reads use the representation appropriate to their use case, and for the API that
is almost always the authoritative row.

There is no separate read model to reconcile inside the API, and no replay on a
request path. Where a read is genuinely expensive — Timeline composition,
historical aggregation — it belongs to the feed aggregator over ClickHouse
rather than to a read model maintained here.

---

# Transactions

Transactions should be local to the system that owns the authoritative change.

Do not attempt distributed transactions across PostgreSQL, Kafka, object storage, ClickHouse, and external providers. The outbox is what removes the need for one: the only two things that must agree — a change and the message announcing it — already share a transaction.

Prefer:

```text
local authoritative commit, with its outbox message
        ↓
asynchronous propagation
        ↓
retry / recovery
```

When a multi-step operation has visible intermediate states, those states should
be explicit and stored — an upload is `registered`, then `received`, then
`ready`, and each transition is guarded.

---

# Concurrency

**Guard a state transition with a conditional update rather than a
read-then-write.** Reading a row, deciding, and then writing leaves a gap that
another request can commit inside. Naming the expected state in the `WHERE`
clause closes it, and the row count reports whether this call was the one that
moved anything:

```sql
UPDATE uploads SET state = 'received', ...
 WHERE upload_id = $1 AND state = 'registered'
```

The same shape covers every hazard the API has:

- **credential rotation** — the presented refresh token must still be the
  current one, the Session unrevoked and unexpired, all in one statement;
- **first claim wins** — a unique constraint decides which of two simultaneous
  claims to an address or a handle succeeds, and the loser reads back the
  winner's row;
- **first revocation wins** — `COALESCE` keeps the reason that actually ended a
  Session, so a later logout cannot overwrite evidence of a suspected theft;
- **bulk revocation** — one statement rather than a list followed by a loop, so
  a Session opened while the loop ran cannot survive a "log out everywhere" that
  was meant to include it.

The API must not rely on application-process memory as the only protection
against concurrent writes. Horizontally scaled instances must produce the same
correctness behaviour, which is exactly what pushing the condition into the
statement achieves.

---

# Validation

Validation occurs at multiple levels.

## Transport validation

Answers:

> Is the request structurally valid?

Examples:

- required fields;
- field types;
- supported enum values;
- payload size;
- syntactic formats.

## Application validation

Answers:

> Is this request permissible for this use case?

Examples:

- authenticated identity required;
- referenced resource exists;
- preconditions the operation depends on.

## Domain validation

Answers:

> Does this state transition preserve domain invariants?

Examples:

- a state transition the current state does not permit;
- impossible lifecycle change;
- Moment invariant violation.

Do not collapse all three layers into route-schema validation.

---

# Error Mapping

API errors should produce a stable response envelope.

At a conceptual level:

```text
{
  code,
  message,
  traceId,
  details?
}
```

Exact schema belongs in `docs/api/errors.md`.

Internal stack traces, SQL errors, secrets, or raw provider failures must not be exposed to clients.

---

# Observability

Every request should be traceable through the authoritative path.

Important fields may include:

- trace ID;
- request ID;
- authenticated user/identity ID where safe and appropriate;
- the operation being performed;
- the identifier of the resource it acts on;
- the outbox message correlation ID, so a change can be followed downstream.

Logs must avoid unnecessary sensitive payloads.

Metrics should make it possible to identify:

- command latency;
- command failure rates;
- optimistic concurrency conflicts;
- outbox depth and publication lag;
- PostgreSQL latency;
- workflow failure;
- integration failure;
- projection publication lag;
- authentication failures;
- moderation/admin action rates where safe;
- upload/media workflow health.

---

# Security

The API treats all client input as untrusted.

At minimum:

- authentication is server validated;
- authorization is server enforced;
- security headers are applied;
- CORS is explicit;
- request payload limits are bounded;
- media upload authorization is scoped;
- secrets remain server-side;
- external integration credentials remain server-side;
- administrative commands require explicit permissions;
- provider callbacks/webhooks are validated if introduced;
- logs do not contain tokens or unnecessary sensitive payloads.

Detailed security architecture belongs in `docs/architecture/security.md` and `docs/security/`.

---

# Media Safety

The API does not trust uploaded media merely because a signed upload URL was issued.

Media-processing workflows should validate:

- expected object ownership;
- supported format;
- declared versus observed media type;
- file size constraints;
- per-video duration limit;
- processing success;
- moderation/safety requirements where applicable.

The product-level rule remains:

```text
unlimited media items per Moment
```

while technical operations remain bounded.

---

# Performance

The API is optimized for authoritative correctness, not for serving every read from the write model.

Key write paths should remain efficient, and high-volume derived reads should be delegated to read models and the aggregator.

Optimize measured bottlenecks. Prefer better queries, indexes, and batching before reaching for a cache, and never add cross-request caching that could outlive an authorization change.

Performance optimizations must preserve correctness and auditability.

---

# Testing

Tests are colocated with implementation by default.

The architecture decides the test strategy, because the architecture decides
what can be tested without infrastructure. **Rules live in pure policy modules
and are unit tested exhaustively; services orchestrate repositories and are
proven by integration tests against real PostgreSQL.**

There is no third option. A service cannot be unit tested without substituting
the database, and the rules that matter now live in SQL — `ON CONFLICT` deciding
a race, a conditional `UPDATE` returning zero rows, `FOR UPDATE SKIP LOCKED`
handing one worker a batch. A fake repository would have to reimplement those
semantics to answer at all: get them right and you have written a database, get
them wrong and the tests are green about exactly the properties this
architecture exists to establish.

## Policy tests

Unit tests, no infrastructure. Every branch, every boundary, success and
failure. A policy module exists so that its rules can be enumerated, and a
branch left uncovered is either a missing test or a branch that cannot happen —
and the second is a defect worth removing rather than a line worth faking.

## Service tests

Integration tests against real PostgreSQL, driving the service directly rather
than through HTTP. This is the only way to reach the behaviour the HTTP surface
cannot arrange: nothing makes two HTTP requests interleave inside one
transaction on purpose.

A race test must be able to fail. Firing several concurrent callers does not
reliably produce a collision — the losers' reads tend to land after the winner
commits and take an earlier, cheaper exit — so a test that only asserts the
outcome will pass whether or not the race occurred. Where the interleaving
matters, arrange it: hold an uncommitted transaction, wait until the contending
statement is actually blocked, then commit. A test that cannot observe the
contention should say so and fail rather than pass quietly.

## Route tests

Integration tests through `app.inject()`, never a real port. Verify method and
path, schema validation, authentication and authorization requirements, status
and error mapping, and serialization.

They should not duplicate domain rules already proven below the route layer.

## Worker tests

Verify behaviour under repeated delivery, partial failure, and the distinction
between a failure worth retrying and one that will reach the same answer every
time.

## Contract tests

REST, GraphQL, Integration Events, and external adapters.

## What may be substituted

Only third-party boundaries: a subprocess decoder, an SMTP conversation, an
outbound HTTP call to a map service. Never this system's own database or broker
— doing so removes the behaviour under test.

Even at those boundaries, prefer a recorded response or a hand-written stub over
a mocking framework, and substitute only where the test is about how a failure
is *classified* rather than about the work itself.

---

# Dependency Rules

Within `apps/api`, dependencies should flow toward domain/application meaning.

A useful conceptual direction is:

```text
server / routes / plugins
          ↓
services
          ↓
policies          repositories
                       ↓
              infrastructure adapters
```

Specific rules:

1. policies must not import Fastify, a database client, or anything else with a
   side effect — a policy that cannot be called from a unit test is not one;
2. services must not import Fastify;
3. services must not write SQL; repositories own it;
4. routes may call services, not repositories;
5. integrations do not make domain decisions;
6. features do not import implementation from another deployable application;
7. cross-runtime serialized contracts come from `packages/contracts`;
8. application-local infrastructure stays in `apps/api`;
9. `lib/` must not become an unowned generic utility layer.

---

# Cross-Feature Dependencies

Feature-to-feature imports should be minimized.

When one feature needs another feature's behavior, prefer one of:

- composing both services at the route, where the operation genuinely spans two
  capabilities;
- one service depending on another where the dependency runs one way and always
  will — proving an identity ends in granting a Session, and that direction does
  not reverse;
- an Integration Event when synchronous coupling is unnecessary;
- a shared cross-boundary contract where the dependency is truly serialized.

Avoid importing another feature's repository simply because both live in one
application. A repository is a feature's private SQL.

Feature boundaries should remain meaningful enough that future extraction is possible if scale or ownership ever justifies it.

---

# Layers Within a Feature, Not Across the Application

Chronologity organises the API by feature, and layers *inside* each one:

```text
features/<feature>/<feature>.routes.ts
features/<feature>/<feature>.service.ts
features/<feature>/<feature>.repository.ts
features/<feature>/<feature>.policy.ts
```

What it deliberately does not do is hoist those layers into application-wide
buckets:

```text
controllers/
services/
repositories/
models/
```

That structure groups code by technical role while scattering one capability
across the whole application. Changing how uploads work should mean opening one
directory, not four.

There is no controller layer at all. A schema-validated Fastify handler already
receives typed, validated input and already is one; adding another would produce
a file per operation whose body forwards its arguments unchanged (ADR-091).

---

# No Separate Admin Backend

Administrative capability is part of the authoritative API.

There is no:

```text
apps/admin/
```

and there should not be a parallel `admin-api` merely because some operations require elevated permissions.

Administrative operations remain feature/domain operations protected by role/permission policy.

A future internal operational service would require a separate architecture decision based on an actual runtime/security need.

---

# Day-One API Requirements

Before Chronologity's initial release, `apps/api` must support:

- Fastify server composition;
- validated configuration;
- structured request context;
- authentication;
- server-side authorization;
- dedicated authorization feature;
- authoritative role assignment and removal;
- canonical permission registry and role-to-permission mapping;
- role-based administrative permissions;
- runtime request validation;
- consistent error mapping;
- User lifecycle;
- identity/session lifecycle;
- Moment authoritative lifecycle;
- occurrence-time semantics;
- upload registration and state;
- unlimited product-level media membership through bounded upload operations;
- per-video 90-second validation;
- Reaction lifecycle;
- notification state and workflows required by launch;
- moderation/report/enforcement behavior;
- authoritative PostgreSQL state for every feature;
- state transitions guarded by conditional updates;
- reliable event publication through the transactional outbox;
- idempotent downstream handling contracts;
- external storage integration;
- media-processing integration;
- tracing/logging/metrics;
- graceful startup/shutdown;
- exhaustive unit tests for policy, and integration tests against real infrastructure for services, routes, and workers.

---

# Open Architectural Questions

The following questions must be resolved in focused architecture documents before implementation hardens their answers.

## Authentication

- Which authentication methods ship on day one?
- Are magic links day one?
- Which OAuth providers are supported?
- Is two-factor authentication day one?
- What are session/access-token lifetimes?
- How are refresh credentials represented and revoked?

## Authorization

- What is the role model?
- What are the explicit administrative permissions?
- Are permissions role-derived only or can they be granted directly?
- How are resource-specific permissions composed with roles?
- Where do authorization policies live to remain feature-owned without duplication?
- How are authorization changes propagated to derived read systems?

## User Versus Identity

- Which fields belong to authentication Identity versus product User?
- Why does the canonical tree currently allow email operations in both features?
- Should email ownership live exclusively under Identity?
- Which User email concepts, if any, remain distinct?
- How are account deletion and identity deletion coordinated?

## Timeline Feature

- What authoritative information, if any, does `features/timelines` own?
- Which Timeline types have authoritative definitions versus purely derived scopes?

## Reliable Publication

The mechanism is settled: services enqueue to the transactional outbox, and a
publisher claims batches with `FOR UPDATE SKIP LOCKED` (ADR-093, ADR-096). What
remains open is its operation at volume.

- How long are published outbox rows retained, and what removes them?
- When does a message that keeps failing stop being retried, and where does it go?
- How are Integration Event schema versions negotiated with consumers?
- How is downstream replay initiated without resurrecting erased data?

## Projection Execution

No projector exists yet. The outbox-to-Kafka half works end to end; what reads
Kafka and writes ClickHouse is a later phase.

- Which process owns the projector, and does it live in `apps/api` or beside it?
- How does a projector record what it has already applied, given that Kafka owns
  consumer offsets and the previous checkpoint table was removed with the event
  store?
- Does the API need direct ClickHouse access at all once the projector exists?

## Media

- Which provider stores original media?
- How are upload URLs scoped and expired?
- How is upload completion proven?
- How are orphan uploads cleaned up?
- Who enforces the 90-second video limit: client, metadata worker, API, or all appropriate layers?
- Which processing states are authoritative?
- How are retries and transcoding failures represented?
- How are privacy changes propagated to media delivery?

## Notifications

- Is notification creation synchronous with the triggering change, or driven by an Integration Event?
- What state is authoritative?
- Where is read/unread state persisted?
- How are push/email delivery attempts separated from notification truth?
- How is high-volume Reaction activity aggregated?

## Moderation

- What are the authoritative moderation state boundaries?
- Is a Report separate from a moderation Case?
- How are appeals modeled?
- Which administrative operations require which permissions?
- How does enforcement propagate to ClickHouse and other read systems?
- How are emergency actions handled without bypassing auditability?

## API Queries

- Which profile/user queries should remain in the API versus move to Timeline read composition?
- Does Moment detail have both an authoritative API representation and an aggregator-composed Timeline representation?
- How are operational queries distinguished from high-volume derived reads consistently?
- What does a client see while a derived read model has not yet caught up?

## Idempotency

- Which REST mutation endpoints require idempotency keys?
- Where are keys/results stored?
- How long are they retained?
- How do idempotency semantics interact with conditional state transitions?

## Errors

- What is the canonical error envelope?
- Which stable error codes exist?
- How are validation details represented?
- Which errors are retryable?
- How are asynchronous-processing states represented without treating them as failures?

## Observability

- Which tracing implementation is used?
- How does trace context propagate through the outbox into Kafka?
- What outbox publication lag is acceptable, and what alerts on it?
- How often does a conditional update match nothing, and is that rate worth alerting on?
- How are sensitive administrative actions audited?

These questions should be answered in the focused documents that own them rather than embedded ad hoc into implementation.

---

# Architectural Invariants

1. `apps/api` is Chronologity's authoritative backend application.
2. The API owns authoritative mutations; the feed aggregator owns high-volume Timeline read composition.
3. PostgreSQL holds authoritative state for every feature. There is no second write store.
4. Fastify routes remain thin transport adapters, and there is no controller layer.
5. Within a feature, the layering is route to service to repository, with pure policy modules holding the rules.
6. Feature organization is primary; layers exist inside a feature, never as application-wide buckets.
7. Commands are not separated from queries.
8. Policy modules are pure and must not import Fastify, a database client, or anything with a side effect.
9. Services own the transactions their writes commit in.
10. Repositories own SQL. Reads take the pool; writes take a transaction.
11. Concurrent state transitions are guarded by conditional updates, never by read-then-write.
12. A unique constraint decides who wins a race for a claimed name; the application does not.
13. The first revocation of a Session is the one that stands.
14. Integration Events are immutable, deliberately versioned, and constructed explicitly by the service that publishes them.
15. An Integration Event reaches Kafka only through the transactional outbox, enqueued in the same transaction as the change it describes.
16. Nothing is published as a side effect of persistence.
17. Erasable personal data must not be written anywhere append-only, including the outbox and Kafka.
18. Consumers must be idempotent wherever delivery can repeat.
19. Projections produce derived state; they do not become authoritative state.
20. Projection rebuilds must honor current privacy, deletion, and moderation constraints.
21. Unsafe dual writes are prohibited; distributed transactions across infrastructure systems are avoided.
22. Long-running work uses explicit, stored, recoverable state.
23. External integrations are adapters, not domain authorities.
24. API-side ClickHouse access must remain narrowly justified and must not bypass the feed aggregator's read boundary.
25. A Moment is the fundamental historical unit and is never equated with a single media object.
26. The Moment model contains no recursive Sub-Moment hierarchy.
27. A Moment may contain unlimited media at the product level.
28. Per-video duration is limited to 90 seconds and enforced server-side.
29. Occurrence time remains distinct from operational timestamps.
30. Authentication and authorization are separate concerns.
31. Session validity is decided from the `sessions` table, which is written synchronously.
32. Administrative authority is backend-enforced through roles and permissions, read per request rather than taken from a token.
33. There is no separate admin application.
34. Client-side role checks are presentation convenience, not security.
35. Cross-application implementation imports are prohibited.
36. Cross-runtime contracts are explicit, validated, and shared through `packages/contracts`.
37. Runtime validation is required at trust boundaries.
38. Errors map from domain semantics to HTTP at the transport boundary.
39. Authoritative commit does not wait for every derived read model to converge unless a product guarantee explicitly requires it.
40. A committed authoritative change must not be permanently lost to required downstream processing.
41. Observability must trace authoritative changes through downstream publication.
42. Rules live in pure policy modules and are unit tested exhaustively; services are proven by integration tests against real infrastructure.
43. Tests are colocated with implementation by default.
44. Architecture documentation must be amended when implementation intentionally changes these boundaries.

---

# Guiding Principle

When deciding whether behavior belongs in `apps/api`, ask:

> **Does this code make, protect, persist, or coordinate an authoritative Chronologity decision—or is it composing derived historical state for consumption?**

If it makes or protects an authoritative decision, it likely belongs in the API.

If it primarily composes read-optimized Timeline state, it likely belongs in the feed aggregator.

The API should remain the place where Chronologity decides what the system accepts as true—not the place where every possible representation of that truth is assembled.
