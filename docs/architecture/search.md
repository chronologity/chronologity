# Chronologity Search Architecture

## Purpose

This document defines the technical architecture that supports the product semantics established in `docs/product/search.md`.

It specifies indexing boundaries, index ownership, synchronization from authoritative history, authorization-aware retrieval, the separation of relevance from chronology, and how Search results become Timeline entry points.

It does not redefine Search product behavior. Where this document and `docs/product/search.md` appear to disagree, the product specification governs and this document is wrong.

This document also does not select a specific Search engine. Per `architecture/decisions.md`, the introduction of a dedicated Search engine remains an open infrastructure decision. What this document does settle is the shape of the Search subsystem so that decision can be made later without redesigning privacy, identity, or ranking semantics.

---

# Core Principle

Search is a derived read path over authoritative history.

```text
authoritative history
        ↓
   search projection
        ↓
    search index
        ↓
authorization-aware retrieval
        ↓
   query-specific ranking
        ↓
      results
```

Every architectural rule in this document follows from three product invariants:

```text
Search relevance ≠ chronology
Search relevance ≠ historical significance
visible ≠ searchable ≠ discoverable
```

A Search index is never authoritative. It is a disposable, rebuildable projection whose only job is to help a Viewer locate history they are already permitted to retrieve.

---

# Application Boundary

Search retrieval is owned by `apps/api` and exposed over REST.

Search indexing is owned by projection workers deployed from the API application per ADR-054, which permits independently deployed worker processes without creating new top-level applications.

```text
mobile
   │ REST: query, filters, viewer context
   ▼
apps/api ── search read path ──▶ search index
   ▲                                  ▲
   │                                  │ search projection
   │                            search-indexer consumer
   │                                  ▲
   │                              Kafka topics
   │                                  ▲
   └── authoritative writes ──▶ EventStoreDB / PostgreSQL
```

`apps/feed-aggregator` does not own Search. It resolves a selected Search result into Timeline context, as established in `architecture/feed.md`. Search ranking stops at entry-point selection; Timeline chronology resumes after entry.

This boundary exists because Search retrieval is authorization-dense, low-volume relative to Timeline navigation, and coupled to authoritative entity identity rather than to ClickHouse Timeline read models. Moving Search into the aggregator would require the read-only Timeline layer to own ranking policy and eligibility rules it does not otherwise need.

---

# Non-Responsibilities

The Search subsystem must not:

- become an alternate authorization path;
- become a second source of truth for any entity;
- create Event membership, Person identity, Location assertions, or causal edges;
- reorder, reinterpret, or supply Timeline chronology;
- serve Timeline pagination;
- own Discovery recommendation;
- retain data that authoritative history has deleted or restricted;
- silently normalize historical names, spellings, or temporal precision.

A retrieval relationship is a retrieval relationship. It never becomes a domain fact.

---

# Search Store

The day-one Search store is PostgreSQL, consistent with `architecture/data-storage.md` and `architecture/scalability.md`.

PostgreSQL is sufficient for the day-one Search requirements defined by the product specification: exact entity lookup, lexical keyword Search, structured filters, temporal ranges, and per-entity-type retrieval over an authorized corpus.

```text
tsvector + GIN        lexical relevance
pg_trgm               typo tolerance, alias and prefix matching
btree / composite     structured filters, temporal ranges
PostGIS or bounded    coarse geographic retrieval
geohash columns
```

A dedicated engine such as OpenSearch may be introduced later. If it is, it remains derived state subject to the same privacy, deletion, moderation, and rebuild rules defined here. The Search read path must therefore be written against an internal retrieval interface rather than against PostgreSQL query syntax scattered through feature code.

ClickHouse must not be used as a Search substitute. Timeline read models are shaped for chronological range access, not for relevance retrieval or entity lookup, and reusing them would couple Search recall to Timeline projection design.

---

# Document Model

Search indexes multiple entity types. It does not flatten history into one document shape.

```text
search_document
├── entity_type        moment | user | person | timeline | event | location
├── entity_id          stable Chronologity identity
├── document_version   projection version that produced this row
├── searchable text    authorized text by field with weights
├── aliases            historical names, alternate spellings, translations
├── occurrence         occurrence instant/range + precision
├── published_at       publication time
├── indexed_at         index write time
├── eligibility        visibility scope, searchability, moderation state
├── location           viewer-safe precision tiers
├── associations       timeline, event, creator, participants
├── significance       significance score + significance version
└── provenance         per-field origin: authored, structured, derived, inferred
```

Stable Chronologity entity identity is independent of aliases, display names, external search-provider identifiers, and geocoder identifiers. A rename, a merge of duplicate Events, or a change of Search engine must not change entity identity.

Document IDs are stable and derived from `(entity_type, entity_id)` so repeated indexing is idempotent, per `architecture/messaging.md`.

A Moment is one document regardless of how many images and videos it contains. Media quantity never contributes to relevance.

---

# Field Provenance

Every materially searchable field carries its origin:

```text
authored     User-written captions, descriptions, titles
structured   authoritative domain metadata
derived      system-computed values such as significance
inferred     AI labels, OCR, transcripts, scene descriptions
```

Provenance is stored in the index rather than reconstructed at query time. It is required for result explanation, correction workflows, ranking diagnosis, and for keeping inferred metadata from being presented as historical assertion.

Inferred fields are not part of the day-one index. The schema reserves space for them so their later introduction does not require a document model migration that blurs the authored/inferred boundary.

---

# Indexing Pipeline

Search indexing is asynchronous and event-driven.

```text
domain event / integration event
            ↓
        Kafka topic
            ↓
  search-indexer consumer group
            ↓
    search projection handler
            ↓
   idempotent document upsert
            ↓
      checkpoint commit
```

The `search-indexer` consumer group is already canonical in `architecture/messaging.md`. Multiple instances share partitions; Search does not share a consumer group with Timeline projection or notification generation, so Search lag never blocks Timeline convergence and vice versa.

Indexing rules:

- consumers tolerate duplicate delivery and out-of-order retries;
- upserts are idempotent on the stable document ID;
- a document write carries the source event position so a later replay cannot regress a newer document;
- checkpoint advancement and document write are committed atomically where the store permits it, and are otherwise ordered so that a crash re-processes rather than skips;
- partial failure of one entity type must not stall unrelated entity types.

Authoritative writes never depend on Search indexing completing. A Moment is created successfully whether or not it is searchable yet.

---

# Index Versioning

Search indexes are versioned side by side, per ADR-018.

```text
search-v1
search-v2
```

A new version is required when the analyzer configuration, field weighting, document schema, eligibility encoding, or tokenization changes materially. Versions are built by replay, validated against the previous version, and cut over by pointing the read path at the new version.

Because the index is derived, a defective version is discarded rather than repaired in place.

---

# Rebuild

Full rebuild from authoritative history is a required, exercised capability rather than a theoretical property.

```text
authoritative history
        ↓
   bulk reindex job
        ↓
    search-vN index
        ↓
  validation sampling
        ↓
      cutover
```

Rebuild must apply current eligibility rules rather than the eligibility state that existed when history was originally written. A rebuild that resurrects previously restricted or deleted content is a privacy incident, not a stale cache.

Deleted PII must not return through replay, per ADR-038. The rebuild path reads current authoritative state for erased and restricted resources rather than reconstructing them from historical event payloads.

---

# Eligibility

Eligibility is evaluated in two stages, and both are mandatory.

```text
index time                 query time
──────────                 ──────────
visibility scope           viewer identity
searchability flag         viewer relationships
moderation state           block relationships
deletion state             age and safety context
age/safety classification  requested surface
```

Index-time eligibility stores what is intrinsic to the resource. Query-time eligibility resolves what depends on the requesting Viewer. Neither stage alone is sufficient: index-time filtering cannot know who is asking, and query-time filtering cannot recover a document that should never have been indexed.

Authorization is a prerequisite, never a ranking signal. A candidate is excluded before scoring, not demoted after it.

Searchability is a distinct eligibility dimension from visibility. Public accessibility does not imply broad Search indexing, and Search eligibility may be stricter than direct accessibility where safety policy requires it.

---

# Authorization-Aware Retrieval

Eligibility predicates are pushed into the retrieval query rather than applied after results return.

```text
correct:    filter in query → rank → paginate → return
incorrect:  rank → paginate → filter in application → return
```

Post-filtering leaks through page sizes, result counts, facet values, and pagination gaps even when the restricted document itself is never displayed.

Requirements:

- eligibility predicates are expressed in the retrieval interface and cannot be bypassed by a caller that forgets to pass them;
- the Viewer context is request scoped and never cached across requests;
- anonymous Viewers are an explicit context, not the absence of one;
- bounded over-fetching is permitted to satisfy a page after eligibility filtering, but the over-fetch factor is bounded and a sparse-result page is preferred over an unbounded scan;
- result counts, facets, and "no results" states are computed over eligible candidates only.

Every result is reauthorized when opened. Search rank does not grant access, and an old result reference does not preserve access that has since been revoked.

---

# Blocking

Block relationships are resolved at query time because they are viewer-dependent and change without any change to the underlying resource.

Blocking propagates through results, snippets, autocomplete, suggestions, facets, counts, and related-entity expansion. Directionality follows `product/social-graph.md`; the architecture supplies the enforcement point rather than the policy.

---

# Privacy Invalidation

Privacy changes must converge across every Search-derived artifact, per ADR-036.

```text
visibility change / deletion / restriction / block
                    ↓
            authoritative event
                    ↓
              search-indexer
                    ↓
   ┌────────────┬────────────┬────────────┐
   ▼            ▼            ▼            ▼
documents   autocomplete   facets    cached results
                            and counts
```

Rules:

- restriction and deletion events are processed at higher priority than ordinary content updates;
- Search indexing fails safe: when eligibility cannot be determined, the document is excluded rather than retained;
- cached result pages and snippet caches are keyed so that a privacy change invalidates them, and are short-lived enough that the failure mode is a stale exclusion rather than a stale disclosure;
- if embeddings are later introduced, they are invalidated on the same path as documents, because an embedding derived from private history is private history;
- Search history, if retained, is deleted on account deletion along with saved searches and personalization state, per ADR-037.

The existence of private history is itself sensitive. Autocomplete, suggestion, and facet paths receive the same eligibility treatment as primary results, not a relaxed one.

---

# Temporal Modeling

Occurrence time, publication time, and index time are three distinct fields and are never collapsed.

```text
occurred_at    when it happened      → temporal filters, chronological sort
published_at   when it entered       → "newly added" intent
indexed_at     when it became        → operational only, never user-facing ranking
               retrievable
```

Occurrence is stored with its precision rather than coerced to an instant:

```text
{ start, end, precision: year | month | day | instant }
```

A Moment known only as `Summer 1998` must not acquire a fabricated exact timestamp to make range filtering easier. Range predicates evaluate interval overlap against the stored interval, and the retrieval interface exposes whether a match was exact or approximate so the product can present uncertainty honestly.

Backfilled history is indexed by occurrence semantics, not ingestion order. A photograph from 1974 uploaded today is newly published and historically located in 1974, and both dimensions remain independently filterable and sortable.

Queries involving historical local dates resolve against the occurrence context rather than the Viewer's current time zone.

---

# Location Indexing

Location precision is indexed in tiers, and the retrieval layer selects the tier the Viewer is authorized to receive.

```text
tier 0   country / region
tier 1   city
tier 2   named place
tier 3   precise coordinates
```

Precise coordinates are never used to produce a result, distance, facet, map marker, autocomplete entry, or proximity match for a Viewer restricted to a coarser tier. Proximity computed from hidden precision is a disclosure even when the coordinates are not returned.

Historical Location identity is preserved. Shared coordinates do not imply the same historical Location, and Location documents index current names, historical names, and aliases without collapsing them into a single canonical string.

Nearby Search treats a supplied device Location as query input. It is never persisted as historical content, never becomes User presence, and never enters the index.

---

# Ranking

Ranking is a versioned, deterministic function over eligible candidates.

```text
eligible candidates
        ↓
  per-signal scoring
        ↓
  weighted combination        ← ranking_version
        ↓
 deterministic tie-break
        ↓
      ordered results
```

Day-one signals are exact match, lexical relevance, entity match, temporal match, filter match, and scope match. Historical significance participates as a bounded tie-breaker between comparably relevant candidates, never as a primary term.

Engagement is not a day-one ranking signal, matching the product specification's recommended default. If it is later introduced it is bounded and explicit, and it does not become a proxy for relevance.

Exact entity and phrase matches receive navigational priority through a distinct retrieval path rather than by inflating a relevance weight until exact matches happen to win.

Ranking behavior is versioned so that a material relevance change can be diagnosed, compared, and rolled back without touching authoritative history. Per-entity-type ranking is expected; a Location and a Moment do not share a scoring function.

Significance values are read from the significance projection with their version, per ADR-026. Search never computes significance and never writes it back.

---

# Result Ordering and Pagination

Relevance ordering requires a deterministic total order so repeated identical queries are stable:

```text
(score DESC, occurred_at DESC, entity_id ASC)
```

Search cursors are distinct from Timeline cursors and are not interchangeable. A Search cursor encodes the query, the applied filters, the ranking version, and the sort position.

```text
search cursor
├── query fingerprint
├── filter set
├── ranking_version
├── sort mode
└── position
```

A cursor whose ranking version or query fingerprint no longer matches is invalid and returns an explicit invalid-cursor result rather than silently re-ranking mid-pagination. Timeline keyset pagination semantics defined by ADR-024 govern chronological sort modes; relevance mode uses score-position cursors and does not claim keyset stability it cannot provide.

Alternate sort modes are explicit in the request. When chronological sort is selected, occurrence semantics govern ordering and relevance plays no part.

---

# Snippets and Highlights

Snippets are derived presentation generated from indexed authorized text at query time.

A snippet obeys the authorization, moderation, and privacy rules of the resource it represents. Snippets are not generated from fields the Viewer may not see, are not cached beyond the invalidation window, and never widen the field set returned by the result itself.

Highlighting explains why a result matched. It does not imply that the highlighted text is historically important.

---

# Explainability

The retrieval layer returns structured match reasons alongside results:

```text
exact_title_match | caption_match | alias_match | event_match
| location_match | temporal_match | person_match | scope_match
```

Match reasons are derived from the signals that actually contributed, not reconstructed post hoc by the client. Exposing every ranking weight is not required; being unable to explain an obvious result is not acceptable.

---

# Search to Timeline Handoff

Search resolves intent to an entity. It does not resolve historical context.

```text
search result (entity_type, entity_id)
            ↓
      apps/feed-aggregator
            ↓
 timeline context around entity
            ↓
   multidimensional navigation
```

The aggregator re-resolves the entity under current visibility rules. A Search result reference is not proof the destination remains visible, and Search ranking never influences the chronology of the Timeline the Viewer lands in.

Discovery recommendations attached to a Search response are produced by the Discovery path and are structurally distinguishable in the response from direct Search results. They are never merged into the ranked result list.

---

# Failure and Degradation

Search is not on the critical path for recording or navigating history.

- Search unavailability must not degrade Moment creation, Timeline navigation, or Feed reads.
- Indexing backlog produces missing recent results, never incorrect authorization.
- When the index is unavailable, exact entity lookup may degrade to authoritative PostgreSQL lookup, because that path is authorization-correct by construction.
- Degraded modes are visible to the Viewer as incomplete results rather than silently presented as complete.
- Zero results returns zero results. The system never substitutes loosely related history to avoid an empty state.

---

# Scale

The Search corpus grows monotonically and its value increases with age. Search must not be scaled by discarding old history.

Expected pressure points and their responses:

```text
corpus growth          → index partitioning by entity type, then by
                         occurrence range only if measured to help
write amplification    → batch upserts, coalesce rapid edits per document
alias and text bloat   → bounded alias sets with provenance, not unbounded
                         synonym expansion
eligibility fan-out    → index-time denormalization of intrinsic eligibility
reindex cost           → side-by-side version build, throttled bulk replay
```

Sharding is introduced only after a measured bottleneck, per ADR-052. Partitioning strategies that improve recent-history latency at the cost of deep-history recall are rejected, because deep-history recall is the product.

---

# Observability

Search-specific operational signals:

- indexing lag per entity type, measured from authoritative event to document visibility;
- restriction and deletion propagation latency, tracked separately from ordinary indexing lag and alarmed more aggressively;
- query latency by entity type and sort mode;
- zero-result rate and its trend;
- eligibility filter rejection rate, as a leading indicator of index eligibility drift;
- reindex progress and validation sampling results;
- ranking version in query traces.

Indexing lag is a product-relevant metric, not merely an infrastructure one: it is the delay between something becoming true and becoming findable. Privacy propagation latency is a safety metric and is treated as such.

Query text is sensitive. Raw queries are not logged into general application logs; where retained for quality analysis, retention is bounded and access is controlled.

---

# Testing Strategy

Required coverage beyond ordinary unit testing:

- authorization tests asserting that ineligible documents never appear in results, counts, facets, autocomplete, or snippets;
- block propagation tests across every Search surface;
- deletion and restriction propagation tests, including the rebuild path;
- idempotency tests replaying duplicate and out-of-order events into the indexer;
- rebuild tests asserting that a rebuilt index applies current eligibility rather than historical eligibility;
- temporal precision tests asserting that approximate occurrence is not coerced to false precision;
- Location precision tests asserting that no coarse-tier Viewer receives a result, distance, or facet derived from a finer tier;
- ranking regression tests pinned to a ranking version;
- integration tests against a real Search store rather than an in-memory substitute.

Privacy correctness is a test category, not a review checklist item.

---

# Day-One Search Requirements

The initial implementation must provide:

- a Search read path in `apps/api` over REST;
- a `search-indexer` consumer applying idempotent document upserts;
- versioned index definitions and an exercised rebuild path;
- Moment, User or Person as applicable, Timeline, Event, and Location document types;
- exact entity lookup with navigational priority;
- lexical keyword Search with typo tolerance;
- launch-critical structured filters;
- temporal filtering that preserves occurrence precision;
- viewer-safe Location precision tiers;
- two-stage eligibility with query-pushed authorization predicates;
- block, moderation, deletion, and privacy-change propagation;
- reauthorization when a result is opened;
- deterministic result ordering with explicit sort modes;
- authorized snippets and structured match reasons;
- zero-result behavior that does not fabricate history;
- Search-to-Timeline handoff through the feed aggregator;
- indexing-lag and privacy-propagation observability.

The initial implementation does not require a dedicated Search engine, vector embeddings, semantic retrieval, natural-language query planning, transcript or OCR indexing, saved searches, personalization, or multilingual semantic retrieval.

---

# Recommended Initial Search Architecture

```text
apps/api
├── features/search/
│   ├── routes            REST query surface
│   ├── queries           query interpretation, filter validation
│   ├── retrieval         store-agnostic retrieval interface
│   ├── eligibility       viewer-context predicate construction
│   ├── ranking           versioned scoring per entity type
│   └── presentation      snippets, match reasons, result context
└── workers/search-indexer/
    ├── consumers         Kafka subscription, checkpointing
    ├── documents         per-entity-type document builders
    └── reindex           bulk replay and version cutover

PostgreSQL
└── search-v1             documents, eligibility columns, indexes
```

The retrieval interface is the seam that keeps the eventual engine decision cheap. Query construction, eligibility predicates, and ranking live above it; store syntax lives below it.

---

# Open Architectural Questions

- When is a dedicated Search engine introduced, and against what measured threshold?
- Does the Search read path remain REST-only, or does a GraphQL Search surface eventually belong in the feed aggregator once scoped Search within a Timeline or Event ships?
- Is Search projection code owned by the API application or by a future dedicated Search application?
- Should Search documents be built from Kafka integration events only, or may the indexer read authoritative state to resolve associations it cannot derive from a single event?
- What is the acceptable indexing lag budget, and separately, the maximum acceptable privacy-propagation latency?
- How are eligibility columns kept correct when authorization policy itself changes rather than when a resource changes?
- Does an authorization-policy change require a full reindex, a targeted re-evaluation pass, or query-time compensation?
- How is the over-fetch bound chosen for sparse eligible result sets without creating an unbounded scan?
- Should facet counts be computed at all on day one, given their leakage surface?
- How are duplicate Events and Locations represented in the index before reconciliation, and what happens to cursors when they merge?
- Should Comments be indexed, and if so does a Comment match return the Comment or its Moment?
- Where do embeddings live if semantic Search is introduced, and how is their invalidation proven rather than assumed?
- How is ranking-version rollout staged without invalidating every in-flight cursor?
- Should Search maintain its own result cache, or rely entirely on store-level performance?
- How is Search history stored such that deletion is complete and verifiable?
- What is the retention and access policy for raw query text in analytics?

These should be resolved before the Search subsystem hardens privacy, identity, or ranking assumptions that are expensive to reverse.

---

# Architectural Invariants

1. Search indexes are derived, disposable, rebuildable state.
2. A Search index is never authoritative for any entity.
3. Search retrieval is owned by `apps/api`; Search indexing is owned by projection workers.
4. The feed aggregator resolves Search results into Timeline context but does not own Search.
5. PostgreSQL is the day-one Search store; a dedicated engine remains an open decision.
6. ClickHouse Timeline read models are not a Search substitute.
7. Search documents are per entity type; history is not flattened into one document shape.
8. A Moment is one Search document regardless of media count.
9. Document IDs are stable so indexing is idempotent.
10. Stable entity identity is independent of names, aliases, and external identifiers.
11. Authoritative writes never depend on Search indexing.
12. Search indexing tolerates duplicate and out-of-order delivery.
13. Indexes are versioned and cut over side by side.
14. Rebuild applies current eligibility, never historical eligibility.
15. Deleted PII does not return through replay.
16. Eligibility is enforced at both index time and query time.
17. Authorization precedes ranking and is never a ranking signal.
18. Eligibility predicates are pushed into retrieval, not applied after pagination.
19. Viewer context is request scoped and never shared across requests.
20. Anonymous access is an explicit Viewer context.
21. Counts, facets, and zero-result states are computed over eligible candidates only.
22. Searchability is distinct from visibility and from discoverability.
23. Search eligibility may be stricter than direct accessibility.
24. Blocking propagates through every Search surface.
25. Privacy changes invalidate documents, autocomplete, facets, snippets, caches, and embeddings.
26. Restriction and deletion propagation outrank ordinary indexing throughput.
27. Search indexing fails safe by excluding rather than retaining.
28. Occurrence time, publication time, and index time remain distinct.
29. Temporal precision and uncertainty are preserved rather than coerced.
30. Backfilled history is indexed by occurrence, not ingestion.
31. Location precision is tiered and viewer-safe.
32. Proximity derived from hidden precision is a disclosure and is prohibited.
33. Historical Location identity is preserved across shared coordinates.
34. Device Location is query input and never becomes historical content.
35. Ranking is versioned, deterministic, and diagnosable.
36. Historical significance is a bounded tie-breaker read from the significance projection.
37. Search never computes or writes significance.
38. Engagement is not a day-one ranking signal.
39. Exact matches receive navigational priority through a distinct retrieval path.
40. Result ordering is a deterministic total order.
41. Search cursors are distinct from Timeline cursors and encode ranking version.
42. Chronological sort modes use occurrence semantics exclusively.
43. Snippets obey the authorization rules of the resource they represent.
44. Match reasons are derived from contributing signals.
45. Field provenance distinguishes authored, structured, derived, and inferred data.
46. Inferred metadata never becomes an authoritative historical assertion.
47. Retrieval relationships never create causal, Event, Person, or Location facts.
48. Every result is reauthorized when opened.
49. Search unavailability never degrades writes, Timeline, or Feed.
50. Zero results are returned as zero results.
51. Discovery recommendations remain structurally distinct from Search results.
52. Search scales without excluding old history.
53. Sharding follows a measured bottleneck.
54. Indexing lag and privacy-propagation latency are monitored separately.
55. Raw query text is treated as sensitive data.
56. Privacy correctness is a required test category.
57. Store-specific query syntax stays below the retrieval interface.
58. This document changes when Search boundaries intentionally change.

---

# Guiding Principle

When adding behavior to the Search subsystem, ask:

> **Is this behavior helping a Viewer locate history they are already permitted to retrieve—or is it letting an index decide what history means, who may see it, or when it happened?**

Search finds history. It never defines it.
