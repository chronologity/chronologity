# Chronologity Projections Architecture

## Purpose

This document defines the architecture for projections in Chronologity.

Projections transform authoritative domain changes into read-optimized representations.

They are the bridge between:

```text
authoritative history
        ↓
derived read state
```

Chronologity relies on projections because its query workloads differ substantially from its command-side domain models.

This document defines:

- projection ownership;
- projection inputs;
- projection outputs;
- projection execution;
- checkpoints;
- idempotency;
- ordering;
- PostgreSQL projections;
- ClickHouse projections;
- rebuild and replay;
- projection versioning;
- migration;
- privacy and deletion behavior;
- moderation and authorization propagation;
- observability;
- testing;
- deployment boundaries;
- and projection governance.

This document is grounded in:

- `docs/architecture/overview.md`;
- `docs/architecture/principles.md`;
- `docs/architecture/api.md`;
- `docs/architecture/events.md`;
- `docs/architecture/messaging.md`.

---

# Core Principle

A projection is derived.

It is never the authoritative source of a domain fact merely because it is easier to query.

Conceptually:

```text
Authoritative event/state
        ↓
projection logic
        ↓
read model
```

The governing rule is:

> **If a projection is lost, Chronologity should be able to reconstruct it from authoritative inputs or an explicitly retained canonical source.**

Where full reconstruction is intentionally impossible, that exception must be documented.

---

# Projection Versus Read Model

A projection is the logic/process that transforms authoritative inputs.

A read model is the stored result.

These are distinct concepts.

Example:

```text
MomentCreated
        ↓
timeline-moment projection
        ↓
ClickHouse timeline row
```

The projection is not the row.

The row is not the projection.

---

# Projection Inputs

A projection may consume:

- Integration Events, delivered over Kafka by the outbox publisher;
- controlled backfill inputs read from authoritative PostgreSQL state;
- another explicitly authoritative source.

The input source must be clear.

Do not project from another derived table unless the architecture explicitly treats it as a stable upstream derived dependency.

---

# Projection Outputs

Projection outputs may include:

- PostgreSQL read tables;
- ClickHouse read models;
- Search documents;
- cache-warming data;
- current authorization state;
- notification read state;
- moderation visibility state;
- historical-significance inputs/outputs;
- Timeline slices/indexes.

Each output has one clear owning projection.

---

# Projection Ownership

Projection code should be owned by the feature or subsystem whose authoritative facts it interprets.

Examples:

```text
features/users/projections/
features/moments/projections/
features/authorization/projections/
features/moderation/projections/
```

Cross-feature read composition may be owned by a dedicated read-side projection subsystem when the output is not naturally owned by one feature.

The owning projection defines:

- input event types;
- output schema;
- version;
- idempotency rules;
- rebuild semantics;
- privacy semantics.

---

# Projection Location

The canonical API tree currently places projection definitions inside feature modules.

That remains the correct logical ownership model.

Physical execution may be:

- inside a worker entry point within `apps/api`;
- inside one or more independently deployed projection workers;
- inside a future dedicated projection application if scale justifies it.

Logical ownership and deployment location are separate decisions.

---

# Projection Execution Boundary

Chronologity should not execute heavy projection work inside request handlers.

A typical authoritative flow is:

```text
API request
  ↓
authoritative commit
  ↓
event publication
  ↓
projection worker
  ↓
read model
```

The request should not wait for projection completion unless a specific product guarantee requires it.

---

# Projection Workers

Projection workers consume authoritative/integration events and materialize read state.

A worker may own:

- one projection;
- a related group of projections;
- one target datastore;
- one workload class.

Avoid one monolithic worker that handles every projection if that creates unrelated scaling/failure coupling.

Also avoid one deployable service per projection without operational justification.

---

# Projection Worker Responsibilities

A worker should:

1. consume supported events;
2. validate event type/version;
3. apply idempotency/deduplication;
4. transform event to read-model mutation;
5. persist mutation;
6. checkpoint progress;
7. emit metrics/traces;
8. handle retries/quarantine.

A worker should not:

- make authoritative domain decisions;
- write another feature's authoritative state directly;
- own user-facing command semantics.

---

# Checkpoints

Projection progress must be durable.

Kafka owns consumer-group offsets, so a projection reading Kafka does not
maintain a position of its own. What it does maintain is a record of the messages
it has already applied — `projection_processed_events` — because at-least-once
delivery means a message will eventually arrive twice and a projection that
double-counts silently disagrees with history.

There is deliberately no table holding a global stream position. One existed for
the previous architecture and was removed with it: a position in a stream is
meaningless when the source is a partitioned log whose offsets Kafka already
tracks, and keeping the table would invite something to record the wrong kind of
progress in it.

---

# Kafka Checkpoints

For Kafka-driven projections, offsets are managed per topic partition.

Kafka offset progression must reflect durable processing.

Do not commit offsets before the read-model update is safely persisted.

---

# Checkpoint Atomicity

Where possible:

```text
projection state update
+
dedupe marker/checkpoint
```

should commit atomically in the target datastore.

This minimizes ambiguity after crashes.

---

# Idempotency

Every projection must tolerate duplicate input.

Duplicate delivery can occur because:

- Kafka is at-least-once;
- publisher retry occurs;
- consumer crashes before offset commit;
- replay intentionally repeats events.

Projection correctness must not depend on one-time delivery.

---

# Idempotency Strategies

Possible strategies include:

- processed Event ID table;
- unique Event ID column;
- versioned upsert;
- deterministic replacement;
- compare-and-set on the subject's version;
- transactional checkpoint + update.

Choose per datastore and projection semantics.

---

# Ordering

A projection must document the ordering it requires.

Possible requirements:

- per-Moment order;
- per-User order;
- no ordering beyond idempotency.

Do not assume global order.

---

# Out-of-Order Events

Some projections may receive events out of order across partitions or sources.

The projection should either:

- tolerate out-of-order updates;
- use version numbers to ignore stale changes;
- partition by the required ordering key;
- buffer within bounded limits.

The rule must be explicit.

---

# Subject Version in Read Models

Where useful, a projection row may store the version of the thing it describes:

```text
sourceVersion
```

This allows duplicate or stale messages to be rejected, which matters because
partition ordering guarantees nothing across partitions.

Example:

```text
incoming version 11
stored version 12
        ↓
ignore as stale
```

---

# Projection Determinism

Projection logic should be deterministic for the same:

- input event sequence;
- projection version;
- configuration.

This supports:

- rebuild;
- testing;
- migration;
- auditability.

---

# External Calls During Projection

Projection logic should avoid external network calls where possible.

A projection that requires external services becomes:

- harder to replay;
- slower;
- less deterministic;
- more fragile.

Prefer projecting from data already present in authoritative/integration events.

If enrichment requires external data, separate:

```text
core projection
```

from:

```text
enrichment workflow
```

---

# Projection Side Effects

A projection should primarily mutate derived state.

It should not send email, push notifications, or perform unrelated external side effects.

Those are separate consumers/workflows.

This makes projection replay safe.

---

# Projection Replay Safety

A projection must be safe to replay repeatedly.

Rebuilding a Timeline projection must not:

- resend notifications;
- trigger moderation actions;
- create duplicate uploads;
- mutate authoritative state.

Projection logic should be side-effect limited to its derived target.

---

# PostgreSQL Projections

PostgreSQL is appropriate for relational read models and current operational views.

Potential projections include:

- User profile;
- Session view;
- authorization state;
- upload status;
- moderation cases;
- notification state;
- account status.

These projections may use normal transactional updates.

---

# ClickHouse Projections

ClickHouse is appropriate for high-volume historical and Timeline read models.

Potential outputs include:

- Timeline Moment rows;
- chronology indexes;
- contextual adjacency;
- Location Timeline rows;
- User Timeline rows;
- Reaction summaries;
- moderation visibility;
- historical-significance representations;
- temporal aggregation rows.

ClickHouse projections are derived.

---

# Feed Aggregator Relationship

`apps/feed-aggregator` reads ClickHouse projections.

It does not own authoritative projection generation.

The normal flow is:

```text
API / authoritative state
        ↓
events
        ↓
projection workers
        ↓
ClickHouse
        ↓
feed aggregator
        ↓
GraphQL
```

The feed aggregator should not write Timeline projection state during request handling.

---

# API ClickHouse Client

The canonical API tree currently includes a ClickHouse client.

Its legitimate use is limited to projection-related or operational infrastructure.

Normal API feature queries should not bypass the feed aggregator.

If projection execution is moved entirely outside API-owned worker processes, API runtime ClickHouse access may become unnecessary.

That decision should be revisited in implementation planning.

---

# Timeline Projection

Timeline projection is a first-class subsystem.

It must support:

- occurrence-time ordering;
- backfilled history;
- deterministic tie-breaking;
- contextual scope;
- horizontal adjacency;
- temporal zoom;
- historical jumps;
- visibility/moderation filtering data;
- scalable pagination.

The projection must not store literal 3D UI coordinates as authoritative semantics.

---

# Timeline Row

A Timeline read row may denormalize:

- Moment ID;
- occurrence time;
- creator summary;
- media preview;
- context IDs;
- Location display data;
- visibility classification;
- moderation eligibility;
- Reaction summary;
- historical-significance data;
- source versions.

The exact schema belongs in data/read-model documentation.

---

# Backfilled History

When a new Moment is created today with an old occurrence time:

```text
MomentCreated
        ↓
Timeline projection
        ↓
insert into historical position
```

Projection order is based on historical semantics, not event arrival order.

---

# Deterministic Tie-Breaking

If two Moments share the same occurrence time, the Timeline projection must use a stable secondary key.

Potentially:

```text
occurrenceTime
momentId
```

or another deterministic ordering contract.

The choice must remain stable for cursor pagination.

---

# Temporal Zoom Projections

Broad temporal scales may require precomputed aggregates.

Examples:

```text
day buckets
month buckets
year buckets
decade anchors
```

or another product-defined hierarchy.

Temporal zoom projections should preserve drill-down access to underlying Moments.

They are derived representations.

**As built, there is no zoom projection.** Spans are grouped at query time over
`timeline_moment_contexts`, by an expression shared with the read that chooses
what represents them — no bucket table, no materialized view, and no significance
copied into ClickHouse. Precomputing would require invalidation on authorization,
privacy, deletion, causal, Event *and* significance changes, which is six sources
to get right in exchange for an improvement nobody has measured a need for.

Drill-down needs no cursor of its own: a span's start and the scale it was read
at determine the interval behind it, so a client re-asks for the Timeline over
that interval.

A span's counts come from the projection and its representative Moments come from
PostgreSQL, which means both stores must agree about where a span begins. They
compute it independently from one generator rather than one asking the other, and
the counts decide which spans exist — a representative for a span the projection
did not return is dropped, which is what makes projection lag harmless here.

---

# Historical Significance Projection

Historical significance should use versioned derived state.

A significance projection may store:

- Moment/entity ID;
- context;
- algorithm version;
- computed value/dimensions;
- provenance;
- computedAt.

It should not become authoritative truth, and it must remain recomputable when the algorithm changes.

---

# Historical Jump Indexes

Historical jumps require read-side indexes that can locate meaningful destinations directly.

Possible indexes:

- by Moment;
- by occurrence time;
- by Real-World Event;
- by Location;
- by causal relationship;
- by historically significant anchor.

These are read-model concerns.

---

# Horizontal Context Projection

Horizontal adjacency is **not** projected (ADR-143). It is a query over the membership the Timeline projection already holds — two contexts are adjacent when a Moment belongs to both — so there is no edge table to build, rebuild or keep in step. What follows described a projection that was considered and is not what was built.

Horizontal adjacency may require projection of:

- neighboring Locations;
- related Real-World Events;
- other contextual scopes.

The projection should store semantic relationships, not UI x-coordinates.

---

# Moment Depth Projection

The aggregator needs a read-optimized Moment depth representation.

This may combine:

- Moment metadata;
- media order;
- creator summary;
- Reaction summary;
- Location context;
- visibility/moderation state.

The output is read composition state, not a second Moment authority.

---

# Authorization Projection

The dedicated authorization feature may project:

- current roles;
- effective permissions;
- account authorization state.

This projection supports fast checks.

Security-sensitive actions may still consult stronger/current authoritative state where lag is unacceptable.

---

# Privacy Projection

Privacy/visibility state may be denormalized into read models.

The projection must support:

- visibility changes;
- audience changes;
- blocking;
- resource deletion.

A stale privacy projection can be a security incident.

---

# Moderation Projection

Moderation state should be projected into:

- Timeline eligibility;
- Search eligibility;
- Discovery eligibility;
- moderator case views;
- media visibility.

Moderation restriction propagation requires tighter operational monitoring.

---

# Search Projection

Search indexes are projections.

They must support:

- content addition/update;
- removal;
- privacy changes;
- moderation changes;
- block-sensitive filtering where relevant.

Search index content is never authoritative.

---

# Notification Projection

Notification read state may be projected or relationally authoritative depending on final notification architecture.

If projected, read/unread semantics must be clearly distinguished from provider delivery state.

---

# Projection Versioning

Material projection changes should use explicit versions.

Examples:

```text
timeline-v1
timeline-v2
authorization-v1
```

Versioning is needed when:

- schema changes incompatibly;
- algorithm changes materially;
- semantics change;
- migration requires side-by-side state.

---

# Projection Version Identity

A projection version should be independently deployable/rebuildable.

It should identify:

- projection name;
- version;
- source contract versions;
- output schema version;
- algorithm/config version where relevant.

---

# Side-by-Side Rebuild

Preferred migration:

```text
existing projection v1 serving reads
        ↓
build v2 in parallel
        ↓
replay/backfill
        ↓
validate
        ↓
switch readers to v2
        ↓
retire v1
```

This avoids destructive in-place rebuilds.

---

# Projection Validation

Before switching readers:

- row counts/ranges should be compared;
- invariant checks should pass;
- sampled records should match expected semantics;
- authorization/privacy correctness should be validated;
- query performance should be tested.

---

# Projection Rebuild

A rebuild should be a first-class operational capability.

The system should support:

- full rebuild;
- projection-specific rebuild;
- time-range rebuild where safe;
- entity-scoped rebuild where supported.

Do not rely on ad hoc SQL repair as the primary recovery strategy.

---

# Rebuild Source

The preferred source is current authoritative state:

```text
PostgreSQL
```

Specifically:

- authoritative tables;
- a purpose-built backfill query

may be used.

The source must be documented.

---

# Rebuild Throttling

Large rebuilds must not overwhelm production systems.

Support:

- bounded concurrency;
- rate limiting;
- batch size;
- pause/resume;
- checkpointing.

---

# Rebuild and Live Traffic

A rebuild should coexist with ongoing writes.

Potential strategies:

- dual-write to new projection version;
- replay to a catch-up point then switch to live;
- use source positions to detect convergence.

The exact technique depends on the projection.

---

# Rebuild and Deleted Data

Replay must not resurrect data that is currently deleted or erased.

This is one of the most important projection rules.

If historical events reference erased externalized data:

```text
replay
    ↓
missing/redacted reference
    ↓
produce current deleted/redacted state
```

Do not "restore" the old sensitive value from another stale source.

---

# Rebuild and Privacy

Current privacy state must govern rebuilt output.

A projection rebuild must not temporarily make private content public.

Side-by-side projection validation must include privacy checks before reader cutover.

---

# Rebuild and Moderation

Current moderation restrictions must be applied.

A replay that reintroduces restricted content into ClickHouse/Search is incorrect even if the historical Moment event predates the restriction.

---

# Rebuild and Blocking

Viewer-specific/block state may be represented separately from content rows.

Rebuild architecture must preserve block enforcement.

Avoid materializing per-viewer Timeline rows if a more scalable authorization representation can work.

---

# Projection Dependency Graph

Projections should avoid deep dependency chains.

Prefer:

```text
authoritative events
    ↓
projection
```

over:

```text
projection A
    ↓
projection B
    ↓
projection C
```

Derived-on-derived chains amplify lag and make rebuild more complex.

Where unavoidable, dependency order must be explicit.

---

# Derived-on-Derived Projection

A derived projection may consume another derived output only when:

- the upstream projection is a stable contract;
- recomputation cost justifies it;
- provenance remains clear.

Historical-significance computation may be one such case.

This should be explicit.

---

# Projection Configuration

Projection behavior may depend on versioned configuration.

Examples:

- temporal bucket sizes;
- significance algorithm version;
- eligibility rules;
- normalization rules.

Configuration affecting output semantics must be versionable and observable.

---

# Projection Provenance

For derived algorithms, output should include enough provenance to answer:

- which projection version produced this;
- which algorithm/config version was used;
- when it was computed;
- what authoritative source position was processed.

Not every simple CRUD read projection needs full provenance metadata.

---

# Projection Freshness

Read models should expose or internally track freshness.

Potential metadata:

```text
sourcePosition
updatedAt
projectionVersion
```

This supports lag diagnosis.

---

# Read Staleness

The client generally should not need raw projection positions.

However, operational APIs/metrics should be able to determine whether data is stale.

For some workflows, an API may return:

```text
processing
pending projection
```

rather than pretending convergence is immediate.

---

# Projection Lag SLOs

Different projections need different lag targets.

Examples:

```text
authorization/moderation/privacy
    → tight

Timeline freshness
    → moderate/tight product target

historical significance recomputation
    → looser

analytics
    → loose
```

Operations documentation should define concrete SLOs.

---

# Projection Failure Classification

Failures may be:

- transient datastore failure;
- unsupported event version;
- malformed event;
- deterministic projection bug;
- capacity/backpressure issue.

Each requires different recovery behavior.

---

# Poison Projection Event

A projection must not silently skip an event that is required for correct state.

Quarantine/pause/alert is preferred.

Once corrected, replay resumes from the safe checkpoint.

---

# Projection Repair

Manual repair should be minimized.

If a projection row is wrong, preferred repair is:

```text
fix projection logic/data issue
    ↓
rebuild/replay
```

rather than editing production rows manually.

Emergency repair procedures may exist but must be auditable.

---

# Projection Schema Migrations

Read-model schema migration should favor additive/parallel patterns.

For PostgreSQL:

- add columns/tables;
- backfill;
- switch readers;
- retire old shape.

For ClickHouse:

- new table/version;
- replay;
- switch.

Avoid destructive migration that leaves no rollback path.

---

# Projection and Contract Stability

Internal read-model schemas may change without breaking mobile clients.

GraphQL/REST contracts should map from the projection into stable client-facing schemas.

Do not expose raw ClickHouse table shape directly.

---

# Projection and Caching

Caches may sit after projections.

A projection update may trigger cache invalidation.

Cache state remains more disposable than projection state.

Do not use cache invalidation events as a substitute for updating the underlying projection.

---

# Projection and Feed Aggregator DataLoaders

DataLoaders batch access to existing read models.

They are not projections.

Request-scoped DataLoader caches should be rebuilt every request.

---

# Projection and Analytics

Analytics may consume the same authoritative events through separate consumers.

Analytics outputs should not become product read authority unless explicitly promoted through a product architecture decision.

---

# Projection and Historical Record Integrity

A projection may transform presentation.

It must not silently change historical truth.

Examples:

- Timeline row may summarize media;
- temporal zoom may cluster Moments;
- Search may rank;
- significance may score.

The authoritative occurrence time and identity remain unchanged.

---

# Projection and Uncertainty

Derived read models must preserve uncertainty where the authoritative domain represents it.

Do not convert:

```text
occurrence time range
```

into:

```text
false exact timestamp
```

because the target table is easier to query that way.

---

# Projection and Corrections

When an authoritative historical correction event occurs:

```text
MomentOccurrenceTimeCorrected
```

projections must update:

- Timeline position;
- Search time filters;
- Real-World Event context where affected;
- historical-significance dependencies;
- historical jump indexes.

Correction propagation must be deterministic and observable.

---

# Projection and Deletion

A deletion event should remove or tombstone derived state according to product semantics.

Targets may include:

- PostgreSQL;
- ClickHouse;
- Search;
- caches.

Derived deletion must not rely solely on TTL expiration.

---

# Projection and Media Deletion

Media-related projections should remove references to deleted/unavailable derivatives.

Object storage deletion is separate.

Projection state should not retain stale delivery URLs.

---

# Projection and Account Deletion

Account deletion may require:

- anonymization;
- removal;
- tombstones;
- ownership transfer rules where product-defined.

Projection rebuild must reproduce the correct post-deletion representation.

---

# Projection and Authorization Revocation

Role removal must propagate to authorization projections quickly.

If a read service caches effective permissions:

```text
UserRoleRemoved
    ↓
authorization projection
    ↓
cache invalidation/update
```

High-risk operations may bypass stale read projections.

---

# Projection and Moderation Appeals

If content is restored after appeal:

```text
ContentRestored
```

projections must reintroduce eligible content only after current privacy/deletion rules are evaluated.

Restoration is not a blind reversal of every prior derived row.

---

# Projection Worker Deployment

Initial options:

### API-owned worker process

Projection code remains in `apps/api`, with separate worker entry points.

Advantages:

- simple ownership;
- shared contracts;
- fewer applications.

### Dedicated projection application

Possible later if:

- workload dominates API operations;
- independent scaling is necessary;
- failure isolation is needed;
- language/runtime changes.

The current architecture should prefer API-owned worker processes initially unless measured needs justify extraction.

---

# HTTP Server Versus Worker Process

Projection processing should not share lifecycle assumptions with the API HTTP server.

Even if packaged in `apps/api`, use separate entry points/processes.

Conceptually:

```text
apps/api
    ├── http server
    └── projection worker(s)
```

This allows independent scaling/deployment.

---

# Projection Writer Integration

The canonical API includes:

```text
integrations/projection-writer/
```

This should represent a boundary to target read stores where useful.

However, projection logic should remain feature-owned.

The projection writer is infrastructure.

It should not contain domain-specific projection semantics.

---

# Projection Registry

Chronologity should maintain a registry of projections.

Each registration should include:

- name;
- version;
- input events;
- target datastore;
- checkpoint strategy;
- replay-safe classification;
- owner.

This can be code-driven.

---

# Projection Discovery

Worker startup may register enabled projections explicitly.

Avoid magical filesystem auto-discovery if it makes deployment behavior hard to reason about.

Explicit registration is preferred.

---

# Projection Ordering Within a Worker

If multiple projection handlers consume the same event, they should be independently retryable where possible.

One slow projection should not unnecessarily block unrelated projections unless shared ordering is required.

Separate consumer groups can isolate workloads.

---

# Projection Topic Consumption

A projection may consume:

- domain feature topics;
- integration-specific topics.

The choice should minimize unnecessary coupling.

Timeline projections may benefit from a dedicated integration contract if they would otherwise depend on many of the API's internal changes.

---

# Projection Throughput

Throughput should be measured per projection.

Scaling knobs:

- Kafka partitions;
- consumer instances;
- batch size;
- target datastore concurrency;
- denormalization strategy.

Do not optimize globally without identifying the constrained projection.

---

# Projection Batching

Batching may improve:

- ClickHouse insertion;
- PostgreSQL upserts;
- Search bulk indexing.

Batching must not break ordering/idempotency requirements.

---

# ClickHouse Batch Writes

Timeline projection workers should likely batch ClickHouse writes for throughput.

The exact batch size is operational tuning.

The projection must still preserve deterministic version/update semantics.

---

# PostgreSQL Projection Transactions

For PostgreSQL projections, a batch may be processed inside a transaction where safe.

Avoid enormous transactions that increase lock/recovery cost.

---

# Projection Backpressure

Projection workers need bounded concurrency and pause/resume behavior.

Backpressure protects target datastores.

Lag is preferable to uncontrolled resource exhaustion.

---

# Projection Scaling

Scale projection workers independently by workload.

Examples:

```text
timeline projection
    → high throughput

authorization projection
    → low throughput, tight latency

historical-significance projection
    → compute-heavy
```

These should not necessarily share one worker pool forever.

---

# Projection Observability

Each projection should expose:

- current source position;
- lag;
- events processed;
- events/sec;
- processing latency;
- write latency;
- retries;
- failures;
- quarantine count;
- rebuild progress;
- projection version.

---

# Projection Health

A projection is healthy when:

- consumer is alive;
- checkpoint advances;
- lag is within target;
- target datastore writes succeed;
- no poison event blocks progress.

Process uptime alone is insufficient.

---

# Rebuild Observability

Rebuild tooling should expose:

- start position;
- current position;
- target position;
- percentage/estimated remaining work where meaningful;
- error count;
- throughput;
- target version.

---

# Projection Auditing

Simple projections do not need per-row audit history because authoritative events already provide history.

Derived algorithms with material product effect may need provenance/version data.

---

# Projection Security

Projection workers should use least-privilege credentials.

Examples:

```text
timeline projection worker
    → write ClickHouse timeline tables

feed aggregator
    → read those tables only
```

A worker should not hold write permission on authoritative tables unless its role explicitly requires it.

---

# Projection Privacy

Projection data should include only what the read surface requires.

Avoid replicating sensitive data simply because it exists upstream.

Examples:

- use User ID instead of email;
- use coarse Location where exact coordinates are unnecessary;
- reference media IDs instead of secret delivery URLs.

---

# Projection Data Classification

Read models should have sensitivity classification.

This informs:

- access control;
- encryption;
- caching;
- logging;
- retention.

---

# Projection Retention

Derived read state should have explicit retention/lifecycle rules.

Some projections may retain current state only.

Others may retain historical aggregates for Timeline navigation.

Retention is a product/read requirement, not automatically equal to event retention.

---

# Testing

## Projection Unit Tests

Given an event:

```text
apply
    ↓
expected read-model mutation
```

Tests should cover:

- creation;
- update;
- deletion;
- duplicate event;
- stale version;
- correction;
- privacy change;
- moderation change.

## Replay Tests

Given full event sequence:

```text
replay
    ↓
expected final read state
```

## Version Migration Tests

Verify:

- v1 and v2 can coexist;
- rebuild completes;
- readers switch correctly;
- rollback remains possible.

## Datastore Integration Tests

Use real PostgreSQL/ClickHouse for semantics that mocks cannot reproduce.

## Privacy Tests

Verify rebuild does not reintroduce deleted/private/restricted data.

## Golden Path Tests

Example:

```text
MomentCreated
    ↓
Timeline projection
    ↓
ClickHouse row
    ↓
feed aggregator query
```

---

# Day-One Projection Requirements

Before launch, Chronologity must define and implement:

- projection ownership;
- projection registry;
- worker entry points;
- durable checkpoints;
- idempotent processing;
- ordering/version strategy;
- PostgreSQL projection patterns;
- ClickHouse projection patterns;
- Timeline projection;
- authorization projection;
- moderation visibility projection;
- privacy propagation;
- deletion propagation;
- projection lag metrics;
- poison-event handling;
- replay/rebuild tooling;
- projection versioning;
- side-by-side migration strategy;
- projection privacy rules;
- real datastore integration tests;
- golden command→event→projection→query tests.

---

# Recommended Initial Worker Model

The recommended starting architecture is:

```text
apps/api
    ├── HTTP server process
    ├── PostgreSQL projection worker
    ├── ClickHouse Timeline projection worker
    └── other feature-specific async workers as needed
```

These remain part of the same application/code ownership boundary initially.

They may deploy independently.

A separate `apps/projections/` application should not be introduced unless scale or operational isolation later justifies it.

---

# Open Architectural Questions

## Worker Entrypoints

- What exact worker entry files exist?
- Should there be one generic projection worker with registrations?
- Or separate entry points by datastore/workload?
- Recommended: separate major workload entry points with shared projection infrastructure.

## ClickHouse Ownership

- Does the ClickHouse client remain in `apps/api/src/lib/database/`?
- Or move into projection-worker-specific infrastructure?
- Should HTTP API processes be built/deployed without ClickHouse credentials?

## Timeline Projection

- What exact ClickHouse tables exist?
- What is the sorting key?
- What is the partition key?
- How are updates/corrections represented?
- Which denormalized fields are required?

## Temporal Zoom

- Which aggregations are precomputed?
- Which are query-time?
- Are scales discrete?
- How are broad-scale historical anchors stored?

## Historical Significance

- Is significance a standalone projection worker?
- Does it consume raw authoritative events or Timeline read models?
- How are algorithm versions stored?
- How is recomputation triggered?

## Authorization

- Where is the authorization read model stored?
- PostgreSQL?
- Redis/cache plus PostgreSQL authority?
- How quickly must role removal propagate?
- Which high-risk checks bypass projection state?

## Privacy/Blocking

- What data is denormalized into ClickHouse?
- Are block lists query-time only?
- How are mass fan-out privacy changes handled?
- How do we avoid per-viewer projection explosion?

## Moderation

- Does restriction remove rows or mark them ineligible?
- How is restoration handled?
- What is the propagation SLO?

## Search

- Does Search consume the same Integration Events as Timeline, or a dedicated contract?
- Is Search projection code owned by API or future search application?
- How is full reindex performed?

## Replay

- How is replay initiated securely?
- Can replay target one projection version?
- Can it target one time range?
- How is live traffic synchronized with replay?

## Checkpoints

- Where are projection checkpoints stored?
- PostgreSQL?
- Target datastore?
- Kafka offsets only?
- Recommended: standard consumer-group offsets for Kafka, with target-specific idempotency recorded per applied message.

## Migration

- How is reader cutover performed?
- Feature flag?
- configuration?
- deployment switch?
- How long are old projection versions retained after cutover?

---

# Architectural Invariants

1. Projections are derived, never authoritative by convenience.
2. Projection logic and read models are distinct concepts.
3. Every projection has a clear authoritative input source.
4. Every read model has a clear projection owner.
5. Projection code remains feature/subsystem owned.
6. Projection deployment location may change without changing logical ownership.
7. Heavy projection work does not execute inside HTTP request handlers.
8. Projection workers are independently restartable.
9. Projection progress is checkpointed durably.
10. Consumer progress is operational state, never domain truth.
11. Projection state updates and dedupe/checkpointing are atomic where practical.
12. Duplicate events are expected.
13. Projections are idempotent.
14. Ordering requirements are explicit.
15. Global ordering is not assumed.
16. A subject's version may be stored to reject stale updates.
17. Projection logic is deterministic where practical.
18. External calls are avoided inside core projection logic.
19. Projection replay must not trigger unrelated side effects.
20. PostgreSQL is appropriate for relational operational/read projections.
21. ClickHouse is appropriate for high-volume Timeline/historical projections.
22. Feed Aggregator consumes projections; it does not own them.
23. Normal feed-aggregator requests do not write projection state.
24. API-side ClickHouse access is projection/operations scoped.
25. Timeline projections use occurrence time, not event arrival time.
26. Backfilled Moments are inserted into their correct historical position.
27. Timeline tie-breaking is deterministic.
28. Temporal zoom representations are derived.
29. Historical significance projections are versioned derived state.
30. Historical jumps use read-side indexes.
31. Horizontal context projections store semantic relationships, not UI coordinates.
32. Moment depth read models do not become Moment authority.
33. Authorization projections support fast reads but may not be sufficient for all high-risk checks.
34. Privacy projection lag is security-sensitive.
35. Moderation projection lag is security/product-sensitive.
36. Search indexes are projections.
37. Material projection changes are versioned.
38. Side-by-side rebuild/cutover is preferred over destructive in-place migration.
39. Projection validation precedes reader cutover.
40. Rebuild is a first-class operational capability.
41. Rebuild uses authoritative sources.
42. Rebuild is throttled and observable.
43. Rebuild may run alongside live writes.
44. Rebuild must not resurrect erased data.
45. Rebuild must honor current privacy.
46. Rebuild must honor current moderation.
47. Derived-on-derived projection chains are minimized.
48. Projection configuration affecting semantics is versioned.
49. Derived algorithms preserve provenance where needed.
50. Projection freshness is observable.
51. Different projections may have different lag SLOs.
52. Poison events do not disappear silently.
53. Projection repair favors replay over manual row mutation.
54. Read-model schema migration preserves rollback where practical.
55. Client contracts do not expose raw datastore schemas.
56. DataLoaders are not projections.
57. Projection outputs preserve domain uncertainty.
58. Historical corrections propagate to all affected read models.
59. Deletion propagates explicitly to derived state.
60. Projection workers follow least-privilege credentials.
61. Projection read models minimize sensitive data.
62. Projection retention is deliberate.
63. Real PostgreSQL/ClickHouse integration tests are required.
64. Golden command→event→projection→query paths are tested.
65. A separate projection application is not created without operational justification.
66. Architecture documentation changes when projection ownership or guarantees change.

---

# Guiding Principle

When designing a projection, ask:

> **What exact query or read responsibility does this derived representation serve, what authoritative facts produce it, and can we rebuild it safely without changing or leaking the underlying truth?**

If those questions are unclear, the projection boundary is not yet well designed.
