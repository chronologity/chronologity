# Chronologity Events Architecture

## Purpose

This document defines the architecture and conventions for events in Chronologity.

Chronologity uses events in multiple contexts, and those contexts must remain distinct.

The term **event** can refer to:

- a **Real-World Event** in the product domain;
- a persisted **Domain Event** produced by an authoritative aggregate;
- an **Integration Event** published across application or subsystem boundaries;
- an external provider/webhook event;
- an operational event used for observability.

These are not interchangeable.

This document focuses on software events and defines:

- event taxonomy;
- naming;
- envelopes;
- metadata;
- schema versioning;
- Domain Event rules;
- Integration Event rules;
- transformation boundaries;
- serialization;
- compatibility;
- correlation and causation;
- privacy;
- replay;
- consumer expectations;
- validation;
- testing;
- and event-governance rules.

This document is grounded in:

- `docs/architecture/overview.md`;
- `docs/architecture/principles.md`;
- `docs/architecture/api.md`;
- `docs/architecture/cqrs.md`;
- `docs/architecture/event-sourcing.md`.

---

# Terminology

## Real-World Event

A **Real-World Event** is a product/domain concept representing a historical occurrence or bounded collection of related occurrences.

Examples:

```text
Woodstock
Apollo 11 Moon Landing
A wedding
A concert
A protest
```

A Real-World Event is not a software event.

Architecture documentation should use the full term **Real-World Event** whenever ambiguity is possible.

## Domain Event

A **Domain Event** represents an accepted authoritative fact within a domain model.

Examples:

```text
MomentCreated
SessionRevoked
UserRoleAssigned
ContentRestricted
```

Domain Events are usually produced by aggregates or authoritative command handling.

Where Event Sourcing applies, Domain Events are persisted to EventStoreDB.

## Integration Event

An **Integration Event** communicates a meaningful change across an application or subsystem boundary.

Examples:

```text
TimelineMomentChanged
NotificationCandidateCreated
MediaProcessingRequested
```

An Integration Event may be derived from one or more Domain Events.

Integration Events are transport contracts.

They are not automatically authoritative domain history.

## External Event

An **External Event** originates outside Chronologity.

Examples:

- storage callback;
- transcoder completion;
- OAuth provider callback;
- email provider webhook;
- push provider delivery receipt.

External Events are untrusted until validated.

They are translated into application commands or workflow transitions when they affect authoritative state.

## Operational Event

An **Operational Event** is used for observability and operations.

Examples:

- projection lag alert;
- worker retry exhausted;
- cache miss;
- deployment health event.

Operational Events must not be confused with Domain Events.

---

# Core Principle

The central rule is:

> **Events are contracts with specific ownership and semantics. Do not use one event type to mean several different things merely because all of them are asynchronous messages.**

A persisted Domain Event is not automatically the same thing as a Kafka message.

A Kafka message is not automatically authoritative.

A Real-World Event is not a Domain Event.

---

# Event Taxonomy

Chronologity uses the following high-level taxonomy:

```text
Product Domain
    └── Real-World Event

Authoritative Domain
    └── Domain Event

Cross-Boundary Integration
    └── Integration Event

External Systems
    └── External Event

Operations
    └── Operational Event
```

Each type has different durability, ownership, privacy, and compatibility requirements.

---

# Domain Event Ownership

A Domain Event is owned by the feature/domain boundary that produces it.

Examples:

```text
features/auth
    → SessionCreated
    → SessionRevoked

features/authorization
    → UserRoleAssigned
    → UserRoleRemoved

features/moments
    → MomentCreated
    → MomentOccurrenceTimeCorrected

features/moderation
    → ContentRestricted
    → ContentRestored
```

Ownership matters because the owning feature defines:

- semantics;
- invariants;
- schema evolution;
- source of truth;
- replay behavior.

---

# Integration Event Ownership

An Integration Event is owned by the application/subsystem boundary responsible for publishing the cross-boundary contract.

It may be:

- published directly from a Domain Event;
- transformed from a Domain Event;
- composed from several authoritative facts.

Integration Events should optimize for consumer stability, not aggregate-internal convenience.

---

# Domain Event Naming

Domain Events use:

```text
PascalCase
past tense
canonical domain language
```

Examples:

```text
MomentCreated
MomentDeleted
ReactionAdded
SessionRevoked
UserRoleAssigned
ContentRestricted
```

Avoid names such as:

```text
CreateMoment
HandleReaction
MomentRowInserted
ProcessUserRole
```

Commands express intent.

Events express accepted fact.

---

# Integration Event Naming

Integration Events should also use stable domain-oriented past-tense or change-oriented naming.

Examples:

```text
TimelineMomentChanged
UserAuthorizationChanged
MediaProcessingRequested
NotificationDeliveryRequested
```

Integration Event names may intentionally differ from Domain Event names when consumer semantics differ.

---

# Avoid Generic Event Names

Do not create generic names such as:

```text
EntityUpdated
RecordChanged
DataModified
SomethingHappened
```

Generic events destroy domain meaning and force consumers to inspect payload details to understand semantics.

---

# Event Names Are Durable

Once persisted or published to independent consumers, event names are durable contracts.

Renaming:

```text
MomentCreated
```

to:

```text
HistoricalMomentCreated
```

is not a harmless refactor if persisted streams or consumers depend on the original name.

Schema/event evolution must preserve compatibility.

---

# Event Envelope

Chronologity should use a standard event envelope for serialized event contracts.

Conceptually:

```json
{
  "eventId": "...",
  "eventType": "...",
  "eventVersion": 1,
  "occurredAt": "...",
  "aggregate": {
    "type": "...",
    "id": "...",
    "version": 42
  },
  "correlationId": "...",
  "causationId": "...",
  "actor": {
    "userId": "...",
    "identityId": "...",
    "sessionId": "..."
  },
  "payload": {}
}
```

Not every event requires every optional field.

The envelope should remain minimal and well-defined.

---

# Event ID

Every persisted/published event must have a globally unique Event ID.

The Event ID supports:

- deduplication;
- tracing;
- idempotent consumers;
- auditing;
- debugging.

The Event ID identifies the event occurrence.

It is not the aggregate ID.

---

# Event Type

`eventType` identifies semantic event kind.

Examples:

```text
MomentCreated
UserRoleAssigned
SessionRevoked
```

The event type should not encode transport or storage technology.

Avoid:

```text
KafkaMomentCreated
EventStoreMomentCreated
```

---

# Event Version

`eventVersion` identifies the schema version of the event contract.

Example:

```text
MomentCreated v1
MomentCreated v2
```

This is separate from aggregate stream version.

---

# Aggregate Metadata

For aggregate-originated Domain Events, metadata should identify:

- aggregate type;
- aggregate ID;
- aggregate stream version.

This supports:

- reconstruction;
- auditing;
- debugging;
- consumer partitioning where appropriate.

Integration Events may omit aggregate metadata if it is not meaningful to consumers.

---

# Occurred At

Software event time must be named carefully.

For Domain Events:

```text
occurredAt
```

means when the domain transition was accepted/recorded by Chronologity.

It does **not** mean the historical occurrence time of a Moment.

Example:

```text
MomentCreated.occurredAt:
2026-08-11T14:00:00Z

Moment payload occurrenceTime:
1998-05-03T20:00:00Z
```

These timestamps have different meanings.

---

# Correlation ID

A Correlation ID groups events/messages belonging to the same broader operation.

Example:

```text
CreateMoment request
    ↓
MomentCreated
    ↓
TimelineMomentChanged
    ↓
NotificationCandidateCreated
```

All may share one correlation ID.

---

# Causation ID

A Causation ID identifies the direct cause of an event/message.

Example:

```text
Command ID
    ↓ causes
MomentCreated event
    ↓ causes
TimelineMomentChanged
```

Correlation and causation must not be treated as synonyms.

---

# Actor Metadata

Where appropriate, an event may reference the actor responsible for the action.

Potential fields:

- User ID;
- Identity ID;
- Session ID;
- service identity.

Actor metadata should be minimal.

Do not embed:

- email;
- display name;
- device fingerprint;
- IP address

unless a concrete durable audit requirement justifies it.

---

# Actor Versus Historical Person

Software event actor metadata is not the same thing as the product-domain **Person** concept.

An actor means:

> the authenticated/user/system identity that caused the software action.

A Person means:

> a human represented in history.

Keep those concepts separate.

---

# Payload

The `payload` contains event-specific data.

It should contain only what is necessary to represent the accepted fact or integration contract.

Avoid full aggregate snapshots.

---

# Domain Event Payload Example

Conceptually:

```json
{
  "eventType": "MomentCreated",
  "eventVersion": 1,
  "payload": {
    "momentId": "...",
    "creatorUserId": "...",
    "occurrenceTime": "...",
    "visibility": "...",
    "mediaIds": ["..."]
  }
}
```

The exact schema belongs in event-contract documentation.

---

# Integration Event Payload Example

A Timeline-oriented Integration Event might instead be:

```json
{
  "eventType": "TimelineMomentChanged",
  "eventVersion": 1,
  "payload": {
    "momentId": "...",
    "changeType": "created"
  }
}
```

The consumer can obtain or project only the data required for its read model.

This decouples Timeline consumers from internal Moment aggregate schema.

---

# Domain Events Are Authoritative Facts

Where Event Sourcing applies, persisted Domain Events are authoritative aggregate history.

They must therefore be:

- valid;
- durable;
- versioned;
- replayable;
- privacy-safe.

A Domain Event should never be emitted merely to make an external integration easier if it does not represent a domain fact.

---

# Integration Events Are Boundary Contracts

Integration Events exist to serve consumers.

They may:

- combine data;
- rename fields;
- omit aggregate internals;
- flatten structures;
- carry consumer-relevant routing information.

They must not silently change domain truth.

---

# Publishing Domain Events Directly

Publishing a Domain Event directly to Kafka is acceptable when:

- consumers genuinely need that semantic contract;
- the payload is privacy-safe;
- compatibility expectations are appropriate;
- aggregate internals are not leaked unnecessarily.

Do not transform events merely for ceremony.

---

# Transforming Domain Events

Transformation is appropriate when:

- consumers need a more stable contract;
- several internal events map to one external event;
- privacy requires removing data;
- consumer routing needs differ;
- internal event schemas evolve more rapidly.

Example:

```text
IdentityEmailVerified
        ↓
integration transformation
        ↓
UserAuthenticationStatusChanged
```

---

# Domain Event Schema Location

Canonical persisted Domain Event schemas should have one clear owner.

Possible locations:

```text
apps/api/src/features/<feature>/events/
```

for internal persistence contracts, and/or:

```text
packages/contracts
```

when the same serialized event contract crosses application boundaries.

Do not maintain two independent schemas for the same event.

---

# Integration Event Schema Location

Cross-application Integration Event schemas should generally live in:

```text
packages/contracts
```

because producer and consumer require the same serialized contract.

The shared package owns the contract, not the implementation.

---

# Event Serialization

JSON is an appropriate initial serialization format.

Serialized fields should use canonical representations:

```text
UUID/string IDs
ISO-8601 timestamps
stable string enums
explicit nullable/optional semantics
```

Avoid language-specific serialization assumptions.

---

# Runtime Validation

Serialized events must be validated at trust boundaries.

Validation should occur:

- before append where applicable;
- when reading persisted events into current code;
- when consuming Kafka events;
- when accepting external events.

TypeScript compile-time types are insufficient.

---

# Invalid Persisted Events

An invalid persisted Domain Event represents a severe integrity problem.

Aggregate reconstruction should fail loudly.

Do not silently drop or coerce an authoritative event.

---

# Invalid Integration Events

An invalid Integration Event should be:

- rejected;
- quarantined or dead-lettered;
- surfaced operationally.

Consumers must not silently accept malformed data.

---

# Unknown Event Type

For authoritative reconstruction:

```text
unknown Domain Event
        ↓
fail
```

Skipping unknown authoritative history is unsafe.

For integration consumers:

```text
unknown Integration Event
        ↓
ignore only if subscription contract explicitly allows unrelated types
```

A consumer that claims to support the type but cannot decode its version must fail visibly.

---

# Event Versioning

Each event contract evolves independently.

Do not create one global application event version such as:

```text
all events v12
```

Instead:

```text
MomentCreated v2
SessionRevoked v1
UserRoleAssigned v1
```

---

# Additive Changes

Backward-compatible additive changes are preferred.

Examples:

- new optional field;
- new enum case only when old consumers safely ignore/handle unknown values;
- new metadata field.

Even additive changes must be evaluated against consumer behavior.

---

# Breaking Changes

Breaking changes require:

- new event version;
- compatible reader/upcaster;
- consumer migration plan;
- explicit rollout order.

Examples:

- field semantic changes;
- required field added;
- field removed;
- type changed;
- identifier meaning changed.

---

# Event Upcasters

Persisted Domain Event readers may use upcasters to translate old schemas into current internal representation.

Upcasters must:

- be deterministic;
- preserve historical semantics;
- avoid external calls;
- avoid new inferred facts.

---

# Integration Compatibility

Integration consumers may run different deployment versions.

Producers must tolerate consumer version skew.

Prefer:

```text
producer adds compatible event version
    ↓
old + new consumers overlap
    ↓
migrate
    ↓
retire old version
```

Do not require atomic deployment of every consumer.

---

# Consumer Versioning

A consumer should explicitly declare which event types/versions it supports.

Unsupported versions should not be guessed.

---

# Event Registry

Chronologity should maintain a canonical event registry.

The registry should map:

```text
event type
event version
schema
owner
classification
```

Possible classifications:

```text
domain
integration
external
operational
```

The registry can be code-driven rather than a separate runtime service.

---

# Event Registry Benefits

A registry helps prevent:

- duplicate event names;
- accidental version collisions;
- missing runtime validation;
- unclear ownership;
- undocumented event proliferation.

---

# Real-World Event Naming Collision

Because Chronologity has a product concept named Event, code should avoid ambiguous identifiers.

Prefer:

```text
DomainEvent
IntegrationEvent
RealWorldEvent
```

over:

```text
Event
```

when type context is unclear.

---

# Event Envelope Types

Possible canonical shared types:

```text
DomainEventEnvelope<TPayload>
IntegrationEventEnvelope<TPayload>
```

Do not force External Events into the same envelope before validation/translation.

External provider formats should remain provider-specific at the boundary.

---

# Command-to-Event Relationship

Commands represent intent.

Events represent outcome.

Example:

```text
CreateMoment
    ↓
MomentCreated
```

A command may produce multiple events.

Example:

```text
DeactivateUser
    ↓
UserDeactivated
SessionsRevocationRequested
```

depending on aggregate/workflow boundaries.

---

# Event-to-Command Relationship

An event may trigger another command asynchronously.

Example:

```text
UploadProcessingCompleted
    ↓
FinalizeMomentMedia command
```

This should be explicit.

Do not let event handlers mutate aggregate state directly without going through the appropriate domain command/aggregate boundary where invariants matter.

---

# Event Handlers

Event handlers respond to Domain or Integration Events.

They may:

- update projections;
- trigger workflows;
- issue commands;
- request external side effects.

They must be idempotent.

---

# Event Handler Idempotency

Handler idempotency may use:

- processed Event IDs;
- transactional checkpointing;
- idempotent upsert semantics;
- unique constraints.

The mechanism depends on the side effect.

---

# Event Ordering

Chronologity guarantees ordering only where explicitly defined.

For event-sourced aggregates:

```text
stream order
```

is authoritative.

For Kafka:

```text
partition order
```

may be available.

Do not assume global ordering across all events.

---

# Partition Keys

Integration Events should use a partition key aligned with required ordering/locality.

Potential keys:

```text
aggregateId
momentId
userId
timelineScopeId
```

Choose the smallest stable boundary requiring ordered processing.

Do not key everything globally.

---

# Event Duplication

Consumers must assume an event/message may be delivered more than once.

```text
at-least-once delivery
        +
idempotent consumer
```

is the architectural expectation.

---

# Event Loss

Committed authoritative events required downstream must not be permanently lost.

Reliable publication and checkpointing are defined in `docs/architecture/messaging.md`.

---

# Event Replay

Domain Events may be replayed for:

- aggregate reconstruction;
- projection rebuild;
- debugging;
- migrations.

Integration Events may also be replayed where transport retention permits, but they are not the primary authoritative recovery source unless explicitly designed that way.

---

# Replay Safety

Replay must not accidentally repeat external side effects.

Projection handlers may replay.

Email/push delivery handlers must distinguish:

```text
historical replay
```

from:

```text
new live event
```

unless duplicate delivery is intentionally idempotent.

---

# Replay Classification

Consumers should be categorized:

```text
replay-safe projection
live side-effect consumer
hybrid consumer
```

This distinction should be explicit.

---

# Projection Events

Chronologity should avoid inventing authoritative "projection events."

Projection state is derived.

If a projection emits an Integration Event, that event must clearly represent a derived-state change, not new domain truth.

---

# Derived Algorithm Events

Algorithms such as historical significance may produce derived outputs.

If downstream consumers need change notifications, publish events such as:

```text
HistoricalSignificanceProjectionUpdated
```

with clear derived classification.

Do not use:

```text
MomentBecameHistoricallySignificant
```

as if the algorithm created objective historical truth unless product semantics explicitly define that fact.

---

# AI-Generated Event Semantics

AI may produce suggestions or derived metadata.

AI output should not emit authoritative events such as:

```text
CausalRelationshipConfirmed
```

without an explicit authoritative acceptance process.

It may emit:

```text
CausalRelationshipSuggested
```

if suggestion lifecycle is part of the domain.

Provenance must remain explicit.

---

# External Events

External events are untrusted inputs.

Before they affect authoritative state:

```text
provider payload
    ↓
signature/auth validation
    ↓
schema validation
    ↓
deduplication
    ↓
translate to application command/workflow
```

Do not append provider payloads directly as Domain Events.

---

# Webhook Event IDs

Where providers supply stable event IDs, Chronologity should use them for webhook deduplication.

Provider event IDs remain external identifiers.

They do not replace Chronologity Domain Event IDs.

---

# External Event Retention

Raw provider payload retention should be minimized.

If retained for debugging/compliance, define:

- retention duration;
- redaction;
- encryption;
- access controls.

Do not copy provider payloads into logs by default.

---

# Media Events

Media workflows may use Integration Events such as:

```text
MediaProcessingRequested
MediaProcessingCompleted
MediaProcessingFailed
```

The authoritative Upload/Moment feature decides which provider callback results become Domain Events.

Technical intermediate steps need not all become Domain Events.

---

# Notification Events

Notification creation may consume Domain Events such as:

```text
ReactionAdded
CommentAdded
```

and produce:

```text
NotificationCreated
```

or relational notification state.

Delivery may use Integration Events:

```text
PushDeliveryRequested
EmailDeliveryRequested
```

Provider delivery receipts remain External Events.

---

# Authorization Events

The canonical `features/authorization/` module may emit:

```text
UserRoleAssigned
UserRoleRemoved
```

Integration consumers may receive:

```text
UserAuthorizationChanged
```

if a more stable cross-service contract is useful.

---

# Authentication Events

Authentication Domain Events may include:

```text
IdentityCreated
IdentityEmailVerified
OAuthProviderLinked
SessionCreated
SessionRevoked
```

They must never contain:

- access token;
- refresh token;
- provider token;
- recovery code.

---

# Moment Events

Moment Domain Events may include:

```text
MomentCreated
MomentOccurrenceTimeCorrected
MomentVisibilityChanged
MomentDeleted
MomentMediaAdded
MomentMediaRemoved
MomentMediaReordered
```

The finalized product model must not contain:

```text
MomentSplit
MomentMerged
MomentReparented
```

or equivalent Sub-Moment hierarchy semantics.

---

# Timeline Events

Timeline events require semantic discipline.

There are no authoritative Timeline Domain Events. The Timeline is derived, so a Timeline change is always a consequence of some other event — a Moment created, its occurrence corrected, its visibility changed, or the account behind it deactivated (ADR-084).

High-volume Timeline read-model changes are Integration/derived events.

---

# Moderation Events

Moderation Domain Events may include:

```text
ReportSubmitted
ModerationCaseOpened
ContentRestricted
ContentRestored
UserSuspended
AppealSubmitted
AppealResolved
```

Events should reference sensitive evidence rather than embed it.

---

# User Events

Potential User Domain Events:

```text
UserCreated
UserProfileUpdated
UsernameChanged
UserDeactivated
UserReactivated
UserDeleted
```

PII minimization rules apply.

---

# Reaction Events

Potential events:

```text
ReactionAdded
ReactionRemoved
ReactionUpdated
```

If Reaction is not event sourced, these may still be published as Domain/Integration Events from relational authoritative state.

Event Sourcing is not required to have events.

---

# Event Sourcing Is Not Required for Event Publication

A PostgreSQL transaction may produce an Integration Event through an outbox or equivalent reliable publication mechanism.

Therefore:

```text
event-driven
        ≠
event-sourced
```

Chronologity should preserve this distinction.

---

# Transactional Outbox

For relational authoritative features, an outbox pattern may be appropriate:

```text
PostgreSQL transaction
    ├── authoritative row update
    └── outbox record
          ↓
publisher
          ↓
Kafka
```

For EventStoreDB-backed features, EventStoreDB subscriptions may provide the reliable publication source.

The messaging architecture should support both patterns if both authoritative models exist.

---

# Domain Event Persistence Envelope

Persisted EventStoreDB records should use a canonical representation.

At minimum:

```text
event ID
event type
event version
payload
metadata
```

Aggregate identity may be derived from the stream but may also appear in metadata for portability.

---

# Kafka Message Envelope

Kafka Integration Events should use a canonical transport envelope.

Potential fields:

```text
messageId
eventType
eventVersion
publishedAt
correlationId
causationId
partitionKey
producer
payload
```

Do not expose Kafka offset/partition as business semantics.

---

# Message ID Versus Event ID

If a Domain Event is published directly:

```text
messageId may equal eventId
```

If transformed:

```text
Domain Event eventId
        ↓
Integration Event messageId
```

should be distinct, with causation metadata linking them.

---

# Published At

Integration Events may include:

```text
publishedAt
```

which identifies transport publication time.

This is distinct from:

- Domain Event occurredAt;
- Moment occurrence time.

Avoid timestamp ambiguity.

---

# Producer

Integration Event metadata may identify:

```text
producer = apps/api
```

or a logical subsystem.

Producer identity is operational routing/debugging metadata.

Do not use it as domain authority.

---

# Schema Validation Library

Chronologity should use one runtime schema approach consistently for shared event contracts.

The exact library can align with the repository's contract validation strategy.

The important requirement is:

```text
one canonical runtime schema
        ↓
TypeScript types derived/inferred
```

rather than maintaining separate unchecked types and validators.

---

# Event Schema Tests

Every persisted or integration event schema should have tests covering:

- valid payload;
- missing required fields;
- invalid enum;
- invalid ID;
- invalid timestamp;
- backward-compatible old version;
- prohibited sensitive fields where applicable.

---

# Compatibility Tests

Important consumers should have contract tests against supported producer event versions.

These tests should catch incompatible changes before deployment.

---

# Consumer-Driven Contracts

Chronologity may use consumer-driven contract tests where multiple independently deployed consumers depend on Integration Events.

This is especially valuable for:

- feed projection consumers;
- notification consumers;
- Search indexers;
- media workers.

A heavyweight external contract platform is optional.

---

# Event Documentation

Each event should eventually document:

- name;
- classification;
- owner;
- version;
- producer;
- consumers;
- payload;
- metadata;
- privacy classification;
- idempotency expectations;
- ordering/partition key;
- replay safety.

This may live in generated documentation derived from schemas.

Avoid manually duplicating event definitions in many places.

---

# Event Governance

Creating a new persisted or integration event should require answering:

1. What fact/change does it represent?
2. Is it Domain or Integration?
3. Who owns it?
4. Is it durable?
5. Does a consumer actually need it?
6. What is its privacy classification?
7. What ordering is required?
8. Is it replay-safe?
9. How will it evolve?
10. Could an existing event already represent the fact?

This prevents event proliferation.

---

# Avoid Event Explosion

Do not emit one event for every field mutation unless each mutation is a meaningful domain fact.

Prefer meaningful events such as:

```text
UserProfileUpdated
```

when several fields form one coherent domain change.

Prefer more specific events when semantics differ materially:

```text
UsernameChanged
```

may deserve its own event if uniqueness/audit behavior differs.

---

# Avoid Event Blobs

The opposite anti-pattern is one giant event:

```text
UserChanged {
    everything
}
```

for every behavior.

Events should balance semantic clarity with reasonable granularity.

---

# Events and Privacy Classification

Events should be classified by sensitivity.

Possible internal classes:

```text
public-domain-safe
internal
sensitive
restricted
```

This classification can inform:

- logging;
- transport;
- retention;
- access controls;
- whether publication to broad Kafka topics is appropriate.

---

# Events and Encryption

Kafka/EventStoreDB transport and storage should be encrypted according to infrastructure/security policy.

Field-level encryption may be used for selected sensitive data, but the preferred strategy is often not to include unnecessary sensitive values at all.

---

# Event Topic Design

Exact Kafka topic architecture belongs in `docs/architecture/messaging.md`.

Events should not encode topic names into their semantic type.

One event may move between topics as infrastructure evolves without changing domain meaning.

---

# Dead-Letter / Quarantine

Invalid or poison Integration Events should be quarantined with enough metadata to diagnose:

- message ID;
- event type/version;
- consumer;
- error;
- original partition/offset.

Sensitive payload handling rules still apply.

Dead-letter storage must not become an unbounded shadow event store.

---

# Event Retry

Retry policy depends on failure type.

```text
transient infrastructure failure
    → retry

schema validation failure
    → quarantine

authorization/domain rejection
    → generally do not retry blindly

consumer code bug
    → stop/quarantine/alert
```

---

# Event Tracing

Tracing should propagate:

```text
correlationId
causationId
trace context
```

across:

```text
HTTP
  ↓
command
  ↓
Domain Event
  ↓
Integration Event
  ↓
consumer
  ↓
projection
```

This makes eventual-consistency debugging practical.

---

# Event Logging

Logs should identify event metadata without logging full payloads by default.

Good:

```text
eventType=MomentCreated
eventId=...
aggregateId=...
eventVersion=1
```

Avoid:

```text
fullEventPayload={...private data...}
```

---

# Event Metrics

Useful metrics include:

- events appended by type;
- integration events published;
- publish failures;
- consumer lag;
- handler failures;
- retries;
- quarantined events;
- unsupported event versions;
- processing latency.

Avoid high-cardinality labels such as aggregate IDs in metrics.

---

# Event Testing Strategy

## Domain Event tests

Verify:

- aggregate emits expected event;
- event payload schema;
- old version compatibility;
- no prohibited secrets/PII.

## Integration Event tests

Verify:

- transformation from Domain Event;
- contract schema;
- routing/partition key;
- consumer compatibility.

## Consumer tests

Verify:

- idempotency;
- duplicate delivery;
- unsupported version;
- retry behavior;
- replay behavior.

## End-to-end event flow tests

Verify:

```text
command
  ↓
Domain Event
  ↓
Integration Event
  ↓
consumer
  ↓
read model
```

for critical flows.

---

# Day-One Event Requirements

Before launch, Chronologity must define:

- Domain Event envelope;
- Integration Event envelope;
- canonical event IDs;
- event naming conventions;
- event schema versioning;
- runtime validation;
- event registry;
- correlation/causation metadata;
- actor metadata rules;
- PII/secret exclusion rules;
- Domain versus Integration Event classification;
- canonical schema ownership;
- Kafka message envelope;
- event transformation rules;
- consumer idempotency;
- event partitioning principles;
- unsupported-version behavior;
- quarantine/dead-letter behavior;
- replay classification;
- event logging rules;
- event metrics;
- event contract tests.

---

# Open Architectural Questions

## Envelope

- Should Domain and Integration Events share one base envelope?
- Which fields are mandatory for both?
- Is `actor` part of the envelope or metadata?
- Should trace context be persisted with Domain Events or only Integration Events?

## Schema Library

- Which runtime schema library is canonical for event contracts?
- Are TypeScript types inferred from runtime schemas?
- How are schemas published/versioned inside `packages/contracts`?

## Event Type Naming

- Do persisted event type strings include version?
- Example:
  - `MomentCreated` + `eventVersion: 1`
  - versus `MomentCreated.v1`
- Recommended default: separate event type and version fields.

## Integration Events

- Which Domain Events can be published directly?
- Which require transformed Integration Events?
- Do Timeline projections consume internal Domain Events directly or a Timeline-specific Integration contract?
- How much domain detail should Kafka consumers receive?

## Actor Metadata

- Which events require actor metadata?
- Is Session ID always useful?
- How do system/service-generated events identify actor?
- How long is actor metadata retained?

## Event Registry

- Is the registry compile-time code only?
- Should documentation be generated automatically from schemas?
- How do we prevent duplicate type/version registration?

## Topics

- How are Integration Events grouped into Kafka topics?
- Feature topics?
- Aggregate topics?
- Consumer-purpose topics?
- How are ordering and throughput balanced?

## External Events

- Which provider payloads are persisted temporarily for forensic/debugging purposes?
- For how long?
- How are provider IDs deduplicated?

## Replay

- How do live side-effect consumers distinguish replay?
- Is replay routed through separate topics?
- Are projection rebuilds fed from EventStoreDB directly rather than Kafka?
- Recommended default: projection rebuilds should favor authoritative EventStoreDB rather than replaying live side-effect topics.

## Privacy

- Which event classes can contain User IDs?
- Which can contain exact Location references?
- Which values must always be externalized?
- How is event-data classification enforced in tests?

---

# Architectural Invariants

1. Real-World Events, Domain Events, Integration Events, External Events, and Operational Events are distinct concepts.
2. Architecture documentation uses explicit event terminology when ambiguity is possible.
3. Domain Events represent accepted authoritative facts.
4. Integration Events represent cross-boundary communication contracts.
5. External Events are untrusted until validated.
6. Operational Events do not become domain truth.
7. Domain Event ownership belongs to the producing feature.
8. Integration Event ownership belongs to the publishing boundary.
9. Domain Event names are stable, past-tense, and domain-oriented.
10. Generic event names are prohibited.
11. Persisted/published event names are durable contracts.
12. Events use globally unique IDs.
13. Event schema version is distinct from aggregate stream version.
14. Software event time is distinct from Moment occurrence time.
15. Correlation and causation identifiers are distinct.
16. Actor metadata is minimal and privacy-aware.
17. Actor metadata is not the historical Person model.
18. Event payloads are minimal and purpose-specific.
19. Domain Events must not be created solely for integration convenience when no domain fact exists.
20. Integration Events may transform Domain Events.
21. Direct Domain Event publication is acceptable only when the contract is appropriate for consumers.
22. Shared serialized event contracts have one canonical schema.
23. Runtime validation is required.
24. Invalid authoritative events fail loudly.
25. Invalid integration messages are quarantined/rejected.
26. Unknown authoritative event types are never silently skipped.
27. Event contracts evolve independently.
28. Backward-compatible additive evolution is preferred.
29. Breaking changes require a new version/migration strategy.
30. Upcasters preserve semantics and do not invent facts.
31. Producer/consumer version skew is expected.
32. Event classification/ownership should be registered canonically.
33. Commands express intent; events express accepted outcome.
34. Event-triggered aggregate mutations re-enter through command/domain boundaries where invariants matter.
35. Event handlers are idempotent.
36. Global event ordering is not assumed.
37. Partition keys follow the smallest meaningful ordering boundary.
38. Duplicate delivery is expected.
39. Committed required events must not be permanently lost.
40. Replay must not accidentally repeat unsafe external side effects.
41. Consumers have explicit replay-safety classification.
42. Derived algorithm outputs remain clearly derived.
43. AI suggestions do not silently become authoritative facts.
44. Provider events are translated after authentication/validation.
45. Media technical callbacks do not automatically become Domain Events.
46. Notification delivery requests are Integration Events or equivalent side-effect messages, not authoritative notification truth.
47. Authorization role changes are authoritative Domain Events when event sourced.
48. Authentication events never contain raw credentials.
49. Moment events must not reintroduce Sub-Moment hierarchy semantics.
50. Timeline read-model updates are not authoritative Timeline Domain Events.
51. Moderation events reference sensitive evidence rather than embedding it.
52. Event-driven architecture does not imply Event Sourcing.
53. Relational authoritative state may use an outbox for reliable events.
54. EventStoreDB-backed authority may use durable subscriptions for publication.
55. Kafka transport metadata never becomes business semantics.
56. Event schemas receive contract and privacy tests.
57. Event creation requires explicit ownership and consumer need.
58. Event granularity must avoid both event explosion and meaningless blobs.
59. Event logs avoid full payloads by default.
60. Architecture documentation changes when event contracts or classifications intentionally change.

---

# Guiding Principle

When creating or consuming an event, ask:

> **What exact fact or cross-boundary change does this message represent, who owns that meaning, how durable is the contract, and what must remain true if the event is replayed years later?**

If those questions cannot be answered clearly, the event boundary is not ready to become canonical.
