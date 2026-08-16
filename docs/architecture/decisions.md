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

**Status:** Accepted

## Decision

Chronologity will not center the API around controller/service classes.

Routes remain thin transport adapters and delegate to command/query/application behavior.

## Rationale

A generic controller/service structure obscures the actual CQRS and domain boundaries.

## Consequences

Business rules must not accumulate in Fastify route handlers.

---

# ADR-008 — Use CQRS

**Status:** Accepted

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

**Status:** Accepted

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

**Status:** Accepted

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

**Status:** Accepted

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
- EventStoreDB hosting model;
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
11. CQRS separates writes from optimized reads.
12. Event Sourcing is selective rather than universal.
13. EventStoreDB is the event-sourced authority, not the Timeline query engine.
14. PostgreSQL owns relational/operational state where appropriate.
15. ClickHouse owns derived Timeline/historical read models.
16. Kafka is the canonical durable asynchronous messaging backbone.
17. Domain Events and Integration Events remain distinct.
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
36. Replay/restore must not resurrect erased data.
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

`node:assert/strict` stays because migrating the assertions would weaken them. `assert.deepStrictEqual` distinguishes a property explicitly set to `undefined` from a property that is absent; `expect(...).toEqual` does not. Several tests here assert on payloads where that distinction is the point, and a mechanical conversion would have quietly loosened them. Vitest reports diffs for assertion errors carrying `actual` and `expected`, which Node's `AssertionError` does, so the reporting improves regardless.

Integration tests are named `*.integration.test.ts`. They are tests, and the suffix should say so: anything globbing `*.test.ts` finds them, which means the unit configuration has to exclude them deliberately rather than miss them by accident.

The integration configuration loads the root `.env` itself rather than relying on the shell. A missing `POSTGRES_PORT` does not fail loudly — it connects to whatever else is listening on 5432 — and that has already cost one debugging session.

## Consequences

Test files no longer reach `dist`, so integration tests exercise source rather than the shipped artifact; the build is still verified by `build` and `typecheck` on every run. Turbo's `test` tasks no longer depend on a package's own build, only on its dependencies'. `pnpm test:watch` now exists. Mobile will use its own runner when that phase begins — `jest-expo` is what the Expo toolchain expects — so this decision covers the TypeScript backend and shared packages, not the whole repository.

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
