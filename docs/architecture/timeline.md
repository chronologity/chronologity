# Chronologity Timeline Architecture

## Purpose

This document defines the architecture of Chronologity's Timeline system.

The Timeline is the primary historical navigation model of Chronologity. It is not a conventional social-media Feed, not a generic sortable list, and not an arbitrary user-created container.

The Timeline architecture must support from day one:

- vertical chronological navigation;
- horizontal contextual navigation;
- depth into a Moment;
- temporal zoom;
- historical jumps;
- backfilled history;
- historically significant anchors;
- causal navigation;
- privacy and moderation filtering;
- large-scale historical retrieval;
- deterministic pagination;
- accessibility semantics.

This document is grounded in:

- the finalized product Timeline specifications;
- `docs/architecture/overview.md`;
- `docs/architecture/principles.md`;
- `docs/architecture/monorepo.md`;
- `docs/architecture/api.md`;
- `docs/architecture/events.md`;
- `docs/architecture/messaging.md`;
- `docs/architecture/projections.md`;
- `docs/architecture/data-storage.md`.

---

# Core Principle

The Timeline is a **derived historical representation** over authoritative Chronologity facts.

Conceptually:

```text
authoritative domain state
        ↓
projection
        ↓
Timeline read models
        ↓
feed aggregator
        ↓
GraphQL
        ↓
mobile Timeline experience
```

The Timeline does not become authoritative merely because it is the primary product surface.

The governing rule is:

> **Authoritative domain state decides what exists; Timeline architecture decides how that history is efficiently represented and navigated.**

---

# Timeline Is Not Feed Ranking

Chronologity's Timeline is fundamentally chronological.

The system must distinguish:

```text
when something happened
```

from:

```text
how important, popular, relevant, or interesting it may be
```

Historical significance, engagement, and contextual relevance may influence:

- abstraction at broader temporal scales;
- historical anchors;
- summaries;
- jump suggestions;
- contextual presentation.

They do not rewrite chronological order.

---

# Timeline Scope

A Timeline has a historical scope.

Potential scopes include:

```text
User
Location
Real-World Event
Tag
Network
other product-defined historical context
```

A scope determines which eligible Moments can participate in the Timeline.

The exact canonical set of Timeline scopes belongs in the product/technical Timeline specifications.

---

# Timeline Scope Versus Timeline Read Representation

Chronologity must distinguish a Timeline's scope from the representation derived within it. A scope is a domain fact that already has an owner; the Timeline is what a particular Viewer sees of the history that falls inside it.

```text
domain fact (User, Location, Real-World Event, tag, relationship)
        │
        ▼  derived, per Viewer
Timeline representation
```

The scope is authoritative. The Timeline is not, and the scope is not a Timeline.

Every Timeline scope shipping at launch is derived from existing domain facts; none has a persisted authoritative definition (ADR-084).

The API's canonical `features/timelines/` module owns the projections that maintain Timeline read models. It owns no Timeline service and no write operations: read composition belongs to `apps/feed-aggregator`, and defining a Timeline is not an operation the product has.

---

# Timeline Runtime Boundary

The read-side Timeline runtime is:

```text
apps/feed-aggregator
```

Despite its historical repository name, this application is Chronologity's read-only Timeline composition service.

Its Timeline responsibilities include:

- Timeline heads;
- Timeline slices;
- previous/next chronological navigation;
- horizontal adjacency;
- Moment depth composition;
- temporal zoom;
- historical jumps;
- context around a Moment;
- context around a time;
- prefetching;
- batching;
- visibility filtering;
- historical-significance composition;
- causal navigation support.

---

# API Boundary

`apps/api` owns authoritative mutation.

Examples:

- create Moment;
- correct Moment metadata where product rules allow;
- define authoritative Timeline scope where applicable;
- change visibility;
- moderate content;
- assign roles;
- update social relationships.

It should not become the Timeline composition service.

---

# Three Navigation Dimensions

Chronologity's Timeline has three semantic dimensions:

```text
vertical
horizontal
depth
```

These dimensions describe navigation semantics.

They are not authoritative x/y/z coordinates stored in the domain.

---

# Vertical Dimension: Chronology

Vertical movement navigates through time within the current Timeline scope/context.

The primary ordering key is historical occurrence time.

Conceptually:

```text
older history
    ↑
    │
Moment
    │
    ↓
newer history
```

The exact UI direction may be presentation-specific, but the semantic dimension is chronology.

---

# Vertical Ordering

Vertical ordering must use:

```text
occurrence time
+
deterministic tie-breaker
```

It must not use:

- publication time;
- upload time;
- Kafka offset;
- projection time.

---

# Deterministic Tie-Breaking

Two Moments may share the same occurrence time.

A stable secondary key is required.

A likely canonical ordering tuple is:

```text
occurrenceTime
momentId
```

or another stable immutable identifier.

The exact tuple must be reflected consistently in:

- ClickHouse sort keys;
- cursor encoding;
- historical jump anchoring;
- neighboring-slice queries.

Three of those four are code rather than schema, and two applications now write
them. `packages/timeline-derivation` holds the cursor encoding together with the
keyset condition and ordering that read it back, so the consistency this section
asks for is a property of one module rather than a rule two teams remember
(ADR-138).

---

# Backfilled History

Chronologity must assume history arrives out of order.

Example:

```text
Moment uploaded in 2026
occurrence time = 1998
```

The Timeline projection inserts the Moment into the 1998 position.

The architecture must never treat append order as historical order.

---

# Historical Corrections

If occurrence time is corrected:

```text
MomentOccurrenceTimeCorrected
        ↓
Timeline projection
        ↓
remove/rewrite old read position
        ↓
insert new historical position
```

Affected derived systems may include:

- Timeline rows;
- temporal zoom buckets;
- historical jump indexes;
- Search;
- Real-World Event context;
- significance calculations.

---

# Horizontal Dimension: Context

Horizontal movement changes historical context without changing the concept of chronology.

Potential adjacent contexts may represent:

- Locations;
- Real-World Events;
- people/social contexts where product-defined;
- other historically meaningful groupings.

Each horizontal context has its own vertical chronology.

---

# Horizontal Adjacency

Horizontal adjacency must be semantically derived.

The client should not invent contextual adjacency from visual coordinates.

The read side should expose enough information to answer:

```text
current context
    ↓
previous/next/related context
```

according to product semantics.

---

# Horizontal Context Identity

A horizontal context should have a stable semantic identifier.

Examples:

```text
locationId
realWorldEventId
timelineScopeId
```

The client may position these contexts spatially.

The spatial coordinate is not authoritative.

---

# Horizontal Prefetch

To preserve fluid navigation, the feed aggregator may prefetch neighboring contexts.

Potential response:

```text
current slice
+
left context descriptor
+
right context descriptor
```

or another product-defined representation.

Prefetch must respect:

- authorization;
- privacy;
- moderation;
- blocking.

---

# Depth Dimension: Moment Detail

Depth means moving into a Moment.

It does **not** mean:

- Sub-Moments;
- nested historical chronology;
- recursive Moment hierarchy.

The finalized product model rejects recursive Sub-Moments.

---

# Moment Depth Composition

A depth view may compose:

- Moment identity;
- occurrence time;
- creator summary;
- complete ordered media collection;
- captions/descriptions;
- Location;
- Real-World Event context;
- Reactions;
- Comments;
- causal relationships;
- historical significance;
- privacy/moderation state where relevant;
- neighboring chronological context.

This representation is derived.

---

# Unlimited Media

A Moment may contain an unlimited number of images and videos at the product level.

Therefore Moment depth must support:

- paginated media retrieval;
- incremental loading;
- stable media ordering;
- partial rendering;
- resumable loading.

It must not introduce an arbitrary hidden media-count limit.

---

# Media Ordering

Media order within a Moment is distinct from Timeline chronology.

Conceptually:

```text
Timeline order
    → between Moments

Media order
    → within one Moment
```

The two ordering systems must not be conflated.

---

# Temporal Zoom

Temporal zoom changes the temporal resolution at which history is represented.

It is a day-one architectural requirement.

The backend must support scale-aware queries.

It is not merely a mobile animation.

---

# Temporal Scale

The Timeline should support explicit temporal scale semantics.

Potential examples:

```text
moment-level
day
month
year
decade
era
```

The exact canonical scale model belongs in the product/technical specification.

The architecture must not hard-code a UI-only zoom ladder into authoritative domain state.

---

# Narrow Temporal Scale

At narrow scale, responses may contain:

- individual Moments;
- precise occurrence times;
- detailed contextual adjacency.

---

# Broad Temporal Scale

At broad scale, returning every Moment would be inefficient and unusable.

The system may return:

- temporal buckets;
- clusters;
- summaries;
- historical-significance anchors;
- representative Moments;
- Real-World Event groupings.

These are derived abstractions.

---

# Drill-Down Integrity

Broad-scale abstractions must preserve the ability to drill into underlying history.

A summary must not replace or destroy the underlying Moment representation.

Conceptually:

```text
decade summary
    ↓
year
    ↓
month
    ↓
Moment
```

without altering authoritative state.

---

# Scale-Aware Read Models

Temporal zoom may use:

- precomputed temporal aggregates;
- query-time aggregation;
- hybrid approach.

The choice depends on:

- scale;
- latency;
- data volume;
- update frequency.

---

# Historical Significance in Temporal Zoom

Historical significance can help choose anchors at broad scales.

For example, a decade view may surface historically significant Moments or Real-World Events.

Significance must remain:

- derived;
- versioned;
- contextual;
- authorization-aware.

It does not reorder the underlying chronology.

---

# Historical Jumps

Historical jumps provide direct non-local navigation.

Users must not need to sequentially scroll through every intermediate Moment.

A historical jump may target:

- Moment;
- occurrence time;
- Real-World Event;
- Location;
- causal relationship destination;
- historically significant anchor.

---

# Historical Jump Query

A jump query should locate:

```text
target
+
Timeline scope
+
temporal context
+
neighboring slice
```

so normal navigation can continue immediately.

---

# Jump Around Time

A canonical query concept is:

```text
GetTimelineAroundTime
```

Input may include:

- scope;
- target occurrence time;
- scale;
- Viewer context;
- desired slice size.

Output should include the closest valid historical context.

---

# Jump Around Moment

Another canonical query:

```text
GetTimelineAroundMoment
```

This resolves the Moment's historical position and returns neighboring context.

This is useful when opening:

- notification deep link;
- Search result;
- causal link;
- shared Moment.

---

# Jump Provenance

A historical jump may carry semantic provenance:

```text
jump reason:
    causal relationship
    Search result
    historical significance
    Real-World Event association
```

The client may use this to preserve navigation context.

---

# Return Path

Non-local jumps should preserve a return/navigation path where product UX requires it.

The client may hold return-stack state.

The backend should return stable Timeline context identifiers rather than UI coordinates.

---

# Historical Jump Authorization

Every jump destination must be reauthorized.

A causal edge or Search result is not proof the destination remains visible.

Unauthorized destinations must not leak:

- preview;
- timestamp;
- Location;
- Event label;
- historical-significance score.

---

# Timeline Read Models

Timeline read models belong primarily in ClickHouse.

They should be designed around actual query patterns.

Potential categories:

```text
moment chronology
scope membership
context adjacency
temporal aggregates
historical jump indexes
significance anchors
visibility/moderation metadata
```

---

# Timeline Moment Read Model

A Timeline Moment row may include:

- Moment ID;
- occurrence time;
- tie-breaker;
- scope identifiers;
- creator summary;
- media preview;
- Location summary;
- Real-World Event summary;
- visibility classification;
- moderation state;
- Reaction summary;
- significance metadata;
- source record versions.

The exact schema belongs in `docs/data/clickhouse.md`.

---

# Denormalization

Timeline rows may intentionally duplicate:

- creator display data;
- labels;
- preview media metadata;
- context identifiers.

This reduces cross-store fan-out.

Authority remains with the owning domain features.

---

# Timeline Query Shape

The feed aggregator should expose semantic GraphQL queries.

Potential concepts include:

```text
timelineHead
timelineSlice
timelineAroundMoment
timelineAroundTime
timelineContextNeighbors
momentDepth
temporalZoom
historicalJump
```

Exact GraphQL naming belongs in API/GraphQL specifications.

---

# Timeline Slice

A Timeline slice should contain:

- ordered nodes/items;
- start/end cursor;
- previous/next availability;
- scope;
- scale;
- optional context metadata;
- freshness/projection metadata where useful internally.

---

# Cursor Pagination

Timeline pagination must use opaque keyset/cursor semantics.

Offset pagination is inappropriate for large, changing historical datasets.

---

# Cursor Requirements

A cursor should encode enough information to resume the query deterministically.

Potential components:

```text
scope
occurrenceTime
tieBreaker
scale
direction
```

but the encoded representation must remain opaque to clients.

---

# Cursor Stability

A cursor should remain meaningful when unrelated Moments are inserted elsewhere in history.

Backfilled history before/after the cursor may change neighboring pages, but the cursor must still resume from a stable historical position.

---

# Bidirectional Navigation

Timeline queries must support both directions.

Conceptually:

```text
older ← current → newer
```

The implementation should avoid asymmetric pagination that makes one direction substantially harder.

---

# Timeline Head

A Timeline head resolves the default entry position for a scope.

Depending on product semantics, this may be:

- newest occurrence;
- present-time anchor;
- another explicit entry point.

The Timeline head must not be confused with "highest ranked."

---

# Timeline Context

A Timeline context should identify:

- scope type;
- scope ID;
- temporal scale;
- optional anchor;
- relevant filters.

The client should be able to serialize/restore navigation context without knowing database internals.

---

# Scope Types

Potential scope types include:

```text
user
location
real-world-event
tag
network
```

The exact final list should be canonicalized in product/technical docs.

Each scope type must define:

- membership;
- authorization;
- horizontal adjacency;
- Timeline head semantics.

---

# User Timeline

A User Timeline represents eligible Moments associated with a User according to product semantics.

It is not necessarily identical to:

- Moments authored by User;
- profile activity Feed.

Exact inclusion rules belong in product specifications.

---

# Location Timeline

A Location Timeline represents eligible Moments associated with a Location.

Location privacy and precision must be enforced.

Historical Location naming may change over time.

The read model should preserve historically appropriate labels where required.

---

# Real-World Event Timeline

A Real-World Event Timeline groups Moments associated with that historical Event.

Real-World Event membership may be:

- authoritative;
- curated;
- derived;
- inferred with provenance.

Timeline composition must preserve that provenance where required.

---

# Network Timeline

A network-scoped Timeline may use social relationships to determine eligible Moments.

Authorization/eligibility can change as relationships change.

The read model must support revocation without rebuilding all history per Viewer if possible.

---

# Tag Timeline

A tag/context Timeline may be derived from authoritative tag associations.

Tag semantics must not become a ranking mechanism.

---

# Contextual Adjacency

Horizontal adjacency should be computed from semantically meaningful relationships.

Potential examples:

- geographically adjacent Locations;
- related Real-World Events;
- nearby historical contexts.

The exact algorithm must be product-defined.

Avoid generic "similar content" recommendation logic masquerading as horizontal Timeline semantics.

---

# Feed Aggregator Composition

The feed aggregator combines read models into client-friendly responses.

Typical flow:

```text
GraphQL resolver
    ↓
Timeline query/composition function
    ↓
request-scoped loaders
    ↓
ClickHouse
    ↓
semantic response
```

Resolvers remain thin.

---

# DataLoaders

DataLoaders should batch:

- User summaries;
- Reaction summaries;
- moderation visibility;
- Location summaries;
- other repeated reads.

They are request scoped unless the data is authorization-neutral.

---

# N+1 Avoidance

A Timeline response containing 100 Moments must not trigger:

```text
100 User queries
100 Reaction queries
100 Location queries
```

Read models and DataLoaders should batch or denormalize.

---

# Cross-Store Fan-Out

The feed aggregator should avoid per-Moment synchronous calls to:

- the API;
- object-storage metadata service;
- PostgreSQL.

Required display data should be projected or batched appropriately.

---

# Authorization

Timeline authorization has two levels:

```text
scope authorization
+
item authorization
```

A Viewer may have access to the Timeline scope while individual Moments remain ineligible.

---

# Visibility Filtering

Visibility filtering may depend on:

- public/private/follower/network state;
- ownership;
- blocking;
- moderation;
- account state;
- Location privacy.

The read architecture must apply current policy safely.

---

# Privacy Propagation

A privacy change must propagate to Timeline read models and caches.

A stale Timeline row must not remain publicly visible indefinitely.

---

# Blocking

Blocking must affect Timeline composition according to product semantics.

The architecture should avoid per-Viewer duplication of entire Timeline histories.

Prefer:

- shared content projection;
- efficient Viewer-specific eligibility state.

---

# Moderation

Moderation restrictions must remove or suppress affected Moments/context promptly.

Restoration should reintroduce content only if current privacy/deletion rules permit it.

---

# Account Deletion

A deleted User's Timeline representation must follow product deletion semantics.

Possibilities may include:

- removed Moments;
- anonymized attribution;
- historical tombstones.

The product/privacy specification determines the final behavior.

---

# Search to Timeline

Search results should resolve into Timeline context.

Opening a Search result should ideally use:

```text
GetTimelineAroundMoment
```

or equivalent rather than creating a separate isolated navigation mode.

---

# Notification to Timeline

A notification deep link to a Moment should resolve:

```text
Moment
+
current authorized Timeline context
```

not assume the notification's old context remains valid.

---

# Causal Navigation

A causal relationship may provide a historical jump destination.

The Timeline query side should expose:

- source;
- destination;
- relationship semantics;
- provenance;
- authorization-filtered target.

---

# Historical Significance Navigation

A significant anchor may be used for:

- broad temporal zoom;
- jump suggestions;
- historical overview.

The Timeline architecture treats this as read metadata.

---

# Accessibility

The Timeline must expose semantic information independent of 3D rendering.

Accessible clients need:

- current Moment;
- occurrence time;
- chronological position;
- scope/context;
- available older/newer navigation;
- horizontal context options;
- depth state;
- temporal scale;
- historical-jump destinations.

---

# Accessibility and Spatial Layout

Screen readers/alternative navigation must not need to interpret visual x/y/z coordinates.

The feed aggregator returns semantics.

The client maps those semantics into accessible navigation controls.

---

# Focus Restoration

When moving:

- depth → Timeline;
- historical jump → prior context;
- horizontal context → previous context;

the client should retain stable entity/context IDs so focus can be restored.

This is partly a mobile architecture concern, but the backend must expose stable identity.

---

# Performance

Timeline performance is product correctness.

Critical operations include:

- initial Timeline load;
- vertical slice fetch;
- horizontal neighbor fetch;
- Moment depth;
- temporal zoom;
- historical jump.

Concrete latency targets belong in operations/performance specifications.

---

# Prefetching

The aggregator/mobile client may prefetch:

- next vertical slice;
- previous vertical slice;
- adjacent horizontal context;
- Moment preview/depth metadata.

Prefetch must remain bounded.

---

# Large Timelines

No request should require materializing an entire Timeline.

All normal navigation uses bounded slices/aggregates.

---

# Dense Historical Regions

Dense regions may require:

- smaller temporal windows;
- aggregation;
- clustering;
- dynamic slice size.

The backend should return stable semantic boundaries even when density changes.

---

# Sparse Historical Regions

Sparse regions should not produce endless empty scrolling.

The read side may skip empty intervals while preserving historical scale context.

Temporal zoom should help Users understand gaps.

---

# Empty Timeline

An empty Timeline is a valid state.

The aggregator should return a semantic empty result, not an error.

---

# Timeline Freshness

A newly accepted Moment may take time to appear in ClickHouse.

The client may display confirmed local state while projection catches up.

The feed aggregator itself should not synthesize authoritative writes to hide lag.

---

# Projection Version

Timeline query responses may internally be served from a specific projection version.

The client should not generally depend on the projection version unless debugging/compatibility requires it.

---

# Side-by-Side Timeline Projection

Timeline v2 can be rebuilt while v1 serves traffic.

Cutover occurs after:

- replay catches up;
- correctness validation;
- authorization/privacy validation;
- performance validation.

---

# Timeline Cache

Caching may be used for:

- public Timeline slices;
- repeated temporal aggregates;
- context metadata.

Personalized Timeline caches require Viewer-safe keys.

---

# Cache Invalidation

Invalidation triggers may include:

- Moment creation/correction/deletion;
- privacy changes;
- moderation;
- User profile changes;
- Location changes;
- significance recomputation.

Do not depend only on long TTLs for sensitive visibility changes.

---

# Timeline and Search Separation

Search answers:

> **Which matching entities can this Viewer find?**

Timeline answers:

> **How does eligible history appear and connect through time/context?**

Search may lead into Timeline navigation.

Search ranking must not redefine Timeline chronology.

---

# Timeline and Discovery

If Discovery exists as an amplification mechanism, it may select Timeline entry points.

It must not alter the ordering within the Timeline context.

---

# Timeline and Analytics

Analytics may observe Timeline usage.

Analytics must not become the source of Timeline truth.

---

# Timeline and AI

AI may assist with:

- contextual summaries;
- clustering suggestions;
- causal suggestions;
- accessibility metadata.

AI output must retain provenance.

It must not silently alter chronological order or authoritative relationships.

---

# Timeline and Historical Uncertainty

Occurrence time may be uncertain.

The Timeline architecture must represent uncertainty honestly.

Potential representations include:

- date range;
- approximate date;
- temporal bucket;
- confidence metadata.

Sorting rules for uncertain time must be product-defined.

---

# Timeline and Real-World Event Boundaries

Real-World Events may span time ranges.

A Moment can fall:

- inside;
- near;
- related to;
- causally connected to

a Real-World Event.

Timeline composition must preserve relationship semantics rather than infer membership solely from time overlap.

---

# Timeline and Location History

Location itself may have historical evolution.

Names/boundaries can change.

The Timeline read model may need historical Location metadata rather than only present-day labels.

This belongs in focused Location/data specifications.

---

# Timeline Consistency

Timeline reads are eventually consistent.

Security/privacy eligibility has tighter correctness requirements than ordinary freshness.

If necessary:

```text
derived Timeline candidate set
        ↓
current authorization filter
```

may be applied at query time.

---

# Timeline Failure Modes

Potential failures include:

- ClickHouse unavailable;
- stale projection;
- invalid cursor;
- unauthorized scope;
- target Moment deleted;
- historical jump target unavailable;
- aggregation unavailable.

Failures should be semantic and recoverable where possible.

---

# Invalid Cursor

An invalid or expired cursor should return a stable client-facing error.

The client should be able to recover by re-resolving the current Timeline context.

Do not expose raw cursor internals.

---

# Deleted Jump Target

If a historical jump target is deleted/unavailable:

- return unavailable semantic;
- offer surrounding context if product rules permit;
- do not leak restricted metadata.

---

# Timeline Observability

Metrics should include:

- Timeline query latency;
- slice query latency;
- temporal zoom latency;
- historical jump latency;
- ClickHouse query latency;
- cache hit rate;
- projection freshness;
- authorization filtering cost;
- rows scanned;
- GraphQL resolver timing;
- DataLoader batch sizes.

---

# Query Cost Protection

GraphQL Timeline queries need cost/complexity controls.

Protect against:

- excessive depth;
- huge page sizes;
- combinatorial nested requests.

Query limits are technical bounds.

They must not impose hidden product limits on total history.

---

# Page Size

The server should enforce bounded page sizes.

The product can still navigate an unlimited Timeline through repeated bounded queries.

---

# Temporal Zoom Query Cost

Broad-scale queries may aggregate huge historical ranges.

Use:

- precomputed buckets;
- bounded query windows;
- hierarchical aggregation;
- other ClickHouse-appropriate strategies.

---

# Historical Jump Index Cost

Jump indexes should support near-direct lookup.

A historical jump should not scan the entire Timeline.

---

# Testing

## Ordering tests

Verify:

- occurrence-time ordering;
- deterministic tie-breaking;
- backfilled insert;
- historical correction.

## Cursor tests

Verify:

- forward navigation;
- backward navigation;
- stable resume;
- invalid cursor;
- new insert around cursor.

## Horizontal tests

Verify:

- adjacency;
- authorization filtering;
- no restricted context leakage.

## Depth tests

Verify:

- complete Moment composition;
- unlimited media pagination;
- media ordering;
- privacy/moderation.

## Temporal zoom tests

Verify:

- scale transitions;
- aggregation correctness;
- drill-down continuity;
- significance anchors;
- sparse/dense ranges.

## Historical jump tests

Verify:

- around time;
- around Moment;
- causal destination;
- deleted/restricted target;
- return context.

## Projection tests

Verify:

- creation;
- correction;
- deletion;
- privacy;
- moderation;
- rebuild.

## Accessibility tests

Verify semantic navigation does not depend on visual coordinates.

## Performance tests

Use realistic Timeline sizes and dense historical ranges.

---

# Golden Timeline Flow

A representative flow:

```text
1. User creates a Moment through API.

2. API persists authoritative MomentCreated.

3. Messaging delivers the change to Timeline projection.

4. Projection inserts Moment into ClickHouse by occurrence time.

5. Mobile queries feed aggregator.

6. Aggregator resolves Timeline scope and Viewer context.

7. ClickHouse returns chronological slice.

8. Authorization filtering removes ineligible content.

9. GraphQL returns semantic Timeline nodes/cursors/context.

10. Mobile maps the result into vertical/horizontal/depth interaction.
```

---

# Day-One Timeline Requirements

Before launch, Chronologity must define and implement:

- canonical Timeline scope types;
- Timeline context model;
- occurrence-time ordering;
- deterministic tie-breaker;
- opaque cursor format;
- bidirectional pagination;
- Timeline head semantics;
- backfilled history;
- historical corrections;
- horizontal adjacency;
- Moment depth;
- unlimited-media pagination;
- temporal scale model;
- temporal zoom queries;
- historical jump queries;
- around-time lookup;
- around-Moment lookup;
- Search/notification deep-link resolution;
- historical-significance anchors;
- causal jump support;
- authorization filtering;
- privacy propagation;
- blocking behavior;
- moderation propagation;
- ClickHouse Timeline tables;
- projection versioning;
- projection freshness metrics;
- Timeline query metrics;
- GraphQL query cost controls;
- accessibility semantics;
- ordering/cursor/jump/zoom integration tests.

---

# Recommended Initial Read Architecture

The recommended starting model is:

```text
authoritative PostgreSQL, through the outbox
        ↓
Kafka
        ↓
Timeline projection worker
        ↓
ClickHouse
        ↓
apps/feed-aggregator
        ↓
GraphQL
        ↓
apps/mobile
```

The feed aggregator remains stateless/read-only apart from bounded caches and request-scoped loaders.

---

# Open Architectural Questions

## Scope Model

- What exact Timeline scopes ship at launch?
- User?
- Location?
- Real-World Event?
- Network?
- Tag?
- Which are horizontally navigable?

## Timeline Definitions

Settled (ADR-084). No scope requires an authoritative API-owned Timeline definition, and every scope is purely derived: each one is grounded in a fact that already has an owner — a User, a Location, a Real-World Event, a tag on a Moment, a social relationship. None of the lifecycle commands remains valid, and all were removed from the canonical structure before implementation rather than deferred, since `docs/product/timelines.md` refuses the concept rather than postponing it.

Still open: whether a future scope emerges that genuinely needs a persisted definition. That would be a new decision with its own record, not a revival of the removed commands.

## Ordering

- Is `(occurrenceTime, momentId)` the canonical sort tuple?
- How are uncertain occurrence ranges ordered?
- How are Moments with date-only precision sorted?

## Cursor

- What exact fields are encoded?
- Is cursor signed?
- Does scale belong in cursor or query context?
- How long should cursors remain valid?

## Horizontal Context

- What exactly determines left/right adjacency?
- Geographic?
- Event relationship?
- User-selected?
- Can adjacency change over time?
- How is it projected?

## Temporal Scale

- What are the canonical scale levels?
- Is zoom continuous or discrete?
- Which scales use precomputed buckets?
- Which use query-time aggregation?

## Temporal Buckets

- What ClickHouse tables/materialized views support them?
- How are bucket summaries chosen?
- How does historical significance influence anchors without becoming ranking?

## Historical Jumps

- What destination types exist?
- Are jumps represented by one generic target union?
- How are inaccessible targets handled?
- How is return context encoded?

## Moment Depth

- Does Moment depth come entirely from ClickHouse?
- Which fields require other read stores?
- How are large media collections paginated?
- Does depth query include Comments or load them separately?

## Authorization

- Which eligibility data is denormalized into ClickHouse?
- Which current-state checks occur at query time?
- How are blocks evaluated efficiently?
- How quickly must privacy/moderation changes propagate?

## Causality

- Which read model stores causal adjacency?
- Can causal jumps cross Timeline scopes?
- How is provenance exposed?

## Historical Significance

- What dimensions are available to Timeline?
- How does scale affect significance?
- Are anchors precomputed?
- How are algorithm versions represented?

## Performance

- Target p50/p95 for initial slice?
- horizontal neighbor?
- temporal zoom?
- historical jump?
- Moment depth?
- Maximum page size?
- Maximum GraphQL complexity?

## Naming

- Should `apps/feed-aggregator` be renamed `apps/timeline-aggregator` before implementation?
- The architecture already treats it as a Timeline service.
- If renamed, the canonical monorepo and all architecture documents must be updated together.

---

# Architectural Invariants

1. Timeline is a derived historical representation.
2. Timeline is not authoritative domain truth.
3. Timeline is fundamentally chronological.
4. Engagement does not rewrite chronology.
5. Historical significance does not rewrite chronology.
6. No Timeline scope has an authoritative persisted definition; every scope is derived from facts owned elsewhere (ADR-084).
7. The feed aggregator owns high-volume Timeline read composition.
8. The feed aggregator is read-only.
9. Timeline data is primarily served from ClickHouse-derived models.
10. Vertical navigation represents chronology.
11. Vertical ordering uses occurrence time, not ingestion/publication time.
12. Tie-breaking is deterministic.
13. Backfilled history is normal.
14. Historical corrections move derived Timeline position.
15. Horizontal navigation represents context.
16. Horizontal adjacency is semantic, not UI-coordinate based.
17. Depth enters a Moment.
18. Depth does not create Sub-Moments.
19. Recursive Moment hierarchy is prohibited.
20. Moment media ordering is separate from Timeline chronology.
21. Unlimited media is implemented with bounded pagination/loading.
22. Temporal zoom is a backend/read capability, not merely animation.
23. Broad temporal scales may use derived aggregation.
24. Broad-scale summaries remain drillable into underlying history.
25. Historical significance may influence broad-scale anchors but not chronology.
26. Historical jumps are direct non-local navigation.
27. Historical jumps do not require sequential pagination.
28. Jump destinations are reauthorized.
29. Jump metadata does not leak restricted targets.
30. Timeline read models are purpose-built and denormalized.
31. Denormalized Timeline data remains derived.
32. Cursor pagination is opaque/keyset-based.
33. Offset pagination is not used for large Timeline history.
34. Bidirectional pagination is required.
35. Cursor behavior must survive backfilled history reasonably.
36. Timeline scopes have explicit semantics.
37. Feed Aggregator GraphQL exposes semantic navigation, not datastore details.
38. Resolvers remain thin.
39. DataLoaders are request scoped when authorization-sensitive.
40. N+1 query behavior is prohibited.
41. Critical Timeline reads avoid per-Moment cross-store fan-out.
42. Timeline authorization includes both scope and item eligibility.
43. Privacy changes propagate to Timeline projections/caches.
44. Blocking affects Timeline eligibility according to product semantics.
45. Moderation restrictions propagate rapidly.
46. Search deep links resolve into current Timeline context.
47. Notification deep links re-resolve current authorization/context.
48. Causal navigation uses explicit causal relationships.
49. Historical-significance navigation uses derived metadata.
50. Accessibility semantics are independent of 3D coordinates.
51. Stable identity supports focus restoration.
52. Timeline performance is part of product correctness.
53. Prefetch is bounded.
54. Entire Timelines are never materialized for ordinary requests.
55. Dense and sparse historical regions are explicitly supported.
56. Empty Timeline is a valid result.
57. Projection lag is visible and does not change authority.
58. Timeline projection versions can be rebuilt side by side.
59. Timeline caches are authorization-safe.
60. Search ranking does not redefine Timeline ordering.
61. AI-derived context retains provenance.
62. Historical uncertainty is preserved.
63. Real-World Event membership is not inferred solely from temporal overlap.
64. Timeline consistency is eventual except where security/privacy requires tighter checks.
65. Invalid cursors fail semantically without exposing internals.
66. GraphQL query complexity is bounded.
67. Page-size bounds are technical, not product-total limits.
68. Historical jumps use indexed/direct lookup.
69. Timeline ordering, zoom, jump, privacy, and accessibility behavior receive direct tests.
70. Architecture documentation changes when Timeline semantics or service boundaries change.

---

# Guiding Principle

When designing any Timeline capability, ask:

> **What historical context is the User trying to navigate, at what temporal scale, and how can Chronologity return that history directly and semantically without turning presentation geometry, engagement ranking, or derived read state into authoritative truth?**

The Timeline architecture should make enormous amounts of history feel navigable while preserving chronology, context, privacy, provenance, and the integrity of the underlying Moments.
