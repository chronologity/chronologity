# Chronologity CQRS Architecture

## Purpose

This document defines how Command Query Responsibility Segregation (CQRS) is used in Chronologity.

CQRS exists in Chronologity because the authoritative write model and the high-volume read model have materially different responsibilities.

The write side must protect:

- domain invariants;
- authorization;
- authoritative state transitions;
- auditability;
- Event Sourcing boundaries;
- workflow correctness.

The read side must optimize:

- chronological retrieval;
- Timeline composition;
- temporal zoom;
- historical jumps;
- contextual adjacency;
- large-scale pagination;
- read authorization;
- derived views.

CQRS is therefore a means of preserving different models for different responsibilities.

It is **not** a requirement to create separate deployable services for every command and query, and it is **not** a reason to introduce ceremony where the read and write models do not materially differ.

This document is grounded in:

- `docs/architecture/overview.md`;
- `docs/architecture/principles.md`;
- `docs/architecture/monorepo.md`;
- `docs/architecture/api.md`;
- `docs/architecture/authentication.md`;
- `docs/architecture/authorization.md`.

---

# Core Principle

Chronologity separates:

```text
Authoritative decision-making
        ↓
command side

from

Read-optimized representation
        ↓
query side
```

The central architectural rule is:

> **Commands decide what the system accepts as true. Queries describe what the system currently knows how to present.**

That distinction must remain clear even when both command and query code live in the same deployable application.

---

# Why Chronologity Needs CQRS

Chronologity's write and read workloads are not symmetric.

A Moment command may need to:

- authenticate the User;
- authorize the action;
- load authoritative aggregate state;
- enforce occurrence-time semantics;
- enforce Moment invariants;
- append Domain Events;
- initiate upload/media workflows;
- coordinate moderation or privacy behavior.

A Timeline query may need to:

- scan chronological ranges;
- retrieve neighboring temporal slices;
- resolve horizontal contexts;
- aggregate at broader temporal scales;
- support historical jumps;
- compose media and metadata;
- filter based on privacy, moderation, blocking, and Viewer context;
- query ClickHouse efficiently.

Trying to force both responsibilities through one persistence/read model would make either the write side too permissive or the read side too slow and complex.

---

# CQRS Does Not Mean Microservices

Chronologity's CQRS boundary is primarily logical.

The canonical applications are:

```text
apps/api
apps/feed-aggregator
apps/mobile
apps/web
```

Within `apps/api`, commands and many operational queries coexist.

The high-volume Timeline read model is separated into `apps/feed-aggregator` because its workload and storage model are materially different.

That is enough.

Chronologity should not create:

```text
moment-command-service
moment-query-service
reaction-command-service
reaction-query-service
```

merely to claim strict CQRS.

A deployable boundary is justified only when workload, availability, security, ownership, or technology needs require it.

---

# Command Side

The primary command side lives in:

```text
apps/api
```

The API owns authoritative state changes.

Conceptually:

```text
REST request
    ↓
route
    ↓
command / workflow
    ↓
authorization
    ↓
aggregate/domain behavior
    ↓
authoritative persistence
    ↓
Domain Events
```

The command side answers:

> **Should this state transition be accepted?**

---

# Query Side

Chronologity has more than one query context.

## Operational/API Queries

Some queries belong naturally in `apps/api`.

Examples include:

- current User profile/account state;
- Session state;
- authorization state;
- upload status;
- moderation case/status where appropriate;
- notification read state;
- settings/preferences;
- command-side state needed by account/security screens.

These queries may use PostgreSQL read models or other API-owned read representations.

They do not require Timeline-specific infrastructure merely because they are queries.

## Timeline Queries

High-volume historical navigation belongs in:

```text
apps/feed-aggregator
```

These queries include:

- Timeline head;
- chronological slices;
- previous/next ranges;
- horizontal context adjacency;
- Moment depth composition;
- temporal zoom;
- historical jumps;
- Timeline context around a Moment or timestamp;
- location/user/tag/network/event scoped Timeline reads;
- prefetching adjacent contexts;
- large-scale Timeline composition.

These queries are read-only and primarily use ClickHouse-derived read models.

---

# Command and Query Contracts

Commands and queries should be explicit types.

A command represents intent:

```text
CreateMoment
AddReaction
AssignUserRole
SuspendUser
```

A query represents a request for information:

```text
GetUserProfile
GetUploadStatus
GetTimelineSlice
GetMomentDepth
```

Do not use names such as:

```text
UpdateData
GetStuff
ProcessThing
```

Canonical domain terminology should be preserved.

---

# Commands

A command should contain the minimum data required to express the intended state transition.

A command should not contain:

- HTTP request objects;
- Fastify reply objects;
- database clients;
- derived read-model rows;
- arbitrary client-calculated authorization decisions.

Conceptually:

```text
command payload
+
trusted request context
        ↓
handler
```

---

# Command Handlers

A command handler coordinates one authoritative use case.

Typical responsibilities:

1. load the required authoritative state;
2. evaluate application-level authorization;
3. invoke aggregate/domain behavior;
4. persist resulting events/state;
5. initiate downstream workflow/event publication where necessary;
6. return a result meaningful to the caller.

A handler should not become a generic service containing unrelated feature operations.

---

# Command Results

Command responses should confirm authoritative outcomes.

Examples:

```text
Moment created
Reaction added
Role assigned
Upload registered
```

A command response should not pretend every eventual projection has already converged.

Where the client needs immediate display information, the API may return the accepted authoritative result or identifier.

The client can optimistically represent that confirmed state while read models catch up.

---

# Command Idempotency

Some commands require idempotency because network failure can leave the caller uncertain whether the command succeeded.

Potential examples:

- Moment creation;
- upload registration;
- role assignment;
- moderation enforcement;
- future monetary or irreversible actions.

Idempotency must be explicit at the command boundary.

It should not be assumed from HTTP method semantics alone.

---

# Queries

A query must not mutate authoritative state.

A query may:

- read a projection;
- compose data from derived read models;
- apply authorization;
- calculate a transient representation;
- paginate;
- aggregate.

It must not:

- append Domain Events;
- update aggregate state;
- silently "fix" authoritative data;
- emit mutation side effects merely because it was read.

Observability side effects such as metrics/logging are not domain mutation.

---

# Query Handlers

Query handlers should reflect the read model they consume.

For API-owned operational reads:

```text
query
  ↓
query handler
  ↓
PostgreSQL/read model
```

For Timeline reads:

```text
GraphQL resolver
  ↓
query/composition function
  ↓
ClickHouse read model
```

The query side should avoid reconstructing event-sourced aggregates merely to answer ordinary reads when a safe projection exists.

---

# Query Models

Read models should be purpose-built.

A Timeline read row may contain denormalized data optimized for:

- chronology;
- visibility filtering;
- creator summary;
- media summary;
- contextual grouping;
- historical-significance anchors.

A command-side aggregate may instead contain only the state necessary to enforce invariants.

The two models need not match.

That is the point of CQRS.

---

# Event Sourcing and CQRS

Event Sourcing and CQRS are related but separate patterns.

Chronologity may use:

```text
CQRS without Event Sourcing
```

for features whose authoritative state is relational but whose reads still benefit from separate projections.

Likewise, an event-sourced aggregate naturally benefits from:

```text
event stream
    ↓
projection
    ↓
query model
```

but Event Sourcing does not require every query to live in another service.

---

# Write Model

The write model contains only the state necessary to make correct authoritative decisions.

It should not be bloated with fields that exist solely for convenient UI display.

For example, a Moment aggregate may need:

- identity;
- creator/owner;
- occurrence semantics;
- lifecycle state;
- media association/order state;
- visibility state where owned;
- invariants.

It does not need every denormalized creator avatar, Event label, Reaction count, or Timeline cluster representation.

---

# Read Model

The read model can intentionally duplicate data.

For example, a Timeline row may include:

- Moment ID;
- occurrence time;
- creator display summary;
- media preview summary;
- Location display data;
- visibility metadata;
- moderation eligibility;
- historical-significance representation;
- contextual grouping keys.

This duplication is intentional because read performance matters.

Authority remains singular.

---

# Denormalization

CQRS allows Chronologity to denormalize aggressively on the query side.

The rule is:

```text
normalize ownership
denormalize reads
```

Denormalization is safe only when:

- the authoritative owner is explicit;
- updates propagate reliably;
- stale behavior is understood;
- privacy/moderation revocation is supported;
- rebuild is possible.

---

# Projection Boundary

Projections translate authoritative changes into query models.

Conceptually:

```text
Domain Event
     ↓
Projection
     ↓
Read Model
```

The projection owns the transformation logic.

The read model owns the resulting stored representation.

The feed aggregator consumes read models.

It does not own authoritative projection decisions.

---

# Command-to-Projection Flow

A typical event-sourced write flow is:

```text
Client
  ↓
REST command
  ↓
API command handler
  ↓
Aggregate
  ↓
EventStoreDB commit
  ↓
reliable publication
  ↓
projection
  ↓
PostgreSQL / ClickHouse
  ↓
query clients
```

The write path does not synchronously depend on every projection being current unless a specific product guarantee requires it.

---

# Eventual Consistency

CQRS introduces eventual consistency between authoritative writes and read projections.

That is acceptable when explicitly designed.

For example:

```text
User creates Moment
        ↓
API confirms Moment accepted
        ↓
Timeline projection updates moments later
```

The client may temporarily display the confirmed Moment locally.

The architecture must not hide eventual consistency behind unpredictable behavior.

---

# Read-Your-Own-Writes

Chronologity should decide where read-your-own-write behavior is required.

Possible approaches:

### Optimistic/local client representation

The client inserts the confirmed command result into local state until projections converge.

### API authoritative query

The client may read authoritative/operational state from the API immediately after the command.

### Projection wait

The system could wait for projection convergence, but this should be reserved for cases where necessary because it couples command latency to downstream read infrastructure.

The default recommendation is:

```text
authoritative command response
+
local optimistic/confirmed state
+
eventual projection convergence
```

---

# Projection Lag

Projection lag must be observable.

Important metrics include:

- EventStoreDB position;
- projection checkpoint;
- Kafka consumer lag where applicable;
- ClickHouse projection delay;
- failure/retry counts.

For Chronologity, lag is product-relevant because it affects how quickly newly accepted history appears in Timeline views.

---

# Command Bus

The canonical API structure may use command interfaces/handlers without requiring a heavyweight generic command bus.

A command bus is useful if it provides:

- consistent handler dispatch;
- middleware/interceptors;
- tracing;
- authorization hooks;
- idempotency;
- transactional boundaries.

It is not useful if it merely replaces:

```text
handler.execute(command)
```

with an unnecessary abstraction.

Chronologity should prefer the simplest mechanism that preserves testability and cross-cutting behavior.

---

# Query Bus

The same principle applies to a query bus.

A generic query bus is optional.

Feature-local query handlers are sufficient unless a real need emerges for shared dispatch/interception behavior.

The feed aggregator does not need to imitate the API's internal command/query infrastructure merely for conceptual symmetry.

---

# CQRS in `apps/api`

The API feature structure already expresses CQRS naturally:

```text
features/<feature>/
├── commands/
└── queries/
```

Commands and queries remain colocated with their feature.

The API should not create global:

```text
commands/
queries/
```

directories that erase feature ownership.

---

# CQRS in `apps/feed-aggregator`

The aggregator is query-only.

Its canonical structure contains query/composition modules around:

- Timelines;
- Moments;
- Locations;
- Users;
- Reactions;
- moderation visibility.

It does not need dummy command infrastructure.

Read-only applications should remain honestly read-only.

---

# Authorization on the Command Side

Command authorization protects mutation.

Examples:

```text
CreateMoment
    → authenticated User may create

AssignUserRole
    → requires role-management permission

RestrictContent
    → requires moderation permission
```

Authorization should occur before mutation, but aggregate invariants must still enforce valid state transitions.

---

# Authorization on the Query Side

Query authorization protects disclosure.

Examples:

```text
GetTimelineSlice
    → filter private/blocked/moderated Moments

GetUserAuthorization
    → caller must be self or privileged

GetModerationCase
    → purpose-bound moderator access
```

Command-side and query-side authorization must remain semantically aligned.

---

# Authentication Queries

Authentication/session queries belong in the API because Session state is authoritative/security-sensitive.

Examples:

- current Sessions;
- Session status;
- linked providers;
- two-factor state.

They should not be projected into ClickHouse simply because CQRS exists.

---

# Authorization Queries

The dedicated `features/authorization/` module may expose trusted queries such as:

```text
GetUserAuthorization
GetCurrentUserPermissions
```

These support:

- API permission evaluation;
- mobile UI capability hints;
- feed-aggregator read authorization where appropriate.

The feed aggregator must not become authoritative for roles or permissions.

---

# Timeline CQRS Boundary

Timeline is where CQRS matters most.

The authoritative API may own Timeline definitions/scopes where product semantics require persisted state.

The feed aggregator owns the expensive derived composition.

Conceptually:

```text
API
  → Moments and the domain facts Timelines derive from

Projection system
  → Timeline read models

Feed Aggregator
  → Timeline composition/navigation
```

Do not make the API's `features/timelines/` a duplicate Timeline read service.

---

# Moment CQRS Boundary

The Moment write model and read model are distinct.

### API Moment model

Owns authoritative lifecycle and invariants.

### Aggregator Moment model

Owns read composition for Timeline depth.

The aggregator's Moment representation may combine:

- Moment projection;
- media summaries;
- User summary;
- Reaction summary;
- Location context;
- moderation visibility.

That denormalized shape must not become the source of Moment truth.

---

# Reactions CQRS Boundary

Reaction commands belong to the API.

Reaction summary/read composition may exist in both:

- API operational queries where needed;
- aggregator read models for Timeline/Moment display.

The read side may maintain counts or Viewer-specific Reaction summaries.

Those counts are derived.

---

# Notifications CQRS Boundary

Notification creation/read state may live primarily in the API.

Delivery attempts are side effects.

The product does not need notification queries in the Timeline aggregator unless a specific read surface justifies it.

CQRS does not require every read to use ClickHouse.

---

# Moderation CQRS Boundary

Moderation decisions are authoritative API commands.

Moderation projections may serve:

- moderator case screens;
- Timeline eligibility;
- Search/Discovery filtering;
- notification behavior.

The feed aggregator consumes moderation visibility state.

It does not issue moderation commands.

---

# Authorization CQRS Boundary

Role assignment/removal are authoritative commands.

Current effective permission state may be projected for fast read evaluation.

High-risk actions may still verify current authoritative authorization state when projection staleness would be unsafe.

This is a consequence-driven consistency decision.

---

# Storage Responsibilities

CQRS does not mean "write DB" and "read DB" are always one-to-one.

Chronologity uses:

```text
EventStoreDB
    → authoritative event-sourced history

PostgreSQL
    → relational/operational state and API-owned read models

ClickHouse
    → high-volume derived Timeline read models
```

A feature may use EventStoreDB plus PostgreSQL.

Another may use PostgreSQL only.

Timeline reads may use ClickHouse.

The storage choice follows authority and access pattern.

---

# ClickHouse

ClickHouse is not a universal query database.

It should contain read models whose workload benefits from:

- chronological range scans;
- denormalization;
- high-volume reads;
- aggregation;
- large-scale Timeline composition.

Do not project every API query into ClickHouse merely because it exists.

---

# PostgreSQL Read Models

PostgreSQL is appropriate for many API-owned queries.

Examples may include:

- profile projections;
- Session projections;
- authorization projections;
- upload status;
- moderation cases;
- notification state.

These reads may be strongly or eventually consistent according to feature consequence.

---

# EventStoreDB Queries

EventStoreDB should generally not be used as a high-volume query store.

It is optimized around event streams and authoritative event history.

Aggregate reconstruction is a command-side operation.

Operational/admin history queries may access event streams where justified, but ordinary client reads should use projections.

---

# Query Composition

Read-side composition should avoid synchronous fan-out across many stores.

If a Timeline GraphQL request requires:

```text
ClickHouse
+
PostgreSQL
+
EventStoreDB
+
API calls
+
external provider
```

for every row, the read model is under-designed.

Prefer denormalized purpose-built projections.

Authorization-sensitive data may still require carefully designed current-state checks.

---

# N+1 Avoidance

GraphQL can easily generate N+1 read patterns.

The feed aggregator should use:

- request-scoped DataLoaders;
- batched ClickHouse queries;
- denormalized read models;
- prefetching.

CQRS enables read models designed specifically to avoid this problem.

---

# Cursor Pagination

Timeline queries should use opaque cursor/keyset semantics rather than offset pagination for high-volume historical data.

CQRS read models should expose stable sorting keys that preserve:

- occurrence time;
- deterministic tie-breaking;
- backfilled history behavior.

Pagination internals must remain hidden behind query contracts.

---

# Backfilled History

Backfilled Moments are normal.

Therefore a read model must support:

```text
newly projected Moment
        ↓
inserted into historical chronological position
```

not only append-to-end behavior.

Cursor design and projection logic must account for this.

---

# Temporal Zoom

Temporal zoom requires scale-aware read models/queries.

At narrow scale:

```text
individual Moments
```

At broad scale:

```text
clusters / aggregates / historical anchors
```

These are query-side representations.

The write model does not change because the User zoomed out.

---

# Historical Jumps

Historical jumps require direct read-side lookup around a temporal or historical anchor.

They should not mutate Timeline state merely to navigate.

The query contract should return enough context to resume:

- vertical chronology;
- horizontal context;
- depth navigation.

---

# Historical Significance

Historical significance is derived state.

It belongs primarily on the query/projection side.

If Users or administrators make authoritative assertions that contribute to significance, those assertions may be commands/events.

The calculated significance representation remains derived.

---

# Causality

Authoritative causal assertions or corrections belong on the command side if Chronologity permits Users or systems to establish them.

Causal traversal/indexes belong on the query side.

This separation allows:

```text
causal relationship authority
        ↓
projection
        ↓
fast historical jump/query
```

---

# Rebuildability

CQRS read models should be rebuildable from authoritative inputs where practical.

A rebuild may occur because:

- projection logic changes;
- schema changes;
- derived state becomes corrupted;
- new read model introduced.

Rebuild must preserve current:

- privacy;
- moderation;
- deletion;
- authorization.

Replay must not resurrect forbidden data.

---

# Read Model Versioning

Materially different read-model shapes or algorithms should be versionable.

Versioning may be needed for:

- Timeline projections;
- historical-significance representations;
- temporal zoom aggregation;
- Search/Discovery indexes;
- authorization eligibility structures.

Versioning enables migration without treating derived representation as permanent truth.

---

# Projection Migration

When changing a read model, preferred patterns include:

```text
build new version
        ↓
backfill/replay
        ↓
validate
        ↓
switch readers
        ↓
retire old version
```

This reduces downtime and rollback risk.

---

# Query Contract Stability

Mobile clients may remain on older versions.

Query/API contracts must tolerate supported client version skew.

Read-model schemas may evolve internally without exposing storage details in public API/GraphQL contracts.

---

# Command Contract Stability

Command request/response contracts must also evolve safely.

A server deployment must not require every mobile client to update immediately.

Use additive compatible changes where possible.

---

# Domain Event Stability

Persisted Domain Events are more durable than command/query contracts.

They require the strongest compatibility discipline because replay may depend on them years later.

CQRS makes this distinction explicit:

```text
command contract
query contract
Domain Event schema
read model schema
```

are separate evolution concerns.

---

# Failure Semantics

Command and query failures have different consequences.

### Command failure

Means authoritative state transition was not accepted or could not be committed.

### Query failure

Means the system could not produce the requested representation.

A query failure must not cause mutation.

A read projection outage should not corrupt authoritative state.

---

# Derived-System Degradation

If ClickHouse or the feed aggregator is unavailable:

- Timeline reads may degrade or fail;
- authoritative API commands may remain available if their dependencies are healthy.

This is a benefit of CQRS separation.

The reverse may also occur: Timeline reads may remain available temporarily while authoritative commands are unavailable, depending on system state.

Clients should represent such partial availability honestly.

---

# Read-Only Safety

The feed aggregator should use read-only credentials where technically possible.

Its database account should not have permission to mutate ClickHouse authoritative projection tables except where a narrowly defined mechanism explicitly requires it.

Ideally:

```text
projection writer
    → write credentials

feed aggregator
    → read credentials
```

This reinforces architectural intent with infrastructure permissions.

---

# Query Side Effects

Queries may emit:

- logs;
- metrics;
- traces.

They should not emit domain side effects such as:

- notification creation;
- Reaction mutation;
- audit state changes unrelated to access logging;
- event-stream changes.

If reading something itself is a domain event, model that as a command.

For example, if "mark notification read" changes state, it is a command even though the UI action occurs while viewing notifications.

---

# Naming

Use `command` for mutation intent.

Use `query` for read intent.

Do not name an operation "query" merely because it returns data if it also changes authoritative state.

Examples:

```text
MarkNotificationRead
    → command

GetNotifications
    → query
```

---

# CQRS and Workflows

A workflow may coordinate multiple commands/state transitions.

Workflows are not queries.

For example:

```text
ProcessUpload
FinalizeMomentMedia
EnforceModerationDecision
```

may span asynchronous steps.

CQRS still applies within the workflow: authoritative transitions remain commands/events; read models remain derived.

---

# CQRS and Integrations

External integrations should not become hidden command/query paths.

For example:

```text
storage provider callback
```

must be translated into an explicit application command or workflow transition if it changes authoritative state.

Likewise, external metadata lookup is a query/integration read, not authoritative history until accepted by domain behavior.

---

# Testing CQRS

## Command tests

Verify:

- authorization;
- invariants;
- authoritative persistence;
- idempotency;
- optimistic concurrency;
- emitted events.

## Query tests

Verify:

- correct read source;
- filtering;
- pagination;
- result mapping;
- no mutation.

## Projection tests

Verify:

- deterministic event application;
- idempotency;
- rebuild;
- authorization/privacy propagation.

## Cross-side integration tests

Verify:

```text
command
  ↓
authoritative event
  ↓
projection
  ↓
query result
```

for critical golden paths.

---

# Golden Path Example

A representative Moment creation flow:

```text
1. Mobile sends CreateMoment command to API.

2. API authenticates and authorizes User.

3. Command handler loads Moment aggregate state as required.

4. Domain behavior accepts creation and emits MomentCreated.

5. Event is appended to EventStoreDB.

6. API returns authoritative success + Moment ID.

7. Event publication delivers MomentCreated downstream.

8. Timeline projection updates ClickHouse.

9. Feed Aggregator can now return the Moment in the correct occurrence-time position.

10. Mobile replaces/merges local optimistic state with projected read state.
```

The architecture should support tracing this entire flow.

---

# CQRS Boundaries by Feature

## Auth

Commands:

- identity changes;
- Session creation/refresh/revoke;
- provider linking;
- two-factor changes.

Queries:

- Session list;
- provider state;
- authentication settings.

## Authorization

Commands:

- assign role;
- remove role.

Queries:

- effective permissions;
- User authorization state.

## Users

Commands:

- create/update/deactivate/delete User;
- profile mutation.

Queries:

- account/profile operational reads.

## Uploads

Commands/workflows:

- register upload;
- mark received;
- processing transitions;
- delete upload.

Queries:

- upload status;
- processing status.

## Moments

Commands:

- create Moment;
- permitted corrections/edits;
- media association changes where product semantics allow;
- deletion/removal behavior.

Queries:

- API operational Moment state where needed;
- aggregator-composed Moment depth for Timeline consumption.

## Reactions

Commands:

- add/remove/update Reaction.

Queries:

- Viewer Reaction state;
- Reaction summaries.

## Timelines

Commands:

- none. The Timeline has no lifecycle of its own; it changes when the Moments beneath it change (ADR-084).

Queries:

- feed-aggregator Timeline composition. The API owns no Timeline query handlers.

## Notifications

Commands:

- create/deliver/read/dismiss state transitions where authoritative.

Queries:

- notification list/read state.

## Moderation

Commands:

- report;
- restrict;
- restore;
- suspend;
- appeal actions where supported.

Queries:

- case/status;
- moderator review read models.

---

# Anti-Patterns

Chronologity should avoid the following CQRS anti-patterns.

## One DTO for Everything

Do not reuse one model as:

```text
aggregate
database row
REST response
GraphQL type
Kafka message
```

These contracts evolve differently.

## Read from Aggregate for Every Query

Do not rebuild an event stream merely to render routine UI.

## Write Through Read Model

Do not mutate ClickHouse projection rows directly to create product state.

## Projection as Authority

Do not treat a projection as authoritative because it is convenient.

## Command Handler as Mega-Service

Do not put unrelated domain operations into one generic command handler/service.

## Ceremony Without Benefit

Do not introduce buses, interfaces, wrappers, and factories that add indirection without protecting a real boundary.

## Timeline Reads in API by Convenience

Do not move Timeline composition into `apps/api` merely because the API already has authentication and a ClickHouse client.

## Commands in GraphQL Aggregator

Do not add mutations to the feed aggregator unless an explicit architecture decision changes its read-only responsibility.

---

# Day-One CQRS Requirements

Before launch, Chronologity must support:

- explicit command/query separation in authoritative features;
- command handlers for state changes;
- query handlers/read composition for reads;
- API-owned operational read models;
- ClickHouse Timeline read models;
- feed-aggregator read-only composition;
- authoritative commit before downstream projection;
- projection checkpoints;
- idempotent projection processing;
- eventual-consistency-aware client behavior;
- Timeline read authorization;
- command authorization;
- optimistic concurrency for relevant aggregates;
- retry-safe critical commands;
- opaque cursor pagination;
- backfilled history insertion;
- temporal zoom queries;
- historical jump queries;
- projection lag observability;
- read-model rebuild strategy;
- CQRS golden-path integration tests.

---

# Open Architectural Questions

The following should be resolved in later focused documents:

## Command Infrastructure

- Do we need a shared command bus?
- If yes, what cross-cutting behaviors justify it?
- Should idempotency/tracing/authorization be command-bus middleware or explicit handler composition?
- Recommended default: no heavyweight bus until a concrete need emerges.

## Query Infrastructure

- Do API queries need a query bus?
- Recommended default: feature-local handlers.
- Does the feed aggregator need any formal query-dispatch abstraction beyond query/composition modules?
- Recommended default: no unless it improves actual complexity.

## Read-Your-Own-Writes

- Which features require immediate confirmed local state?
- Should the API expose authoritative post-command representations?
- How does mobile reconcile local optimistic state with projections?
- What projection-lag threshold becomes a UX problem?

## PostgreSQL Query Models

- Which API features use PostgreSQL projections?
- Which operational state is authoritative relational state rather than derived projection?
- How are query models versioned?

## ClickHouse Projection Ownership

- Which worker/process writes ClickHouse?
- Does projection logic execute inside API worker entry points or a separate process?
- Does `projection-writer` remain the abstraction?
- Should API runtime processes have ClickHouse credentials at all?

## Timeline

- What exact Timeline query contracts exist?
- What are canonical cursor keys?
- How is temporal zoom represented in read models?
- What data is precomputed versus aggregated at query time?
- How are historical jumps indexed?

## Historical Significance

- Which projection owns it?
- How is it versioned?
- What inputs trigger recomputation?
- How does it participate in broad temporal scales?

## Causality

- Where is authoritative causal state stored?
- Which read model supports causal traversal?
- How are inaccessible intermediate nodes handled?

## Authorization

- Which authorization state is denormalized into ClickHouse?
- Which checks remain query-time?
- How quickly must block/privacy/role changes propagate?
- What current-state check is required for high-risk queries?

## Rebuild

- How do we rebuild projections without serving inconsistent mixed versions?
- Are dual-write/dual-read migrations needed?
- How are deleted/erased fields prevented from reappearing during replay?

---

# Architectural Invariants

1. Commands and queries have different responsibilities.
2. Commands may change authoritative state; queries may not.
3. CQRS is logical separation, not mandatory microservices.
4. `apps/api` is the primary command-side application.
5. `apps/feed-aggregator` is a read-only Timeline composition application.
6. Operational API queries may remain in the API.
7. Not every query belongs in ClickHouse.
8. Command models and query models may differ substantially.
9. Write models contain state needed for invariants, not UI convenience.
10. Read models may be denormalized for performance.
11. Denormalized read state does not become authoritative.
12. Projection logic and read-model storage are distinct concepts.
13. Event Sourcing and CQRS are related but not identical.
14. Eventual consistency between commands and projections is expected.
15. Command success does not require all projections to converge unless explicitly required.
16. Read-your-own-write behavior should generally use confirmed local state rather than synchronously waiting on every projection.
17. Projection lag is observable.
18. Command/query buses are optional and require concrete value.
19. API feature commands/queries remain feature-local.
20. Read-only applications should not contain ceremonial command infrastructure.
21. Command authorization protects mutation.
22. Query authorization protects disclosure.
23. Authorization semantics must align across command and query sides.
24. Timeline composition belongs in the feed aggregator.
25. API Timeline state must not become a duplicate high-volume Timeline read service.
26. Moment authoritative state belongs to API; Moment Timeline composition belongs to aggregator.
27. Reaction counts/summaries are derived.
28. Historical significance is derived.
29. Causal traversal is a read concern even if causal assertions are authoritative.
30. EventStoreDB is not the routine query store.
31. ClickHouse is not the universal query store.
32. PostgreSQL remains appropriate for many operational reads.
33. High-volume query composition should avoid synchronous cross-store fan-out.
34. GraphQL N+1 behavior must be prevented through batching/denormalization.
35. Timeline pagination should use opaque cursor/keyset semantics.
36. Backfilled history must insert into correct chronological positions.
37. Temporal zoom changes query representation, not authoritative state.
38. Historical jumps are query navigation, not mutations.
39. Read models must be rebuildable where practical.
40. Rebuild must honor current privacy, deletion, moderation, and authorization state.
41. Materially different read-model algorithms should be versionable.
42. Mobile/server contract stability is separate from read-model storage schemas.
43. Persisted Domain Event schemas have stronger durability requirements than query models.
44. Query failure must never mutate authoritative state.
45. Derived read-system outages must not corrupt authoritative writes.
46. Feed aggregator infrastructure should be read-only where possible.
47. A read action that changes domain state must be modeled as a command.
48. External callbacks that change state must enter through explicit command/workflow boundaries.
49. CQRS tests must include command→event→projection→query golden paths.
50. CQRS ceremony must not exceed the complexity it solves.

---

# Guiding Principle

When deciding whether behavior belongs on the command side or the query side, ask:

> **Is this code deciding what Chronologity accepts as true, or is it producing an efficient representation of truth that has already been accepted?**

If it decides truth, it belongs on the authoritative command side.

If it represents truth for consumption, it belongs on the query side.

Chronologity should use CQRS where that distinction materially improves correctness and scale—and avoid turning the pattern into architecture for architecture's sake.
