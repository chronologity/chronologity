# Chronologity Documentation

## Purpose

This directory contains the authoritative product, architecture, data, API, event, engineering, operations, security, and architectural-decision documentation for Chronologity.

The documentation exists to make important product and technical decisions explicit before those decisions become implicit in code.

Chronologity should prefer:

```text
Product semantics
      ↓
Architecture
      ↓
Implementation
```

rather than:

```text
Implementation convenience
      ↓
Accidental architecture
      ↓
Accidental product semantics
```

Documentation should explain **why a constraint exists**, define the invariants that implementations must preserve, and clearly distinguish settled decisions from open questions.

## Documentation Principles

1.  Product semantics should be defined before architecture depends on them.
2.  Architecture documents should explain how the system preserves product invariants without redefining them.
3.  Implementation-specific documentation should not silently introduce new product behavior.
4.  Open questions should remain explicit rather than being answered accidentally during implementation.
5.  Resolved decisions should be removed from open-question lists and stated as invariants or requirements.
6.  Documentation should distinguish conceptual models from required persistence models.
7.  A domain concept does not automatically require a dedicated service, database, aggregate, table, topic, or API.
8.  Derived data must preserve the semantics, privacy, and integrity of its source information.
9.  Documentation should be updated when a product or architecture decision changes.
10. Architectural decisions with meaningful alternatives or long-term consequences should be captured in ADRs.

## Documentation Map

The required preimplementation documentation structure is:

```text
docs/
├── README.md
├── glossary.md
│
├── product/
│   ├── vision.md
│   ├── concepts.md
│   ├── moments.md
│   ├── timelines.md
│   ├── timeline.md
│   ├── causality.md
│   ├── historical-significance.md
│   ├── users.md
│   ├── identity.md
│   ├── social-graph.md
│   ├── comments.md
│   ├── reactions.md
│   ├── real-world-events.md
│   ├── locations.md
│   ├── feed.md
│   ├── discovery.md
│   ├── search.md
│   ├── notifications.md
│   ├── media.md
│   ├── privacy.md
│   ├── moderation.md
│   └── accessibility.md
│
└── architecture/
    ├── overview.md
    ├── principles.md
    ├── monorepo.md
    ├── api.md
    ├── authentication.md
    ├── authorization.md
    ├── events.md
    ├── messaging.md
    ├── projections.md
    ├── data-storage.md
    ├── timeline.md
    ├── feed.md
    ├── search.md
    ├── media.md
    ├── notifications.md
    ├── caching.md
    ├── privacy.md
    ├── security.md
    ├── scalability.md
    ├── observability.md
    ├── deployment.md
    ├── testing.md
    └── decisions.md
```

This map is canonical for the documentation required before implementation begins. It is intentionally smaller than earlier proposed taxonomies. Focused `data/`, `api/`, `events/`, `engineering/`, `operations/`, `security/`, or ADR documentation may be introduced later when implementation creates a concrete need for it; those directories are not prerequisites for implementation and should not be created speculatively.

---

# Root Documents

## `README.md`

The document you are reading.

It defines the documentation taxonomy, responsibilities of each documentation area, canonical document inventory, naming conventions, and recommended authoring sequence.

## `glossary.md`

Defines canonical Chronologity terminology used across product and engineering documentation.

It should resolve ambiguous terms such as Moment, Timeline, Feed, Event, occurrence time, creation time, context, historical jump, temporal zoom, projection, aggregate, domain event, and read model.

The glossary should describe terminology rather than replace the deeper specifications that define each concept.

---

# Product Documentation

The `product/` directory defines **what Chronologity means and how it should behave from the user's perspective**.

Product documents should avoid prescribing implementation technologies unless a technical constraint is itself a settled product requirement.

Architecture must conform to these semantics rather than reinterpret them for convenience.

## `product/vision.md`

Defines Chronologity's product vision, philosophy, goals, differentiation, and foundational principles.

It establishes the reason Chronologity exists and the kind of product it intends to become.

## `product/concepts.md`

Defines the core conceptual vocabulary and relationships used throughout Chronologity.

It provides a common semantic foundation for more detailed product specifications.

## `product/moments.md`

Defines Moment identity, occurrence semantics, media behavior, lifecycle, editing, historical integrity, and product invariants.

A Moment represents an experience rather than a file or social-media post. A Moment may contain an unlimited number of images and videos at the product-model level, while each individual video has a maximum duration of 90 seconds.

## `product/timelines.md`

Defines what a Timeline is at the product-model level.

A Timeline is a derived chronological representation of Moments rather than a user-created collection, independently owned container, or manually maintained list.

## `product/timeline.md`

Defines how users experience and navigate the Timeline.

It specifies vertical chronology, horizontal context, depth into a Moment, temporal orientation, temporal zoom, historical jumps, navigation continuity, and related interaction invariants. Temporal zoom and historical jumps are required from the initial product release.

## `product/causality.md`

Defines causal and semantic relationships between Moments.

It establishes that chronology does not imply causality, preserves relationship direction and provenance, and treats system- or AI-generated causal suggestions as hypotheses rather than historical facts.

## `product/historical-significance.md`

Defines how Chronologity understands the contextual historical significance of a Moment.

It establishes significance as multidimensional rather than engagement-driven, distinguishes historical significance from display salience, and defines significance as a foundational input to day-one temporal zoom and historical jumps.

## `product/users.md`

Defines the User as a product actor, including account-level semantics, lifecycle, participation in Chronologity, and relationships between a User and the history they create or interact with.

It should avoid conflating account identity, public profile, social relationships, and people represented in Moments.

## `product/identity.md`

Defines identity and profile semantics, including names, handles, profile information, discoverability, representation of people, and distinctions between Chronologity Users and people who may appear in historical records without accounts.

It should also establish which identity attributes are stable, mutable, unique, public, or privacy-sensitive.

## `product/social-graph.md`

Defines Chronologity's social relationship model independently of Feed implementation.

It should specify whether relationships are directional or symmetric, following/subscription semantics, blocking implications, privacy interactions, and how social relationships affect access or discovery without redefining chronology.

## `product/comments.md`

Defines comments as discussion around Moments, including authorship, ordering, editing, deletion, visibility, moderation, and lifecycle.

Comment activity must remain distinct from the occurrence semantics of the underlying Moment.

## `product/reactions.md`

Defines lightweight reactions to Moments and potentially comments.

It should specify supported reaction semantics, uniqueness, replacement/removal behavior, counts, privacy, and the principle that engagement does not redefine historical importance or chronological position.

## `product/real-world-events.md`

Defines real-world Events as historical context, such as a concert, conference, wedding, festival, or other occurrence that may connect multiple Moments.

This name deliberately distinguishes real-world Events from software/domain events used by the architecture.

## `product/locations.md`

Defines location semantics for Moments and contextual navigation.

It should address location identity, precision, hierarchy, named places, geographic coordinates, historical locations, automatic grouping, correction, and privacy.

## `product/feed.md`

Defines the social Feed and establishes how it differs from the Timeline.

It should specify what enters the Feed, its ordering semantics, subscription/following behavior, pagination expectations, and which forms of ranking or curation are prohibited or permitted.

## `product/discovery.md`

Defines how users discover Moments, people, Events, locations, and other relevant historical context outside direct chronological navigation.

Discovery may determine what a user encounters but must not redefine the historical position or truth of the discovered information.

## `product/search.md`

Defines search semantics across Chronologity.

It should establish searchable entities, relevance behavior, privacy constraints, historical entry-point behavior, and the distinction between search-result ranking and Timeline ordering.

## `product/notifications.md`

Defines user-facing notification semantics.

It should cover notification causes, aggregation, read state, delivery expectations, privacy-sensitive previews, historical context, and the distinction between recent activity and the occurrence time of the Moment involved.

## `product/media.md`

Defines the product experience around images and videos independent of storage and transcoding implementation.

It should cover unlimited media per Moment, mixed media, media ordering, the 90-second per-video limit, playback, editing/trimming expectations, partial upload behavior, processing states visible to users, and presentation of very large Moments.

## `product/privacy.md`

Defines privacy, visibility, location sensitivity, people and tagging, inference, search/discovery boundaries, temporal zoom and historical-jump privacy, deletion, retention, internal access, AI privacy, and related product invariants.

Privacy is treated as a foundational product property rather than a single visibility flag.

## `product/moderation.md`

Defines reporting, blocking, content restrictions, enforcement, removal, appeals, and the relationship between historical integrity and safety.

It must make clear that preserving history does not require Chronologity to continue distributing abusive, illegal, or otherwise prohibited content.

## `product/accessibility.md`

Defines accessibility requirements across the product.

It should cover Timeline navigation, temporal zoom, historical jumps, media, captions, screen-reader semantics, reduced motion, keyboard/switch interaction where applicable, contrast, and alternatives to spatial or gesture-only interactions.

---

# Architecture Documentation

The `architecture/` directory defines **how the major system components work together to preserve the product model**.

These documents should describe boundaries, flows, guarantees, tradeoffs, and architectural patterns rather than low-level implementation details already covered by focused technical documents.

## `architecture/overview.md`

Provides the authoritative high-level architecture of Chronologity.

It should describe the API, EventStoreDB, PostgreSQL, Kafka, ClickHouse, media infrastructure, Feed Aggregator, mobile application, web application, shared packages, and major data flows.

## `architecture/principles.md`

Defines the architectural principles governing technical decisions.

Examples include explicit contracts, event-driven boundaries, disposable projections, idempotent consumers, separation of writes and read models, product semantics over implementation convenience, and avoiding premature service decomposition.

## `architecture/monorepo.md`

Explains the monorepo boundaries and responsibilities of applications, packages, infrastructure, scripts, and documentation.

It should complement the repository directory structure without merely duplicating it.

## `architecture/api.md`

Defines the role and boundaries of the primary Fastify API.

It should explain which responsibilities belong in the API, how commands and queries enter the system, and which concerns belong elsewhere.

## `architecture/authentication.md`

Defines the architecture for establishing user identity and session authenticity.

It should describe authentication flows, tokens, renewal strategy if applicable, trust boundaries, and integration with the User model.

## `architecture/authorization.md`

Defines how Chronologity decides whether an authenticated actor may perform an operation or access information.

It should address source data and derived views, including Timeline projections, ClickHouse, search, media, historical jumps, and contextual aggregates.

## `architecture/events.md`

Explains the architectural role of domain and integration events.

It should distinguish the Integration Events that cross service boundaries from the product concept of real-world Events, and say what belongs in a published payload.

## `architecture/messaging.md`

Defines asynchronous messaging architecture, especially Kafka.

It should cover topics, partitioning principles, consumer groups, delivery semantics, retries, dead-letter behavior, idempotency, ordering, and the relationship between persisted events and published messages.

## `architecture/projections.md`

Defines how read models are derived and maintained.

It should cover projection ownership, replay/rebuild, checkpoints, idempotency, consistency, failure recovery, and privacy-sensitive projection changes.

## `architecture/timeline.md`

Translates Timeline product requirements into technical query and read-model architecture.

Because temporal zoom and historical jumps are day-one features, this document must address temporal indexing, scale-aware retrieval, distant jumps, sparse and dense history, contextual switching, cursor semantics, authorization, and navigation continuity from the beginning.

## `architecture/feed.md`

Defines the architecture of the Feed Aggregator and chronological feed read path.

It should explain the role of ClickHouse, ingestion/projection flow, GraphQL boundary, subscription filtering, ordering, pagination, and scaling strategy.

## `architecture/search.md`

Defines the technical architecture supporting product search.

It should specify indexing boundaries, synchronization, authorization-aware retrieval, relevance versus chronology, and how search results establish Timeline entry points.

## `architecture/media.md`

Defines end-to-end media architecture.

It should cover uploads, object storage, metadata, image processing, video transcoding, job lifecycle, delivery, caching, deletion, partial failures, and the implications of unlimited media per Moment.

## `architecture/notifications.md`

Defines notification generation and delivery architecture.

It should cover event triggers, projection/state requirements, deduplication, aggregation, delivery channels, read state, retries, and privacy.

## `architecture/data-storage.md`

Provides the high-level allocation of data responsibilities across EventStoreDB, PostgreSQL, ClickHouse, object storage, caches, and any future stores.

It should explain why each store exists and prohibit casual duplication of authoritative responsibilities.

## `architecture/caching.md`

Defines caching principles and boundaries.

It should cover cache eligibility, invalidation, authorization-sensitive data, media caching, Timeline navigation, and the principle that caches are disposable rather than authoritative.

## `architecture/privacy.md`

Translates `product/privacy.md` into cross-system technical guarantees.

It should address authorization-aware projections, deletion, revocation, caches, Kafka, EventStoreDB, PostgreSQL, ClickHouse, media storage, logs, analytics, and derived data.

## `architecture/security.md`

Defines the high-level security architecture and trust boundaries.

Detailed controls belong in `security/`, while this document explains how security concerns shape the overall system.

## `architecture/scalability.md`

Defines scaling assumptions, expected pressure points, partitioning strategies, horizontal scaling boundaries, and the architectural response to growth.

It should distinguish day-one correctness requirements from capacity optimizations that can evolve later.

---

# Implementation-Driven Documentation

Additional focused documentation should be created when implementation makes its subject concrete enough to document usefully. Examples may include data-store schemas and migration procedures, public API conventions, event-contract rules, engineering standards, operational runbooks, detailed security controls, and individual ADRs.

These are not part of the mandatory preimplementation inventory. A new documentation area should be introduced only when it has a durable responsibility that is not already adequately covered by the product or architecture specifications.

`architecture/decisions.md` remains the current consolidated architecture decision ledger. Individual ADR files may be introduced prospectively for consequential implementation decisions when that format becomes useful; existing decisions do not need to be retroactively split into separate ADR files.

---

# Important Naming Distinctions

Chronologity uses several terms that can otherwise become ambiguous.

## Real-World Events Versus Software Events

```text
product/real-world-events.md
    → Historical real-world Events
      Example: Anime NYC 2026

architecture/events.md
    → Architectural role of software/domain events

events/*
    → Software event contract rules
```

The product document is intentionally named `real-world-events.md` to prevent ambiguity.

## Timeline Product Model Versus Timeline Experience Versus Timeline Architecture

```text
product/timelines.md
    → What a Timeline is

product/timeline.md
    → How a user experiences and navigates it

architecture/timeline.md
    → How the system technically supports it
```

## Product Privacy Versus Architecture Privacy Versus Security

```text
product/privacy.md
    → What privacy means to the user

architecture/privacy.md
    → How systems preserve those guarantees

security/*
    → Detailed defensive controls and threat mitigation
```

## Product Media Versus Media Architecture Versus Media Storage

```text
product/media.md
    → User-facing media semantics

architecture/media.md
    → End-to-end media system design

data/media-storage.md
    → Object-storage organization and lifecycle

security/media-security.md
    → Media-specific security controls
```

## Product Feed Versus Feed Architecture

```text
product/feed.md
    → Feed behavior and semantics

architecture/feed.md
    → Feed Aggregator, projections, ClickHouse, GraphQL, and scaling
```

---

# Recommended Authoring Sequence

The canonical authoring sequence begins with the product layer:

```text
1. product/vision.md
2. product/concepts.md
3. product/moments.md
4. product/timelines.md
5. product/timeline.md
6. product/causality.md
7. product/historical-significance.md
8. product/users.md
9. product/identity.md
10. product/social-graph.md
11. product/comments.md
12. product/reactions.md
13. product/real-world-events.md
14. product/locations.md
15. product/feed.md
16. product/discovery.md
17. product/search.md
18. product/notifications.md
19. product/media.md
20. product/privacy.md
21. product/moderation.md
22. product/accessibility.md
23. glossary.md
24. architecture/overview.md
25. architecture/principles.md
26. architecture/monorepo.md
```

After `architecture/monorepo.md`, the remaining architecture documents are authored in dependency order through `architecture/decisions.md`. With that architecture set complete, the preimplementation documentation phase is complete.

Further focused documentation should be authored alongside implementation when concrete contracts, schemas, operational procedures, or consequential new decisions require it.

---

# Documentation Authority

When documents overlap, use the following hierarchy of responsibility:

```text
Product documentation
    ↓ defines required semantics

Architecture documentation
    ↓ defines system design preserving those semantics

Implementation and focused technical documentation
    ↓ define concrete interfaces, schemas, practices, and runtime procedures

Architecture decision records, when introduced
    ↓ explain why consequential new architectural choices were made
```

An architecture document should not override a settled product invariant without the corresponding product documentation being intentionally revised.

An ADR should not become a substitute for current architecture documentation. ADRs preserve decision history; architecture documents describe the current system.

## Code Versus Documentation

Code may reveal what the system currently does, but authoritative documentation defines what the system is intended to do.

When code and documentation disagree, the discrepancy should be investigated rather than automatically assuming either side is correct.

If implementation intentionally changes a documented contract or invariant, the relevant documentation should change in the same work.

---

# Document Structure Guidelines

Documents do not need to follow an identical template, but substantial specifications should generally include:

```text
# Title

## Purpose

## Core concepts / definitions

## Semantics or architecture

## Invariants / guarantees

## Day-one requirements, where applicable

## Open questions

## Guiding principle, where useful
```

Use diagrams, tables, and examples when they make semantics clearer.

Long Markdown lines are acceptable. Documentation should optimize for clarity rather than an arbitrary line-length limit.

## Open Questions

Open questions are first-class documentation.

They should identify decisions that genuinely remain unresolved.

Once a question is answered:

1.  update the relevant specification;
2.  remove the question from the open-question section;
3.  add the resulting rule to the appropriate requirements or invariants; and
4.  update dependent documents if the decision changes their assumptions.

## Resolved Decisions

A settled decision should not remain phrased as tentative language such as:

```text
may
possibly
eventually
could
```

when the product has actually committed to it.

Use definitive language for definitive decisions.

---

# Current Foundational Product Decisions

The following decisions are already established and should remain consistent throughout future documentation.

## Timeline

```text
Timeline is derived chronology.
Timeline is not a user-created container by default.
Users create Moments, not Timelines.
Occurrence semantics determine historical position.
Temporal zoom is required from day one.
Historical jumps are required from day one.
```

## Moments and Media

```text
A Moment represents an experience.
A Moment may contain unlimited images.
A Moment may contain unlimited videos.
Images and videos may coexist in one Moment.
Each individual video has a maximum duration of 90 seconds.
The 90-second limit is not cumulative across a Moment.
Media count does not determine Moment boundaries.
```

## Causality

```text
Chronology does not imply causality.
Causal relationships require an explicit basis.
AI causal suggestions are hypotheses, not historical facts.
Relationship traversal does not alter chronology.
```

## Privacy

```text
Privacy applies to source and derived data.
Timeline context cannot bypass Moment privacy.
Temporal zoom cannot bypass privacy.
Historical jumps cannot bypass privacy.
Event sourcing does not override deletion or erasure requirements.
```

## Historical Significance

```text
Historical significance is contextual and multidimensional.
Historical significance is distinct from engagement, popularity, and display salience.
Engagement does not determine historical importance.
Historical significance is a foundational input to temporal zoom.
Historical significance may evolve as later history provides new causal, structural, Event, or retrospective context.
Significance-driven presentation cannot bypass privacy or authorization.
The primary Feed remains chronological rather than significance-ranked.
```

These summaries are navigation aids. The authoritative details remain in their respective product specifications.

---

# Maintaining This README

Update this document when:

- a documentation file is added, removed, or renamed;
- the canonical authoring sequence changes;
- a new implementation-driven documentation area is intentionally introduced;
- naming collisions are resolved;
- a foundational product decision materially changes the documentation map; or
- responsibilities move between documents.

This README should remain the first place a contributor looks to answer:

> What documentation exists?

> What belongs where?

> What should we write next?

> Which document is authoritative for this question?
