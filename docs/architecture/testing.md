# Chronologity Testing Architecture

## Purpose

This document defines the testing architecture for Chronologity.

Chronologity spans multiple applications, persistence models, asynchronous workflows, read projections, media pipelines, and security-sensitive boundaries.

Testing therefore cannot rely on one technique.

The architecture must validate:

- domain correctness;
- command behavior;
- Event Sourcing semantics;
- relational persistence;
- projections;
- Kafka messaging;
- Timeline composition;
- media processing;
- notifications;
- privacy;
- authorization;
- caching;
- deployments;
- failure recovery;
- performance;
- and client/server contracts.

This document defines:

- testing principles;
- test categories;
- ownership;
- repository organization;
- unit testing;
- integration testing;
- contract testing;
- aggregate/Event Sourcing testing;
- projection/replay testing;
- messaging testing;
- API testing;
- GraphQL/feed testing;
- media testing;
- privacy/security testing;
- cache testing;
- mobile testing;
- web testing;
- end-to-end testing;
- performance/load testing;
- failure/chaos testing;
- migration testing;
- CI execution strategy;
- test data;
- flake control;
- and open architectural questions.

This document is grounded in:

- `docs/architecture/overview.md`;
- `docs/architecture/principles.md`;
- `docs/architecture/monorepo.md`;
- `docs/architecture/api.md`;
- `docs/architecture/authentication.md`;
- `docs/architecture/authorization.md`;
- `docs/architecture/events.md`;
- `docs/architecture/messaging.md`;
- `docs/architecture/projections.md`;
- `docs/architecture/data-storage.md`;
- `docs/architecture/timeline.md`;
- `docs/architecture/feed.md`;
- `docs/architecture/media.md`;
- `docs/architecture/notifications.md`;
- `docs/architecture/caching.md`;
- `docs/architecture/privacy.md`;
- `docs/architecture/security.md`;
- `docs/architecture/observability.md`;
- `docs/architecture/scalability.md`;
- `docs/architecture/deployment.md`.

---

# Core Principle

Testing should validate architecture at the boundaries where correctness can actually fail.

The governing rule is:

> **Mock internal logic when isolation improves clarity, but test infrastructure semantics with real infrastructure whenever those semantics matter to correctness.**

Mocks are useful.

Mocks are not proof that EventStoreDB, Kafka, PostgreSQL, ClickHouse, object storage, or mobile runtime behavior actually works.

---

# Testing Pyramid

Chronologity should use a broad pyramid:

```text
many fast unit tests
        ↓
focused integration tests
        ↓
contract tests
        ↓
critical end-to-end tests
        ↓
targeted load/security/failure tests
```

Do not invert the pyramid by relying primarily on slow full-system tests.

---

# Test Ownership

Tests should remain close to the code they validate.

The established repository preference is:

```text
implementation file
implementation.test.ts
```

where practical.

Cross-application and infrastructure tests may live in dedicated integration/e2e locations.

---

# Colocation

Feature-local unit tests should be colocated with implementation.

Examples:

```text
create-moment.command.ts
create-moment.command.test.ts

moment.aggregate.ts
moment.aggregate.test.ts

timeline-query.ts
timeline-query.test.ts
```

---

# Shared Test Infrastructure

Reusable integration harnesses may live in dedicated test-support modules.

Potential examples:

```text
test-support/
    eventstore/
    postgres/
    kafka/
    clickhouse/
    object-storage/
```

Do not duplicate container/bootstrap logic in every feature test.

---

# Test Categories

Chronologity uses the following primary test categories:

```text
unit
integration
contract
replay
end-to-end
security
privacy
performance
failure/recovery
migration
```

A test may belong to more than one conceptual category, but its purpose should be clear.

---

# Unit Tests

Unit tests validate pure or narrowly scoped logic.

Good unit-test targets:

- aggregate decisions;
- authorization policies;
- value objects;
- schema transformation;
- event upcasters;
- cursor encoding/decoding;
- projection transformation functions;
- cache-key builders;
- retry classification;
- Timeline ordering;
- notification aggregation.

---

# Unit Test Requirements

Unit tests should be:

- fast;
- deterministic;
- isolated;
- independent of network/databases;
- focused on behavior rather than implementation internals.

---

# Avoid Over-Mocking

Do not mock every collaborator merely to increase isolation.

If a test spends more effort reproducing framework behavior than validating domain behavior, it is likely at the wrong level.

---

# Integration Tests

Integration tests validate real interactions between Chronologity code and infrastructure.

Required infrastructure integration targets include:

- EventStoreDB;
- PostgreSQL;
- Kafka;
- ClickHouse;
- object storage or faithful S3-compatible test service;
- relevant provider sandbox/fakes.

---

# Real Infrastructure Rule

Use real infrastructure where behavior matters.

Examples:

```text
EventStoreDB expected version
Kafka partition ordering
PostgreSQL transaction constraints
ClickHouse ordering/replacing semantics
multipart upload behavior
```

A mock cannot validate these semantics.

---

# Testcontainers / Ephemeral Infrastructure

Containerized ephemeral infrastructure is strongly recommended for CI/local integration tests where supported.

This enables:

- isolated test environments;
- reproducible versions;
- parallel execution;
- clean teardown.

The exact library/tooling belongs in implementation decisions.

---

# Unit Versus Integration Boundary

A practical rule:

```text
business/domain decision
    → unit test

adapter/store/message semantics
    → integration test
```

---

# Aggregate Tests

Event-sourced aggregates should use Given/When/Then-style tests.

Example:

```text
Given:
    MomentCreated

When:
    CorrectOccurrenceTime

Then:
    MomentOccurrenceTimeCorrected
```

These tests do not require EventStoreDB.

---

# Aggregate Reconstruction Tests

Every event-sourced aggregate should have tests that replay historical event sequences into current state.

Verify:

- event order;
- state reconstruction;
- old event versions;
- deleted/inactive states;
- invalid transitions.

---

# Aggregate Invariant Tests

Test invariants directly.

Examples:

- cannot revoke already-revoked Session incorrectly;
- cannot assign forbidden role;
- cannot attach invalid media;
- cannot create unsupported state transition.

---

# Event Emission Tests

Command/domain tests should assert:

- event type;
- payload;
- metadata where domain-relevant;
- no event on rejected command.

Avoid asserting incidental private implementation details.

---

# Event Schema Tests

Persisted and integration event schemas should validate:

- valid payload;
- invalid payload;
- missing required field;
- enum handling;
- event version;
- prohibited sensitive fields.

---

# Event Upcaster Tests

Old event versions must remain readable.

Each upcaster should have deterministic fixtures.

Verify that upcasting:

- preserves old semantics;
- does not invent facts;
- does not call external services.

---

# EventStoreDB Integration Tests

Required cases:

- append to new stream;
- append with expected version;
- concurrency conflict;
- stream read ordering;
- stream not found;
- metadata round trip;
- subscription delivery;
- restart/catch-up behavior.

---

# Snapshot Tests

If snapshots are introduced:

- snapshot can restore state;
- incompatible snapshot is rejected;
- fallback replay works;
- snapshot does not become sole authority.

Snapshots are not a day-one test requirement unless snapshots are implemented.

---

# CQRS Command Tests

Command-handler tests should verify:

- authentication context where needed;
- authorization;
- aggregate load;
- invariant enforcement;
- authoritative persistence;
- idempotency;
- concurrency behavior;
- returned command result.

---

# CQRS Query Tests

Query tests should verify:

- correct read source;
- no mutation;
- filtering;
- pagination;
- authorization;
- mapping to API/GraphQL contract.

---

# Messaging Producer Tests

Verify:

- correct event transformation;
- stable message ID;
- event type/version;
- partition key;
- correlation/causation propagation;
- privacy-safe payload.

---

# Kafka Integration Tests

Required cases:

- publish/consume;
- ordering by partition key;
- consumer group behavior;
- duplicate delivery handling;
- consumer restart;
- offset/checkpoint behavior;
- unsupported version;
- poison message/quarantine.

---

# Outbox Tests

For relational-authoritative features:

- state + outbox commit atomically;
- publisher publishes record;
- crash/retry may duplicate safely;
- published state is eventually marked;
- failed publish retries.

---

# Consumer Idempotency Tests

Every durable consumer should receive the same event twice in tests.

Expected result:

```text
one logical business/projection effect
```

---

# Retry Tests

Consumers/workers should test:

- transient failure retries;
- bounded attempts;
- permanent failure does not retry forever;
- jitter/backoff configuration behavior where testable;
- quarantine after exhaustion.

---

# Projection Unit Tests

Projection transformation tests should cover:

- create;
- update;
- delete;
- correction;
- duplicate event;
- stale event;
- privacy change;
- moderation change;
- role change.

---

# Projection Integration Tests

Use real target datastore.

For PostgreSQL projections:

- transactions;
- unique constraints;
- dedupe;
- checkpoint update.

For ClickHouse projections:

- versioned insert/update behavior;
- ordering;
- corrections;
- deletes/tombstones;
- duplicate ingestion.

---

# Projection Replay Tests

Critical projections must have:

```text
authoritative event history
    ↓
full replay
    ↓
expected read model
```

This is required for:

- Timeline;
- authorization;
- moderation/privacy eligibility;
- User/profile read models.

---

# Privacy-Safe Replay Tests

Replay must not resurrect:

- deleted PII;
- private content as public;
- moderated content;
- erased media references;
- removed authorization.

These tests are critical.

---

# Projection Version Tests

For versioned projections:

- v1 and v2 build independently;
- v2 replay succeeds;
- validation compares expected semantics;
- reader cutover is compatible;
- rollback remains possible.

---

# Timeline Ordering Tests

Test:

- occurrence-time ordering;
- deterministic tie-break;
- identical timestamps;
- backfilled historical insert;
- correction to older/newer time;
- uncertain time rules once defined.

---

# Timeline Cursor Tests

Test:

- forward navigation;
- backward navigation;
- cursor resume;
- invalid cursor;
- unsupported cursor version;
- insertion around cursor;
- deletion around cursor;
- page boundaries.

---

# Historical Jump Tests

Test jumps by:

- Moment;
- timestamp;
- Real-World Event;
- Location;
- causal destination;
- significance anchor.

Also test:

- unauthorized target;
- deleted target;
- projection lag;
- safe failure.

---

# Temporal Zoom Tests

Test:

- each canonical scale;
- narrow → broad;
- broad → narrow;
- bucket boundaries;
- dense history;
- sparse history;
- historical anchors;
- privacy filtering.

---

# Horizontal Context Tests

Test:

- context adjacency;
- stable context IDs;
- authorization;
- no hidden-context leakage;
- deterministic behavior.

---

# Moment Depth Tests

Verify:

- composition;
- media pagination;
- unlimited media semantics;
- Comments/Reactions pagination where applicable;
- causal links;
- historical significance;
- privacy/moderation filtering.

---

# Feed Aggregator Resolver Tests

Resolvers should test:

- GraphQL input mapping;
- Viewer context;
- delegation to query layer;
- safe error mapping;
- no SQL/business mutation.

---

# GraphQL Contract Tests

Validate:

- schema shape;
- nullability;
- pagination types;
- unions/interfaces;
- deprecations;
- error contracts.

---

# N+1 Tests

Use instrumentation or query-count assertions to ensure a Timeline page does not produce one database query per field/item.

---

# DataLoader Tests

Verify:

- batching;
- per-request isolation;
- duplicate key collapse;
- error behavior;
- Viewer-sensitive separation.

---

# Feed Authorization Tests

Matrix should include:

```text
anonymous
authenticated
owner
network/follower
blocked
private
moderated
deleted
suspended
privileged moderator where appropriate
```

---

# Feed Cache Tests

Verify:

- public/personalized key separation;
- Viewer isolation;
- invalidation;
- TTL;
- cache miss equivalence;
- stale privacy state handling.

---

# API Route Tests

REST route tests should verify:

- schema validation;
- auth requirement;
- authorization;
- handler delegation;
- status code;
- stable error code;
- response contract.

---

# Fastify Integration Tests

Use Fastify injection where possible for fast in-process HTTP integration.

Use network-level tests only where network behavior matters.

---

# Authentication Tests

Test:

- registration;
- login;
- invalid credentials;
- expired Session;
- revoked Session;
- refresh;
- refresh replay/reuse;
- provider linking;
- OAuth state/PKCE failures;
- MFA/recovery where implemented.

---

# Authorization Tests

Test policy behavior independently and through endpoints.

Every privileged operation should have negative tests.

---

# IDOR Tests

Every resource endpoint/query should attempt cross-User access.

Example:

```text
User B accesses User A private Moment
    → denied
```

Do not rely only on positive-path authorization tests.

---

# Privileged Role Tests

Verify:

- role assignment requires correct permission;
- role removal propagates;
- stale role cache does not grant access beyond accepted window;
- audit record emitted.

---

# Media Upload Tests

Test:

- upload registration;
- scoped upload target;
- expiry;
- wrong User;
- wrong object key;
- missing object;
- finalize;
- duplicate finalize;
- abandoned upload.

---

# Media Validation Tests

Images:

- valid format;
- spoofed MIME;
- malformed data;
- excessive dimensions;
- decompression bomb protection.

Videos:

- valid <=90 seconds;
- \>90 seconds rejected;
- malformed duration;
- unsupported codec;
- invalid container.

---

# Media Processing Tests

Test:

- metadata extraction;
- derivative generation;
- transcode;
- retry;
- timeout;
- duplicate processing request;
- provider callback duplicate;
- provider outage.

---

# Media Privacy Tests

Test:

- private signed access;
- expired signed access;
- revoked visibility;
- moderation restriction;
- deletion;
- CDN invalidation behavior where testable.

---

# Notification Generation Tests

Test:

- source event creates notification;
- self-notification suppression;
- preferences;
- mandatory security notification;
- blocking/privacy suppression;
- dedupe.

---

# Notification Aggregation Tests

Test:

- aggregation key;
- count;
- bounded actor list;
- concurrency;
- unrelated activities do not merge.

---

# Notification Delivery Tests

Test:

- push request;
- email request;
- provider retry;
- invalid token;
- bounce/permanent failure;
- provider outage.

---

# Notification Deep-Link Tests

Test:

- current authorization;
- deleted source;
- blocked source;
- Timeline around Moment;
- projection lag.

---

# Cache Unit Tests

Test:

- key builder;
- version;
- TTL selection;
- invalidation mapping;
- serialization.

---

# Cache Integration Tests

If Redis/distributed cache is introduced:

- expiry;
- invalidation;
- outage fallback;
- concurrency;
- serialization compatibility.

Redis is not currently required.

---

# Privacy Tests

Privacy testing must be cross-system.

Verify changes propagate through:

- API;
- projections;
- Timeline;
- Search if present;
- media;
- notifications;
- caches.

---

# Account Deletion Tests

Test:

- Session revocation;
- PII erasure;
- projections;
- media cleanup;
- cache invalidation;
- notification/push cleanup;
- replay after deletion;
- idempotent retries.

---

# Backup/Restore Privacy Tests

Where feasible in staging:

- restore backup;
- reapply deletion ledger;
- ensure erased data does not reappear.

---

# Security Tests

Security tests include:

- authentication abuse;
- authorization bypass;
- IDOR;
- SQL injection inputs;
- GraphQL complexity;
- callback forgery;
- upload attacks;
- secret redaction;
- service credential restrictions.

---

# Runtime Credential Tests

Verify actual credentials cannot perform forbidden operations.

Examples:

```text
feed aggregator cannot mutate ClickHouse
API runtime cannot apply PostgreSQL schema migration
projection worker cannot access unrelated restricted tables
```

---

# Logging Redaction Tests

Assert that known sensitive values do not appear in captured logs.

Examples:

- password;
- access token;
- refresh token;
- signed URL;
- GPS;
- push token.

---

# GraphQL Abuse Tests

Test:

- excessive depth;
- massive page sizes;
- aliases/repeated fields;
- nested connections;
- expensive temporal zoom;
- repeated direct-ID probing.

---

# Rate-Limit Tests

Verify feature-specific limits.

Rate-limit tests should not assume one global limit.

---

# Mobile Unit Tests

Mobile tests should cover:

- state reducers/stores;
- API adapters;
- Timeline navigation state;
- upload state;
- cursor handling;
- optimistic state;
- deep-link routing.

---

# Mobile Component Tests

Test important UI semantics:

- Timeline rendering;
- media loading;
- accessibility labels;
- read/unread notification behavior;
- authorization-gated admin controls.

UI hiding is tested as UX, while server tests protect security.

---

# Mobile Integration Tests

Test:

- API client interaction;
- GraphQL client behavior;
- local cache;
- upload retry;
- secure-storage wrapper;
- deep links.

---

# Mobile End-to-End Tests

Critical mobile flows should run on iOS and Android environments where practical.

Examples:

```text
register/login
create Moment
upload media
view Timeline
historical jump
temporal zoom
react/comment
open notification
logout
```

---

# Device Differences

Some behavior requires device/emulator testing:

- media picker;
- camera;
- background upload;
- secure storage;
- push notifications;
- autoplay;
- app lifecycle.

Unit mocks are not sufficient.

---

# Accessibility Tests

Automated tests should cover:

- labels;
- roles;
- focus order;
- touch target basics;
- semantic Timeline navigation.

Manual screen-reader testing is still required.

---

# Web Tests

The Gatsby site should have:

- component/unit tests where useful;
- build tests;
- link/navigation checks;
- accessibility;
- SEO/static output smoke tests.

The site should remain simpler than the product applications.

---

# Contract Testing

Contracts exist between:

```text
mobile ↔ API
mobile ↔ feed GraphQL
producer ↔ Kafka consumer
API ↔ provider
worker ↔ provider
```

Contracts should be testable independently.

---

# Shared Runtime Schemas

Where `packages/contracts` defines schemas, tests should ensure:

- runtime validation;
- generated/inferred types align;
- backwards-compatible fixtures pass.

---

# Consumer-Driven Contract Tests

Use consumer-driven tests when independently deployed consumers create meaningful compatibility risk.

Likely candidates:

- Integration Events;
- GraphQL schema/client;
- REST mobile contracts.

A heavyweight contract platform is optional.

---

# Provider Contract Tests

Provider integrations should test against:

- documented sandbox;
- recorded contract fixtures;
- local fake with strict schema.

Do not rely only on mocked happy paths.

---

# End-to-End Tests

Full E2E tests should cover only the most critical golden paths.

They are expensive and more failure-prone.

Examples:

```text
Moment creation → event → projection → Timeline query

privacy change → projection/cache/media convergence

Reaction → notification → deep link

upload → processing → Moment depth
```

---

# Golden Path: Moment Creation

Test:

```text
1. authenticated User sends CreateMoment
2. API commits authoritative state
3. event publishes
4. projection writes ClickHouse
5. feed query returns Moment in correct occurrence-time position
```

---

# Golden Path: Privacy Change

Test:

```text
1. Moment public
2. Viewer can see it
3. owner changes to private
4. authoritative state changes
5. projection/cache converges
6. Viewer can no longer see Timeline/media/deep link
```

---

# Golden Path: Historical Backfill

Test:

```text
1. create Moment with historical occurrence time
2. projection consumes event
3. Timeline inserts at historical position
4. cursor navigation remains valid
```

---

# Golden Path: Media

Test:

```text
register
upload
finalize
process
ready
associate
project
serve
```

---

# Golden Path: Notification

Test:

```text
source event
notification creation
delivery intent
mobile open
mark read
reauthorized deep link
```

---

# Performance Tests

Performance tests should cover:

- latency;
- throughput;
- saturation;
- payload size;
- memory;
- queue lag.

---

# Load Test Scenarios

Representative mixes should include:

- Timeline scroll;
- temporal zoom;
- historical jumps;
- Moment depth;
- Reactions;
- Comments;
- uploads;
- notification reads.

---

# Dataset Scale

Performance tests should use non-trivial historical datasets.

Uniform tiny fixtures hide:

- sort-key problems;
- ClickHouse scans;
- cursor issues;
- hotspot behavior.

---

# Hotspot Tests

Include:

- viral Moment;
- highly active User;
- dense Real-World Event;
- large historical Location;
- large Moment media collection.

---

# Backfill Performance Tests

Simulate large historical ingestion while live traffic continues.

Verify:

- projection lag;
- priority isolation;
- API/feed health.

---

# Kafka Catch-Up Tests

Stop a consumer, produce backlog, restart, and measure catch-up.

---

# Projection Rebuild Tests

Run rebuild while live projection continues.

Verify:

- bounded resource use;
- correct convergence;
- safe reader cutover.

---

# Media Load Tests

Measure:

- concurrent uploads;
- processing backlog;
- transcode throughput;
- CDN delivery;
- object-storage behavior.

---

# Failure Testing

Failure testing verifies behavior under dependency outages.

Examples:

- EventStoreDB unavailable;
- PostgreSQL unavailable;
- ClickHouse unavailable;
- Kafka unavailable;
- object storage unavailable;
- push/email provider unavailable;
- transcoder unavailable.

---

# Failure Expectations

Tests should verify:

- safe errors;
- no corruption;
- bounded retries;
- no retry storms;
- health/readiness changes;
- alerts/telemetry.

---

# Chaos Testing

Chaos testing may be introduced after:

- basic integration coverage;
- observability;
- runbooks;
- staging environment

are mature.

It is not a substitute for deterministic failure tests.

---

# Migration Tests

Every database migration should be tested from the prior supported schema.

Verify:

- migration applies;
- application compatibility;
- rollback/forward strategy;
- backfill behavior.

---

# Expand/Contract Tests

For rolling migrations:

```text
old code + expanded schema
new code + expanded schema
```

should both work during overlap.

---

# ClickHouse Migration Tests

For side-by-side projection versions:

- v2 table creates;
- replay completes;
- query results validate;
- switch works;
- old v1 remains available until retirement.

---

# Event Compatibility Tests

New code should deserialize historical event fixtures.

Maintain fixtures for old persisted versions.

---

# Mobile Compatibility Tests

Backend should be tested against supported older client contract versions where practical.

At minimum, contract fixtures should ensure old request/response shapes remain valid during support window.

---

# Test Data Strategy

Test data should be:

- synthetic;
- deterministic;
- privacy-safe;
- representative.

Do not use copied production User data as default test fixtures.

---

# Builders / Factories

Use test builders for complex domain objects/events.

Builders should provide sensible defaults while making important semantics explicit.

Avoid giant unreadable object literals everywhere.

---

# Golden Fixtures

Stable fixtures are useful for:

- old event versions;
- GraphQL contracts;
- cursor versions;
- provider callbacks;
- media metadata.

---

# Time in Tests

Time should be injectable or controlled.

Avoid tests that depend on wall-clock timing.

Use deterministic clocks for:

- Session expiration;
- notification aggregation;
- retention;
- temporal queries.

---

# Randomness in Tests

Random IDs may be generated, but semantic random behavior should use deterministic seeds where reproducibility matters.

---

# Test Isolation

Tests must not depend on execution order.

Integration tests should isolate:

- schema/database;
- topic/group;
- object prefix;
- User/entity IDs.

---

# Parallelism

Fast unit tests should run in parallel.

Integration tests may parallelize only when infrastructure isolation is safe.

---

# Flaky Tests

Flaky tests are defects.

A flaky test should be:

- investigated;
- fixed;
- quarantined temporarily only with explicit ownership.

Do not normalize rerunning CI until green as a strategy.

---

# Async Timing Flakes

Avoid arbitrary sleep-based assertions.

Prefer polling with bounded timeout against observable state.

---

# Eventual Consistency Tests

Use:

```text
eventually(condition, timeout)
```

style helpers rather than fixed sleeps.

Timeouts should be generous enough for CI but failures should show diagnostic state.

---

# Test Timeouts

Every asynchronous integration/E2E test needs a timeout.

Hung tests should fail with diagnostics.

---

# CI Test Tiers

Recommended CI tiers:

## Pull request

- lint;
- typecheck;
- unit tests;
- focused integration tests;
- contract tests;
- security/static checks.

## Main branch / pre-deploy

- broader integration suite;
- datastore/message tests;
- migration tests;
- critical E2E.

## Scheduled / release

- load tests;
- extended security tests;
- longer replay/rebuild tests;
- provider sandbox tests.

---

# Changed-Area Testing

The monorepo may use dependency-aware task execution to run only affected tests where safe.

However, critical shared-contract changes should trigger broad consumers.

---

# Shared Package Changes

Changes to:

```text
packages/contracts
packages/config
packages/api-client
```

may require cross-application test expansion.

---

# CI Infrastructure

CI should use version-pinned infrastructure services matching production major versions as closely as practical.

---

# Test Reporting

CI should provide:

- failed test;
- category;
- logs;
- relevant trace/diagnostics;
- artifact/screenshot for UI E2E where useful.

---

# Coverage

Code coverage is a diagnostic signal.

It is not a quality target by itself.

Use coverage to find untested risk, not to incentivize meaningless tests.

---

# Critical Path Coverage

Critical code deserves deliberate coverage even if overall percentage is lower.

Examples:

- auth;
- authorization;
- privacy;
- deletion;
- projections;
- cursor logic;
- media validation.

---

# Mutation Testing

Mutation testing may be useful later for high-risk pure logic.

It is not a day-one requirement.

---

# Snapshot Tests

UI/schema snapshot tests can be useful sparingly.

Avoid giant snapshots that obscure semantic changes.

Prefer explicit assertions for important behavior.

---

# Security Regression

Every confirmed vulnerability should produce regression coverage where technically feasible.

---

# Production Verification

Post-deploy smoke tests and telemetry validate production behavior.

Production is not the primary test environment.

---

# Synthetic Monitoring

Synthetic checks can continuously verify safe public/controlled flows.

They complement tests.

---

# Manual Testing

Some behavior requires human verification:

- accessibility;
- media quality;
- animation/gesture feel;
- edge device behavior;
- moderation workflows.

Manual testing should not replace repeatable automation for deterministic logic.

---

# Day-One Testing Requirements

Before launch, Chronologity must implement:

- colocated unit tests;
- aggregate Given/When/Then tests;
- event schema/upcaster tests;
- EventStoreDB integration tests;
- PostgreSQL integration tests;
- Kafka integration tests;
- ClickHouse integration tests;
- projection replay tests;
- Timeline ordering/cursor tests;
- temporal zoom/historical jump tests;
- feed authorization tests;
- API auth/authorization tests;
- IDOR tests;
- media validation/processing tests;
- notification generation/dedup tests;
- privacy propagation/replay tests;
- log-redaction tests;
- migration tests;
- critical mobile E2E flows;
- critical backend E2E golden paths;
- load tests for Timeline/media/message paths;
- CI tiering;
- flake ownership.

---

# Recommended Initial Test Stack

The exact libraries should match the codebase, but the recommended shape is:

```text
TypeScript unit/integration
    → Vitest

API
    → Fastify inject + real integration dependencies

Infrastructure
    → ephemeral containers / test instances

Mobile
    → React Native Testing Library
    → platform E2E tool selected during mobile implementation

Web
    → component/build/accessibility tests

Load
    → dedicated load-testing tool

Security
    → automated static/dependency scans + targeted dynamic tests
```

Do not choose tools only for popularity; choose them for fit with the established stack.

---

# Open Architectural Questions

## Infrastructure Test Tooling

- Testcontainers?
- Docker Compose per suite?
- shared CI service containers?
- Recommended: isolated ephemeral infrastructure where practical.

## EventStoreDB

- Which test image/version?
- How are subscriptions/checkpoints isolated between tests?

## Kafka

- Real Kafka or a lighter compatible broker in local tests?
- Recommendation: real Kafka semantics for integration suite.
- How are topic/group names isolated?

## ClickHouse

- How large should integration fixtures be?
- Separate scale dataset for performance suite?

## Mobile E2E

- Maestro?
- Detox?
- another tool?
- Which works best with Expo and required native capabilities?

## Provider Tests

- Which provider sandboxes are available?
- Which integrations require strict local fakes because sandbox behavior is unreliable?

## Load Testing

- k6?
- Gatling?
- Artillery?
- another tool?
- Which environments run large tests?

## CI Runtime

- Which suites run on every PR?
- How long may PR checks take?
- How do we keep real-infrastructure tests fast enough?

## Coverage

- Any minimum thresholds?
- Recommended: avoid arbitrary global thresholds initially; require strong coverage for critical modules.

## Test Data

- Do we maintain a canonical historical-scale generator?
- Recommended: yes for ClickHouse/feed/performance tests.

## Contract Tests

- Do we use generated GraphQL schema checks only?
- Consumer-driven contract framework?
- Recommended: start lightweight with schemas/fixtures and expand if independent deployments create pain.

---

# Architectural Invariants

1. Testing validates architecture at real failure boundaries.
2. Unit tests are numerous, fast, deterministic, and local.
3. Infrastructure semantics are tested with real infrastructure where correctness depends on them.
4. EventStoreDB expected-version behavior is not trusted from mocks alone.
5. Kafka partition/group/offset semantics are integration tested.
6. PostgreSQL constraints/transactions are integration tested.
7. ClickHouse ordering/update semantics are integration tested.
8. Tests remain close to owned code where practical.
9. Cross-system harnesses are shared rather than duplicated.
10. Aggregate logic is testable without EventStoreDB.
11. Event-sourced aggregates have reconstruction tests.
12. Old persisted event versions have compatibility fixtures.
13. Event upcasters are deterministic and tested.
14. Command tests cover authorization, invariants, persistence, idempotency, and concurrency.
15. Query tests verify no mutation.
16. Durable consumers are tested with duplicate delivery.
17. Retry behavior is bounded and tested.
18. Projection replay is directly tested.
19. Privacy-safe replay is directly tested.
20. Projection versions are tested side by side.
21. Timeline ordering uses explicit tests.
22. Backfilled history is a required test case.
23. Cursor behavior is tested bidirectionally.
24. Historical jumps test inaccessible/deleted targets.
25. Temporal zoom tests dense and sparse history.
26. Feed GraphQL tests Viewer authorization comprehensively.
27. N+1 behavior is tested/observed.
28. Viewer-sensitive DataLoader caches are isolated per request.
29. API routes test schema, authentication, authorization, and error contracts.
30. Every resource class receives IDOR negative tests.
31. Privileged operations receive negative role tests.
32. Media validation treats files as adversarial input.
33. The 90-second video rule has server-side tests.
34. Unlimited media semantics are tested without unbounded payloads.
35. Notification generation is idempotent.
36. Notification aggregation concurrency is tested.
37. Notification deep links reauthorize in tests.
38. Cache tests validate Viewer separation.
39. Redis integration tests are required only if Redis becomes canonical.
40. Privacy changes are tested across downstream exposure surfaces.
41. Account deletion is tested as a cross-store workflow.
42. Log redaction has automated tests.
43. Runtime credential least privilege is tested where practical.
44. Mobile security-sensitive storage/flows receive integration/device testing.
45. Full E2E is reserved for critical golden paths.
46. Load tests use realistic non-uniform historical datasets.
47. Backfill and catch-up performance are tested.
48. Dependency outage behavior is tested deterministically.
49. Chaos testing comes after baseline failure testing and observability.
50. Migrations are tested from prior supported schemas.
51. Rolling expand/contract compatibility is tested.
52. Client/server contract compatibility accounts for old mobile versions.
53. Test data is synthetic/privacy-safe by default.
54. Time-dependent tests use controlled time.
55. Integration tests do not depend on execution order.
56. Flaky tests are treated as defects.
57. Eventual-consistency tests use bounded polling rather than arbitrary sleeps.
58. CI separates fast PR tests from heavier scheduled/release suites.
59. Shared contract changes trigger broad relevant tests.
60. Coverage is a diagnostic, not a vanity metric.
61. Security vulnerabilities produce regression tests where feasible.
62. Production smoke checks complement but do not replace pre-production tests.
63. Accessibility includes manual validation in addition to automation.
64. Architecture documentation changes when test guarantees or canonical tooling change.

---

# Guiding Principle

When deciding how to test a Chronologity behavior, ask:

> **What real boundary could make this behavior wrong in production, and what is the smallest test that exercises that boundary with enough realism to prove the guarantee we care about?**

Chronologity's test suite should be fast enough to support development, realistic enough to catch infrastructure failures, and rigorous enough to protect chronology, privacy, security, and replayability.
