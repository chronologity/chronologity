# Chronologity Scalability Architecture

## Purpose

This document defines the scalability architecture for Chronologity.

Chronologity must scale across very different workload classes:

- authoritative API commands;
- authentication and authorization;
- EventStoreDB aggregate streams;
- Kafka messaging;
- projection workers;
- PostgreSQL operational state;
- ClickHouse Timeline reads;
- feed-aggregator GraphQL;
- media upload and transcoding;
- notifications;
- Search and other derived systems;
- caches;
- observability.

The goal is not to maximize theoretical scale before product demand exists.

The goal is to preserve architectural boundaries that allow each workload to scale independently when pressure appears.

This document defines:

- scaling principles;
- horizontal versus vertical scaling;
- stateless application scaling;
- workload isolation;
- EventStoreDB scale;
- Kafka scale;
- PostgreSQL scale;
- ClickHouse scale;
- projection-worker scale;
- feed-aggregator scale;
- media scale;
- notification scale;
- cache scale;
- hot-key and contention avoidance;
- backpressure;
- rate limiting;
- capacity planning;
- multi-region considerations;
- sharding criteria;
- service extraction criteria;
- performance testing;
- and open architectural questions.

This document is grounded in:

- `docs/architecture/overview.md`;
- `docs/architecture/principles.md`;
- `docs/architecture/api.md`;
- `docs/architecture/cqrs.md`;
- `docs/architecture/event-sourcing.md`;
- `docs/architecture/events.md`;
- `docs/architecture/messaging.md`;
- `docs/architecture/projections.md`;
- `docs/architecture/data-storage.md`;
- `docs/architecture/timeline.md`;
- `docs/architecture/feed.md`;
- `docs/architecture/media.md`;
- `docs/architecture/notifications.md`;
- `docs/architecture/caching.md`;
- `docs/architecture/privacy.md`;
- `docs/architecture/security.md`;
- `docs/architecture/observability.md`.

---

# Core Principle

Scalability is achieved primarily through:

```text
clear ownership
+
bounded work
+
stateless compute
+
asynchronous decoupling
+
independent workload scaling
```

The governing rule is:

> **Chronologity should scale the workload that is actually constrained, rather than prematurely distributing every feature into separate services.**

---

# Scalability Is Not Microservices

A system does not become scalable merely because it has many services.

Premature service fragmentation introduces:

- network latency;
- distributed failure;
- operational burden;
- contract versioning;
- deployment complexity;
- more authentication/authorization boundaries;
- more tracing/debugging complexity.

Chronologity should extract deployment boundaries only when there is a real scaling, ownership, reliability, security, or technology reason.

---

# Current Application Boundaries

The canonical applications are:

```text
apps/api
apps/feed-aggregator
apps/mobile
apps/web
```

These boundaries already separate the two primary backend workload classes:

```text
authoritative writes / operational reads
        → apps/api

high-volume Timeline reads
        → apps/feed-aggregator
```

This is a strong starting point.

---

# Worker Processes

Additional workload isolation should initially occur through independently deployed worker processes rather than new applications.

Examples:

```text
API HTTP process
PostgreSQL projection worker
ClickHouse Timeline projection worker
media worker
notification worker
event publisher
```

These can share code ownership while scaling independently.

---

# Scale in Layers

Chronologity should scale in this order where practical:

```text
1. measure
2. optimize obvious inefficiencies
3. scale vertically
4. scale stateless instances horizontally
5. isolate workload pools
6. partition/replicate datastore workloads
7. shard only when necessary
8. extract services only when justified
```

Do not skip directly to sharding.

---

# Bounded Work

Every request/job must have bounded work.

Examples:

- bounded page sizes;
- bounded media-upload concurrency;
- bounded GraphQL complexity;
- bounded projection batches;
- bounded worker concurrency;
- bounded retries;
- bounded historical query ranges at one resolution.

Unlimited product concepts are implemented through repeated bounded operations.

---

# Stateless Compute

Backend HTTP services should be stateless.

State belongs in:

- EventStoreDB;
- PostgreSQL;
- ClickHouse;
- object storage;
- explicit cache infrastructure if introduced.

This allows ordinary horizontal scaling behind a load balancer.

---

# Sticky Sessions

Sticky sessions should not be required for:

- API;
- feed aggregator;
- projection consumers;
- media workers.

If a design requires sticky sessions, investigate whether hidden process-local state is leaking into architecture.

---

# Horizontal Scaling

Stateless services scale by increasing instance count.

Potential independently scalable workloads:

```text
API HTTP
feed aggregator
Kafka publishers
projection consumers
media processors
notification delivery workers
```

---

# Vertical Scaling

Vertical scaling is often simpler early.

Appropriate targets:

- PostgreSQL;
- ClickHouse;
- EventStoreDB;
- media workers;
- API instances.

Vertical scaling should be used where it provides sufficient headroom without architectural distortion.

---

# Workload Isolation

One workload must not starve another.

Examples:

```text
projection rebuild
    must not exhaust API PostgreSQL pool

media transcode spike
    must not consume API CPU

historical zoom query
    must not monopolize ClickHouse for normal Timeline slices
```

Isolation may use:

- separate processes;
- separate pools;
- queue priorities;
- workload-specific resource limits.

---

# API Scaling

`apps/api` should scale horizontally.

Primary constraints may include:

- EventStoreDB latency;
- PostgreSQL connections;
- authentication crypto;
- external provider calls;
- command contention.

The API should not be CPU-heavy under normal operation.

---

# API Connection Pooling

Each API instance uses bounded connection pools.

Total database connections must account for:

```text
instances × pool size
```

Increasing API replicas without controlling pools can overload PostgreSQL.

---

# API Backpressure

When downstream authoritative stores are saturated, API should:

- fail fast where appropriate;
- return controlled retryable errors;
- avoid unbounded request queueing.

---

# Command Throughput

Command throughput is primarily limited by:

- aggregate contention;
- authoritative datastore latency;
- synchronous validation/external dependencies.

Avoid synchronous external calls in command paths unless required.

---

# Aggregate Hotspots

Event-sourced aggregate design must avoid unnecessary shared streams.

Bad:

```text
all Moments in one stream
all Reactions for popular Moment in one mutable aggregate
all Users in one authorization stream
```

Good:

```text
independent aggregate streams
```

where invariants permit.

---

# Optimistic Concurrency Hotspots

A high concurrency-conflict rate indicates:

- aggregate too broad;
- command pattern too contentious;
- retry strategy too aggressive.

This should be measured.

---

# Reaction Scale

Reactions can be extremely high-volume.

If event sourced, use a partitionable aggregate model.

Do not serialize all Reactions for a popular Moment through one stream/version.

A relational authoritative model may ultimately be simpler if Event Sourcing adds no meaningful benefit.

---

# Comment Scale

Comments should avoid loading entire comment trees into one aggregate.

Use bounded/thread-specific ownership where possible.

---

# User Authorization Scale

Role assignments are low-volume.

Permission checks are high-volume.

Therefore:

```text
write path
    → authoritative UserAuthorization state

read path
    → efficient projected/cached effective permissions
```

This is a classic read/write asymmetry.

---

# EventStoreDB Scaling

EventStoreDB scale should preserve:

- per-stream ordering;
- expected-version semantics;
- subscription durability.

Scaling methods may include:

- stronger nodes;
- clustering;
- partitioning/sharding according to provider capabilities;
- stream-distribution strategies.

Exact topology belongs in infrastructure design.

---

# EventStoreDB Stream Distribution

Application-generated aggregate IDs should distribute naturally.

Avoid stream keys that create one physical hotspot by design.

---

# EventStoreDB Read Scale

Aggregate reconstruction reads are command-side and scoped.

Do not use EventStoreDB for broad Timeline queries.

This avoids unnecessary read-scaling pressure.

---

# EventStoreDB Snapshot Scale

Snapshots may reduce reconstruction cost for long-lived streams.

Use them only when measured stream replay latency warrants it.

---

# Kafka Scaling

Kafka scales primarily through:

```text
partitions
consumer groups
parallel consumers
```

Partition counts should support expected throughput without creating unnecessary operational overhead.

---

# Kafka Partitioning

Partition keys must preserve required ordering without creating hot partitions.

Examples:

```text
aggregateId
userId
momentId
```

A globally popular key can become a hotspot.

---

# Kafka Hot Partitions

Potential hot keys include:

- a viral Moment;
- one high-volume Real-World Event;
- one global routing key.

Avoid partition strategies that funnel unrelated traffic through those keys.

---

# Kafka Partition Count

Partition count should be chosen with headroom.

Increasing partitions later can affect ordering assumptions for key-distribution strategies.

Do not hard-code consumer logic to a fixed partition count.

---

# Kafka Consumer Scaling

A consumer group can scale up to available partitions.

If:

```text
consumer instances > partitions
```

extra instances sit idle.

Capacity planning must account for this.

---

# Consumer Isolation

Different workloads should use separate consumer groups.

Example:

```text
timeline projection
notification generation
Search indexing
```

A slow notification consumer must not hold back Timeline projection.

---

# Security-Critical Consumer Isolation

Authorization/privacy/moderation consumers may deserve separate resources because their lag has higher consequence.

---

# Kafka Backpressure

If consumers fall behind:

- lag increases;
- producers continue until retention/capacity limits.

Consumers should scale horizontally and control downstream write concurrency.

---

# PostgreSQL Scaling

PostgreSQL should scale conservatively.

Initial progression:

```text
schema/index optimization
connection pooling
vertical scaling
read replicas
partitioning
targeted denormalization
sharding only if necessary
```

---

# PostgreSQL Connection Scaling

Connection count is finite.

Use:

- bounded pools;
- possibly PgBouncer or provider pooling;
- separate pools for HTTP and workers.

---

# PostgreSQL Read Replicas

Read replicas may serve stale-tolerant operational reads.

They should not serve:

- critical role revocation;
- Session revocation checks;
- high-risk authorization state

if replica lag creates unsafe decisions.

---

# PostgreSQL Partitioning

Partition large tables when:

- retention management;
- query pruning;
- write scale

justify it.

Examples may eventually include:

- notifications;
- audit records;
- outbox;
- operational event tables.

Do not partition every table by default.

---

# PostgreSQL Sharding

Sharding should be introduced only when one PostgreSQL cluster cannot meet requirements with simpler techniques.

A sharding key must align with ownership and query patterns.

Potential candidates might be:

```text
userId
```

for some operational datasets.

But cross-User product relationships make premature user sharding risky.

---

# ClickHouse Scaling

ClickHouse is expected to handle the largest product read volume.

It is well suited to:

- distributed historical scans;
- denormalized Timeline reads;
- aggregation;
- high ingest throughput.

---

# ClickHouse Table Design Matters More Than Node Count

Before adding nodes, optimize:

- ORDER BY;
- partitioning;
- data skipping;
- projections/materialized views;
- selected columns;
- query shape.

Poor schema design scales poorly on a larger cluster too.

---

# ClickHouse Partitioning

Partitions should support:

- data lifecycle;
- pruning;
- operational manageability.

Time-based partitioning is likely useful for historical data, but exact design belongs in `docs/data/clickhouse.md`.

---

# ClickHouse Sort Keys

Sort keys should match Timeline access patterns.

Potential leading dimensions:

```text
scope
occurrenceTime
tie-breaker
```

Exact order depends on canonical query shapes.

---

# ClickHouse Sharding

ClickHouse can shard when single-node/replica sets no longer provide enough:

- storage;
- ingest;
- query throughput.

Shard keys must distribute load while preserving efficient Timeline queries.

---

# ClickHouse Replicas

Replicas support:

- availability;
- read scaling.

Feed-aggregator queries may use replicas according to provider/topology.

---

# ClickHouse Query Isolation

Expensive broad temporal zoom queries may need:

- separate workload settings;
- query limits;
- precomputed aggregates.

Do not let one extreme query degrade normal scrolling.

---

# Feed Aggregator Scaling

`apps/feed-aggregator` should be horizontally scalable and stateless.

Primary constraints:

- ClickHouse query latency;
- GraphQL composition;
- DataLoader fan-out;
- authorization filtering;
- cache performance.

---

# Feed GraphQL Cost Control

Scaling requires preventing one request from consuming unbounded work.

Use:

- complexity limits;
- max page sizes;
- timeouts;
- bounded nested pagination;
- persisted queries where useful.

---

# Feed Over-Fetch Scale

Viewer filtering may require candidate over-fetch.

Over-fetch must be bounded.

If many pages routinely require repeated scans to find eligible content, read-model eligibility should be redesigned.

---

# Timeline Slice Scale

Timeline scrolling should use:

- keyset cursors;
- bounded result sizes;
- indexed range scans.

Never use full-history materialization.

---

# Temporal Zoom Scale

Broad-scale navigation can touch huge time ranges.

Scale through:

- precomputed buckets;
- hierarchical aggregates;
- bounded resolution;
- historical-significance anchors.

---

# Historical Jump Scale

Jumps require indexed/direct resolution.

A jump should not scan from Timeline head to target.

---

# Horizontal Context Scale

Context adjacency should be precomputed or indexed where expensive.

Do not derive global contextual graphs inside each request.

---

# Projection Worker Scaling

Projection workers scale independently from API.

Potential constraints:

- Kafka partitions;
- target datastore throughput;
- batch size;
- transformation CPU.

---

# Projection Batch Size

Batching improves throughput but increases:

- latency;
- retry unit size;
- memory.

Batch sizes should be tuned per projection.

---

# Projection Parallelism

Parallelism must respect ordering requirements.

Example:

```text
same aggregate/order key
    → sequential within partition

different keys
    → parallel
```

---

# Projection Rebuild Scale

Large rebuilds can be expensive.

Use:

- throttling;
- dedicated worker pools;
- separate database pools;
- side-by-side target tables.

Rebuild should not starve live projection traffic.

---

# Projection Catch-Up

A new projection version should:

```text
replay historical source
    ↓
approach live position
    ↓
switch to live consumption
    ↓
validate convergence
```

---

# Media Upload Scale

Media bytes should bypass API HTTP servers.

Direct object-storage upload removes a major bandwidth bottleneck.

---

# Media Processing Scale

Image/video processing is compute-heavy and should scale independently.

Worker autoscaling may use:

- queue depth;
- oldest job age;
- CPU/GPU utilization.

---

# Video Transcoding Scale

Video transcoding is likely one of the most expensive workloads.

Potential approaches:

- managed transcoding service;
- autoscaled worker pool;
- GPU acceleration where justified.

Provider decision should consider cost per processed minute and operational burden.

---

# Unlimited Media Scale

Unlimited media membership means the architecture must handle very large Moments.

Do not:

- load all media at once;
- process all media in one transaction;
- render all media at once;
- send one giant GraphQL response.

Use pagination and workflow batching.

---

# Media Storage Scale

Object storage scales naturally.

Cost pressure likely comes from:

- originals;
- derivatives;
- video;
- CDN egress.

Lifecycle tiers may reduce cost later.

---

# CDN Scale

CDN absorbs media delivery load from origin.

Public immutable/versioned derivatives should have cache-friendly URLs.

Private content still requires controlled authorization.

---

# Notification Scale

Notification volume may grow rapidly from:

- Reactions;
- Comments;
- popular Moments.

Aggregation is a scaling mechanism as well as a UX mechanism.

---

# Notification Generation Scale

Notification generation should be asynchronous.

Kafka consumer groups scale generation workers independently.

---

# Notification Delivery Scale

Push/email delivery workers scale independently by:

- provider quotas;
- queue depth;
- delivery latency.

Provider throttling must create controlled backlog.

---

# Notification Storage Scale

If PostgreSQL is authoritative:

- keyset pagination;
- indexes by recipient/time;
- retention;
- partitioning when needed

should handle large histories.

---

# Search Scale

If PostgreSQL search becomes insufficient, introduce a dedicated derived Search engine.

Do not use Timeline ClickHouse schema as a substitute for Search unless query patterns truly align.

---

# Cache Scale

Caching should reduce repeated expensive reads.

Avoid using cache as a mandatory scalability crutch before base queries are efficient.

---

# Distributed Cache Scale

If Redis is introduced:

- use cluster/provider capabilities when needed;
- bound key cardinality;
- define eviction;
- avoid large per-Viewer response blobs.

---

# Cache Stampede at Scale

Hot historical contexts may attract many simultaneous requests.

Use:

- request coalescing;
- TTL jitter;
- stale-while-revalidate where safe.

---

# Rate Limiting at Scale

Rate limiting should happen as early as practical.

Potential layers:

```text
edge
API
feed aggregator
feature-specific limits
```

A distributed rate-limit store may be justified later.

---

# Backpressure

Backpressure is fundamental.

Every asynchronous subsystem needs a way to say:

```text
I am saturated
```

without exhausting the entire system.

---

# Queue Backpressure

Workers should bound:

- concurrent jobs;
- batch size;
- memory.

Lag is preferable to crash loops or datastore collapse.

---

# API Backpressure

The API may reject or throttle work when:

- EventStoreDB unavailable;
- database pool saturated;
- upload-registration abuse detected.

---

# Feed Backpressure

Feed should reject overly expensive queries rather than allowing uncontrolled ClickHouse scans.

---

# Provider Backpressure

When external providers throttle:

- queue work;
- retry with backoff;
- respect quotas.

Do not synchronously fan out retries from User requests.

---

# Admission Control

High-cost operations may require admission control.

Examples:

- projection rebuild;
- mass export;
- broad administrative reports.

These should not compete unconstrained with interactive traffic.

---

# Bulk Operations

Bulk operations should:

- paginate internally;
- checkpoint;
- resume;
- expose progress;
- use dedicated resource pools where appropriate.

---

# Capacity Planning

Capacity planning should use measured workload units.

Examples:

```text
commands/sec
Timeline queries/sec
ClickHouse rows scanned/sec
Kafka messages/sec
projection events/sec
media GB/day
video minutes/day
notification deliveries/sec
```

---

# Capacity Headroom

Production should maintain headroom for:

- traffic spikes;
- consumer catch-up;
- rolling deployments;
- node failure.

Running sustained at near-maximum capacity creates fragile systems.

---

# Growth Metrics

Track growth of:

- active Users;
- Moments;
- media items;
- video bytes;
- event streams;
- Kafka throughput;
- ClickHouse rows;
- notification rows;
- Search documents.

---

# Load Testing

Load tests should model realistic behavior.

Avoid synthetic tests that only hammer one endpoint uniformly.

Representative mixes should include:

- Timeline scroll;
- Moment depth;
- uploads;
- Reactions;
- Comments;
- notifications;
- historical jumps;
- temporal zoom.

---

# Historical Data Scale

Chronologity is unusual because data accumulates over time.

Scale planning must consider:

```text
total history grows continuously
```

even if daily active-user growth slows.

---

# Long-Tail History

Old data may be queried less often but must remain navigable.

Potential optimizations:

- colder storage tiers;
- ClickHouse partitioning;
- precomputed historical aggregates;
- CDN/media tiering.

---

# Hot Versus Cold History

Recent/popular contexts may be hot.

Deep historical regions are colder but larger.

The architecture may optimize them differently without changing Timeline semantics.

---

# Historical Backfill Scale

Large historical imports/backfills may create huge projection load.

Use:

- dedicated ingestion rate limits;
- backfill queues;
- separate worker pools;
- lower-priority processing.

Do not let a backfill delay security-critical live events.

---

# Priority Classes

Async work may need priority classes.

Example:

```text
highest:
privacy / moderation / authorization

high:
interactive Timeline projection

normal:
notifications

low:
historical backfill / derivative regeneration
```

The exact implementation should remain simple initially.

---

# Hot User Scale

Some Users may have huge follower/network graphs.

Avoid requiring synchronous fan-out to all followers on every write.

Prefer:

- pull/read-time eligibility;
- aggregated notification fan-out via queues;
- scalable relationship indexes.

---

# Fan-Out on Write Versus Read

Chronologity should generally avoid materializing personalized Timeline copies per User.

A shared historical projection plus read-time eligibility is more scalable and consistent with the Timeline model.

---

# Notification Fan-Out

Notification fan-out is different.

A User-specific notification is inherently recipient-specific.

Use asynchronous fan-out and aggregation.

---

# Social Graph Scale

Social relationships can become large.

PostgreSQL with proper indexing may be sufficient initially.

A graph database should not be introduced until query complexity proves necessary.

---

# Causality Scale

Causal relationships may form a graph.

Use purpose-built adjacency projections first.

A dedicated graph store should require demonstrated traversal needs.

---

# Historical Significance Scale

Significance computation can be separated from interactive reads.

Use:

- asynchronous recomputation;
- versioned snapshots;
- incremental updates where possible.

Interactive Timeline queries consume precomputed results.

---

# Computationally Heavy Derived Work

Heavy derived computations should not run inside:

- REST request handlers;
- GraphQL resolvers.

Use workers.

---

# Autoscaling

Autoscaling may apply to:

- API;
- feed aggregator;
- projection workers;
- media workers;
- notification workers.

Useful signals differ by workload.

---

# API Autoscaling Signals

Potential signals:

- CPU;
- request concurrency;
- p95 latency;
- event-loop utilization.

Do not autoscale only on CPU if the service is I/O-bound.

---

# Feed Autoscaling Signals

Potential signals:

- request concurrency;
- latency;
- event-loop utilization;
- ClickHouse dependency saturation.

Scaling feed instances cannot fix a saturated ClickHouse cluster.

---

# Worker Autoscaling Signals

Potential signals:

- queue depth;
- consumer lag;
- oldest message age;
- processing throughput.

These are often better than CPU alone.

---

# Database Scaling Signals

Scale datastores based on:

- latency;
- CPU;
- memory;
- I/O;
- storage;
- connection saturation;
- merge/compaction backlog;
- replication lag.

---

# Cost-Aware Scaling

Autoscaling should not create unbounded cost.

Use:

- min/max replicas;
- queue backpressure;
- cost dashboards;
- budget alerts.

---

# Multi-Region

Chronologity should not begin with active-active multi-region writes unless required.

This greatly complicates:

- EventStoreDB ordering;
- PostgreSQL authority;
- Session security;
- privacy revocation;
- conflict handling.

---

# Initial Regional Strategy

A simpler initial model is:

```text
single primary region
+
CDN/global edge
+
backups/disaster recovery
```

Feed/media delivery can still be globally accelerated.

---

# Multi-Region Read Replicas

Read-heavy systems such as ClickHouse may later support regional replicas.

Current privacy and authorization state must remain safe under replication lag.

---

# Multi-Region Writes

If future product scale requires active-active writes, this should be a dedicated architecture initiative.

Do not retrofit it informally.

---

# Data Locality

If data residency requirements arise, storage architecture may need regional partitioning.

This is separate from pure performance scaling.

---

# Service Extraction Criteria

A worker/subsystem should become a separate application/service when one or more of these become true:

1. it requires independent scaling with materially different resource shape;
2. it has a distinct availability requirement;
3. it needs different security isolation;
4. it needs a different runtime/language;
5. deployment coupling materially harms velocity/reliability;
6. ownership becomes independently staffed;
7. failure isolation cannot be achieved cleanly inside current application packaging.

---

# Service Extraction Non-Criteria

Do not extract because:

- a feature has many files;
- "microservices are scalable";
- a queue exists;
- another company uses that architecture.

---

# Projection Service Extraction

Projection workers may eventually become a dedicated application if:

- projection workload dominates API codebase;
- independent deployments are frequent;
- different runtime/resource tuning is needed.

Until then, separate worker processes are sufficient.

---

# Media Service Extraction

Media processing is a strong candidate for independent deployment.

It may eventually warrant its own application if:

- managed provider integration becomes complex;
- CPU/GPU scaling diverges sharply;
- security isolation demands it.

---

# Notification Service Extraction

Notifications likely do not need a separate application initially.

Kafka consumers and delivery workers can remain within API ownership.

---

# Authorization Service Extraction

Authorization should remain a module unless:

- many independent services require low-latency centralized policy;
- policy complexity grows significantly;
- independent availability/security requirements justify a service.

Avoid creating a network authorization dependency prematurely.

---

# Feed Aggregator Naming

`apps/feed-aggregator` is already an independently scalable read service.

Its current name may eventually be changed to `timeline-aggregator`, but naming does not affect scalability.

---

# Sharding Decision Rule

Before sharding any datastore, document:

1. current bottleneck;
2. measured saturation;
3. simpler alternatives attempted;
4. shard key;
5. cross-shard query impact;
6. rebalancing strategy;
7. failure model;
8. operational cost.

---

# Sharding Risks

Sharding adds:

- routing;
- rebalancing;
- cross-shard joins;
- partial failure;
- operational tooling;
- data movement complexity.

Treat it as a major architecture change.

---

# Hot-Shard Avoidance

Shard keys must distribute real workload.

A natural-looking key may still be hot.

Example:

```text
RealWorldEventId
```

could be disastrous during a globally popular event.

---

# Tenant Model

Chronologity is not currently architected as a multi-tenant SaaS product with isolated customer tenants.

Do not introduce tenant-based sharding assumptions.

---

# Performance Budgets

Each important request path should have a performance budget.

Potential categories:

- API authentication;
- command execution;
- Timeline head;
- Timeline slice;
- Moment depth;
- temporal zoom;
- historical jump;
- media startup.

Concrete values belong in performance/SLO docs.

---

# Query Budget

A query budget may include:

```text
max rows scanned
max duration
max memory
max page size
```

especially for ClickHouse.

---

# Memory Budget

Large Timeline/media responses should stream/paginate rather than accumulate huge in-memory objects.

---

# Payload Size

Response payload size should be monitored.

A correct query that returns 20 MB of JSON is not scalable mobile behavior.

---

# Compression

HTTP compression is appropriate for JSON/text responses.

Media uses media-specific compression/transcoding.

---

# Serialization Cost

Large GraphQL responses have CPU cost.

Avoid redundant fields and deeply nested repeated metadata.

---

# Mobile Network Scale

Scalability includes client bandwidth.

Use:

- previews;
- pagination;
- adaptive video;
- prefetch bounds;
- cached media.

Do not treat backend throughput as the only scale concern.

---

# Observability for Scale

Scaling decisions should be based on:

- p95/p99 latency;
- saturation;
- queue lag;
- error rate;
- cost;
- growth rate.

Do not scale based on intuition alone.

---

# Capacity Alerts

Alerts may include:

- database connection saturation;
- Kafka lag growth;
- projection backlog;
- media queue age;
- ClickHouse merge backlog;
- object-storage/CDN quota;
- provider quota.

---

# Saturation Versus Traffic

High traffic is not necessarily a problem.

Saturation is.

Metrics should distinguish:

```text
load
```

from:

```text
resource exhaustion
```

---

# Graceful Degradation

At high load, optional features may degrade before correctness.

Potentially degrade:

- significance enrichment;
- Reaction summaries;
- optional previews.

Do not degrade:

- authorization;
- privacy;
- moderation;
- chronology correctness.

---

# Load Shedding

Under extreme overload, reject lower-priority expensive work rather than allowing cascading failure.

Examples:

- temporary disable broad temporal zoom;
- throttle bulk export;
- slow historical backfill.

Interactive core reads/writes remain prioritized.

---

# Failure Domains

Architecture should understand failure domains:

```text
API
feed
Kafka
EventStoreDB
PostgreSQL
ClickHouse
media provider
notification provider
```

Independent scaling should also improve failure isolation.

---

# Cascading Failure Prevention

Use:

- timeouts;
- bounded retries;
- circuit breakers where justified;
- queueing;
- bulkheads/resource pools.

---

# Retry Storms

Retries can multiply load during outages.

Use:

- exponential backoff;
- jitter;
- bounded attempts;
- centralized queueing for async work.

---

# Thundering Herd After Recovery

When a datastore/provider recovers, thousands of retries may resume.

Use backoff/jitter and worker concurrency controls.

---

# Deployment Scaling

Rolling deployments should preserve capacity.

Do not reduce available replicas below safe levels during rollout.

---

# Version Skew

Horizontally scaled systems will temporarily run mixed versions.

Contracts must support rolling upgrades.

---

# Schema Migration Scale

Large migrations should avoid long table locks.

Use:

```text
expand
backfill
switch
contract
```

where possible.

---

# Backfill Tooling

Large backfills should be:

- resumable;
- checkpointed;
- throttled;
- observable.

---

# Scalability Testing

Testing should include:

## API load

- command throughput;
- auth overhead;
- connection saturation.

## Feed load

- Timeline scrolling;
- temporal zoom;
- historical jumps;
- GraphQL complexity.

## Kafka/projection

- peak ingest;
- consumer catch-up;
- duplicate delivery;
- worker scaling.

## PostgreSQL

- high notification volume;
- authorization reads;
- outbox growth.

## ClickHouse

- large historical datasets;
- dense and sparse ranges;
- concurrent Timeline queries.

## Media

- many uploads;
- large Moments;
- transcode backlog;
- CDN egress.

## Failure/recovery

- datastore outage;
- provider outage;
- consumer lag;
- rolling deploy;
- retry storm.

---

# Scale Test Data

Synthetic datasets should model:

- millions/billions of Moments over time;
- uneven popularity;
- hot Users;
- hot Locations;
- hot Real-World Events;
- large media collections;
- historical backfill.

Uniform random data can hide real hotspots.

---

# Day-One Scalability Requirements

Before launch, Chronologity must define and implement:

- stateless API/feed services;
- bounded request/page sizes;
- separate worker entry points;
- independent worker resource limits;
- database connection-pool limits;
- Kafka partition strategy;
- consumer-group isolation;
- projection backpressure;
- media queue backpressure;
- direct-to-object-storage uploads;
- keyset Timeline pagination;
- bounded temporal zoom;
- indexed historical jumps;
- GraphQL complexity limits;
- rate limiting;
- query timeouts;
- datastore saturation metrics;
- queue/lag metrics;
- load tests for critical paths;
- rollback/degradation strategies.

---

# Recommended Initial Scaling Model

```text
Load Balancer
    ├── apps/api replicas
    └── apps/feed-aggregator replicas

Kafka
    ├── projection consumer groups
    ├── media workers
    └── notification workers

EventStoreDB
    → authoritative event-sourced writes

PostgreSQL
    → relational authority + operational/read models

ClickHouse
    → Timeline/historical read scale

Object Storage + CDN
    → media scale
```

Scale each independently based on measured saturation.

---

# Open Architectural Questions

## Baseline Capacity

- What initial DAU/MAU assumptions should infrastructure target?
- Peak requests/sec?
- Moments/day?
- media GB/day?
- video minutes/day?

## EventStoreDB

- Single cluster topology?
- Provider?
- Expected event throughput?
- When are snapshots introduced?

## Kafka

- Initial partition counts?
- Topic-specific partitioning?
- Expected peak messages/sec?
- Which topics need separate high-priority capacity?

## PostgreSQL

- Which tables are expected to grow fastest?
- PgBouncer/provider pooling?
- Read replicas at launch?
- Partition notifications/audit from day one or later?

## ClickHouse

- Single node vs replicated cluster initially?
- Initial partition/sort keys?
- Distributed table design?
- When is sharding justified?

## Feed Aggregator

- Expected Timeline query rate?
- Maximum page size?
- Maximum over-fetch iterations?
- Cache strategy?

## Media

- Managed transcoding or worker fleet?
- Expected peak concurrent uploads?
- Worker autoscaling signals?
- CDN egress budget?

## Historical Backfill

- Is large-scale historical import expected before/after launch?
- Separate backfill pipeline?
- Priority isolation from live traffic?

## Multi-Region

- Is US-only initial hosting acceptable?
- Any latency/data-residency requirement that forces earlier regionalization?
- Recommended default: single primary region plus CDN/global edge.

## Service Extraction

- Which worker is most likely to become a separate app first?
- Likely media processing or projections.
- What measured threshold triggers extraction?

---

# Architectural Invariants

1. Scalability does not require premature microservices.
2. Workloads scale independently when they have distinct constraints.
3. Stateless compute is the default.
4. Sticky sessions are not required.
5. Product-level unlimited concepts use bounded technical operations.
6. Workload isolation prevents one subsystem from starving another.
7. API HTTP and workers may share code ownership while deploying independently.
8. Vertical scaling remains a valid early strategy.
9. Horizontal scaling follows measured need.
10. Database connection pools are bounded per process.
11. Adding service replicas must not accidentally exhaust PostgreSQL connections.
12. API command paths avoid unnecessary synchronous external dependencies.
13. Event-sourced aggregate design avoids hot shared streams.
14. Concurrency-conflict rates are monitored for aggregate hotspots.
15. EventStoreDB is not used for broad Timeline reads.
16. Kafka scales through partitions and consumer groups.
17. Kafka partition keys preserve required ordering without global serialization.
18. Consumer groups isolate independent workloads.
19. Security-critical consumers may receive dedicated resources.
20. PostgreSQL scales through optimization, pooling, vertical growth, replicas, and partitioning before sharding.
21. Security-critical reads do not use stale replicas when unsafe.
22. PostgreSQL sharding is a major, measured decision.
23. ClickHouse schema/query design precedes cluster expansion.
24. ClickHouse supports backfilled historical data.
25. Expensive temporal queries are isolated or precomputed.
26. Feed aggregator is horizontally scalable and stateless.
27. GraphQL work is bounded.
28. Timeline reads use keyset pagination.
29. Historical jumps use indexed resolution.
30. Projection workers scale separately from API traffic.
31. Projection rebuilds are throttled.
32. Rebuild traffic does not starve live projection traffic.
33. Media bytes bypass API servers.
34. Media processing scales independently.
35. Unlimited Moment media never requires one giant transaction or response.
36. Notification generation/delivery are asynchronous.
37. Notification aggregation reduces both noise and write volume.
38. Search remains a derived subsystem and may gain dedicated infrastructure only when needed.
39. Caching supplements efficient base queries rather than hiding poor design.
40. Backpressure is preferred to uncontrolled resource exhaustion.
41. Queue lag is preferable to crash loops.
42. Provider throttling creates bounded backlog rather than synchronous retry storms.
43. Capacity planning uses measured workload units.
44. Production maintains headroom for spikes, failure, and catch-up.
45. Historical data growth is a first-class scaling concern.
46. Backfills use isolated/throttled capacity.
47. Personalized Timeline copies are not materialized per User by default.
48. Heavy derived computation stays outside interactive request paths.
49. Autoscaling signals match workload type.
50. Autoscaling has cost bounds.
51. Initial architecture does not require active-active multi-region writes.
52. Multi-region writes require a dedicated architecture decision.
53. Service extraction requires a concrete scaling/availability/security/runtime/ownership reason.
54. Sharding requires documented bottleneck and shard strategy.
55. Shard keys are evaluated against real hotspot patterns.
56. Chronologity is not designed around tenant-based sharding.
57. Critical request paths have performance budgets.
58. Response payload size is monitored.
59. Mobile bandwidth is part of scalability.
60. Scaling decisions rely on saturation/latency/lag/cost metrics.
61. Optional enrichments may degrade before correctness.
62. Authorization/privacy/moderation do not degrade open under load.
63. Load shedding protects core interactive traffic.
64. Retries are bounded to avoid retry storms.
65. Rolling deployments preserve capacity.
66. Contracts tolerate temporary version skew.
67. Large migrations/backfills are resumable and observable.
68. Scale tests model hotspots and non-uniform data.
69. Architecture documentation changes when scaling boundaries or sharding decisions change.

---

# Guiding Principle

When Chronologity encounters a scaling problem, ask:

> **Which exact workload is saturated, what resource is constrained, and can we relieve that pressure by bounding work, optimizing access, adding capacity, or isolating the workload before introducing a more distributed architecture?**

The best scaling architecture is the simplest one that preserves correctness while giving the constrained workload an independent path to grow.
