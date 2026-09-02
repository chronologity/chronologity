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

# ADR-114 — Closing a Discussion Leaves It Readable, and Blocking Hides Speech Rather Than Deleting It

**Status:** Accepted

## Decision

A Moment carries a comment policy: `anyone`, `followers`, or `disabled`, chosen by its author. Closing a discussion refuses new comments and leaves everything already said readable.

Blocking hides each party's comments from the other and from nobody else. It severs the reactions they left on each other's comments.

Comments are ordered oldest first, at both levels, with one visible level of reply nesting. Editing preserves position; deleting leaves a tombstone where replies hang from it.

Mentions resolve to identity, never to a stored handle. A mention across a Block is refused.

Reactions on comments ship, with the same four kinds a Moment takes, and a Moment's reaction switch does not reach them.

Five hundred characters, after normalisation.

## Alternatives Considered

Hiding the discussion when comments are disabled, matching what ADR-113 does to reactions.

Deleting the comments between two people when a Block is made, matching what ADR-113 does to their reactions.

Storing the typed handle in a mention.

Embedding the first few replies inside each top-level comment rather than paging them separately.

Rejecting repeated text outright, rather than making retries idempotent.

## Rationale

**Disabling comments and disabling reactions deliberately differ, and the difference is what each thing is.** `comments.md:427` prescribes that existing discussion stay readable, and it is right to: hiding a tally erases an aggregate nobody authored, while hiding a conversation erases speech and leaves replies answering questions that are no longer visible. `reactions.md:301` asked for the two to be consistent; they are consistent in principle — an author closes the door, and what is behind it depends on whether anybody wrote anything.

**Blocking hides speech rather than deleting it**, which is `comments.md:459` almost verbatim: *prevent future interaction* is not *rewrite all prior conversation*. A third party keeps a coherent discussion, and neither party sees the other. The reactions they left are severed instead, because a count is not something anybody else took part in — the same reasoning ADR-113 used, applied to the half of this that is a tally.

**`followers` does not breach `social-graph.md`.** That rule is that a Follow grants no *access* — "what a follower may see is decided by the visibility rules of individual Moments, which a Follow must never bypass". A followers-only policy bypasses no visibility rule: a stranger who could read the Moment still can, which a test asserts directly. It governs participation, which `comments.md:417` asks to be kept separate from sight.

**Mentions store a person, not a handle.** `comments.md:503` requires that a mention survive its target renaming, which storing text could not do. A test changes a handle after the fact and reads the comment back.

**Idempotency is the caller's to declare.** `comments.md:561` asks that a retried submission not duplicate while repeating oneself deliberately stays allowed. Letting the client name the submission answers both without guessing at intent: the same identifier twice yields one comment, none twice yields two.

**Oldest first, which is the first ascending list in the system.** `comments.md:198`: reading a conversation newest-first privileges recency over the context that makes later replies comprehensible. Every cursor comparison here inverts accordingly, and a test proves the direction rather than assuming it.

**Comment reactions ship over a documented caution.** `reactions.md:406` says the initial model "does not require reactions to Comments" and that they "should be introduced only if they materially improve conversation rather than because reaction mechanics already exist elsewhere." This was a product decision taken with that caution read, and no further justification is claimed. Recording it plainly is better than inventing a rationale the document would not recognise.

## Consequences

**The block check in the comment policy is unreachable through HTTP, and this was found by trying to break it.** Removing it broke no test. The reason is that a blocked person is already refused by the Moment's own visibility check before the policy is ever consulted, so the branch cannot fire through a route. It is kept as defence in depth — if the visibility rules ever loosen, it still holds — and it is covered by the policy's unit tests. But the integration suite does not prove it, and saying otherwise would be false.

That is worth recording as a general caution: a check placed behind a stronger check is not tested by tests that go through the stronger one.

**Neutering the block filter had to be done carefully to mean anything.** The first attempt replaced the predicate with one that broke the query itself, failing five unrelated tests — which demonstrates nothing except that a broken query fails. Making the subquery unmatchable while leaving it valid failed exactly the one test that exists for it.

**A tombstone carries neither body nor author.** `comments.md:339` prefers a generic representation to one preserving identity nobody needs, and the replies still need something to hang from. A comment with nothing hanging from it simply disappears.

**Two parent columns rather than one.** `thread_comment_id` flattens presentation to a single visible level; `in_reply_to_comment_id` records who was actually being answered, which `comments.md:177` permits retaining and without which a busy thread loses that. Replying to a reply joins the thread and keeps the target.

**Counts exclude what a Block hides.** A count that included comments the Viewer cannot see would invite them to go looking for the difference.

**No counter columns**, for the reason ADR-113 records: a running total is the contended row the roadmap forbids.

**Mentions are re-read when a comment is edited**, rather than accumulating what it once said. Editing rewrites the text, so it rewrites who the text refers to.

# ADR-115 — Significance Is Derived Per Scope, and Cannot See Engagement

**Status:** Accepted

## Decision

All eight significance dimensions ship: causal, structural, temporal, personal, collective, Event, evidentiary, retrospective.

Significance is stored per Moment, per scope, per dimension — `person`, `real_world_event`, `location`, or `global` — never as one value per Moment.

The one human input is a single binary mark, `significant`. Anybody may mark any Moment they can see. A mark is private, always.

A temporal boundary is inferred from position: first or last in a scope.

Derived values are computed by a worker sweeping stalest-first, carrying an algorithm version and a provenance.

Nothing in the significance code can reach reactions or comments.

## Alternatives Considered

One significance value per Moment.

Causal significance as out-degree, which is the obvious implementation.

Personal significance as a graded vocabulary — milestone, defining, important.

Temporal boundaries inferred from gaps in a record, or authored directly.

Deferring collective significance until coordinated posting can be resisted.

Recomputation driven by events rather than by a periodic sweep.

## Rationale

**Scope is part of the meaning.** `historical-significance.md:76` argues that `Significance(Moment, Context)` is the better model, and its example decides it: a family's first photograph after immigrating may be among the most consequential Moments in that family's history and globally unremarkable. One value per Moment cannot hold both, so the key carries the scope.

**Causal significance counts descendants, not edges.** Invariant 7 forbids reducing it to out-degree, and the document's own example says why: in `A → B → C → D` every Moment has exactly one outgoing edge, and the whole chain descends from the first. A recursive walk, bounded in depth, is what distinguishes them — an unbounded walk over a graph people can extend is a query with no worst case.

**Retrospective significance is not a separate analysis.** *"Later causal history may increase the significance of earlier Moments"* describes what happens when you recompute, not a new graph to walk. It becomes observable only by remembering what a dimension scored when first assessed, which is what `baseline_value` is for.

**One mark, because it is the floor of any scale.** `historical-significance.md:305` says the initial product needs no numerical personal rating. A three-level vocabulary would ask somebody to rank their own life on boundaries nobody could explain consistently, and a single mark can always be reinterpreted as the middle of a scale added later.

**Anybody may mark anything they can see.** The document's own example is the last photograph of a loved one — which may have been taken by a sibling. Scoping the mark to the person who made it means two people marking one Moment is not a conflict but the model working, and invariant 12 already says a mark establishes nothing about universal importance.

**Marks are private because they are closer to a diary than to a reaction.** Which Moments matter to somebody reveals a great deal, and there is no shape in the contract that could carry another person's mark — the strongest form that guarantee can take.

**Boundaries are inferred from position, and gaps were rejected on principle.** A gap rule needs a threshold, and any threshold is a guess about somebody's life the system cannot check: a quiet year and a year of upheaval look identical from outside. An arbitrary constant inside a significance algorithm is exactly the *"accidental definition of what Chronologity considers important"* the document's closing line warns against. What position-based inference misses — a turning point leaving no trace — the personal mark already covers, which is why a second authored vocabulary was not needed.

**Collective significance ships knowingly weak, and this is recorded rather than glossed.** It counts distinct authors, never Moment volume, which invariants 13 and 14 require. But the document asks how coordinated posting should be prevented from manufacturing convergence, and that is unsolved. Distinct authors raise the cost without removing the hole. It carries its own algorithm version so it can be replaced alone, and nothing consumes significance until temporal zoom exists — which is the actual mitigation.

## Consequences

**The engagement constraint is enforced by construction, not by intention.** The architecture constraints ask that engagement remain separable *"so that a future optimization cannot casually turn reaction or view counts into historical importance"* — and reactions and comments were built in the two phases immediately before this one. So the scoring module imports nothing at all, the repository reaches no engagement table, and a unit test strips the comments from the source and asserts the code mentions neither. Intention is not separation; being unable to reach them is.

**Nothing reads derived significance.** Invariant 37 says Chronologity should not initially expose a universal score, and no endpoint does. The three routes concern the personal mark alone. Tests read the tables directly, which is honest about what exists.

**Reassessing one Moment had to become possible, and a test found that out.** The first implementation offered only a batch sweep, so a test checking one Moment reassessed the whole database — hundreds of Moments left by other suites, at roughly ten queries each. Two tests failed because the batch never reached the Moment under test, and the suite took over three minutes. Extracting `recomputeSignificanceFor` brought it to four seconds and gave the system something it was missing anyway.

**A guard test that could not fail was found by trying to break it.** Forcing every Moment at a place to count as a boundary broke nothing, because the test compared the first Moment against the middle and the first was *also* the earliest in its author's record — the record boundary hid the place rule entirely. Asserting that the middle scores exactly zero is what makes the rule testable. A comparison between two values can pass for reasons that have nothing to do with the rule under test.

**The sweep is periodic rather than event-driven.** `historical-significance.md:206` permits computing asynchronously, incrementally, or periodically, and says plainly that not every causal relationship should trigger a synchronous recalculation. Nothing publishes the events that would drive this, and inventing them here would fix a shape 5Q has not decided.

# ADR-116 — Moderation Decides What Chronologity Distributes, Never What Happened

**Status:** Accepted

## Decision

All seven moderation states ship: `allowed`, `warned`, `restricted_from_amplification`, `restricted_to_authorized_audience`, `age_restricted`, `temporarily_unavailable`, `removed`.

Moderation withholds and never deletes. An author always reads their own, whatever has been decided about it and whether or not they are suspended.

`users.status` gains `suspended`, and a CHECK constraint it never had.

Safety reports and historical-accuracy reports are separate tables with separate queues from the start.

Automation computes review priority and nothing else. No classifier, no inference, no automated state.

Restrictions short of suspension are restrictions on content, not partial account states.

A refused moderation attempt is recorded alongside the decisions.

Nothing publishes an Integration Event.

## Rationale

**A binary `allowed / deleted` is too coarse for a platform holding history.** `moderation.md:151` says so directly, and the middle states are what let Chronologity restrict distribution without asserting that something did not happen. The states cost almost nothing once the rest exists: age restriction needs only a threshold, because birthdates already exist for the minimum-age check, and temporary unavailability needs nothing but the state itself.

**The single statement of the visibility rule is what made this tractable.** ADR-114 consolidated Moment visibility into `visibleToViewer`, used by Moment reads, relationship reads, and comment reads. Suspension, removal, temporary unavailability, audience narrowing, and the age gate all landed there, and every existing reader received them without being changed. Had the rule still existed in three copies, this phase would have been three chances to disagree.

**The rule is split into a privacy half and a moderation half, because tombstones need them asked separately.** `privacy.md:158` forbids using a visible relationship to reveal an inaccessible Moment; `moderation.md:713` asks that a chain running `A → [unavailable] → C` keep its shape rather than silently become two unrelated pairs. Both are satisfiable only by distinguishing why a far end is out of reach. A tombstone stands where Chronologity removed something, and nothing stands where a person kept something private — the platform admitting its own act discloses nothing about anybody else.

**Suspension hides and does not cascade.** `moderation.md:687` warns that the default "should not be an accidental cascade deletion", and `social-graph.md:486` requires that relationship history survive, because the account may come back. Reinstatement is the test that makes this real: the suite asserts the restored Moment is byte-for-byte what it was.

**A suspended person keeps reading their own history, and may appeal.** `moderation.md:680` expects the reason for an action to reach the person it affected, which is worth nothing if they cannot answer. So writes are refused at one chokepoint with a one-entry allowlist — `POST /appeals` — rather than route by route. An opt-in check is one a future feature forgets and nothing notices; this way a new write endpoint is covered by having been written.

**Report volume orders a queue and establishes nothing.** `moderation.md:614` is explicit. Priority is computed from report count and reason severity; one credible threat outranks fifty spam reports, and a unit test asserts exactly that. A burst flag records that reports arrived together and is deliberately not an escalation, because a burst may mean many people saw something awful at once or that a group agreed to report somebody — the flag says which question to ask and must not answer it.

**Restrictions short of suspension are restrictions on content.** `users.md:897` asks what moderation can impose without full suspension, and the answer is the seven content states plus per-media moderation rather than a half-suspended account that may read but not write. Account tiers would multiply the states every future feature must reason about, and no product document asks for them.

**Per-media moderation carries a cascade nobody chose.** 5H refuses removing a Moment's last medium, because a Moment without media could not have been created. So a Moment whose last medium is moderated away becomes `temporarily_unavailable`. The rule was not invented here; leaving it unstated would have produced a Moment the system says cannot exist.

**No AI adjudicates anything.** `moderation.md:880` warns that AI must not silently become an authority on historical truth, and a system that cannot distinguish documentary evidence of an atrocity from an atrocity is not one to give authority to. The provenance column names `automated`; nothing infers.

**Nothing publishes an Integration Event.** No domain feature does yet, and there is no consumer for a `MomentRemoved` event until the Timeline projections of phase 6. Removal reaches significance in-process, which is the one place it must reach today. Building the event now would be publishing into a void; when projections exist they will need it.

## Consequences

**The single-Moment path and the set path are two statements of one rule, and only proving both is proof.** Deliberately breaking the SQL so suspended authors stayed visible left all forty-nine tests passing, because every single-Moment test goes through the TypeScript twin — `get` applies the rule per row, and a set query cannot call a per-row function without breaking keyset pagination. Seven tests driving the listing endpoint were added, and the same break now fails. Two implementations of one rule need two sets of tests; a suite that exercises one of them is not evidence about the other.

**`.returning()` takes property names, and column names fail silently.** `.returning(["report_id"])` wrote the row and reported every insert as a duplicate, so report prioritisation never ran and no appeal could be filed — three integration failures from one mistake. ADR-102 records the same trap in its other form, that `orIgnore` populates `identifiers` whether or not a row was written. Both are the same lesson: the insert result is only honest if it is asked correctly.

**A default that was harmless became a hole.** `toStatus` in the User repository coerced anything unrecognised to `active`, which was fine while the column held two values and let a suspended account read as active the moment it held three. It now falls back to `suspended`. A fallback is a decision about the case you did not think of, and widening a vocabulary changes which case that is.

**`restricted_to_authorized_audience` on a public Moment means its author alone.** Making a Moment public replaces its audience with an empty list, so narrowing a public Moment narrows it to nobody. What distinguishes the state from `private` is that it survives the author: they may still edit, and may not widen past what Chronologity decided. The integration test asserts that property rather than the vacuous one it started as.

**The twin and the SQL agree on suspension only, deliberately.** `isSuspended` tests for `suspended` and not for "anything but active", because the SQL does, and because catching `deactivated` too would have changed what deactivation means as a side effect of shipping moderation.

**Comment counting and comment listing became one predicate.** They stated the same rule separately and would have disagreed the moment moderation gave them a third clause. A count exceeding the comments a Viewer can read is a visible lie about how many people spoke.

**A suspended account's reactions and comments stop counting.** Both are aggregated live rather than stored, so each is a clause in one query, and reinstatement restores the totals exactly. Hiding what somebody contributed while still tallying it would leave their reach intact — and significance reads reaction volume, so the account would go on amplifying content it can no longer see.

**The public transparency dashboard is documentation, not an endpoint.** `moderation.md:927` asks Chronologity to explain its moderation principles publicly — what is prohibited, what restrictions exist, how reporting works, whether appeals exist. The same section says transparency does not require publishing abuse-detection thresholds or private enforcement data, and `moderation.md:941` warns that removal volume is not evidence of a good system. A metrics surface built now would publish exactly the numbers that mislead.

# ADR-117 — Events Say What Changed; the Indexer Reads the Rest

**Status:** Accepted

## Decision

Search documents are built by reading authoritative state. An Integration Event carries the entity and the nature of the change, never a snapshot of it.

Eleven event types across five topics — the first domain events the platform publishes.

Four document types: `moment`, `user`, `event`, `location`. No `timeline`.

Index versions live side by side in one table, keyed on `(index_version, entity_type, entity_id)`.

Searchability and visibility are separate columns. Searchability records what moderation permits; visibility, suspension, and audience are resolved against the Viewer at query time.

The Search store is PostgreSQL with `tsvector`/GIN for relevance and `pg_trgm` for typo tolerance. Coarse geography uses truncated geohash columns.

## Rationale

**A payload that describes a Moment would be a second definition of one.** `search.md:567` leaves this open; the reading indexer wins on two counts. A message replayed long after the fact produces a *current* document rather than resurrecting a stale one — the property that makes replay safe rather than merely possible. And adding a searchable field becomes a change to one builder rather than a new version of every event that could affect it. The cost is one indexed read per message, against tables the write path just touched.

**One document builder, two drivers.** The worker and the rebuild call the same function, which is what makes a rebuild worth trusting. A second implementation would only prove the two agreed on the day somebody last compared them — and a rebuild is used precisely when the incremental path is suspected.

**Rebuilding walks the database, not the log.** `search.md:186` says versions are built by replay. Because documents are built from authoritative state, walking the tables produces exactly what replaying every message would, and does not require the broker to have retained messages since the platform started.

**No `timeline` document type.** `search.md:114` lists one; `glossary.md:477` says a Timeline "is never stored, owned, or followed directly". A document needs a stable identity and a Timeline has none. What people search for is the Historical Context — an Event or a Location — which the glossary itself says an interface may present as a Timeline. The conflict was surfaced rather than resolved silently, and the glossary won because it describes the domain.

**Real-world Events and Locations have no moderation state and no author.** `moderation.md` recognises four subject types — `moment`, `comment`, `user`, `media` — and neither is among them. Shared history has nobody to hold responsible, and removing the First World War from Search is not a decision this path should be able to make.

**Geohash prefixes rather than PostGIS**, which is not installed. `search.md:96` offers either. Tiers rather than points because a Viewer entitled to know somebody was in a city is not thereby entitled to the doorway, and an index holding the doorway can leak it through a sufficiently narrow query however carefully the read path is written. A tier finer than the author's disclosure permits is null, not stored-and-filtered.

## Consequences

**Searchability and visibility had to be separated, and the first attempt got it wrong.** Folding a private Moment's visibility into its searchability meant nobody could search their own private history: the author was filtered out at index time, before anybody knew who was asking. `search.md:243` keeps them as two dimensions for exactly this reason. Suspension moved to query time for the same reason and is resolved through the indexed `author_user_id`.

**"Only these" has to mean only these.** The scoped rebuild skipped its fast path for any entity type absent from the scope and fell through to a full walk — so a request to reindex one Moment quietly rebuilt all 28,400 accounts. The integration suite went from 235 seconds to 7 once it meant what it said. A partial-scope option whose unlisted case is "do everything" is a footgun with a plausible-looking call site.

**A rebuild had to be batched before it was usable.** One transaction per entity across 42,000 entities is an operational tool nobody will wait for — the same defect the significance worker had in 5M, found the same way, by a test timing out. It is now one transaction per page of 500.

**A safe default hid a wrong one.** `geohashTiers` was written against an invented vocabulary — `coarse` and `region` — where the contract says `neighbourhood` and `city`. Both unrecognised values fell through to the deny-by-default arm, so nothing leaked and nothing failed; a Moment disclosed at city level simply had no geographic index at all. Deny-by-default protects against the consequences of a mistake, not against the mistake.

**The geohash encoder is pinned to an external reference vector**, not to whatever this implementation produces. `57.64911, 10.40744` encodes to `u4pruydqqvj` in every correct implementation. A test asserting the code's own output would only prove it has not changed.

**Nothing authoritative depends on indexing.** A Moment is recorded whether or not it is searchable yet, and the suite asserts it by recording one with no broker reachable at all. The residual exposure is indexing lag: a restriction reaches Search only when its message arrives, which is why lag is logged per message rather than assumed away.

**Strict cross-topic priority is not implemented and is not claimed.** `search.md:293` asks that restriction be processed ahead of ordinary updates; Kafka has no cross-topic priority. What holds is that events about one entity are ordered by partition key, and that because documents are built from authoritative state, whichever event arrives brings eligibility fully current.

# ADR-118 — Eligibility Lives in the Query, and Precision Travels With the Answer

**Status:** Accepted

## Decision

One endpoint, `GET /search`, over all four entity types, with an optional type filter. Every result carries what it is.

Eligibility is a single SQL fragment applied inside the retrieval query. Nothing is filtered out of a result set after it comes back.

Searchability records what moderation permits. Visibility, suspension, audience, and age are resolved against the Viewer at query time.

Three sort modes: relevance, occurrence newest, occurrence oldest. Ranking is versioned and produces the SQL that orders candidates.

Search cursors carry a query fingerprint and a ranking version, and a cursor that matches neither is refused explicitly.

Proximity search matches indexed cells. The radius selects a tier and a ring count, and the response reports the tier that answered.

## Rationale

**Filter, then rank, then paginate.** `search.md:249` is unambiguous, and the reason is that post-filtering leaks through page sizes, result counts, and pagination gaps even when the restricted thing is never displayed. A page that comes back short says something was removed; a total computed before eligibility says how much. So eligibility is a condition in the statement, the Viewer is a required argument, and there is no code path that retrieves without it.

**Ranking produces SQL rather than scoring in TypeScript.** Ordering has to happen in the query for pagination to be correct. Scoring afterwards would mean fetching every eligible candidate — an unbounded scan on request — or keeping a second definition of relevance that agrees with the first until somebody edits one. The module still imports nothing, which is what keeps engagement unreachable rather than merely unused.

**Two corrections to 5O-1 landed first.** `permitsSearch` refused `age_restricted` and `restricted_to_authorized_audience` at index time, which made an age-restricted Moment findable by nobody at all — adults included — and a narrowed one findable by no one. `search.md:229` puts age and audience at query time by name. Only `temporarily_unavailable` withholds outright now; `removed` still produces no document. Significance was also never populated, so the tie-breaker the ranking design depends on had nothing to read; it now comes from the `global` scope with its version, and is never returned to anybody.

**A search cursor is not a Timeline cursor.** A Timeline cursor names a position in chronology and stays meaningful; a search cursor names a position in one answer to one question under one ranking. It can therefore go stale in ways the other cannot, and the honest response is to say so. Silently restarting looks like results repeating; silently re-ranking pages somebody through two orderings spliced together.

**Proximity is answered at the granularity the disclosure supports, and says which.** A Moment whose author shared only the city has no finer cell stored, so a street-sized search cannot return it — the index does not hold the doorway, so no query can reach it. Reporting the tier that answered is the same treatment occurrence precision gets: the precision travels with the answer rather than being quietly rounded away.

## Consequences

**Ring coverage was sized by the wrong dimension, and an integration test caught it.** A geohash cell is a rectangle, and at the finest tier it spans about thirty-eight metres of longitude but only nineteen of latitude. Sizing the search by the longer side left the shorter one uncovered: a hundred-metre search looked at about twenty metres and returned nothing, rather than reporting that it could not. Rings are now sized by the shorter side, and the unit test asserts that points at the edge of the radius fall inside the cells actually searched.

**The first coverage rule was backwards.** It chose the coarsest tier whose cells fit *inside* the radius, which optimises for not over-returning. What matters is that everything within the radius is looked at: cells wider than the radius return a little too much, and that is the right way to be wrong, because the alternative loses history without saying so.

**A guard that could not fail was removed rather than kept.** `cellsAround` had a check against stepping past a pole. Nothing could make it fire — the geohash subdivision saturates at the poles by construction, since every comparison past ninety degrees answers the same way. A check that cannot fail is worse than none: it suggests the case is handled there when it is handled by the arithmetic. The property is now asserted directly instead, so a future encoder using modular arithmetic would break the test rather than the behaviour.

**Casting typed words to `tsquery` fails on the first space.** The lexical rank cast the caller's phrase directly, which turned every multi-word search into an internal error; it parses with `plainto_tsquery` now. Words a person typed are not query syntax, and treating them as syntax makes a stray character a failure.

**Breaking eligibility makes the suite slow as well as wrong.** Removing the audience clause did not just fail five tests — it made the run take minutes, because the predicate that protects people is also the one that narrows the scan. That is a coincidence rather than a design, and it is worth knowing: a sudden slowdown in Search is a reason to look at eligibility before looking at indexes.

**Zero results returns zero results.** Nothing loosely related is substituted, the total counts eligible candidates only, and a search matching nothing offers no cursor. No result is preferable to fictional history.

**A result is not a permission.** Opening one reauthorizes against current state, which the suite proves by making a Moment private between finding it and opening it. The index lags; the refusal does not.

# ADR-119 — Suggestions Obey the Same Rule as Results, or They Are the Leak

**Status:** Accepted

## Decision

Autocomplete suggests accounts, real-world Events, and Locations. Never Moments.

It uses the same eligibility predicate as search — the same function, not a copy.

Suggestions carry an entity type, an identifier, and a name. Nothing else.

Fewer than two characters returns an empty list rather than an error. Autocomplete has a rate limit of its own, tighter than search's.

"Did you mean" is offered only on a search that found nothing, drawn from names after eligibility, at a lower similarity threshold than search itself retrieves at.

## Rationale

**A prefix box is the worst place to widen disclosure.** `search.md:527` states the risk plainly: a private entity name must not leak because somebody typed a matching prefix. Returning "Woodward family reunion" to somebody typing "wood" discloses that the Moment exists, roughly what it is, and who it involves — without ever showing them the Moment. `search.md:301` requires autocomplete to receive the same eligibility treatment as results, "not a relaxed one".

So the design decision is reuse rather than reimplementation. One `eligibleForViewer` fragment serves both surfaces. A second, looser copy written because autocomplete "only returns names" is precisely how this feature leaks.

**No Moments.** The product's list of what autocomplete helps locate is People, Events, Locations, and Timelines — Moments are absent, and that reads as deliberate. A caption is the most sensitive text Chronologity holds, and finding a Moment is what search is for. The integration suite asserts the omission from the author's own account, with a perfect prefix match, so the absence is scope rather than a hole.

**A floor on the prefix.** Answering one character turns autocomplete into a listing of everything the asker may see, twenty-six requests wide. Two characters is the floor, and falling below it returns an empty list rather than an error, because a box somebody is still typing into has not done anything wrong.

**A rate limit, because the eligibility rule bounds the wrong thing.** Eligibility decides what each answer may contain; it says nothing about how many answers one person may collect. Autocomplete is an enumeration surface by construction, and a ceiling is the only thing that addresses that.

**An alias match has to say so.** Suggesting "The Great War" for an Event recorded as "The First World War" looks like a different Event unless the response carries both.

## Consequences

**"Did you mean" was dead code as first written, and arithmetic proved it.** The correction drew candidates with `pg_trgm`'s `%` operator, which matches at similarity 0.3 — the same threshold the search itself retrieves at. So anything the correction could find, the search had already returned, and the correction could never appear. It now draws from 0.15, which is the band between "close enough to retrieve" and "close enough to mention". A feature that cannot fire is worse than an absent one: it looks implemented.

**Corrections draw from names, not captions.** `nearestTitles` is restricted to the same three entity types autocomplete uses. Offering a caption behind a door marked "did you mean" would undo the decision that keeps captions out of suggestion surfaces, by a different route.

**The rate limit broke the test suite before it protected anything.** Adding a sixty-per-minute ceiling turned a run of searches into a wall of 429s, and the symptom was `results` being undefined rather than anything mentioning limits. The limits are injected now, exactly as the authentication ones are, and the suite raises them while one test builds its own application with a real ceiling to prove limiting works.

**Shared test names made a correctness test lie.** Every correction test used names with the same `Zqab` stem to control similarity — which made each test's name similar to every other test's, so the correction offered a name from a different test and the assertion failed for a reason that had nothing to do with the code. Twelve random hex characters score zero against each other; keeping four of them lands at 0.235 whatever the token. When a test needs a controlled distance, the control has to isolate it from every other test as well.

**A SQL comment with backticks terminated the template literal.** Writing `` `%` `` inside a template-literal SQL string ended the string and turned the rest into arithmetic. TypeScript caught it, which is the only reason it was cheap.

# ADR-120 — Discoverability Is a State, and Three Floors No Default Can Lift

**Status:** Accepted

## Decision

Discoverability is a state of its own: `moments.discoverable`, defaulting to true for a public Moment, with a control to unlist.

Discovery eligibility is `eligibleForViewer` from Search, reused verbatim and then narrowed — never a second copy.

Three floors apply regardless of the default: nothing age-restricted, nothing moderation keeps out of amplification, and nothing authored by an account under eighteen. A restricted Moment is never recommended even to its audience; a private one is never recommended even to its author.

Four surfaces: Explore, history from an Event, history at or near a Location, and history related to a Moment.

Explore orders by significance with per-author, per-place, and per-Event caps. No score is returned.

## Rationale

**Three different questions, three different answers.** Being able to see something is not permission to find it, and being able to find it is not permission to be shown it unasked. `discovery.md:159` states the rule this phase enforces: a recommendation system must never use its ability to infer that content exists as permission to expose it.

**Eligibility is reused, not reimplemented.** The roadmap names the failure mode directly — Discovery must not become a path around privacy that Search already closes — and the way that happens is a Discovery query with its own copy of the access rule, written because "it only returns titles" or "it only runs on public content". One predicate, narrowed.

**The default aligns the two states; the floors keep them distinct.** `discovery.md:157` says the model should not equate public accessibility with recommendation consent, and `discovery.md:926` warns against recommending sensitive personal history "merely because the underlying Moment is technically visible". A default of discoverable satisfies the first — the states exist separately and are separately controllable — and the floors are where the second actually bites. An opt-in default would have been the safer reading and would have shipped a Discovery system that recommended nothing, leaving the eligibility model untested against real content.

**The author's age, not only the Viewer's.** A young person's history stays reachable by whoever they shared it with and is never put in front of strangers. This is the one floor that is about who made something rather than what it is.

**Restricted is never recommended, even to its audience.** Being invited to see something is not asking to be shown it, and a recommendation would announce a Moment to somebody who had not thought about it in years. Private is excluded by the same clause, including from its own author: Discovery offers history to explore, and your own private history is not something to be offered back to you.

**Diversity is a cap, not a shuffle.** `discovery.md:641` warns against diversity operating as "an unexplained randomization mechanism", so ranking's order survives and what changes is how much of a page any one author, place, or Event may occupy. Three per author rather than one, because somebody who recorded a wedding from six angles has six Moments that belong together, and a cap of one makes Discovery incoherent in the name of breadth.

## Consequences

**`restricted_from_amplification` finally does something.** It has existed since 5N as a state nothing acted on, and `suppressesAmplification` was unit-tested with no consumer at all. Both were built because 5N knew this phase was coming; the integration suite now asserts that a Moment in that state is findable by Search and absent from every Discovery surface, which is the entire reason the state exists.

**The moderation rule exists twice, and a test holds it so.** `amplifiableStates` is the SQL twin of `suppressesAmplification`, and a unit test walks all seven states asserting the two agree. The same discipline `visibleToViewer` and `checkVisibility` follow, for the same reason: a set query cannot call a per-row function without breaking pagination.

**The age floor reads `user_restricted_data`, which is the second place in the system that does.** That table is deliberately separate so no query written against `users` can return a birthdate by accident. This reads it to make a decision and returns nothing from it, which preserves the distinction — but it is worth knowing rather than discovering later. It is resolved at query time rather than indexed because a birthday changes without anything happening, and an indexed answer would leave somebody excluded until a worker noticed they had turned eighteen.

**A nested template literal inside a SQL string terminated the string.** Building the moderation state list inline with `` `'${state}'` `` inside the outer template ended it and turned the rest into arithmetic — the same trap as a backtick in a SQL comment in 5O-2, one level deeper. It is hoisted out now. Both times TypeScript caught it, which is the only reason either was cheap.

**Two ordering tests were conditional and proved nothing.** Asserted against Explore over ten thousand shared Moments, "the more significant one comes first" was wrapped in a check that both appeared in the first fifty — which they usually did not. Scoping them to a freshly created Event nothing else belongs to made them deterministic. A test that passes by not looking is worse than an absent one.

# ADR-121 — A Notification Stores Identifiers and Composes the Rest at Read Time

**Status:** Accepted

## Decision

A notification record holds a recipient, a type, a category, a source, the Moment that governs access to it, and read state. It holds no name, caption, comment, excerpt, or thumbnail, and no column exists that could.

The wording is composed when somebody reads it, from what they are authorised to see then.

Unread activity of one kind about one thing collapses into a single entry, enforced by a partial unique index over unread rows. Reading it starts a new one.

Deduplication lives on its own table, keyed by source event and recipient.

Reactions, comments, replies, mentions, follows, follow requests, and acceptances publish Integration Events — none of which carry text.

Social, media, and moderation notify. Moderation cannot be switched off.

## Rationale

**A notification travels further than the thing it describes.** `notifications.md:238` lists what one can disclose even when the underlying resource is protected — names, captions, thumbnails, comment text, Event names, Locations, relationships, and "the existence of restricted activity itself". `notifications.md:387` asks for a hybrid of stable semantics, a minimal snapshot, and current authorization; this resolves it towards the safe end by observing that the *type* is the stable part and the type is not sensitive.

Two properties follow for free. A privacy change needs no propagation into notification records, because nothing sensitive was copied out — one fewer thing for 5R to erase and one fewer place for an erasure to be missed. And a notification about something the reader can no longer see does not render, so it is absent from the list and the count rather than blanked.

**The unread count is computed over what renders, not with `COUNT(*)`.** A count that outran the list would say something existed that the list had already declined to show — the same disclosure the composition model exists to prevent.

**Eligibility is asked before preferences, and the code is arranged so it cannot be skipped.** `notifications.md:200` says plainly that preferences cannot grant access somebody lacks. Asked in the other order, an enabled preference reads like a reason to notify and the eligibility check becomes something a later branch can bypass.

**Aggregation is "until read", enforced by the database.** `notifications.md:640` leaves the window to implementation. Read state already expresses "since I last looked", so no timer, sweep, or window arithmetic is needed — and a partial unique index means two messages about one Moment handled at the same instant by two consumer instances still produce one entry. The same construction keeps one appeal open per action in 5N.

**Moderation cannot be silenced.** 5N established that somebody must be told what was done to their content, because an appeal against a decision they were never told about is not a right. `notifications.md:495` asks that required notifications be narrowly defined; exactly one category qualifies, and a unit test asserts that it is exactly one.

## Consequences

**Deduplication could not live on the actor row, and the moderation case is what showed it.** A moderation notification has no actor — the affected person is told what happened to their content and deliberately never which moderator decided it, which is 5N's rule about reviewer identity. Keying deduplication on the actor would have meant inventing an actor for those or leaving them undeduplicated. It has its own table now, keyed by source event and recipient, which also handles one message legitimately notifying several people.

**The source of a notification is not always what governs access to it, and a test found the leak.** A mention points at a *comment*; what decides whether that comment may be seen is the *Moment* it sits under. The first implementation checked only Moment-sourced notifications, so a mention survived its Moment becoming private — visible in the list and counted in the badge. Notifications now carry the governing Moment as an identifier, which costs nothing this design objects to.

**Actors are selected by walking the whole list, not the first two.** Taking two and then filtering let a suspended or blocked person occupy a slot, so "three people reacted" could name nobody when it could have named somebody.

**Somebody blocked or suspended after the fact is counted, never named.** This needs no reindexing or cleanup, because naming happens at read time — the same property that makes privacy changes free here.

**The migration had to be reset locally when its shape changed.** The runner keys applied migrations on the full filename, and an edited-but-uncommitted migration will not re-run. Editing it was correct — it is not deployed — but the local database had to be dropped back for the change to take effect, and the version key is the filename rather than the timestamp.

---

# ADR-122 — A Delivery Is a Row With a Due Time, and Nothing Sending Blocks Anything Happening

## Status

Accepted.

## Context

5Q-1 decided that a notification exists and who may see it. Nothing carried it anywhere: somebody learned their upload had failed only by opening the application, which is backwards for the one category where being told is the point.

The mistakes available in this half are not the mistakes the first half could make. Those were privacy mistakes. These are a provider holding up a reaction, a retry loop that never stops, a credential in a log file, and arithmetic that wakes somebody at three in the morning because a time zone was read as a fixed offset.

## Decision

**A delivery is a row.** One per notification per channel, carrying a status, an attempt count, a last error, and — the part that does the work — an instant it becomes due. The service that causes a notification writes the row inside the transaction that records the notification, and returns.

**The whole of quiet hours and digests is resolved once, when the delivery is created, in a pure function with no database in it.** What is stored is an instant. The only question the dispatcher ever asks afterwards is whether that instant has passed, so a dispatcher that never reads a time zone cannot get one wrong.

**Composition happens at send time, from current authorization**, through the same `NotificationService.open` the in-app list reads by.

**Three urgencies, not two.** `immediate` waits for nothing, `prompt` skips a digest but waits out a quiet window, `ordinary` is everything else. Security is immediate; moderation is prompt.

**Security joins moderation as a category that cannot be switched off**, and neither aggregates.

**Push has the full shape and no provider.** Registration, tokens, retirement, scheduling, and retries are real; the adapter records what it would have sent, following `sms-client.ts`.

## Rationale

**A row in a table is what makes `architecture/notifications.md:840` true.** It requires that provider delivery never block a reaction, a Moment, a moderation decision, or a session revocation. Nothing else guarantees it: an in-process send is one slow provider away from a request timing out, and a queue that the writer waits on is the same thing with extra steps. If every provider is down, the rows are simply still there.

**Time zones are where this kind of code goes wrong, so that part has no infrastructure in it.** `Intl` turns instants into clock readings and offers no way back, so the inverse is computed by measuring the offset at a first guess and again at the result. The second pass is what makes the day clocks move come out right, and it is not decorative: without it a quiet window ending at one o'clock on the night one o'clock is skipped resolves an hour early — inside the window it was meant to end. The unit tests cover both transitions in two hemispheres of rule, a zone with a half-hour offset, the hour that never happens, and the hour that happens twice.

**Security ignores quiet hours and moderation does not, and the second half of that is the interesting one.** A password changed at three in the morning is worth waking somebody for, because by morning the account may be gone. A moderation decision will still be there at eight, and appealing it is no more possible at three — waking somebody for it teaches them to silence the device, and that silences the security alert too. Over-rating moderation is paid for by security.

**Nothing required aggregates, and the reason is delivery rather than presentation.** A delivery is opened once per notification per channel. A second password change collapsing into a standing unread entry would be announced to nobody, because the first email had already gone — and the second is the message somebody most needs to see. The rule follows `isRequired` exactly rather than listing categories again.

**Email names people and push counts them.** `product/notifications.md:289` requires stricter defaults outside the application, because a lock screen is visible to whoever is standing nearby. Both draw on a rendered notification, which has no field for a caption or a comment, so the privacy of the text is a property of the input rather than a rule anybody has to remember.

**Security events are published, not invented.** Every one — password set or changed, phone claimed or removed, email verified, sessions revoked — is already an audit record. The audit trail is the evidence and the notification is the message; one is for whoever investigates afterwards and the other for the owner at the time. Each describes a step somebody taking over an account has to perform, which is why they are worth sending and why the preference that would silence them does not exist.

## Consequences

**Registering a device read back through the DataSource and found nothing**, because the row it had just written had not committed. Both statements return their row instead — and both are wrapped in a `WITH`, because a bare `UPDATE … RETURNING` through this driver hands back `[rows, count]` rather than rows. That shape is wrong in a way types cannot catch: every column reads as `undefined` rather than the call failing. The repositories beside this one wrap for the same reason.

**A `CASE` whose other arm is `NULL` gives the planner nothing to infer a parameter's type from.** It settles on text, and the column refuses it at run time. Cast explicitly.

**The contract refused an account with no quiet hours at all.** The rule that a window's ends must differ was written as `from !== until` and `null !== null` is false, so the ordinary case — no quiet hours, which is what most accounts have — could not be expressed. Two nulls are not a window whose ends meet; they are no window.

**Switching a category off in-app silences its email and push too**, because the notification row *is* the in-app notification and there is nothing left for the other channels to carry. The reverse does not hold. This is an interaction worth stating rather than discovering.

**A test that hands the code a double proves nothing about the code it replaced.** "No device token appears in a log" passed while the adapter logged the token, because the integration suite used a recording double and never ran the adapter. It now delegates to the real one, and the adapter has its own unit test. Deliberately breaking the guard is what found it; the test had looked entirely convincing.

**Asserting on the dispatcher's own totals is asserting on the whole database.** The dispatcher claims every due delivery, so `result.sent` counts other tests' rows. Every assertion is scoped to the account under test instead.

**Anything that claims a bounded batch must be drained in a test, not called once.** Three failures appeared only in the full integration run and never in isolation, and both causes were the same shape: the dispatcher takes fifty deliveries from a table that by then holds other suites' rows, and the outbox drain takes five hundred messages from a backlog every earlier suite has been adding to since the run began. Each looked like a scheduling bug and was a test that stopped one batch short.

**A test fixture's alphabet is part of its isolation.** Two search suites generated "rare" words as `zq` plus ten hexadecimal characters. Sixteen symbols and a shared prefix leave enough trigrams in common that two such words reach similarity 0.3 — exactly the threshold search retrieves at — so one test's word matched another test's Moment and an exact-result assertion failed. Measured rather than guessed: three colliding pairs in two hundred words. Over twenty-six letters, four hundred words peak at 0.200 and nothing collides. The flake predated this sub-phase and surfaced twice, in a different test each time.

**The push provider, new-device sign-in alerts, and localisation are deliberately absent.** A provider needs credentials and a device, and a test for it would have to mock the boundary under test. A sign-in alert needs a notion of a recognised device that does not exist, and one that fires on every sign-in is one people learn to ignore — which would make the category worthless. Localisation and template versioning want a template system, and there is one locale.

---

# ADR-123 — Deletion Marks Synchronously and Erases in a Worker

## Status

Accepted.

## Context

Deleting a Moment set `deleted_at` and returned. Everything derived converged on that correctly — the reading indexer dropped the document, the visibility predicate stopped matching, notifications about it stopped rendering — so from the outside it looked finished.

Nothing had been erased. The caption was still in the row, the comments other people wrote were still in theirs, and the photographs and videos were still in object storage along with every thumbnail and transcode made from them. `product/privacy.md:646` is blunt about what that last one means: a product cannot truthfully claim a video was deleted while continuing to serve a transcoded copy.

## Decision

**Deletion happens in two stages.** Marking is synchronous, and is what makes a Moment vanish from every surface at once. Erasure is a worker, driven by a ledger.

**The sensitive text is blanked at mark time**, in the same transaction: the caption, and the body of every comment on the Moment whoever wrote it.

**One ledger, `erasure_requests`**, carrying a subject type so that account erasure joins it rather than inventing a second mechanism. Leased on claim, retried with backoff, abandoned at a ceiling.

**Erasure removes derived artifacts itself**, rather than waiting for the indexer.

**The row is hard deleted, cascading.** Moderation records survive, because they name their subject polymorphically.

**Media goes with the Moment, guarded**: an upload another *living* Moment holds is spared.

## Rationale

**The worker exists because of a product invariant, not a preference.** A Moment may hold an unlimited number of images and videos. Erasing media inside the request would do unbounded object-storage work in an HTTP handler, and a Moment with two hundred videos would time out half-erased with no record of how far it got. `architecture/privacy.md:1136` separately requires cross-store deletion to be retryable, idempotent, and observably complete — which is a worker and a ledger by another name.

**Blanking at mark time is what makes the queue safe to have.** A queue can back up; what waits in this one is structure rather than what somebody wrote. Comment deletion has always worked this way, so this generalises existing behaviour rather than introducing a rule.

**Erasing derived artifacts directly is what "higher priority than ordinary indexing" means** in a system with one derived store. The document goes in the same transaction as the row, so deletion never queues behind a reindex; the event-driven indexer stays as the backstop and converges on the same answer, so the two cannot disagree.

**The row goes last, and that ordering is what makes a partial run resumable.** While anything remains undone the row is still there to say what it was — its media links are the only record of which uploads to erase, and deleting the row would take that list with it. Object storage is swept before the transaction that removes the row, for the reason upload deletion already gives: orphaned objects are reclaimable, and a row gone with bytes still served is the failure this whole sub-phase exists to prevent.

**The guard on shared uploads decides nothing it was not asked to.** Whether one upload may belong to two Moments is recorded in the ADRs as undecided, and nothing currently prevents it — the check on adding media only looks within the same Moment. Erasure declines to destroy bytes something living still points at, which leaves the question open rather than answering it by consequence. An upload held only by *other deleted* Moments is erased: those await erasure themselves, and if each deferred to the other the bytes would outlive both.

**The ledger deliberately holds no record of who asked.** For a Moment the author is the only person who can ask, and once the Moment is erased that row would otherwise be the one remaining trace that a particular person had recorded something — exactly what erasure is for. What survives is an opaque identifier for something that no longer exists, which is what ADR-095 permits anywhere unerasable. The audit of who deleted what lives in `moment_edits` and goes with the Moment, which is the intended behaviour rather than an oversight.

## Consequences

**A retryable failure is not a failure the pass has finished with.** Counting it as `failed` would make an object store having a bad minute look like data nobody erased. The worker reports `retrying` separately from `failed` and `abandoned`.

**Unrecognised failures are treated as transient, deliberately.** That errs towards finishing an erasure late rather than abandoning it, and the attempt ceiling stops an unrecognised permanent failure a few attempts later. Erring the other way would leave media in storage that somebody has been told is gone.

**`stateAfterFailure` returns a type one value narrower than the request's state.** A failed attempt can leave a request owed, refused, or given up on, and can never leave it complete — so the signature says so rather than the caller checking.

**The permanent-failure path was nearly unprovable, and the fix was to move the decision.** Nothing in the integration suite produces a constraint violation, so breaking the permanent branch changed no integration result. Classification moved out of the worker into the pure policy, where both it and the state it produces have tests that bite. A guard whose only home is a worker is a guard tested only through whatever that worker happens to be given.

**A test that asks the product whether something is gone is asking the wrong question**, because the product said it was gone before erasure ran. Almost every assertion here reads PostgreSQL or the object store directly. The strongest is a sweep of every `text` column in the schema, read from `information_schema`, looking for the caption and the comment: it makes no assumption about which table a future column might put them in.

**Adding a required constructor argument to `MomentService` touched eleven call sites.** It was made required rather than optional on purpose: an optional dependency that silently skips blanking comments is a guard nobody can prove.

**ClickHouse is absent from the erasure path** because no Timeline projections exist yet. When they arrive they must join it, and that obligation belongs to the phase that builds them: a projection erasure cannot reach is not ready to hold personal history.

---

# ADR-124 — An Account Is Tombstoned, and Its Content Is Erased

## Status

Accepted.

## Decision

Deleting an account erases everything about the person and everything they authored, and leaves an anonymous row behind.

**Two steps.** `POST /users/me/deletion` sends a confirmation link to the verified address; `POST /users/me/deletion/confirmation` consumes it. Both require a session.

**The synchronous half is only what must be immediate**: the account is tombstoned, the handle released under its existing cooldown, and the addresses, password, phone, and Session rows removed. Everything else becomes an `account` erasure request.

**Account erasure is a coordinator.** It hands the account's Moments to the Moment path in bounded batches and sweeps its own rows only once none remain.

**What an account owns is a table, not a procedure** — `ACCOUNT_SWEEPS`, beside `DELIBERATELY_KEPT` and its reasons.

**Reports the account filed about other people survive with the reporter erased.** Two foreign keys changed from `CASCADE` to `SET NULL` to permit it.

## Rationale

**The tombstone is forced by shared reference data, not chosen for convenience.** Thirty-nine foreign keys point at `users`, and twenty-four of them block a delete. Two — `locations.recorded_by_user_id` and `real_world_events.created_by_user_id` — are shared history that other people's Moments name, and both columns are `NOT NULL`. Removing the row means either loosening shared attribution or deleting a Location somebody else's Moment depends on. `architecture/privacy.md:1105` says a tombstone and a hard delete may both be required; this is where. What survives holds no name, no handle, no biography, and no content — only the ability of other people's history to keep working.

**The second step proves current control, which a session does not.** A signed-in session shows somebody signed in once, which is what an unattended laptop also shows. Consuming a fresh link shows they can read the mailbox now. It is the strengthening `changePassword` gets from demanding the current password, available to every account rather than only those that have one — and the mail arriving is itself the control, because an account that has been taken over cannot then be quietly deleted.

**There is no grace period, deliberately.** Deactivation already exists and is reversible. Two reversible-looking paths would make the irreversible one less clear rather than safer.

**Letting a departing account destroy the reports it filed is a hole, not a privacy protection.** A report is evidence about somebody who was never party to the deletion, and a reported person could otherwise erase the complaints against them by leaving. `product/privacy.md:618` names retaining narrowly required safety records as a deletion concept distinct from removing content from ordinary access; this is that narrow case, and the reporter goes while the report stays.

**Session rows are deleted rather than revoked, which is the opposite of everywhere else.** A revoked Session is a record that somebody was signed in and is not any more, which an investigation may want. But the row carries a refresh-token hash, and an account that has been deleted should leave no credential behind.

**Writing what an account owns as data rather than as code is what makes it checkable.** An integration test reads `pg_constraint`, finds every reference into `users`, and asserts each is either swept or named as deliberately kept. A table added later that points at an account fails the suite until somebody decides which it is. Written as a long function, its omissions would be invisible — and an omission here is somebody's data surviving a request to remove it, with nothing saying so.

## Consequences

**A test that proves a row survived does not prove erasure meant it to.** "Keeps a Location it recorded" passed while a deliberately broken sweep was trying to delete that Location and being refused by a foreign key: a failed delete leaves the row exactly as a correct decision does. The fix was to make the helper assert the run reported no failure, after which the break bit immediately. This is the second time in this phase that a guard proved unfalsifiable until it was deliberately broken, and both times the test had looked entirely convincing.

**The handle survives, and only in `user_handles`.** Releasing it under a cooldown means remembering which name is reserved and for how long, so the text remains in the table that holds the reservation. The sweep test asserts exactly that — the caption and display name appear nowhere, and the handle appears in those two columns and no others — rather than quietly excluding it.

**Inserting a method above another displaced its documentation.** The lint rule caught it; the JSDoc that belonged to `listOpen` had silently become the doc for the method inserted before it. Worth noting because the code still compiled and the tests still passed.

**The audit trail outlives the account by design.** It names an Identity by an opaque identifier whose row survives holding nothing but a creation time, and records that an account was deleted and when. That is the clearest instance of the narrowly required security record the product document allows.

**A strict equality check silently stopped being correct.** `findAccount` guarded with `row.preferences === undefined`, which was right while preferences could never be removed — an unloaded relation is `undefined`. Erasure made a missing one possible, and a missing relation is `null`. The guard stopped matching, and the failure surfaced three features away as a crash reading a property of null while notifying somebody. Two lessons: the comparison is now loose on purpose, and a comment records that the strictness was correct rather than careless when it was written. The reporter columns going nullable was caught the other way round, by a suite that reads `information_schema` and asserts the entities agree with it — which found the drift the same minute it appeared.

**Making a column nullable changed a published contract.** `moderationReportSchema.reporterUserId` is now nullable, because a moderator reading a report from a departed account has to be shown that there is nobody to follow up with. Worth noting as a consequence rather than a detail: a privacy decision about erasure propagated all the way out to the API surface, which is the sort of thing that is cheap now and expensive after clients exist.

---

# ADR-125 — An Export Is a Manifest, Not a Copy

## Status

Accepted.

## Context

5R-2 shipped account deletion. Until export existed beside it, the only way out of Chronologity was to destroy everything — the opposite of what a product built to preserve decades of personal history should offer.

`product/privacy.md:784` sets the hard constraint: a Moment may hold an unlimited number of images and videos, so a history may run to gigabytes. `architecture/security.md:1776` sets the security bar — strong authentication, secure generation, short-lived download access, and no exposure of anybody else's data.

## Decision

**An export is prepared asynchronously, written in parts, and described by a manifest.**

**Media is never copied.** The manifest points at the originals the account already owns, signed for minutes at the moment somebody asks.

**Asking takes two steps**, reusing deletion's confirmation-link machinery with a `confirm_export` purpose.

**Every URL is signed on request**, not at preparation.

**A prepared export expires after a few days**, and the worker that creates them sweeps them.

**Preparing a new export removes what the previous one left**, rather than waiting for its own expiry.

## Rationale

**Not copying the media is the decision everything else follows from.** The storage client has no server-side copy, so copying an export's media would move gigabytes through the API process — which the unlimited-media invariant makes dangerous rather than merely slow. Presigning the originals avoids it entirely, and has a better privacy property as a side effect: the only new copy of anybody's history is the JSON, which is the small part.

**Signing on request rather than at preparation is what makes "short-lived" true.** A URL signed when the export was built would still work days later for anybody who kept the manifest, which is indistinguishable from having no expiry. The manifest is therefore rebuilt on every read, and the media list comes from current state — so somebody who has deleted a Moment since preparing an export is not handed its photographs by a manifest older than the deletion.

**The two-step confirmation is the same reasoning as deletion, applied to the same magnitude of thing.** A session shows somebody signed in once; consuming a fresh link shows they can read the mailbox now. An export is everything the person has, so a stolen session should not be enough — and the mail arriving means it cannot happen unnoticed.

**The exclusions are enforced at two layers because a leak can be introduced at either.** The builders construct every field explicitly and never spread a row; the reads select only what may travel. Both have tests that bite, which took finding out — see below.

**A new export sweeps the old one immediately.** Waiting for the older one's own expiry would leave two copies of somebody's history standing for days when they asked for one.

## Consequences

**A privacy test can be unfalsifiable because the leak it guards against is unreachable from where it looks.** Putting an email address into the account builder failed three unit tests and *passed* the whole integration suite — because the source repository never selects an email, so the builder had nothing to leak. That is good design and a bad test: the integration assertion could not fail. Breaking the repository instead, so an address genuinely reached the artefact, made it fail immediately. Both layers now have a break that proves them. This is the third time in this phase that a guard has looked convincing and turned out unfalsifiable, and all three were found the same way.

**A test's own break can be ineffective, which looks exactly like a passing guard.** The first attempt at breaking the repository added a join without selecting the column, so nothing leaked and the suite passed — briefly suggesting the guard was the problem rather than the break. Worth checking that a deliberate break actually does what it claims before concluding anything from the result.

**Short-lived download access needed a test that did not exist.** Nothing asserted the signed URLs expire; the plan called for the break, and there was no guard for it to fail. The manifest's links are now checked for an `X-Amz-Expires` of at most five minutes, and removing the lifetime argument fails it.

**Sweeps are batch-bounded, and tests must drain them.** An expiry test passed alone and failed in the full file, because by then other accounts' expired exports filled the batch ahead of it. The same lesson as the notification dispatcher and the erasure coordinator, arrived at for the third time.

**Zero retention is not a way to test expiry.** With it, the sweep in the same pass removes what that pass has just written, and the test asserts against an export that never really existed. A clock moved past the expiry is the honest version.

**This is the fourth implementation of claim-lease-retry here** — the outbox publisher, the notification dispatcher, the erasure worker, and now this. Three was a pattern; four is an argument for extracting it. It is not extracted here, because doing so would refactor three working and separately-tested subsystems inside a sub-phase about something else. It is recorded so that a fifth does not simply happen.

**Adding a table caught account erasure out, exactly as intended.** `export_requests` references `users`, and 5R-2's coverage test — which reads `pg_constraint` and demands every reference be swept or deliberately kept — failed the moment the migration landed. The answer it forced is one worth having: a prepared export is a copy of somebody's entire history, and it must not outlive the account it belongs to. Erasure now removes the objects before deleting the rows, because a row deleted first would leave the copy in storage with nothing pointing at it. That guard has now paid for itself once, in the first sub-phase after it was written.

**The trigram-collision flake had a second home.** A shared fixture named Locations `Somewhere <8 hex characters>`, and search corrections are drawn at similarity 0.15: a real collision measured 0.174 against a query derived from a different suite's hexadecimal token, so one test's Location was offered as another's "did you mean". The same defect fixed during 5Q-2 for search's rare words, in a fixture that pollutes every suite because it is shared. Letters measure 0.000. The lesson is narrower than "use letters": a hexadecimal identifier is a poor source of test text anywhere trigram search can see it.

---

# ADR-126 — Retention Is a Schedule, and a Sweep Is Not a Queue

## Status

Accepted.

## Context

5R-1 to 5R-3 removed what somebody asks to have removed. This is the residue nobody asks about: consumed sign-in links, spent phone codes, delivery records, retired device tokens, audit events, and uploads registered and never finished. `product/privacy.md:764` requires keeping personal information only as long as it serves a purpose, and nothing enforced any of it.

Two accumulations were found rather than assumed. `notification_source_events` — the deduplication table — has no foreign key to `notifications`, so it survives every notification sweep and grows on its own. And nothing swept expired uploads at all.

## Decision

**One retention worker owns every periodic sweep**, driven by a clock rather than a queue.

**The schedule is data**, in the spirit of `ACCOUNT_SWEEPS`: table, timestamp, predicate, period, and whether rows are removed or a device is retired.

**Notifications expire by category and by read state.** Read ordinary ones first, unread ones later, moderation and security last.

**A device unseen for long enough is retired rather than removed**, and swept later.

**Audit events are bounded**, at a long configurable period.

**Every period is configuration**, following `OUTBOX_RETENTION_HOURS`.

## Rationale

**A sweep is not the claim-lease-retry shape, and this sub-phase needed no fifth instance of it.** `sweepPublishedOutbox` is the applicable shape: a bounded batch, `FOR UPDATE SKIP LOCKED`, a count, and `reachedEnd`. No lease, no attempts, no per-row state — because a sweep that fails simply runs again. The extraction recorded in ADR-125 stays recorded and stays undone, and the count stays at four.

**Nothing anybody recorded is in the schedule.** The claim is asserted twice: once over the schedule itself, and once by counting Moments, comments, reactions, edit history, and moderation state across a sweep with every period set to zero — the most destructive configuration the system permits.

**Read state is the signal for ordinary notifications.** An unread notification is something somebody has not dealt with, so expiring it removes a thing they were never told; a read one is finished with, so the reading is what should start its clock.

**Silence is the only evidence of an uninstalled application available.** There is no push provider to report rejections, and a client re-registers whenever it starts. Retiring rather than removing keeps the distinction between a dead token and one that was never registered.

## Consequences

**`ctid IN (SELECT ctid … LIMIT n)` does not bound anything without `AS MATERIALIZED`.** A sweep with a batch of two removed five. Without materialisation the planner may inline the subquery into the `IN` and evaluate it more than once, applying `LIMIT` afresh each time. It reproduced about once in four runs — exactly often enough to be dismissed as a flaky test, which is what it looked like for several attempts. With `AS MATERIALIZED` it passed ten runs out of ten.

**Naming the primary key does not sidestep it, and `sweepPublishedOutbox` had the same defect.** That was the assumption when the retention sweeps were written — that `ctid` was the risky part and the outbox's `id IN (…)` was safe. It is not: the hazard is the re-evaluation, not the identifier. The outbox's own batching test failed in the full run, sweeping three messages with a batch of two, having been latently wrong since it was written and surfacing only when another suite changed the table enough to change the plan. It is fixed the same way, and committed separately as the pre-existing bug it is.

Worth stating plainly, because the reasoning that produced the bug is the reasoning most people would use: an unbounded delete on the outbox holds locks the publisher needs, and "bounded" was the property the batch size existed to provide.

**Two guards were unfalsifiable, and deliberately breaking them is what showed it.** The device fixture set `registered_at` and `last_seen_at` to the same value, so the rule could have judged a device by when it was registered and every test would still have passed. And nothing exercised the reference check that stops an erased upload being removed while a Moment still points at it, because the only long-lived upload in the suite was `ready` and the sweep only looks at `deleted` ones. Both now have a break that fails.

That makes five unfalsifiable guards found across this phase, all by the same technique. The pattern behind them is consistent: a test passes because the code path it guards is unreachable from where the test looks, not because the guard works.

**Dropping the reference check does not merely delete too much — it throws.** The foreign key refuses the delete, which abandons the whole batch and leaves every other row in it unswept. Refusing is not the same as not attempting, which is why the check is in the query rather than left to the constraint.

**A test that reads global database state is a test that alternates.** The batching test asserted `reachedEnd`, which depends on how much other suites had left behind; it passed on a full database and failed on a drained one. Rewritten to apply one rule directly and assert that no pass exceeds its batch, it is deterministic — and it is what caught the `ctid` defect.

**Adding a field to `AppConfig` touched fifteen test literals.** Each integration suite builds its own configuration inline. A shared constant kept it to one import and one line apiece, but the duplication underneath is real and will be paid again by whatever adds the next field.

---

# ADR-127 — The Event Registry Is a Table, and a Subscription Is Checked Against It

## Status

Accepted.

## Context

Twenty-two Integration Events existed and not one was referenced by a test. `contracts.test.ts` covered the envelope and the identifiers inside it and stopped there. A field could have been removed, renamed, or made required, and every test in the repository would have passed — for contracts `events.md:552` describes as boundary promises, immutable and deliberately versioned.

Subscriptions were in the same position from the other direction. Three consumer groups subscribe to eleven topics between them, and only the media checker's single topic had ever carried a message in a test. The rest were exercised by handing events straight to the handler, which proves the handler and says nothing about whether the worker is listening. 5Q-2 added a fifth subscription to the notification generator; a wrong or forgotten topic name there would have passed everything while notifying nobody.

Both worker handlers were switch statements, so the set of event types a worker understood could not be read by anything but a person.

`events.md:782` had already asked for a canonical registry mapping type, version, schema, owner, and classification, and said plainly it could be code-driven.

## Decision

The registry is data: `EVENT_REGISTRY` in `packages/contracts/src/event-registry.ts`, one entry per event, carrying type, version, envelope schema, payload schema, boundary, owner, classification, and a payload the schema accepts.

Each worker exports the event types it handles and the boundaries it subscribes to, as data, from the module holding its handlers. `index.ts` subscribes with that exported list rather than one written out inside it.

Properties are asserted over the table rather than per event: uniqueness of type and of type-and-version; that every documented example parses; that dropping any field of an example is refused; and that no payload property name suggests a secret or erasable personal data, per ADR-095. Separately, a test compares each worker's handled types against its subscriptions in both directions, and an integration test reads every event type the outbox has ever held and refuses one that is not registered.

Three end-to-end tests, one per consumer group, publish through the outbox to a real broker and assert the effect reaches the database.

## Alternatives Considered

A test per event, hand-written. Rejected: twenty-two events is where that stops being maintained, and the property that matters — every event, including the next one — is exactly what a hand-written test cannot hold.

A runtime registry service. Rejected for the reason `events.md:800` gives: nothing here needs the registry at runtime, and a service would add a dependency to gain nothing.

Leaving the topic lists in each `index.ts`. Rejected because a worker entry point runs on import; a list held there is a list no test can read, which is how the eleven subscriptions came to be unverified in the first place.

Comparing worker subscriptions against publishers rather than against the registry. Rejected: `LocationRevised` and `RealWorldEventRevised` are contracts written ahead of the operations that will raise them, and a check in that direction would have to be suppressed for them.

## Consequences

**Three events were registered with no publisher, and one of those is a defect rather than a decision.** `LocationRevised` and `RealWorldEventRevised` are deliberate — neither entity has a revise operation yet. `CommentReacted` is not: `PUT /comments/:commentId/reaction` records the reaction and announces nothing, while the notification generator has a `comment_reacted` handler waiting for it. Reacting to a comment notified nobody. Fixed separately, as the pre-existing bug it is.

**Neither `subjectOf` nor `candidateFrom` had a unit test.** Both are decisions over a dozen branches each, and the switch shape made that easy not to notice. Converted to tables and driven from the registry's own examples, every handled type is now exercised with the payload the contract promises.

**The end-to-end tests are slow and would be slower still without filtering.** A fresh consumer group reading from the beginning replays everything the local broker holds. The shared harness filters to the aggregate under test before delegating, so the message under test walks the whole path while unrelated history does not re-drive the worker.

**Publishing in a test drains the whole outbox, not one message.** The publisher claims in creation order across the table, so the harness creates topics for every pending message's topic before publishing — otherwise a stale row bound for a topic that no longer exists fails the batch carrying the message under test.

**The registry is now the thing to update when an event is added.** That is the cost, and it is the point: an event added without registering it fails as soon as anything publishes one.

---

# ADR-128 — The Timeline Projection Is Migrated and Rebuilt by Command

## Status

Accepted.

## Context

7C shipped Location and real-world Event Timelines and, with them, two ClickHouse tables: `timeline_moment_contexts`, one row per Moment per scope, and `timeline_suspended_authors`, one row per suspended account. Neither could be created outside the test suite. `migrateAnalytics` had no caller but its own tests, and `apps/api/src/cli/migrate.ts` runs the relational migrations only — so a migration file written for ClickHouse could be committed, reviewed, and merged without any way to apply it to a deployment.

`rebuildTimeline` was in the same position. It has existed since 7A, reads authoritative state rather than the event log so that erasure survives a replay, and had no caller outside tests. The capability `projections.md:799` asks for as "a first-class operational capability" existed as a function nobody could run.

That mattered more than tidiness because of what the suspension table is. Suspending an account "hides what the account contributed and deletes none of it" — `users.status` becomes `suspended` and no Moment's moderation state changes. In a shared-scope Timeline the only thing withholding a suspended author is `timeline_suspended_authors`, and that table was filled exclusively by live `UserStatusChanged` messages. Anybody suspended before the projector first ran would have appeared at every Location and Event they had ever recorded at, and nothing in the system would have said so.

Moments recorded before 7C were in a milder version of the same position: on the Timeline, but in no scope, until something reprojected them.

## Decision

Two commands, both thin wiring over functions that already existed:

- `pnpm --filter @chronologity/api clickhouse:migrate` applies the ClickHouse migrations. A second command beside `migrate` rather than a mode of it, because the two runners are deliberately separate: every statement here is `CREATE TABLE IF NOT EXISTS`, takes no lock and is safe to repeat, which is not true of the relational migrations and must not become their problem.
- `pnpm --filter @chronologity/api timeline:rebuild [--only <momentId>]` rebuilds the projection.

**A full rebuild reconciles the suspension dimension.** `deployment.md:1292` requires rebuild jobs to preserve moderation, and a rebuild that restored every Moment while leaving that table stale would hand back a Timeline showing history moderation had withheld. It reconciles in both directions — writing a suspension the projection lacks, and clearing one the account no longer has — because only ever adding would leave an account reinstated while the projection was down withheld permanently, with no event still coming to correct it.

**A scoped rebuild does not.** `--only` repairs named rows; an operator fixing one Moment should not have every account reconsidered underneath them.

**The reconciliation is stamped when the rebuild began, not when it writes.** `timeline_suspended_authors` is a `ReplacingMergeTree` ordered by `decided_at`, so the newest decision wins. A row stamped at the point of writing would beat a `UserStatusChanged` that arrived while the rebuild walked, and could undo a reinstatement by restating what was true when it started.

## Alternatives Considered

A separate `timeline:reconcile-suspensions` command; a startup check refusing to boot when the table is empty but accounts are suspended; and folding ClickHouse migrations into the relational runner.

## Rationale

**A separable half is a half that gets skipped.** Reconciliation as its own command would be correct whenever somebody remembered to run it, and the failure of forgetting is invisible: the Timeline looks fine and shows history it should not. Attaching it to the rebuild means the operation that claims to restore the projection actually restores it.

**Reconciling is bounded by suspended accounts, not by Moments.** That is the same property that made the dimension worth separating in 7C — suspending somebody with a decade of history costs one write rather than ten thousand — and it is why a full rebuild can afford to do this every time.

**A full rebuild in place is the slow path, and deliberately not optimised here.** Measured against 7,357 Moments locally it ran at 2.3 Moments a second — around fifty minutes — because every Moment already on the Timeline pays a ClickHouse mutation to make room for its replacement. That cost is per Moment and does not shrink with data, so an in-place rebuild of a real corpus is not a thing anybody should plan to do.

The command therefore takes `--version`, and building into a fresh one is the flow `deployment.md:809` already prescribes: build beside the live version, validate, switch readers, retire the old. Writing into empty tables finds nothing to replace, so the mutations disappear and the walk is insert-only.

Measured, that is worth **twice the throughput and no more** — 4.6 Moments a second against 2.3. The mutation was one cost among several, and what remains is per-Moment round trips: one PostgreSQL read, two existence probes, two inserts, all sequential. Making a rebuild genuinely fast means batching those, which is a change to how the projector writes rather than to how a rebuild is invoked, and is not attempted here.

Pointing readers at a version is configuration and is not done here. A version built this way is complete and read by nothing, which is the honest half of a cutover to have: the building half works, and the switch is still to come.

Run against a development database of 7,357 Moments, the first full rebuild reported `Projected 7178, removed 179, withheld 1, released 0` in twenty-six minutes. The `1` is the gap this ADR exists for, found in real data rather than a fixture: PostgreSQL held 193 suspended accounts and the projection knew of 192, so one account's history was being shown at every Location and occasion it appeared at, and nothing in the system said so. The `179` are Moments erased from PostgreSQL that correctly received no row — erasure surviving a rebuild, which is the property that makes rebuilding from authoritative state rather than from the log worth its cost.

**The read of `users.status` lives in `TimelineSourceRepository` despite its own doc.** That class says it deliberately does not read the author's account status, and that remains true of every Moment row it builds: baking status into a row is precisely what the separate table avoids. Reading the suspended set as its own dimension is a different thing, and the doc now draws that line rather than being contradicted by a method beneath it.

---

# ADR-129 — Which Projection Version Is Read Is Configuration, and Erasure Ignores It

## Status

Accepted.

## Context

ADR-128 recorded the flow `deployment.md:809` prescribes for changing a projection: build a new version beside the live one, validate it, switch readers over, retire the old. It stopped at "validate". `TIMELINE_VERSION` was a constant with a constructor default, and the reader was built in `compose.ts` with no argument, so nothing could be pointed anywhere. The rebuild command took `--version` and could therefore *build* a second version that nothing was able to read.

That was tolerable while the projection's shape was settled. It stopped being tolerable as soon as a change was needed that alters what a row means rather than what it contains — where the choice is between a cutover and every Timeline in the product going blank between deploying and finishing a rebuild that runs at 2.3 Moments a second.

## Decision

`TIMELINE_PROJECTION_VERSION` is an environment variable, defaulted to the current version so an operator with one version never names it, and read by the reader, the projector and the erasure worker alike. The rebuild command defaults to it, so `--version` now means "build a different one" rather than "restate the one in use".

One value for reading and writing rather than two. A process reading one version while writing another would answer from history it was no longer maintaining, and the two could drift indefinitely with nothing failing.

**Erasure ignores it entirely.** `remove`, `removeContexts`, `removeEverythingBy` and `removeContextsBy` were each scoped to `projection_version`, and each served two callers with opposite needs. They are now split. The projector keeps the version-scoped ones — a writer building a second version must not delete the live one's rows, which is the whole point of building it beside. Erasure calls `eraseMomentEverywhere`, `eraseContextsEverywhere`, `eraseEverythingByEverywhere` and `eraseContextsByEverywhere`, which name no version at all.

## Alternatives Considered

Leaving erasure version-scoped and requiring an operator to run it once per live version; and dual-writing every projection to both versions during a cutover.

## Rationale

**A projection version is not a copy that may lag. It is the same derived store built twice.** `privacy.md` requires erasure to reach a derived store rather than leave it to expire, and a version nobody happens to be pointed at is still that store. A Moment erased while two versions stood, removed from only the configured one, would return the moment readers were switched — and nothing anywhere would say so. The failure is silent, arrives later than the cause, and lands on exactly the person who asked to be forgotten.

**The split is not a rename.** An integration test writes a Moment into a second projection version — what a half-finished cutover leaves behind — and asserts erasure reaches it. Pointing erasure back at the version-scoped removal fails it. CI would never have caught this otherwise, because CI has only ever had one version.

**Dual-writing was rejected** as the more complex answer to a question the rebuild already answers. A rebuild into a fresh version reads authoritative state, so a second pass after the cutover picks up anything recorded during the window, and the deployment sequence is: build the new version, validate it, set the variable, deploy, run the rebuild once more to catch the gap. Idempotent throughout, and it needs no writer that understands two versions at once.

---

# ADR-130 — A Person Is a Timeline Scope, and Their Own Timeline Reports Eligibility Rather Than Filtering It

## Status

Accepted.

## Context

`timelines.md:176` defines a person's Timeline as the history they authored **together with** the history they participated in. Only the first half existed: `GET /timeline` read `timeline_moments` filtered by `author_user_id`, so a Moment somebody had confirmed they were part of never reached the Timeline it belonged to. Participation A built the relationship — propose, accept, reject, withdraw, with consent and erasure — and left it with nowhere to appear.

Two properties made this more than an extra query. A person's Timeline carries Moments authored by *other people*, which the per-row eligibility rule was never written to reason about. And `participation.md` requires that a Moment somebody accepted but cannot read still appear on their own Timeline as its date alone, so their history has no gap they cannot see the shape of — the first row this system returns *because* a Viewer may know something happened while being denied what it says.

## Decision

**A person is the third `context_type` in `timeline_moment_contexts`**, after a Location and a real-world Event. That table's own comment anticipated it — `context_type` is `LowCardinality(String)` "so a third kind of context is a projector change rather than a migration" — and it proved true: no ClickHouse migration was needed. A person row is written for the Moment's author as well as for each accepted participant, so a Timeline is one contiguous range of the existing sort key rather than a union of two queries.

**Somebody's own Timeline does not filter on eligibility; it reports it.** The rule becomes a selected column rather than a `WHERE` clause, and the service redacts the rows it marks unreadable. That is safe precisely because nothing is filtered: the page is the same size either way, so its size cannot disclose what it does not show — which is the property the rule protects everywhere else by filtering.

**Counts follow paging, in both directions.** A bucket on your own Timeline includes Moments you cannot read, because paging returns them redacted. A bucket on somebody else's excludes them, because paging excludes them. The rule is that a count and its page must agree, and the two surfaces disagree about what a page contains.

**The contract gained two tagged shapes** rather than one shape with optional fields. A client cannot read a field that is absent, and a missing field is indistinguishable from one that was never sent. The withheld shape omits `occurrenceOffsetMinutes`: a UTC offset is the one field in the occurrence set that says something about *where* somebody was.

**Whether a person's Timeline may be opened at all is theirs to decide**, defaulting to open. It is resolved once per request alongside suspension and Blocks, and a closed Timeline answers empty rather than refusing.

## Alternatives Considered

A separate `timeline_person_moments` table; computing redaction over each page in PostgreSQL rather than through the eligibility resolver; and leaving a person's Timeline unreadable by others, as it had been.

## Rationale

**The scope person's own state cannot be a per-row rule.** `eligible()` tests suspension and Blocks against a Moment's `author_user_id`, and on a person's Timeline the rows include Moments authored by third parties. A suspended person's participations would have gone on being shown under their name, and blocking somebody would not have hidden theirs. It is a fact about the scope rather than about any row, so it is resolved once per request — and never applied to somebody's own reading, because a suspended person still navigates their own past, which is what makes an appeal possible.

**Redaction stayed in the resolver rather than moving to a per-page PostgreSQL read**, which the design review argued for on boundedness grounds. Splitting it would mean expressing the eligibility rule a second time, and this codebase's standing objection is that a rule written twice eventually disagrees with itself. The bound *is* weaker for a person than for a place — "restricted Moments at this Location naming me" is bounded by somewhere, while "restricted Moments I participated in naming me" is bounded by a relationship — so that is written down where the join is, along with the fact that it fails safe: a Moment missing from the list is withheld rather than shown.

**Every Moment now writes a context row**, where before a Moment naming no Location and no Event wrote none. The cost is a delete-before-insert on reprojection that such Moments previously skipped. Measured on a rebuild into a fresh version — the flow ADR-129 made possible — 641 Moments produced 647 person rows at 3.5 a second, against 2.3 for an in-place rebuild.

**Which is why this shipped as three branches rather than one.** Moving `/timeline` to the person context blanks every Timeline until a rebuild completes, so it needed a configurable reader first (ADR-129), and building on an eligibility rule that had a hole in it would have put that hole under somebody's own name (the `temporarily_unavailable` fix).

---

# ADR-131 — Timeline Derivation Takes a View Specification

## Status

Accepted.

## Context

The Timeline engine took loose parameters: a viewer, sometimes a scope, sometimes a cursor, a direction, a limit, an instant, a scale — spread across eight service methods and sixteen routes, with the context expressible only as a path segment and never as data. Nothing bundled them, so nothing could persist or re-send them.

`roadmap.md:802` requires the engine to accept a serialisable, versioned, product-level View Specification instead, and says plainly that this is a constraint on the interface rather than a feature. The reason is `saved-views.md`: Saved Views must reuse Timeline derivation semantics rather than implementing a separate query system, which is only possible if the thing a Saved View persists is the thing navigation sends.

`saved-views.md` listed the specification's fields and left two of them — perspective and supported filters — named and never defined.

## Decision

**A View Specification is a contract type**, carrying context, perspective, temporal range, zoom, filters, position, limit, direction and a derivation version. It lives in `packages/contracts` because a Saved View will persist it, a shared link will carry it, and the feed aggregator will send it.

**Perspective is which lens is applied to a context's Moments** — `all`, `authored`, `participated`. A person's Timeline is what they recorded together with what they took part in, and those are different questions about the same person. A place has one perspective, and anything else is refused rather than ignored.

**Filters are a closed, enumerated set** — an author, a Location, a real-world Event — that narrow within a context. A filter naming the same kind of thing as the context is refused: filtering a Location's Timeline by that Location says nothing, and by a different one can never hold anything.

**Unknown fields are refused, not dropped.** Zod strips unrecognised keys by default, which would mean a saved view asking to be narrowed opening unnarrowed — showing its owner more history than they asked for. The schema is strict at both levels.

**The derivation version migrates rather than refuses.** This is the one place the cursor precedent must not be copied: `timeline.cursor.ts` refuses an unrecognised version because losing a cursor costs a restart, while a refused specification is somebody's saved view failing to open.

**Recorded-at is projected.** "New since I last looked" must key on when a Moment was recorded, never when it happened; `projected_at` cannot serve, since it is the deduplication column and moves on every reprojection, so a rebuilt decade would read as new.

**Eight methods became four**, each taking a specification. The own-history and scoped paths stopped being two surfaces: whose history it is comes from the specification's context rather than from which method was called.

## Alternatives Considered

One `derive` method returning a union; leaving perspective and filters unreachable until Saved Views needed them; and inventing meanings for the two undefined fields while plumbing.

## Rationale

**Four methods rather than one.** A page, a head, a jump and counts return genuinely different shapes, and collapsing them would push a discriminated union onto every caller. What matters is that context became data, which is what removed the own-versus-scoped split.

**Perspective and filters are reachable today.** They were defined here and would otherwise have waited for an unscheduled consumer — code nobody could use and no test could observe, sitting unexercised through every later change. Exposing them on the routes made them real capability and put them under the same equivalence tests as everything else.

**The two undefined fields were settled before anything was built on them.** A field's meaning is cheap to add and expensive to change once things have been saved with it, and deciding what "perspective" meant while wiring a query would have made a plumbing choice into a product decision.

**Sixteen routes still exist.** They are entry points that assemble a specification, which is exactly the diagram `saved-views.md` draws: navigation, a Saved View, a shared link and discovery all converge on one object. Their seventy-seven existing tests pass unchanged, which is what proves the interface changed without the behaviour changing.

---

# ADR-132 — A Saved View Stores a Request, and Sharing One Confers Nothing

## Status

Accepted.

## Context

ADR-131 made a Timeline request into an object: serialisable, versioned, and the same object every navigation surface already assembles. `saved-views.md` has specified Saved Views since before the Timeline existed, and the only thing it was waiting for was something worth persisting.

The product statement is one sentence: "my father's photographs in Tokyo in the nineties", named, kept, and reopened next year still meaning that. Everything else follows from taking that literally — a view is *about* something, so it must grow as its subject does, and it must not become a snapshot.

`saved-views.md:340` also states, without qualification, that sharing a view must never confer access to a Moment the recipient could not otherwise view.

## Decision

**A Saved View stores a View Specification and a name for it, and never a list of Moments.** Reopening derives current history. A view of a place shows what has been added to it since; "the last thirty days" means whichever thirty days it is opened in.

**The specification is not editable.** A view that pointed somewhere new would be a different view wearing an old name, and anybody holding a link to it would be handed something they were never shown. Renaming changes the name; pointing somewhere else means saving another one.

**A link carries the request and never the history.** `GET /shared-views/:token` answers with a specification and nothing derived from it. Whoever followed the link then reads the Timeline as themselves, which is the mechanism — rather than a rule applied afterwards — that makes `saved-views.md:340` true. Two people following one link see different Moments, and neither learns what the other saw.

**What a link discloses is the sender's choice, and the default is neither the title nor the owner.** A title is somebody's words about their own history, and a link outlives the conversation it was sent in. The choice lives on the share rather than on the view, so one view can be shared twice on different terms.

**A withdrawn link and a token nobody holds answer identically.** "This was withdrawn" tells a guesser that a token they invented once worked.

**A stored specification is re-validated on the way out, and migrated rather than refused.** It may have been written by an older version of this system than the one reading it — ADR-131's version rule, now with something saved under it.

**The token is thirty-two bytes and is generated in the repository.** It is the authorisation, not an identifier, so nothing upstream can weaken it. A session is still required to spend one: a capability is not a public address, and requiring one means an anonymous crawler cannot walk the token space.

**Saved Views are swept on erasure and carried in the export.** They are somebody's notes about their own past rather than a record about the world, so they leave with them, and the links go by the foreign key.

## Alternatives Considered

Storing derived results; making the specification editable; disclosing the title by default and letting senders opt out; answering a withdrawn link distinctly from an unknown one; and building new-Moment awareness into the list.

## Rationale

**New-Moment awareness was measured and then not built.** Against 50,000 Moments across 100 people, with 500 on the view and 143 of them new:

| | median | p95 | ten views |
|---|---|---|---|
| boolean, `LIMIT 1` | 88.6ms | 133.8ms | 1.04s |
| count | 121.2ms | 425.7ms | 1.71s |

The count is 37% slower at the median and 3.2x worse at p95 — the figure that matters, because it grows with how much is new. But what decided it is that **both cost about a second for a list of ten**, before any eligibility resolution, and against ClickHouse in Docker on a laptop, so both are optimistic. Neither shape belongs on the list path as a live query. It becomes its own piece, designed knowing it must be precomputed, and starts from these numbers rather than from an estimate.

**`available` is always true today, deliberately.** Whether a context still resolves is a question for whoever opens the view; answering it on the list would be a query per view, which is the cost just ruled out. The field exists because `saved-views.md:363` asks that a view whose subject has gone be marked and removable rather than treated as corrupt, and it is the reader that will fill it in.

**The privacy property is proven end to end rather than argued.** The suite records a public Moment and a private one on a sender's Timeline, has them save and share a view covering both, and has the recipient follow the link and read the Timeline — asserting the recipient sees one, and that the sender sees two, so the comparison means something. Deriving that route for the person named rather than the Viewer asking makes it fail.

**Every guard was broken deliberately.** Resolving a rolling range at save time, requiring the derivation version, dropping the ownership predicate, disclosing the title unconditionally, and deriving for the sender — each was applied, each made its test fail, and each was restored.

---

# ADR-133 — What a Saved View Has Gained Is Counted by a Sweep, and Shown Only While It Is Fresh

## Status

Accepted.

## Context

ADR-132 shipped Saved Views without the one thing `saved-views.md` suggested the initial feature might have: an indication that the derived result has changed. That was measured rather than assumed — a boolean and a count both cost about a second for a list of ten views before any authorisation was resolved — and the conclusion recorded there was that the real design has to be precomputed. This is that design.

`saved-views.md` also constrains it twice over. Its example presentation is a count, not a flag. And its privacy section requires that Chronologity "avoid leaking inaccessible Moment metadata through counts, previews, titles, or notifications" — so a precomputed number that is not eligibility-aware would violate the rule directly.

## Decision

**New means newly recorded, never newly occurred.** The mark is `recorded_at`, which comes from `moments.created_at` and is updated by no code path, so it survives reprojection and a full rebuild alike. A Moment added today belonging to 1969 is new; putting history back where it happened is the point of the product, and a mark on occurrence time would miss precisely the additions worth surfacing. `projected_at` would report a rebuilt decade as new to every reader at once.

**Counting is never incremental.** A counter that added one per arriving Moment could not observe eligibility *narrowing* — a Moment going private, a moderation decision, a Block — so it could only drift upward, which is the direction that discloses. Each pass counts afresh from the projection.

**A view of your own history is counted without an eligibility filter.** `ownSlice` returns Moments you may not read, redacted, and `ownBuckets` counts them, because they are yours and a count omitting them would disagree with the pages beneath it. Filtering the own branch looks safer and is a defect.

**A view onto a scope that has closed counts zero.** Suspension, a Block, or a Timeline turned off makes derivation empty; a badge over it would promise history that opening cannot produce.

**The sweep's write is conditional on the visit it counted from.** It reads a mark, spends time in ClickHouse, then writes; a visit landing in that gap has already asserted zero, and that zero wins.

**Narrowings aimed at a reader are invalidated synchronously.** A Block in either direction, and removal from a Moment's audience, zero the affected owner's counts in the same transaction that writes the change.

**A count past its freshness budget is shown as nothing at all**, and a rolling range gets a budget proportional to its window.

**A visit is an explicit act**, not a side effect of reading. Listing views is not looking at one.

## Alternatives Considered

Counting on the read path (ADR-132 measured it); an incremental counter; filtering the own branch; a boolean instead of a count; recomputing on every narrowing rather than only the targeted ones; and distinguishing "never counted" from "gone stale" in the contract.

## Rationale

**The privacy argument does not depend on the worker running.** This is what the freshness budget buys, and it is the part worth keeping if anything else here is revisited. Eligibility narrows after a count is taken and the sweep is what notices; without a budget, a worker down for a week would go on showing week-old numbers. With one, an outage makes badges disappear rather than go wrong. Six hours, against a sweep that brings a hundred thousand views round in about seventy-five minutes at twenty-five a pass.

**Blocks are invalidated in their own transaction because a pollable count is an oracle.** `timeline.eligibility.ts` keeps a Block symmetric precisely so it cannot be inferred from results that stopped appearing one way only. A badge falling from fourteen to eleven across a narrow view, refreshable at will, would say it out loud. Narrowings aimed at nobody — a Moment going private, a moderation decision — remove history from everybody at once, disclose nothing about the reader, and are left to the sweep. That asymmetry is the whole of the privacy design.

**Absent and zero are different answers.** "You are up to date" is a real answer; "we do not know" is not an answer at all. Never computed, computed against a superseded visit, and past the budget all present as absent, and they are deliberately indistinguishable from one another — a client that could tell them apart would be reading the health of a worker.

**A rolling range expels history as well as admitting it.** "The last thirty days" drops Moments as it slides, so its count goes wrong on its own with nothing changing in the projection. The budget is derived from the window in the presenter rather than by sweeping those views more often, which would only shorten a window that can never close while starving fixed views. Under backlog the views whose numbers have gone wrong lose their badge first.

**A limitation, accepted and named.** A Moment withheld during review for a month and then released carries its original `recorded_at`, so it is not counted as new though it newly became available. That under-reports, which is the safe direction, and `projected_at` — the only alternative — is worse for the reason above.

**Every guard was broken deliberately.** Filtering the own branch; keying the mark on occurrence, then on projection; treating an uncounted view as up to date; ignoring which visit a count was taken against; recording a visit as an edit; dropping the visit's ownership predicate; writing the count unconditionally; counting a closed scope; forgetting nothing when eligibility narrows; and dropping the cascade under a Saved View. Each was applied, each made its own test fail, and each was restored.

**Scale validation found a defect in the rebuild, not in the counting.** Phase 7 asked for measurement against a non-trivial synthetic history, and `pnpm seed:history` now writes 50,000 Moments in seconds, deterministically, so `docs/architecture/timeline-scale.json` can be regenerated by anybody. Filling the projection from it could not: the rebuild ran at 3.9 Moments a second and a run of 5,000 failed outright on a socket timeout after 1,530 seconds.

The cause is diagnosed and fixed in ADR-134, which supersedes the account first written here. That first account blamed one part per Moment, and was wrong on its own evidence — 5,164 rows in 60 parts is coalescing working. What actually cost the time was the existence probe each write issues before inserting: `moment_id` leads neither table's sort key, so each was a full scan, once per Moment, over everything written so far.

**One test could not fail and was rewritten.** The own-branch count was first tested with a Moment its owner had authored — which the eligibility rule admits anyway, its first clause being your own history whatever state it is in. Only a Moment somebody was *named in*, authored by another and shut, can tell a filtered own count from an unfiltered one. The break discipline found it; reading would not have.

---

# ADR-134 — A Rebuild Asks Once a Page, Not Once a Moment

## Status

Accepted. Corrects the diagnosis recorded in ADR-133 and completes what ADR-128 deferred.

## Context

The Timeline projection is derived, disposable and rebuildable. That is the justification for not backing it up, and ADR-128/129's zero-downtime flow rests on it: build a fresh version beside the live one, validate it, switch readers, retire the old.

It did not work. Against a deterministic 50,000-Moment corpus a rebuild ran at **3.9 Moments a second**, and a run of 5,000 died on the client's 30-second `request_timeout` after 1,530 seconds having written 2,161.

**ADR-133 recorded the wrong cause.** It said one insert per Moment meant one part per Moment, and contradicted itself in the same sentence: 5,164 rows in 60 parts is coalescing working exactly as it should. The inserts were never the problem.

The problem was the question asked before each one. `project` and `projectContexts` each probe "does this version already hold this Moment?" — and `moment_id` leads neither table's sort key, so each probe was a full scan of every partition, with the client-wide `final: 1` on top. Two per Moment, each over everything written so far, which makes a rebuild quadratic: brisk at the start, crawling by the end, and eventually a single statement outliving the timeout. On a fresh version the answer is always no, which the measured zero `DELETE`s confirms.

## Decision

**A rebuild reads and writes a page at a time; the live projector still writes one Moment at a time.** One message arriving is the right shape for one write. A walk over a corpus is not.

**The probe is kept, and asked once per table per page.** "This version is empty" is not something the code can know — a resumed rebuild, and the second pass ADR-129 prescribes for the cutover gap, both write into a version holding rows. A flag asserting freshness would be an operator promise nothing can check, whose failure mode is a Moment permanently at two dates.

**A delete is issued only where the sort key actually moved.** `ReplacingMergeTree` collapses rows sharing a sort key, so a rewrite in place needs no delete at all. For `timeline_moments` that means an occurrence corrected; for `timeline_moment_contexts` it means an occurrence corrected **or a context lost** — a Location moved, an Event unlinked, a participation withdrawn.

**Inserts are split by partition** rather than raising `max_partitions_per_insert_block`. The limit exists to stop one write creating hundreds of tiny parts, and overriding a server protection the application did not configure would silence a warning telling the truth.

**`projected_at` is stamped before the batch reads**, not before it writes. It is the column ties resolve on, so a batch stamped after reading could outrank a live projection that had read fresher state.

**The removal delete is kept separate from the make-room delete.** The first takes identifiers from finding Moments gone from the authoritative store; the second from a probe. Merging them would be correct today and would read as "delete what the probe said" — so a later narrowing of the probe would silently narrow an erasure.

**A bloom-filter skip index on `moment_id`** stops each probe being a full scan as the corpus grows. `ADD INDEX` only: materialising across existing parts is unbounded asynchronous work that a migration must not start, and is named as an operator step instead.

## Alternatives Considered

Dropping the probe and deleting unconditionally (~400 mutations per 50,000 Moments, at a measured 3.4 seconds each); a `--fresh` flag; raising the partition limit; and batching the live projector too.

## Rationale

**Measured, on the same machine, same corpus, same 2,000 Moments:**

| | Moments a second | Probe statements |
|---|---|---|
| One at a time | 4.0 | 4,001 |
| A page at a time | 1,065 | 8 |

Two probes per Moment became two per page. The full 50,000 — which the old code never reached, dying at 2,161 — **rebuilds in 63.7 seconds**.

**It builds the same projection, which a stopwatch cannot tell you.** Both versions were compared with `EXCEPT`, in both directions, over both tables, on every column but `projected_at`: zero rows differ.

**The trade was measured rather than argued.** Deleting less means a rebuild *in place* leaves the old rows for a background merge. Rebuilt in place, 2,000 Moments leave 4,000 raw rows — and a reader still sees exactly 2,000, because `final: 1` collapses them. Into a fresh version, which is the flow this serves, duplicates are zero. So the client-wide `final` setting is now load-bearing on a production path, where before `project`'s unconditional delete meant no test could tell whether it was there. `timeline.integration.test.ts` carried a comment saying exactly that; it is corrected, and the property is proved through the path that now produces it.

**Read latency was not shown to change.** Comparing the two 2,000-Moment versions gave differences that did not survive reversing the measurement order, on a laptop sharing 4 GB between ClickHouse, Kafka and PostgreSQL. Rather than report noise as a finding, the mechanism was tested directly — duplicate rows — and is zero for the flow that matters.

**The measurement writes its own numbers.** An earlier version of `scripts/timeline-scale.mjs` had the rebuild rate typed into it as a literal, so the artefact could never disagree with its author. `pnpm timeline:rebuild --measure` now writes `docs/architecture/timeline-fill.json`, and the script reads it.

**A silent truncation was fixed along the way.** The walk advanced its cursor by re-reading the last Moment of each page. If that Moment had been erased since being listed — ordinary during a live rebuild — the walk returned and reported success, having skipped the rest of history. The cursor now comes from the listing.

## Deliberately Not Here

The live path pays the same needless mutation: a visibility change or an accepted participation costs a probe returning true plus a delete, for a change the engine would absorb. Reusing the same rule there would remove it, but it changes behaviour `timeline.integration.test.ts` currently proves through the delete, and deserves its own reasoning.

---

# ADR-135 — Following Is a Second Act, and What It Announces Says Nothing About What Arrived

## Status

Accepted.

## Context

ADR-133 gave a Saved View a count of what it has gained since its owner last looked. That closes the loop only for somebody who opens their list; `saved-views.md` also describes *following* a view — "keep this perspective and surface meaningful changes to it" — as distinct from saving it.

Two other things could already be followed and did nothing. `20260822222514-add-context-following.sql` records that somebody follows a Location or a real-world Event, and `follow.repository.ts` could answer "what do I follow" but never "who follows this". No notification type mentioned either. It was a stored relationship nothing consumed.

`glossary.md` also says plainly that "neither kind follows a Timeline, which is derived", which reads as forbidding a followed Saved View.

## Decision

**What is followed is the specification, not the Timeline.** The glossary conflict resolves the way the Location migration already resolved it: what an interface presents as "follow this Timeline" is a following of the *scope*, and a View Specification is "another explicitly defined scope" in the glossary's own words. One line was added there rather than leaving the next reader to rediscover the contradiction.

**Following is a second act.** `saved_views.followed` defaults to false. Somebody who saved a view asked to come back to it; reading a request for notifications into that would start telling people things they never asked to hear.

**A saved view is followed by a column, not a table**, because it has exactly one owner and therefore exactly one possible follower.

**Three types in a new `history` category.** Not social: nobody did anything to the reader, and `saved-views.md` insists this "should not imply that the underlying historical subject itself changed". Silenceable, unlike moderation and security — somebody who finds a busy Location noisy must be able to stop hearing about it without losing the notification that says their account was accessed.

**A notification points at the thing followed, never at the Moment that triggered it.** The aggregation key is `recipient:type:sourceId`, and a partial unique index keeps one unread entry per key — so everything arriving at one place folds into one entry until it is read.

**The wording says there is more to see and never what.** A sentence naming the new Moment would be composed now and read later by somebody whose eligibility may have narrowed since. Opening the thing re-derives it for whoever opened it, which is the only safe way to find out.

**Whether a follower may know is decided per follower**, by the same Moment visibility rule everything else uses. A Moment recorded privately at a public place tells nobody.

**A saved view's announcement carries an identifier derived from `(savedViewId, last_visited_at)`.** This is the first notification in the system raised by a sweep rather than by a message, so there is no event identifier to use. Visiting moves the mark, which opens a new window.

**Fan-out walks its followers rather than gathering them**, 200 at a time, ordered by identifier so a new follower cannot insert into the middle of a walk.

## Alternatives Considered

Saving implying following; a join table for saved-view followers; folding these into `social`; naming the new Moment in the notification; and a random identifier for the sweep's announcement.

## Rationale

**Two mechanisms make repeats impossible, and the tests now say which is which.** This was got wrong twice before it was got right. The claim was that the derived identifier stops the sweep announcing the same growth every minute, and that the message's event identifier stops a redelivered fan-out telling somebody twice. Both were tested; both tests passed with the mechanism deliberately broken — because while a notification is **unread**, the aggregation index collapses repeats on its own.

The two cover different windows. The index holds while the entry is unread; the identifier holds after it has been read and before the thing has been opened. Without the second, somebody who reads a notification and does not immediately open the view gets one a minute, for ever. Both tests now mark the notification read first, which frees the index and leaves only the identifier — and both fail when it is broken. The weaker tests were kept, with corrected comments, because they prove the pair.

**The author is not told about their own Moment.** They know.

**The one message that concerns many people takes its own path.** Everything else the generator handles is one interaction between two people, and `candidateFrom` reads it into a single recipient. `MomentRecorded` cannot be read that way, so it routes before the candidate map is consulted — and the handled-event list names it explicitly, because a list derived from the map alone would have said this worker subscribes to a boundary it ignores. A guard caught exactly that.

**An existing negative test had to move.** It proved the subscription list was real by watching for a Moment being recorded, which the generator ignored. It no longer does, so the negative moved to a Location being recorded — a boundary nothing here reads — and says so.

---

# ADR-136 — The Feed Aggregator Runs Mercurius, Inside Its Own Scope

## Status

Accepted.

## Context

`feed.md` requires the aggregator to serve GraphQL and never names a library. Its open questions ask for a complexity strategy, a persisted-query decision and a schema-naming convention, and leave all three open. `monorepo.md:858` is more specific than it looks: the canonical tree contains `server/register-graphql.ts`, `server/register-plugins.ts` and a `plugins/` directory of `*.plugin.ts` files including `cors` and `helmet`. That is the Fastify plugin idiom, written before anything chose a GraphQL server.

## Decision

**Mercurius, on Fastify 5, with `graphql` pinned to 16.14.2.** Mercurius peers on `graphql ^16`; so does Apollo Server 5, so the pin is not a cost of this choice. Only Yoga supports 17.

**Schema-first.** SDL under `src/graphql/schema/`, resolvers attached to it, as the canonical tree's `.graphql` files already assume. `scripts/copy-schema.mjs` carries the files into `dist`, because the compiler will not.

**Mercurius is registered inside an encapsulated scope, and this is load-bearing.** It calls `setErrorHandler` when it loads and is itself a `fastify-plugin`, so registering it at the root would replace the application's error handler everywhere — an unknown path would answer in the GraphQL error format instead of the envelope `packages/contracts` defines. Encapsulating it means GraphQL failures are shaped like GraphQL and everything else keeps the shape the API uses. `register-graphql.test.ts` pins both halves.

**Depth is the only cost control in this phase.** `queryDepth` is configuration; field weighting and a total budget belong with the queries they weigh, and a budget defended against a two-type schema would be a number nobody could defend.

**No mutations and no subscriptions.** `defineMutation` is off so the schema does not grow an empty mutation type, and the tests assert both are absent from introspection. A read service that advertised a mutation type would be inviting the first person in a hurry to add one.

## Alternatives Considered

Apollo Server 5, and GraphQL Yoga.

## Rationale

**One request lifecycle rather than two.** Apollo needs `@as-integrations/fastify` and then runs its own plugin model, context function and error formatting beside Fastify's hooks. The canonical tree's `plugins/auth.plugin.ts` and `plugins/request-context.plugin.ts` would then establish state that Apollo's context function had to go and fetch back out, and the boundary the tree draws would stop matching the code.

**The error taxonomy stays Fastify's.** Mercurius routes failures through an `errorFormatter` and the request's own logger, so the sanitising rule — only errors written to be shown get shown — is written once. Apollo would need a second sanitiser in its own layer, which is a second place to get `feed.md:562` wrong.

**A narrower dependency surface.** Apollo's runtime pulls in `cors`, `body-parser`, `finalhandler` and `negotiator` — an HTTP stack duplicating Fastify's — plus `@apollo/utils.usagereporting` and `@apollo/usage-reporting-protobuf`, telemetry that must be explicitly disabled. `data-storage.md:436` asks this service for least privilege and a narrow profile.

**Tests keep the house shape.** Mercurius being a plugin means `app.inject({ method: "POST", url: "/graphql" })` is the same call every other suite makes, rather than Apollo's `executeOperation`, which skips the HTTP layer the test exists to prove.

## Consequences

Mercurius has a smaller community than Apollo, so there are fewer worked examples when something behaves oddly, and it ships `ws` and `mqemitter` for subscriptions this service does not use. If Fastify's organisation ever deprioritises it the migration is to Yoga rather than sideways.

## Deliberately Not Here

Persisted queries, which `feed.md:1008` says are worth considering and not required initially; and rate limiting, which belongs with abuse protection against a surface that does not exist yet.

---

# ADR-137 — The Aggregator Verifies the Token Itself, and Then Asks Whether the Session Is Still Open

## Status

Accepted. Settles the question `authentication.md:1561` and `feed.md` both leave open.

## Context

`authentication.md:600` offers two patterns and chooses neither: the aggregator verifies the same credential itself (A), or an upstream boundary authenticates and forwards trusted identity (B). Its open questions then ask directly whether the aggregator validates JWTs and whether it needs a Session-revocation lookup.

The API answers both for itself. `auth.plugin.ts` verifies signature, issuer, audience and expiry, and then reads the Session row — two checks, both required, because revocation is written synchronously and a token is a claim made up to ten minutes ago.

`feed.md:307` permits direct PostgreSQL access where it is limited and deliberate and names current Viewer eligibility as a reason; `feed.md:321` forbids ordinary Timeline reads from touching the authoritative tables at all.

## Decision

**Pattern A, with the Session lookup.** The aggregator verifies the token against the same secret, issuer and audience, and then reads `sessions` for `revoked_at IS NULL AND expires_at > now`, matching `authentication.policy.ts:36`.

**A credential that fails is refused, never downgraded to anonymous.** No credential at all is an anonymous Viewer, which is a supported state. A credential that does not hold up is `AUTHENTICATION_FAILED`, because a client silently shown an anonymous Timeline would render somebody's history as though it had shrunk.

**Every refusal is identical.** A revoked Session, an expired one, one that never existed, a forged signature and a malformed claim produce one message. The integration suite asserts the first three are indistinguishable.

**PostgreSQL is reached through `pg`, not TypeORM.** One table, one parameterised query. An ORM here would mean entity classes for tables this application must never write, and a class that can be saved is one somebody can save.

**`userId` comes from the `uid` claim alone.** The API falls back to a lookup when the claim is absent; whether a Viewer mid-onboarding may read anything is a question for the eligibility rules, not for token parsing, so it is left for 9A.

**Authentication is a hook in the GraphQL scope, not a step in the GraphQL context function.** Mercurius rebuilds the request context inside its own error handler when a request failed before one existed, so a context function that threw would be called a second time while the first throw was being reported.

## Alternatives Considered

Verifying the signature alone; and Pattern B, trusting identity forwarded by a gateway.

## Rationale

**Signature-only would have kept PostgreSQL out of this application entirely, and that is precisely what makes it wrong.** It would mean signing out stopped writes at once and stopped reads up to ten minutes later — and reads are the whole of what somebody signs out to stop somebody else seeing.

**There is no gateway to trust.** A service that believed an identity header would believe anybody who could set one, and `authorization.md:294` forbids trusting client-supplied User identifiers.

**9A needs the connection regardless.** Blocks, suspension, audience and a Timeline's openness live in PostgreSQL, which ClickHouse cannot join; `timeline.eligibility.ts` already resolves them that way for the API. Adding the boundary now costs one pool and settles the question before eligibility depends on the answer.

## Consequences

Every authenticated read costs one indexed lookup by primary key, alongside the ClickHouse work it was going to do anyway. PostgreSQL joins ClickHouse as something readiness reports, because without it every credential-carrying request is refused — which would look to a client like everybody being signed out at once. The credential this service is issued should be able to SELECT and nothing more; enforcing that is a deployment decision, and the local stack has one role, so `testing.md:1005`'s runtime-credential test is not yet meaningful here.

---

# ADR-138 — One Timeline Read Rule, in a Package That Computes and Never Connects

## Status

Accepted. Completes what ADR-084 assumed and settles the cursor ownership `api.md` and `feed.md` disagreed about.

## Context

ADR-084 removed the API's Timeline query handlers "because `apps/feed-aggregator/src/timelines/` already owns them". That directory has never existed. Phase 7 built the handlers in the API instead, because Saved Views needed derivation and there was nowhere else to put it, and Phase 8 then created an aggregator that reads nothing.

Before 9A can build Viewer eligibility it has to know where the rule deciding what a Viewer may see is going to live. Two things in `apps/api/src/features/timeline/` are needed by both applications:

- `eligible(alias)`, one condition covering own history, suspended authors, Blocks, private Moments, the named audience, age restriction and moderation takedown;
- the cursor format, together with the keyset condition and ordering that read it back.

`monorepo.md:1148` forbids the aggregator importing the API, so it cannot use either in place.

Four canonical statements pull in different directions. `feed.md:527` says the aggregator owns client-facing cursor encoding; `api.md:913` said the API's Timeline feature owns cursor encoding. `feed.md:350` says the aggregator should avoid calling back into the API per read; `projections.md:498` says normal API feature queries should not bypass the aggregator. And `principles.md:396` names "persistence adapters" and "service implementations imported by multiple applications" as poor candidates for sharing, while ADR-130 records this codebase's standing objection that "a rule written twice eventually disagrees with itself".

## Decision

**A new package, `packages/timeline-derivation`, holds what the two applications must agree about.** It carries the eligibility rule, the cursor format with its keyset condition and ordering, the translation from a View Specification into filters, and the row shape and projection version.

**It computes and never connects.** No client, no pool, no I/O: it returns SQL text and parameters, and each application runs them through its own connection. That is the line, and it is what makes the package neutral with respect to which application and which connection — the test `monorepo.md:1292` sets. It is frankly not neutral with respect to datastore, and does not pretend to be.

**Each application keeps its own query methods.** `TimelineReadRepository` stays in the API; the aggregator writes its own in 9C, shaped for GraphQL rather than REST. Their needs differ — one pages, the other over-fetches after filtering and builds connections — and sharing the execution layer would force one shape on both.

**The resolver takes a `Queryable` rather than a `DataSource`.** It used TypeORM only as a `.query(sql, params)` handle, so the narrowest interface that works is declared in the package. The API passes its `DataSource`; the aggregator will pass a wrapper over the `pg` pool it already has. Neither client is a dependency of the package.

**The cursor throws its own error.** The two applications report a refusal differently — the API as a 400 in its error envelope, the aggregator as a GraphQL error — and a package that threw either would be choosing transport for both.

**The API's sixteen Timeline routes are deprecated rather than deleted**, and go in Phase 10. Nothing consumes them; mobile is Phase 11. Removing a working surface before its replacement exists is the riskier move, and the roadmap warns against freezing the API before mobile integration.

## Alternatives Considered

Writing a second copy in the aggregator, which is what ADR-084's file trees literally describe. Having the aggregator send a View Specification to the API over HTTP. Putting the shared parts in `packages/contracts`.

## Rationale

**The rule that must not fork is a security rule.** `timeline.read.repository.ts` already said so of `eligible()`: *"A rule written in several places eventually disagrees with itself, and this is the rule that leaks when it does."* Two copies would drift in the direction nobody notices — a clause dropped in an edit shows history rather than withholding it, and every clause in that condition was added in response to something that had already gone wrong.

**The cursor is the same argument in a quieter register.** Two encodings that disagreed would not fail; they would page through history skipping and repeating Moments that share an occurrence time, which is a small enough set that nobody would find it deliberately.

**`principles.md` is right about the general case and this is the exception it does not cover.** Its objection to sharing implementation is that it erases ownership boundaries — a package that owns a service means neither application owns it. That is not what is happening here: what moves is a rule and a format, and *ownership of the rule* is precisely what was missing while it sat inside one of the two applications that need it. The execution layer, which is the part `principles.md` names, stays in each application.

**`packages/contracts` was refused on its own terms.** `monorepo.md:1098` forbids ClickHouse adapters there, and this is SQL. The cursor alone would have qualified as a serialized contract, but splitting it from the rule it pages against would have put the two halves of one agreement in two places.

**HTTP was refused for availability.** It is the only option with no duplication at all, and it makes every Timeline page two network hops and the read path's uptime a function of the write path's. `feed.md:350` names both.

## Consequences

There is now a package neither application owns, and a change to the eligibility rule affects both. That is the point, and it is also the cost: the API's integration suite is the only thing proving the rule behaves, and until 9C the aggregator's use of it is untested. `packages/timeline-derivation` therefore ships with unit tests asserting each clause of the rule is present — weak evidence compared to a query against real data, but it is what a string can be held to, and a clause silently dropped is the failure it is there to catch.

Both `vitest.workspace-build.ts` guards gained the package, or a stale build would fail as a missing symbol minutes into a run.

`TIMELINE_VERSION` moved with the row shape, which incidentally fixes `config/env.ts` importing a constant out of a feature directory.

## Deliberately Not Here

The anonymous Viewer. `TimelineEligibility` requires a `viewerUserId`, and the aggregator will need to express somebody with no account. That is 9A's design and belongs in this package when it arrives; moving the rule as it stands was the smaller change.

The aggregator gains the dependency and uses none of it yet.
