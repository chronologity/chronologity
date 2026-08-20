# Chronologity Feed Architecture

## Purpose

This document defines the architecture of Chronologity's feed/read-composition layer.

Chronologity uses the repository/application name:

```text
apps/feed-aggregator
```

but the product is not built around a conventional algorithmically ranked social-media feed.

The feed aggregator exists to efficiently compose and serve the read models required by Chronologity's Timeline experience.

This document defines:

- the meaning of "feed" in Chronologity;
- the responsibilities of `apps/feed-aggregator`;
- the boundary between Timeline semantics and feed composition;
- GraphQL responsibilities;
- read-model access;
- batching and DataLoader usage;
- caching;
- Viewer-aware eligibility;
- pagination;
- composition;
- performance;
- failure behavior;
- observability;
- testing;
- and the limits of the feed layer.

This document is grounded in:

- the finalized product specifications;
- `docs/architecture/overview.md`;
- `docs/architecture/principles.md`;
- `docs/architecture/monorepo.md`;
- `docs/architecture/api.md`;
- `docs/architecture/events.md`;
- `docs/architecture/messaging.md`;
- `docs/architecture/projections.md`;
- `docs/architecture/data-storage.md`;
- `docs/architecture/timeline.md`.

---

# Core Principle

The feed aggregator is a **read-composition service**.

It does not decide historical truth.

It does not own Moments.

It does not rank history into a conventional engagement Feed.

Conceptually:

```text
authoritative domain state
        ↓
projections
        ↓
read stores
        ↓
feed aggregator
        ↓
GraphQL
        ↓
client
```

The governing rule is:

> **The feed layer composes already-derived, authorized historical read state into efficient client-facing Timeline responses without becoming a second source of truth.**

---

# What "Feed" Means in Chronologity

In this architecture, **feed** is primarily a technical term inherited by the application name.

It refers to the service that assembles Timeline-oriented read responses.

It does not imply:

- algorithmic ranking;
- engagement maximization;
- recommendation-first ordering;
- infinite newest-first social content;
- opaque curation;
- a separate authoritative Feed entity.

---

# Feed Versus Timeline

The Timeline defines historical navigation semantics.

The feed layer implements efficient read composition for those semantics.

Conceptually:

```text
Timeline
    → product/navigation model

Feed Aggregator
    → read-service implementation
```

The two should not be treated as competing product concepts.

---

# Application Boundary

The canonical application is:

```text
apps/feed-aggregator
```

It is:

- read-only with respect to domain authority;
- GraphQL-facing;
- optimized for Timeline reads;
- primarily backed by ClickHouse;
- independently scalable from the API;
- stateless apart from bounded caches/request state.

---

# Responsibilities

The feed aggregator may own read composition for:

- Timeline head;
- Timeline slices;
- Timeline around a Moment;
- Timeline around a time;
- horizontal context adjacency;
- Moment depth;
- temporal zoom;
- historical jumps;
- historical-significance read composition;
- causal navigation read composition;
- Viewer eligibility filtering;
- batched read enrichment;
- GraphQL cursor presentation;
- read-side caching.

---

# Non-Responsibilities

The feed aggregator must not own:

- Moment creation;
- Moment mutation;
- User mutation;
- authentication authority;
- role assignment;
- moderation decisions;
- privacy mutations;
- social-graph mutations;
- causal relationship acceptance;
- historical-significance authority;
- media processing;
- projection generation during requests;
- EventStoreDB aggregate reconstruction for ordinary reads.

Those responsibilities remain elsewhere.

---

# Read-Only Rule

The feed aggregator must not write authoritative state.

A GraphQL mutation surface should not be added merely because GraphQL supports mutations.

Chronologity's authoritative external command API remains in:

```text
apps/api
```

---

# GraphQL Role

GraphQL is appropriate for the feed aggregator because Timeline screens require composed read shapes.

A mobile screen may need:

- Moment;
- creator summary;
- preview media;
- Reaction summary;
- Location;
- Timeline cursors;
- neighboring context.

GraphQL allows the client to request coherent read shapes without exposing datastore details.

---

# GraphQL Is Not Domain API

The GraphQL schema represents read contracts.

It should not mirror:

- EventStoreDB aggregates;
- PostgreSQL tables;
- ClickHouse rows;
- internal Domain Events.

The schema should use product/read terminology.

---

# GraphQL Schema Ownership

`apps/feed-aggregator` owns the read GraphQL schema.

Shared client-facing generated types may be consumed by:

```text
apps/mobile
```

through the repository's chosen GraphQL code-generation strategy.

The schema itself should remain owned by the feed aggregator.

---

# Resolver Design

Resolvers should remain thin.

A resolver should generally:

1. validate/coerce GraphQL input;
2. resolve Viewer/request context;
3. call a query/composition function;
4. map result to GraphQL contract.

Resolvers should not contain:

- SQL;
- authorization algorithms;
- temporal aggregation algorithms;
- cache-key construction scattered inline;
- business mutation logic.

---

# Query Layer

The feed aggregator should have explicit query/composition modules.

Conceptual examples:

```text
get-timeline-head
get-timeline-slice
get-timeline-around-moment
get-timeline-around-time
get-horizontal-contexts
get-moment-depth
get-temporal-zoom
resolve-historical-jump
```

Exact filenames should follow the canonical monorepo tree.

---

# Read Stores

The primary feed datastore is:

```text
ClickHouse
```

Other read-only sources may be used when a query responsibility genuinely requires them.

However, cross-store fan-out should be minimized.

---

# ClickHouse Role

ClickHouse should contain enough denormalized read data to satisfy high-volume Timeline queries efficiently.

The feed aggregator should not compensate for an under-designed projection by issuing dozens of downstream calls.

---

# PostgreSQL Access

Direct PostgreSQL access from the feed aggregator should be limited and intentional.

Possible reasons may include:

- current Viewer eligibility;
- authorization state not appropriate for ClickHouse;
- small operational lookup.

If PostgreSQL becomes required for every Timeline item, the read model should be reconsidered.

---

# EventStoreDB Access

Normal feed queries must not read EventStoreDB.

EventStoreDB is command-side authoritative history, not the Timeline query engine.

---

# Object Storage Access

The feed aggregator should not fetch media bytes.

It may return media delivery metadata/authorized references from read models or a dedicated delivery mechanism.

---

# API-to-Feed Calls

The API should not synchronously call the feed aggregator as part of authoritative command handling.

Command success is determined by authoritative persistence.

Projection/feed convergence follows asynchronously.

---

# Feed-to-API Calls

The feed aggregator should avoid synchronous calls back into the API for each read.

This would recreate distributed joins and tightly couple availability.

Prefer projected read data.

---

# Viewer Context

Every request that can return Viewer-dependent content should resolve a canonical Viewer context.

Potential context includes:

```text
userId
authentication state
authorization/role summary where needed
request correlation/trace data
```

Sensitive authentication credentials must not propagate deeper than necessary.

---

# Anonymous Viewer

Public Timeline reads may support an anonymous Viewer.

Anonymous eligibility is not equivalent to bypassing authorization.

The system still applies:

- public visibility;
- moderation;
- deletion;
- Location/privacy rules.

---

# Authenticated Viewer

Authenticated reads may additionally apply:

- ownership;
- social relationships;
- blocking;
- private/network visibility;
- role-based capabilities.

---

# Viewer Context Is Request Scoped

Viewer-specific state should normally be request scoped.

Do not place one User's authorization context in shared process-global state.

---

# Eligibility

The feed aggregator returns only content the Viewer is currently eligible to see.

Eligibility may depend on:

- content visibility;
- User relationship;
- blocking;
- moderation;
- deletion;
- account state;
- Location privacy;
- role/authorization.

---

# Candidate Selection Versus Eligibility

A useful architecture distinction is:

```text
candidate selection
        ↓
eligibility filtering
        ↓
composition
```

ClickHouse may efficiently identify Timeline candidates.

Current Viewer-sensitive state may then remove ineligible items.

---

# Pushdown

Eligibility rules that are safe and stable may be pushed into ClickHouse queries.

Examples may include:

- deleted flag;
- moderation eligibility;
- public visibility.

Highly dynamic Viewer-specific rules may be evaluated separately.

---

# Security-Critical Eligibility

If projection lag can expose restricted content, the feed aggregator must perform a stronger current-state check.

Examples:

- recently blocked User;
- newly private content;
- moderation restriction;
- suspended account.

Performance optimization cannot override access correctness.

---

# Filtering Must Not Leak

When an item is ineligible, the feed response should not leak:

- title/caption;
- creator;
- timestamp;
- Location;
- media preview;
- Reaction counts;
- significance;
- causal metadata

unless product rules explicitly permit a tombstone representation.

---

# Pagination After Filtering

Viewer filtering complicates page size.

If ClickHouse returns 20 candidates and 8 are filtered out, the aggregator may need to fetch additional candidates to satisfy the requested page size.

This requires bounded over-fetching.

---

# Bounded Over-Fetching

The aggregator should use a controlled strategy:

```text
requested = 20
fetch candidate batch
filter
if insufficient:
    fetch next bounded batch
```

Do not scan unbounded history trying to fill one page.

---

# Sparse Eligible Results

If a Viewer has few eligible items in a range, returning fewer than the requested page size is valid.

The service should preserve a correct continuation cursor.

---

# Cursor Ownership

The feed aggregator owns client-facing Timeline cursor encoding/decoding.

Cursors should be:

- opaque;
- versioned internally;
- deterministic;
- tamper-resistant where necessary.

---

# Cursor Content

A cursor may encode:

```text
Timeline scope
occurrence time
tie-breaker
direction/anchor
projection/query version
```

The client must not depend on this internal structure.

---

# Cursor Versioning

Cursor format should have an internal version.

This permits future migration without exposing storage keys as API contract.

---

# Invalid Cursor

Malformed, unsupported, or incompatible cursors should produce a semantic GraphQL error.

Do not pass raw decoding/database errors to the client.

---

# Timeline Composition

A Timeline node should be composed from purpose-built read models.

It may include:

- Moment summary;
- creator summary;
- media preview;
- Location summary;
- Real-World Event context;
- Reaction summary;
- historical-significance metadata;
- navigation metadata.

The exact fields belong in GraphQL/data documentation.

---

# Composition Does Not Create Facts

If a creator display name is denormalized into a Timeline row, the feed aggregator is not deciding the User's name.

It is reading derived state.

Likewise for:

- Location labels;
- Reaction counts;
- significance;
- moderation eligibility.

---

# DataLoader

DataLoader-style batching is appropriate for repeated keyed reads.

Potential loaders:

```text
user-summary
location-summary
reaction-summary
real-world-event-summary
causal-links
authorization/eligibility
```

Exact loaders should match the canonical feed-aggregator tree.

---

# Request-Scoped Loaders

Loaders containing Viewer-sensitive results must be request scoped.

This prevents cross-Viewer cache leakage.

---

# Loader Batching

A loader should turn:

```text
N keyed reads
```

into:

```text
1 bounded batch read
```

where practical.

Batching should be observable.

---

# Loader Cache

DataLoader's per-request cache is acceptable.

It is not a replacement for shared caching.

It should not outlive the request when results are Viewer-dependent.

---

# Denormalization Versus DataLoader

Prefer denormalization for fields needed on nearly every Timeline item.

Prefer loaders for:

- optional/deep fields;
- reusable keyed metadata;
- highly dynamic state;
- fields too expensive or unsafe to duplicate broadly.

---

# N+1 Rule

A GraphQL field added to a Timeline node must be evaluated for N+1 behavior before acceptance.

A resolver that performs one remote query per Moment is not acceptable at Timeline scale.

---

# Moment Depth

Moment depth is a read composition, not a command-side aggregate load.

It may require richer data than a Timeline summary.

The feed aggregator should expose a purpose-built depth query.

---

# Unlimited Media in Depth

Because a Moment may contain unlimited media, the depth query must not attempt to return the entire media collection unconditionally.

Use a nested paginated connection or equivalent bounded representation.

---

# Comments in Depth

Comments may be loaded separately from core Moment depth if:

- volume is high;
- pagination differs;
- consistency differs;
- performance improves.

Do not force every depth request to materialize all Comments.

---

# Reactions in Depth

Reaction summaries may be included eagerly.

Large lists of reacting Users should be separately paginated.

---

# Causal Links in Depth

Causal relationships may be exposed as:

- bounded summary;
- paginated relationship connection;
- historical-jump targets.

The read response must preserve relationship provenance where required.

---

# Temporal Zoom Composition

Temporal zoom queries may return different GraphQL node types by scale.

Conceptually:

```text
Moment
TemporalBucket
HistoricalAnchor
RealWorldEventSummary
```

The schema should make these differences explicit rather than returning one ambiguous generic blob.

---

# Temporal Bucket

A temporal bucket may include:

- start/end;
- count/density;
- representative anchors;
- significance summary;
- drill-down cursor/context.

It remains derived.

---

# Broad-Scale Payload Size

Broad temporal zoom must not return thousands of individual Moments.

Return bounded abstractions appropriate to the scale.

---

# Historical Jumps

The feed aggregator resolves historical jump targets into current readable Timeline context.

It may accept a target such as:

```text
Moment ID
time
Real-World Event ID
Location ID
causal target
historical anchor
```

---

# Jump Resolution

A jump should return enough data to continue ordinary Timeline navigation.

Conceptually:

```text
resolved target
+
scope/context
+
surrounding slice
+
cursors
```

---

# Jump Failure

If the target is unavailable:

- do not leak restricted metadata;
- return a semantic unavailable/not-found result;
- optionally return safe surrounding context if product rules permit.

---

# Search Integration

Search may return entity IDs/targets.

The feed aggregator resolves a selected Search result into Timeline context.

Search ranking stops at entry-point selection.

Timeline chronology resumes after entry.

---

# Notification Integration

Notifications may link to Moment IDs.

The feed aggregator resolves the Moment under current visibility rules.

Old notification existence does not grant access.

---

# Historical Significance

The feed aggregator consumes historical-significance projections.

It may use them to:

- expose metadata;
- select broad-scale anchors;
- support jump destinations.

It must not compute authoritative significance inside GraphQL resolvers.

---

# Causality

The feed aggregator consumes causal read models.

It may expose causal links and jump destinations.

It does not accept or mutate causal relationships.

---

# Personalization

Chronologity may personalize **eligibility and context** without algorithmically reordering history.

Examples:

- hide blocked Users;
- include network-visible Moments;
- choose User-relevant Timeline scopes;
- preserve current navigation context.

This is distinct from engagement ranking.

---

# Recommendations

If recommendation/discovery capabilities are introduced, they should select:

```text
entry point
scope
historical destination
```

rather than silently reordering a Timeline.

The feed layer should keep this boundary explicit.

---

# Caching

Caching can improve repeated read performance.

Possible cache targets:

- public Timeline slices;
- temporal buckets;
- Location metadata;
- Real-World Event metadata;
- historical-significance summaries;
- GraphQL persisted-query results.

---

# Cache Key Requirements

Cache keys must include all dimensions that affect the response.

Potential dimensions:

```text
scope
anchor/cursor
scale
page size
Viewer eligibility class
schema/query version
```

Omitting a visibility dimension can create data leakage.

---

# Personalized Cache

Per-Viewer full-response caching should be used cautiously.

It may have:

- low hit rate;
- high cardinality;
- privacy risk;
- difficult invalidation.

Prefer caching shared authorization-neutral components.

---

# Public Cache

Public Timeline responses are more cacheable.

They still require invalidation for:

- deletion;
- moderation;
- privacy changes;
- corrections.

---

# Cache TTL

TTL should reflect:

- data volatility;
- privacy sensitivity;
- invalidation reliability.

Security-sensitive visibility must not rely solely on long TTL.

---

# Cache Invalidation

Potential invalidation signals include:

- Moment changed;
- Moment deleted;
- privacy changed;
- moderation changed;
- User profile changed;
- Location changed;
- significance recomputed.

Invalidation itself is derived behavior.

---

# Redis

Redis is not required merely because the feed aggregator has caching needs.

Start with:

- request-scoped DataLoader cache;
- process-local bounded cache where safe;
- CDN/edge caching for suitable public responses.

Introduce distributed cache only when measured requirements justify it.

---

# GraphQL Response Caching

Whole-response caching may be useful for public persisted queries.

It is harder for Viewer-dependent requests.

Do not cache GraphQL responses across Users without proving eligibility equivalence.

---

# Persisted Queries

Persisted GraphQL queries may improve:

- security;
- cacheability;
- observability;
- client/server contract control.

They are worth considering for production mobile traffic.

They are not required for initial implementation unless chosen in API standards.

---

# Query Complexity

GraphQL must enforce query-cost controls.

Limits may include:

- maximum depth;
- maximum connection page size;
- field weights;
- total complexity;
- timeout.

---

# Query Cost Versus Product Limits

A technical page-size limit does not mean a Timeline has a maximum number of Moments.

The client continues through pagination.

Likewise, unlimited media is implemented through bounded pages.

---

# Timeouts

Every feed query needs a bounded timeout.

The service should fail rather than consume resources indefinitely.

Different operations may have different budgets.

---

# Cancellation

If the client disconnects or request deadline expires, downstream work should be cancelled where supported.

This reduces wasted ClickHouse/loader work.

---

# Concurrency

Resolvers should not create unbounded parallelism.

Composition should use:

- batched reads;
- bounded concurrency;
- shared request loaders.

---

# ClickHouse Query Design

Queries should:

- use indexed/sort-key-compatible filters;
- use bounded ranges;
- use keyset anchors;
- avoid full scans;
- return only required columns;
- exploit precomputed aggregates where appropriate.

---

# Read Query Registry

Important ClickHouse queries should be named/owned rather than scattered raw SQL strings across resolvers.

This improves:

- testing;
- profiling;
- schema migration;
- observability.

---

# SQL Ownership

SQL belongs in datastore/query adapters.

Resolvers and GraphQL types should not contain SQL.

---

# Feed Aggregator Statelessness

The service should be horizontally scalable.

Durable state belongs in read stores.

Instance-local state should be disposable.

---

# Horizontal Scaling

Multiple feed-aggregator instances may serve requests concurrently.

No request should depend on reaching the same instance later.

Opaque cursors must contain/resolve sufficient state independently.

---

# Load Balancing

Ordinary stateless load balancing is appropriate.

Sticky sessions should not be required.

---

# Failure Isolation

A failure in:

- temporal zoom;
- significance enrichment;
- optional causal enrichment

should not necessarily take down every Timeline query.

The architecture may support graceful degradation for non-security-critical optional fields.

---

# Graceful Degradation

Potentially degradable data:

- Reaction summary;
- significance annotation;
- optional causal suggestions.

Non-degradable correctness data:

- visibility;
- deletion;
- moderation restriction;
- Timeline ordering identity.

---

# Partial GraphQL Errors

GraphQL supports partial responses.

Use partial errors carefully.

Never return restricted content merely because the authorization resolver failed.

For security-sensitive failures:

```text
fail closed
```

---

# ClickHouse Unavailable

If ClickHouse is unavailable, core Timeline reads cannot be served normally.

The service should return a controlled availability error.

Do not fall back to EventStoreDB reconstruction for ordinary traffic.

---

# Stale Projection

If projection lag exceeds safety thresholds:

- public freshness may degrade;
- security-sensitive data may require stronger filtering;
- operations should alert.

The feed service should expose enough telemetry to distinguish stale from empty.

---

# Read-Your-Write

Eventual projection means a newly created Moment may not immediately appear in the feed aggregator.

Possible UX strategy:

```text
API command response
+
client optimistic/confirmed local state
+
eventual Timeline convergence
```

The feed aggregator should not invent an uncommitted row.

---

# Correlation

Requests should carry trace/correlation context.

This supports diagnosis across:

```text
mobile
  ↓
feed aggregator
  ↓
ClickHouse / other read store
```

and comparison with upstream projection flow.

---

# Logging

Feed logs should include:

- request/trace ID;
- GraphQL operation name;
- Timeline scope type;
- query duration;
- ClickHouse duration;
- rows scanned/returned where available;
- loader batch counts;
- cache result;
- error classification.

Do not log sensitive GraphQL variables indiscriminately.

---

# Metrics

Important metrics include:

- requests/sec;
- p50/p95/p99 latency;
- GraphQL error rate;
- Timeline slice latency;
- Moment depth latency;
- temporal zoom latency;
- historical jump latency;
- ClickHouse query latency;
- rows scanned;
- DataLoader batch size;
- cache hit rate;
- eligibility-filter rate;
- over-fetch iterations;
- timeout rate.

---

# Tracing

Tracing should identify major composition stages.

Example:

```text
resolve timeline
  ├── decode cursor
  ├── query candidates
  ├── eligibility filter
  ├── batch enrich
  └── map GraphQL response
```

Avoid one opaque resolver span.

---

# Health

Health should distinguish:

```text
liveness
readiness
dependency health
```

The process may be alive while ClickHouse is unavailable.

In that state it should generally not advertise readiness for Timeline traffic.

---

# Rate Limiting

Read endpoints may require rate limiting to prevent abuse.

Limits should consider:

- authenticated User;
- IP/device where appropriate;
- GraphQL complexity;
- expensive operations.

Rate limiting must not be implemented as a hidden ranking mechanism.

---

# Abuse Protection

Potential abuse includes:

- deep expensive GraphQL queries;
- repeated historical scans;
- high-cardinality jump probing;
- unauthorized identifier enumeration.

Use:

- complexity limits;
- bounded page sizes;
- authorization;
- rate limits;
- opaque IDs/cursors where appropriate.

---

# ID Enumeration

Knowing a Moment ID must not grant access.

Every direct Moment-depth/jump lookup applies current eligibility.

---

# Schema Evolution

GraphQL schema changes should prefer additive evolution.

Deprecate fields before removal.

Mobile clients may remain deployed for long periods.

---

# Nullability

GraphQL nullability should represent actual guarantees.

Do not mark fields non-null merely for convenience if:

- historical data may be incomplete;
- privacy removes values;
- projection enrichment is optional.

---

# Historical Uncertainty

The GraphQL schema must preserve:

- approximate dates;
- ranges;
- uncertain Location/context

rather than forcing false precision.

---

# Media GraphQL Types

Media types should support pagination and heterogeneous media.

Potential union/interface semantics may represent:

```text
Image
Video
```

without imposing a total media-count limit.

---

# Timeline Item Types

At broad temporal scales, Timeline responses may need multiple item types.

Examples:

```text
Moment
TemporalBucket
HistoricalAnchor
RealWorldEventSummary
```

Use explicit GraphQL types/unions/interfaces rather than generic JSON.

---

# Feed Aggregator and API Client Package

`packages/api-client` is primarily the typed REST client for `apps/api`.

GraphQL client generation for `apps/feed-aggregator` should not be awkwardly forced into REST abstractions.

If shared GraphQL-generated code is needed, its canonical package/location should be decided explicitly.

---

# Mobile Boundary

The mobile app should treat the feed aggregator as the read API for Timeline experiences.

It should not:

- query ClickHouse directly;
- reconstruct Timeline semantics locally from raw API entities;
- know datastore sort keys.

---

# Web Boundary

The Gatsby marketing website should not depend on feed-aggregator internals unless a public Chronologity Timeline experience is explicitly added to the website.

---

# Administrative Functions

There is no separate admin application.

If consumer mobile screens expose role-authorized moderation/administrative reads, those read contracts may use:

- `apps/api` for operational/admin queries;
- `apps/feed-aggregator` only where Timeline read composition is genuinely needed.

Do not turn the feed aggregator into a generic admin backend.

---

# Feed Aggregator Security

The service should use least-privilege credentials.

It should generally have:

```text
ClickHouse read
limited PostgreSQL read if needed
cache read/write if introduced
```

It should not have:

```text
EventStoreDB append
PostgreSQL domain-write
object-storage administrative
Kafka producer
```

unless a future architecture decision explicitly requires them.

---

# Service Authentication

Internal access to feed aggregator may use service/gateway controls where appropriate.

End-User authentication context must still be verified/trusted through the canonical authentication architecture.

Do not trust arbitrary client-supplied User IDs.

---

# Authorization Code Ownership

The feed aggregator may execute read-side eligibility logic.

Canonical authorization policy definitions should remain aligned with the dedicated authorization domain/module.

Do not create an independent contradictory permission system inside GraphQL.

---

# Shared Authorization Contracts

Where API and feed aggregator require the same stable authorization vocabulary, place shared types/policy contracts in an appropriate shared package.

Do not share domain implementation code indiscriminately.

---

# Testing Strategy

## Resolver tests

Verify:

- input mapping;
- Viewer context;
- query delegation;
- GraphQL error mapping.

## Query/composition tests

Verify:

- chronological ordering;
- cursor behavior;
- eligibility;
- bounded over-fetch;
- enrichment;
- degradation.

## DataLoader tests

Verify:

- batching;
- request isolation;
- deduplication;
- error handling.

## ClickHouse integration tests

Use real ClickHouse for:

- ordering;
- keyset pagination;
- historical jumps;
- temporal aggregation;
- corrections;
- versioned rows.

## Authorization tests

Verify:

- anonymous;
- owner;
- follower/network;
- blocked;
- private;
- moderated;
- deleted;
- suspended.

## Cache tests

Verify:

- Viewer-safe keys;
- invalidation;
- no cross-User leakage.

## GraphQL contract tests

Verify:

- schema compatibility;
- nullability;
- unions/interfaces;
- cursor errors;
- complexity limits.

## Performance tests

Use realistic:

- Timeline sizes;
- dense historical ranges;
- large media collections;
- concurrent requests.

---

# Golden Feed Flow

A representative request:

```text
1. Mobile sends Timeline GraphQL query.

2. Feed aggregator authenticates/resolves Viewer context.

3. Resolver decodes Timeline cursor.

4. Timeline query adapter reads bounded candidates from ClickHouse.

5. Eligibility logic removes restricted candidates.

6. If needed, bounded over-fetch obtains additional candidates.

7. DataLoaders batch optional enrichment.

8. Aggregator constructs semantic Timeline nodes and opaque cursors.

9. GraphQL returns the response.

10. Mobile renders the Timeline without knowing storage details.
```

---

# Day-One Feed Requirements

Before launch, Chronologity must define and implement:

- GraphQL schema ownership;
- Viewer context;
- anonymous/authenticated read behavior;
- Timeline query modules;
- ClickHouse query adapters;
- Timeline head;
- bidirectional slices;
- around-Moment;
- around-time;
- horizontal context;
- Moment depth;
- unlimited-media pagination;
- temporal zoom;
- historical jumps;
- causal read navigation;
- significance read composition;
- opaque versioned cursors;
- DataLoader strategy;
- N+1 prevention;
- eligibility filtering;
- bounded over-fetch;
- privacy/blocking/moderation behavior;
- query complexity limits;
- page-size limits;
- timeouts;
- graceful degradation rules;
- logging;
- metrics;
- tracing;
- health/readiness;
- real ClickHouse integration tests;
- authorization tests;
- performance tests.

---

# Recommended Initial Feed Architecture

```text
apps/mobile
    ↓ GraphQL
apps/feed-aggregator
    ├── GraphQL schema/resolvers
    ├── Timeline query/composition layer
    ├── Viewer eligibility
    ├── request-scoped DataLoaders
    ├── ClickHouse read adapters
    └── bounded caches
          ↓
      ClickHouse
```

Optional current-state authorization reads may use a tightly scoped additional read source where required.

The service remains read-only.

---

# Open Architectural Questions

## Naming

- Should `apps/feed-aggregator` retain its canonical name?
- Or should it become `apps/timeline-aggregator` before implementation?
- The latter better describes its actual responsibility.
- A rename would require coordinated changes to the monorepo and documentation.

## GraphQL Package

- Where do generated GraphQL client types live?
- Inside `apps/mobile`?
- A new shared package?
- Should `packages/api-client` remain REST-only?

## Viewer Context

- How is User identity propagated from the mobile request?
- Does feed aggregator validate JWT directly?
- Does a gateway validate and pass trusted identity?
- How is anonymous context represented?

## Authorization

- Which rules can be evaluated from ClickHouse?
- Which require current PostgreSQL state?
- Is there an authorization snapshot/version token?
- How are blocks checked at scale?
- Which failures must fail closed?

## PostgreSQL

- Does feed aggregator need direct PostgreSQL access at launch?
- Recommended default: only if current-state eligibility cannot safely be served from read projections.
- Can all non-critical enrichment remain in ClickHouse?

## Caching

- Is process-local caching sufficient initially?
- Is CDN GraphQL caching useful for public Timeline queries?
- What measured condition would justify Redis?
- How are privacy invalidations propagated?

## GraphQL

- Exact schema naming?
- Connections versus custom slice types?
- Persisted queries at launch?
- Complexity calculation strategy?
- Maximum page sizes?

## Moment Depth

- Which fields are included in the initial depth query?
- Are Comments separate?
- Are Reactions separate?
- How is media connection paginated?

## Temporal Zoom

- Which GraphQL types represent broad-scale results?
- Are temporal buckets one type or scale-specific?
- How are anchors represented?

## Historical Jumps

- One generic `HistoricalJumpTarget` union?
- Separate query per target?
- How is return context represented?
- Can jumps cross Timeline scopes?

## Failure Degradation

- Which enrichments are optional?
- Should significance failures return null?
- Should Reaction summary failures return null?
- Causal read failure?
- Which fields are correctness-critical?

## Performance

- p95 latency targets for:
  - Timeline head;
  - slice;
  - Moment depth;
  - temporal zoom;
  - historical jump?
- Maximum ClickHouse rows scanned?
- Maximum over-fetch iterations?
- Maximum GraphQL complexity?

---

# Architectural Invariants

1. The feed aggregator is a read-composition service.
2. "Feed" does not imply algorithmic ranking.
3. Timeline semantics remain defined independently of the feed application's historical name.
4. The feed aggregator does not own domain truth.
5. The feed aggregator does not perform authoritative mutations.
6. The external command API remains `apps/api`.
7. GraphQL is a read contract, not a mirror of persistence schemas.
8. GraphQL resolvers remain thin.
9. SQL does not live in resolvers.
10. ClickHouse is the primary high-volume Timeline read store.
11. Normal feed queries do not read EventStoreDB.
12. Cross-store fan-out is minimized.
13. The feed aggregator does not fetch media bytes.
14. API command handling does not depend synchronously on feed convergence.
15. Feed queries avoid synchronous per-item API calls.
16. Viewer context is explicit and request scoped.
17. Anonymous reads still enforce eligibility.
18. Knowing an entity ID never grants access.
19. Candidate selection and Viewer eligibility are distinct.
20. Security-sensitive visibility may require stronger current-state checks.
21. Filtering does not leak restricted metadata.
22. Post-filter pagination uses bounded over-fetching.
23. Sparse eligible pages may return fewer items.
24. Client-facing cursors are opaque.
25. Cursor formats are internally versioned.
26. Invalid cursors do not expose internals.
27. Timeline composition uses purpose-built read models.
28. Composition never creates authoritative facts.
29. Viewer-sensitive DataLoaders are request scoped.
30. N+1 GraphQL behavior is prohibited.
31. Denormalization is preferred for universally needed Timeline fields.
32. Moment depth is a read composition.
33. Unlimited Moment media uses bounded pagination.
34. Large Comments/Reactions collections are separately paginated.
35. Temporal zoom returns scale-appropriate bounded abstractions.
36. Historical jumps resolve into current authorized Timeline context.
37. Search ranking only selects entry points; it does not reorder Timeline history.
38. Notifications do not grant persistent access.
39. Historical significance remains derived.
40. Causal relationships are consumed, not authored, by feed reads.
41. Personalization may alter eligibility/context without altering chronology.
42. Recommendation logic does not silently reorder Timeline chronology.
43. Cache keys include every response-affecting visibility dimension.
44. Personalized whole-response caching is used cautiously.
45. Security-sensitive invalidation does not depend solely on long TTLs.
46. Redis is not introduced without measured need.
47. GraphQL query cost is bounded.
48. Technical page-size bounds do not create product-total limits.
49. Requests have timeouts.
50. Downstream work uses bounded concurrency.
51. ClickHouse queries use bounded/index-compatible access patterns.
52. Important queries have explicit ownership.
53. Feed aggregator instances are stateless and horizontally scalable.
54. Sticky sessions are not required.
55. Optional enrichments may degrade; access correctness may not.
56. Authorization failures fail closed.
57. ClickHouse outage does not trigger EventStoreDB-as-feed fallback.
58. Feed projection lag does not change authoritative command success.
59. Logs avoid sensitive GraphQL payloads.
60. Metrics expose query, datastore, loader, filtering, and cache performance.
61. Health reflects dependency readiness.
62. Abuse protection covers GraphQL complexity and identifier probing.
63. GraphQL evolution accounts for long-lived mobile clients.
64. Nullability reflects historical and projection reality.
65. Historical uncertainty is preserved.
66. GraphQL types are explicit rather than generic JSON blobs.
67. Mobile does not know ClickHouse schema details.
68. No separate admin application is introduced through the feed layer.
69. Feed aggregator credentials follow least privilege.
70. Authorization policy does not fork into contradictory API/feed implementations.
71. Real ClickHouse integration tests are required.
72. Viewer eligibility and cache-isolation tests are required.
73. Performance tests use realistic historical scale.
74. Architecture documentation changes when feed/read boundaries intentionally change.

---

# Guiding Principle

When adding behavior to the feed aggregator, ask:

> **Is this behavior necessary to efficiently retrieve, authorize, compose, or present derived Timeline state—or are we accidentally moving domain authority, ranking policy, or write behavior into the read layer?**

If it is the latter, the behavior belongs somewhere else.
