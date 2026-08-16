# Chronologity API Architecture

## Purpose

This document defines the architecture of `apps/api`, Chronologity's authoritative backend application.

The API is responsible for accepting commands, enforcing authorization and domain invariants, making authoritative state transitions, persisting event-sourced history where appropriate, coordinating state-changing workflows, exposing operational REST queries, and producing the authoritative changes from which downstream read models are derived.

This document is grounded in the canonical `apps/api` structure defined in `docs/architecture/monorepo.md`. It explains the responsibilities and dependency rules behind that structure rather than duplicating the complete directory tree.

The API is not the primary multidimensional Timeline read service. Timeline composition over ClickHouse-derived read models belongs to `apps/feed-aggregator`.

---

## Architectural Role

`apps/api` is the authoritative command-side application for Chronologity.

Conceptually:

```text
Client command
      ↓
Fastify route
      ↓
Authentication / authorization
      ↓
Validation
      ↓
Command or workflow
      ↓
Domain decision
      ↓
Authoritative persistence
      ↓
Domain / integration events
      ↓
Downstream projections and side effects
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
- authoritative commands;
- aggregate behavior where Event Sourcing is used;
- domain invariants;
- authoritative Domain Events;
- EventStoreDB access for event-sourced aggregates;
- relational/operational PostgreSQL state where appropriate;
- operational REST queries;
- uploads and media-processing lifecycle coordination;
- state-changing workflows;
- notification creation/delivery orchestration where authoritative behavior is required;
- moderation decisions and enforcement commands;
- projection definitions and projection update logic owned by authoritative features;
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
EventStoreDB
PostgreSQL
Kafka / asynchronous messaging
shared contracts from packages/contracts
```

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

## `src/index.ts`

`src/index.ts` is the process entry point.

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
└── eventstore-config.ts
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
├── database/
├── eventstore/
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

PostgreSQL is used for relational, operational, or read-side data where EventStoreDB is not the appropriate authority.

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

# EventStoreDB Infrastructure

## `src/lib/eventstore/`

Canonical primitives include:

```text
eventstore/
├── client.ts
├── append-events.ts
├── read-stream.ts
├── subscribe.ts
└── stream-name.ts
```

This infrastructure should expose the important semantics of EventStoreDB without leaking low-level client details throughout feature code.

---

## Stream Naming

Stream names must be deterministic and domain-aware.

Feature-specific stream naming rules should usually live close to the feature when they encode domain identity.

Shared infrastructure may provide safe construction primitives.

Public/domain entity identifiers must not depend on physical EventStoreDB stream naming.

---

## Reading Streams

Aggregate reconstruction should read the appropriate stream in version order and rebuild aggregate state deterministically.

Infrastructure should preserve expected stream version information required for optimistic concurrency.

---

## Appending Events

Authoritative event append should include expected-version semantics.

Conceptually:

```text
Load stream @ version N
        ↓
Execute command
        ↓
Produce events
        ↓
Append expecting version N
```

If the stream has advanced, the command must not silently overwrite another concurrent decision.

Conflict/retry behavior is feature-specific.

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
command.ts
domain-event.ts
request-context.ts
projection.ts
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
├── metadata/
└── projection-writer/
```

Integrations are adapters.

They do not own domain decisions.

---

## Storage Integration

The storage integration coordinates object-storage operations such as:

- generating authorized upload destinations;
- deleting stored objects;
- future lifecycle actions.

Large binary media must not flow through EventStoreDB event payloads or ordinary JSON domain events.

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

## Projection Writer Integration

`projection-writer/` provides an explicit boundary when API-owned projection logic needs to update an external read store or projection-processing component.

The focused projection architecture must determine whether this remains the correct mechanism.

The important rule is that projection writing remains separate from authoritative aggregate persistence.

---

# Workflows

## `src/workflows/`

Workflows coordinate multi-step application behavior that spans multiple feature or integration boundaries.

Canonical workflow groups include:

```text
workflows/
├── uploads/
├── moments/
├── auth/
├── notifications/
└── moderation/
```

A workflow exists because the operation crosses meaningful boundaries.

Do not use workflows as a generic replacement for command handlers.

---

## Workflow Versus Command Handler

A command handler should own one authoritative domain use case where the primary behavior belongs to a feature.

A workflow is appropriate when the use case must coordinate several independently owned steps.

Example:

```text
Finalize upload
     ↓
verify upload state
     ↓
extract metadata
     ↓
initiate processing
     ↓
record authoritative state changes
```

The workflow coordinates.

Feature aggregates and handlers still own domain decisions.

---

## Workflow Failure

Long-running workflows must be explicit about partial failure.

They should not rely on distributed transactions across:

- EventStoreDB;
- PostgreSQL;
- object storage;
- transcoding systems;
- email/push providers;
- Kafka;
- projection stores.

Prefer durable state transitions, retryable work, and compensating/recovery actions where necessary.

---

# Feature Architecture

## `src/features/`

The canonical API features are:

```text
features/
├── auth/
├── authorization/
├── users/
├── uploads/
├── moments/
├── reactions/
├── timelines/
├── notifications/
└── moderation/
```

Each feature owns the application/domain behavior associated with that capability.

Features should remain as independently understandable as practical.

---

# Feature Structure

A feature may contain some or all of:

```text
<feature>/
├── index.ts
├── aggregates/
├── commands/
├── events/
├── event-handlers/
├── projections/
├── queries/
├── routes/
├── schemas/
└── utils/
```

Not every future feature must contain every directory.

Structure follows actual behavior rather than CQRS/Event Sourcing ceremony.

---

# Feature Entry Point

A feature-level `index.ts`, where retained, is a deliberate public entry point for feature registration or externally consumable feature contracts.

It must not become a broad barrel file exporting every internal implementation symbol.

Internal imports should remain explicit.

---

# Aggregates

## `aggregates/`

An aggregate owns domain invariants and state transitions for a consistency boundary.

An aggregate should:

- reconstruct state from authoritative history where event sourced;
- expose domain-intent methods;
- validate invariants;
- emit authoritative Domain Events;
- remain independent of Fastify and infrastructure clients.

An aggregate should not:

- execute SQL;
- call Fastify APIs;
- publish push notifications directly;
- write ClickHouse rows;
- call object storage;
- know GraphQL;
- return HTTP responses.

---

# Commands

## `commands/`

A command represents an intention to change authoritative state.

Examples conceptually include:

```text
CreateMoment
AddReaction
SuspendUser
RevokeSession
```

Commands should be explicit and use canonical product language.

Command handlers:

1. receive validated command input and trusted request context;
2. load required authoritative state;
3. enforce application authorization where appropriate;
4. invoke aggregate/domain behavior;
5. persist resulting authoritative events/state;
6. trigger or schedule required downstream workflow/integration behavior.

Handlers should remain focused.

If a handler becomes a large orchestration across unrelated feature boundaries, that logic likely belongs in a workflow.

---

# Queries

## `queries/`

The API may serve queries that belong naturally to its authoritative/operational boundary.

Examples include:

- current session state;
- authentication provider status;
- user account/profile state;
- upload state;
- moderation case/status where appropriate;
- notification read state where the API owns it;
- command-side information necessary for account/settings screens.

The API should **not** become the general high-volume Timeline query service.

The following belong primarily to the feed aggregator:

- Timeline slices;
- multidimensional navigation;
- horizontal context composition;
- Moment depth read composition for Timeline consumption;
- temporal zoom;
- historical jumps;
- Timeline prefetching;
- high-volume ClickHouse-based Timeline queries.

The boundary is defined by ownership and access pattern, not by whether something is technically a "query."

---

# Domain Events

## `events/`

Feature events record accepted authoritative domain facts.

They should be named in past tense and use canonical domain language.

Examples:

```text
user-created
reaction-added
moment-created
session-revoked
```

Event schemas are durable contracts.

Changing a persisted event requires more care than changing ordinary internal code.

---

## Event Payload Design

Domain Events should contain enough information to represent the accepted fact without becoming indiscriminate snapshots of every aggregate property.

Avoid embedding sensitive personal data unnecessarily in immutable streams.

This is particularly important for:

- identity information;
- email addresses;
- precise locations;
- media-derived metadata;
- moderation evidence;
- other data subject to privacy/erasure obligations.

Focused Event Sourcing and privacy architecture must define how sensitive mutable data is referenced, externalized, redacted, or erased.

---

# Event Handlers

## `event-handlers/`

Event handlers react to accepted Domain Events within application-owned asynchronous or derived behavior.

They may:

- update projections;
- initiate workflows;
- create notification candidates;
- schedule secondary processing;
- update related application state where the architecture explicitly permits it.

An event handler must be idempotent when delivery can repeat.

Handlers must not rely on exactly-once transport.

---

# Projections

## `projections/`

Feature projections define how authoritative events produce derived read state.

Examples in the canonical tree include profile, session, upload, Moment, Reaction, Timeline, notification, and moderation projections.

A projection is not the read model itself.

Conceptually:

```text
Domain Events
     ↓
Projection logic
     ↓
Materialized read model
```

Projection logic must be:

- deterministic where practical;
- idempotent;
- checkpointable;
- replayable;
- observable;
- versionable where representation changes materially.

Projection rebuild must not resurrect information that current deletion, privacy, moderation, or legal state requires to remain unavailable.

Detailed projection execution belongs in `docs/architecture/projections.md`.

---

# Routes

## `routes/`

Feature routes own the HTTP boundary for that feature.

Routes should:

- declare HTTP method/path;
- bind request/response schemas;
- require the appropriate authentication level;
- translate validated transport input into command/query inputs;
- invoke the application handler;
- translate application results/errors into HTTP responses.

Routes should not:

- contain SQL;
- reconstruct aggregates;
- perform domain calculations;
- embed large orchestration workflows;
- duplicate authorization rules that belong to handlers/policies;
- manually publish Domain Events.

Routes remain thin by design.

---

# Schemas

## `schemas/`

Feature schemas validate feature-owned transport/application inputs.

Where the exact serialized contract is shared with clients or another deployable application, the canonical schema may belong in `packages/contracts` and be consumed by the feature.

Where a schema is purely API-internal, keep it local.

Do not duplicate two independently maintained runtime schemas for the same cross-boundary contract.

---

# Feature Utilities

## `utils/`

Feature utilities are allowed when they are genuinely feature-specific and side-effect-light.

Examples:

- canonical stream-name construction;
- normalization rules owned by the feature;
- small deterministic helpers.

Do not move domain behavior into vaguely named utility functions to avoid modeling it explicitly.

---

# Authentication Feature

## `features/auth`

The authentication feature owns identity and session behavior.

The canonical tree includes:

- `identity.aggregate.ts`;
- `session.aggregate.ts`;
- identity email lifecycle commands;
- OAuth link/unlink commands;
- two-factor authentication commands;
- session creation, refresh, revoke, expire, and revoke-all behavior;
- auth-related events;
- auth projections and queries;
- auth routes and schemas.

The exact supported authentication mechanisms must be finalized in `docs/architecture/authentication.md`.

This document establishes the boundary:

```text
Authentication feature
    ↓
establish identity/session truth

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
- enforcing invariants around role assignment;
- recording role-assignment Domain Events;
- projecting current User authorization state;
- exposing current effective permissions for trusted consumers;
- maintaining the canonical permission registry and role-to-permission mapping;
- providing reusable authorization policies for feature/application boundaries;
- exposing privileged REST routes for role management where required.

The initial canonical model deliberately does **not** include arbitrary per-User permission grants. Roles grant permissions. Direct grants may be introduced only if a concrete product/security requirement later justifies them.

The feature remains separate from authentication:

```text
features/auth
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
- user profile/status projections;
- account/profile queries.

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

- upload registration;
- receipt confirmation;
- metadata attachment;
- processing start;
- processing completion/failure where authoritative;
- upload deletion;
- upload status/read models.

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

Future Moment commands must not recreate that hierarchy under different names.

Moment media ordering and association must be modeled without making each media item a nested historical Moment.

---

# Reactions Feature

## `features/reactions`

The reactions feature owns authoritative Reaction lifecycle.

Its responsibilities include:

- add Reaction;
- remove Reaction;
- update Reaction if supported by product semantics;
- Reaction domain events;
- Reaction read/projection state;
- authorized Reaction queries where appropriate.

Reactions are social activity.

They must not change Moment occurrence time or become authoritative historical significance.

---

# Timelines Feature

## `features/timelines`

`features/timelines/` owns no aggregate, no commands, and no events (ADR-084).

The finalized product model establishes that the Timeline is a derived historical representation rather than an arbitrary user-created container. A derived representation has nothing to create, rename, archive, or delete: it changes when the history beneath it changes.

The feature owns the projections that maintain Timeline read models, and nothing else:

```text
features/timelines/
    projections/   Timeline read models
    schemas/
    utils/         cursor encoding
```

It must **not** own high-volume Timeline composition. That belongs to `apps/feed-aggregator`, which also owns the Timeline query handlers.

The earlier canonical tree carried a Timeline aggregate and five lifecycle commands. Each was reviewed against `docs/product/timeline.md` and `docs/product/timelines.md`, none had a product-semantic justification, and all were removed rather than implemented ceremonially.

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
- notification-related events and projections;
- notification queries and routes.

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
- moderation events and projections.

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

# Administrative Commands

Administrative operations follow the same command architecture as other authoritative mutations.

Conceptually:

```text
Authorized consumer UI
        ↓
REST command
        ↓
authenticated request context
        ↓
permission check
        ↓
moderation/admin handler
        ↓
authoritative event/state change
```

The fact that the invoking client is the normal consumer application changes nothing about backend authority.

---

# REST Boundary

The API's public application interface is REST.

REST routes should be resource/use-case oriented and preserve Chronologity terminology.

Avoid exposing command/event implementation details unnecessarily in URLs.

The client should not need to know:

- aggregate stream names;
- EventStoreDB versions;
- Kafka offsets;
- projection checkpoints;
- database table names.

Those are implementation details.

---

# REST Commands and Idempotency

Commands that can be retried after ambiguous network failure should support explicit idempotency where duplicate execution could cause harm.

Examples may include:

- Moment creation;
- upload registration;
- administrative actions;
- notification-triggering operations;
- payment-like future operations if introduced.

The exact idempotency-key mechanism belongs in the API contract documentation.

Idempotency must not be assumed merely because a handler is "usually only called once."

---

# Request Lifecycle

A typical authenticated command request should follow:

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
command handler / workflow
    ↓
aggregate/domain behavior
    ↓
authoritative persistence
    ↓
result
    ↓
HTTP response
```

Downstream projection/notification/indexing work may continue asynchronously after the authoritative response when the product does not require synchronous completion.

---

# Command Persistence Flow

For an event-sourced aggregate:

```text
Validated command
      ↓
Load aggregate stream
      ↓
Reconstruct aggregate
      ↓
Authorize / validate state transition
      ↓
Execute domain method
      ↓
Produce Domain Events
      ↓
Append with expected version
      ↓
Commit succeeds
      ↓
Publish/propagate downstream
```

The authoritative command is successful when the authoritative persistence boundary commits successfully—not when every downstream projection finishes.

---

# Reliable Event Publication

A committed authoritative change must eventually reach required downstream consumers.

The API architecture therefore requires a reliable publication mechanism between EventStoreDB and Kafka/projection consumers.

This document does not choose the precise mechanism.

The focused messaging/event architecture must define:

- EventStoreDB subscription strategy;
- checkpoint ownership;
- Kafka publication;
- retry behavior;
- poison-event handling;
- deduplication;
- integration-event versioning.

The required invariant is:

```text
Committed authoritative event
        ↓
must not be permanently lost downstream
```

while also preventing:

```text
uncommitted authoritative event
        ↓
visible as accepted downstream fact
```

---

# Operational Queries

Not every API query needs EventStoreDB reconstruction.

Queries should use the read representation appropriate to their use case.

For example:

- user/profile/account state may come from PostgreSQL read models;
- upload status may come from operational state;
- session status may come from session read state;
- moderation status may come from moderation read models.

The API should not force event replay on ordinary request paths where a safe read projection is the correct representation.

---

# Transactions

Transactions should be local to the system that owns the authoritative change.

Do not attempt distributed transactions across EventStoreDB, PostgreSQL, Kafka, object storage, ClickHouse, and external providers.

Prefer:

```text
local authoritative commit
        ↓
durable workflow/event
        ↓
asynchronous propagation
        ↓
retry/recovery
```

When a multi-step workflow has visible intermediate states, those states should be explicit.

---

# Concurrency

Event-sourced aggregates should use optimistic concurrency.

Relational state should use appropriate transactional or optimistic concurrency mechanisms according to feature semantics.

The API must not rely on application-process memory as the only protection against concurrent commands.

Horizontally scaled API instances must produce the same correctness behavior.

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
- command preconditions.

## Domain validation

Answers:

> Does this state transition preserve domain invariants?

Examples:

- invalid aggregate state transition;
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

Internal stack traces, SQL errors, EventStoreDB errors, secrets, or raw provider failures must not be exposed to clients.

---

# Observability

Every request should be traceable through the authoritative path.

Important fields may include:

- trace ID;
- request ID;
- authenticated user/identity ID where safe and appropriate;
- command name;
- aggregate ID;
- event stream/version;
- workflow ID;
- downstream message correlation ID.

Logs must avoid unnecessary sensitive payloads.

Metrics should make it possible to identify:

- command latency;
- command failure rates;
- optimistic concurrency conflicts;
- EventStoreDB latency;
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

Key command paths should remain efficient, but high-volume derived reads should be delegated to read models and the aggregator.

Avoid rebuilding large aggregate histories on request paths without snapshots or another justified strategy if stream length becomes materially expensive.

Performance optimizations must preserve correctness and auditability.

---

# Testing

Tests are colocated with implementation by default.

The API requires several test levels.

## Aggregate tests

Verify:

- invariant enforcement;
- state reconstruction;
- emitted events;
- invalid state transitions;
- concurrency-relevant behavior.

Aggregate tests should not require networked infrastructure.

## Command-handler tests

Verify:

- authorization;
- aggregate loading;
- correct domain invocation;
- persistence behavior;
- expected errors;
- idempotency behavior where applicable.

## Query-handler tests

Verify:

- correct read-store usage;
- authorization filtering;
- result mapping;
- not-found and unavailable states.

## Route tests

Verify:

- HTTP method/path;
- schema validation;
- authentication requirements;
- status/error mapping;
- serialization.

They should not duplicate every domain rule already tested below the route layer.

## Projection tests

Verify:

- deterministic updates;
- duplicate-event safety;
- ordering assumptions;
- rebuild behavior;
- deletion/privacy/moderation propagation.

## Workflow tests

Verify:

- state transitions across steps;
- partial failure;
- retry;
- external-integration failure;
- compensation/recovery behavior.

## Integration tests

Use real infrastructure where behavior cannot be trusted through mocks alone, particularly:

- EventStoreDB expected-version behavior;
- PostgreSQL transactions/queries;
- Kafka or publication behavior;
- storage/upload integration boundaries;
- projection persistence.

---

# Dependency Rules

Within `apps/api`, dependencies should flow toward domain/application meaning.

A useful conceptual direction is:

```text
server / routes / plugins
          ↓
commands / queries / workflows
          ↓
domain aggregates and policies
          ↑
infrastructure adapters
```

Specific rules:

1. aggregates must not import Fastify;
2. aggregates must not import database clients;
3. routes may import feature handlers/contracts, not persistence internals;
4. workflows may coordinate features/integrations but should not absorb aggregate invariants;
5. integrations do not make domain decisions;
6. projections consume authoritative facts but do not mutate aggregate history;
7. features do not import implementation from another deployable application;
8. cross-runtime serialized contracts come from `packages/contracts`;
9. application-local infrastructure stays in `apps/api`;
10. `lib/` must not become an unowned generic utility layer.

---

# Cross-Feature Dependencies

Feature-to-feature imports should be minimized.

When one feature needs another feature's behavior, prefer one of:

- an explicit application-level port/interface;
- a workflow that coordinates both;
- an event-driven reaction when synchronous coupling is unnecessary;
- a shared cross-boundary contract where the dependency is truly serialized.

Avoid importing another feature's aggregate internals simply because both live in one application.

Feature boundaries should remain meaningful enough that future extraction is possible if scale or ownership ever justifies it.

---

# No Global Controller/Service/Repository Architecture

Chronologity deliberately does not organize the API as:

```text
controllers/
services/
repositories/
models/
```

for all features globally.

That structure groups code by technical role while scattering one domain capability across the entire application.

Chronologity instead keeps behavior feature-local.

A feature may still contain infrastructure adapters or application services when those abstractions are genuinely useful.

The prohibition is against using generic layer buckets as the dominant repository architecture.

---

# No Separate Admin Backend

Administrative capability is part of the authoritative API.

There is no:

```text
apps/admin/
```

and there should not be a parallel `admin-api` merely because some commands require elevated permissions.

Administrative commands remain feature/domain operations protected by role/permission policy.

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
- EventStoreDB aggregate persistence where selected;
- optimistic concurrency;
- PostgreSQL operational/read state;
- reliable event publication;
- idempotent downstream handling contracts;
- external storage integration;
- media-processing integration;
- tracing/logging/metrics;
- graceful startup/shutdown;
- unit, integration, route, projection, and workflow tests appropriate to critical paths.

---

# Open Architectural Questions

The following questions must be resolved in focused architecture documents before implementation hardens their answers.

## Event-Sourced Aggregate Boundaries

- Which canonical features are definitively event sourced?
- Are both `identity` and `session` event-sourced aggregates?
- Is `User` event sourced?
- Is `Upload` event sourced?
- Is `Moment` event sourced?
- Is `Reaction` event sourced?
- Is Notification event sourced or relational/operational?
- Is Moderation case/enforcement state event sourced?
- Which aggregates need snapshots as streams grow?

## Authentication

- Which authentication methods ship on day one?
- Are magic links day one?
- Which OAuth providers are supported?
- Is two-factor authentication day one?
- What are session/access-token lifetimes?
- How are refresh credentials represented and revoked?
- Which session information can safely live in immutable event payloads?

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

- What authoritative information does `features/timelines` own?
- Which existing create/update/archive/restore/delete commands remain valid after the finalized derived-Timeline product model?
- Is Timeline a true aggregate or a persisted definition/resource feeding read-side composition?
- Which Timeline types have authoritative definitions versus purely derived scopes?
- Which commands should be removed before implementation?

## Reliable Publication

- How are EventStoreDB changes published reliably to Kafka?
- Which process owns the subscription?
- Where are checkpoints persisted?
- Are Domain Events published directly or transformed into integration events?
- How are schema versions handled?
- How are poison messages quarantined?
- How is downstream replay initiated?

## Projection Execution

- Do feature projection definitions execute inside API worker entry points?
- Is there a dedicated projection process inside `apps/api`?
- Does `projection-writer` publish to a separate worker?
- Which projections write PostgreSQL?
- Which write ClickHouse?
- Does the API actually need `lib/database/clickhouse.ts` after projection architecture is finalized?

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

- Is notification creation synchronous with the triggering command or event-driven?
- What state is authoritative?
- Where is read/unread state persisted?
- How are push/email delivery attempts separated from notification truth?
- How is high-volume Reaction activity aggregated?

## Moderation

- What are the authoritative moderation aggregate boundaries?
- Is a Report separate from a moderation Case?
- How are appeals modeled?
- Which administrative commands require which permissions?
- How does enforcement propagate to ClickHouse and other read systems?
- How are emergency actions handled without bypassing auditability?

## API Queries

- Which profile/user queries should remain in the API versus move to Timeline read composition?
- Does Moment detail have both an authoritative API representation and an aggregator-composed Timeline representation?
- How are operational queries distinguished from high-volume derived reads consistently?
- What are the client contracts for projection-lag cases?

## Idempotency

- Which REST mutation endpoints require idempotency keys?
- Where are keys/results stored?
- How long are they retained?
- How do idempotency semantics interact with optimistic concurrency?

## Errors

- What is the canonical error envelope?
- Which stable error codes exist?
- How are validation details represented?
- Which errors are retryable?
- How are projection-lag or asynchronous-processing states represented without treating them as failures?

## Observability

- Which tracing implementation is used?
- How does trace context propagate into Kafka and workflows?
- What event publication lag is acceptable?
- How are aggregate concurrency conflicts measured?
- How are sensitive administrative actions audited?

These questions should be answered in the focused documents that own them rather than embedded ad hoc into implementation.

---

# Architectural Invariants

1. `apps/api` is Chronologity's authoritative backend application.
2. The API owns authoritative mutations; the feed aggregator owns high-volume Timeline read composition.
3. Fastify routes remain thin transport adapters.
4. Domain aggregates do not depend on Fastify or persistence clients.
5. Feature organization is primary.
6. No global controller/service/repository hierarchy defines the application.
7. Commands represent intentions to change authoritative state.
8. Queries do not mutate authoritative state.
9. Event-sourced aggregate writes use expected-version concurrency.
10. Domain Events represent accepted past-tense facts.
11. Persisted Domain Events are durable schemas and must evolve carefully.
12. Sensitive data should not be copied unnecessarily into immutable events.
13. Event handlers and projection consumers must tolerate duplicate delivery.
14. Projections produce derived state; they do not become authoritative state.
15. Projection rebuilds must honor current privacy, deletion, and moderation constraints.
16. Workflows coordinate multi-boundary operations; they do not replace feature domain behavior.
17. Distributed transactions across infrastructure systems are avoided.
18. Long-running work uses explicit recoverable state.
19. External integrations are adapters, not domain authorities.
20. API-side ClickHouse access must remain narrowly justified and must not bypass the feed aggregator's read boundary.
21. A Moment is the fundamental historical unit and is never equated with a single media object.
22. The Moment model contains no recursive Sub-Moment hierarchy.
23. A Moment may contain unlimited media at the product level.
24. Per-video duration is limited to 90 seconds.
25. Occurrence time remains distinct from operational timestamps.
26. Authentication and authorization are separate concerns.
27. Administrative authority is backend-enforced through roles/permissions.
28. There is no separate admin application.
29. Client-side role checks are presentation convenience, not security.
30. Cross-application implementation imports are prohibited.
31. Cross-runtime contracts are explicit and validated.
32. API-local implementation types should not leak into shared contract packages without a boundary reason.
33. Runtime validation is required at trust boundaries.
34. Errors map from domain/application semantics to HTTP at the transport boundary.
35. Retryable command boundaries must be safe against duplicate execution where required.
36. Authoritative commit does not wait for every derived projection to converge unless a product guarantee explicitly requires it.
37. A committed authoritative event must not be permanently lost to required downstream processing.
38. Observability must trace authoritative changes through downstream publication.
39. Tests are colocated with implementation by default.
40. Architecture documentation must be amended when implementation intentionally changes these boundaries.

---

# Guiding Principle

When deciding whether behavior belongs in `apps/api`, ask:

> **Does this code make, protect, persist, or coordinate an authoritative Chronologity decision—or is it composing derived historical state for consumption?**

If it makes or protects an authoritative decision, it likely belongs in the API.

If it primarily composes read-optimized Timeline state, it likely belongs in the feed aggregator.

The API should remain the place where Chronologity decides what the system accepts as true—not the place where every possible representation of that truth is assembled.
