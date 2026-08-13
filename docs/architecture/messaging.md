# Chronologity Messaging Architecture

## Purpose

This document defines the asynchronous messaging architecture for Chronologity.

Messaging exists to move authoritative changes and workflow signals across application or subsystem boundaries without forcing every operation into a synchronous dependency chain.

Kafka is Chronologity's asynchronous integration backbone.

This document defines:

- Kafka's role;
- topic design principles;
- producer responsibilities;
- consumer responsibilities;
- reliable publication from authoritative stores;
- delivery semantics;
- partitioning and ordering;
- retries;
- dead-letter/quarantine behavior;
- replay;
- consumer groups;
- idempotency;
- backpressure;
- observability;
- privacy;
- schema/version compatibility;
- and failure recovery.

This document is grounded in:

- `docs/architecture/overview.md`;
- `docs/architecture/principles.md`;
- `docs/architecture/api.md`;
- `docs/architecture/cqrs.md`;
- `docs/architecture/event-sourcing.md`;
- `docs/architecture/events.md`.

---

# Core Principle

Kafka transports events.

Kafka does not define truth.

The governing flow is:

```text
Authoritative state change
        ↓
durable commit
        ↓
reliable publication
        ↓
Kafka
        ↓
idempotent consumers
        ↓
derived state / side effects
```

The architecture must prevent both:

```text
message published
but authoritative change never committed
```

and:

```text
authoritative change committed
but required downstream publication permanently lost
```

---

# Kafka's Role

Kafka is used for asynchronous integration between independently evolving producers and consumers.

Potential consumers include:

- PostgreSQL projections;
- ClickHouse Timeline projections;
- Search indexing;
- notification generation;
- media workflows;
- analytics/observability consumers;
- future integrations.

Kafka is appropriate where:

- producer and consumer should be decoupled;
- processing can be asynchronous;
- multiple consumers need the same change;
- replay/catch-up is useful;
- throughput is significant.

Kafka should not be introduced for synchronous request/response behavior.

---

# Kafka Is Not the Event Store

EventStoreDB remains authoritative for event-sourced aggregate history.

Kafka is a transport log.

Therefore:

```text
EventStoreDB stream version
        ≠
Kafka offset
```

and:

```text
Kafka retention
        ≠
domain retention
```

A lost Kafka cluster should be recoverable from authoritative sources for critical projections where practical.

---

# Authoritative Publication Sources

Chronologity may have more than one authoritative persistence model.

## EventStoreDB-backed authority

For event-sourced aggregates:

```text
EventStoreDB
    ↓
durable subscription
    ↓
publisher
    ↓
Kafka
```

## PostgreSQL-backed authority

For relational authoritative state:

```text
PostgreSQL transaction
    ├── authoritative state change
    └── outbox record
          ↓
outbox publisher
          ↓
Kafka
```

Both paths must preserve the same invariant:

> **A committed authoritative change required downstream must eventually become publishable.**

---

# EventStoreDB Publication

The recommended direction for EventStoreDB-backed aggregates is a durable subscription-based publisher.

Conceptually:

```text
EventStoreDB
    ↓
persistent/catch-up subscription
    ↓
publisher process
    ↓
Integration Event transformation
    ↓
Kafka
    ↓
checkpoint
```

The exact EventStoreDB subscription mechanism should be chosen based on:

- durability;
- checkpoint control;
- consumer recovery;
- operational simplicity.

---

# Publication Checkpoints

The EventStoreDB→Kafka publisher must track progress durably.

Checkpoint state should identify:

- subscription/publisher name;
- source position;
- event type/version if needed;
- publisher version.

A checkpoint is operational state.

It is not a Domain Event.

---

# Publisher Idempotency

The publisher may crash after Kafka accepts a message but before the publisher checkpoint advances.

Therefore the same authoritative event may be published more than once.

This is acceptable.

Consumers must be idempotent.

The Integration Event should retain enough identity to support deduplication.

---

# PostgreSQL Transactional Outbox

For relational-authoritative features, use an outbox where reliable publication is required.

Conceptually:

```text
BEGIN TRANSACTION

update authoritative rows
insert outbox message

COMMIT

outbox publisher
    ↓
Kafka
```

This prevents:

```text
DB commit succeeds
Kafka publish fails forever
```

without requiring a distributed transaction.

---

# Outbox Record

An outbox record should contain:

- message ID;
- event type;
- event version;
- payload;
- metadata;
- creation timestamp;
- partition key;
- publication state/checkpoint metadata.

It should not contain unnecessary transport-specific duplication.

---

# Outbox Publisher

The outbox publisher:

1. reads unpublished rows;
2. validates/serializes the message;
3. publishes to Kafka;
4. records publication success;
5. retries transient failures.

The publisher must tolerate duplicate publication if crash recovery creates ambiguity.

---

# Delivery Semantics

Chronologity assumes:

```text
at-least-once delivery
```

for Kafka consumers.

This means a consumer may receive the same logical message multiple times.

The architecture should achieve:

```text
exactly-once business effect
```

through idempotent consumer design where necessary.

Do not depend on transport-level marketing claims as a substitute for application correctness.

---

# Idempotent Consumers

Every consumer that mutates durable state must be safe under duplicate delivery.

Possible techniques:

- unique Event/Message ID table;
- transactional checkpoint + state update;
- idempotent upsert;
- unique domain constraint;
- deduplication store.

The choice depends on the side effect.

---

# Consumer Processing Model

A typical consumer flow:

```text
Kafka message
    ↓
deserialize
    ↓
validate schema
    ↓
check supported version
    ↓
dedupe/idempotency
    ↓
process
    ↓
persist result
    ↓
advance consumer position
```

Acknowledgment/offset progression must not happen before durable processing completes.

---

# Consumer Groups

Consumers that perform the same logical workload should use the same consumer group.

Examples:

```text
timeline-projection
search-indexer
notification-generator
```

Multiple instances in one group share partitions.

Different logical consumers use different groups so each independently receives required messages.

---

# Topic Design

Topic design should reflect stable integration boundaries rather than one topic per implementation file.

Possible strategies include:

- domain/feature topics;
- lifecycle topics;
- read-model-purpose topics.

Chronologity should prefer a small, intentional set of topics.

Avoid:

```text
one topic per event type
```

unless operational needs justify it.

Also avoid:

```text
one global topic for everything
```

if it creates unrelated coupling and partitioning constraints.

---

# Recommended Topic Direction

A reasonable starting direction may include logical topics such as:

```text
chronologity.domain.identity
chronologity.domain.users
chronologity.domain.moments
chronologity.domain.reactions
chronologity.domain.authorization
chronologity.domain.moderation

chronologity.integration.media
chronologity.integration.notifications
chronologity.integration.timeline
```

Exact topic names are not finalized here.

The messaging implementation/ADR should choose the final set based on consumer needs and ordering.

---

# Topic Naming

Topic names should be:

- stable;
- lowercase;
- environment-independent where possible;
- semantically meaningful.

Environment should normally be encoded through cluster/namespace configuration rather than changing semantic topic names arbitrarily.

---

# Partitioning

Kafka ordering exists only within a partition.

Partition keys must align with the smallest boundary requiring ordered processing.

Potential keys:

```text
aggregateId
momentId
userId
authorizationUserId
moderationCaseId
```

Do not use one global key.

That would serialize unrelated traffic.

---

# Aggregate Ordering

For Domain Events from one aggregate, using aggregate ID as partition key preserves event order for that aggregate within the Kafka topic.

This is often appropriate.

Consumers must still account for duplicate delivery.

---

# Cross-Aggregate Ordering

Chronologity must not depend on global ordering across aggregates.

If a workflow requires one event to causally precede another, that relationship should be represented explicitly through workflow/causation semantics.

Do not rely on Kafka arrival timing across partitions.

---

# Timeline Ordering

Kafka delivery order does not determine historical Timeline order.

Timeline projections use:

```text
Moment occurrence time
```

plus deterministic tie-breaking.

A backfilled Moment may arrive now and belong years in the past.

---

# Message Envelope

Kafka messages use the Integration Event envelope defined in `docs/architecture/events.md`.

At minimum:

```text
messageId
eventType
eventVersion
publishedAt
correlationId
causationId
producer
partitionKey
payload
```

Additional fields require clear operational value.

---

# Message Key

Kafka record key should normally correspond to the partitioning identity.

Examples:

```text
momentId
userId
aggregateId
```

The key is infrastructure routing metadata.

Do not expose it as domain semantics.

---

# Headers

Kafka headers may carry:

- trace context;
- content/schema hints;
- producer metadata;
- replay marker where useful.

Do not put large or sensitive domain payloads in headers.

---

# Schema Validation

Consumers validate messages before processing.

Invalid payloads must not silently enter derived state.

Failure behavior:

```text
invalid schema
    ↓
quarantine/dead-letter
    ↓
alert
```

---

# Schema Compatibility

Producers and consumers may run different versions.

Messaging contracts must support rolling deployment.

Preferred evolution:

```text
producer supports compatible contract
        ↓
old + new consumers coexist
        ↓
migrate
        ↓
retire old support
```

Atomic whole-system deployment is not assumed.

---

# Producer Compatibility

A producer must not emit a breaking schema version until required consumers can understand it.

Breaking change rollout must be deliberate.

---

# Consumer Compatibility

Consumers should explicitly support known versions.

Unknown required versions fail visibly.

Do not guess field semantics.

---

# Retry Strategy

Retries depend on failure type.

## Transient failures

Examples:

- database temporarily unavailable;
- network timeout;
- provider throttling.

Action:

```text
retry with bounded backoff
```

## Permanent/schema failures

Examples:

- invalid event version;
- malformed payload;
- impossible invariant.

Action:

```text
do not retry forever
quarantine
alert
```

## Code defects

Repeated deterministic processing failure should stop or quarantine rather than burn infinite resources.

---

# Retry Backoff

Retry should use bounded exponential backoff with jitter where appropriate.

Do not retry in a tight loop.

Retry policy must consider:

- downstream recovery time;
- consumer lag;
- message ordering;
- operational urgency.

---

# Maximum Retries

Every automated retry loop needs a limit or escalation policy.

After exhaustion:

```text
quarantine / dead-letter
        ↓
alert
        ↓
operator or automated remediation
```

---

# Dead-Letter / Quarantine

Chronologity should prefer the term **quarantine** for messages that cannot be processed safely.

A quarantined message should preserve:

- message ID;
- event type/version;
- original topic;
- partition;
- offset;
- consumer;
- error classification;
- timestamp.

Payload retention must follow privacy rules.

---

# Quarantine Is Not a Trash Can

Quarantined messages require:

- monitoring;
- ownership;
- resolution procedure;
- replay tooling.

An ever-growing dead-letter topic with no operator workflow is operational failure.

---

# Poison Events

A poison event repeatedly fails due to deterministic incompatibility or defect.

Processing must not advance silently past it if order for that partition matters.

Possible strategy:

1. stop affected partition;
2. quarantine event;
3. alert;
4. repair consumer/schema;
5. replay.

---

# Ordering Versus Skip

Skipping a poison event can corrupt downstream state when later messages depend on it.

Therefore skip semantics must be consumer-specific and explicit.

Projection consumers should generally not skip an authoritative state transition casually.

---

# Backpressure

Consumers must control concurrency.

Use:

- bounded worker concurrency;
- pause/resume;
- partition-aware processing;
- batch-size limits;
- queue depth monitoring.

Unbounded async processing can overwhelm:

- PostgreSQL;
- ClickHouse;
- Search;
- external providers.

---

# Consumer Lag

Consumer lag is a first-class operational metric.

Important examples:

```text
timeline projection lag
authorization projection lag
moderation visibility lag
notification lag
search indexing lag
```

Not all lag has equal consequence.

---

# Security-Critical Lag

Some consumers require tighter lag SLOs.

Examples:

- authorization revocation;
- moderation restrictions;
- privacy visibility changes.

A large lag may become a security/privacy incident.

---

# Product-Critical Lag

Timeline projection lag affects perceived product freshness.

A newly created Moment should appear in the correct historical position within an acceptable window.

The exact SLO belongs in operations documentation.

---

# Replay

Replay is used for:

- projection rebuild;
- consumer recovery;
- migration;
- debugging.

Projection rebuild should preferably replay from authoritative sources rather than using live Kafka retention as the only source.

---

# Replay Paths

## EventStoreDB-backed projections

Preferred:

```text
EventStoreDB
    ↓
projection replay
```

## PostgreSQL-backed authority

Preferred:

```text
authoritative state / outbox history / dedicated backfill source
```

depending on the feature.

Kafka replay may still be useful but is not the sole recovery dependency.

---

# Live Side Effects and Replay

Consumers that send email, push, or external side effects must not accidentally repeat historical effects during projection replay.

Separate:

```text
rebuild/replay path
```

from:

```text
live side-effect path
```

where necessary.

---

# Replay Marker

If Kafka is used for controlled replay, messages may carry replay metadata.

Consumers must not trust client-created replay flags.

Replay context is infrastructure-owned.

---

# Reprocessing Quarantined Messages

Replay tooling should allow:

- one message;
- one partition range;
- one event type/version;
- one correlation ID;
- controlled batches.

Reprocessing must preserve idempotency.

---

# Messaging and Projections

Projection consumers are among the primary Kafka consumers.

They may write:

- PostgreSQL read models;
- ClickHouse Timeline read models;
- Search indexes.

Projection logic remains owned by the relevant feature/read architecture.

Kafka only delivers the input.

---

# Messaging and Feed Aggregator

`apps/feed-aggregator` is primarily a query service.

It should not need to consume Kafka to answer normal requests unless a future cache/invalidation architecture explicitly requires it.

The aggregator reads already-derived state.

Projection workers consume messages.

---

# Messaging and Authorization

Role/permission changes may produce Integration Events such as:

```text
UserAuthorizationChanged
```

Consumers may update:

- authorization read models;
- feed-aggregator visibility state;
- caches.

Security-sensitive operations may still check current authoritative state if projection lag is unsafe.

---

# Messaging and Moderation

Moderation changes should propagate rapidly to:

- Timeline read models;
- Search;
- Discovery eligibility;
- media visibility;
- notifications.

Consumers must treat moderation events as high-priority correctness inputs.

---

# Messaging and Privacy

Privacy changes must propagate to all derived systems that may expose data.

Potential consumers:

- ClickHouse projection;
- Search index;
- Discovery cache;
- media authorization state;
- notification system.

The architecture must make incomplete propagation observable.

---

# Messaging and Media

Media processing may use Integration Events:

```text
MediaProcessingRequested
MediaProcessingCompleted
MediaProcessingFailed
```

External transcoder callbacks are validated and translated into application/workflow transitions.

Provider-specific event formats must not leak through the rest of the architecture.

---

# Messaging and Notifications

Notification generation can consume authoritative activity events.

Delivery can be decoupled:

```text
NotificationCreated
        ↓
PushDeliveryRequested
EmailDeliveryRequested
```

The notification record remains authoritative separately from provider delivery attempts.

---

# Messaging and Search

Search indexing consumes domain/integration changes asynchronously.

Search lag is acceptable within defined product limits.

Privacy/moderation removal events require tighter handling than ordinary enrichment updates.

---

# Messaging and Historical Significance

Historical-significance recomputation may be triggered by events.

The trigger is not itself authoritative significance truth.

Example:

```text
MomentChanged
    ↓
SignificanceRecomputeRequested
    ↓
derived computation
```

The computed result remains versioned derived state.

---

# Messaging and Causality

Authoritative causal relationship changes may trigger read-index updates.

Causal inference jobs may also use Integration Events, but AI-derived proposals must retain provenance and not become authoritative merely through publication.

---

# Messaging and Workflows

Long-running workflows may communicate through events and commands.

Conceptually:

```text
event
  ↓
workflow consumer
  ↓
workflow state
  ↓
command
  ↓
aggregate event
```

Workflow consumers must be idempotent.

---

# Saga/Process Manager

A process manager may be introduced for workflows that:

- span multiple aggregates;
- persist over time;
- need retries;
- require compensation.

Do not introduce a generic saga framework unless workflows justify it.

Feature-specific workflow state is preferable initially.

---

# Command Messages

The canonical primary API uses REST for external commands.

Internal asynchronous commands may exist where workflow semantics require them.

If so, they must be clearly distinguished from Integration Events.

An event says:

```text
this happened
```

A command says:

```text
please do this
```

---

# Async Command Delivery

If Kafka is used for an asynchronous command, the consumer owns the decision and may reject it.

A command topic/message is not proof the action occurred.

The resulting Domain Event is the accepted fact.

---

# Producer Retries

Kafka producers should retry transient broker/network failures according to client best practices.

Producer retry must not create semantic duplication issues because Integration Events carry stable message IDs.

---

# Producer Acknowledgment

Use durability settings appropriate for reliable publication.

The exact Kafka producer configuration belongs in technical implementation documentation.

The architecture requires that publication is considered successful only after the durability level selected for production has been satisfied.

---

# Transactions

Kafka transactions may be useful in narrow cases but should not be used as a substitute for authoritative DB/EventStore atomicity.

Chronologity avoids cross-system distributed transactions.

---

# Kafka Exactly-Once Features

Kafka's idempotent producer/transaction features may reduce duplication.

Consumers must still be idempotent because end-to-end effects span external stores.

---

# Consumer Transaction Boundary

Where possible:

```text
consume message
    ↓
write durable state + dedupe/checkpoint atomically
```

inside the target datastore's local transaction.

This reduces ambiguous partial processing.

---

# ClickHouse Consumer Semantics

ClickHouse projection consumers should use deterministic insert/upsert/versioning patterns appropriate to the table engine selected.

The read architecture must define how duplicate messages and corrections are represented.

Do not assume ordinary row-update semantics.

---

# PostgreSQL Consumer Semantics

PostgreSQL projection consumers may use:

- transaction;
- unique event ID;
- projection update;
- checkpoint update

atomically where appropriate.

---

# Search Consumer Semantics

Search consumers should use stable document IDs so repeated indexing is idempotent.

Delete/restriction events must remove or hide documents predictably.

---

# Notification Consumer Semantics

Notification creation should use stable deduplication keys where one domain event should create at most one logical notification.

Provider delivery retries remain separate.

---

# Consumer Deployment

Consumers should be independently deployable where workload/operational needs justify it.

They may initially live as worker entry points within existing application packages.

Do not require one microservice per consumer.

---

# Worker Ownership

A worker's code ownership should follow the feature/subsystem whose projection or side effect it implements.

Physical deployment can change later.

---

# Topic Retention

Kafka topic retention is an operational decision.

Retention should support:

- ordinary consumer catch-up;
- incident recovery;
- controlled replay windows.

It must not be treated as authoritative long-term domain retention.

---

# Compaction

Log-compacted topics may be appropriate for current-state integration streams.

Use compaction only when event semantics fit key-based latest-state retention.

Do not compact away history needed by consumers that rely on full transition sequence.

---

# Topic Deletion

Topic deletion is operationally dangerous.

Production topic lifecycle should be infrastructure-controlled and auditable.

---

# Topic ACLs

Producers and consumers should receive least-privilege Kafka permissions.

Examples:

```text
API publisher
    → write selected topics

timeline projection worker
    → read selected topics

feed aggregator
    → generally no Kafka write access
```

---

# Authentication to Kafka

Backend workloads should use secure service identity.

Potential mechanisms depend on provider:

- SASL/SCRAM;
- TLS certificates;
- cloud IAM;
- managed Kafka identity.

Credentials must not live in source code.

---

# Encryption

Kafka traffic must use encryption in transit.

Broker storage encryption follows infrastructure/security requirements.

Application-level encryption may be used for highly sensitive fields, but minimizing payload sensitivity is preferred.

---

# PII Minimization

Integration Events should not become broad replication channels for PII.

Prefer IDs over:

- raw email;
- exact Location;
- profile data;
- moderation evidence.

Consumers should fetch or receive only data required for their responsibility.

---

# Topic Sensitivity

Topics may have sensitivity classifications.

A topic carrying authorization/security events may require stricter ACLs than a public-content projection topic.

---

# Event Logging

Messaging logs should include:

- message ID;
- event type/version;
- topic;
- partition;
- offset;
- consumer group;
- processing result;
- correlation ID.

Do not log full payloads by default.

---

# Tracing

Trace context should flow:

```text
API request
    ↓
Domain Event
    ↓
publisher
    ↓
Kafka
    ↓
consumer
    ↓
projection/side effect
```

This allows engineers to diagnose:

```text
command succeeded
but Timeline never updated
```

---

# Metrics

Messaging metrics should include:

- publish throughput;
- publish failures;
- producer retry rate;
- consumer throughput;
- consumer lag;
- processing latency;
- retry rate;
- quarantined messages;
- unsupported versions;
- rebalance frequency;
- projection delay.

---

# Alerts

Examples of actionable alerts:

- security-critical consumer lag above threshold;
- poison message quarantined;
- publisher checkpoint stalled;
- Kafka unavailable;
- outbox backlog growing;
- projection consumer repeatedly crashing;
- authorization/moderation propagation delayed.

---

# Health Checks

Consumers should expose health based on:

- broker connectivity;
- ability to poll;
- processing progress;
- downstream datastore connectivity;
- checkpoint advancement.

A process being alive is not enough if no messages are progressing.

---

# Consumer Rebalancing

Consumers must tolerate Kafka group rebalances.

Processing should avoid losing or duplicating effects incorrectly when partitions move between instances.

Idempotency remains the safety mechanism.

---

# Graceful Shutdown

Consumers should:

1. stop accepting new work;
2. finish or safely abandon in-flight work;
3. commit/checkpoint only completed messages;
4. close Kafka connections.

---

# Deployment Compatibility

Producers and consumers are deployed independently.

Therefore:

- schema changes are backward-compatible or versioned;
- old consumers may coexist;
- new consumers may catch up;
- topic migrations require staged rollout.

---

# Topic Migration

If topic architecture changes:

```text
publish old + new
        ↓
migrate consumers
        ↓
validate
        ↓
stop old publishing
        ↓
retire old topic
```

where practical.

Do not switch all producers/consumers atomically unless unavoidable.

---

# Local Development

Local development should provide Kafka or a realistic compatible broker environment.

Mocks are insufficient for:

- partition ordering;
- group rebalancing;
- offset behavior;
- producer retry;
- consumer lag;
- replay.

Unit tests may mock interfaces; integration tests should use real messaging infrastructure.

---

# Testing

## Producer tests

Verify:

- correct event transformation;
- partition key;
- schema version;
- correlation/causation metadata;
- idempotent message ID.

## Consumer unit tests

Verify:

- supported versions;
- duplicate handling;
- retry classification;
- permanent failure classification;
- side-effect semantics.

## Integration tests

Verify:

- publish/consume;
- consumer-group behavior;
- partition ordering;
- retry;
- restart;
- duplicate delivery;
- checkpoint recovery.

## Failure tests

Simulate:

- Kafka unavailable;
- downstream DB unavailable;
- consumer crash after state write but before offset commit;
- poison message;
- schema incompatibility;
- slow consumer.

## Golden-flow tests

Example:

```text
CreateMoment
    ↓
MomentCreated
    ↓
publish
    ↓
timeline projection consumer
    ↓
ClickHouse
    ↓
feed aggregator query
```

---

# Day-One Messaging Requirements

Before launch, Chronologity must define and implement:

- production Kafka provider/deployment;
- canonical topic set;
- topic naming;
- partition-key rules;
- Integration Event envelope;
- producer configuration;
- EventStoreDB publication mechanism;
- publication checkpoints;
- PostgreSQL outbox where needed;
- consumer groups;
- idempotent consumers;
- retry classification;
- bounded retry/backoff;
- quarantine/dead-letter mechanism;
- poison-event handling;
- projection replay path;
- consumer lag metrics;
- security/privacy-critical lag alerts;
- schema validation;
- schema compatibility testing;
- Kafka ACLs;
- service authentication;
- encryption in transit;
- graceful shutdown;
- real integration tests.

---

# Open Architectural Questions

## Kafka Provider

- Managed Kafka or self-managed?
- Which cloud/provider?
- What availability target?
- What regional topology?

## EventStoreDB Publisher

- Persistent subscription or catch-up subscription?
- One shared publisher or feature-specific publishers?
- Where are checkpoints stored?
- Does publisher transform Domain Events to Integration Events directly?

## Topic Design

- Feature-oriented topics or consumer-purpose topics?
- How many initial topics?
- Are Timeline projection events in domain topics or a dedicated integration topic?
- Should authorization/moderation events have separate high-priority topics?

## Partitioning

- Aggregate ID for event-sourced features?
- User ID for authorization?
- Moment ID for Timeline projections?
- How many partitions initially?
- How do we increase partition count without violating ordering assumptions?

## Retry

- Retry in consumer process or retry topics?
- Which failures use delayed retry topics?
- What maximum retry duration?
- How does ordering interact with retries?

## Quarantine

- Dedicated Kafka quarantine topics or relational quarantine store?
- Who owns remediation tooling?
- How are sensitive payloads protected?

## Replay

- Should projection rebuilds consume EventStoreDB directly?
- Recommended: yes for event-sourced authority.
- When is Kafka replay appropriate?
- How are live side-effect consumers isolated from replay?

## PostgreSQL Outbox

- Which non-event-sourced authoritative features require an outbox?
- Where does the outbox publisher run?
- How are rows archived/deleted after publication?

## Consumer Deployment

- Which workers deploy with `apps/api` initially?
- Which deserve independent worker deployments?
- Should Timeline projection workers be a separate process from API HTTP servers?

## Authorization/Moderation

- What maximum propagation lag is acceptable?
- Which read paths require synchronous current-state checks even with messaging?
- Should high-priority consumers have isolated groups/resources?

## Observability

- Which metrics backend?
- What lag SLOs?
- How are publisher/consumer trace IDs correlated?
- What operator dashboard is required before launch?

---

# Architectural Invariants

1. Kafka is transport, not authoritative truth.
2. Authoritative state commits before publication.
3. Required downstream publication must not be permanently lost.
4. EventStoreDB-backed authority uses durable subscription/checkpoint publication.
5. Relational authority uses an outbox or equivalent reliable mechanism where downstream delivery matters.
6. Cross-system distributed transactions are avoided.
7. At-least-once delivery is assumed.
8. Durable consumers are idempotent.
9. Kafka offsets are not aggregate versions.
10. Kafka retention is not domain retention.
11. Topic design reflects stable integration boundaries.
12. One topic per event type is not the default.
13. One global topic for all traffic is not the default.
14. Ordering is guaranteed only within explicit partition boundaries.
15. Global ordering is not assumed.
16. Kafka arrival order does not define historical chronology.
17. Partition keys are stable domain identities, not infrastructure locations.
18. Integration Events use stable message IDs.
19. Invalid messages are rejected/quarantined.
20. Unknown required schema versions fail visibly.
21. Producers and consumers must tolerate version skew.
22. Retry is bounded and failure-type aware.
23. Poison messages do not retry forever invisibly.
24. Skipping an ordered projection event requires explicit justification.
25. Consumers implement backpressure.
26. Consumer lag is observable.
27. Security/privacy-critical lag receives tighter thresholds than ordinary derived lag.
28. Projection rebuild favors authoritative sources over reliance on Kafka retention.
29. Replay must not repeat unsafe external side effects.
30. Feed Aggregator is normally a read service, not a projection consumer.
31. Messaging does not transfer domain ownership to consumers.
32. Moderation/privacy changes must propagate to every derived exposure surface.
33. Media provider callbacks remain external/untrusted until translated.
34. Notification delivery events are separate from notification truth.
35. AI-derived signals remain derived even when carried over Kafka.
36. Internal asynchronous commands remain distinct from events.
37. A command message does not prove the command succeeded.
38. Kafka producer transactions do not replace authoritative persistence semantics.
39. End-to-end correctness still requires consumer idempotency.
40. Consumers should atomically persist state and dedupe/checkpoint where practical.
41. ClickHouse consumers use duplicate-safe projection semantics.
42. Search indexing uses stable document IDs.
43. Notification generation uses logical deduplication keys.
44. Consumer code ownership follows feature/subsystem ownership, not necessarily deployment.
45. Topic retention is operational and deliberate.
46. Topic compaction is used only when semantics justify it.
47. Kafka ACLs follow least privilege.
48. Service credentials are not User credentials.
49. Messaging transport is encrypted.
50. Integration Events minimize PII.
51. Topic sensitivity can drive ACL policy.
52. Logs avoid full message payloads by default.
53. Trace context crosses messaging boundaries.
54. Messaging metrics include publish failures, lag, retries, and quarantine.
55. Health means work is progressing, not merely process alive.
56. Consumers tolerate rebalancing.
57. Graceful shutdown does not acknowledge unfinished work.
58. Topic/schema migrations are staged.
59. Real Kafka integration tests are required.
60. Architecture documentation changes when topic or delivery guarantees intentionally change.

---

# Guiding Principle

When deciding whether to send something through Kafka, ask:

> **Is this a durable cross-boundary change or workflow signal that should be processed independently, retried safely, observed, and consumed by one or more systems without coupling them synchronously?**

If yes, messaging is appropriate.

If the operation requires an immediate request/response decision or has no independent consumer value, keep it synchronous and simpler.
