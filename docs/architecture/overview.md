# Architecture Overview

## Purpose

This document defines the high-level software architecture for Chronologity. It establishes the major runtime boundaries, responsibilities of each deployable application, authoritative and derived data paths, shared-package roles, and architectural constraints that focused documents must preserve.

This overview intentionally does not define the complete repository tree. The canonical directory topology belongs in `docs/architecture/monorepo.md`. Chronologity is a historical system organized around immutable Moments and multidimensional Timelines, with chronological navigation, contextual movement, temporal zoom, historical jumps, causality, and historical significance as first-class concerns.

## Architectural Goals

- Preserve a durable, trustworthy historical record.
- Make chronology foundational rather than a presentation preference.
- Support the multidimensional Timeline as the primary navigation model.
- Support temporal zoom and direct historical jumps from day one.
- Separate authoritative domain state from derived read state.
- Keep derived read models rebuildable from authoritative history.
- Support high-volume Timeline navigation without coupling clients to persistence.
- Keep cross-application contracts explicit and versionable.
- Enforce authorization and moderation without a separate administrative product.
- Keep complexity proportional to actual product and scale requirements.

## Canonical Runtime Topology

Chronologity has exactly four deployable applications:

```text
apps/
├── api/
├── feed-aggregator/
├── mobile/
└── web/
```

There is no separate administrative application. Administrative and moderation capabilities are exposed through the consumer product where appropriate and protected through role-based authorization. Authority belongs to backend domain and authorization rules, not to a privileged standalone client.

The repository name `feed-aggregator` remains canonical until an explicit rename is approved. Despite that historical name, its responsibility is Timeline aggregation and read composition, not a conventional social-media Feed.

```text
Mobile (React Native + Expo)
       │ REST                 │ GraphQL
       ▼                      ▼
API (Fastify)          Feed Aggregator
       │                      │
authoritative writes      derived reads
       ▼                      ▼
   PostgreSQL             ClickHouse
       │                      ▲
       └──── projections ─────┘

PostgreSQL holds authoritative state for every feature. ClickHouse holds
read models derived from it, and never the reverse.
```

The Gatsby website is a separate, predominantly static application and is not part of the primary Timeline interaction path.

## Product Model

### Moments

A Moment is a first-class historical unit and may contain an unlimited number of images and videos. The architecture must never equate a Moment with a single media object.

Moments remain chronologically coherent units. Recursive Sub-Moments or nested Moment trees are not part of the finalized product model. Older structural concepts involving Moment parent/child hierarchies, splitting, merging, or reparenting must not be treated as architectural requirements merely because they appeared in an earlier directory structure.

### Timelines

A Timeline is an ordered, contextual representation of Moments through time and is Chronologity’s primary historical navigation abstraction. It is not a conventional algorithmically ranked Feed, and exploratory historical navigation is not a separate Discovery abstraction.

Different scopes can produce different Timelines—for example, location, user, tag, network, event, or another historically meaningful context—but chronology remains foundational. Persisted Timeline definitions may exist where product semantics require them, but the presence of a `timelines` feature must not imply that every Timeline is an arbitrary user-created container.

## Multidimensional Timeline Navigation

### Vertical: Chronology

Vertical movement navigates Moments through time within the current context. It requires stable chronological ordering, deterministic tie-breaking, bidirectional cursor navigation, efficient neighboring slices, and pagination stable under new inserts.

### Horizontal: Context

Horizontal movement changes historical context. Adjacent contexts may represent locations, events, or other meaningful groupings. The system resolves adjacency and supports prefetching so the client does not reconstruct these relationships itself.

### Depth: Moment Detail

Depth moves into a Moment. It is not another chronological axis and must not be implemented as recursive Sub-Moment chronology. The depth layer composes the complete media collection, metadata, reactions, creator information, geographic context, moderation visibility, and chronological context required to understand the Moment.

## Temporal Zoom and Historical Jumps

Temporal zoom and historical jumps are foundational capabilities and must be supported from day one.

Temporal zoom changes the temporal resolution at which history is explored. The read architecture must expose temporal structure and aggregation appropriate to different scales without changing the authoritative record.

Historical jumps allow users to navigate directly to a historical point rather than reaching it only through repeated scrolling. The read side must locate a Timeline around a target time or meaningful historical anchor and return enough surrounding context to resume multidimensional navigation.

## Causality

Chronologity distinguishes chronology from causality. Temporal proximity alone does not establish causation.

Causal relationships must be represented explicitly and preserve the provenance, confidence, attribution, or other semantics established by the product specification. Timeline composition may surface causal relationships, but authoritative causal assertions originate from the appropriate domain model and are projected into read-optimized forms.

## Historical Significance

Historical significance is distinct from chronology. Every Moment has a chronological position without being equally significant.

Significance is derived metadata used to understand and navigate history; it must not rewrite the historical record. Because significance can evolve, it should be recomputable derived state with provenance. It may support temporal zoom, historical jumps, summaries, and contextual navigation without turning Chronologity into an opaque relevance-ranked Feed.

## Authoritative and Derived State

### Authoritative State

`apps/api` owns authoritative domain decisions: domain invariants, authorization, canonical mutations, and moderation decisions.

PostgreSQL holds authoritative state for every feature (ADR-092). A successful write does not depend on ClickHouse having caught up.

### Derived State

ClickHouse contains derived read models optimized for high-volume historical and Timeline access. They are projections of authoritative facts and may be rebuilt as projection logic changes. Derived state must never become an undeclared second source of truth.

## `apps/api`

`apps/api` is the authoritative Fastify + TypeScript backend. It owns authentication and sessions, role-based authorization, commands, domain invariants, authoritative events, operational REST queries, state-mutating workflows, upload/media-processing lifecycles, and authoritative moderation decisions.

The API is feature-oriented rather than controller/service-oriented:

```text
routes
  ↓
services
  ↓
policies decide the rules
  ↓
repositories write, conditionally
  ↓
PostgreSQL, with the outbox message in the same transaction
```

It must not absorb every high-volume multidimensional Timeline read merely because it owns the underlying facts.

## `apps/feed-aggregator`

`apps/feed-aggregator` is the read-only Timeline composition service. It transforms derived ClickHouse read models into client-optimized GraphQL responses.

It owns Timeline heads and slices, bidirectional chronological pagination, horizontal adjacency, Moment depth composition, temporal zoom, historical jumps, context around a Moment or temporal position, supported scoped Timeline views, batching, N+1 prevention, neighboring-context prefetching, request-aware visibility filtering, and surfacing projected causality/significance data.

It consumes ClickHouse read models; it does not own the projections that create them. It must not own authoritative mutations, authoritative PostgreSQL repositories, authentication, moderation decisions, or anything that changes state.

```text
GraphQL resolver
       ↓
query / composition
       ↓
read-model adapters + request-scoped loaders
       ↓
ClickHouse
```

Resolvers remain thin; Timeline algorithms and SQL do not accumulate directly in them.

## `apps/mobile`

`apps/mobile` is the primary consumer product, built with React Native and Expo. It owns multidimensional Timeline navigation, temporal zoom, historical jumps, Moment creation/media upload, reactions, notifications, profiles, account management, reporting, moderation-related experiences, and role-authorized administrative interfaces.

REST targets `apps/api` for authoritative operations. GraphQL targets `apps/feed-aggregator` for Timeline and Moment read composition. The client must not duplicate backend domain rules.

## `apps/web`

`apps/web` is the Gatsby public website. It owns marketing, product explanation, public information, editorial content, press, careers, legal content, acquisition forms, SEO, metadata, structured data, and social previews.

It is not the main product client and must not become a parallel implementation of the mobile Timeline experience without an explicit product decision.

## Shared Packages

The canonical shared packages are:

```text
packages/
├── api-client/
├── config/
├── contracts/
├── eslint-config/
└── tsconfig/
```

`packages/contracts` is the central cross-application contract boundary. `packages/api-client` provides the typed REST client. `packages/config` contains genuinely shared configuration primitives. `packages/eslint-config` and `packages/tsconfig` define shared development conventions.

Applications consume shared packages; they do not import implementation code from other applications.

## Application Dependency Rules

```text
apps/api              ✓ → packages/*
apps/feed-aggregator  ✓ → packages/*
apps/mobile           ✓ → packages/*
apps/web              ✓ → packages/*

apps/*                ✗ → another app's implementation
```

Cross-runtime communication occurs through explicit network or event contracts. The monorepo is a development and governance convenience, not one runtime.

## Authoritative State and Derived Reads

Chronologity separates two materially different workloads. The write side is
optimized for invariants, authorization, correctness, and durable decisions. The
Timeline read side is optimized for chronological range access, multidimensional
navigation, contextual adjacency, temporal positioning, aggregation, high-volume
pagination, and composition.

That separation is a boundary between *applications* — the API and the feed
aggregator — not a split inside either one. Within the API, reading and writing
touch the same PostgreSQL tables through the same service, and there is no
command/query division (ADR-091).

```text
request
  ↓
service decides and writes
  ↓
PostgreSQL, with an outbox message in the same transaction
  ↓
Integration Event
  ↓
projection
  ↓
read model
```

Chronologity is event-driven, not event-sourced (ADR-092). Events announce what
was accepted; they are not what makes it true.

Application-level event history and user-visible historical Moments are related
ideas but are not the same thing.

## Projection Architecture

A projection is the process that derives state; a read model is the resulting materialized representation.

```text
authoritative event history
          ↓
      projection
          ↓
  ClickHouse read model
          ↓
   feed-aggregator
          ↓
       GraphQL
          ↓
        mobile
```

The aggregator consumes projection results; it does not become the projection system itself.

## Messaging

Asynchronous messaging connects authoritative event production with downstream processing where decoupling, throughput, or independent consumption requires it.

Kafka is transport and distribution infrastructure, not a source of truth. Consumers must tolerate duplicate delivery, retries, relevant ordering constraints, and eventual consistency.

## Persistence Responsibilities

### PostgreSQL

Holds authoritative state for every feature. It is not queried by the Timeline
aggregator.

### ClickHouse

Stores derived read models optimized for high-volume historical and Timeline access, including chronological slices, contextual views, temporal navigation, historical aggregation, and other denormalized read patterns. It is rebuildable derived state, not authoritative truth.

## Media Architecture

Media is associated with Moments, but binary media is not embedded in domain event payloads. Upload registration, object storage, metadata extraction, processing/transcoding, durable media metadata, Moment association, and client delivery remain separate concerns.

A Moment’s unlimited media semantics are implemented through bounded technical operations such as pagination, chunked/resumable upload, batching, background processing, and incremental composition rather than an arbitrary product-level media-count limit.

## Authentication, Authorization, and Administration

Authentication establishes identity; authorization determines permitted actions.

The API owns session creation, refresh, revocation, identity-provider flows, and security-sensitive account operations. The aggregator authenticates only enough to identify the requester, enforce visibility, distinguish scopes, resolve network-scoped Timelines, and apply read filters.

Chronologity has no separate admin application. Administrative interfaces live in the consumer mobile app for appropriately authorized roles, while every administrative action is enforced and recorded by the backend.

## Moderation

Moderation is authoritative domain behavior owned by the API. Decisions such as restricting, removing, restoring, escalating, or otherwise changing moderation state occur there.

Moderation visibility is projected into read models so the aggregator can filter responses. The aggregator applies moderation state; it does not make moderation decisions.

## Privacy and Visibility

Privacy is a data-flow property. Visibility rules must survive authoritative writes, projections, read models, caches, GraphQL composition, and client delivery.

Request-scoped loaders and caches must not leak authorization-sensitive data between users.

## Consistency Model

Chronologity accepts eventual consistency between authoritative writes and derived reads:

```text
client
  ↓
API
  ↓
authoritative decision, committed with its outbox message
  ↓
event distribution
  ↓
projection
  ↓
ClickHouse
  ↓
feed-aggregator
  ↓
client read
```

The client may briefly observe a successful mutation before it appears in a Timeline projection. Where immediate feedback is needed, the client may represent confirmed command outcomes locally while awaiting projection convergence.

## Scalability Boundaries

Chronologity scales constrained workloads rather than prematurely distributing every subsystem. Existing boundaries already separate command processing, Timeline read composition, analytical reads, event history, relational/operational persistence, media processing, and client delivery.

New services should be extracted only for concrete reasons such as materially different scaling behavior, failure isolation, security boundaries, operational ownership, or technology requirements.

## Observability

Backend applications should support structured logging, request/trace identifiers, metrics, distributed tracing where justified, projection-lag monitoring, consumer health, GraphQL query timing, persistence latency, and media-workflow failure visibility.

Projection lag is a product-relevant operational metric in an eventually consistent system.

## Failure and Recovery Principles

- Authoritative writes do not depend on all downstream projections completing synchronously.
- Consumers tolerate retries and duplicate delivery.
- Projection processing is restartable.
- Read models are rebuildable.
- Cursor semantics remain deterministic.
- Media workflows expose recoverable states.
- Aggregator failures cannot corrupt authoritative data.
- Caches are disposable.
- Client retries must not accidentally duplicate authoritative commands.
- Recovery favors replay and reconstruction from authoritative history.

## Architectural Constraints

1.  Product semantics constrain the architecture.
2.  Chronology is a first-class domain and query dimension.
3.  Temporal zoom and historical jumps are day-one capabilities.
4.  A Moment may contain unlimited media; bounded technical operations preserve that semantic.
5.  Recursive Sub-Moment chronology is not part of the finalized product model.
6.  Authoritative and derived state must always be distinguishable.
7.  The API owns authoritative domain decisions and mutations.
8.  The feed aggregator is read-only and composes Timeline experiences from derived read models.
9.  ClickHouse is not authoritative domain truth.
10. Kafka, where used, transports events; it does not define truth.
11. Applications communicate through explicit contracts rather than cross-importing implementation code.
12. Administrative capability does not justify a separate admin application; authorization is enforced server-side.
13. Causality must not be inferred solely from chronology.
14. Historical significance is derived and recomputable rather than a mutation of historical fact.
15. High-volume Timeline reads are optimized independently from command processing.
16. PostgreSQL is the single authority; the system is event-driven, not event-sourced.
17. New runtime boundaries require a concrete architectural reason.
18. Derived state, caches, and projections should be recoverable or rebuildable wherever practical.

## Current Canonical Application Boundaries

| Application            | Primary responsibility                                                                               | Primary interface              | Authoritative mutations |
| ---------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------ | ----------------------- |
| `apps/api`             | Domain behavior, commands, authentication, authorization, workflows, moderation, operational queries | REST                           | Yes                     |
| `apps/feed-aggregator` | Multidimensional Timeline and Moment read composition over derived state                             | GraphQL                        | No                      |
| `apps/mobile`          | Primary consumer product, including role-authorized administrative interfaces                        | REST + GraphQL client          | No direct persistence   |
| `apps/web`             | Public marketing, editorial, informational, legal, and acquisition website                           | Static/web + limited API calls | No direct persistence   |

These boundaries are canonical unless changed by an explicit architecture decision.

## What This Document Does Not Define

This overview does not define the complete monorepo tree; every route, service, event, or projection; exact database schemas; Kafka topics; the exact GraphQL schema; Timeline cursor encoding; historical-significance formulas; causality evidence models; temporal-zoom algorithms; the role/permission matrix; media providers; or deployment topology.

Those details belong in focused architecture and technical specifications while preserving the boundaries established here.

## Summary

Chronologity is architected as a historical system rather than a conventional social Feed.

The authoritative API decides what happened and records durable domain history. Projections transform that history into read-optimized representations. ClickHouse stores those derived representations. The feed aggregator composes them into GraphQL responses for vertical chronology, horizontal context, Moment depth, temporal zoom, and historical jumps. The React Native mobile application provides the primary consumer experience, including role-authorized administrative interfaces, while Gatsby remains the public website.

The architecture deliberately separates truth from representation, mutation from navigation, chronology from causality, and historical fact from derived significance.
