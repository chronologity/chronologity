# Chronologity Architecture Decisions

## Purpose

This document records the canonical architectural decisions for Chronologity.

The architecture documents define how the system is designed. This document explains the major choices behind that design and provides a durable record of:

- the decision;
- its rationale;
- important alternatives considered;
- consequences;
- constraints;
- and whether a prior decision was superseded.

This is not a substitute for the detailed architecture documents.

The governing rule is:

> **If a decision materially changes how Chronologity is built, operated, scaled, secured, or evolved, the rationale should remain discoverable after the conversation that produced it is gone.**

---

# Decision Status

Each decision uses one of these states:

```text
Accepted
Superseded
Deprecated
Proposed
```

`Accepted` decisions are canonical unless explicitly replaced.

`Superseded` decisions remain in the historical record but must not guide new implementation.

---

# ADR-001 — Use a TypeScript Monorepo

**Status:** Accepted

## Decision

Chronologity will use a TypeScript monorepo containing the product applications and shared packages.

Canonical top-level applications:

```text
apps/
├── api/
├── feed-aggregator/
├── mobile/
└── web/
```

Shared packages include contracts, API client, configuration, ESLint configuration, and TypeScript configuration.

## Rationale

The applications share substantial contracts and tooling while remaining independently deployable.

A monorepo improves:

- atomic contract changes;
- type sharing;
- dependency visibility;
- consistent tooling;
- coordinated refactoring.

## Consequences

Repository boundaries do not imply deployment boundaries.

Shared packages must not become dumping grounds for application-specific logic.

---

# ADR-002 — Do Not Build a Separate Admin Application

**Status:** Accepted

## Decision

Chronologity will not have a separate administrative application.

Administrative capabilities will be exposed through the consumer application and protected through server-side role-based authorization.

## Rationale

A separate administrative frontend does not create the security boundary.

Authorization belongs on the server.

Maintaining a second UI would add unnecessary product and operational complexity.

## Consequences

The mobile application may conditionally expose privileged UI.

Hiding UI is never authorization.

Every privileged operation must be independently authorized by the backend and auditable.

---

# ADR-003 — Use React Native with Expo for Mobile

**Status:** Accepted

## Decision

The consumer mobile application will use React Native with Expo.

## Rationale

This provides a shared TypeScript development model across iOS and Android while retaining access to native capabilities required for:

- media capture;
- media playback;
- uploads;
- secure storage;
- push notifications;
- deep links.

## Consequences

Native/runtime behavior still requires device-level testing.

Backend contracts must tolerate old mobile versions remaining active.

---

# ADR-004 — Use Gatsby for the Marketing Website

**Status:** Accepted

## Decision

The public marketing website will use Gatsby.

## Rationale

The marketing site is intentionally small and primarily static.

It does not need the architecture of the consumer application.

## Consequences

The site should deploy as static assets where practical.

Product/backend logic must not migrate into the marketing site.

---

# ADR-005 — Use Node.js, TypeScript, and Fastify for the API

**Status:** Accepted

## Decision

The API will use Node.js, TypeScript, and Fastify.

## Alternatives Considered

- Express;
- NestJS.

## Rationale

Fastify provides a lightweight, performant HTTP framework without imposing the application structure and abstractions of NestJS.

Chronologity already defines its own CQRS, feature, event, and projection architecture.

## Consequences

Application conventions must be documented and enforced by the repository rather than inherited from an opinionated framework.

---

# ADR-006 — Organize Backend Code by Feature

**Status:** Accepted

## Decision

API domain/application code will be organized primarily by feature rather than technical layer.

## Rationale

Feature ownership keeps commands, queries, events, handlers, policies, and projections close to the domain capability they implement.

## Consequences

Cross-cutting infrastructure remains separate.

Features must not bypass architectural boundaries merely because code is colocated.

---

# ADR-007 — Do Not Use a Traditional Controller/Service Architecture

**Status:** Superseded by ADR-091

## Decision

Chronologity will not center the API around controller/service classes.

Routes remain thin transport adapters and delegate to command/query/application behavior.

## Rationale

A generic controller/service structure obscures the actual CQRS and domain boundaries.

## Consequences

Business rules must not accumulate in Fastify route handlers.

---

# ADR-008 — Use CQRS

**Status:** Superseded by ADR-091

## Decision

Chronologity will separate commands from queries.

Commands modify authoritative state.

Queries read from stores/models optimized for their purpose.

## Rationale

Chronologity has strongly asymmetric read/write behavior, particularly around the Timeline.

CQRS permits:

- authoritative write models;
- independently optimized projections;
- replayable read models;
- high-volume ClickHouse reads.

## Consequences

Read models may be eventually consistent.

The product must explicitly handle propagation lag.

---

# ADR-009 — Use Event Sourcing Selectively for Domain Authority

**Status:** Superseded by ADR-092

## Decision

Event Sourcing will be used where historical state transitions and replayability justify it.

EventStoreDB is the canonical event store for event-sourced aggregates.

## Rationale

Chronologity is fundamentally historical.

Event Sourcing provides:

- immutable domain history;
- auditability;
- deterministic aggregate reconstruction;
- projection rebuilding;
- explicit temporal corrections.

## Consequences

Persisted events are durable contracts.

Event versioning and compatibility are mandatory.

Event Sourcing must not be applied mechanically to every table or feature.

---

# ADR-010 — EventStoreDB Is Not the Timeline Query Database

**Status:** Superseded by ADR-092

## Decision

EventStoreDB will not serve broad Timeline/feed queries.

## Rationale

Aggregate event streams and chronological analytical reads are different workloads.

## Consequences

Timeline views are projected into ClickHouse.

---

# ADR-011 — Use PostgreSQL for Relational and Operational State

**Status:** Accepted

## Decision

PostgreSQL will store relational authority and operational/read models where relational semantics are appropriate.

## Rationale

Not every domain capability benefits from Event Sourcing.

PostgreSQL provides strong relational constraints, transactions, indexing, and mature operations.

## Consequences

Features must explicitly define whether EventStoreDB or PostgreSQL owns authoritative state.

---

# ADR-012 — Use ClickHouse for Timeline/Historical Read Models

**Status:** Accepted

## Decision

ClickHouse will be the primary high-volume read store for Timeline and historical navigation projections.

## Rationale

Chronologity requires efficient:

- chronological range queries;
- deep historical access;
- temporal aggregation;
- large-scale historical scans;
- denormalized read models.

## Consequences

ClickHouse is derived state, not domain authority.

Its projections must be rebuildable.

---

# ADR-013 — Use Kafka for Durable Asynchronous Messaging

**Status:** Accepted

## Decision

Kafka is required for durable asynchronous event distribution.

## Alternative Rejected

Database polling as the primary messaging architecture.

## Rationale

Chronologity requires independent consumers for:

- projections;
- notifications;
- media workflows;
- Search/derived systems;
- future integrations.

Kafka provides durable consumer groups, replay, partitioned ordering, and workload isolation.

## Consequences

Consumers must be idempotent.

Partition strategy and lag become operational concerns.

---

# ADR-014 — Distinguish Domain Events from Integration Events

**Status:** Accepted

## Decision

Persisted Domain Events and distributed Integration Events are distinct contracts.

## Rationale

Internal aggregate history should not be coupled directly to every downstream consumer.

## Consequences

Translation/versioning boundaries must be explicit.

Sensitive fields must not leak merely because they exist in domain history.

---

# ADR-015 — Use an Event Publisher Between EventStoreDB and Kafka

**Status:** Superseded by ADR-093

## Decision

Committed event-sourced changes will be published to Kafka through a durable publication mechanism/process rather than assuming the command handler can atomically commit to both systems.

## Rationale

EventStoreDB and Kafka do not share a distributed transaction.

## Consequences

Publication is at-least-once.

Publisher checkpoints, retries, and duplicate-safe consumers are required.

---

# ADR-016 — Use the Transactional Outbox for PostgreSQL-Authoritative Events

**Status:** Accepted

## Decision

When PostgreSQL-authoritative changes must produce Integration Events, state mutation and outbox record will commit in the same database transaction.

## Rationale

This prevents the dual-write failure between PostgreSQL and Kafka.

## Consequences

Outbox publishing is asynchronous and at-least-once.

---

# ADR-017 — Treat Projections as Disposable Derived State

**Status:** Accepted

## Decision

Read projections must be rebuildable from authoritative history/state.

## Rationale

Projection correctness must not depend on one irreversible sequence of successful consumer executions.

## Consequences

Projection code must support replay, idempotency, checkpoints, and versioned rebuilds.

---

# ADR-018 — Version Major Projections Side by Side

**Status:** Accepted

## Decision

Materially incompatible projection changes should build a new projection/table version, catch up, validate, and then switch readers.

## Rationale

Destructive in-place transformations make rollback and validation difficult.

## Consequences

Temporary duplicate storage/compute is accepted during migration.

---

# ADR-019 — Chronology Is Based on Occurrence Time

**Status:** Accepted

## Decision

A Moment's canonical Timeline position is determined by when the represented event occurred, not merely when the Moment was uploaded or recorded in Chronologity.

## Rationale

Chronologity is a historical Timeline, not simply a publication feed.

## Consequences

Historical Moments can be backfilled into earlier positions.

Occurrence-time corrections can reposition Moments.

Ingestion time remains metadata, not Timeline authority.

---

# ADR-020 — Preserve the Three-Dimensional Timeline Model

**Status:** Accepted

## Decision

The Timeline uses three conceptual navigation dimensions:

```text
vertical
    → chronology

horizontal
    → contextual grouping/navigation

depth
    → increasing detail within a Moment/context
```

## Rationale

These axes encode distinct navigation semantics.

## Consequences

Feature design must not collapse contextual/depth navigation into nested chronological entities.

---

# ADR-021 — Do Not Introduce Sub-Moments

**Status:** Accepted

## Decision

Chronologity will not use Sub-Moments as a product/domain construct.

## Rationale

Sub-Moments would distort the vertical chronology model by embedding another chronological hierarchy inside a Moment.

## Consequences

A Moment may contain multiple media items and deeper detail without becoming a nested Timeline.

---

# ADR-022 — Temporal Zoom Is a Day-One Timeline Capability

**Status:** Accepted

## Decision

Temporal zoom is required in the initial Timeline architecture.

It is not deferred as a future capability.

## Rationale

Navigating history at different temporal scales is foundational to Chronologity rather than an optimization.

## Consequences

Read models and queries must support multiple temporal resolutions from the beginning.

---

# ADR-023 — Historical Jumps Are a Day-One Timeline Capability

**Status:** Accepted

## Decision

Users must be able to jump directly to historical targets without sequentially scrolling from the present.

## Rationale

A historical system becomes unusable at scale if deep history requires linear traversal.

## Consequences

Direct/indexed resolution is required for Moments, dates, Locations, Real-World Events, and other canonical jump targets.

---

# ADR-024 — Use Keyset/Cursor Pagination for Timeline Navigation

**Status:** Accepted

## Decision

Timeline pagination will use deterministic cursor/keyset semantics rather than offset pagination.

## Rationale

Offsets are unstable and increasingly expensive as historical data grows and backfilled Moments are inserted.

## Consequences

Cursor versioning and deterministic tie-break rules are required.

---

# ADR-025 — Do Not Materialize a Personalized Timeline Copy Per User

**Status:** Accepted

## Decision

Chronologity will use shared historical projections plus read-time eligibility rather than fan-out-on-write personalized Timeline copies by default.

## Rationale

The product is organized around history, not algorithmically generated per-User feeds.

## Consequences

Authorization/privacy eligibility must be efficient at read time.

Candidate over-fetch must remain bounded.

---

# ADR-026 — Historical Significance Is Derived, Versioned Data

**Status:** Accepted

## Decision

Historical significance will be computed as derived data and stored with algorithm/configuration provenance.

## Rationale

Historical significance may evolve as evidence and algorithms improve.

It should not mutate the underlying historical fact.

## Consequences

Interactive reads consume precomputed significance rather than performing expensive scoring synchronously.

---

# ADR-027 — A Moment May Contain Unlimited Media

**Status:** Accepted

## Decision

There is no product-level maximum number of images/videos in a Moment.

## Rationale

The domain should not impose an arbitrary media-count ceiling.

## Consequences

Every technical operation must still be bounded.

Media is paginated, processed independently, and never loaded in one unbounded transaction/response.

---

# ADR-028 — Limit Individual Videos to 90 Seconds

**Status:** Accepted

## Decision

Each video attached to a Moment may be at most 90 seconds.

## Rationale

The limit reflects the product's definition of a Moment while keeping individual video objects bounded.

## Consequences

Duration validation is enforced server-side from trusted media metadata.

---

# ADR-029 — Upload Media Directly to Object Storage

**Status:** Accepted

## Decision

Large media bytes should flow directly from the client to object storage using scoped upload authorization.

## Rationale

Proxying media through API servers wastes application bandwidth and limits scalability.

## Consequences

The API manages upload authorization/state, not byte transport.

Finalization must verify the stored object.

---

# ADR-030 — Use Object Storage and CDN for Media Delivery

**Status:** Accepted

## Decision

Media originals/derivatives live in object storage and are delivered through a CDN where appropriate.

## Rationale

Application servers are not media-origin infrastructure.

## Consequences

Privacy, signed access, invalidation, and deletion must propagate into delivery infrastructure.

---

# ADR-031 — Keep Scene Detection Out of the API Integrations Module

**Status:** Accepted

## Decision

The canonical API architecture will not contain a scene-detection client/integration.

## Rationale

Scene detection is not part of the current product architecture and should not remain as speculative infrastructure.

## Consequences

No scene-detection integration should be implemented unless a future accepted product/architecture decision reintroduces it.

---

# ADR-032 — Add a Dedicated Authorization Feature Module

**Status:** Accepted

## Decision

The API contains a dedicated:

```text
features/authorization/
```

module.

## Rationale

Authorization is a first-class domain/application concern rather than generic middleware.

## Consequences

Transport middleware may establish identity/context, but authorization policy and privileged capability logic belongs in the authorization architecture/module.

---

# ADR-033 — Authentication and Authorization Are Separate Concerns

**Status:** Accepted

## Decision

Authentication establishes identity/session.

Authorization determines allowed actions.

## Rationale

Conflating them creates weak policy boundaries and makes privileged behavior difficult to reason about.

## Consequences

A valid Session never implies unrestricted resource access.

---

# ADR-034 — Enforce Authorization on the Server

**Status:** Accepted

## Decision

All security decisions are enforced server-side.

## Rationale

Mobile/web clients are untrusted.

## Consequences

Role-based UI is convenience only.

Every protected resource/operation is checked independently.

---

# ADR-035 — Reauthorize at Notification Deep-Link Time

**Status:** Accepted

## Decision

A notification does not confer durable access to its referenced content.

Opening a deep link must evaluate current authorization/privacy/moderation state.

## Rationale

Access may have changed after notification creation.

## Consequences

Notification payloads cannot be treated as authorization capabilities.

---

# ADR-036 — Privacy Changes Must Converge Across Derived Systems

**Status:** Accepted

## Decision

Visibility, blocking, deletion, and moderation changes must propagate to every exposure surface.

## Rationale

Changing authoritative state is insufficient if stale projections, caches, Search, media, or notifications continue exposing data.

## Consequences

Privacy propagation lag is observable and tested.

Security-sensitive consumers may receive higher priority.

---

# ADR-037 — Account Deletion Is a Cross-System Workflow

**Status:** Accepted

## Decision

Account deletion is not represented as a single database row update.

It coordinates:

- Sessions;
- PII;
- projections;
- media;
- caches;
- notification delivery;
- downstream exposure.

## Rationale

User data exists across multiple authoritative and derived stores.

## Consequences

Deletion must be idempotent, resumable, observable, and replay-safe.

---

# ADR-038 — Do Not Restore Deleted PII Through Event Replay

**Status:** Accepted

## Decision

Event replay and disaster recovery must not resurrect data that privacy/deletion rules require to remain erased.

## Rationale

Pure historical replay cannot override privacy obligations.

## Consequences

Deletion/redaction state must participate in rebuild/restore procedures.

---

# ADR-039 — Notifications Are Asynchronous Derived Behavior

**Status:** Accepted

## Decision

Most notifications are generated asynchronously from committed events.

## Rationale

Notification delivery should not extend the authoritative command transaction.

## Consequences

Notification generation/delivery is eventually consistent and idempotent.

---

# ADR-040 — Aggregate High-Volume Notifications

**Status:** Accepted

## Decision

High-frequency activities such as Reactions may be aggregated into fewer User-facing notifications.

## Rationale

This improves UX and reduces write/delivery amplification.

## Consequences

Aggregation keys and concurrency behavior require explicit semantics.

---

# ADR-041 — Caching Is an Optimization, Not Authority

**Status:** Accepted

## Decision

No cache owns domain truth.

## Rationale

Caches must be safely bypassable and invalidatable.

## Consequences

A cache outage may reduce performance but must not corrupt authoritative behavior.

---

# ADR-042 — Do Not Require Redis on Day One Without a Proven Need

**Status:** Accepted

## Decision

Redis is not automatically part of the canonical day-one architecture.

## Rationale

Introducing a distributed cache before measured need creates another operational dependency.

## Consequences

In-process or provider/HTTP/CDN caching may be used where safe.

Redis can be introduced later for specific workloads such as distributed caching/rate limiting if justified.

---

# ADR-043 — Do Not Cache Security-Sensitive Decisions Without Explicit Freshness Semantics

**Status:** Accepted

## Decision

Authorization, privacy, moderation, and Session state cannot use ordinary stale caching assumptions.

## Rationale

Stale security state can create unauthorized access.

## Consequences

Any such cache needs explicit invalidation/version/fallback semantics.

---

# ADR-044 — Use Structured Logging

**Status:** Accepted

## Decision

Production application logs will be structured.

## Rationale

Structured fields enable reliable search, aggregation, correlation, and redaction.

## Consequences

Logs should use stable event/error fields rather than prose parsing.

---

# ADR-045 — Use Distributed Trace Context Across Async Boundaries

**Status:** Accepted

## Decision

Trace/correlation context should propagate across HTTP, commands, event publication, Kafka consumers, projections, and external calls.

## Rationale

Chronologity's workflows cross multiple asynchronous components.

## Consequences

Tracing must not place full private payloads into spans.

---

# ADR-046 — Prefer OpenTelemetry for Instrumentation

**Status:** Accepted

## Decision

Chronologity should use OpenTelemetry as the vendor-neutral instrumentation layer for distributed observability.

## Rationale

It prevents core instrumentation from being tightly coupled to one observability vendor.

## Consequences

The telemetry backend remains a separate infrastructure choice.

---

# ADR-047 — Treat Audit Records Separately from Ordinary Logs

**Status:** Accepted

## Decision

Privileged/security-sensitive actions generate audit records with stronger semantics than general application logs.

## Rationale

Operational logs have different retention, access, and integrity requirements.

## Consequences

The audit store and retention policy must be explicitly designed.

---

# ADR-048 — Scale Workloads Before Splitting Services

**Status:** Accepted

## Decision

Chronologity will prefer:

```text
measure
optimize
scale vertically
scale stateless replicas
isolate workers
partition/replicate
shard/extract only when justified
```

## Rationale

Microservice fragmentation is not a prerequisite for scalability.

## Consequences

One source application may produce several independently deployed worker processes.

---

# ADR-049 — Backend HTTP Processes Are Stateless

**Status:** Accepted

## Decision

API and feed-aggregator HTTP services should not rely on process-local durable state or sticky sessions.

## Rationale

Stateless compute simplifies horizontal scaling and replacement.

## Consequences

Durable state belongs in canonical stores.

---

# ADR-050 — Separate Heavy Workers from HTTP Runtime

**Status:** Accepted

## Decision

Media processing, projection rebuilds, backfills, and other heavy asynchronous work run in separate processes/deployments.

## Rationale

Heavy work must not starve interactive traffic.

## Consequences

Worker resource pools can scale independently.

---

# ADR-051 — Begin With a Single Primary Region

**Status:** Accepted

## Decision

Initial production architecture should favor:

```text
single primary region
+
multi-zone resilience
+
global CDN/edge
+
tested disaster recovery
```

rather than active-active multi-region writes.

## Rationale

Active-active authority greatly complicates ordering, concurrency, Sessions, privacy, and recovery.

## Consequences

A future active-active design requires a dedicated architecture decision.

---

# ADR-052 — Shard Only After a Measured Bottleneck

**Status:** Accepted

## Decision

No datastore should be sharded merely in anticipation of scale.

## Rationale

Sharding creates routing, rebalancing, cross-shard, and operational complexity.

## Consequences

A sharding proposal must document the measured bottleneck, alternatives attempted, shard key, cross-shard impact, and rebalancing strategy.

---

# ADR-053 — Do Not Introduce a Graph Database Without Demonstrated Need

**Status:** Accepted

## Decision

Social and causal relationships will initially use relational/projected adjacency models.

## Rationale

A graph-shaped domain does not automatically require a graph database.

## Consequences

A graph store may be introduced only when actual traversal/query requirements justify it.

---

# ADR-054 — Deploy Worker Processes Independently Without Creating New Top-Level Apps

**Status:** Accepted

## Decision

The API codebase may produce independent deployable units such as:

```text
api-http
event-publisher
postgres-projection-worker
clickhouse-timeline-projection-worker
media-worker
notification-worker
```

without adding corresponding top-level applications.

## Rationale

Deployment independence and source-code ownership are separate concerns.

## Consequences

A worker becomes a new application/service only when scaling, availability, security, runtime, release cadence, or ownership justifies extraction.

---

# ADR-055 — Build Immutable Backend Artifacts

**Status:** Accepted

## Decision

Backend deployments use immutable, version-identifiable artifacts.

## Rationale

Reliable promotion, diagnosis, and rollback require knowing exactly what is running.

## Consequences

Artifacts should be associated with version, git SHA, and build ID.

---

# ADR-056 — Build Once and Promote the Same Artifact

**Status:** Accepted

## Decision

Where platform constraints allow, the same backend artifact is promoted through environments.

## Rationale

Rebuilding per environment can produce artifacts that were not actually tested.

## Consequences

Environment-specific behavior must come from runtime configuration rather than rebuilding source.

---

# ADR-057 — Use Rolling Deployments by Default

**Status:** Accepted

## Decision

Backend services use rolling deployment as the normal release strategy.

## Rationale

Rolling deployment is operationally simple and preserves availability.

## Consequences

Temporary version skew is a first-class compatibility requirement.

---

# ADR-058 — Use Expand/Migrate/Contract for Breaking Relational Schema Changes

**Status:** Accepted

## Decision

PostgreSQL breaking schema changes will be deployed through compatible phases.

## Rationale

Old and new application versions coexist during rolling deployments.

## Consequences

Destructive schema contraction occurs only after old code no longer depends on it.

---

# ADR-059 — Do Not Run Schema Migrations From Every API Replica

**Status:** Accepted

## Decision

Schema migrations run as explicit deployment jobs/processes.

## Rationale

Application replicas should not race for schema ownership during startup.

## Consequences

Migration credentials may be more privileged than runtime credentials and must remain separate.

---

# ADR-060 — Define Infrastructure Through Infrastructure as Code

**Status:** Accepted

## Decision

Production infrastructure should be version-controlled and reproducible through Infrastructure as Code.

## Rationale

Undocumented console configuration is difficult to review, reproduce, recover, and audit.

## Consequences

The exact IaC tool remains an infrastructure decision.

---

# ADR-061 — Test Infrastructure Semantics With Real Infrastructure

**Status:** Accepted

## Decision

Mocks alone are insufficient where datastore/message semantics are part of correctness.

## Rationale

Examples include:

- EventStoreDB expected versions;
- Kafka partition ordering;
- PostgreSQL transactions;
- ClickHouse projection behavior;
- object-storage upload semantics.

## Consequences

CI/integration suites require ephemeral or isolated infrastructure.

---

# ADR-062 — Colocate Unit Tests With Implementations

**Status:** Accepted

## Decision

Feature-local tests should be colocated with the implementation they validate.

## Rationale

This matches the canonical repository organization and makes behavior ownership obvious.

## Consequences

Dedicated cross-system test directories remain appropriate for integration/E2E harnesses.

---

# ADR-063 — Require Replay Tests for Critical Projections

**Status:** Accepted

## Decision

Critical read models must be validated through full replay from authoritative history/state.

## Rationale

Replayability is an architectural guarantee, not an assumption.

## Consequences

Timeline, authorization, privacy/moderation, and other critical projections require deterministic replay coverage.

---

# ADR-064 — Treat Privacy-Safe Replay as a Separate Guarantee

**Status:** Accepted

## Decision

Projection replay tests must explicitly prove that deletion/privacy/moderation state is not undone by historical reconstruction.

## Rationale

A technically correct event replay can still be a privacy failure.

## Consequences

Replay tooling must incorporate current redaction/deletion semantics.

---

# ADR-065 — Keep Full End-to-End Testing Focused on Golden Paths

**Status:** Accepted

## Decision

Full-system E2E tests cover critical workflows rather than attempting to test every behavior through the entire stack.

## Rationale

E2E suites are slower, more fragile, and harder to diagnose than focused unit/integration tests.

## Consequences

Most behavioral coverage remains lower in the test pyramid.

---

# ADR-066 — Treat Flaky Tests as Defects

**Status:** Accepted

## Decision

Chronologity will not normalize rerunning CI until flaky tests pass.

## Rationale

Untrusted tests weaken the entire delivery system.

## Consequences

Flakes require ownership and correction; quarantine is temporary.

---

# ADR-067 — Do Not Use Arbitrary Completion Statuses in `docs/README.md`

**Status:** Accepted

## Decision

The canonical documentation index will not maintain a completion-status mechanism.

## Rationale

Status bookkeeping becomes stale and distracts from the canonical document sequence.

## Consequences

`docs/README.md` describes organization and order rather than acting as a project tracker.

---

# ADR-068 — Omit “Relationship to …” Sections From Documentation

**Status:** Accepted

## Decision

Canonical Chronologity documents should not contain generic `Relationship to ...` / `Relates to ...` sections.

## Rationale

Those sections were determined to be redundant.

Cross-document references should appear only where they materially clarify a decision or dependency.

## Consequences

The canonical document template omits that section.

---

# ADR-069 — Pin TypeScript 6 for Linting While Compiling With TypeScript 7

**Status:** Accepted

## Decision

`packages/eslint-config` declares its own `typescript` dependency on the 6.x line. The repository root and every application continue to compile with the TypeScript 7 pinned in the root manifest.

## Alternatives Considered

Downgrading the whole repository to TypeScript 6 was considered, as was dropping `typescript-eslint` until it supports TypeScript 7.

## Rationale

`typescript-eslint` declares a peer range of `typescript >=4.8.4 <6.1.0` and refuses to load against TypeScript 7, so the two cannot share one version today.

TypeScript 7 is a native port of the 6.x compiler rather than a language expansion, so both versions currently accept the same syntax. The split therefore costs nothing in practice while preserving the compiler performance that motivated the TypeScript 7 pin.

Dropping `typescript-eslint` would remove type-aware linting on an unknown timeline. Downgrading the repository would discard TypeScript 7 and require the same migration later in the opposite direction.

## Consequences

Two TypeScript versions exist in the dependency graph. pnpm's isolated store keeps the 6.x copy local to the linter.

Syntax introduced in a future TypeScript 7.x release may fail to lint before `typescript-eslint` supports it.

This decision is reversed by removing the `typescript` dependency from `packages/eslint-config` once `typescript-eslint` supports TypeScript 7.

---

# ADR-070 — Use Zod for Runtime Contract Validation

**Status:** Accepted

## Decision

`packages/contracts` defines serialized boundary contracts with Zod. Command DTOs, event schemas, API request and response contracts, and environment schemas are written once in Zod and shared across applications.

## Alternatives Considered

TypeBox was considered, which makes JSON Schema the source of truth and is Fastify's native path. Valibot was considered for its substantially smaller client bundle.

## Rationale

Runtime validation is mandatory at trust boundaries, and TypeScript types alone cannot provide it. The same contract must be usable by the Fastify API, the feed aggregator, the React Native client, and Kafka consumers.

Zod 4 emits JSON Schema directly, so Fastify still receives real JSON Schema for validation and fast serialization rather than losing that capability to a runtime-only validator. This removes the principal advantage TypeBox held, while keeping type inference that reads closer to the product language.

Contracts are read far more often than they are written, and by more people than write them. Familiarity is therefore a durable property rather than a matter of taste.

## Consequences

Zod is a runtime dependency of every application, including mobile, where it is the largest of the three candidates. If mobile bundle size becomes a measured problem, the contract definitions remain the single place to address it.

JSON Schema is a derived artifact rather than the source of truth. Anything requiring hand-written JSON Schema must convert rather than author it directly.

---

# ADR-071 — Support Email and Password Authentication Alongside Magic Links

**Status:** Accepted

## Decision

Chronologity supports email and password authentication as a day-one method, alongside magic-link sign-in. Passwords are hashed with Argon2id and stored in PostgreSQL, never in event history.

## Alternatives Considered

Magic link alone was the earlier position, on the grounds that a password that is never stored cannot be breached. OAuth remains unscheduled and is blocked on provider credentials.

## Rationale

Requiring a mail round trip for every sign-in is a real cost to the person signing in, and one that falls hardest when mail is slow, filtered, or unavailable. Supporting both leaves the choice with the account holder.

Argon2id is named by `docs/architecture/security.md`; this decision does not select it so much as apply it.

## Consequences

Passwords become a permanent liability. Hashing cost must be maintained as hardware improves, and stored hashes carry their own parameters so raising cost migrates people on next sign-in rather than invalidating them.

Password reset is a new attack surface, mitigated by single-use, purpose-bound, time-limited links and by revoking every Session on completion. A password change revokes every Session except the one making the change.

Breached-password detection is adopted, which `docs/architecture/security.md` left optional. The corpus is vendored and searched locally rather than queried from Have I Been Pwned, because a third-party call inside registration would fail either open — silently disabling the check — or closed, making someone else's outage ours.

Registration cannot verify an address, so a registered address is unverified until a mailed link is redeemed, and password sign-in is refused until then.

Session semantics are unchanged. Both methods produce the same Session, the same rotating refresh credential, and the same revocation boundary, which is what `docs/architecture/authentication.md` requires of any added method.

---

# Superseded Decisions

This section preserves important architectural choices that are no longer canonical.

---

# SADR-001 — Express as the API Framework

**Status:** Superseded

## Prior Decision

Express was considered/used in earlier backend architecture discussions.

## Superseded By

ADR-005 — Fastify.

## Reason

Fastify better fits the desired lightweight, high-performance, schema-oriented API architecture.

---

# SADR-002 — NestJS as the API Framework

**Status:** Superseded

## Prior Decision

NestJS was considered as an alternative backend framework.

## Superseded By

ADR-005 — Fastify.

## Reason

NestJS was considered too opinionated for Chronologity's desired feature/CQRS architecture.

---

# SADR-003 — Database Polling Instead of Kafka

**Status:** Superseded

## Prior Decision

A simpler database-polling approach was considered for asynchronous processing.

## Superseded By

ADR-013 — Kafka.

## Reason

Durable independent consumers, replay, partitioned ordering, and projection scale justify Kafka as canonical infrastructure.

---

# SADR-004 — Sub-Moments

**Status:** Superseded

## Prior Decision

Nested Sub-Moment concepts appeared in earlier architecture/product structures.

## Superseded By

ADR-021 — no Sub-Moments.

## Reason

They conflict with the canonical three-dimensional Timeline and vertical chronological semantics.

---

# SADR-005 — Separate Admin Application

**Status:** Superseded

## Prior Decision

An admin application appeared in some earlier architecture structures.

## Superseded By

ADR-002 — administrative functions live in the consumer app with server-side role authorization.

## Reason

A separate frontend is not required to create a secure administrative boundary.

---

# SADR-006 — Scene Detection Integration

**Status:** Superseded

## Prior Decision

A scene-detection client appeared in an earlier API integrations design.

## Superseded By

ADR-031.

## Reason

It is not part of the current canonical product or API architecture.

---

# Decision-Making Rules

Future architecture decisions should follow these rules.

## 1. Product Semantics Come First

Infrastructure should preserve the product model rather than forcing the product into convenient storage/framework abstractions.

## 2. Authority Must Be Explicit

Every stateful feature must identify its authoritative store/model.

## 3. Derived State Must Be Rebuildable

A read optimization should not quietly become unrecoverable authority.

## 4. Security Boundaries Are Server-Side

Clients, caches, projections, and notification payloads cannot grant authority.

## 5. Eventual Consistency Must Be Deliberate

When state propagates asynchronously, the acceptable behavior and security implications must be documented.

## 6. Optimize From Measurement

Do not add caches, shards, services, or regions merely because they may someday be useful.

## 7. Historical Correctness Beats Ingestion Convenience

Chronology is based on represented occurrence, including backfill and correction.

## 8. Compatibility Is an Architectural Requirement

Persisted events, mobile clients, distributed consumers, database migrations, and rolling deployments all create version skew.

## 9. Operational Simplicity Has Value

A simpler architecture that meets requirements is preferable to a more distributed architecture with no demonstrated benefit.

## 10. Documentation Is Canonical

When an accepted architectural decision changes, update the affected canonical documents rather than allowing implementation and documentation to diverge.

---

# Future ADR Process

For a new material decision, record:

```text
ADR-NNN — Title

Status

Decision

Context

Alternatives Considered

Rationale

Consequences

Migration / Supersedes
```

Not every implementation choice deserves an ADR.

Use this ledger for decisions that materially affect:

- product semantics;
- domain authority;
- data architecture;
- application boundaries;
- distributed contracts;
- security/privacy;
- scalability;
- deployment;
- operational recovery;
- long-term implementation constraints.

---

# Decisions Intentionally Not Finalized

The following remain implementation/infrastructure choices rather than accepted architectural decisions unless finalized elsewhere:

- cloud provider;
- primary production region;
- container orchestration platform;
- managed Kafka provider;
- managed PostgreSQL provider;
- ClickHouse hosting model;
- object-storage/CDN provider;
- observability backend;
- audit-store implementation;
- secret manager;
- Infrastructure as Code tool;
- CI/CD provider;
- mobile E2E test framework;
- load-testing framework;
- concrete SLO values;
- concrete autoscaling thresholds;
- concrete Kafka partition counts;
- Redis introduction;
- dedicated Search engine;
- future graph database;
- active-active multi-region architecture.

These should not be silently treated as settled during implementation.

---

# Architectural Invariants

1. Accepted decisions are canonical until explicitly superseded.
2. Superseded decisions remain documented for historical context but do not guide implementation.
3. Product semantics take precedence over infrastructure convenience.
4. The canonical applications are API, feed aggregator, mobile, and web.
5. There is no separate admin application.
6. Administrative authorization is server-side.
7. Mobile uses React Native with Expo.
8. Web uses Gatsby.
9. API uses Node.js, TypeScript, and Fastify.
10. Backend domain/application organization is feature-based.
11. API features are organised as routes, services, and repositories.
12. PostgreSQL holds authoritative state; there is no event store.
13. Integration Events reach Kafka through the transactional outbox alone.
14. PostgreSQL owns relational/operational state where appropriate.
15. ClickHouse owns derived Timeline/historical read models.
16. Kafka is the canonical durable asynchronous messaging backbone.
17. Integration Events are enqueued deliberately by the service that caused the change.
18. Distributed publication is at-least-once and consumers are idempotent.
19. Projections are rebuildable.
20. Chronology uses occurrence time.
21. Historical backfill is first-class.
22. The three-dimensional Timeline model is preserved.
23. Sub-Moments do not exist in the canonical domain.
24. Temporal zoom and historical jumps are day-one capabilities.
25. Timeline pagination is cursor/keyset based.
26. Personalized Timeline copies are not materialized per User by default.
27. Historical significance is derived/versioned.
28. Moments have no product-level media-count limit.
29. Individual videos are capped at 90 seconds.
30. Media bytes upload directly to object storage.
31. Scene detection is not part of the canonical API.
32. Authorization has a dedicated API feature module.
33. Authentication and authorization are separate.
34. Privacy changes propagate across all exposure surfaces.
35. Deletion is a cross-system workflow.
36. Rebuild and restore must not resurrect erased data.
37. Notifications are asynchronous derived behavior.
38. Cache never owns truth.
39. Redis is not required without demonstrated need.
40. Security-sensitive caches require explicit freshness semantics.
41. Structured logging and distributed tracing are canonical.
42. OpenTelemetry is preferred for instrumentation.
43. Audit records are distinct from ordinary logs.
44. Scaling precedes unnecessary service extraction.
45. Backend HTTP services are stateless.
46. Heavy workers are isolated from HTTP runtime.
47. Initial production favors a single primary region.
48. Sharding requires a measured bottleneck.
49. Graph infrastructure requires demonstrated traversal need.
50. Worker deployments need not become top-level applications.
51. Backend artifacts are immutable and promoted across environments.
52. Rolling deployment is the default.
53. Relational breaking changes use expand/migrate/contract.
54. Schema migrations run explicitly rather than from every API replica.
55. Production infrastructure is defined through IaC.
56. Real infrastructure tests validate infrastructure semantics.
57. Unit tests are colocated where practical.
58. Critical projections have replay tests.
59. Privacy-safe replay is independently tested.
60. Full E2E testing focuses on golden paths.
61. Flaky tests are defects.
62. `docs/README.md` does not track completion status.
63. Canonical documents omit redundant “Relationship to …” sections.
64. Unfinalized infrastructure/tooling choices must not be silently treated as canonical.
65. Material architecture changes update this ledger and affected architecture documents.

---

# Guiding Principle

When considering a future architectural change, ask:

> **What established constraint or measured problem requires this change, which canonical decision would it alter, what simpler alternatives exist, and what new long-term obligation will the change create?**

Chronologity should evolve deliberately. Architecture decisions should remain explainable long after the implementation details that motivated them have changed.

---

# ADR-072 — Enforce a Configurable Minimum Age and Store the Birthdate Outside Event History

**Status:** Accepted

## Decision

Account creation requires a date of birth and refuses anyone below a configured minimum age, defaulting to thirteen. The birthdate is stored in `user_restricted_data` in PostgreSQL — a table separate from `users` — alongside the minimum in force when the account was admitted. It is never written to event history, never appears in a public profile, and is returned only to the person it belongs to.

Refusals do not state the threshold, and being below it is reported identically to an implausible birthdate.

## Alternatives Considered

Storing only a derived flag — "old enough" — was considered, and rejected: it cannot answer a regulator asking whether a specific account was correctly admitted, and it cannot be re-evaluated if the threshold changes. Storing an attestation checkbox instead of a date was rejected for the same reason.

Per-jurisdiction thresholds — thirteen under COPPA, sixteen under GDPR Article 8 where a member state has not lowered it — are the eventual correct answer, but they require a country signal, and `docs/domain/users.md` defers country to a separate legal decision. One global configurable minimum is the honest interim.

## Rationale

A minimum age cannot be enforced without a birthdate, and a birthdate is restricted personal data. Event history is permanent by design, so anything written there cannot be erased when someone asks for their data to be deleted; that alone disqualifies event history as the place to keep it. A separate table means no query written against the profile can return it by accident, and erasure is one targeted delete.

The threshold is configuration because it is a legal question rather than a technical one. Recording the value in force at creation is what makes a changed threshold survivable: without it, nobody can say afterwards which rule an account was admitted under.

Refusals stay silent about the number because an age gate that states its own answer only teaches people what to type instead.

## Consequences

Every account created from here carries a birthdate, and erasure work in Phase 5R must delete `user_restricted_data` explicitly rather than relying on a cascade from an event stream that never held it. Raising the minimum does not retroactively remove accounts admitted under a lower one; deciding what to do about them is a policy question this decision deliberately leaves open.

---

# ADR-073 — Read Roles Per Request Rather Than Carrying Them in Tokens

**Status:** Accepted

## Decision

Access tokens carry no roles and no permissions. Every privileged check reads current roles from `authorization_user_roles` at the moment of the request.

## Alternatives Considered

Embedding roles as token claims, which `docs/architecture/authorization.md:446-457` permits provided claims expire quickly, sensitive actions re-evaluate, and the feed aggregator does not trust stale privilege indefinitely.

## Rationale

That permission comes with three conditions, and meeting all three costs more than the lookup it saves. With a ten-minute access token, a revoked moderator keeps their authority for up to ten minutes; narrowing that means shortening token life for every request, privileged or not. The alternative — re-querying for "sensitive" actions — reintroduces the lookup while leaving a second, staler path beside it, and requires someone to correctly classify every future action.

The same document calls a token claim "a cache of authorization state, not the source of truth". The simplest way to honour that is not to cache it. One indexed lookup on a primary key, on requests that already make several, is not the bottleneck worth optimising before it is measured.

## Consequences

Revocation is immediate: removing a role stops the next request. Every privileged request costs one additional query, which is a cost to revisit if measurement ever shows it matters — bulk read authorization for Timeline queries will need a different representation regardless, and that is a separate decision.

---

# ADR-074 — Bootstrap the First Administrator Through a CLI Command

**Status:** Accepted

## Decision

The first administrator is granted by `pnpm --filter @chronologity/api grant-role --handle <handle> --role administrator`, run against the database by whoever holds deployment access. The command uses the same aggregate, read model, and audit trail as the HTTP route, recording no acting User and a reason.

## Alternatives Considered

An environment variable naming an account to be promoted at startup, and a seeded administrator account created by a migration.

## Rationale

Role assignment requires `admin:user-role-manage`, which only an administrator holds, so the first one cannot be made through the permission system. Something outside it must act.

A CLI locates that authority in database and deployment access — the same access that could rewrite the roles table by hand. It grants nothing that was not already possible. An environment variable instead makes a _running process_ capable of conferring privilege, so a leaked, mistyped, or stale value becomes a silent escalation that nobody performs and nobody reviews. A seeded account is worse: a known administrator identity exists before anyone has decided who should hold it.

## Consequences

Bootstrapping requires shell access to an environment that can reach the database, which is a deliberate constraint rather than an inconvenience to design around. The grant is audited like any other, with a null actor, so "who made the first administrator" is answerable even though no User did it.

---

# ADR-075 — Three Roles at Launch, With No Implicit Hierarchy

**Status:** Accepted

## Decision

Chronologity launches with `user`, `moderator`, and `administrator`. `user` is every account's baseline and is never stored. An administrator does not implicitly hold moderator permissions; someone needing both is granted both.

The canonical permission registry lives in `packages/contracts` and ships only permissions something enforces — at present `admin:user-role-manage`. The role-to-permission mapping stays server-side.

## Alternatives Considered

Also reserving `support` and `security` roles now, and registering the full permission vocabulary from `authorization.md:144-158` in advance.

## Rationale

`authorization.md:136-138` says to introduce a role only when a concrete responsibility requires it and to avoid role proliferation. Support and security have no responsibilities yet, so defining them now would mean inventing permissions nobody checks and boundaries nobody enforces.

The same reasoning governs the registry. Its purpose is to stop identifiers drifting, and it does that whether it holds one entry or forty; registering `moment:create` before Moments exist would fix a name the implementing phase has not yet earned the right to choose. Each phase adds its own.

Refusing implicit hierarchy follows `authorization.md:176-184`: explicit permission sets are safer than an inheritance chain the permission model has not defined.

## Consequences

`moderator` grants nothing until moderation ships in a later phase. The role boundary exists so that privileged capability has somewhere to land that is not `administrator`, which is the point of defining it now rather than the cost.

---

# ADR-076 — Use Vitest as the Test Runner

**Status:** Accepted

## Decision

Vitest runs unit and integration tests across every TypeScript package, from source. `node:assert/strict` remains the assertion library. Tests are excluded from the compiled build through a per-package `tsconfig.build.json`.

## Alternatives Considered

Node's built-in test runner, which is what the repository actually used through Phases 0A to 5C. That was a default rather than a decision, and it contradicted `docs/architecture/testing.md`, which names Vitest without an ADR ever recording a departure.

## Rationale

The built-in runner works, and its zero-dependency argument is real. What it cost was ergonomic and paid on every iteration: tests ran from `dist`, so a one-line change required a full compile before an assertion could run, and every stack trace pointed at generated JavaScript. Running from source removes both.

`node:assert/strict` stays for two reasons, and neither is that Vitest's matchers are inadequate.

The first is that assertions written against Node's standard library do not belong to the runner. This repository has already changed runners once — `node:test` through Phases 0A to 5C, then Vitest — and the assertions did not move. Keeping that property means the next such change is a configuration change rather than a rewrite of every test in the repository.

The second is cost against benefit. There are over a thousand assertion call sites and no `expect` call sites. Converting them buys no behaviour, and a mechanical conversion carries a specific risk: `expect(...).toEqual` treats a property explicitly set to `undefined` as equivalent to an absent property, while `assert.deepStrictEqual` does not. `expect(...).toStrictEqual` preserves the distinction, but `toEqual` is the matcher a bulk conversion reaches for, so the loosening would have been silent.

What this costs is ergonomic and paid where an error is inspected. `assert.rejects` takes a validator function rather than a matcher chain, so asserting on an error's type and its details together is more verbose than `expect(...).rejects.toThrow(...)`. That is a fair trade for assertions that survive the next runner.

Vitest reports diffs for assertion errors carrying `actual` and `expected`, which Node's `AssertionError` does, so the reporting improves regardless.

Integration tests are named `*.integration.test.ts`. They are tests, and the suffix should say so: anything globbing `*.test.ts` finds them, which means the unit configuration has to exclude them deliberately rather than miss them by accident.

The integration configuration loads the root `.env` itself rather than relying on the shell. A missing `POSTGRES_PORT` does not fail loudly — it connects to whatever else is listening on 5432 — and that has already cost one debugging session.

## Consequences

Test files no longer reach `dist`, so integration tests exercise source rather than the shipped artifact; the build is still verified by `build` and `typecheck` on every run. Turbo's `test` tasks no longer depend on a package's own build, only on its dependencies'. `pnpm test:watch` now exists. Mobile will use its own runner when that phase begins — `jest-expo` is what the Expo toolchain expects — so this decision covers the TypeScript backend and shared packages, not the whole repository.

## Amendment

The rationale for retaining `node:assert/strict` was rewritten. The decision is unchanged; the reason recorded for it was wrong in emphasis.

As originally written, it rested on `assert.deepStrictEqual` distinguishing a property explicitly set to `undefined` from an absent one, and asserted that "several tests here assert on payloads where that distinction is the point". Both halves were weaker than they read. `expect(...).toStrictEqual` draws the same distinction, so the capability was never missing from Vitest — only from `toEqual`, which is what a bulk conversion would have used. And of the repository's deep-equality comparisons, two depend on that distinction, not several; both set the property explicitly, so `toStrictEqual` would have caught a regression in either.

The reasons that actually hold are runner independence and the cost of converting a thousand call sites for no behavioural gain. They are now stated in that order.

This is recorded rather than silently corrected because an ADR is only useful if the reasoning in it can be trusted, and reasoning that turns out to be thin is worth knowing about — including by whoever next proposes revisiting the decision on the strength of the argument that was there before.

---

# ADR-077 — Run Verification in CI Before Choosing a Deployment Platform

**Status:** Accepted

## Decision

A GitHub Actions workflow runs lint, typecheck, build, unit tests, and integration tests against the same `docker/compose.yaml` used locally, on every push to `main` and `development` and on every pull request. It deploys nothing.

## Alternatives Considered

Waiting for the production-infrastructure phase, which is where the roadmap places the CI/CD platform decision, and continuing to rely on tests being run by hand before merging.

## Rationale

The roadmap defers CI/CD because choosing a deployment pipeline early tends to decide the deployment platform by accident. That reasoning applies to deployment; it does not apply to verification. "Everything passed before this merged" needs a home that is not one person's terminal, and a workflow that runs `pnpm` commands against a compose file commits to nothing about where the software eventually runs.

Reusing the local compose file rather than declaring service containers in the workflow keeps one definition of what the stack is. A drift between the services CI runs and the services a developer runs would show up as a test that passes in one place and not the other, which is the least useful failure available.

## Consequences

Integration tests now run against a database created fresh for each run, which removes the accumulation problem that made local runs slow, and means CI catches anything depending on pre-existing local state. Choosing a deployment platform remains open. If it eventually brings its own CI, this workflow is small enough to discard.

---

# ADR-078 — Make the Session the Revocation Boundary, Decided From Its Aggregate

**Status:** Superseded by ADR-094

## Decision

A Session, not an access token, is what can be revoked. Every authenticated request validates against the Session aggregate in EventStoreDB rather than against the `sessions` table, which exists to render a devices screen and decides nothing.

## Alternatives Considered

Treating the access token as the unit of authority and accepting any unexpired, correctly signed token. Alternatively, validating against the `sessions` read model, which is one indexed lookup instead of a short stream read.

## Rationale

A signed token is a bearer credential that nothing can withdraw before it expires. Making the Session the boundary means revocation has somewhere to take effect, and it gives "sign out everywhere" and account deactivation a single mechanism instead of one each.

Reading from the read model would have been cheaper and wrong in the case that matters. A projection that lags by even a second leaves a revoked Session authenticating requests for that second, and revocation that takes effect eventually is not revocation. The stream is short by construction — a Session accumulates a handful of events over its life — so the authoritative read is affordable.

## Consequences

Every authenticated request reads a stream. That cost is bounded by Session history rather than by account history, and it is the price of revocation meaning what it says. The `sessions` table must never acquire an authorization responsibility; if a future surface needs faster validation, that is a caching decision requiring its own measurement and its own record.

---

# ADR-079 — Revoke the Entire Session When a Refresh Credential Is Reused

**Status:** Accepted

## Decision

Refresh credentials rotate on every use. Presenting one that has already been rotated revokes the whole Session, ending both the legitimate holder's access and the attacker's.

`docs/architecture/authentication.md` requires rotation and leaves the response to reuse undefined. This defines it.

## Alternatives Considered

Refusing the reused credential while leaving the Session alive, which is the gentler behaviour and the more common default.

## Rationale

Reuse of a rotated credential has two possible causes: a stolen copy, or a client that lost the response to its own refresh. The two are indistinguishable at the moment they happen, and only one is dangerous.

Refusing the request while leaving the Session usable optimises for the harmless case. It also leaves whoever holds a stolen credential free to keep trying, and leaves the account's real owner unaware that anything happened. Ending the Session optimises for the dangerous case: the legitimate holder signs in again, which they can do, and the attacker's copy is worthless.

## Consequences

A client that races two refreshes against itself signs its user out. Clients must serialise refresh, which is a requirement worth stating in the client contract rather than a bug to work around server-side. The revocation is recorded in the audit trail with its reason, so a support question about an unexpected sign-out has an answer.

---

# ADR-080 — Never Write Secrets or Erasable Personal Data to Event History

**Status:** Superseded by ADR-095

## Decision

Event streams carry no credential and no personal data subject to erasure. Magic-link tokens, refresh credentials, and password hashes are stored as rows in PostgreSQL; dates of birth are stored in `user_restricted_data`. Events reference these by identifier, or record only that something happened.

## Alternatives Considered

Recording hashed credentials in events, on the grounds that a hash is not a secret. Recording a birthdate in `UserCreated`, where it would sit beside the other facts established at account creation.

## Rationale

Event history is permanent by design — that is what makes it authoritative and replayable. Permanence is exactly wrong for these two categories.

A credential written to history can never be rotated away. A hash is not a secret today, but it is a hash under today's parameters, and the whole point of storing cost parameters alongside a hash is that today's parameters will one day be inadequate.

Personal data subject to erasure cannot be erased from an append-only stream. `docs/architecture/privacy.md` requires that replay not resurrect erased data; the reliable way to honour that is for the data never to enter the stream. A relational row can be deleted, and a rebuild that reads history will not bring it back.

## Consequences

Some facts live in two places: the event records that an account was created, and a relational row holds the restricted detail. Erasure work must therefore enumerate those rows explicitly rather than relying on a cascade from history — which is a requirement on Phase 5R, recorded here so it is not discovered there. Every new event type must be checked against this rule when it is designed, since the cost of noticing afterwards is a stream that cannot be corrected.

---

# ADR-081 — Make Authentication Failures Indistinguishable, Including in Timing

**Status:** Accepted

## Decision

Every way an authentication attempt can fail produces one response. An expired link, a consumed link, and a link that never existed are one refusal. Requesting a sign-in link answers identically whether or not the address is known. A password sign-in for an unknown address still performs a full Argon2id verification against a cached dummy hash before refusing. Registering an address that already exists answers as though it succeeded and tells the owner by mail.

## Alternatives Considered

Specific errors, which are considerably kinder to someone who has genuinely mistyped an address or let a link expire.

## Rationale

Any difference an unauthenticated caller can observe between "this account exists" and "it does not" is an account-existence oracle, and an oracle is enumerable. Chronologity holds private personal history, so membership itself is information worth protecting — knowing that an address has an account here is a fact about a person.

Timing is such a difference. Returning early for an unknown address is measurably faster than verifying a password, and the gap is wide enough to measure remotely because Argon2id is deliberately slow. Equalising it requires doing the work anyway, against a dummy hash computed once per parameter set.

## Consequences

Diagnosing a genuine sign-in problem is harder, and support cannot ask the API whether an address is registered. The audit trail carries the specific reason, so the information exists where it is safe. Every future authentication surface inherits this obligation, including any OAuth path: an endpoint that distinguishes cases undoes the guarantee everywhere else maintains.

---

# ADR-082 — Create the User Through an Explicit Onboarding Step

**Status:** Accepted

## Decision

Authenticating creates an Identity and nothing else. The User is created by an explicit request supplying a handle, display name, and date of birth. Routes needing a User refuse an authenticated caller who has none with `ONBOARDING_REQUIRED`, distinct from both unauthenticated and forbidden.

## Alternatives Considered

Creating the User as a side effect of first sign-in, with a generated handle the person could change afterwards.

## Rationale

`docs/product/identity.md` treats the handle as chosen rather than assigned, and a generated handle is a name given to someone by a system. It would also make the first thing a new account does be a rename, and it would leave a supply of abandoned generated handles that the retention rules must then protect.

The cost is a real intermediate state: authenticated, not yet a User. That state exists either way — the alternative merely hides it behind a fabricated handle — so it is better named than papered over. `ONBOARDING_REQUIRED` tells a client to send someone to onboarding rather than to sign in again, which is a different repair.

## Consequences

Clients must handle a third authentication outcome. The access token gains a `userId` claim only once a User exists, so the guard falls back to a lookup for tokens issued before onboarding rather than forcing an immediate re-authentication. Anything that assumes an authenticated request has a User must say so through `requireUser`.

---

# ADR-083 — Retain Released Handles for a Configurable Cooldown

**Status:** Accepted

## Decision

A handle given up is retained, marked released, and reserved for its former owner for a configurable cooldown, defaulting to thirty days. Its original holder may reclaim it at any point during that period. Uniqueness is enforced by a PostgreSQL constraint on the normalised handle, never by checking availability and then inserting.

## Alternatives Considered

Releasing a handle immediately, and retaining it permanently.

## Rationale

`docs/product/identity.md` warns that immediate reassignment invites impersonation and breaks references, and leaves the retention period open. Someone who takes a recognisable handle the day it is freed inherits whatever recognition it carried.

Permanent retention avoids that and creates a different problem: handles are a finite namespace, and one abandoned account would hold a name forever. A cooldown is the compromise, and its length is a product judgement rather than a technical one, so it is configuration.

Uniqueness belongs to the database because the alternative is a race. Two people claiming the same handle simultaneously both pass an availability check; only one can win an insert against a unique index.

## Consequences

A handle can be unavailable without being held by anyone, and the refusal does not distinguish that from taken or reserved — which of the three it is would map out the reserved list. Stable identity is the user id throughout, so a handle change alters presentation only and breaks no authorship, relationship, or history.

---

# ADR-084 — Remove the Timeline Write Side From the Canonical Structure

**Status:** Accepted

## Decision

The Timeline has no aggregate, no lifecycle commands, and no events. `timeline.aggregate.ts`, the `create-timeline`, `update-timeline-definition`, `archive-timeline`, `restore-timeline`, and `delete-timeline` commands, their five events, and their event handlers are removed from the canonical structure.

No Timeline scope has an authoritative persisted definition. `timeline-definition.projection.ts` and `timeline-scope.projection.ts` go with them.

`apps/api/src/features/timelines/` keeps its name and becomes the module that maintains Timeline read models. Its Timeline query handlers are removed, because `apps/feed-aggregator/src/timelines/` already owns them. The duplicated `timeline-by-time`, `timeline-by-location`, and `timeline-by-user` projections are removed from `features/moments/`, leaving Timeline read models one home.

## Alternatives Considered

Keeping the commands and leaving them unimplemented, which is what the structure effectively did. Implementing them as written, on the grounds that the canonical structure is canonical.

## Rationale

Two canonical documents disagreed. The structure described create, rename, archive, and delete operations; `docs/product/timelines.md` names `TimelineCreated`, `TimelineRenamed`, `TimelineDeleted`, `AddMomentToTimeline`, `TimelineOwner`, and `TimelineMembers` specifically, and says they "should not be introduced merely because they are convenient nouns for implementation." Its invariants add that users create Moments rather than Timeline containers, that the Timeline is not an independently owned aggregate, and that it has no independent creation, rename, or deletion lifecycle.

The product document is more specific and refuses the concept outright, so it governs. A Timeline is a view of history that already exists, in the way a search result is a view: there is nothing to create because it is computed, and nothing to delete because deleting it would mean deleting the history underneath.

Removing rather than deferring matters. Files left in a canonical structure get built eventually, by whoever reads the structure and not the product specification — which is precisely the mistake this phase existed to prevent before Moments arrive.

"Where justified" permitted an authoritative definition for some scope. Nothing justifies one: every candidate scope is grounded in a fact with an existing owner, so a definition would restate what another aggregate already holds and add a second thing to keep correct.

## Consequences

Timeline behaviour is now entirely a consequence of Moments and their occurrence, visibility, and existence, which is what the product specification describes. Anything that later feels like it needs a Timeline aggregate should be read as a signal that a different product concept is missing — an explicitly user-created historical container would be a new concept with its own name, not a revival of this one.

The producer and consumer of Timeline read models are now named for what they do: `apps/api/src/features/timelines/` writes them, `apps/feed-aggregator/src/timelines/` reads them. Neither list of files duplicates the other.

Which scopes ship at launch remains open, and is answered when Moments exist to judge it against.

---

# ADR-085 — Use SeaweedFS for Local Object Storage, and Verify Uploads After the Fact

**Status:** Accepted

## Decision

Local object storage is SeaweedFS 3.95 in S3 mode. Media uploads go directly from client to storage through a presigned URL that authorises a single PUT to a single server-generated key. Nothing a client declares is trusted: what actually arrived is measured at finalization, and an object that fails verification is deleted rather than left in storage.

## Alternatives Considered

MinIO, the conventional choice, whose repository was archived in February 2026 and which stopped publishing container images in October 2025. LocalStack, archived in March 2026. Garage remains a viable fallback, and switching to it is a compose-file change because nothing above `integrations/storage/` knows which implementation is running.

SeaweedFS 3.97 was tried first and does not work: its master never binds a gRPC listener, so raft elects no leader and the S3 gateway never starts. 3.95 was verified end to end — presigned PUT, HEAD reporting size and type, deletion, and a tampered key refused — before anything was built on it.

## Rationale

The server generates every storage key because a client-supplied key is a request to overwrite someone else's object, and a presigned URL would authorise exactly that. The owner's identifier is part of the path so an object traces to an account without a database lookup, which matters for erasure.

Size is enforced at finalization rather than in the signature. A presigned PUT cannot reliably bound what a client sends, so verifying afterwards is the check that cannot be lied to — and deleting the oversized object is what makes the refusal complete rather than merely recorded.

Testing against real storage found something a stub would have concealed: **SeaweedFS does not enforce the signed `Content-Type`.** AWS binds it into the signature; SeaweedFS accepts a PUT that contradicts it. Had the declared type been treated as load-bearing, that would have been a silent hole. Finalization compares what storage reports against what was declared and refuses a contradiction, so the flow holds — but the honest description is that a client can lie consistently, and only decoding the bytes settles it. That is 5E-2's work.

## Consequences

Local development gains a fifth service, slower to start than the others: master election and filer connection take about forty seconds, which the healthcheck's start period accounts for.

An Upload belongs to a User rather than a Moment, because media exists before publication and drafts, retries, and abandonment depend on that. Association arrives with Moments.

Storage keys are recorded in `UploadRegistered` and read back rather than recomputed. A key derived by a rule would orphan every existing object the day the rule changed.

An upload's bytes are the one thing here not covered by ADR-080's rule against personal data in event history: history holds the key, not the media, and deleting the object leaves history describing something that no longer exists — which is the intended shape for erasure.

---

# ADR-086 — Establish What a File Is by Opening It, Not by Asking

**Status:** Accepted

## Decision

An uploaded file is opened by a decoder before it may be used. What the decoder finds — the kind of media, its dimensions, its length — is what gets recorded. What the uploader declared is kept alongside it as a claim, not as a fact.

An upload therefore has two distinct states after arrival: `received`, meaning the bytes are present and their size was checked, and `ready`, meaning the file was opened and is what it claimed to be. **Nothing may attach media to a Moment before `ready`.**

The ninety-second video limit is enforced against the measured length.

## Alternatives Considered

Trusting the content type storage reports, which is what ADR-085 had to settle for. The problem it left open was recorded honestly at the time: storage repeats the label the uploader attached, so a client that lies consistently is believed. That is closed here.

## Rationale

Asking storage what a file is amounts to asking the uploader to confirm their own story. Only a decoder can distinguish a photograph from a PDF named `photo.jpg`, and only a decoder can measure a video's length — which is why the ninety-second rule could not be enforced authoritatively until now.

The checking happens in a separate process, fed by an integration event, because opening a file takes seconds and nobody should wait on that while uploading. That in turn is why arrival and readiness must be different states: an upload that has arrived is not yet known to be usable, and collapsing the two would let a Moment reference a file nobody has looked at.

Two failure categories are recorded rather than inferred. Storage briefly unreachable resolves itself; a ninety-four-second video will be ninety-four seconds long forever, and retrying it burns capacity to reach the same answer. Attempts are counted before the work rather than after, so a file that reliably kills the decoder still leaves evidence it was tried.

## Consequences

Media processing requires ffprobe on the worker's PATH, installed by the operating system rather than bundled as a dependency: the decoder is pointed at files strangers upload, which makes it exposed enough to want a version that receives security updates.

Phase 5H must require `ready` when attaching media to a Moment. This is the constraint that makes the state distinction worth having, and it is recorded here so it is not rediscovered there.

Embedded GPS metadata is deliberately not extracted, even though the decoder could. Location data must pass through privacy rules and the owner's consent, neither of which exists until Phase 5F, and holding sensitive data with nowhere safe to put it is worse than not having it.

---

# ADR-087 — Translate Domain Events Into Integration Events Deliberately

**Status:** Superseded by ADR-096

## Decision

Each feature declares what it publishes and what that message contains. A stream category with no declared route publishes nothing; a routed category may still decline individual event types.

The Uploads feature publishes arrival only, carrying the upload's identifier, its owner, the declared kind, and where the bytes are. Registration, failure, and deletion stay internal.

## Alternatives Considered

Copying domain events onto the topic unchanged, which is what the publisher actually did. Its own header comment claimed the translation was "deliberate rather than a passthrough", and the code below set `payload: event.data`. Nobody noticed because no category was routed until this phase needed one.

## Rationale

A message on a topic becomes a contract the moment anything consumes it. Publishing internal history verbatim means every field added to an aggregate silently becomes public, and every consumer couples to the write side's internals — which ADR-014 asks us to avoid and which the comment claimed we were avoiding.

What crosses the boundary is therefore chosen. An upload's declared size and content type exist in history so a mismatch between claim and object is answerable later; that is auditing, not something a consumer should act on, so it stays behind.

Making this real required `UploadReceived` to say which upload it concerned. It previously carried only measurements, relying on the stream name for identity — a weakness independent of publishing, since an event that cannot be read on its own forces every reader to replay the stream to interpret it.

## Consequences

Adding a field to an aggregate no longer risks publishing it. Publishing something new is an edit to a feature's own route, which is where the decision belongs.

---

# ADR-088 — Run Integration Tests in CI Rather Than on a Developer Machine

**Status:** Accepted

**Supersedes the local-first position taken when CI was introduced in ADR-077.**

## Decision

Integration tests are run and judged by CI. They remain runnable locally, and running a single suite while working on it is expected — but the full suite is not something a developer machine is required to carry, and CI's result is what decides whether a change is good.

## Alternatives Considered

Keeping the full suite local, which was the position held until now. Reducing what runs locally — making ClickHouse opt-in, capping container memory — which frees roughly a gigabyte inside the virtual machine.

Switching container runtimes: Docker Desktop reserves its memory up front and cannot release it, so a laptop loses that allocation whether containers are busy or idle, while alternatives allocate dynamically.

## Rationale

Both alternatives treat the workload, and the workload is not the problem. Chronologity's stack is PostgreSQL, EventStoreDB, Kafka, object storage and a mail sink today; the roadmap adds four more workers, the feed aggregator, ClickHouse in earnest, and eventually mobile and web development servers. A developer machine runs out before that list does, and the next sub-phase — video transcoding — consumes whatever headroom a tuning change buys.

What settled it is how the failures present. When object storage exhausted the container disk, half the suite reported as failed or skipped: suites that had passed minutes earlier, and whole files that never started. That is indistinguishable at a glance from a regression, and time spent deciding which it was is time the tests cost rather than save. A test environment that fails for reasons unrelated to the code under test is not a test environment.

A CI run also starts from nothing every time, which removes accumulation as a category of problem. Two separate incidents came from state building up between runs: object storage growing by a gigabyte per run, and event history growing until a projection test took a hundred seconds.

## Consequences

Feedback on integration behaviour arrives in minutes rather than seconds, and work can be handed over having passed unit tests and typechecking but not yet the integration suite. That must be stated plainly when it happens rather than glossed as verified.

CI becomes load-bearing, so it must be maintained as real infrastructure: it needs every system dependency the application has, and a failure in it blocks work rather than being noise to route around.

Running a single suite locally while iterating remains worthwhile and is not discouraged. The claim being retired is that a developer machine should be able to run everything at once.

---

# ADR-089 — Produce Three Derivatives, and Defer the Encoding Ladder

**Status:** Accepted

## Decision

Checking a file also produces what is needed to show it: a preview image for photographs, a still frame for videos, and a repackaged copy of each video whose playback information sits at the front so a player can begin without downloading the whole file.

Multiple display sizes and multiple video qualities for adaptive streaming are deliberately not produced.

## Alternatives Considered

Generating a full ladder of display sizes and streaming renditions, which `docs/architecture/media.md:282-296` lists among possible derivatives.

## Rationale

Every size in a ladder is a guess until a client asks for a specific one, and no client exists: nothing in the repository referenced a thumbnail before this phase. The architecture is explicit that the encoding ladder "belongs in media technical specifications", and that a streaming protocol should be chosen on mobile compatibility and CDN support — none of which is decided.

What makes deferring cheap is that derivatives are regenerable. The original is always retained and never altered, so producing more later is a matter of running the work again rather than of having lost anything. That is the property that makes guessing unnecessary.

The three that ship are not guesses. A preview is a preview whatever the client turns out to be, a video needs something to show before it plays, and the repackaging is required by a product decision already taken: the product expects videos to autoplay, and a video that must download in full before it starts cannot.

The repackaging copies rather than re-encodes, so it costs no quality and little time — three hundred milliseconds for the test fixture, reading over the network.

## Consequences

Derivatives are produced in the same pass as checking, from the same message. The file is already being read, and there is one retry story rather than two. A slow video occupies one worker for its duration, which is acceptable while several workers share a consumer group.

They are written before the upload is marked usable, so nothing can observe an upload claiming a preview that does not exist. A file that passes checking but cannot be processed fails permanently: a file that cannot be re-encoded will not re-encode differently on a second attempt.

Deleting an upload lists everything under its prefix rather than removing a known set of keys. Deleted media that is still being served is among the worst failures available here, and a list of key shapes would fall out of step with what the code writes.

---

# ADR-090 — Use OpenStreetMap for Places, and Keep Location Identity Our Own

**Status:** Accepted

## Decision

Places are looked up from OpenStreetMap. When someone chooses a result, Chronologity creates a Location with an identifier of its own and copies in the name, coordinates and surrounding context; the map service's reference is recorded as provenance and never as identity. Nothing a later lookup returns rewrites what was recorded.

A Location may also be created with no search result behind it.

Automated tests answer place searches from recorded responses rather than calling the service.

## Alternatives Considered

Google Places and Mapbox, both of which return better data than OpenStreetMap for most searches. Neither is usable here, and the reason is licensing rather than quality.

`docs/product/locations.md` requires that a place keep the name it had when a Moment was recorded — a photograph from 1950 must not be relabelled with the name of the building standing there now. That requires storing the name permanently. Google's terms permit storing an identifier indefinitely and coordinates for thirty days, and grant no exception for the display name; Mapbox prohibits storage outright. Under either, showing a place would mean re-fetching its name, which would return today's name. The product requirement and the licences are directly incompatible.

OpenStreetMap permits permanent storage. It was the only candidate that could satisfy the requirement, which makes this less a choice than a constraint.

## Rationale

Identity has to be ours regardless of provider. `locations.md:90` requires stable identity independent of display name, address formatting, map provider and coordinates, and a place is not a coordinate: the same ground holds different places over time. Adopting a provider's identifier would make our history depend on their data model, and on their continued existence.

Keeping the provider reference as provenance preserves the useful part — two people choosing the same result reach the same place, enforced by a unique index rather than by a check that races — without conceding identity.

Tests do not call the service. A suite that depends on someone else's uptime is unreliable, and the public service is maintained by volunteers who ask for at most one request a second. The recordings are real captured responses rather than invented ones, which settled several details a stand-in would have got wrong: the field a place is named by can be absent, and the durable reference is the type and identifier pair rather than the `place_id` beside it, which is an internal row number that changes on reimport.

## Consequences

The application must identify itself in requests and respect a rate limit, both of which the adapter does. Data shown must credit OpenStreetMap contributors under ODbL — the search response carries that attribution so it cannot be forgotten downstream.

Search quality is lower than a paid provider's, and duplicate places will accumulate. Merging duplicates is deferred: `locations.md` still lists who may approve a merge and how a wrong one is reversed among its open questions, and guessing now would mean unpicking later.

Precision is recorded rather than inferred from a coordinate's decimal places, and a place whose position is unknown must carry no coordinates at all — enforced by a database constraint. Inventing a coordinate to fill a gap would fabricate exactly the historical certainty this model exists to protect.

---

# ADR-091 — Organise API Features as Routes, Services, and Repositories

**Status:** Accepted

Supersedes ADR-007 and ADR-008.

## Decision

An API feature is a route module, a service class, a repository class, and — where it has rules worth stating on their own — a pure policy module. Routes register HTTP concerns and call services. Services orchestrate a use case and own the transaction. Repositories hold the SQL. Policies are pure functions.

There is no controller layer: with `fastify-type-provider-zod` the route handler already receives a validated, typed request, and a class between it and the service would translate nothing.

Commands and queries are no longer separated. A service method that changes something and a service method that reads something sit on the same class.

Service methods are named for what they do, without repeating the noun the class already carries: `locationService.record(...)`, `uploadService.finalize(...)`, `userService.updateHandle(...)`.

## Alternatives Considered

Keeping the command/query split while dropping event sourcing. This would have preserved the file-per-operation shape — a command object, a handler, and a test for each — which is the larger share of the ceremony. The split earns its cost when the read side is a genuinely different model with a different store; inside a single feature reading and writing the same PostgreSQL tables, it produces two directories where one class would do.

Adding a controller layer, as most descriptions of this architecture do. Fastify's schema-validated handler already occupies that role, and across fifteen features a pass-through controller and its test would have added around thirty files that translate a request into the same request.

## Rationale

Five features cost 255 TypeScript files, 69 of them command and query handlers, for behaviour that is mostly create-read-update. The structure was carrying a cost that the domain was not asking for.

The split of responsibility survives the collapse. What made the previous arrangement worth defending was that business rules could not accumulate in route handlers — the concern ADR-007 was written to protect. That protection now comes from the service class and the policy module rather than from the command bus: a route that reaches for a rule has to reach into a service to find it.

Pure policy modules are where the rules actually live, and the codebase already demonstrates this working. `media-policy.ts`, `age-policy.ts`, and `handle-policy.ts` are pure functions with exhaustive unit tests and no infrastructure dependency. Dissolving aggregates does not dissolve them; it moves the surrounding ceremony and leaves them where they were.

## Consequences

Services cannot be unit-tested without substituting the database, and substituting it with a hand-written fake would prove the service works against the fake. So the rules go in policy modules, which are unit-tested exhaustively, and the services are proven by integration tests against real PostgreSQL. This is a deliberate shift of weight toward integration testing, and it is affordable because CI is already the authority for integration tests.

Repositories take the pool for reads and a transaction for writes, which is the convention the existing read-model modules already follow. The transaction stays visible at the call site rather than hiding inside a unit of work.

Dependencies are wired by hand at the composition root. No container: resolving dependencies at runtime from a registry is the ceremony this decision removes, not a different flavour of it.

---

# ADR-092 — Make PostgreSQL the Sole Authority and Remove Event Sourcing

**Status:** Accepted

Supersedes ADR-009 and ADR-010.

## Decision

PostgreSQL holds authoritative state for every feature. EventStoreDB is removed from the architecture, along with aggregate reconstruction, `decide`/`evolve` pairs, and persisted domain events.

Kafka, the transactional outbox, projections, and ClickHouse read models are unaffected.

## Alternatives Considered

Keeping event sourcing and fixing the write ordering, by appending to the event store first and projecting into PostgreSQL asynchronously. This is the architecture that was intended, and it would have been correct. It also means every read becomes eventually consistent, every feature needs a projection and a checkpoint, and read-your-own-writes has to be solved per surface — for a system whose event history nothing reads.

Keeping event sourcing for the features that plausibly want it and dropping it elsewhere, which is what ADR-009 already permitted. No feature turned out to want it: of roughly twenty-two event types across five features, exactly one crosses a boundary.

## Rationale

The implementation never matched the decision, and the gap was structural rather than a bug. Every command handler committed to PostgreSQL first and appended to the event store afterwards, outside the transaction — so a failed append left PostgreSQL holding a record the authority never recorded. This is the unsafe dual write the architecture explicitly forbids, present at all twenty append sites.

The benefits ADR-009 claimed were not being collected. Nothing replays a stream to rebuild state: `lib/projections/runner.ts` has no callers anywhere in the repository. No query reads an aggregate's own history. Deterministic reconstruction was a property of code that ran only to feed the next decision, which PostgreSQL already held.

Auditability, the strongest argument for keeping a log, is already satisfied without one. `auth_audit_events` and `authorization_audit_events` are written in the same transaction as the change they describe, and record refused attempts as well as successful ones — which an aggregate's event stream does not.

The product does not require an event log. Every reference to event sourcing in `docs/product/` is either a disclaimer that persistence is not being prescribed, or a constraint of the form "if event sourcing is used, it must not prevent erasure." What the product actually requires is that occurrence time is authoritative, that changes are explicit and carry provenance, and that nothing is silently rewritten. Rows with occurrence-time columns, explicit correction records, and an audit trail satisfy that.

Removing it also removes a hazard. `docs/product/privacy.md` and `docs/product/moderation.md` both carry open questions about reconciling erasure with append-only history; those questions disappear rather than being answered.

## Consequences

Historical integrity becomes an enforced discipline rather than a structural impossibility. Nothing now prevents an `UPDATE` from destroying a prior value, so where the product requires history to be preserved — corrections in particular — that must be an explicit correction record, and reviews must look for it. This is the real cost of this decision and it should not be understated.

Optimistic concurrency loses its mechanism and needs replacing case by case. Of nineteen expected-version checks, seven were creation guards already backed by a unique constraint and seven sat after the PostgreSQL write had committed, guarding nothing. The five that matter are addressed by conditional updates: rotating a refresh credential only if the presented one is still current, transitioning an upload only from the state it is expected to be in, and letting the first revocation win through `COALESCE`.

Uniqueness stays where it already was. `identity_emails`, `user_handles`, `users.identity_id`, `uploads.storage_key`, and the Location source reference are all enforced by PostgreSQL constraints rather than by application checks that race, and that does not change.

An `identities` table is now required. Identity existed only as a stream, leaving `identity_emails.identity_id` and `users.identity_id` pointing at nothing relational.

The schema has no foreign keys, because referential integrity was the aggregate's responsibility. It should acquire them, as work in its own right.

Local infrastructure loses a stateful service, and every authenticated request loses a network round trip.

---

# ADR-093 — Publish Integration Events Through the Outbox Alone

**Status:** Accepted

Supersedes ADR-015. Promotes ADR-016 from one publication path to the only one.

## Decision

A state change that must reach Kafka writes its integration event to `outbox_messages` in the same transaction. A publisher process claims unpublished rows, sends them, and marks them published.

The publisher that read EventStoreDB's `$all` stream is removed, along with its checkpoint table.

## Rationale

The outbox was built in Phase 4 for exactly this purpose, tested thoroughly, and then never used, because every feature built afterwards was event-sourced. Its test suite already proves the property that matters: a rolled-back transaction leaves no message behind.

It is also strictly better than what it replaces. The stream publisher required exactly one instance, because two would publish twice from the same checkpoint. Claiming rows with `FOR UPDATE SKIP LOCKED` lets several run.

## Consequences

Delivery stays at-least-once and consumers must remain idempotent, which they already are.

The outbox row carries no aggregate identity, and the Kafka envelope requires one. Columns for the aggregate's type, identifier, and version are added.

Published rows are never deleted and the attempt counter climbs without limit, so a permanently failing message retries forever. Both are acceptable at present volume and neither should reach production unaddressed.

Ordering is by insertion time across all messages rather than per partition key. Two overlapping transactions writing to the same key can publish out of causal order.

---

# ADR-094 — Decide Session Validity From the Sessions Table

**Status:** Accepted

Supersedes ADR-078, and keeps its substance.

## Decision

A Session, not an access token, remains what can be revoked. Validity is now decided by reading the `sessions` row: a session is usable when it has not been revoked and has not expired.

## Rationale

ADR-078 refused to trust the `sessions` table for one specific reason: a projection that lags by even a second would leave a revoked session authenticating requests for that second. That reasoning was sound and its premise is gone. There is no asynchronous projection — revocation is written synchronously, inside the request that performs it, in the same transaction as everything else it touches.

Reading the row is therefore not a weaker answer than reading the stream. It is the same answer, from the store that now commits it, and it is fresher than a stream read could have been in the architecture ADR-078 anticipated.

The cost it removes is not incidental. This ran on every authenticated request, and it was the one place the event store sat on the hot path.

## Consequences

The `sessions` table acquires an authorization responsibility, which ADR-078 forbade it. That prohibition existed to stop a derived model from deciding something it could not decide correctly; the table is no longer derived.

First-revocation-wins must be preserved. `COALESCE(revoked_at, ...)` keeps the reason a session ended as the reason that ended it, so a later ordinary sign-out cannot overwrite evidence of a suspected credential theft.

Refresh must check revocation in the same statement that rotates the credential, or a refresh racing a revoke can resurrect a revoked session.

---

# ADR-095 — Keep Erasable Personal Data Out of Anything Append-Only

**Status:** Accepted

Supersedes ADR-080 and generalises it.

## Decision

No secret and no erasable personal data is written to any store that is not straightforwardly erasable — which now means the outbox and the Kafka log rather than the event store.

Where a fact must be recorded but must also be erasable, it goes in a table of its own that a targeted delete can clear, as `user_restricted_data` already does for dates of birth.

## Rationale

ADR-080 was written against a store that no longer exists, and retiring it would have quietly discarded a constraint that still applies. The hazard moved rather than disappeared: outbox rows are never deleted, and a Kafka topic's retention is not an erasure mechanism. A birthdate placed in an integration event would be exactly as unerasable as one placed in an event stream.

This also carries ADR-072's protection forward. Its decision to keep the birthdate out of history was justified by permanence of the event log; the storage choice was right for a reason that now needs restating rather than removing.

## Consequences

Integration event payloads must be reviewed for personal data as deliberately as event payloads were. The rule that a payload carries identifiers and the fact of a change, rather than the personal data behind it, still holds.

Erasure remains a cross-system workflow and gets no easier. What changes is that there is one fewer store to reason about.

---

# ADR-096 — Enqueue Integration Events From the Service That Caused the Change

**Status:** Accepted

Supersedes ADR-087, and keeps its principle.

## Decision

A service that changes state and needs the change published enqueues the integration event itself, in the same transaction, already in its published shape. There is no automatic translation from internal records to external ones.

## Rationale

ADR-087 established that publication is opt-in and deliberate — that a feature declares what it publishes, and what it does not declare stays private. The mechanism was a route table keyed on stream category, consulted by the publisher; the principle was that internal history must not quietly become a contract.

The principle is better served now, not worse. Previously every change was recorded in a form that _could_ be published, and a route table decided what actually was. Now nothing is publishable unless a service deliberately writes it as a message, which makes accidental publication require an act rather than an omission.

The translation also belongs where the knowledge is. The publisher had to understand each feature's internal events well enough to convert them; the service already knows what happened and what outsiders should be told.

## Consequences

The publisher becomes a pump with no domain knowledge, and the route registry is removed.

A service that publishes must construct the external payload explicitly. That is more typing than a mechanical projection of internal fields, and it is the point: the two shapes are allowed to differ, and the external one is a contract.

Exactly one integration event exists today — a media upload having arrived. That is not an accident of incompleteness; registration is an intention rather than a fact about a file, and failure and deletion are the API's own business.

---

# ADR-097 — Enforce Referential Integrity, and Restrict Deletion Rather Than Cascade It

**Status:** Accepted

## Decision

Every relational reference between authoritative PostgreSQL tables is a foreign key. All of them are `ON DELETE RESTRICT`, with a single `ON DELETE SET NULL` exception for `authorization_user_roles.assigned_by`.

The two audit tables — `auth_audit_events` and `authorization_audit_events` — deliberately have none.

## Alternatives Considered

`ON DELETE CASCADE`, which is the usual default and would make removing an account a single statement.

Leaving the schema without foreign keys, which is what it had.

## Rationale

The absence of foreign keys was a consequence of event sourcing: referential integrity was the aggregate's job, and these tables were treated as projections rather than as the record. ADR-092 made PostgreSQL the sole authority, which makes the database the right place for those relationships. Nothing enforced that a Session belonged to an Identity that existed.

Adding them exposed two ordering defects immediately, both writing a child before its parent: `resolveForEmail` inserted an address before the Identity it referenced, and account creation claimed a handle before the account existed. Neither could be observed before, because nothing was checking.

`RESTRICT` rather than `CASCADE` follows from the product model rather than from caution. `docs/product/users.md:299` states that account deletion is not equivalent to `DELETE FROM users`, lists eleven categories of data a User may relate to, and requires the fate of each to be decided deliberately. It separately requires that deleting one User must not erase historical records created by others. Cascade would decide every one of those silently, by a schema default nobody revisits, and would leave the media bytes in object storage that no constraint reaches. Restrict blocks nothing today, because nothing deletes a User; it obliges the deletion service, when it is built, to answer the question rather than inherit an answer.

`assigned_by` is the exception because it is already nullable — a role granted from the command line has no acting User — and a role change should survive the departure of whoever made it. The attribution goes; the fact stays.

The audit tables are excluded because a foreign key there would force a choice between destroying evidence on deletion and preventing deletion entirely, and neither is acceptable. Audit rows are evidence retained on their own basis and their own schedule, and are meant to outlive what they describe.

Three columns that resemble references are not: `outbox_messages.aggregate_id` is polymorphic, `projection_processed_events.event_id` identifies a message rather than a row, and `magic_link_tokens.email` is issued for addresses with no Identity on purpose.

## Consequences

Six integration suites were passing fabricated identifiers where a real parent is required, and had to be given real ones. That was the bulk of the work and it was worth doing on its own terms: those tests asserted against states the application cannot produce.

`apps/api/src/testing/fixtures.ts` provides the parent rows a test needs when its subject is something else.

Roughly seventeen thousand orphaned rows — development debris, plus rows predating the `identities` table — were removed by the migration that adds the constraints. It could not otherwise apply to a database that had been developed against. There is no production data.

A future deletion service must remove dependants in order. That is the intended consequence.

---

# ADR-098 — Attach Location Privacy to the Moment's Association, Not to the Place

**Status:** Accepted

## Decision

Viewer-relative Location precision is a property of a Moment's association with a place, not of the Location record. It is therefore implemented with Moments rather than with Locations, and the Location model carries no visibility or audience of its own.

## Alternatives Considered

Putting visibility on the Location, so that a place is exposed at a precision determined by whoever recorded it.

Implementing precision reduction ahead of Moments, on the assumption that the recorder receives exact coordinates and everybody else receives less.

## Rationale

A Location is shared reference data. Two people choosing the same search result reach one record, which is the property that keeps a place stable across everyone who was there. Its `recorded_by_user_id` is provenance rather than ownership: it says who first caused the record to exist, and confers nothing.

That leaves a Location with no audience to reduce precision for. Giving one person exact coordinates because they happened to be first, and a second person less for choosing the same place afterwards, would be a rule nobody could explain and one the documents never asked for.

The product model already says where privacy attaches. `locations.md` states that "can view Moment" and "can view exact Location" are different questions, and that different viewers may legitimately receive different precision for the same Moment. Both sentences are about a Moment. Precision is a property of one person's assertion that something happened at a place — which is what a Moment is — rather than of the place.

Twelve of the open product questions in that document are phrased in terms of Moments, viewers, or audiences. Building before those exist would answer them by implementation, which principle 4 of `docs/README.md` prohibits.

Nothing is exposed while this waits. No Location is shared with anyone: identifiers are not enumerable and no surface hands one to a stranger.

## Consequences

The Location model stays as 5F-1 and 5F-2 built it: identity, name, coordinates, precision as recorded, geographic context, provenance, and source. No visibility column, no audience, no viewer parameter on a read.

Precision reduction, when built, belongs to whatever reads a Moment — the API for authoritative reads, the feed aggregator for Timeline composition. Both must reduce, and neither may leak finer precision through a derived value: a distance computed from coordinates that are themselves withheld discloses them.

`GET /locations/:locationId` currently returns a place at full precision to any authenticated caller. That is acceptable for the searched public places it was built for, and is the reason a privately typed place — a home, named and positioned by hand — must not be treated as shared reference data once Moments can point at one. How Chronologity recognises such a place is open (`locations.md`), and is part of the same work.

---

# ADR-099 — Reach the Database Through TypeORM, and Keep Hand-Written SQL as the Schema Authority

**Status:** Accepted

## Decision

Repositories read and write through TypeORM rather than through hand-written SQL. Each feature declares its tables as decorated entity classes in a `*.model.ts` file beside the code that uses them: `features/users/user.model.ts`, `features/authentication/identity.model.ts`, and so on. Tables belonging to no feature — the outbox, projection checkpoints, applied migrations — live in `lib/database/outbox.model.ts`.

The schema authority does not move. Timestamped SQL migrations under `apps/api/migrations/` remain the only thing that changes the database, applied by the existing runner. The DataSource runs with `synchronize: false` and `migrationsRun: false`, and TypeORM's own migration machinery is not used.

One DataSource owns the only pool in the process. Raw SQL, where it is still the clearest thing to write, runs on the same connections.

## Alternatives Considered

Staying on hand-written SQL, which is what the six repositories were and what worked.

A query builder or ORM whose models live in a separate schema language, with TypeScript types generated from them. That answers the legibility question, but in the wrong medium: the description of a table ends up outside the feature that owns it, and the types the code actually uses are generated output nobody reads.

## Rationale

The motivation was legibility, and specifically the ability to open a feature directory and see what its data is. Raw SQL spreads a table's shape across every query that touches it, and there is no file to open to see what a User is.

Entities answer it in the medium the rest of the code is already written in: TypeScript, in the feature directory, importable, and documented in the same comment style as everything around them. A developer reading `features/users/` sees what a User is without leaving it.

TypeORM was earlier rejected here on the grounds that its decorators require the legacy semantics TypeScript 7 no longer supports. **That was wrong.** `experimentalDecorators` compiles and emits correctly under TypeScript 7.0.2, verified before this decision was taken rather than assumed.

`emitDecoratorMetadata` is deliberately off. It exists so an ORM can infer a column's type from the property's, and every column and relation here states its type outright. Left on, it emits a direct reference to each property's class, which throws on any entity naming one declared later in the same file — as `Identity` and `IdentityPassword` do.

Every pattern this schema depends on was verified against the real database before the port: `FOR UPDATE`, `FOR UPDATE SKIP LOCKED`, `ON CONFLICT DO NOTHING`, conditional updates reporting how many rows they moved, `UPDATE ... RETURNING` with a SQL expression, advisory locks, and transaction rollback. All of them are expressible, which is what let the outbox publisher come off raw `pg` and leave one pool in the process.

## Consequences

**The entities can lie, and nothing in the ORM prevents it.** This is the real cost of the decision. An entity is a hand-written claim about a table, and a migration that changes the table does not change the claim. `synchronize` cannot be used to check it, because it would report every partial index and check constraint the entities deliberately do not express, so its answer would always be "different" and would mean nothing.

`lib/database/schema.integration.test.ts` recovers most of the guarantee by asking the narrower question entities can answer: every column an entity claims exists, nullability agrees, and every column of every claimed table is mapped. It was verified to fail on a real added column, not merely to pass.

Two things the entities cannot express stay in the migrations and are commented there: partial unique indexes — `user_handles_current_idx` is the entire mechanism preventing a User from holding two handles at once — and check constraints, including the two on `locations`.

`.returning()` takes property names, not column names, and silently drops names it does not recognise, producing a statement with no `RETURNING` clause at all. That failed sixteen integration tests during the port. `orIgnore()` reports `identifiers` populated from the values handed to it whether or not a row was written, so a conflict cannot be detected from them; an explicit `.returning()` is what distinguishes a row that landed from one that did not. Both are load-bearing in five conflict checks and one rotation.

`reflect-metadata` is imported at each entry point and in the Vitest setup file, before any module that declares an entity.

`TYPEORM_LOG=1` prints every statement with its parameters. It is off by default and must stay off in a deployed process, since those parameters include values that must not reach a log.

---

# ADR-100 — Record a Real-World Event's Time as a Bounded Occurrence, and Defer Event Visibility

**Status:** Accepted

## Decision

A real-world Event carries one occurrence: a start, an end, and the precision the time is actually known at, reusing `occurrenceSchema` from `packages/contracts/src/time.ts` rather than defining a temporal vocabulary of its own. Precision is `instant`, `day`, `month`, or `year`.

Any authenticated caller may read an Event by identifier. No endpoint lists, searches, or otherwise enumerates Events.

## Alternatives Considered

A start and an end each carrying their own precision, so "began sometime that morning, ended at 17:00" is directly expressible.

A precision vocabulary of `exact`, `approximate`, `date`, and `unknown`, echoing the one `locations` uses for position, with `unknown` standing for an Event whose start or end nobody knows.

## Rationale

`real-world-events.md:154-188` asks Event time to express exact starts, approximate starts, dates without clock times, and multi-day spans. A bounded interval with a precision expresses all four without a new vocabulary: a concert is two instants hours apart, a convention is three days at `day` precision, and "sometime in 1969" is that year at `year` precision. The interval is what carries the approximation, so nothing has to invent a clock time to make storage tidier — which is the property `time.ts` was written to protect and the reason a Moment known only as "summer 1998" must not acquire a fabricated timestamp.

Reusing that type also means Events and Moments will describe time the same way when 5H arrives. A parallel vocabulary would have had to be reconciled with it later, and reconciling two temporal models after both have data is not a refactor anyone should choose.

Per-end precision was rejected as a larger claim than the evidence supports. *"What precision model should represent approximate Event times?"* is still an open product question, and the smaller answer is the one that can be widened additively later. The four-value vocabulary was rejected because it mixed granularity with confidence in one column and duplicated something the codebase already had.

## Consequences

An Event must have a bounded occurrence. Ongoing Events — a war still being fought, a project with no end — cannot yet be recorded honestly, and *"How should ongoing Events be represented?"* remains open. Adding an open end later is an additive migration; requiring one after data exists is not.

`checkOccurrence` enforces one thing the schema cannot: an occurrence claiming `instant` precision must have equal ends, because a two-hour window called an instant claims a precision nobody has. A reversed interval is reported ahead of it, since it is the reason the other cannot be judged.

**Event visibility is deliberately unbuilt.** `real-world-events.md:732-752` states that an Event's existence can itself be sensitive — a private ceremony, a support meeting — and that Event aggregation must not become a privacy bypass. Deciding who sees what requires Moments, viewers, and audiences that do not exist, and roughly a dozen open questions are phrased in those terms. This is the position ADR-098 took for Locations, for the same reason.

What makes it safe meanwhile is that nothing enumerates Events. There is no list endpoint, no search, and no Moment pointing at one, so an Event is reachable only by an identifier that is not guessable and that nothing hands out. That property is load-bearing: **the first surface that enumerates Events must resolve visibility first**, not alongside.

Duplicate Events are permitted, and `name` carries no unique constraint. Two people recording the same convention produce two Events, which is correct — every night of a tour shares a name and each is its own occurrence. Reconciliation is a later phase and needs the duplicates to exist in order to have anything to reconcile.

`created_by_user_id` is provenance and never ownership. It is commented as such in the migration and in the entity, because a column of that name invites exactly the opposite reading, and `real-world-events.md:549-563` is explicit that recording a public occurrence first confers no authority over anyone else's history of it.

---

# ADR-101 — Store a Moment's Occurrence With Its Offset, and Break Ties on Identity

**Status:** Accepted

## Decision

A Moment's occurrence is a bounded interval with the precision it is known at, reusing `occurrenceSchema` exactly as real-world Events do (ADR-100), plus one column real-world Events do not have: `occurrence_offset_minutes`, the UTC offset the client sent.

Chronological order is `(occurrence_start, moment_id)`. When two Moments share an occurrence, the identifier settles it.

Media must be `ready` and owned by the author before a Moment can be built from it.

## Alternatives Considered

Storing an IANA zone name rather than an offset, which survives daylight-saving rule changes and supports local reasoning the offset cannot.

Storing the instant alone, as real-world Events do, and treating local time as a presentation concern.

Ordering on occurrence alone, with ties left to whatever the database returned.

## Rationale

A `timestamptz` column keeps the instant and discards the offset. That is usually the right thing and here it is not: `moments.md:263` asks that enough context survive to reconstruct the intended historical meaning, and "half past seven in the evening" is not recoverable from an instant. A Moment at 19:30 in New York and one at 19:30 in Tokyo are the same experience described locally and two different instants; without the offset neither can be shown as the person lived it.

The offset was chosen over an IANA zone because the contract already carries it — `timestampSchema` is `z.iso.datetime({ offset: true })`, so every request has one and none has to be invented. A zone name is richer and would have to be asked for, which a phone can answer and an imported photograph often cannot. Widening to a zone later is additive; requiring one now would refuse history that arrives without it.

`moments.md:284` requires a deterministic order when two Moments share a time and leaves the mechanism open. The identifier is arbitrary but stable, which is what determinism means here. It deliberately does not claim to know which happened first — the specification says the interface should not imply more certainty than the data supports, and a random tie-break implies none.

The `ready` requirement follows from media being mandatory. An upload reaches `ready` only after a decoder has opened it and found it to be what it claimed (ADR-086). A Moment built on a file that later fails checking would be a Moment that could not have been created, and the constraint that made it valid would already have been satisfied.

## Consequences

Real-world Events store their occurrence without an offset. That is now an inconsistency: the same argument applies to an Event held at eight in the evening somewhere. It is left alone rather than changed in passing — Events have no offset to migrate from, and adding the column is additive whenever it is wanted.

**Nothing can be committed while a video transcodes.** This answers `moments.md`'s open question and is a real constraint on the experience, not merely a storage rule: someone who uploads a long video waits for it to be checked before recording the Moment. If that proves unacceptable, the alternative is a Moment that can become invalid after the fact, and that is the trade to reopen.

Paging uses `(occurrence_start, moment_id)` as a tuple rather than occurrence alone. A cursor on occurrence alone would either loop forever or skip a page whenever several Moments shared a time, which is not an edge case — a backfilled album of photographs from one afternoon produces exactly that.

Cursors are opaque and refused when malformed rather than ignored, because silently restarting would hand a caller a page it believes it has already read. They are not a security boundary: every read is authorized against the caller regardless, so a forged cursor can only move somebody around inside their own history.

`toUpload` is exported from the Upload repository so a Moment returns its media whole. The shape a caller receives is decided once, by the feature that owns the table.

Whether one upload may appear in two Moments is deliberately undecided. The primary key prevents the same file twice within one Moment, which is the incoherent case; a unique index on the upload alone would have decided the other silently, and neither `moments.md` nor `media.md` decides it.

---

# ADR-102 — Associate a Moment With One Place and Any Number of Occurrences

**Status:** Accepted

## Decision

A Moment has at most one Location and any number of real-world Events. Both associations are their own tables carrying an `origin` column, and both reference their target with `RESTRICT`.

`origin` admits one value today: `user-asserted`.

## Alternatives Considered

Symmetry — either one of each, or several of each.

Two nullable foreign keys on `moments`, which is smaller and needs no join.

Adopting the `status` and `origin` vocabulary that `timeline-first-curation-and-discovery.md` defines for Timeline relationships.

## Rationale

The asymmetry follows from what the two things are. `locations.md:433` says "the Moment-level historical Location should represent the experience as a whole", and that media pointing at several distinct places "may indicate the User has created a Moment whose historical boundaries should be reconsidered" — several places is usually several Moments. An Event is the opposite kind of thing: a shared occurrence that may span a marathon route or three cities, and a photograph at a wedding that is also part of a family reunion is genuinely both.

Foreign keys on `moments` were rejected because an association is an assertion, not a property. Both specifications require provenance in almost the same words — `real-world-events.md:508` asks whether an association was "explicitly established by a User; suggested by the system; inferred algorithmically; imported from trusted metadata", and `locations.md:420` requires inference "remain distinguishable from explicit User assertion or reliable embedded metadata". Provenance needs somewhere to live, and a column on the Moment is the wrong place for a fact about a relationship.

`origin` names only what something can produce. This follows the precedent 5F-2 set for `Location.source`: "Naming a source before anything can produce it would only invite something to be labelled with it inaccurately." The check constraint is widened when a capability arrives, which is what adding suggestions will look like.

No `status` column. Proposed, accepted, and disputed describe a suggestion's life, and suggestions do not exist; every association today is made by the author and accepted the moment it is written. The curation document's vocabulary is the right one to reuse when suggestions arrive, and adding it then is additive.

## Consequences

**A Moment's reads got deeper.** Returning Events whole means loading each Event's aliases and Locations too, so a page of Moments joins across six tables. That is a correctness-first choice: nothing has measured it, and `CLAUDE.md` asks for measured bottlenecks before optimisation. If a Timeline page proves slow, the narrower fix is an Event summary shape rather than a cache.

`toLocation` and `toRealWorldEvent` are exported alongside `toUpload`, so the shape a caller receives is decided once by the feature that owns each table. `toRealWorldEvent` reports what it is given: an Event loaded without its aliases looks like one that has none, which is why the relations are loaded explicitly at both read sites.

`RESTRICT` means a Location or Event that Moments still point at cannot be deleted. Nothing deletes either today, so this blocks nothing — it obliges whatever eventually does to decide what happens to the Moments first, which is the same position ADR-097 took throughout.

Association is a separate endpoint surface rather than a general update, because `moments.md:407` asks that changing a caption and changing a historical claim not be treated as the same act.

Neither a Location nor an Event has to belong to the caller. Both are shared: a Location is reference data (ADR-098) and an Event's creator holds provenance rather than ownership (ADR-100). Pointing at one somebody else recorded is the point of both being shared, not trespass.

---

# ADR-103 — Keep Every Edit to a Moment, and Correct Its Occurrence Separately

**Status:** Accepted

## Decision

Every change to a Moment writes a row to `moment_edits` recording what kind of change it was and what the changed thing was before. The change and its record commit in one transaction.

Correcting a Moment's occurrence is its own operation, not part of a general update.

Media is edited through separate add, remove, and reorder operations rather than by replacing the list.

Deletion writes `deleted_at`. Nothing is erased.

## Alternatives Considered

Recording only occurrence corrections, on the grounds that a caption typo is not history.

Recording nothing, which `moments.md:443` arguably permits by deferring auditability to "eventually".

Editing media by replacing the whole ordered list in one call, which would have reused the creation rules unchanged.

## Rationale

`moments.md:534` states the requirement plainly: "Preserve historical meaning. **Represent corrections explicitly.** Respect privacy and removal requirements." The same section is equally clear that this "does not mean preventing legitimate corrections" — historical integrity here is not immutability, it is traceability.

Recording every kind rather than only occurrence corrections is the more conservative choice in the direction that cannot be undone. Which kinds matter is an open product question; keeping all of them means it can be answered later from real records, while keeping only some means the answer is fixed now and the discarded ones are unrecoverable.

Separate media operations and recording every edit reinforce each other, and the pairing is why both were chosen. A whole-list replace cannot say whether media was added or removed — it produces a diff, and the intent has to be guessed from it. Separate operations put the intent in the request, so the record can state it rather than infer it. The cost is three code paths that must each enforce the media rules, which is why the rules are pure functions the paths share.

Occurrence correction is its own endpoint because `moments.md:443` says it is its own act: "a historical correction rather than an ordinary cosmetic edit", one that may move the Moment through chronological navigation. Folding it into a general `PATCH` alongside the caption would flatten exactly the distinction `moments.md:407` asks the product to preserve.

## Consequences

**`moment_edits` has a foreign key and cascades, unlike the audit tables.** `auth_audit_events` and `authorization_audit_events` deliberately have none, so security evidence outlives what it describes (ADR-097). This is a different kind of record: a Moment's edit history is the author's own content, not evidence held against them. When erasure eventually removes a Moment it must take this with it, or the record of what somebody wrote would outlive their right to remove it.

`previous` is `jsonb`, following the `context jsonb` both audit tables already carry. The shapes genuinely differ — an occurrence has three parts, a removal has one identifier — and the alternative is a table of mostly-null columns.

**Nothing reads `moment_edits` back.** It is written and kept. How corrections should be presented to users is still an open product question, and answering it by exposing an endpoint would be answering it by implementation.

Reordering is written as a delete and an insert rather than as a difference, because positions are dense and unique per Moment: swapping two rows in place collides with the index before the second can land.

Removing the last medium is refused rather than deleting the Moment. Media is mandatory, so a Moment without it could not have been created, and `moments.md:436` is explicit that deleting a medium is not deleting the Moment.

Deletion is a tombstone and there is no undelete. Restoring is not simply the inverse once erasure exists, and building it before those semantics are settled would be guessing at them.

---

# ADR-104 — Keep Every Follow Request, and Let a Follow Grant Nothing Yet

**Status:** Accepted

## Decision

Following is stored in `user_follows`, named for the fact that it relates two **people**. Approval is controlled by one preference, `requires_follow_approval`, independent of anything else.

Follow requests are never reused. A second ask after a refusal is a second row, and a partial unique index allows one pending request at a time.

**A Follow grants no access.** Every Moment remains private to its author.

## Alternatives Considered

Naming the table `follows`, which reads better at every call site.

Reusing one request row per pair, flipping its status back to pending when somebody asks again.

Deriving approval from a broader account privacy mode.

Letting a Follow confer visibility immediately, so the relationship does something.

## Rationale

`follows` was rejected because "follow" already means two things. `timeline-first-curation-and-discovery.md` counts "Contexts saved or followed", and following a historical context has different rules — nobody approves who watches shared history, and there is nothing there to block. The codebase has met this before: `real_world_events` is spelled out because three other tables use "event" for something else. A bare `follows` would claim a word that is not free.

Requests are kept because `social-graph.md:184` requires that repeated requests not become a harassment mechanism, says the cooldown policy belongs to later product design, and adds that "the social model must support it". Support means the data has to make it possible. A reused row would overwrite the moment of the last refusal, and a cooldown cannot be applied to a fact that was erased. Keeping every request costs one row per ask and leaves the policy open.

Approval is one preference rather than a privacy mode because `social-graph.md:165` asks for both semantics "even if the exact account-level privacy model is refined separately". That is permission to add a setting rather than wait, and a broader mode would have answered two of `users.md`'s open questions by implementation.

**The Follow granting nothing is the load-bearing decision.** `social-graph.md:167` says a Follow "must never bypass the visibility rules of individual Moments". Those rules currently permit one value, so the honest result of following somebody is that nothing changes. Making a Follow confer access would decide what a follower may see as a side effect of building relationships, which is precisely the accident this sequencing avoids: blocking does not exist yet, so there would be no way to stop it.

## Consequences

Three integration tests assert that following, and having a request accepted, grant no access. They were verified to fail — removing the authorship check in `MomentService.get` breaks exactly those and nothing else.

Approval is consent to be followed, not consent to be read. Those become the same thing only when a later sub-phase says so.

Only your own followers and following are readable. Whose lists are visible to whom is four open questions in `social-graph.md`, and an endpoint would have answered them.

Declining does not block, does not notify, and does not prevent asking again. Each is required or left open by the specification, and none is a gap.

`POST /users/:userId/follow` returns either a Follow or a request, and the answer says which. No endpoint discloses whether an account requires approval, because asking already reveals exactly as much as the asker needs.

Nothing notifies. Notifications are phase 5Q, and four open questions cover what should be sent and when.

---

# ADR-105 — Follow the Context, Not the Timeline, and Page on a Pair

**Status:** Accepted

## Decision

A person may follow a real-world Event or a Location. Each is its own table with real foreign keys. Neither requires approval, and neither grants access.

Every list in the social feature pages on a pair — the moment plus an identifier — rather than on the moment alone.

## Alternatives Considered

A single polymorphic `context_follows` table keyed on a context kind, matching how the reconciled relationship graph stores its nodes.

Making Timelines followable directly, which is what "follow a Timeline" sounds like it needs.

Leaving the 5I-1 cursors as they were, since no test was failing.

## Rationale

**Following a Timeline is following a context.** A Timeline is derived — it is what a viewer sees when they look at a Location, an Event, or a person — so there is nothing there to attach a follow to. The context is the stable thing, and following it produces exactly the behaviour asked for: when a Moment becomes associated with the Apollo Program, everybody following that Event is a lookup away. An interface may still say "follow this timeline"; the distinction is in the model, not the wording.

This also makes the notification trigger something that already happens. A stored Timeline would have needed membership maintained by something, and would have notified on membership change — which is the filing problem `timelines.md:48` exists to avoid.

Separate tables were chosen over one polymorphic table because a follow does not have the problem that made the relationship graph polymorphic: an edge joins two different kinds, a follow joins a person to one kind. Two tables keep real foreign keys, and ADR-097 added eleven of those precisely because nothing enforced that a Session belonged to an Identity that existed.

No approval, because there is nobody to ask. An Event's creator holds provenance rather than authority (ADR-100) and a Location is shared reference data (ADR-098). Requiring approval would give whoever typed a venue name first a veto over who may watch it.

## Consequences

**The cursors 5I-1 shipped were defective, and this corrects them.** They encoded a timestamp alone, while `GET /moments` encodes `(occurrence_start, moment_id)` for the reason that two rows can share a moment. Two follows made in the same millisecond — ordinary when somebody follows several people in quick succession — could be skipped or repeated across a page boundary. Nothing was failing because nothing exercised a tie.

Every social list now pages on a pair, and two tests force the tie deliberately by setting several relationships to one instant. Both were verified to fail against the old cursor.

The indexes on `user_follows` were rebuilt to carry the tie-breaking column, in both directions, because both are paged.

**Following still grants nothing.** A test asserts that following an Event gives no access to a private Moment associated with it. Following says what somebody wants to hear about; it says nothing about what they may see, and 5I-4 is where that changes deliberately.

There is no combined "everything I follow" list. Whether the two kinds share anything beyond the word is an open question, and one endpoint returning both would answer it.

`RESTRICT` means an Event or Location that people still follow cannot be deleted. Nothing deletes either today, so this blocks nothing and obliges whatever eventually does to decide what happens to the followers first.

# ADR-106 — Blocking Severs in One Transaction, and Reports Itself Asymmetrically

**Status:** Accepted

## Decision

A Block is its own table keyed on the pair of people, not a flag on a Follow.

Blocking is a single transaction that records the Block, removes the Follow in both directions, and settles any pending Follow Request in either direction as `cancelled`.

A Follow refused because of a Block reports differently depending on who is asking. The blocked person is told the account does not exist. The blocker is told plainly that they blocked this person.

Unblocking restores nothing.

## Alternatives Considered

A `blocked` status on `user_follows`, which would have avoided a table.

Recording severed requests as `declined`, reusing the status the resolution flow already writes.

Answering both directions identically, which is the simpler rule.

Restoring the severed Follows when a Block is lifted, so that lifting it returns things to how they were.

Suppressing the blocked person's view of the blocker's profile, which is one of the seven consequences `social-graph.md:246` requires.

## Rationale

**A Block is a relationship state, not an absent one.** `social-graph.md:257` says so directly, and the shape follows from what it has to do: a Block must hold when there is no Follow to hang it on, must survive the Follow being removed, and must be queryable in both directions before either person acts. A status on a row that may not exist cannot do any of that.

**Severing has to be atomic, because a partial Block is worse than a failed one.** A Block that recorded itself and left the Follow standing would tell the blocker they were protected while the relationship it exists to end continued. One transaction makes the two states impossible to separate.

**`cancelled`, not `declined`.** A Follow Request asks a question. Declining is an answer to it. A Block is not an answer — it removes the standing to ask — and recording it as a decline would put a refusal in the history that nobody gave, which matters because ADR-104 keeps every request precisely so that what was asked and refused survives.

**The asymmetry is the specification's, and it is coherent.** `social-graph.md:289` forbids announcing a Block and permits inferring one from behaviour. So the blocked person gets the answer a handle nobody holds would give — verified by a test that compares the two responses rather than asserting a status code, since identical is the actual requirement. The blocker already knows; a silence there would only confuse somebody about their own setting.

**Unblocking restores nothing** (`social-graph.md:315`). Either party may follow again from scratch, which for an approval-based account means asking again. Restoring would resurrect a relationship the blocked person may never have wanted back, and would make the Block's effect depend on state nobody can see.

## Consequences

**Blocking does not touch context following.** Following an Event or a Location is a relationship with shared history, not with a person, and there is nobody in it to block out. Severing it would punish somebody for what they are interested in. A test holds this.

**Two of the seven required consequences are not reachable yet, for different reasons, and neither is quietly skipped.**

Ordinary direct social discovery cannot be suppressed while `GET /users/:handle` carries no authentication guard: hiding a profile from a blocked account would be defeated by signing out. Building it now would be theatre. When a profile surface knows who is asking, this becomes real and is worth doing then.

Relationship-dependent access has nothing to bite on. Every Moment is private to its author and a Follow grants nothing, which 5I-2 asserts. The requirement is satisfied vacuously, and 5I-4 must satisfy it deliberately when visibility widens — which is why blocking was built before visibility rather than after. Once Moments can be seen, the remedy must already exist.

**The block list is one-directional by construction.** A caller sees whom they blocked and never who blocked them, because no direction of that list could exist without telling somebody they had been blocked.

Six open questions in `social-graph.md` about what a Block does to comments, reactions, tags, search, shared Events, and public Moments remain open. Every one is about a surface that does not exist.

# ADR-107 — One Cursor, a Swept Outbox, and a Testable Command

**Status:** Accepted

## Decision

Keyset cursors are encoded and decoded in one module, `lib/pagination/cursor.ts`, which every paged list uses. The two features that had written their own now import it, and `GET /uploads` — which had no cursor at all — is paged the same way.

Published outbox messages are swept after a configurable window. Unpublished and abandoned messages are never swept.

The role-granting command's decisions moved into a function the entry point calls, so they can be tested.

## Alternatives Considered

A fourth copy of the cursor encoding, written out in the uploads feature beside the three that already existed.

Deleting an outbox row the moment it is published, which needs no window and no configuration.

Sweeping from a scheduled job or a database trigger rather than from the publisher.

Testing the command by running the built script as a subprocess, which would prove the argument parsing too.

## Rationale

**The cursor duplication had already caused a defect.** 5I-1 shipped cursors encoding a timestamp alone while `GET /moments` encoded a pair, and nothing failed because nothing exercised a tie (ADR-105). Writing the encoding a fourth time invites the fourth version of that bug. One module, with its own tests, is where a rule this easy to get subtly wrong belongs.

**Extracting it found a second defect in the rule itself.** Both existing copies split the cursor on its last colon — but an ISO timestamp is full of colons, so a bare timestamp decoded as a well-formed pair: `2026-08-22T10:30` and `00.000Z`, paging from a moment fifteen seconds adrift instead of refusing. The seam is now the timestamp's trailing `Z`, which appears nowhere else in it, and a test asserts that the near miss is refused.

**The outbox is a queue, not a record.** Published rows are read by nothing, and keeping them forever grows a table without bound while holding payloads describing people indefinitely — which the privacy rules do not permit merely because nobody got round to deleting them.

**A window rather than deleting on publish**, because the row is the evidence that an event was emitted at all. When a consumer says it never received something, that is the thing worth looking at, and it is only worth looking at soon after. Seventy-two hours by default, and configurable because the right number is operational rather than architectural.

**Two kinds of row are never swept, for different reasons.** An unpublished message is still owed to the broker. An abandoned one is the only record that something could not be delivered, and removing it would destroy the evidence before anybody had looked at why. Both have their own test.

**Swept by the publisher, while idle.** It is the process that already owns the table, already runs continuously, and already knows when there is nothing to publish. Delivery is owed to somebody and housekeeping is not, so a sweep never delays a batch. Concurrent publishers take disjoint rows through `FOR UPDATE SKIP LOCKED`, the same mechanism that lets several of them publish.

**The command was untestable because it was a script.** Its decisions — an unknown role, a handle nobody holds, a handle whose claim was released, granting what is already held — are exactly the ones that need negative-path tests, and this is how the first administrator is created. The entry point now parses arguments and picks an exit code; everything else is a function tested against the real database.

## Consequences

**`GET /uploads` was previously uncontinuable.** It returned at most fifty uploads with no way to ask for the next, so somebody with more than fifty could not reach the rest through the API at all. It now bounds and pages like every other list, and its index carries the tie-breaking column.

**Counting a sweep required counting in the database.** A `DELETE ... RETURNING` run through TypeORM's `query()` yields the rows and the row count together, so the result's length is two whatever happened. The first version of the sweep reported two removals every time, and one test passed for that wrong reason before the count moved into SQL.

**`start:publisher` pointed at a worker that no longer exists.** The outbox publisher replaced the event publisher, and the script outlived it. Removed.

**Retention is a new required-with-a-default environment variable**, recorded in `.env.example`. Zero is permitted and means sweep as soon as a message is published, which is what the test suites use.

**Three cursor call sites now share a failure mode.** A change to the encoding breaks every paged list at once rather than one of them quietly. That is the intent — the alternative was a change breaking one list silently — and the module's own tests are the guard.

# ADR-108 — A Moment Has an Audience, and Reading Is Not Editing

**Status:** Accepted

## Decision

A Moment is `private`, `restricted`, or `public`. A restricted Moment carries its own list of people.

A Moment is public unless its author says otherwise, and the creation endpoint accepts a visibility so they can say so while recording.

Every Moment read requires a Viewer, public ones included. A Block hides two people from each other in both directions.

Reading and editing are gated by two different checks. `MomentService.get` admits anybody a Moment is visible to; `getForAuthor` admits only its author, and every change goes through that one.

An inaccessible Moment is reported as one that does not exist.

## Alternatives Considered

A fourth value meaning "my followers", which is what most social products would have.

Reusable named groups — "family", "climbing club" — pointed at by many Moments.

Defaulting to private, which is what every Moment recorded so far already is.

Letting anybody read a public Moment without signing in, as a public web page would.

Filtering inaccessible Moments out of a page after the query returned them.

Keeping one `get` and adding a flag to say whether the caller intended to edit.

## Rationale

**Three values, because `privacy.md:92` names three** and asks that the vocabulary stay "as simple as possible" while warning against "a complicated matrix of social-network privacy controls". There is no `followers` value because `social-graph.md:490` says a Follow does not override privacy: following states what somebody wants to hear about, never what they are entitled to see. A `followers` audience would quietly make the two the same thing.

**Per-Moment lists over reusable groups**, for the same reason, and one more: editing a group would silently change the audience of every Moment already pointing at it, which is a way to publish something to somebody without ever having decided to. Groups can be added later without changing what a Moment stores.

**Public by default is a decision, not a drift.** `privacy.md:80` says the default "must be decided explicitly before launch" and "should not emerge accidentally from implementation convenience". A platform for shared history whose every Moment is private by default is a platform nobody can use, and the creation endpoint takes a visibility so that choosing privacy does not mean publishing first and correcting after.

**Nothing already recorded changed audience.** Every existing row stores `private` explicitly, so moving the column default touched none of them. Those Moments were recorded under a documented promise (`moments.md:585`) that they were private, and a changed default is not consent.

**Public means public to a Viewer.** Requiring a caller is what lets a Block bite: a blocked person cannot route around it by signing out. That turns the consequence 5I-3 could only satisfy vacuously — "relationship-dependent access must not survive a Block" — into a real one, and it follows the standing rule that deep links never permanently confer access. Public web sharing remains possible later as a deliberately designed surface rather than as a side effect of an unauthenticated route.

**A Block hides both people from each other.** An asymmetric rule would leave the blocker still reading the history of somebody they said they wanted nothing to do with, and would let the blocked person infer the Block from access that continued in one direction only.

**Filtering happens in SQL.** A page that fetched twenty rows and dropped the inaccessible ones would return short pages while its cursor claimed there was more, and would step the cursor over Moments the Viewer was entitled to see. Correct keyset pagination requires the predicate to be in the query.

## Consequences

**The rule is now stated twice** — once in `checkVisibility`, once in the `WHERE` clause — because a set query cannot call a per-row function without breaking pagination. That is a real duplication and it is guarded rather than tolerated: a test records a Moment at each visibility and asserts, for every Viewer, that the list and the single read agree. Breaking either side fails it, which was verified both ways.

**Reading and editing had to be separated first.** `MomentService.get` was the authorization gate for all eleven ways a Moment can be changed. Widening it to admit Viewers would have handed editing to everybody who could see a Moment. A test walks every mutating endpoint with a Viewer who can see the Moment and asserts each refuses; collapsing the two checks back together makes it fail with `PATCH answered 200`.

**The global rate-limit ceiling became configuration.** A suite that drives one process through hundreds of requests in a minute is not the traffic the limiter defends against, and the number depends on where the process runs and how many replicas share the load. The tighter per-endpoint limits protecting authentication are untouched and still asserted.

**The public-user projection was written three times.** Adding a third copy for audience lists would have repeated the mistake ADR-107 records about cursors, and this one is a privacy projection — a field added to `User` and updated in two of three places leaks from the third. It now lives in the module that owns `User`.

**Viewer-relative Location precision is now unblocked, and still deferred.** `moments.md:585` deferred it because "there is no second viewer to reduce precision for", a premise this ends. The new reason is different: any signed-in Viewer can already read any Location's full coordinates directly, because a Location is shared reference data (ADR-098). Reducing precision inside a Moment response while another endpoint serves the same coordinates in full would protect nothing. Doing it properly means making the Location read viewer-aware.

What this does disclose is the **association** — that this person was at this place at this time — which is what making a Moment public means.

# ADR-109 — Disclose a Place Per Viewer, and Carry No Identifier When Reduced

**Status:** Accepted

## Decision

A Moment's author chooses, per Moment, how much of its place everybody else is told: `exact`, `neighbourhood`, `city`, or `hidden`. The author always receives the exact place. `exact` is the default.

Below `exact`, the response carries no Location identifier and no coordinates — only the geographic context, at the granularity disclosed.

Disclosure is a separate field from a Location's `precision` and must not be conflated with it.

Derivatives are produced with `-map_metadata -1`, so a delivered file carries none of the original's metadata. The original keeps all of it.

## Alternatives Considered

Deriving the tier from the relationship, as `locations.md:844` illustrates: creator sees the venue, a "close connection" sees the neighbourhood, a public viewer sees the city.

Reducing the Location in place — keeping the identifier, blanking the coordinates, replacing the name with the city.

Reusing `precision` for both, since the vocabulary nearly matches.

Defaulting to `city`, which is the conservative choice.

Stripping metadata from the original as well.

## Rationale

**The author chooses, because "close connection" is not a settled concept.** `social-graph.md` defines following, requests, and blocking; it does not define closeness. Deriving a precision tier from the graph would settle that question by implication, in a Locations phase, rather than deliberately. Author-set disclosure also answers `locations.md:1305` — "What Location precision options should Users see explicitly?" — by making them explicit rather than inferred. A relationship tier can be layered on later without changing what is stored.

**A reduced place carries no identifier, and this is what makes the whole thing work.** ADR-108 deferred this work on the grounds that any signed-in Viewer can read any Location in full through `GET /locations/:locationId`, because a Location is shared reference data (ADR-098). Reducing the place inside a Moment while leaving its identifier attached would be exactly that theatre: the Viewer would simply look it up. So a reduced place is not a reference to a Location at all — it is a coarser statement about where something happened, with nothing to dereference. This is `locations.md:855` applied directly: "avoid storing one pre-rendered Location string as the sole authoritative representation." The Location stays whole in the database and what a Viewer receives is derived per request.

**Precision and disclosure are different questions.** Precision says how well anybody knows where something happened; it is a fact about history and it is the same for everybody, including the author. Disclosure says how much of that a given Viewer receives; it is a privacy choice. A place known exactly may be disclosed as a city, and a place known only vaguely reports `broad` to its author too. Collapsing them would make it impossible to say "I know exactly where this was, and I am not telling you" — which is the entire feature.

**`exact` by default keeps sharing working.** A Moment recorded at a landmark shows the landmark without anybody having to go and permit it. This is a product decision rather than one inherited from the schema.

**The risk this accepts.** With Moments public by default (ADR-108) and places exact by default, a Moment recorded at home publishes an address until its author narrows it — the combination `locations.md:798` warns about. The mitigation is that the control exists, is per Moment, and can be set while recording. Whether some categories of place should reduce themselves automatically (`locations.md:1317`) stays open, and is where this would be revisited.

## Consequences

**The repository can no longer produce a `Moment`.** It returns an `UndisclosedMoment`, which carries the place whole plus the author's chosen disclosure, and only `disclosePlace` turns that into something sendable. This is deliberate: a read path that forgot to reduce would leak an exact position silently, and the type makes it a compile error instead.

That guarantee paid for itself immediately. The compiler found five read paths, and one of them — `listForViewer` — was written disclosing to the *author* rather than to the Viewer, which would have handed every stranger the exact place of everything they could see. A test now covers each path separately.

**`momentSchema.location` became `momentSchema.place`,** a differently shaped thing: a disclosure, an optional whole Location, and an optional area. Safe to rename because no client consumes it yet. A Moment with no place is `null`; a Moment whose place is withheld is a `hidden` disclosure, because "nobody said where" and "you are not being told where" are different facts and a client should be able to tell them apart.

**Delivered video was carrying its coordinates.** ffmpeg defaults to `-map_metadata 0`, and `faststart` runs `-c copy`, so a recording's `loci` box — where a phone writes the position — passed straight into the file that would be played. This was verified by reproducing it, not inferred: the box is present in the output before the fix and absent after. It was latent rather than live, because nothing serves media bytes to a Viewer yet; that is precisely why it was worth fixing now, while the fix is one argument and nothing depends on the old behaviour.

The image derivatives were already clean, because the JPEG encoder does not write EXIF. They get the flag anyway — that was the encoder's behaviour rather than an instruction, and a property worth having is worth stating.

**The original keeps its metadata.** It is what `GET /uploads/:uploadId/places` reads to offer place suggestions, and what private storage should retain is deliberately open (`locations.md:1313`).

# ADR-110 — Sign In by Phone, and Lock a Number That Has Gone Quiet

**Status:** Accepted

## Decision

A phone number is a way to sign in. An account holds one, and an email address remains required.

A number that has not been used to sign in for **60 days** stops working for sign-in until its holder re-confirms it. When somebody asks for a code for such a number, no text is sent and the account's email address receives a notice instead.

Every phone sign-in emails the account.

Codes are six digits, live five minutes, are stored only as hashes, are bound to the number they were sent to, and are spent after five wrong guesses.

## Alternatives Considered

Treating a number as a contact detail that never signs anybody in.

Letting a number stand alone, with no email address on the account.

Reusing `magic_link_tokens` for codes, since both are single-use secrets with an expiry.

Waiting for a provider that can answer whether a number was recently reassigned, and building nothing until then.

Notifying by email on every phone sign-in and calling that the whole defence.

## Rationale

**The recycled-number problem is the reason most of this exists.** Phone numbers are leased, not owned. A carrier disconnects a number when somebody stops paying and, after a holding period, gives it to a different person — roughly 35 million numbers a year in the United States alone. That person can then receive a code sent to it and sign in. There is no skill in the attack; they answer their own telephone. It is why NIST downgraded SMS as an authenticator.

**Dormancy is checked because dormancy is the precondition.** A number is only recycled after its holder stops using it, so a number that has gone quiet is exactly the one that may not be theirs any more. Locking sign-in after sixty days — comfortably inside the shortest carrier holding period — means a reassigned number is already refused before it can reach anybody new. Nothing about the code, the device, or the request could have told us this; only the silence could.

**Re-confirmation runs through email, which is what makes it work.** Whoever received a recycled number holds the telephone and nothing else. Requiring the account's address to bring the number back is a check they cannot pass. This is also why an email address stays required: it is the fallback that makes every other decision here safe.

**A dormant number produces a notice, not a silence.** ADR-081 forbids telling a caller whether an account exists, so the response is identical either way. But the account holder is a different audience from the caller, and reaching them through the address costs the attacker nothing they can observe. The stranger holding the telephone learns nothing; the person holding the address learns exactly what to do.

**Codes are not magic links, and share no table with them.** A link carries 32 random bytes and cannot be guessed, so single use and expiry are enough. A code is six digits somebody types — one in a million, which is guessable — so it needs an attempt counter, a much shorter life, and binding to the number it was sent to. Storing the two kinds together would invite treating them alike.

**A sign-in notice on every use, because prevention can fail.** Dormancy cannot see a SIM swap, where an attacker persuades a carrier to move a live number to their own SIM. Nothing buildable without carrier data can. The notice does not prevent that; it makes it visible the same minute, through a channel the attacker does not hold.

## Consequences

**This does not stop SIM swap**, and the product documentation says so rather than implying otherwise. Detecting it needs a provider that can report a recent swap or reassignment, and the place for that question is where a code is sent — `integrations/sms/sms-client.ts`. Adding it changes that adapter and nothing that calls it.

**Nothing reaches a real phone yet.** There is no provider account, so the adapter records what it would have sent. That is the same shape email has, where local development points at Mailpit. The interface does not change when a provider arrives.

**A refusal has to commit before it is thrown, and this was found by a test rather than by reasoning.** The first implementation counted a wrong guess and then threw from inside the same transaction, which rolled the count back — so guessing cost an attacker nothing, and the attempt limit did nothing at all. The test that spends a code after five wrong guesses caught it. Both code paths now record the refusal, return, and throw outside the transaction, matching what the password path already did.

**Wrong guesses are counted against the outstanding code, not the one guessed.** A guessed value usually matches no row at all, which is precisely the case that has to be limited; counting only exact matches would have limited nothing.

**Issuing a code spends any previous one for that number and purpose.** This differs from magic links, where old tokens are deliberately left alive so nobody can cancel somebody else's pending sign-in. With a short code the reasoning inverts: every live code multiplies the values an attacker may guess.

**Two spellings of a number are one number.** `libphonenumber-js` is a new dependency at `apps/api`, and a justified one — country codes overlap, national prefixes come and go, and lengths vary, so hand-rolling this is how one telephone becomes two accounts. A number with no country is refused rather than guessed at, because guessing would resolve an ambiguous number to a real telephone somewhere else.

# ADR-111 — Relationships Between Moments Are Claims, Not Derivations

**Status:** Accepted

## Decision

A Moment may be connected to another Moment by an explicit claim, stored one row per claim in `moment_relationships`.

Five kinds ship. `led_to` and `contributed_to` assert influence; `related_to`, `alternate_perspective`, and `contradicts` deliberately do not.

One end must belong to whoever makes the claim, and both ends must be Moments they can see.

A causal claim is refused when the known occurrence times contradict it. An order nobody can establish is not a contradiction.

A relationship is listed only when the Viewer may see the Moment at its far end.

## Alternatives Considered

An array of Moment identifiers on the Moment itself.

`led_to` alone, as the strictest reading of "intentionally small".

Recording a temporally contradictory claim and marking it disputed rather than refusing it.

Full cycle detection over the causal graph with a recursive query.

Requiring both Moments to belong to the claimant.

## Rationale

**A relationship is something somebody said.** `causality.md:103` is the rule everything follows from: "If Moment A occurred before Moment B, Chronologity knows only that A preceded B." Nothing is ever inferred from order. That single sentence is also what rules out the array, because an array of identifiers has nowhere to record the difference between "these are connected" and "somebody says these are connected".

**Four things an array cannot hold**, each of which a row does: what the connection means, who asserted it, how to read it from the far end without scanning every Moment, and how somebody relates their own Moment to yours without writing into your row. That last one matters most — an array would have made a cross-author claim into a modification of somebody else's Moment, carving an exception into the rule that only an author may change their own.

**Two causal kinds and three that are not.** `causality.md:415` insists contextual relationships must never imply causal ones. Without a non-causal option every connection anybody wanted to draw would have to be phrased as causation, which is precisely the conflation the specification spends pages preventing. `alternate_perspective` in particular is what makes shared history expressible: two accounts of one afternoon, neither causing the other.

**Uncertainty is preserved rather than resolved.** A cause may occur before its effect or during it; only a cause whose interval begins strictly after the effect's ends is refused. So "sometime in 1998" leading to "June 1998" is allowed, because Chronologity genuinely does not know the order and `causality.md:281` is explicit that *unknown order ≠ invalid relationship*. Refusing it would fabricate a certainty the history does not have — the same fault as inventing a day for a Moment known only to the month.

**Refusing, rather than recording as disputed.** `causality.md:253` requires only that a contradiction not be silently accepted, and `causality.md:263` that the product help resolve it rather than rewriting history. A refusal naming the conflict does both: nothing is altered, and the person can correct either the direction or the dates. A disputed state would have added a value nothing reads and which navigation would then have to learn to exclude.

**One end must be yours.** It keeps every claim anchored to a history its author actually lived, while still allowing the cross-author claims shared history depends on. Requiring both ends would have made shared history inexpressible; allowing neither would let strangers attach causal readings to somebody's history, which needs a dispute and moderation story that does not exist.

**No confidence scores**, per `causality.md:485`. "87% likely that Moment A caused Moment B" is false mathematical precision applied to a human life.

## Consequences

**Cycle detection needed almost no code, and the reason is worth recording.** `causality.md:643` asks that cycles be caught "where its temporal information is sufficiently precise". The temporal rule already does that: a cycle among precisely-dated Moments requires A before B before C before A, and the direction check refuses whichever edge closes it. Where dates are too coarse to order, the specification says not to reject — so such a cycle is permitted precisely because nothing can disprove it, which is the specified behaviour rather than a gap.

What remained was the one case time cannot settle: `A led_to B` alongside `B led_to A`. That is incoherent whatever the dates say, so it is refused as a logical contradiction rather than a temporal one, and checked separately for that reason. No recursive query, and no cycle rules on the contextual kinds — which `contradicts` would break, since two accounts may contradict each other in either order.

**Symmetric kinds needed a second unique index.** "A is another account of B" and "B is another account of A" are one claim. A unique index on the ordered triple would have let both rows exist and reported one relationship as two. An expression index on `(LEAST(source, target), GREATEST(source, target), kind)`, partial to the three symmetric kinds, makes the database decide that rather than application code.

**The visibility predicate finally lives in one place.** ADR-108 recorded the rule existing twice — once in `checkVisibility`, once in the SQL of `findForAuthorAsViewer` — and noted the duplication was guarded by a test rather than removed. Listing relationships needed it a third time, for the far endpoint, which was the point at which extracting it became clearly right. `visibleToViewer(alias)` is now the single SQL statement of the rule, used by both queries, and the agreement test extends to relationships.

**A relationship pointing somewhere inaccessible is omitted, not redacted.** `privacy.md:158` requires that Chronologity "never use a visible relationship to reveal an inaccessible Moment", and an identifier is itself the disclosure — returning the relationship with a blanked target would still say that something is there.

**Only the claimant may withdraw a claim.** Owning one end does not make somebody else's reading of history yours to retract. Withdrawing leaves both Moments untouched, occurrence included, which `causality.md` invariants 14 and 15 require and a test asserts.

# ADR-112 — Generate the OpenAPI Document From the Routes, and Publish It Nowhere Real

**Status:** Accepted

## Decision

The API publishes an OpenAPI document generated from the Zod schemas the routes already declare, through `@fastify/swagger` and `fastify-type-provider-zod`'s `jsonSchemaTransform`.

It is registered outside production only, and absent rather than protected there.

The document is committed at `apps/api/openapi.json`, and CI fails when it is stale.

Error responses are declared through one shared helper. Tags come from a hook per routes module. Every route carries a summary; descriptions are written where a consumer would otherwise be wrong.

## Alternatives Considered

Writing the document by hand, or maintaining it beside the code.

Serving it in production behind authentication.

Generating it on demand rather than committing it.

Declaring error responses on each route, and writing `tags` on each of the eighty-one.

Moving the existing implementation comments into `description` rather than writing new prose.

## Rationale

**It cannot drift, because it is not a second artifact.** ADR-070 chose Zod partly because Zod 4 emits JSON Schema directly, so Fastify already receives real JSON Schema rather than a runtime-only validator. The schema that validates a request, serialises its response, and appears in the document is one object. A hand-written document would be a promise nobody checks.

**Absent in production, not protected there.** A document naming every authentication surface is a map of the attack surface, and ADR-081 goes to some trouble to avoid disclosing whether an account exists. Not registering it leaves nothing to guard, mis-guard, or forget — which is a different and stronger property than a route that returns 401.

**Committed, because a contract change should look like one.** A diff in `openapi.json` on a pull request says "the boundary moved" in a way a changed line inside a route file does not. It is also what `packages/api-client` will generate from when Phase 10 arrives.

**One helper for error responses, because the interesting sentence is shared.** Every error at every status is the same envelope, so only the description varies. That let the most important thing a client developer needs to know — *a 404 must not be read as proof of absence* — be written once and appear on the thirty-six routes that can refuse. Written per route it would have been thirty-six chances to phrase it differently, and thirty-six places to forget it.

**Tags from a hook, for the same reason.** Nine hooks rather than eighty-one annotations, and a route added next year is grouped without anybody remembering to say so.

**Comments stayed where they were.** The argument for moving them — that two copies drift — belongs to executable duplication, where drift produces a wrong answer; this project has twice paid for that with cursors and the visibility predicate. Prose is different. A comment serves whoever next opens the handler and a description serves somebody who will never read the source, and where they overlap they are not really duplicates: one says "we do it this way because X", the other says "expect Y".

## Consequences

**This changed serialisation, not only documentation.** Fastify serialises through a response schema when one exists, and error responses previously had none. Declaring them routes every error through the serialiser, so a disagreement between `errorResponseSchema` and what `toErrorResponse` builds would silently strip fields. Integration tests now assert that a real 404 keeps its code, message, and trace identifier, that a real 400 keeps its `details`, and that a successful read is byte-identical to what it was.

**Composition had to be extracted first, and that is the load-bearing part.** Routes are registered conditionally on their services being present, so a generator wiring a subset would produce a document missing those routes — silently, and differently each time somebody added a service to only one of the two wirings. `composeApp` is now the single wiring, used by the process and by the generator, which is what makes "the document describes what the server serves" a fact rather than a hope. It is verified by counting: eighty-one operations in the document, eighty-one route declarations in the source.

**Connecting moved after composition.** Nothing between the two queries anything — repositories hold an uninitialised DataSource without touching it — so this is safe, and it is what lets the document be generated with no database, broker, or storage running.

**The generator reads `.env.example` rather than the environment.** Routes do not depend on anybody's credentials, so a document that required S3 keys to generate would be absurd, and a CI job could not produce one after a bare checkout. It has a useful side effect: generating the document now also proves `.env.example` still covers every variable the application requires, because a missing one fails there rather than on somebody's first run.

**Sixty-two of eighty-one operations carry a description.** More than the fifteen to twenty first estimated, because once the error helper carried the general warning, the remaining prose was about things a consumer genuinely cannot infer: that asking for a state which already holds succeeds, that a reduced place carries no identifier, that a relationship whose far end is inaccessible is absent rather than redacted, and that authentication answers say nothing about whether an account exists.

# ADR-113 — Reactions Are Names, Counted by Aggregate, and Hidden Rather Than Deleted

**Status:** Accepted

## Decision

Four reaction kinds ship: `loved`, `amused`, `astonished`, `saddened`. They are stored as names, never as glyphs.

One reaction per person per Moment, enforced by the primary key, so changing one is an update.

Counts are aggregated on read. There is no counter column anywhere.

Only counts are exposed, never who reacted.

An author may disable reactions on a Moment. Doing so hides the existing ones and refuses new ones; nothing is deleted, and re-enabling brings the same counts back.

Blocking severs whatever two people left on each other's Moments, inside the transaction that records the Block.

## Alternatives Considered

Storing the emoji a client renders.

A `reaction_count` column on `moments`, maintained on write.

Returning the list of people who reacted alongside the counts.

Deleting existing reactions when an author disables them.

Filtering blocked people out of counts at read time rather than severing at block time.

Including counts in the Moment response, so a client needs one request rather than two.

## Rationale

**Names, because an icon is not a meaning.** `reactions.md:101` requires that changing the icon or label of a stored reaction must not silently transform what it meant. A stored `❤️` would make restyling a retroactive edit of years of history; a stored `loved` lets the artwork change freely and the meaning not at all. It is also what allows the reactions to carry the product's own aesthetic rather than the Unicode Consortium's.

**Four feelings that describe the reader, not the history.** `reactions.md:99` warns against reaction types implying claims the product cannot support — a reaction must not amount to confirming that a Moment occurred as represented, because no verification capability exists behind such a claim. `loved`, `amused`, `astonished`, and `saddened` all say something about the person reading, and none of them corroborates anything.

**No counter column, because the roadmap forbids exactly that.** *Do not serialise high-volume interactions through a single contended row* — and a running total on `moments` is that row: every reaction on a popular Moment queueing behind one lock. Counts come from a grouped aggregate over `(moment_id, kind)`. `reactions.md:214` already calls counts derived and permits them to be eventually consistent, which is the door a projection walks through in phase 7 when the aggregate stops being cheap.

**The primary key is the rule.** `reactions.md:111` requires at most one active reaction per person per Moment. Keying the table on the pair makes replacement the natural operation and reaction inflation impossible by construction, rather than something the application must remember not to do.

**Counts, not identities.** `reactions.md:307` asks that the two be treated as separate decisions. On a restricted Moment, a list of reactors would tell everybody on that list who else was trusted with it — the audience revealed to itself. Your own reaction is returned, which is not a disclosure and without which a client cannot show what you chose.

**Disabling hides rather than deletes.** Somebody who reacted is not retroactively unheard, and an author who changes their mind gets the same Moment back rather than a blank one. It also keeps signal that a later moderation phase may need.

**A disabled Moment says so.** `enabled: false` rather than a count of zero, because "reactions are off" and "nobody has reacted" are different facts and a client that cannot distinguish them renders the wrong thing — the same distinction the place disclosure draws between a withheld place and no place at all.

**Blocking severs at block time.** `reactions.md:364` permits a Block to invalidate a reaction, and severing matches what a Block already does to follows and requests. Doing it once, in that transaction, keeps the cost bounded by what those two people actually did; the alternative is joining against `user_blocks` on every count query for the rest of the system's life.

## Consequences

**Refusing to react never names a Block.** A blocked person is told the Moment is not accepting reactions — the same sentence an author's own setting produces. The policy answers blocking first for that reason: reversing the order would let somebody learn whether reactions were enabled on history they are not permitted to see.

**Counts are absent rather than zero for a kind nobody chose.** The contract uses a partial record, so `counts` carries only what happened. A client rendering four buttons supplies its own zeroes; the API does not invent them.

**Withdrawing is permitted where reacting is not.** Somebody blocked after reacting, or reacting before an author turned reactions off, can still take theirs back. Trapping a reaction somewhere its author can no longer reach would be the wrong asymmetry.

**Counts are not on the Moment.** A Moment read and a Moment list would each need an aggregate on the hottest path in the system, for information a client can ask for when it needs it. Keeping them apart also leaves phase 7 free to serve them from a projection without changing the Moment contract.

**No Integration Event is published.** Uploads publish the only event in the system and it has a worker behind it. An event is immutable and versioned, so publishing one with no consumer would fix a shape 5Q has not yet decided it wants.
