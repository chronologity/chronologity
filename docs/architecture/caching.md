# Chronologity Caching Architecture

## Purpose

This document defines the caching architecture for Chronologity.

Caching exists to reduce repeated computation, datastore load, network latency, and media delivery cost.

Caching must never create a second source of truth.

Chronologity uses multiple cache classes with different semantics:

- request-local caches;
- process-local caches;
- shared/distributed caches;
- HTTP/GraphQL response caches;
- CDN caches;
- client/mobile caches.

Each class has different privacy, invalidation, consistency, and operational requirements.

This document defines:

- cache ownership;
- cache classes;
- cache-key design;
- Viewer-aware caching;
- TTL strategy;
- invalidation;
- authorization-sensitive caching;
- privacy and moderation revocation;
- Timeline caching;
- GraphQL caching;
- DataLoader/request caching;
- media/CDN caching;
- Redis decision criteria;
- failure behavior;
- observability;
- testing;
- and rules for introducing new caches.

This document is grounded in:

- `docs/architecture/overview.md`;
- `docs/architecture/principles.md`;
- `docs/architecture/api.md`;
- `docs/architecture/authorization.md`;
- `docs/architecture/projections.md`;
- `docs/architecture/data-storage.md`;
- `docs/architecture/timeline.md`;
- `docs/architecture/feed.md`;
- `docs/architecture/media.md`;
- `docs/architecture/notifications.md`.

---

# Core Principle

A cache is disposable.

The governing rule is:

```text
cache hit
    → faster answer

cache miss
    → same correct answer from authoritative/derived source
```

If the system cannot produce a correct answer without the cache, the thing is not merely a cache.

---

# Cache Is Not Authority

A cache must never become the sole owner of:

- Session truth;
- role assignments;
- Moment state;
- Timeline projection state;
- privacy state;
- moderation state;
- notification truth;
- media ownership;
- historical significance.

A cache may mirror current state for performance.

The authoritative owner remains elsewhere.

---

# Cache Classes

Chronologity recognizes the following cache classes:

```text
request-local
process-local
shared/distributed
response
CDN/edge
client/mobile
```

These should not be treated as interchangeable.

---

# Request-Local Cache

A request-local cache exists only for one request.

The canonical example is:

```text
DataLoader
```

in `apps/feed-aggregator`.

Request-local caching is ideal for:

- repeated User-summary lookups;
- Reaction-summary lookups;
- Location-summary lookups;
- moderation-visibility lookups;
- other repeated keyed reads inside one GraphQL request.

---

# Request-Local Lifetime

Request-local caches must be discarded after the request.

They are especially important for Viewer-sensitive data.

Never reuse one request's Viewer-specific authorization result in another request.

---

# Request-Local Authorization Safety

Example:

```text
User A requests Moment M
    → visibility result = allowed

User B requests Moment M
    → must evaluate independently
```

A shared DataLoader cache must never reuse User A's authorization decision for User B.

---

# Process-Local Cache

A process-local cache lives in memory inside one application instance.

Potential use cases:

- parsed configuration;
- stable public metadata;
- schema/permission registry;
- small read-through cache for low-volatility public data.

Process-local caches are:

- fast;
- simple;
- non-shared;
- lost on restart.

They must not require sticky sessions.

---

# Process-Local Cache Risks

Process-local caches can diverge across instances.

Therefore they are unsuitable for state that requires rapid global revocation unless TTL/invalidation semantics make divergence safe.

---

# Shared / Distributed Cache

A shared cache may be introduced when multiple application instances need common cached state.

Potential future technology:

```text
Redis
```

Redis is not currently required by default.

A distributed cache introduces:

- infrastructure;
- failure modes;
- serialization/versioning;
- connection management;
- privacy concerns;
- invalidation complexity.

It should solve a measured problem.

---

# Redis Decision Rule

Introduce Redis only when there is a concrete requirement such as:

- distributed authorization cache;
- rate limiting requiring shared state;
- revocation/session epoch cache;
- high-value shared Timeline/result cache;
- cross-instance short-lived coordination;
- temporary authentication artifacts where PostgreSQL is too heavy.

Do not introduce Redis simply because "web apps use Redis."

---

# Response Cache

A response cache stores an entire API/GraphQL response or a normalized response fragment.

This can be useful for:

- public Timeline slices;
- public temporal aggregates;
- public Real-World Event pages;
- low-volatility public metadata.

Response caching becomes harder for Viewer-dependent data.

---

# CDN / Edge Cache

CDN/edge caches are appropriate for:

- public media;
- public static website assets;
- selected public HTTP responses;
- image/video derivatives.

CDN cache behavior must remain consistent with privacy, moderation, deletion, and access revocation.

---

# Client / Mobile Cache

The mobile client may cache:

- Timeline pages;
- Moment detail;
- media;
- profile summaries;
- notifications;
- local optimistic command results.

Client caches are UX/performance state.

The server remains authoritative.

---

# Cache Ownership

Each cache must have one owning subsystem.

Examples:

```text
feed aggregator request cache
    → feed aggregator

media CDN cache
    → media delivery subsystem

mobile Timeline cache
    → mobile app
```

No cache should become an unowned global dumping ground.

---

# Cache Keys

Cache keys must encode all dimensions that affect the cached result.

A missing dimension can cause incorrect or private data leakage.

---

# Cache-Key Example

A Timeline cache key may need:

```text
timeline scope
scope ID
cursor/anchor
temporal scale
page size
Viewer eligibility class or Viewer ID
projection/query version
```

Exact key design should be explicit and tested.

---

# Viewer-Specific Cache Keys

If a response depends on a specific Viewer:

```text
Viewer ID
```

or a safe equivalent authorization state/version may need to participate in the key.

Per-Viewer caching has high cardinality and should be used cautiously.

---

# Authorization Class Caching

Some responses may depend only on an authorization class rather than individual User.

Examples:

```text
anonymous
public authenticated
moderator within case context
```

This can improve cache reuse.

However, role class alone is insufficient when blocking, ownership, or social relationship affects eligibility.

---

# Public Cache Keys

Public cache keys should never accidentally reuse data from authenticated personalized responses.

Keep public and personalized namespaces separate.

---

# Stable Key Encoding

Cache keys should use a canonical encoding.

Avoid ad hoc string concatenation scattered through code.

Central key builders improve:

- consistency;
- versioning;
- invalidation;
- testing.

---

# Cache-Key Versioning

Cache key formats should be versionable.

Example:

```text
timeline:v2:...
```

When response semantics change materially, a new key version avoids stale incompatible entries.

---

# TTL

Every non-request cache should have an explicit TTL unless invalidation guarantees make permanent caching safe.

TTL is a safety mechanism.

It is not a substitute for invalidation when security/privacy changes matter.

---

# TTL Categories

A useful conceptual model:

```text
very short
    → security-sensitive

short
    → personalized dynamic data

moderate
    → public Timeline/read data

long
    → stable public metadata

immutable/content-addressed
    → media/static assets
```

Exact durations belong in implementation/operations docs.

---

# Security-Sensitive TTL

Authorization, blocking, suspension, and privacy caches require tight bounds.

A role removal must not remain effective only after a multi-hour cache expires.

---

# Invalidation

Invalidation should be event-driven where possible for state whose changes must propagate quickly.

Potential invalidation triggers:

- Moment changed;
- Moment deleted;
- visibility changed;
- User blocked/unblocked;
- role assigned/removed;
- content restricted/restored;
- User profile changed;
- Location changed;
- media deleted;
- significance projection changed.

---

# Invalidation Is Derived

An invalidation signal changes cache state.

It does not change domain truth.

The authoritative state change already happened elsewhere.

---

# Event-Driven Invalidation

A typical flow:

```text
UserRoleRemoved
    ↓
Integration Event
    ↓
authorization cache invalidation
```

or:

```text
MomentVisibilityChanged
    ↓
Timeline cache invalidation
```

---

# Cache Invalidation Reliability

Invalidation may fail.

Therefore sensitive caches also require:

- bounded TTL;
- version/epoch checks;
- fail-closed current-state checks where consequence is high.

Do not rely on invalidation alone for security.

---

# Cache Version / Epoch

A useful technique for mutable authorization is to include:

```text
authorizationVersion
privacyVersion
```

in cache keys.

When the version changes, old entries become unreachable.

This can reduce the need for deleting every old cache entry immediately.

---

# Authorization Cache

Authorization caching may store:

- User roles;
- effective permissions;
- Session/authorization epoch;
- policy-neutral current state.

It should not cache final resource access decisions too broadly unless the full resource/context dimensions are included.

---

# Resource Authorization Cache

Caching:

```text
Can User A view Moment M?
```

may be useful in a request or short-lived context.

But the cache key must account for:

- User;
- Moment;
- current visibility version;
- block state;
- moderation state;
- role/purpose.

In many cases, recomputing from efficient read models is safer.

---

# Role Cache

Role/permission lookups are good distributed-cache candidates if:

- role changes are infrequent;
- permission checks are frequent;
- invalidation/epoch semantics are strong.

High-risk administrative actions may still consult the authoritative/current store.

---

# Session Cache

Authentication architecture may use short-lived Session/revocation caching.

The cache must not allow revoked Sessions to remain valid indefinitely.

Exact Session cache semantics belong in authentication/security implementation.

---

# Blocking Cache

Blocking relationships are dynamic privacy state.

A stale block cache can leak content or interaction.

Use short TTL/current read models or explicit invalidation.

---

# Timeline Cache

Timeline caching should focus on expensive, repeated read shapes.

Potential cacheable units:

- public Timeline head;
- public Timeline slice;
- temporal bucket;
- historical-significance anchor set;
- horizontal context metadata.

---

# Personalized Timeline Caching

Per-Viewer Timeline caching is less attractive because:

- eligibility varies;
- blocking varies;
- social relationships vary;
- cache cardinality grows;
- invalidation becomes difficult.

**And there is no shared layer beneath it to cache instead.** Eligibility is
applied inside the ClickHouse statement, before the limit — filtered in the
`WHERE` for a place's or an occasion's history, and reported as a column for
somebody's own — so there is no point at which rows exist that have not yet been
narrowed to this reader (ADR-141). The answer to an expensive Timeline read is a
narrower statement or a better data layout, not a cache of something that does
not exist.

---

# Candidate Cache

There is none.

The feed aggregator produces no candidate set. Eligibility is a predicate inside
the statement rather than a filter over its result, so there is nothing between
"these rows exist" and "these rows this reader may see" for a cache to hold.

This section previously described caching authorization-neutral Timeline
candidate sets and applying Viewer filtering afterwards. That architecture was
not built, and filtering a finished page is the specific thing the design avoids:
asking for twenty and receiving four says sixteen exist (ADR-141).

---

# Timeline Cursor Caching

Opaque cursor decoding itself may be cheap and need no cache.

If cursor resolution requires expensive state, cache only stable internal resolution data.

Do not let cached cursor state require sticky sessions.

---

# Temporal Zoom Cache

Broad-scale temporal aggregates are good cache candidates because they:

- are expensive;
- change less frequently than individual Timeline pages;
- may be public/shared.

They still require invalidation after:

- historical backfill;
- correction;
- deletion;
- significance recomputation.

---

# Historical Jump Cache

Jump resolution may cache:

- Moment → Timeline anchor;
- Real-World Event → historical range;
- Location → context.

The cached mapping must remain valid after corrections/deletion.

---

# Historical Significance Cache

Significance results are already derived projections.

Caching may improve repeated read access.

The cache key should include:

```text
algorithm/projection version
context
entity
```

---

# Feed Aggregator Request Cache

Request-scoped DataLoaders remain the first caching layer for GraphQL.

They prevent duplicate reads without introducing cross-request privacy risk.

---

# Feed Aggregator Process Cache

Process-local cache can be used for:

- stable public metadata;
- parsed cursor/query configuration;
- immutable schema state.

Avoid process-local Viewer eligibility caches unless TTL and invalidation are extremely conservative.

---

# GraphQL Response Caching

Whole-response caching should be limited initially.

Good candidates:

- anonymous/public persisted queries;
- stable temporal overview;
- public Real-World Event Timeline slices.

Poor candidates:

- deeply personalized network Timeline;
- Viewer-specific blocking;
- moderation case reads;
- private Moment depth.

---

# Persisted Queries and Caching

Persisted GraphQL queries can improve cache-key stability.

A response cache key may include:

```text
query ID
variables hash
Viewer cache class
schema version
```

---

# HTTP Cache Headers

Public endpoints may use:

- `Cache-Control`;
- ETag;
- stale-while-revalidate where safe.

Private/authenticated responses should use conservative caching headers.

Exact policy belongs in API/edge implementation.

---

# ETag

ETag may be useful for:

- stable public metadata;
- profile-like resources;
- API operational queries.

It is less useful for constantly changing personalized Timeline pages.

---

# Stale-While-Revalidate

Stale-while-revalidate can improve perceived latency for public non-sensitive content.

Do not use it for privacy/security-sensitive content where stale exposure is unacceptable.

---

# Cache Stampede

Popular cache entries may expire simultaneously.

Use techniques such as:

- single-flight/request coalescing;
- jittered TTL;
- stale-while-revalidate;
- background refresh.

Do not let one hot Timeline context overwhelm ClickHouse after expiration.

---

# Request Coalescing

If multiple concurrent requests need the same public uncached item, one process may perform the read while others await the same result.

This is useful for hot public metadata.

---

# Negative Caching

Caching "not found" can reduce repeated expensive misses.

Use very short TTL and caution because:

- content may be backfilled;
- projections may lag;
- permissions may change.

Never negative-cache a security decision broadly.

---

# Projection Lag and Cache

A cache may outlive the projection state it mirrors.

The combined freshness is:

```text
authoritative → projection lag → cache age
```

Operations should understand both components.

---

# Cache Freshness Metadata

Internally useful fields may include:

- cachedAt;
- source projection version;
- source updatedAt;
- TTL.

Clients generally should not need raw cache metadata.

---

# Privacy Invalidation

Privacy changes are high priority.

Example:

```text
Moment public
    ↓
cached public Timeline slice
    ↓
Moment becomes private
```

The system must:

- invalidate affected shared cache;
- ensure Viewer filtering reflects current privacy;
- rely on bounded TTL as fallback.

---

# Moderation Invalidation

Content restriction/restoration should invalidate:

- Timeline caches;
- Search caches;
- media delivery caches where relevant;
- public response caches.

Restriction should propagate more urgently than restoration.

---

# Blocking Invalidation

Blocking affects Viewer-specific eligibility.

If per-Viewer cached responses exist, block/unblock may require:

- key-version change;
- targeted invalidation;
- short TTL.

This is another reason to avoid extensive per-Viewer full-response caching.

---

# Role Invalidation

Role changes should invalidate:

- authorization caches;
- admin UI capability caches;
- any privileged read response caches.

High-risk commands may bypass caches.

---

# User Profile Invalidation

Profile changes may invalidate denormalized presentation caches.

This is less security-sensitive than privacy changes but still affects correctness.

---

# Media CDN Caching

Media delivery benefits heavily from CDN caching.

Public derivatives can have long TTLs when object keys are content/version specific.

Private media needs revocable access semantics.

---

# Versioned Media URLs

A derivative may use a versioned or content-addressed path:

```text
media/<id>/v3/thumbnail.webp
```

A new derivative version creates a new cache key naturally.

---

# Signed Media URLs

Signed media URLs should expire.

The CDN may cache the underlying object while access control remains enforced by signature/cookie semantics.

Exact CDN design depends on provider capability.

---

# Private CDN Caching

Private content may still be edge-cached if the CDN supports secure authorization.

The architecture must prevent one User's signed private URL from becoming public reusable access.

---

# Media Deletion Cache

Deletion may require:

- object delete;
- CDN purge;
- URL expiration;
- version tombstone.

The media architecture owns the exact sequence.

---

# Mobile Media Cache

Mobile media cache is device-local.

It should be treated as disposable.

Logout/account switching may require clearing private cached media according to client security policy.

---

# Mobile Timeline Cache

Mobile may cache Timeline pages for smooth scrolling and back navigation.

The client should reconcile with server state.

Cached content that becomes restricted should disappear after refresh/revalidation.

---

# Offline Cache

Offline display is possible only if product semantics permit it.

Private cached content may remain on device while offline, which has privacy implications.

Explicit offline support requires dedicated product/security decisions.

---

# Notification Cache

The mobile client may cache notification pages/unread count.

Server notification state remains authoritative.

Push receipt can trigger cache invalidation/refresh.

---

# Cache Serialization

Shared/distributed cache values need explicit serialization/versioning.

Do not store arbitrary class instances.

Prefer stable JSON or compact schema-defined structures.

---

# Cache Value Versioning

A cache value should include or imply a schema version where structure may change.

A deployment should not crash reading stale old-format cache entries.

---

# Cache Compression

Large cache values may be compressed if measured benefit justifies CPU cost.

Do not cache enormous Timeline responses merely because compression exists.

---

# Cache Size Limits

Every shared/process cache should have bounded memory/storage.

Eviction policy must be explicit.

A cache cannot grow without limit.

---

# LRU / Eviction

Process-local caches may use LRU-like eviction.

Distributed caches may use provider eviction policies.

Critical correctness must not depend on any entry surviving eviction.

---

# Cache Warming

Cache warming may be useful for:

- popular public Timelines;
- broad temporal aggregates;
- historical anchors.

Warming is optional optimization.

The system must still function cold.

---

# Cold Start

Application instances should be healthy with empty caches.

Cold-cache performance should be measured.

---

# Cache Failure

If cache infrastructure is unavailable:

```text
fallback to source
```

where load remains safe.

A cache outage should not automatically become a full application outage unless the source cannot sustain fallback load.

---

# Cache Circuit Breaker

If a shared cache is failing repeatedly, bypassing it may be safer than blocking every request.

This requires bounded fallback load.

---

# Redis Outage

If Redis is introduced later:

- API/feed should degrade to underlying read stores where possible;
- authorization/security semantics must remain correct;
- rate limiting may need fail-open or fail-closed policy depending on endpoint.

These policies must be explicit.

---

# Rate Limiting Cache

Distributed rate limiting may use Redis or another shared store.

Rate-limit state is operational.

It is not User/domain authority.

---

# Idempotency Cache

Idempotency records should generally be durable in PostgreSQL rather than a cache if losing them can duplicate an important command.

Do not place correctness-critical idempotency solely in volatile cache.

---

# Temporary Auth Artifacts

Magic-link/verification artifacts may use a TTL store.

If a distributed cache is used, expiry semantics must be reliable.

PostgreSQL remains a valid initial choice.

---

# Caching Reads, Not Decisions

Caching primarily accelerates reads.

Caching on a write path should be conservative.

Never use a stale cache as the only source for a domain invariant.

---

# Caching on a Write Path

A write may use cached non-authoritative reference data.

But a state transition is guarded by a conditional update against the authoritative row, so the decision is made by the database at the moment of writing rather than from anything cached. There is nothing to cache that would make that safer.

---

# Cache and Projections

A cache may sit after a projection.

Typical chain:

```text
authoritative
    ↓
projection
    ↓
read model
    ↓
cache
```

A cache should not become an additional projection layer with undocumented transformation semantics.

---

# Cache and Search

Search results may be cached if:

- query is public/shared;
- index freshness expectations permit.

Search privacy filters remain authoritative read behavior.

---

# Cache and Historical Significance

Significance calculations should be stored as projections, then cached if needed.

Do not use cache as the only storage of expensive significance computation if rebuild/reuse matters.

---

# Cache and Causality

Causal adjacency may be cached as a read acceleration.

The underlying authoritative/derived causal read model remains canonical.

---

# Cache Observability

Metrics should include:

- hit rate;
- miss rate;
- latency;
- error rate;
- eviction rate;
- memory usage;
- key count;
- stale/age distribution where measurable;
- invalidation rate;
- invalidation failures;
- fallback load;
- stampede events.

---

# Cache Metrics by Class

Do not combine all caches into one metric.

Track:

```text
request cache
Timeline cache
authorization cache
media CDN
client cache where measurable
```

separately.

---

# Cache Logging

Avoid logging full cache values.

Useful fields:

- cache name;
- key hash or safe key components;
- hit/miss;
- latency;
- invalidation cause.

Do not log sensitive Viewer IDs unnecessarily.

---

# Cache Tracing

Important cache operations should appear in traces where they affect latency.

Example:

```text
Timeline request
    ├── response cache miss
    ├── ClickHouse query
    └── cache populate
```

---

# Invalidation Observability

Security-sensitive invalidation must be observable.

Metrics/alerts may cover:

- role invalidation failure;
- privacy invalidation failure;
- moderation invalidation backlog;
- CDN purge failure.

---

# Cache Consistency Testing

Tests should verify that cached and uncached paths return semantically equivalent results.

---

# Authorization Cache Tests

Verify:

- role removal;
- block;
- privacy change;
- suspension;
- moderator permission revocation;
- Viewer isolation.

---

# Timeline Cache Tests

Verify:

- key dimensions;
- public/personal separation;
- backfilled Moment invalidation;
- correction;
- deletion;
- scale change;
- cursor/version behavior.

---

# Media Cache Tests

Verify:

- signed URL expiry;
- private access;
- deletion;
- moderation restriction;
- derivative version change.

---

# Stampede Tests

Load tests should verify popular-key expiry does not create uncontrolled backend load.

---

# Failure Tests

Simulate:

- cache unavailable;
- timeout;
- stale entry;
- invalid serialized value;
- invalidation failure.

The system should recover without corrupting authority.

---

# Day-One Caching Requirements

Before launch, Chronologity must define:

- request-local DataLoader caching;
- Viewer-isolation rules;
- process-local cache use cases;
- Timeline cache policy;
- GraphQL response-cache policy;
- cache-key builders;
- cache-key versioning;
- TTL categories;
- privacy/moderation invalidation;
- role/block invalidation;
- CDN/media cache behavior;
- mobile cache reconciliation;
- cache observability;
- cache failure fallback;
- cache tests.

Redis/distributed caching is **not** a day-one requirement unless implementation/performance measurements establish a concrete need.

---

# Recommended Initial Architecture

```text
apps/feed-aggregator
    ├── request-local DataLoader cache
    ├── optional small process-local public metadata cache
    └── optional public Timeline response cache
          ↓
      ClickHouse

apps/api
    └── minimal process/request caches only where safe
          ↓
  authoritative/read stores

media
    ↓
CDN edge cache

apps/mobile
    ↓
device-local query/media cache
```

No distributed cache is required initially.

---

# Open Architectural Questions

## Redis

- Is Redis required at launch?
- Recommended default: no.
- What measured problem would justify it first?
- Authorization lookup?
- rate limiting?
- shared public Timeline cache?
- Session revocation?

## Timeline Cache

- Which public Timeline queries are cacheable?
- Full GraphQL response or lower-level query fragments?
- What TTL?
- What invalidation event set?
- How are backfilled Moments handled?

## Authorization Cache

- Are current roles stored in PostgreSQL only?
- Is a process-local short TTL sufficient?
- Do we need authorization versions/epochs?
- Which high-risk actions always bypass cache?

## Blocking

- Is block state query-time from PostgreSQL/read model?
- Any cache?
- Required revocation latency?

## GraphQL

- Are persisted queries used?
- Does edge/HTTP response caching apply to anonymous Timeline queries?
- How is `Vary`/Viewer context represented safely?

## CDN

- Which provider?
- How are private assets cached?
- What purge API/latency?
- What URL-version strategy?

## Mobile

- Which client query-cache library?
- How long are Timeline pages retained?
- What gets cleared on logout?
- How is stale private content reconciled?

## TTLs

- What concrete TTLs apply per cache class?
- These should be operational constants/config, not domain rules.

## Failure Policy

- If shared cache is unavailable, which systems bypass it?
- Which rate-limited security endpoints fail closed?
- What maximum source-load fallback is safe?

---

# Architectural Invariants

1. Caches are disposable.
2. Correctness does not depend on a cache hit.
3. Cache state is never domain authority.
4. Request-local caches are discarded after the request.
5. Viewer-sensitive DataLoaders are request scoped.
6. Process-local caches do not require sticky sessions.
7. Process-local caches may diverge across instances.
8. Shared caching is introduced only for a concrete need.
9. Redis is optional, not assumed.
10. Response caching is easiest for public/authorization-neutral reads. The feed
    aggregator has none of either: reading history requires an account (ADR-139)
    and eligibility is inside every statement (ADR-141).
11. Personalized full-response caching is used cautiously.
12. CDN caches are delivery optimization, not media authority.
13. Mobile caches are UX state, not authority.
14. Every cache has an owner.
15. Cache keys include all response-affecting dimensions.
16. Public and personalized cache namespaces remain separate.
17. Cache-key formats are versionable.
18. Non-request caches have explicit TTL/invalidation semantics.
19. Security-sensitive caches use tight staleness bounds.
20. Invalidation is derived behavior.
21. Invalidation failure is assumed possible.
22. Security cannot rely on invalidation alone.
23. Version/epoch keys may be used for rapid logical invalidation.
24. Authorization caches do not replace authoritative/current checks for high-risk actions.
25. Broad resource-access decisions are not cached without full context.
26. Blocking cache staleness is privacy-sensitive.
27. Timeline caches have no shared authorization-neutral layer to prioritise. A
    Timeline read is Viewer-dependent to its innermost predicate (ADR-147).
28. Per-Viewer Timeline cache cardinality is minimized.
29. Temporal aggregates are strong cache candidates.
30. Historical jump caches must honor corrections/deletion.
31. Historical significance cache keys include algorithm/projection version.
32. Request-local DataLoader cache is the default GraphQL caching layer.
33. Whole GraphQL response caching is limited initially.
34. Stale-while-revalidate is not used where stale access is unsafe.
35. Popular-key expiry must not cause cache stampede.
36. Negative caching is short-lived and conservative.
37. Combined projection lag + cache age determines read freshness.
38. Privacy invalidation is high priority.
39. Moderation invalidation is high priority.
40. Role invalidation removes privileged cache access quickly.
41. Viewer-specific block changes do not rely on long TTLs.
42. Media delivery caches respect access revocation.
43. Long-lived signed URLs are prohibited as durable cache truth.
44. Client private-media caches require logout/account-switch policy.
45. Shared cache values use stable serialization.
46. Cache value formats are versionable.
47. Cache size is bounded.
48. Cache eviction never harms correctness.
49. Cache warming is optional.
50. Empty caches are a supported operating condition.
51. Cache outage degrades to underlying sources where safe.
52. Distributed-cache failure policies are explicit.
53. Correctness-critical idempotency records are not stored solely in volatile cache.
54. Command-side caches do not replace authoritative state.
55. No cache stands between a state transition and the row it is conditional on.
56. Caches sit after projections rather than becoming undocumented projection systems.
57. Cache observability distinguishes cache classes.
58. Security-sensitive invalidation failures generate operational visibility.
59. Cached and uncached behavior is tested for semantic equivalence.
60. Architecture documentation changes when caching becomes required for correctness or service boundaries.

---

# Guiding Principle

When adding a cache, ask:

> **What expensive work are we avoiding, how stale may this result safely become, what exact dimensions determine whether it is reusable, and what happens when the cache is empty, wrong, or unavailable?**

If the answer to the last question is "the system becomes incorrect," the design is relying on the cache for authority and must be reconsidered.
