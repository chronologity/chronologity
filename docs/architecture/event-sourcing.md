# Chronologity Event Sourcing Architecture

## Purpose

This document defines how Event Sourcing is used in Chronologity.

Event Sourcing is the persistence model for selected authoritative domain boundaries where preserving the sequence of accepted domain facts materially improves:

- correctness;
- auditability;
- reconstruction;
- temporal reasoning;
- deterministic projection rebuilding;
- forensic debugging;
- historical integrity.

Chronologity does **not** use Event Sourcing universally.

The presence of EventStoreDB in the architecture does not imply that every feature, workflow, cache, projection, job, or relational table must be represented as an event-sourced aggregate.

This document is grounded in:

- `docs/architecture/overview.md`;
- `docs/architecture/principles.md`;
- `docs/architecture/monorepo.md`;
- `docs/architecture/api.md`;
- `docs/architecture/authentication.md`;
- `docs/architecture/authorization.md`;
- `docs/architecture/cqrs.md`.

It defines:

- Event Sourcing boundaries;
- aggregate streams;
- event semantics;
- stream naming;
- versioning;
- optimistic concurrency;
- reconstruction;
- snapshots;
- projection/replay relationships;
- event publication;
- privacy and erasure constraints;
- migration;
- testing;
- operational recovery;
- and the criteria for deciding whether a feature should be event sourced.

---

# Core Principle

Event Sourcing records accepted domain history.

Conceptually:

```text
Command
  ↓
Aggregate decision
  ↓
Domain Events
  ↓
append-only stream
  ↓
authoritative aggregate history
```

The current aggregate state is derived by replaying the authoritative sequence of events.

The governing rule is:

> **An event stream records what Chronologity accepted as having happened to an aggregate, not every technical operation performed by the system.**

---

# Event Sourcing Is Selective

Chronologity should event source a domain boundary only when the historical sequence of state transitions has durable value.

Good candidates generally have:

- meaningful domain invariants;
- important state transitions;
- audit value;
- reconstruction value;
- concurrency requirements;
- downstream projections;
- history that is itself useful for reasoning.

Poor candidates generally include:

- caches;
- projection tables;
- temporary upload chunks;
- transient verification tokens;
- short-lived worker jobs;
- derived counts;
- read-only materialized views;
- large binary media;
- data whose historical mutation sequence adds little value.

The architecture should resist "event sourcing everything."

---

# EventStoreDB

EventStoreDB is Chronologity's authoritative event-stream persistence system for selected aggregates.

Its responsibilities are:

- append ordered events to aggregate streams;
- enforce expected stream version;
- read aggregate history in order;
- support subscriptions for downstream processing;
- preserve event metadata;
- support replay and reconstruction.

EventStoreDB is not:

- a general query database;
- a media store;
- a cache;
- a Search index;
- a Timeline read store;
- a replacement for PostgreSQL.

---

# Aggregate Stream Model

Each event-sourced aggregate has its own logical stream.

Conceptually:

```text
aggregate type + aggregate ID
        ↓
stream identity
```

Examples may include:

```text
identity-{identityId}
session-{sessionId}
user-{userId}
moment-{momentId}
reaction-{reactionId}
upload-{uploadId}
authorization-{userId}
moderation-case-{caseId}
```

Exact stream names are implementation details.

Public identifiers must not depend on physical stream naming.

---

# Stream Naming

Stream naming should be:

- deterministic;
- collision-resistant;
- feature-owned;
- versionable if conventions ever change;
- independent of deployment topology.

Canonical helpers should live close to the owning feature when stream identity expresses domain semantics.

A shared `stream-name` utility may enforce safe formatting without owning every feature's naming rule.

---

# Aggregate Identity

Aggregate identity must be stable for the lifetime of the domain entity.

It must not encode:

- EventStoreDB node;
- partition;
- database cluster;
- timestamp ordering;
- storage shard.

Aggregate IDs are domain identifiers.

Storage location is infrastructure.

---

# Domain Events

A Domain Event represents an accepted past-tense fact.

Examples:

```text
MomentCreated
ReactionAdded
SessionRevoked
UserRoleAssigned
ContentRestricted
```

Events should describe domain meaning, not implementation activity.

Prefer:

```text
MomentCreated
```

over:

```text
MomentRowInserted
```

Prefer:

```text
UserRoleAssigned
```

over:

```text
AuthorizationTableUpdated
```

---

# Event Naming

Event names should:

- use canonical Chronologity terminology;
- be past tense;
- describe one accepted fact;
- avoid infrastructure vocabulary;
- remain stable once persisted.

Persisted event names are durable contracts.

Renaming them casually is not equivalent to renaming an internal class.

---

# Event Payloads

An event payload should contain enough information to represent the accepted fact and support reconstruction/projection requirements.

It should not be a full aggregate snapshot by default.

Avoid:

- raw secrets;
- large media binaries;
- provider tokens;
- transient request objects;
- Fastify types;
- database rows;
- unnecessary PII;
- derived presentation fields.

Events should be purposefully minimal.

---

# Event Metadata

Event metadata may contain cross-cutting context such as:

- event ID;
- aggregate ID;
- aggregate type;
- event type;
- event version;
- occurred/recorded timestamp;
- command ID;
- correlation ID;
- causation ID;
- acting User/Identity ID where appropriate;
- trace ID;
- schema version;
- source application.

Metadata should not become a second payload.

Avoid sensitive values unless necessary.

---

# Event Time Versus Historical Occurrence Time

Chronologity must distinguish:

```text
Domain Event persistence time
        ≠
Moment occurrence time
```

Example:

```text
2026-08-11
MomentCreated event persisted

Moment occurrence time:
1998-05-03
```

The EventStoreDB ordering tells us when the system accepted the domain transition.

It does not determine where the represented Moment belongs in history.

This distinction is foundational.

---

# Aggregate Reconstruction

An event-sourced aggregate reconstructs state by applying its stream events in order.

Conceptually:

```text
initial state
   ↓
apply event 1
   ↓
apply event 2
   ↓
...
   ↓
current aggregate state
```

Event application must be deterministic.

Replaying the same event sequence under the same aggregate/event version semantics should yield the same state.

---

# Aggregate Behavior

Aggregates should separate:

```text
decide
```

from:

```text
apply
```

Conceptually:

```text
command method
   ↓
validate invariants
   ↓
emit event
   ↓
apply event to state
```

The apply function must not perform side effects.

It should not:

- query databases;
- call external providers;
- publish Kafka messages;
- send notifications;
- read wall-clock time unless passed deterministically;
- invoke AI models.

---

# Command Decision

A command method evaluates:

- current aggregate state;
- command input;
- trusted context;
- domain invariants.

It produces:

```text
zero or more Domain Events
```

or a domain error.

No event means no authoritative state transition.

---

# Optimistic Concurrency

EventStoreDB expected-version checks provide optimistic concurrency.

Conceptually:

```text
read stream @ version 7
        ↓
execute command
        ↓
append events expecting version 7
```

If another writer has already advanced the stream:

```text
actual version = 8
```

the append fails.

The API must not silently overwrite the concurrent decision.

---

# Concurrency Conflict Handling

A concurrency conflict may be:

- returned to the caller;
- retried after reloading;
- resolved by feature-specific logic.

Automatic retry is appropriate only when the command remains semantically safe after reload.

Do not globally retry all conflicts blindly.

---

# Event Versioning

Persisted events need explicit schema-version discipline.

Potential approaches include:

```text
event type + version
```

such as:

```text
moment-created.v1
moment-created.v2
```

or equivalent metadata.

The architecture should preserve the ability to deserialize old events indefinitely while supported history exists.

---

# Backward Compatibility

New code must continue to understand old persisted events.

Options include:

- backward-compatible event readers;
- upcasters;
- versioned event handlers;
- explicit migration.

The preferred default is:

```text
preserve old event
+
adapt on read
```

rather than rewriting historical streams unnecessarily.

---

# Upcasting

An upcaster transforms an older persisted event representation into the shape expected by current aggregate/projection code.

Upcasting should be:

- deterministic;
- side-effect free;
- version-specific;
- testable.

It should not invent new historical facts.

If new information did not exist in the old event, the upcaster must use an explicit default/unknown semantic rather than fabricate certainty.

---

# Event Migration

Physical event rewriting should be rare.

Reasons might include:

- legal erasure;
- severe schema defect;
- infrastructure migration.

Routine model evolution should prefer readers/upcasters.

Rewriting event history increases operational and audit complexity.

---

# Aggregate Version

Aggregate stream version is separate from event schema version.

For example:

```text
stream version = 42
```

means 42 accepted events have been appended.

It does not mean the aggregate uses "schema v42."

Keep these concepts distinct.

---

# Snapshots

Snapshots are an optimization.

They are not authoritative history.

Conceptually:

```text
event stream
    ↓
snapshot at version N
    ↓
load snapshot
    +
events N+1...
```

If a snapshot is lost, the aggregate must remain reconstructable from authoritative events unless explicit retention rules say otherwise.

---

# Snapshot Criteria

Snapshots should be introduced only when aggregate reconstruction cost is materially problematic.

Potential triggers:

- long-lived aggregate streams;
- high command frequency;
- expensive apply logic;
- measurable latency.

Do not snapshot every aggregate from day one.

---

# Snapshot Storage

Snapshot storage may use PostgreSQL, EventStoreDB-supported mechanisms, or another explicitly chosen store.

The snapshot contains derived aggregate state.

It must not become the only surviving copy of facts.

---

# Snapshot Versioning

Snapshots must include enough version information to detect incompatibility with current aggregate code.

If incompatible:

```text
discard snapshot
    ↓
rebuild from events
```

should remain possible.

---

# Event-Sourced Boundaries

Chronologity should decide event-sourced boundaries per feature.

The canonical API currently includes aggregates for:

```text
auth
authorization
users
uploads
moments
reactions
timelines
notifications
moderation
```

The presence of an aggregate file in the canonical tree is strong architectural intent, but focused review must confirm whether Event Sourcing is justified for each boundary.

---

# Authentication

## Identity

Identity is a strong Event Sourcing candidate because:

- verification history matters;
- provider linking/unlinking matters;
- security state changes matter;
- auditability matters.

Sensitive authentication values must not be stored raw in events.

## Session

Session is also a strong candidate because:

- creation;
- refresh;
- revocation;
- expiration;
- revoke-all interactions

benefit from durable history.

Raw access/refresh credentials never belong in events.

---

# Authorization

The dedicated `features/authorization/` module is a strong Event Sourcing candidate for role assignment.

Events such as:

```text
UserRoleAssigned
UserRoleRemoved
```

provide:

- auditability;
- deterministic current-role reconstruction;
- projection into fast authorization read state.

The initial model does not require direct per-User permission-grant events.

---

# Users

User account lifecycle is a reasonable Event Sourcing candidate.

Potential events include:

- UserCreated;
- UserProfileUpdated;
- UsernameChanged;
- UserDeactivated;
- UserReactivated;
- UserDeleted.

However, highly mutable/sensitive profile fields may require externalization or relational state to preserve erasure.

Event Sourcing should capture meaningful account facts without copying all profile PII into immutable payloads.

---

# Uploads

Upload lifecycle can benefit from Event Sourcing if the lifecycle is authoritative and multi-stage.

Potential events:

- UploadRegistered;
- UploadReceived;
- MediaProcessingStarted;
- MediaProcessingCompleted;
- MediaProcessingFailed;
- UploadDeleted.

Temporary multipart chunks and provider-specific technical events do not need to become Domain Events.

---

# Moments

Moment is a strong Event Sourcing candidate.

Reasons include:

- historical integrity;
- occurrence-time semantics;
- auditability;
- media association/order changes;
- visibility changes;
- corrections;
- deletion/moderation interactions.

The finalized product model does not include recursive Sub-Moment hierarchy events.

Moment events must not reintroduce:

- split;
- merge;
- reparent;
- nested chronology.

---

# Reactions

Reaction is a plausible Event Sourcing candidate but should be evaluated pragmatically.

Benefits:

- clear add/remove/update lifecycle;
- auditability;
- downstream count projections.

Costs:

- potentially enormous event volume;
- simple state model;
- high write rate.

It may still be appropriate because each Reaction is small and partitionable, but Event Sourcing should be justified by measured/architectural benefit rather than symmetry.

---

# Timelines

Timeline requires semantic revalidation before Event Sourcing is finalized.

The product defines Timeline primarily as a derived historical representation.

Therefore:

```text
Timeline read state
```

must not be event sourced. There is no Timeline aggregate and no authoritative Timeline definition to source (ADR-084): every scope is derived from facts owned elsewhere, and the high-volume composition is derived in turn.

---

# Notifications

Notification event sourcing should be evaluated cautiously.

Notification state may include:

- created;
- delivered;
- read;
- dismissed.

Some of this is high-volume operational state rather than valuable domain history.

A relational authoritative model plus events may be simpler.

Do not event source notification delivery attempts merely for consistency with other features.

---

# Moderation

Moderation is a strong Event Sourcing candidate.

Reasons:

- consequential decisions;
- auditability;
- appeals;
- restoration;
- policy/version traceability;
- administrative accountability.

Moderation events must avoid embedding unnecessary evidence or sensitive content directly.

Use references to controlled evidence storage where appropriate.

---

# Event Sourcing and CQRS

Event Sourcing naturally feeds CQRS projections.

```text
EventStoreDB
    ↓
Domain Events
    ↓
projections
    ↓
PostgreSQL / ClickHouse
    ↓
queries
```

But CQRS does not require Event Sourcing.

A relationally authoritative feature may still publish events and maintain read projections.

---

# Event Sourcing and Kafka

EventStoreDB is authoritative.

Kafka is integration transport.

Conceptually:

```text
EventStoreDB commit
        ↓
reliable subscription/publication
        ↓
Kafka
        ↓
consumers
```

Kafka offsets do not replace aggregate stream versions.

Kafka retention does not define authoritative history.

---

# Reliable Publication

The architecture must guarantee that committed Domain Events required downstream are not permanently lost.

The exact mechanism must be defined in `docs/architecture/messaging.md`.

Likely ingredients include:

- EventStoreDB persistent/catch-up subscriptions;
- publication checkpoints;
- idempotent Kafka publication;
- integration-event transformation;
- poison-event handling.

---

# Domain Events Versus Integration Events

Domain Events represent internal authoritative facts.

Integration Events represent externally consumable change contracts.

They may differ.

Example:

```text
Domain Event:
MomentVisibilityChanged

Integration Event:
TimelineMomentEligibilityChanged
```

or the Domain Event may be published directly if its contract is already appropriate.

Do not force every external consumer to depend on internal aggregate event schemas.

---

# Projection Replay

Projections should be reconstructable from authoritative inputs.

Replay may occur:

- from EventStoreDB;
- through integration event history where appropriate;
- from a controlled backfill source.

EventStoreDB remains the preferred source for event-sourced authoritative history.

---

# Replay Determinism

For the same:

- event sequence;
- event versions;
- projection algorithm version;
- configuration;

the rebuilt projection should produce equivalent state where practical.

This is especially important for:

- Timeline projections;
- historical-significance inputs;
- authorization state;
- moderation visibility.

---

# Projection Checkpoints

Each projection consumer should track progress.

Checkpoint identity should include:

- projection name;
- projection version;
- source stream/subscription;
- last processed position.

Checkpoints are operational state.

They are not Domain Events.

---

# Idempotent Replay

Projection handlers must safely handle repeated events.

A replay may deliver an event already processed.

The projection should either:

- detect duplicate event ID;
- use idempotent upsert semantics;
- rely on a durable checkpoint + transactional write where safe.

Exactly-once delivery should not be assumed.

---

# Event Ordering

Aggregate stream ordering is authoritative for that aggregate.

Global ordering across all aggregates is not required.

Cross-aggregate workflows must not assume:

```text
event A was persisted before event B globally
```

unless a workflow explicitly establishes causal ordering.

---

# Historical Ordering

Event persistence order is not historical occurrence order.

For Timeline projections, ordering uses domain occurrence semantics.

Example:

```text
MomentCreated event position:
latest

Moment occurrence time:
20 years ago
```

The Timeline projection inserts that Moment into the correct historical position.

---

# Causation and Correlation

Event metadata should distinguish:

```text
correlation
    → events/workflows belonging to same broader operation

causation
    → event/command that directly caused this event
```

These identifiers improve:

- tracing;
- debugging;
- auditability;
- replay analysis.

---

# Command IDs

Commands that require idempotency should have stable command/request IDs.

The resulting events may reference the command ID in metadata.

This helps detect duplicate command execution without embedding transport-specific details into domain payloads.

---

# Event IDs

Every persisted event should have a globally unique event ID.

Event IDs support:

- deduplication;
- projection idempotency;
- tracing;
- audit correlation.

---

# Event Metadata Privacy

Metadata can leak sensitive information just as payloads can.

Avoid:

- raw email;
- IP addresses unless explicitly justified;
- precise Location;
- User-Agent strings in every event;
- moderation evidence;
- raw provider identifiers.

Store only what durable domain/audit needs require.

---

# Privacy and Event Sourcing

Event Sourcing creates tension with privacy and erasure.

The architectural rule is:

> **Append-only domain history does not grant permission to retain personal data forever.**

Chronologity must design events so privacy and deletion obligations remain implementable.

---

# Minimize Sensitive Data in Events

Prefer:

```text
IdentityEmailAdded {
    emailRecordId
}
```

over:

```text
IdentityEmailAdded {
    rawEmailAddress
}
```

when the raw value needs future erasure.

The mutable/sensitive value may live in a separate protected store.

The event preserves the historical fact that an email association changed without permanently embedding the PII.

---

# Externalized Sensitive Data

Sensitive data may be stored outside immutable event payloads and referenced by stable IDs.

Examples:

- email address;
- exact Location;
- moderation evidence;
- provider credential metadata;
- potentially sensitive profile fields.

This enables deletion/redaction without rewriting the entire event stream.

---

# Cryptographic Erasure

For selected data, Chronologity may encrypt sensitive payloads with per-subject/per-record keys.

Erasure may destroy the key.

This can preserve immutable encrypted bytes while making the content unrecoverable.

Cryptographic erasure adds operational complexity and should be used only where it solves a concrete retention problem.

---

# Redaction

Event redaction may be required for:

- legal erasure;
- accidental secret leakage;
- prohibited content accidentally persisted;
- severe PII mistakes.

Redaction must be exceptional and auditable.

The architecture should not assume "immutable" means operationally impossible to remediate.

---

# Tombstones

A tombstone event may indicate that a domain resource is deleted/unavailable.

Example:

```text
MomentDeleted
```

A tombstone does not necessarily erase sensitive payloads from earlier events.

Deletion semantics must distinguish:

```text
domain lifecycle deletion
        ≠
physical erasure of sensitive data
```

Both may be required.

---

# Account Deletion

Account deletion may require:

- Session revocation;
- User lifecycle event;
- projection cleanup;
- media deletion;
- Search/ClickHouse removal;
- externalized PII erasure;
- event-data redaction/cryptographic erasure where necessary.

The EventStoreDB stream may retain non-sensitive structural facts where legally/product-appropriate.

---

# Media

Media binaries never belong in EventStoreDB.

Events reference media IDs.

Media storage owns:

- originals;
- derivatives;
- captions;
- thumbnails;
- transcodes.

Deletion must coordinate event state with object-store removal.

---

# Moderation Evidence

Moderation evidence should generally not be embedded in immutable moderation events.

Events should reference:

```text
caseId
resourceId
evidenceRecordId
decision
policyVersion
```

while sensitive evidence lives in protected storage with its own retention rules.

---

# Event Retention

Event retention must be deliberate.

Chronologity should generally retain authoritative non-sensitive domain history as long as required for:

- reconstruction;
- auditability;
- historical integrity.

Sensitive data retention must follow privacy/security/legal policy.

EventStoreDB retention configuration must not silently truncate aggregate history required for reconstruction unless snapshots/compaction architecture explicitly supports it.

---

# Stream Deletion

Hard stream deletion should be rare.

Potential reasons:

- legal requirement;
- security incident;
- test/development cleanup.

Ordinary product deletion should generally be represented by Domain Events plus sensitive-data erasure, not physical stream removal.

Exact EventStoreDB tombstone/delete mechanics belong in technical operations documentation.

---

# Stream Category Projection

EventStoreDB category or type streams may support subscriptions across aggregate instances.

For example:

```text
$ce-moment
```

or equivalent application-defined subscription grouping.

The architecture should not expose EventStoreDB category naming as a public contract.

---

# Subscription Model

Projection/publication workers should use durable subscription/checkpoint mechanisms.

They must handle:

- restart;
- duplicate delivery;
- handler failure;
- poison events;
- catch-up after downtime.

A consumer cannot assume it will remain continuously connected.

---

# Poison Events

A poison event is one that repeatedly fails a consumer due to:

- unknown schema;
- corrupted payload;
- deterministic bug;
- incompatible projection logic.

The system must not retry forever invisibly.

It should:

- quarantine or pause safely;
- alert operators;
- preserve checkpoint integrity;
- allow correction/replay.

---

# Projection Failure

Projection failure must not corrupt authoritative history.

If a ClickHouse projection fails:

```text
EventStoreDB remains authoritative
        ↓
projection catches up later
```

This is a primary benefit of the architecture.

---

# Rebuild Strategy

A projection rebuild should support:

1. create/clear target projection version;
2. start from known source position;
3. process events deterministically;
4. track progress;
5. validate results;
6. atomically switch readers where possible;
7. retire old projection.

Large rebuilds must not block normal authoritative writes.

---

# Event Sourcing and Historical Significance

Historical significance is derived.

The event store should persist authoritative facts that may influence significance.

It should not persist every calculated significance score as if it were domain truth unless product semantics explicitly require a historical record of calculations.

Calculated significance belongs in versioned derived state.

---

# Event Sourcing and Causality

If causal relationships are authoritative User/system assertions, their lifecycle may be event sourced.

Potential events:

- CausalRelationshipProposed;
- CausalRelationshipConfirmed;
- CausalRelationshipCorrected;
- CausalRelationshipRemoved.

AI inference output should retain provenance and must not silently become authoritative without a defined acceptance process.

---

# Event Sourcing and Historical Corrections

Historical corrections should be represented as explicit new facts rather than silently rewriting prior events.

Example:

```text
MomentCreated {
    occurrenceTime = 2004-05-01
}

MomentOccurrenceTimeCorrected {
    previous = 2004-05-01
    corrected = 2004-05-03
    reason/provenance
}
```

The current aggregate state reflects the correction.

The event history preserves that the correction occurred.

Sensitive values may need externalization.

---

# Event Sourcing and Immutable Moments

Chronologity's product concept of historical integrity does not mean a Moment can never change metadata.

It means changes that matter should be explicit, attributable, and semantically valid.

Event Sourcing supports that distinction well:

```text
original accepted fact
        ↓
later correction
        ↓
current authoritative state
```

rather than silently overwriting history.

---

# Event Sourcing and Moderation

Moderation does not rewrite occurrence time.

A Moment can remain historically positioned while moderation events change:

- visibility;
- distribution eligibility;
- access;
- account state.

Projection logic must combine Moment state with moderation state appropriately.

---

# Event Sourcing and Authorization

Role assignment/removal events can provide authoritative authorization history.

Current permission evaluation should use efficient current state, not replay role streams on every request.

Event history supports:

- audit;
- reconstruction;
- projection rebuild.

---

# Event Sourcing and Authentication

Identity/Session events provide security history.

Raw credentials remain outside events.

Refresh-token rotation may record facts such as:

```text
SessionRefreshed
```

without storing the refresh token itself.

---

# Event Sourcing and Uploads

Technical provider callbacks should translate into authoritative application commands/events only when they represent accepted lifecycle transitions.

Provider-specific noise should not flood Domain Event streams.

---

# Event Sourcing and Notifications

If notification state is not event sourced, it may still consume Domain Events.

For example:

```text
ReactionAdded
    ↓
notification consumer
    ↓
PostgreSQL notification record
```

This is compatible with Event Sourcing.

Consumers do not need to be event sourced themselves.

---

# Choosing an Event-Sourced Aggregate

Before event sourcing a new aggregate, answer:

1. What invariant does the aggregate protect?
2. Why is the transition history valuable?
3. Who consumes the events?
4. Can state be reconstructed deterministically?
5. What is the expected event volume?
6. What are the privacy implications?
7. What sensitive data must be externalized?
8. How is optimistic concurrency meaningful?
9. What read projections are required?
10. What is the operational cost of replay?

If these questions do not produce compelling answers, relational authoritative state may be simpler.

---

# Aggregate Size

Aggregates should be consistency boundaries, not conceptual containers for entire subdomains.

Avoid aggregates that require loading:

- every Moment in a Timeline;
- every Reaction for a Moment;
- every Session for every User;
- every media item for an entire account.

Large collections should usually be referenced/managed through separate aggregates or read models.

---

# Cross-Aggregate Transactions

EventStoreDB aggregate streams do not imply cross-aggregate ACID transactions.

Avoid business invariants that require atomically writing many unrelated streams.

Prefer:

- one aggregate consistency boundary;
- workflow/saga coordination;
- compensating behavior;
- eventual convergence.

If a true invariant spans entities, reconsider aggregate boundaries.

---

# Workflows and Sagas

Long-running workflows may coordinate multiple aggregates.

Conceptually:

```text
event
  ↓
workflow state
  ↓
command to another aggregate
  ↓
event
  ↓
next step
```

Workflow state may be persisted relationally or event sourced depending on audit/recovery needs.

Do not event source workflows automatically.

---

# Duplicate Commands

Event Sourcing does not automatically prevent duplicate commands.

Use:

- command idempotency keys;
- aggregate invariants;
- request deduplication;
- unique constraints where applicable.

An aggregate may reject a duplicate semantic operation if current state proves it already occurred.

---

# Exactly-Once Myth

EventStoreDB append semantics can provide one accepted append per expected version.

That does not create exactly-once behavior across:

- Kafka;
- projections;
- email;
- push;
- ClickHouse;
- external providers.

Downstream consumers remain idempotent.

---

# Event Schema Registry

Chronologity should maintain a canonical registry/mapping of persisted event types and schema versions.

Potentially in:

```text
packages/contracts
```

for cross-runtime events, or API-local contracts where persistence is internal.

The registry should prevent accidental duplicate names and incompatible decoding.

---

# Event Serialization

Serialization must be deterministic enough for reliable decoding and test fixtures.

JSON is a reasonable initial format.

Fields should avoid ambiguous representations.

Examples:

- timestamps in a canonical format;
- IDs as canonical strings;
- enums as stable strings;
- money values never as floating-point if ever introduced.

---

# Nullability and Missing Fields

Event schema evolution must distinguish:

```text
field absent
```

from:

```text
field explicitly null
```

where domain meaning differs.

Upcasters/readers must preserve old semantics.

---

# Event Validation

Persisted events should be validated on read and before append.

Invalid event payloads indicate severe system defects.

Do not silently coerce unknown events into partial state.

---

# Unknown Events

Aggregate reconstruction must have an explicit strategy for unknown event types.

Preferred behavior:

```text
fail reconstruction loudly
```

rather than silently skip authoritative history.

Projection consumers may quarantine unsupported events while preserving checkpoint safety.

---

# Event Replay Testing

Every event-sourced aggregate should have tests covering:

- reconstruction from historical event sequences;
- expected emitted events from commands;
- invalid transitions;
- old event versions/upcasters;
- snapshot compatibility if snapshots exist.

---

# Golden Aggregate Tests

Use table-driven event-history tests such as:

```text
Given:
  IdentityCreated
  IdentityEmailVerified

When:
  SetPrimaryIdentityEmail

Then:
  IdentityPrimaryEmailChanged
```

This keeps domain behavior independent from EventStoreDB infrastructure.

---

# EventStoreDB Integration Tests

Integration tests should verify real EventStoreDB behavior for:

- append;
- expected version;
- concurrency conflict;
- stream read ordering;
- subscription;
- checkpoint recovery;
- stream-not-found behavior;
- metadata handling.

Mocks are insufficient for these infrastructure semantics.

---

# Replay Tests

Critical projections should have end-to-end replay tests:

```text
events
  ↓
projection
  ↓
expected read model
```

The test should also deliver duplicate events where appropriate.

---

# Privacy Tests

Event schema tests should assert that prohibited fields do not appear.

Examples:

- refresh token;
- OAuth token;
- raw recovery code;
- media binary;
- raw moderation evidence.

Privacy should be enforced structurally, not only by code review memory.

---

# Event Observability

Operational telemetry should expose:

- append latency;
- append failures;
- concurrency conflicts;
- stream read latency;
- subscription lag;
- poison events;
- replay throughput;
- projection checkpoint;
- event publication lag.

Do not log full event payloads by default.

---

# Correlation

A command-to-query flow should be traceable:

```text
HTTP request
    ↓
command ID
    ↓
Domain Event IDs
    ↓
Kafka publication
    ↓
projection checkpoint
    ↓
read model update
```

This is critical for debugging eventual consistency.

---

# EventStoreDB Availability

If EventStoreDB is unavailable:

- event-sourced authoritative commands cannot safely commit;
- the API should fail those commands;
- derived reads may remain available from existing projections.

The system must not fall back to writing a projection database as authority.

---

# Backup and Recovery

EventStoreDB backup strategy must protect authoritative history.

Recovery procedures should include:

- point-in-time/cluster recovery where supported;
- validation of stream continuity;
- subscription checkpoint recovery;
- projection rebuild after restore.

Detailed procedures belong in operations documentation.

---

# Multi-Region Considerations

The initial architecture should not assume multi-region active-active EventStoreDB writes unless explicitly required.

Aggregate optimistic concurrency and stream ordering are easier to reason about with a single authoritative write topology.

Future multi-region requirements should be addressed through a dedicated architecture decision.

---

# Performance

Event Sourcing adds cost primarily through:

- aggregate reconstruction;
- event volume;
- projection processing;
- subscription throughput;
- replay.

Performance should be measured.

Do not abandon Event Sourcing for speculative performance concerns, but do not ignore streams that grow without bound.

Snapshots, aggregate redesign, or archival strategies should be introduced based on evidence.

---

# Event Volume

High-volume features such as Reactions require special scrutiny.

Potential scale techniques include:

- partitioned streams;
- one aggregate per Reaction rather than one stream containing all Moment Reactions;
- asynchronous count projections;
- retention of derived summaries outside aggregate history.

Do not create one "Moment reactions" aggregate that serializes all Reaction writes for a popular Moment.

---

# Stream Hotspots

A stream becomes a hotspot when too many writers contend on one expected version.

Aggregate design must avoid unnecessary shared streams.

Examples of poor boundaries:

```text
all users in one stream
all moments in one stream
all reactions for one global feed in one stream
```

Prefer independently writable aggregate streams.

---

# Authorization Hotspots

Role assignment should not require one global authorization stream for all Users.

A per-User authorization aggregate or another partitionable boundary avoids global write serialization.

The canonical `user-authorization.aggregate.ts` supports this direction.

---

# Session Hotspots

Each Session should have its own aggregate stream if Session is event sourced.

"Revoke all Sessions" may require coordinating across Session aggregates through an Identity/User security version or dedicated revocation generation mechanism.

Do not require loading every historical Session stream synchronously if a scalable alternative exists.

The exact design belongs in authentication implementation/ADR.

---

# Event Sourcing and Deletion Rebuilds

A projection rebuild must not reintroduce erased externalized PII.

If an event references:

```text
emailRecordId
```

and the underlying email record was erased, the projection should produce the correct deleted/redacted state.

Replay logic must not assume referenced sensitive data always exists.

---

# Event Sourcing and Policy Evolution

Historical events should be interpreted according to domain semantics, not retroactively changed because today's policy differs.

For example:

```text
ContentRestricted under policy v2
```

should preserve which policy governed the decision where audit value requires it.

Current visibility may be derived using current policy plus historical enforcement state.

---

# Day-One Event Sourcing Requirements

Before launch, Chronologity must define and implement:

- confirmed event-sourced aggregate boundaries;
- canonical stream naming;
- expected-version optimistic concurrency;
- event IDs;
- correlation/causation metadata;
- event schema versioning;
- old-event reader/upcaster strategy;
- aggregate reconstruction;
- runtime event validation;
- sensitive-data event rules;
- externalized PII strategy where required;
- EventStoreDB client infrastructure;
- durable subscriptions;
- projection/publication checkpoints;
- idempotent projection handling;
- reliable downstream publication;
- poison-event handling;
- replay tooling;
- projection rebuild tooling;
- EventStoreDB integration tests;
- event privacy tests;
- backup/recovery expectations;
- observability for append/subscription/replay.

---

# Recommended Initial Event-Sourced Boundaries

The recommended starting position is:

```text
Strong yes:
- Identity
- Session
- User
- Moment
- Authorization / UserAuthorization
- Moderation Case / Enforcement

Likely yes, but confirm:
- Upload

Evaluate carefully:
- Reaction
- Timeline definition
- Notification
```

These are architectural recommendations, not a substitute for the explicit boundary decision that should be recorded before implementation.

If a candidate is ultimately relational-authoritative, the canonical monorepo should be amended to remove misleading aggregate/event folders rather than scaffolding unused Event Sourcing ceremony.

---

# Open Architectural Questions

## Aggregate Boundaries

- Confirm the final event-sourced aggregate list.
- Is Upload event sourced?
- Is Reaction event sourced?
- Is Notification event sourced?
- What exactly is the event-sourced Timeline definition, if any?
- Does Moderation use one case aggregate plus separate enforcement aggregate or one combined boundary?

## Session Model

- How does `RevokeAllSessions` scale without coordinating every Session stream?
- Is there an Identity-level session generation/security epoch?
- Do access tokens carry that epoch?
- How is Session revocation checked?

## User and Identity PII

- Which exact fields are externalized?
- Does Identity event history ever contain raw email?
- Does User event history contain display name?
- What User/profile fields are erasable?
- How are erased values represented on replay?

## Moment Events

- Which Moment metadata is immutable versus correctable?
- What event represents occurrence-time correction?
- What event represents media ordering changes?
- Does visibility live in Moment or separate privacy aggregate?
- How does Moment deletion interact with historical tombstones?

## Reaction Scale

- Is one event-sourced Reaction aggregate per User+Moment+reaction-type appropriate?
- Is a relational unique constraint simpler?
- What event volume is expected?
- What audit value justifies Event Sourcing?

## Timeline

Settled (ADR-084). No Timeline state is authoritative, Timeline definitions are not persistent domain resources, no lifecycle command survived product-semantic validation, and the canonical tree no longer contains a Timeline aggregate.

## Notification

- Is read/unread state important enough for Event Sourcing?
- Are delivery attempts purely operational relational rows?
- Do we need notification event history beyond audit/logging?

## Sensitive Data

- Which data requires cryptographic erasure?
- Which uses externalized references?
- Which event types require redaction capability?
- How are backup copies handled?

## Event Publication

- Are Domain Events published directly to Kafka?
- Or transformed into Integration Events?
- Where does transformation live?
- Which event metadata survives the boundary?
- How are incompatible consumers handled?

## Snapshots

- Which aggregates need snapshots?
- At what measured stream length/latency threshold?
- Where are snapshots stored?
- How are snapshot schemas versioned?

## Replay

- What tooling initiates per-feature projection rebuilds?
- Can replay be scoped by aggregate/tenant/User/Timeline?
- How do we prevent replay from overwhelming ClickHouse/PostgreSQL?
- How are projection versions switched?

---

# Architectural Invariants

1. Event Sourcing is selective, not universal.
2. EventStoreDB is authoritative only for intentionally event-sourced aggregates.
3. Domain Events represent accepted past-tense facts.
4. Event names use canonical domain language, not infrastructure language.
5. Persisted event schemas are durable contracts.
6. Event payloads are purposefully minimal.
7. Raw secrets never appear in Domain Events.
8. Large media binaries never appear in Domain Events.
9. Event metadata is also subject to privacy minimization.
10. Domain Event persistence time is distinct from Moment occurrence time.
11. Aggregate reconstruction is deterministic.
12. Event application functions are side-effect free.
13. Aggregate command methods enforce invariants before emitting events.
14. Expected-version append protects event-sourced concurrency.
15. Concurrency conflicts are not silently overwritten.
16. Automatic retry of concurrency conflicts is feature-specific.
17. Event schema version and stream version are distinct concepts.
18. Old persisted events remain readable.
19. Upcasters do not invent historical facts.
20. Physical event rewriting is exceptional.
21. Snapshots are derived optimization, not authority.
22. Loss of a snapshot must not destroy authoritative history.
23. Event-sourced boundaries are consistency boundaries, not whole subdomains.
24. Cross-aggregate distributed transactions are avoided.
25. EventStoreDB stream order is authoritative only within its relevant stream.
26. No global event ordering is assumed.
27. Event persistence order does not define historical chronology.
28. Event IDs are globally unique.
29. Correlation and causation identifiers are distinct.
30. Kafka is not authoritative event history.
31. Committed Domain Events required downstream must not be permanently lost.
32. Domain Events and Integration Events may be different contracts.
33. Projection handlers are idempotent.
34. Projection checkpoints are operational state, not Domain Events.
35. Poison events must become visible rather than retry forever silently.
36. Projection failure cannot corrupt EventStoreDB authority.
37. Projection rebuild must be possible without blocking authoritative writes.
38. Historical significance remains derived rather than embedded as immutable truth.
39. Causal assertion history may be event sourced only if causality is authoritative domain state.
40. Historical corrections are explicit new facts, not silent event rewriting.
41. Moderation changes access/distribution without rewriting occurrence time.
42. Event Sourcing does not override privacy or erasure requirements.
43. Sensitive data should be externalized from immutable events when erasure is required.
44. Cryptographic erasure is optional and requires concrete justification.
45. Event redaction must remain possible for exceptional legal/security cases.
46. Product deletion and physical erasure are distinct.
47. Media deletion occurs in media storage, not EventStoreDB payloads.
48. Moderation evidence should be referenced rather than embedded.
49. Event retention is deliberate.
50. Hard stream deletion is exceptional.
51. Consumers must survive restart, duplicate delivery, and catch-up.
52. A query system outage must not cause the API to write to projections as authority.
53. EventStoreDB infrastructure semantics require real integration tests.
54. Event privacy rules should be testable.
55. Aggregate design must avoid write hotspots.
56. Reactions require event-volume analysis before Event Sourcing is finalized.
57. Authorization state must not use one global serialized stream.
58. Replay must not resurrect erased sensitive data.
59. Event Sourcing choices should be reflected honestly in the canonical monorepo.
60. Architecture documentation must be updated when event-sourced boundaries change.

---

# Guiding Principle

When deciding whether to event source a Chronologity domain boundary, ask:

> **Does preserving the exact sequence of accepted domain facts materially improve correctness, auditability, reconstruction, or historical integrity enough to justify the operational and privacy complexity of an append-only event stream?**

If yes, Event Sourcing is a strong fit.

If not, use a simpler authoritative model and publish events only where downstream integration requires them.
