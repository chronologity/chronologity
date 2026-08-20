# Chronologity Architecture Principles

## Purpose

This document defines the architectural principles that govern the design and implementation of Chronologity.

These principles translate the product model and high-level architecture into durable engineering rules. They are intended to guide decisions when multiple technically valid implementations are possible and to prevent local implementation convenience from gradually changing the system's product semantics.

The hierarchy is:

```text
Product invariants
       ↓
Architecture principles
       ↓
Focused architecture decisions
       ↓
Implementation
```

A principle is not a preference that may be ignored whenever it becomes inconvenient. If a concrete design needs to violate one of these principles, that exception should be explicit, justified, narrow, and usually recorded as an Architecture Decision Record.

---

# 1. Product Semantics Are Architectural Constraints

Chronologity's architecture exists to implement the product model.

It must not redefine that model merely because a database, framework, queue, API style, or UI implementation makes another representation easier.

Examples:

- occurrence time must not become publication time because `created_at` is convenient to sort;
- Moments must not acquire a hidden media-count limit because an API endpoint returns one bounded page;
- Timelines must not become stored user-created containers because CRUD is easier than deriving them;
- historical significance must not become engagement ranking because Reaction counts are readily available;
- historical jumps must not become sequential pagination because cursor pagination already exists;
- spatial Timeline coordinates must not become authoritative historical data because the client renders history in 3D.

When architecture and settled product semantics conflict, the product semantics take precedence unless the product decision itself is intentionally revised.

---

# 2. Time Is a First-Class Domain Dimension

Chronologity must model time explicitly.

At minimum, the system must distinguish concepts such as:

```text
occurrence time
publication time
upload time
processing time
event persistence time
projection time
notification time
```

These timestamps answer different questions and must not be used interchangeably.

Occurrence time determines where represented history belongs.

Operational timestamps describe what Chronologity did with that history.

This distinction must survive:

- persistence;
- domain events;
- API contracts;
- projections;
- Feed ordering;
- Timeline queries;
- Search;
- Discovery;
- notifications;
- analytics;
- logging;
- and debugging.

Generic fields such as `createdAt` should not be allowed to obscure domain meaning where the distinction matters.

---

# 3. Historical Meaning Is Independent of Ingestion Order

Chronologity must assume that history arrives out of order.

A Moment representing 1998 may be uploaded after a Moment representing 2026.

A newly created record can therefore belong deep inside an existing Timeline.

The architecture must not depend on append order, event-store position, Kafka offset, database sequence, or publication timestamp as a substitute for historical chronology.

Operational order and historical order are different dimensions.

Backfilled history is normal product behavior, not an exceptional repair case.

---

# 4. Authoritative State Must Be Explicit

Every durable data category must have a clearly defined authority.

For any important piece of state, engineers should be able to answer:

> **What is the authoritative source from which this state can be reconstructed or validated?**

Possible answers may include:

- an authoritative PostgreSQL row;
- object storage for a media binary;
- or another explicitly designated source.

Answers must not include:

- "whichever projection is freshest";
- "probably ClickHouse";
- "the cache";
- "the Kafka topic";
- or "both databases."

Multiple systems may contain representations of the same concept, but only the appropriate source should own the authoritative decision.

---

# 5. Derived State Must Remain Derived

Read models, indexes, caches, aggregates, clusters, summaries, and rankings exist to serve product reads efficiently.

They must not silently become authoritative because they are convenient to query.

Examples include:

- Feed rows;
- Timeline projections;
- Search indexes;
- Discovery candidates;
- Reaction counts;
- historical-significance calculations;
- notification projections;
- Event summaries;
- Location summaries;
- media derivatives;
- and caches.

Derived state should be rebuildable where practical and should carry enough provenance or versioning to understand how it was produced when that matters.

---

# 6. Event-Driven, Not Event-Sourced

Chronologity publishes events. It does not store them as the source of truth
(ADR-092).

PostgreSQL holds authoritative state, and a change announces itself through the
transactional outbox. What makes something true is that a row was committed; the
event says it happened.

The distinction matters because the two are easy to conflate:

```text
event-driven      changes are announced, and other systems react
event-sourced     the log of changes IS the state
```

Auditability was the strongest argument for the second, and it did not require
it: an audit row written in the same transaction as the change it describes is
both queryable and erasable, which an append-only log is not.

Where the sequence of decisions genuinely matters — a role granted then removed,
a Session revoked for a stated reason — that sequence is recorded explicitly in
an audit table designed for it, rather than implied by the shape of the
persistence layer.

---

# 7. Domain Events and Integration Events Are Different Responsibilities

A Domain Event is a past-tense fact the API accepted. It is a way of describing
a change, not a stored artifact.

An Integration Event communicates that change across an application or subsystem
boundary. It is a versioned contract, constructed explicitly by the service that
publishes it.

Chronologity should preserve the ability to evolve internal state without
forcing external consumers to depend on its schema.

Likewise, integration contracts should not dictate how a feature internally
models its state.

This separation becomes increasingly valuable as the system evolves.

---

# 8. Kafka Is Transport, Not Truth

Kafka is Chronologity's asynchronous integration backbone.

Kafka is not the authoritative domain database.

Consumers must be able to reason about messages as deliveries of changes rather than as the only surviving historical record.

Kafka retention, compaction, partitioning, consumer offsets, or operational failure must not define product truth.

Where replay from Kafka is useful, it is an operational capability, not a substitute for clearly owned authoritative state.

---

# 9. Persist Before Publishing

Chronologity must not announce an authoritative domain change before that change has been durably committed.

The conceptual ordering is:

```text
Decide
  ↓
Persist authoritative change
  ↓
Reliably publish integration change
```

The exact reliable-publication mechanism remains a focused architectural decision.

However, the system must avoid a design in which a Kafka message can be successfully observed for a domain change that subsequently fails to commit.

Likewise, a successful authoritative commit must not be permanently lost to downstream consumers because publication failed once.

---

# 10. Asynchronous Consumers Must Be Idempotent

Duplicate delivery is normal in distributed systems.

Consumers must therefore be safe when processing the same logical message more than once.

This applies to:

- projections;
- Feed ingestion;
- Search indexing;
- notification generation;
- media processing;
- analytics consumers;
- cleanup workflows;
- and other retryable side effects.

Exactly-once business behavior should be achieved through idempotent processing and appropriate state management rather than assumed from transport semantics.

---

# 11. Ordering Guarantees Must Be Scoped

Chronologity must not assume a single global event order.

Ordering requirements should be defined at the smallest meaningful scope.

Examples may include:

- per-subject order within a partition;
- Moment media order;
- events for a particular entity;
- or another explicit partitioning key.

A global ordering dependency would unnecessarily constrain scalability and still would not represent historical chronology, because historical occurrence order can differ from ingestion order.

---

# 12. Separate Models Where They Differ, Not Everywhere

Chronologity separates the authoritative write model from the Timeline read
model, because the two have materially different shapes and access patterns.

That separation runs between applications — the API and the feed aggregator. It
does not run through the middle of a feature. Inside the API there is no
command/query split: reading and writing the same PostgreSQL tables through one
service is simpler and no less correct (ADR-091).

Separation does not mean:

```text
one operation = one class and one file
read          = its own directory
```

The write model should protect domain invariants.

Read models should serve product access patterns.

These responsibilities may coexist inside the same deployable application until a concrete reason justifies separation.

Logical separation is required.

Operational fragmentation is not.

---

# 13. Prefer a Modular Monolith Before Microservices

Chronologity should begin with strong modular boundaries inside a small number of deployable applications.

A new service boundary must earn its operational cost.

Good reasons include:

- materially different scaling characteristics;
- resource isolation;
- independent availability requirements;
- security or trust separation;
- incompatible technology requirements;
- or an independently owned deployment lifecycle.

"Microservices scale better" is not sufficient.

A well-structured modular application is easier to understand, test, change, and operate while the product and domain are still evolving.

---

# 14. Feature Boundaries Are Primary

Within applications, Chronologity should organize domain and product behavior primarily by feature rather than by technical layer.

Prefer structures such as:

```text
moments/
users/
reactions/
comments/
privacy/
```

over global buckets such as:

```text
controllers/
services/
repositories/
models/
```

Technical abstractions may exist inside a feature where needed.

Feature organization keeps related commands, queries, events, handlers, projections, schemas, and tests close to the domain behavior they implement.

This principle also makes future extraction of a feature boundary more tractable if a service split later becomes justified.

---

# 15. Dependencies Flow Toward Domain Meaning

Frameworks and infrastructure should depend on domain/application contracts rather than domain behavior depending directly on infrastructure details.

Conceptually:

```text
Routes / transport
       ↓
Application behavior
       ↓
Domain behavior
       ↑
Ports / interfaces
       ↑
Infrastructure adapters
```

Chronologity should avoid allowing Fastify, Kafka, PostgreSQL, ClickHouse, Expo, or another technology to become the vocabulary of the domain model.

Technology is replaceable.

Product semantics are not.

---

# 16. Shared Code Must Represent Genuine Shared Contracts

The monorepo makes code sharing easy.

That is useful and dangerous.

Chronologity should share code when the shared artifact represents a genuine cross-boundary contract or repository-wide engineering concern.

Good candidates include:

- contract schemas;
- API DTOs;
- event schemas;
- shared identifier representations;
- configuration primitives;
- linting configuration;
- TypeScript configuration.

Poor candidates include:

- service implementations imported by multiple applications;
- application-specific repositories;
- internal services;
- arbitrary utility collections;
- persistence adapters;
- feature internals.

Shared packages should reduce duplication of contracts without erasing ownership boundaries.

---

# 17. Contracts Are Explicit and Versionable

Every important application boundary should have an explicit contract.

This includes:

- REST requests and responses;
- GraphQL schemas;
- Integration Event schemas;
- integration event schemas;
- media-processing messages;
- and other inter-application payloads.

Contracts should be:

- typed;
- validated at boundaries;
- evolvable;
- backward-compatible where required;
- and versioned when compatibility cannot otherwise be preserved.

A TypeScript type alone is not runtime validation.

External or asynchronous data must be treated as untrusted until validated.

---

# 18. Clients Do Not Own Domain Truth

Mobile and web clients may provide rich local behavior, optimistic interaction, caching, animation, and presentation.

They do not become authoritative for domain rules.

The server remains responsible for enforcing important invariants such as:

- authorization;
- occurrence-time constraints;
- video-duration rules;
- privacy;
- moderation;
- social relationship rules;
- and valid state transitions.

A client may predict a result for responsiveness.

The authoritative result comes from the appropriate server-side boundary.

---

# 19. Presentation Geometry Is Not Domain State

Chronologity's Timeline is spatial, but literal x/y/z coordinates are presentation.

The authoritative historical model should expose semantic information such as:

- occurrence time;
- temporal range;
- temporal scale;
- contextual relationships;
- Event associations;
- Location associations;
- causal relationships;
- historical significance;
- and navigation targets.

Clients can derive spatial layout from those semantics.

This preserves:

- accessibility;
- responsive design;
- alternative Timeline presentations;
- future rendering technologies;
- and independence between historical truth and a particular visual layout algorithm.

---

# 20. Timeline and Feed Are Different Read Problems

The Feed and Timeline both contain Moments, but they are not interchangeable.

The Feed answers a question closer to:

> **Which eligible Moments should this User encounter in chronological order?**

The Timeline answers questions closer to:

> **What history exists in this temporal and contextual region, at this temporal scale, and how can the User navigate it?**

The Timeline must support:

- scale changes;
- sparse and dense historical regions;
- broad historical abstraction;
- historical significance;
- contextual relationships;
- and non-local jumps.

The Feed should not be stretched into becoming the Timeline read model merely to reuse infrastructure.

---

# 21. Temporal Zoom Is a Query-Semantic Capability

Temporal zoom is not merely a client animation.

Changing scale changes what historical representation is useful.

The backend/read architecture must therefore support scale-aware queries and representations.

At broader scales, Chronologity may return:

- summaries;
- clusters;
- historically significant anchors;
- temporal buckets;
- or other abstractions.

At narrower scales, it may return individual Moments in greater detail.

The implementation must preserve access to underlying history rather than replacing it permanently with summaries.

---

# 22. Historical Jumps Are Non-Local Navigation

A historical jump must not require sequential traversal through every intermediate Moment or page.

The architecture must support direct resolution of meaningful historical destinations.

A jump should preserve enough semantic context to identify:

- the relationship being followed;
- the destination;
- destination occurrence time;
- destination temporal context;
- and a return path where appropriate.

This is a first-class day-one requirement and must influence indexes, identifiers, read contracts, and navigation state.

---

# 23. Chronology Is Not Ranking

Chronologity's primary historical ordering must not be replaced by engagement optimization.

Reaction count, Comment count, popularity, virality, recommendation score, and historical significance may influence particular product surfaces where explicitly allowed.

They do not change when something happened.

Feed and Timeline ordering rules must preserve the distinction between:

```text
when it happened
```

and:

```text
how much the system thinks a User may care about it
```

---

# 24. Historical Significance Is Contextual and Derived

Historical significance is not an immutable scalar property of a Moment.

It may depend on:

- temporal context;
- later consequences;
- relationship structure;
- Event context;
- Location context;
- causal relevance;
- and other product-defined dimensions.

Its architecture must therefore support provenance, methodology/versioning, and recomputation.

Historical significance must not be silently reduced to engagement metrics because they are easier to calculate.

---

# 25. Causality Requires Explicit Evidence and Provenance

Chronological sequence is not causation.

Chronologity must represent causal relationships explicitly and preserve the basis for those relationships where required.

A causal edge should be able to distinguish:

- direction;
- relationship type;
- provenance;
- confidence or uncertainty;
- and source of assertion or inference.

AI-generated causal suggestions must not silently become historical fact.

The architecture must preserve the distinction between:

```text
related
preceded
correlated
contributed to
caused
```

rather than collapsing them into one generic edge.

---

# 26. Preserve Provenance

Chronologity should be able to distinguish information that is:

- User-authored;
- imported;
- system-derived;
- machine-generated;
- inferred;
- corrected;
- moderated;
- or otherwise transformed.

This matters especially for:

- historical corrections;
- causal relationships;
- historical significance;
- accessibility descriptions;
- captions;
- Event associations;
- Location inference;
- and AI-assisted metadata.

Derived interpretation must not masquerade as original historical evidence.

---

# 27. Represent Uncertainty Rather Than Invent Precision

Historical data is often incomplete.

Chronologity should represent uncertainty explicitly rather than manufacture exactness for technical convenience.

This principle may apply to:

- occurrence time;
- date ranges;
- Event boundaries;
- Location;
- Person identification;
- causal relationships;
- historical significance;
- and imported historical information.

A database schema that requires false precision is a modeling defect.

The architecture should support the uncertainty semantics established by the relevant product specifications.

---

# 28. Privacy Is a Data-Flow Property

Privacy cannot be enforced only at the primary API.

Once protected information enters projections, indexes, caches, media delivery systems, notifications, analytics, or asynchronous messages, privacy becomes a distributed data-flow concern.

The rule is:

```text
No derived representation may reveal information
that the Viewer is not authorized to access.
```

Privacy architecture must account for both initial eligibility and later revocation.

---

# 29. Authorization Must Be Server-Enforced

Clients may hide controls for usability.

That is not authorization.

Every protected server-side action and read must enforce the applicable authorization rules at a trusted boundary.

This includes:

- REST APIs;
- GraphQL;
- media access;
- historical jumps;
- Timeline queries;
- Search;
- Discovery;
- administrative operations;
- and internal workflows where privilege boundaries exist.

Never trust a client-provided assertion that the client is allowed to see or mutate something.

---

# 30. Revocation Is as Important as Granting Access

Distributed read systems make granting access easy and revoking it difficult.

Chronologity must design for revocation from the beginning.

Changes involving:

- privacy;
- blocking;
- moderation;
- account state;
- deletion;
- media removal;
- and authorization

must propagate to all relevant derived systems.

The architecture must define acceptable propagation delay according to consequence.

A system that eventually grants access correctly but leaks revoked content for hours is not privacy-correct.

---

# 31. Append-Only Storage Does Not Override Erasure

Append-only storage is an implementation strategy, not a legal or ethical
exemption. This applies to whatever is append-only at the time — today the
transactional outbox and Kafka topics (ADR-095).

Chronologity must design event schemas and sensitive-data boundaries so that
privacy, deletion, and applicable erasure requirements remain possible.

The simplest way to satisfy this is not to put erasable data there at all: an
Integration Event carries an identifier and enough for a consumer to act, and
the consumer reads what it needs from a source that can be corrected.

Prefer minimizing sensitive immutable payloads.

Where necessary, use mechanisms such as:

- indirection;
- externalized mutable sensitive data;
- redaction;
- tombstones;
- key destruction;
- cryptographic erasure;
- or other explicitly designed approaches.

The exact mechanism depends on the data category.

---

# 32. Moderation Changes Distribution, Not Occurrence

Moderation may:

- warn;
- restrict;
- de-amplify;
- remove;
- suspend;
- or otherwise enforce product policy.

It must not silently change the historical occurrence time or causal position of content.

If content becomes inaccessible, derived systems must remove or safely represent it without fabricating replacement history.

Historical integrity and safety must coexist rather than being treated as mutually exclusive architectural goals.

---

# 33. Accessibility Semantics Are First-Class Data

If a product capability has meaning beyond its visual presentation, that meaning must be available semantically.

For the Timeline, this includes:

- temporal position;
- temporal scale;
- chronology;
- contextual relationships;
- historical-jump targets;
- and Moment identity.

For media, this may include:

- descriptions;
- captions;
- playback state;
- and accessible controls.

Accessibility must not depend on reverse-engineering pixels, spatial coordinates, animation, or gestures.

Accessible metadata is subject to the same privacy and moderation rules as visible data.

---

# 34. Unlimited Product Semantics Require Bounded Technical Operations

A Moment may contain an unlimited number of images and videos at the product-model level.

That does not justify unbounded technical operations.

Chronologity should use:

- pagination;
- batching;
- streaming;
- incremental loading;
- independent media processing;
- bounded transactions;
- bounded message sizes;
- and resumable workflows

to safely implement an unbounded product relationship.

The distinction is:

```text
No product-level count limit
        !=
No technical bounds anywhere
```

Technical bounds must not become hidden product restrictions.

---

# 35. Media Binaries Stay Out of Domain Messages

Large images and videos do not belong in:

- Integration Event payloads;
- Kafka message bodies;
- PostgreSQL rows intended as binary stores;
- ClickHouse Feed records;
- or ordinary JSON API payloads.

Media should be stored in object storage and referenced through stable identifiers and authorized delivery mechanisms.

Events and messages should communicate media identity and state, not transport the media binary itself.

---

# 36. Media Processing Is Asynchronous and Per-Item

Media processing can be slow and can fail independently.

The architecture must represent each media item's lifecycle explicitly.

A Moment with many media items must not depend on one monolithic processing transaction.

Possible states may include concepts such as:

```text
pending
uploaded
processing
ready
failed
removed
```

Exact state models belong in focused specifications.

The important principle is that failure and retry are localizable rather than ambiguous across the entire Moment.

---

# 37. Stable Identity Is More Important Than Storage Location

Domain entities and externally referenced resources need stable identifiers that do not encode mutable infrastructure details.

Identifiers should not depend on:

- database shard;
- table name;
- object-storage bucket;
- server hostname;
- Kafka partition;
- or client layout position.

Stable identity allows persistence, partitioning, and deployment architecture to evolve without changing product identity.

---

# 38. APIs Expose Product Semantics, Not Database Shapes

API contracts should be designed around client and product needs.

They should not merely serialize database rows.

A persistence schema may contain implementation details that clients should never know.

Likewise, clients may require semantic information that does not map one-to-one to a table.

The API boundary is an intentional contract, not an ORM export.

---

# 39. Prefer Opaque Cursors Over Exposed Pagination Internals

Where cursor pagination is appropriate, cursors should be opaque to clients.

Clients should not depend on database offsets, internal IDs, ClickHouse sort tuples, or implementation-specific query state.

This allows read models and storage strategies to evolve without breaking navigation contracts.

Timeline navigation may require richer semantics than ordinary Feed pagination; the same principle still applies.

---

# 40. Avoid Offset Pagination for Unbounded High-Volume History

Offset pagination degrades and becomes unstable for large, changing datasets.

Chronologity should prefer cursor/keyset-style approaches for large chronological collections where appropriate.

However, cursor design must respect occurrence-time backfill.

A cursor strategy that assumes new records only appear at the beginning or end of history is insufficient for Chronologity.

---

# 41. Design for Replay and Rebuild

Derived systems should be recoverable.

Chronologity must be able to rebuild important projections when:

- projection code changes;
- a bug corrupted derived state;
- a new read model is introduced;
- an index is lost;
- or infrastructure is replaced.

Replay must be:

- observable;
- resumable;
- version-aware where necessary;
- and safe with current privacy/deletion constraints.

Rebuildability is a design property, not an emergency script written after corruption occurs.

---

# 42. Rebuild Must Not Resurrect Forbidden Data

A naïve replay of old authoritative events can conflict with current deletion, privacy, moderation, or erasure state.

Projection architecture must therefore account for current eligibility and data-retention rules.

"Rebuild from the beginning" is only correct if the authoritative inputs and replay process themselves encode the current legal and product constraints.

This requirement is especially important for Search, Feed, caches, media metadata, and historical summaries.

---

# 43. Prefer Recoverable Workflows Over Distributed Transactions

Chronologity spans multiple stores and asynchronous systems.

It should not attempt to make PostgreSQL, Kafka, ClickHouse, object storage, Search, and external providers participate in one distributed transaction.

Prefer:

```text
local authoritative commit
        ↓
durable transition
        ↓
asynchronous propagation
        ↓
retry / compensation / recovery
```

Workflows should make intermediate states explicit when Users can observe them.

---

# 44. Failure Is a State to Design, Not an Exception to Ignore

The architecture must assume:

- timeouts;
- retries;
- duplicate messages;
- partial uploads;
- delayed projections;
- failed transcodes;
- unavailable dependencies;
- stale caches;
- and interrupted workflows.

Product state should remain understandable under these conditions.

For asynchronous User-visible operations, "processing" and "failed" are legitimate states, not merely log messages.

---

# 45. Degrade Derived Capabilities Before Corrupting Authority

When a derived subsystem is unavailable, Chronologity should prefer temporary degradation of that capability over compromising authoritative correctness.

Examples:

- Search may be temporarily stale;
- Feed projections may lag;
- Discovery may be unavailable;
- notifications may be delayed.

The API must not invent authoritative state or bypass domain invariants simply to keep a derived surface appearing current.

---

# 46. Validate at Trust Boundaries

Data must be validated when crossing a trust or application boundary.

Examples include:

- client requests;
- Kafka messages;
- third-party webhook payloads;
- imported historical data;
- media metadata;
- configuration;
- and external service responses where assumptions matter.

Internal static typing is valuable but does not replace runtime validation of untrusted data.

---

# 47. Security Is a System Property

Security is not a middleware module added after feature development.

Architecture must consider:

- authentication;
- authorization;
- least privilege;
- secret management;
- data encryption;
- media validation;
- rate limiting;
- abuse resistance;
- administrative access;
- auditability;
- and dependency trust.

Security decisions must be applied consistently across API, workers, data stores, Kafka, media infrastructure, and clients.

---

# 48. Minimize Sensitive Data Replication

Every copy of sensitive data increases privacy, security, deletion, and compliance complexity.

Chronologity should avoid embedding sensitive information in every event, message, projection, log, cache, and analytics record merely for convenience.

Prefer identifiers and purpose-specific representations where the full sensitive value is unnecessary.

Derived systems should contain only the data required for their responsibility.

---

# 49. Logs Are Not Databases

Logs must not contain unrestricted copies of domain payloads, access tokens, secrets, private media URLs, precise sensitive Location data, or other unnecessary personal information.

Structured logging should capture enough context to diagnose behavior without becoming an uncontrolled secondary data store.

The same principle applies to traces and metrics labels.

---

# 50. Observability Must Cross Asynchronous Boundaries

Chronologity must be able to trace a meaningful operation across:

```text
request
  ↓
authoritative commit
  ↓
publication
  ↓
Kafka
  ↓
consumer
  ↓
projection / side effect
```

Correlation and causation identifiers should survive boundaries where appropriate.

Operational tooling should make projection lag, failed consumers, poison messages, and media-processing failures visible.

A distributed asynchronous architecture that cannot explain where work stopped is not operable.

---

# 51. Measure Before Decomposing

Chronologity should anticipate scale in its data model and boundaries but avoid speculative distribution.

Before splitting a module into a new service or introducing a new datastore, identify the concrete constraint:

- throughput;
- latency;
- storage volume;
- availability;
- resource isolation;
- deployment independence;
- or security boundary.

Architecture should evolve in response to evidence while preserving product semantics.

---

# 52. Choose Datastores by Access Pattern and Authority

Chronologity intentionally uses multiple storage technologies because they serve different responsibilities.

The principle is not "polyglot persistence everywhere."

It is:

> **Use the simplest store that correctly satisfies the authority, consistency, query, scale, and operational requirements of the data.**

Current responsibilities include:

```text
PostgreSQL   -> relational operational state and read models
ClickHouse   -> high-volume derived Feed/read projections
Object store -> media binaries
Kafka        -> asynchronous integration transport
```

A new datastore requires a responsibility that existing stores cannot appropriately fulfill.

---

# 53. Avoid Cross-Store Joins on Critical Read Paths

A read path that requires synchronous fan-out across many independent stores becomes fragile and difficult to reason about.

Where a product surface has a high-volume or latency-sensitive access pattern, prefer purpose-built projections containing the data needed to answer that query safely.

This denormalization is intentional.

It does not transfer authority to the projection.

Authorization-sensitive denormalization must include a revocation strategy.

---

# 54. Denormalize for Reads, Normalize Ownership

Chronologity may duplicate data aggressively in read models when that improves product performance.

But ownership should remain singular and explicit.

Conceptually:

```text
One authoritative owner
        ↓
Many derived representations
```

not:

```text
Many writable copies
        ↓
Hope they remain synchronized
```

---

# 55. Avoid Synchronous Chains of Internal Services

A future service-oriented Chronologity should not become a deep synchronous call graph.

Long request chains increase:

- latency;
- cascading failure;
- coupling;
- and operational complexity.

Use synchronous calls where the User's immediate request genuinely requires a response.

Use asynchronous integration where downstream work can converge independently.

---

# 56. Make Consistency Requirements Consequence-Driven

Not every piece of data requires strong consistency.

Not every piece of data can tolerate eventual consistency.

The decision should depend on what happens if the data is stale.

Stale Reaction counts may be acceptable.

Stale authorization that exposes private content may not be.

Stale Search indexing may be acceptable.

Duplicate execution of a destructive command may not be.

Consistency is a product-correctness decision, not a blanket infrastructure preference.

---

# 57. Preserve Determinism Where Reproducibility Matters

Projection logic, historical-significance computation, causal analysis, and other derived algorithms should be deterministic for the same authoritative inputs and algorithm/configuration version where practical.

Determinism improves:

- testing;
- replay;
- debugging;
- auditability;
- and migration confidence.

Where nondeterministic systems such as AI participate, Chronologity should persist sufficient provenance and outputs rather than assuming the same inference can always be reproduced later.

---

# 58. Version Algorithms That Affect Historical Representation

Algorithms that materially affect how history is represented should be versioned.

Examples may include:

- historical-significance computation;
- temporal-zoom abstraction;
- Discovery ranking;
- clustering;
- causal inference;
- media-derived metadata;
- and machine-generated accessibility descriptions.

Versioning makes it possible to explain why a representation changed and to rebuild derived state intentionally.

---

# 59. AI Produces Suggestions or Derived Metadata, Not Unmarked Truth

Where Chronologity uses AI, generated output must retain appropriate provenance.

AI may assist with:

- accessibility descriptions;
- historical context;
- causal suggestions;
- classification;
- moderation;
- media analysis;
- or other derived capabilities.

AI output must not silently become an authoritative historical fact merely because the model produced it.

Confidence, provenance, correction, and moderation requirements depend on the specific feature.

---

# 60. Prefer Explicit State Machines for Long-Running Work

Long-running asynchronous workflows should use explicit states and transitions rather than collections of loosely related booleans.

This is particularly relevant for:

- media upload;
- media processing;
- moderation workflows;
- deletion;
- imports;
- projection rebuilds;
- and other multi-step processes.

Explicit state machines make retries, invalid transitions, observability, and recovery easier to reason about.

---

# 61. Make Operations Safe to Retry

Network failures make outcomes ambiguous.

A client or worker may not know whether an operation succeeded before the connection failed.

Commands and jobs that can reasonably be retried should support idempotency keys, deduplication, expected-version checks, or another appropriate mechanism.

Retry safety should be designed into the boundary rather than left to caller luck.

---

# 62. Guard State Transitions in the Statement, Not in Application Code

Where concurrent writes can violate an invariant, the condition belongs in the
`WHERE` clause rather than in a check that precedes the write.

A read, a decision, and then a write are three moments, and another request can
commit between any two of them. Naming the expected state in the statement
closes the gap, and the row count reports whether this call was the one that
changed anything.

The write path should detect that the state moved rather than silently
overwriting another decision.

Retry or conflict behavior should be feature-specific.

---

# 63. Avoid Generic Repository Abstractions That Erase Storage Semantics

PostgreSQL, ClickHouse, Kafka, and object storage have materially different semantics.

Chronologity should not force them behind one generic `Repository<T>` abstraction merely to make them look uniform.

Abstractions should hide incidental implementation details without hiding important consistency, ordering, query, or transaction semantics.

A useful abstraction makes the system easier to reason about.

A leaky universal abstraction does the opposite.

---

# 64. Keep Domain Language Consistent

Architecture and code should use the canonical terminology defined in `docs/glossary.md`.

In particular:

- use **Moment**, not `Post`, for the canonical historical unit;
- distinguish **User** from **Person**;
- distinguish **Real-World Event** from **Integration Event**;
- distinguish **occurrence time** from creation/publication timestamps;
- distinguish **Search** from **Discovery**;
- distinguish **historical significance** from popularity;
- distinguish **moderation** from historical correction.

Naming drift is architecture drift.

---

# 65. Avoid Barrel Files by Default

Chronologity should prefer explicit imports and clear module ownership.

Barrel files can obscure dependency direction, encourage accidental public APIs, and create circular dependency problems in large TypeScript codebases.

They should be introduced only where they provide a deliberate package-level public contract.

Internal feature implementation should generally use direct imports.

---

# 66. Keep Tests Close to the Behavior They Protect

Unit tests should be colocated with the implementation they exercise where practical.

Feature organization should make it easy to see:

- the behavior;
- its contract;
- and its tests

together.

Integration and end-to-end tests may live at broader application boundaries when they exercise multiple components.

Test organization should reflect architectural boundaries rather than creating one disconnected global test hierarchy.

---

# 67. Test Domain Invariants Independently of Infrastructure

Important product rules should be testable without requiring every external dependency.

Examples include:

- occurrence-time semantics;
- Moment invariants;
- privacy decisions;
- causal relationship rules;
- historical-significance rules;
- command decisions;
- and state transitions.

Infrastructure integration tests are also required, but they should not be the only way to verify domain correctness.

---

# 68. Test Projections for Replay and Idempotency

Projection tests should verify more than one happy-path event.

Where relevant, they should establish that:

- repeated delivery is safe;
- event ordering assumptions are explicit;
- checkpoint recovery works;
- rebuild produces equivalent state;
- privacy/deletion changes remove data correctly;
- and version migrations behave intentionally.

Projection correctness is part of product correctness.

---

# 69. Migrations Must Be Forward-Safe

Schema and contract changes should be designed for rolling deployment where practical.

Avoid deployment sequences that require every application and worker to switch versions atomically.

For database changes, prefer additive-expand/migrate/contract patterns where appropriate.

For asynchronous messages, producers and consumers should tolerate compatible version overlap.

---

# 70. Backward Compatibility Is a Boundary Concern

Internal implementation can change aggressively.

Published boundaries cannot.

Compatibility matters most for:

- mobile clients that may remain installed for long periods;
- asynchronous Kafka consumers deployed at different times;
- published Integration Events;
- public or semi-public API contracts;
- and stored read-model migration paths.

The closer a contract is to durable history or independently deployed consumers, the more carefully it must evolve.

---

# 71. Mobile Version Skew Must Be Expected

Chronologity cannot assume every mobile User upgrades immediately.

Server APIs should tolerate a reasonable window of older supported client versions.

Breaking a mobile contract requires a deliberate compatibility and deprecation strategy.

The server should not rely on a same-day coordinated deployment with the App Store.

---

# 72. Performance Is Part of Product Correctness

A theoretically correct Timeline that takes tens of seconds to navigate is not a correct product experience.

Architecture should define and measure performance for critical workflows, especially:

- Timeline loading;
- temporal zoom;
- historical jumps;
- Feed retrieval;
- Moment opening;
- media loading;
- Search;
- and upload status.

Performance goals belong in focused engineering/operations documents, but the architecture must make them achievable.

---

# 73. Accessibility Performance Matters

A semantically accessible experience that becomes unusable under virtualization, large Moments, or massive Timelines is not sufficiently accessible.

Performance and accessibility must be considered together.

Stable identity, focus restoration, incremental loading, and semantic continuity are architectural concerns for assistive technologies as well as visual clients.

---

# 74. Build for Large History Without Loading All History

Chronologity may eventually represent enormous historical datasets.

No client or service should require materializing an entire User Timeline, Real-World Event, Location history, or Moment media collection to perform ordinary navigation.

Use bounded retrieval and scale-aware representations.

The product should feel continuous even when the implementation is incremental.

---

# 75. Prefer Semantic Indexes Over Presentation Indexes

Indexes should support product questions.

Examples include:

- Moments by occurrence-time range;
- relationships by source/destination;
- Event membership;
- Location context;
- historical-jump destinations;
- Viewer eligibility;
- and scale-aware historical retrieval.

Avoid indexing primarily around a current UI's pixel arrangement.

Presentation can change without requiring the historical data model to be redesigned.

---

# 76. Partition by Stable Workload Boundaries

When partitioning becomes necessary, choose keys that preserve locality for the workload without changing domain identity.

Potential partitioning decisions must consider:

- transactional consistency;
- chronological range queries;
- User/social fan-out;
- Real-World Events;
- Locations;
- media processing;
- and projection rebuilds.

Partition keys are operational decisions.

They must not leak into public identifiers or product semantics.

---

# 77. Prefer Stateless Compute Where Practical

API processes, Feed Aggregator instances, and many workers should be horizontally scalable without relying on local in-memory state for correctness.

Ephemeral in-memory caches may improve performance but must not be required to reconstruct authoritative behavior after process loss.

Durable coordination belongs in appropriate persistent systems.

---

# 78. Background Work Requires Backpressure

Kafka consumers and media workers must not consume work faster than downstream systems can safely process it.

The architecture should support:

- bounded concurrency;
- consumer lag visibility;
- retry policies;
- dead-letter/quarantine strategies where appropriate;
- and workload isolation.

Unbounded concurrency is not scalability.

---

# 79. Retries Must Be Bounded and Observable

Automatic retries are useful for transient failure.

Infinite silent retries hide broken systems.

Retry policies should distinguish:

- transient failures;
- permanent validation failures;
- poison messages;
- authorization failures;
- and exhausted resources.

After appropriate retries, failed work must become visible and recoverable.

---

# 80. Do Not Hide Data Loss Behind Eventual Consistency

Projection delay is eventual consistency.

A permanently missed message is data loss.

The architecture and observability model must distinguish the two.

Consumers need checkpoints, failure visibility, and replay/recovery mechanisms sufficient to detect when convergence has stopped.

---

# 81. Keep External Providers Behind Explicit Boundaries

Chronologity may depend on external services for:

- object storage;
- CDN;
- email;
- push notifications;
- geospatial data;
- media processing;
- authentication support;
- or future AI capabilities.

Provider-specific behavior should be isolated behind application-owned boundaries where replacement is plausible or failure semantics matter.

Do not leak vendor-specific identifiers or concepts throughout the domain model unnecessarily.

---

# 82. External Services Are Fallible

Every external dependency must be treated as:

- unavailable sometimes;
- slow sometimes;
- rate-limited sometimes;
- and capable of returning unexpected responses.

Critical authoritative decisions should not synchronously depend on nonessential external services.

Where possible, integrate external side effects asynchronously.

---

# 83. Defaults Must Be Safe

When privacy, moderation, authorization, or security state is missing, ambiguous, stale beyond acceptable bounds, or cannot be evaluated, the system should prefer the safer behavior.

This does not mean every infrastructure failure should make the entire product inaccessible.

It means uncertainty must not default to unauthorized disclosure.

Feature-specific fallback behavior should be explicit.

---

# 84. Administrative Power Must Be Explicit and Auditable

Administrative and moderation capabilities can alter visibility, access, or User state.

They should have:

- explicit authorization;
- least-privilege roles;
- auditable actions;
- clear reason/context where required;
- and protection against accidental use.

Administrative APIs should not be hidden privileged variants of ordinary client endpoints without clear boundaries.

---

# 85. Data Retention Is Deliberate

Chronologity should not retain data indefinitely merely because storage is inexpensive.

Each important data category should eventually have explicit retention semantics covering:

- authoritative events;
- operational records;
- media;
- derivatives;
- logs;
- traces;
- Kafka data;
- backups;
- caches;
- and deleted resources.

Retention must align with product requirements, historical integrity, privacy, security, legal obligations, and cost.

---

# 86. Cost Is an Architectural Constraint

Media storage, CDN delivery, transcoding, Kafka throughput, ClickHouse queries, projection rebuilds, and AI-assisted processing can become major cost centers.

Chronologity should measure cost by workload and avoid designs whose marginal cost grows unnecessarily with every read or historical navigation action.

Cost optimization must not compromise product invariants, privacy, accessibility, or historical integrity.

---

# 87. Avoid Premature Generalization

Chronologity should solve Chronologity's actual product problems before designing generic platforms.

Do not build:

- a universal social-network framework;
- a general event-sourcing framework;
- a generic workflow engine;
- a generic graph database abstraction;
- or a reusable media platform

unless concrete Chronologity requirements justify it.

Specific, well-bounded code is often easier to evolve than an abstraction designed before its true variation is understood.

---

# 88. Prefer Boring Technology at the Edges of Novelty

Chronologity's product model is already ambitious.

Novelty should be concentrated where it creates product value:

- temporal navigation;
- historical context;
- historical jumps;
- significance;
- causality;
- and large-scale historical representation.

For commodity infrastructure concerns, prefer mature and well-understood technologies unless a specific limitation requires otherwise.

The goal is not architectural novelty.

The goal is a reliable system capable of supporting a novel product.

---

# 89. Document Consequential Decisions

When a decision:

- materially constrains future architecture;
- introduces a new technology;
- chooses among meaningful alternatives;
- changes a major data authority;
- establishes a cross-system guarantee;
- or intentionally violates a principle,

record it in an ADR.

Architecture documentation describes the current system.

ADRs preserve why consequential choices were made.

---

# 90. Keep Documentation and Implementation Aligned

Architecture documents are not aspirational marketing material.

When implementation intentionally changes an architectural rule, the corresponding documentation should change in the same body of work.

Likewise, code review should challenge implementations that contradict settled architectural documents without an explicit decision to revise them.

Stale architecture documentation is worse than concise architecture documentation because it creates false confidence.

---

# Decision Heuristics

When evaluating an architectural proposal, use the following questions.

## Product

- Does it preserve occurrence-time semantics?
- Does it preserve the Moment as the fundamental historical unit?
- Does it preserve unlimited product-level media membership?
- Does it support temporal zoom and historical jumps from day one?
- Does it preserve chronology independently of engagement?
- Does it preserve provenance and uncertainty?

## Data

- What is authoritative?
- What is derived?
- Can derived state be rebuilt?
- Could rebuild resurrect forbidden data?
- Does the design unnecessarily replicate sensitive information?
- Does it model uncertainty honestly?

## Distribution

- Does this need to be synchronous?
- What happens if the downstream dependency is unavailable?
- Can the operation be retried?
- Is the consumer idempotent?
- What ordering guarantee is actually required?
- How will failure be observed and recovered?

## Boundaries

- Is this a real domain/application boundary or merely a code-organization preference?
- Does a new service have a concrete operational justification?
- Does a shared package represent a genuine contract?
- Is a framework or datastore leaking into domain semantics?

## Privacy and Security

- Could a stale projection expose restricted information?
- How is access revoked?
- Could a cache, Search index, notification, media URL, or accessibility field leak data?
- Is sensitive information being copied unnecessarily?
- Is authorization enforced at a trusted server boundary?

## Scale

- Can this operate without loading an unbounded collection?
- Does it support backfilled history?
- Does it support distant historical navigation?
- Can it scale horizontally where necessary?
- Is the proposed partitioning based on a stable workload rather than current infrastructure?

## Operations

- Can we tell when it fails?
- Can we replay or rebuild it?
- Can we distinguish lag from data loss?
- Are retries bounded?
- Is the workflow safe under partial failure?
- Can it be deployed without requiring an atomic whole-system release?

## Simplicity

- Is there a simpler design that preserves the same product semantics?
- Are we introducing a technology because it solves a measured problem or because it is fashionable?
- Are we prematurely generalizing?
- Can this remain inside an existing modular application?

---

# Principle Conflicts

Architectural principles can conflict in practice.

For example:

```text
Minimize sensitive replication
```

may conflict with:

```text
Avoid cross-store joins on critical read paths
```

The correct answer is not to treat either principle as absolute.

Instead:

1.  identify the product consequence;
2.  identify the security/privacy consequence;
3.  identify the performance consequence;
4.  choose the narrowest design that satisfies the most important constraints;
5.  document the tradeoff if it is consequential.

Likewise:

```text
Prefer asynchronous integration
```

does not mean privacy revocation may propagate indefinitely.

And:

```text
Prefer a modular monolith
```

does not mean CPU-intensive media processing must run inside API request processes.

Principles guide reasoning. They do not replace it.

---

# Architecture Review Standard

A proposed architecture should be considered incomplete if it cannot answer:

1.  What product invariant is this design implementing?
2.  Which component owns the authoritative state?
3.  Which representations are derived?
4.  What consistency is required?
5.  What happens under duplicate execution?
6.  What happens under partial failure?
7.  How is privacy enforced and revoked?
8.  How is the operation observed?
9.  How is derived state rebuilt?
10. How does the design behave at large historical scale?
11. How does it preserve accessibility semantics?
12. What future constraint does the design introduce?
13. Why is each new service or datastore necessary?
14. What is the simplest architecture that satisfies these requirements?

If those questions cannot be answered, implementation should not harden the boundary yet.

---

# Guiding Principle

When choosing between architectural alternatives, ask:

> **Which design most clearly preserves Chronologity's historical semantics, privacy, provenance, accessibility, and future scalability while introducing the least unnecessary distributed-system complexity today?**

Chronologity should be architecturally ambitious where the product requires it and deliberately ordinary everywhere else.
