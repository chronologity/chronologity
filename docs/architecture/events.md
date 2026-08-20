# Chronologity Events Architecture

## Purpose

This document defines the architecture and conventions for events in Chronologity.

Chronologity uses events in multiple contexts, and those contexts must remain distinct.

The term **event** can refer to:

- a **Real-World Event** in the product domain;
- a **Domain Event**, meaning a past-tense fact the API has accepted;
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
- `docs/architecture/api.md`.

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

A **Domain Event** is a past-tense fact accepted inside the API: a Session was
revoked, a role was assigned, content was restricted.

It is a way of describing what happened, not a stored artifact. Chronologity does
not persist a separate log of domain events, and there is no event type to
implement (ADR-092). Where a past-tense fact must survive for accountability, it
is an audit row written in the same transaction as the change it describes.

The word remains useful when reasoning about what changed and what downstream
systems might care about. It does not name a file, a table, or a schema.

## Integration Event

An **Integration Event** communicates a meaningful change across an application or subsystem boundary.

Examples:

```text
TimelineMomentChanged
NotificationCandidateCreated
MediaProcessingRequested
```

An Integration Event is constructed explicitly by the service that publishes it,
enqueued to the transactional outbox in the same transaction as the change it
describes, and delivered to Kafka by the outbox publisher (ADR-093, ADR-096).

Nothing is published automatically. A service decides what crosses the boundary
and builds that payload deliberately, which is what keeps the external contract
from drifting with every internal change.

Integration Events are transport contracts. They are not authoritative history.

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
- outbox publication falling behind;
- worker retry exhausted;
- cache miss;
- deployment health event.

Operational Events must not be confused with Integration Events.

---

# Core Principle

The central rule is:

> **Events are contracts with specific ownership and semantics. Do not use one event type to mean several different things merely because all of them are asynchronous messages.**

A Kafka message is not authoritative. The authoritative record is the row the
API committed, and the message is a notification that it happened.

A Real-World Event is not a software event of any kind.

---

# Event Taxonomy

Chronologity uses the following high-level taxonomy:

```text
Product Domain
    └── Real-World Event          a historical occurrence

Authoritative Domain
    └── Domain Event              a past-tense fact; a row, or an audit row

Cross-Boundary Integration
    └── Integration Event         published, versioned, via the outbox

External Systems
    └── External Event            untrusted until validated

Operations
    └── Operational Event         observability, never domain truth
```

Each type has different durability, ownership, privacy, and compatibility requirements.

---

# Domain Event Ownership

A Domain Event is owned by the feature that produces it. Ownership is about who
defines the meaning of the change, not about who stores a record of it.

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
- what is safe to expose beyond the boundary.

---

# Integration Event Ownership

An Integration Event is owned by the application/subsystem boundary responsible for publishing the cross-boundary contract.

The publishing service constructs it explicitly. It is not a serialized copy of
an internal state change, and it should carry what a consumer needs rather than
everything the producer happens to know.

Integration Events optimize for consumer stability, not for the producer's
convenience. A field is added because a consumer needs it, and removed only by
publishing a new version.

---

# Event Naming

Event names use:

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

A request expresses intent. An event expresses accepted fact.

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

An Integration Event's name may intentionally differ from how the change is described internally, when consumer semantics differ.

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
  "subject": {
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

It identifies the message, not the thing the message is about.

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
OutboxMomentCreated
```

---

# Event Version

`eventVersion` identifies the schema version of the event contract.

Example:

```text
MomentCreated v1
MomentCreated v2
```

This is separate from any internal versioning.

---

# Subject Metadata

An Integration Event identifies what it is about:

- the kind of thing that changed;
- its identifier;
- the version of that thing, where the consumer needs ordering.

This supports auditing, debugging, and consumer partitioning: messages about one
subject should reach one partition so that a consumer sees them in order.

The subject is not the message's own identity. A message has its own identifier
for deduplication; the subject says what the message concerns.

---

# Occurred At

Software event time must be named carefully.

```text
occurredAt
```

means when Chronologity accepted the change.

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
POST /moments
    ↓
authoritative write, with its outbox message
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

Avoid publishing a whole record where a consumer needs a fact.

---

# Integration Event Payload Example

A Timeline-oriented Integration Event:

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

The consumer obtains or projects only the data its read model requires. This
decouples Timeline consumers from the API's internal schema, and it keeps
erasable data out of a topic nothing can edit.

The upload pipeline's only published event follows the same shape: it carries
the upload's identifier, its owner, where the bytes are, and what the uploader
claimed — enough for a checker to open the file, and nothing more.

---

# Integration Events Are Boundary Contracts

Integration Events exist to serve consumers.

They may:

- combine data;
- rename fields;
- omit internals;
- flatten structures;
- carry consumer-relevant routing information.

They must not silently change domain truth. A consumer that disagrees with the
API about what happened is a bug in the consumer or in the contract, never a
second opinion.

---

# What Is Published, and What Is Not

Publishing is deliberate. A service publishes an Integration Event because
something outside this application needs to act on the change — not because the
change occurred.

Publish when:

- a consumer genuinely needs that semantic contract;
- the payload is privacy-safe and carries nothing that must later be erased;
- the compatibility expectation is understood and versioned.

Do not publish:

- an internal state change nothing consumes;
- a field a consumer might want someday;
- anything whose only justification is symmetry with another event.

Most of what happens in the API is published nowhere. Authentication, for
instance, publishes nothing at all: its accountability requirement is met by the
relational audit trail, which is both queryable and erasable.

---

# Constructing the Payload

The publishing service builds the external payload explicitly (ADR-096).

```text
service decides the change is worth announcing
    ↓
service constructs the payload, field by field
    ↓
enqueueOutboxMessage(tx, ...)   same transaction as the change
    ↓
commit
```

There is no automatic mapping from internal state to published message. A
mapping layer would mean every internal change silently reshaped an external
contract, and the first time a column was renamed the consumers would find out.

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

- when consuming Kafka events;
- when accepting external events.

An Integration Event arrives from another process and may have been published by
an older or newer deployment. Treat it as untrusted input, exactly like an HTTP
body.

TypeScript compile-time types are insufficient.

---

# Invalid Integration Events

An invalid Integration Event should be:

- rejected;
- quarantined or dead-lettered;
- surfaced operationally.

Consumers must not silently accept malformed data.

---

# Unknown Event Type

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

A consumer reading an older Integration Event version may translate it into the shape current code expects.

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

depending on where the responsibility for each change sits.

---

# Event-to-Command Relationship

An event may trigger another command asynchronously.

Example:

```text
UploadReceived
    ↓
the media worker opens the file and settles what it is
```

This should be explicit.

A consumer acting on an event calls the owning service, exactly as a route
would. It does not reach into another feature's repository, because the
invariants live in the service and a consumer that bypasses them is writing
state nothing validated.

---

# Event Handlers

Event handlers respond to Integration Events.

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
uploadId
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

Reliable publication is the transactional outbox, defined in `docs/architecture/messaging.md`.

---

# Event Replay

Integration Events may be replayed where transport retention permits, for:

- projection rebuild;
- debugging;
- migrations.

They are not an authoritative recovery source. What recovers the system is
PostgreSQL; what replay recovers is a derived read model.

A rebuild reads current authoritative state rather than reconstructing it from a
message log, which is what makes ADR-095 enforceable: erased data cannot
reappear from a topic, because the rebuild never consults one for truth.

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

They do not replace Chronologity's own message identifiers.

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

The Upload feature decides which results change authoritative state. Technical intermediate steps need not each become a published event: most are a column on the Upload's row.

---

# Notification Events

Notification creation may consume Integration Events such as:

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

Authentication changes worth naming include:

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

Moment changes worth naming include:

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

There are no authoritative Timeline events of their own. The Timeline is derived, so a Timeline change is always a consequence of some other event — a Moment created, its occurrence corrected, its visibility changed, or the account behind it deactivated (ADR-084).

High-volume Timeline read-model changes are Integration/derived events.

---

# Moderation Events

Moderation changes worth naming include:

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

Potential User changes:

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

These are published as Integration Events from authoritative relational state,
if and only if something outside the API needs them.

---

# Event-Driven Is Not Event-Sourced

Publishing events does not require storing them as the source of truth.

```text
event-driven
        ≠
event-sourced
```

Chronologity is the first and not the second (ADR-092). A PostgreSQL transaction
produces an Integration Event through the outbox, and the row it wrote remains
the authority.

---

# Transactional Outbox

Every Integration Event is published this way (ADR-093):

```text
PostgreSQL transaction
    ├── authoritative row change
    └── outbox record
          ↓
publisher            claims a batch with FOR UPDATE SKIP LOCKED
          ↓
Kafka
          ↓
mark published       in the transaction that claimed it
```

There is one mechanism, not several. A single publication path is what makes
"a committed change is never lost downstream" a property rather than an
aspiration, and it is why several publisher instances can run without
coordinating.

A message that fails to publish has its failure recorded and is retried. The
claiming transaction has already rolled back by then, so the failure is recorded
in a separate one — otherwise the record of the failure would roll back with it.

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

# Message ID Versus Subject

A message's identifier is its own. It exists so a consumer can recognise a
message it has already handled.

It is not the identifier of the thing the message is about. That is the subject,
and several messages may share one subject over time:

```text
messageId     identifies this delivery
subject.id    identifies the upload, Moment, or account it concerns
```

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
authoritative write + outbox record
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
messageId=...
subjectId=...
eventVersion=1
```

Avoid:

```text
fullEventPayload={...private data...}
```

---

# Event Metrics

Useful metrics include:

- outbox depth, by topic;
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

## Integration Event tests

Verify:

- the payload a service actually enqueues, read back from the outbox rather
  than from the function that built it;
- contract schema;
- routing and partition key;
- consumer compatibility;
- that nothing prohibited — a secret, a credential, erasable personal data —
  reached the outbox. This is best asserted directly against the table, because
  it is a claim about what was written rather than about what was intended.

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
request
  ↓
authoritative write + outbox record, one transaction
  ↓
outbox publisher
  ↓
Integration Event on Kafka
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

- Do published event type strings include version?
- Example:
  - `MomentCreated` + `eventVersion: 1`
  - versus `MomentCreated.v1`
- Recommended default: separate event type and version fields.

## Integration Events

- Which changes are worth publishing at all?
- What Timeline-specific contract do projections consume?
- How much domain detail should Kafka consumers receive, given that anything
  published becomes difficult to erase?

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
- Are projection rebuilds fed from authoritative PostgreSQL state rather than
  replaying live side-effect topics?
- Recommended default: yes. Reading current state is what keeps a rebuild from
  resurrecting something since erased.

## Privacy

- Which event classes can contain User IDs?
- Which can contain exact Location references?
- Which values must always be externalized?
- How is event-data classification enforced in tests?

---

# Architectural Invariants

1. Real-World Events, Domain Events, Integration Events, External Events, and Operational Events are distinct concepts.
2. Architecture documentation uses explicit event terminology when ambiguity is possible.
3. A Domain Event is a past-tense fact the API accepted, recorded as a row rather than as an entry in an event log.
4. Integration Events represent cross-boundary communication contracts.
5. External Events are untrusted until validated.
6. Operational Events do not become domain truth.
7. Ownership of a change's meaning belongs to the feature that produces it.
8. Integration Event ownership belongs to the publishing boundary.
9. Event names are stable, past-tense, and domain-oriented.
10. Generic event names are prohibited.
11. Persisted/published event names are durable contracts.
12. Events use globally unique IDs.
13. An event's schema version is distinct from the version of the subject it describes.
14. Software event time is distinct from Moment occurrence time.
15. Correlation and causation identifiers are distinct.
16. Actor metadata is minimal and privacy-aware.
17. Actor metadata is not the historical Person model.
18. Event payloads are minimal and purpose-specific.
19. An Integration Event is published because a consumer needs it, never because a change occurred.
20. The publishing service constructs the external payload explicitly; nothing is published as a side effect of persistence.
21. Every Integration Event reaches Kafka through the transactional outbox, enqueued in the same transaction as the change it describes.
22. Shared serialized event contracts have one canonical schema.
23. Runtime validation is required.
24. Invalid integration messages are quarantined or rejected, never silently accepted.
25. A consumer that claims a type but cannot decode its version fails visibly.
26. Erasable personal data must never be written to the outbox or to Kafka.
27. Event contracts evolve independently.
28. Backward-compatible additive evolution is preferred.
29. Breaking changes require a new version/migration strategy.
30. Upcasters preserve semantics and do not invent facts.
31. Producer/consumer version skew is expected.
32. Event classification/ownership should be registered canonically.
33. A request expresses intent; an event expresses accepted outcome.
34. A consumer acting on an event calls the owning service rather than writing another feature's state directly.
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
45. Media technical callbacks do not automatically become published events.
46. Notification delivery requests are Integration Events or equivalent side-effect messages, not authoritative notification truth.
47. Authorization role changes are authoritative rows, with an audit row written in the same transaction.
48. Authentication events never contain raw credentials.
49. Moment events must not reintroduce Sub-Moment hierarchy semantics.
50. Timeline read-model updates are derived; the Timeline has no authoritative events of its own.
51. Moderation events reference sensitive evidence rather than embedding it.
52. Event-driven architecture does not imply event sourcing, and Chronologity is the first only.
53. There is exactly one publication mechanism: the transactional outbox.
54. A rebuild reads current authoritative state rather than replaying a message log.
55. Kafka transport metadata never becomes business semantics.
56. Event schemas receive contract and privacy tests.
57. Event creation requires explicit ownership and consumer need.
58. Event granularity must avoid both event explosion and meaningless blobs.
59. Event logs avoid full payloads by default.
60. Architecture documentation changes when event contracts or classifications intentionally change.

---

# Guiding Principle

When creating or consuming an event, ask:

> **What exact cross-boundary change does this message represent, who owns that meaning, how durable is the contract, and what must remain true if it is read years from now — including whether anything in it would by then need to have been erased?**

If those questions cannot be answered clearly, the event boundary is not ready to become canonical.
