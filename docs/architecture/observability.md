# Chronologity Observability Architecture

## Purpose

This document defines the observability architecture for Chronologity.

Observability must allow engineers and operators to understand the behavior of Chronologity across:

- public API requests;
- authentication and authorization;
- authoritative commands;
- EventStoreDB;
- Kafka;
- projection workers;
- PostgreSQL;
- ClickHouse;
- feed-aggregator GraphQL;
- media upload and processing;
- notifications;
- privacy propagation;
- security-sensitive operations;
- caches;
- external providers;
- mobile-facing failures.

The goal is not to collect as much telemetry as possible.

The goal is to make it possible to answer, quickly and reliably:

```text
What is happening?
Where is it happening?
Why is it happening?
Who or what is affected?
Is the system still correct?
What changed?
```

This document defines:

- logs;
- metrics;
- traces;
- correlation;
- audit telemetry;
- service health;
- SLOs and SLIs;
- projection and messaging lag;
- feed and Timeline observability;
- media observability;
- authentication/security observability;
- privacy observability;
- notification observability;
- cache observability;
- provider observability;
- dashboards;
- alerting;
- incident diagnostics;
- telemetry retention;
- privacy constraints;
- testing;
- and open architectural questions.

This document is grounded in the finalized product specifications and the established architecture documents for the API, authentication, authorization, CQRS, Event Sourcing, events, messaging, projections, data storage, Timeline, feed aggregator, media, notifications, caching, privacy, and security.

---

# Core Principle

Observability exists to explain system behavior.

The governing rule is:

> **Telemetry should make correctness, latency, failure, and propagation visible without becoming a second database of private User data.**

Chronologity must be observable without being invasive.

---

# Observability Pillars

Chronologity uses the standard three primary telemetry classes:

```text
logs
metrics
traces
```

plus:

```text
audit records
```

for privileged/security-sensitive actions.

These have different purposes.

---

# Logs

Logs explain discrete application and operational events.

Good logs answer:

- what operation occurred;
- what component handled it;
- what identifiers were involved;
- whether it succeeded;
- why it failed.

Logs should be structured.

---

# Metrics

Metrics explain system behavior over time.

They are best for:

- rates;
- latencies;
- counts;
- saturation;
- lag;
- error ratios;
- capacity.

Metrics should avoid high-cardinality entity identifiers.

---

# Traces

Traces connect work across distributed boundaries.

They are best for understanding:

```text
request
    ↓
command
    ↓
event
    ↓
Kafka
    ↓
projection
    ↓
query
```

or:

```text
upload
    ↓
object storage
    ↓
processing
    ↓
projection
    ↓
delivery
```

---

# Audit Records

Audit records are not ordinary logs.

They exist for actions such as:

- role assignment/removal;
- privileged moderation;
- account-security changes;
- sensitive-data access;
- deletion/privacy overrides;
- break-glass operations.

Audit records should have stronger retention/integrity semantics than general logs.

---

# Correlation Model

Chronologity should propagate stable correlation context across major boundaries.

Potential identifiers include:

```text
traceId
correlationId
causationId
requestId
commandId
eventId
messageId
```

These are not interchangeable.

---

# Request ID

A request ID identifies one inbound HTTP/GraphQL request.

It is useful for:

- log grouping;
- support/debugging;
- client/server correlation.

A request ID may also participate in trace context.

---

# Trace ID

A trace ID identifies one distributed trace.

It should propagate through:

```text
HTTP
command
Domain Event metadata where appropriate
Kafka headers
consumer
projection
downstream calls
```

---

# Correlation ID

A Correlation ID groups related operations belonging to one broader workflow.

Example:

```text
CreateMoment request
    ↓
MomentCreated
    ↓
Timeline projection
    ↓
notification generation
```

---

# Causation ID

A Causation ID identifies the immediate cause of an event/message.

It helps distinguish:

```text
same workflow
```

from:

```text
direct causal predecessor
```

---

# Identifier Logging Rules

Safe telemetry may include:

- User ID;
- Moment ID;
- Upload ID;
- Notification ID;
- aggregate ID;
- event/message ID.

However, logs should avoid unnecessary high-cardinality duplication.

Sensitive raw values should not be logged.

---

# Sensitive Logging Prohibition

Logs must not contain by default:

- passwords;
- access tokens;
- refresh tokens;
- recovery codes;
- OAuth secrets;
- signed media URLs;
- raw exact GPS;
- private media bytes;
- raw private captions;
- full moderation evidence;
- device push tokens;
- full provider webhook payloads.

---

# Structured Logging

Logs should use structured fields.

Example:

```json
{
  "level": "info",
  "service": "api",
  "operation": "create-moment",
  "requestId": "...",
  "traceId": "...",
  "userId": "...",
  "momentId": "...",
  "durationMs": 42,
  "result": "success"
}
```

Avoid relying on unstructured prose parsing.

---

# Log Levels

Recommended semantics:

```text
debug
    → detailed development/diagnostic context

info
    → normal significant operation

warn
    → unexpected/recoverable condition

error
    → operation/system failure

fatal
    → process cannot continue safely
```

Do not use `error` for expected authorization denials.

---

# Error Classification

Errors should carry stable internal classification.

Examples:

```text
AUTHENTICATION_FAILED
AUTHORIZATION_DENIED
CONCURRENCY_CONFLICT
PROJECTION_LAG
MEDIA_VALIDATION_FAILED
PROVIDER_UNAVAILABLE
CLICKHOUSE_QUERY_TIMEOUT
```

Stable error categories improve:

- metrics;
- dashboards;
- alerting;
- incident analysis.

---

# Metrics Naming

Metric names should be stable and semantic.

Potential examples:

```text
chronologity_api_requests_total
chronologity_api_request_duration_seconds
chronologity_kafka_consumer_lag
chronologity_projection_lag_seconds
chronologity_feed_query_duration_seconds
chronologity_media_processing_duration_seconds
```

Exact exporter syntax depends on tooling.

---

# High Cardinality

Do not use metric labels such as:

```text
userId
momentId
eventId
requestId
```

These belong in logs/traces.

Metrics should use bounded dimensions such as:

```text
service
operation
status
eventType
projection
consumerGroup
provider
```

---

# Distributed Tracing

Distributed tracing should cover cross-component workflows.

At minimum, trace propagation should work across:

- API HTTP;
- feed GraphQL;
- PostgreSQL;
- EventStoreDB;
- Kafka producer/consumer;
- ClickHouse;
- external provider calls;
- media processing.

---

# Trace Sampling

Trace sampling should balance:

- cost;
- privacy;
- diagnostic usefulness.

Potential policy:

```text
low baseline sample
+
higher sample for errors
+
higher sample for slow requests
+
targeted temporary sampling during incident
```

---

# Trace Payloads

Do not place:

- full request bodies;
- raw GraphQL variables;
- event payloads;
- media metadata

into spans by default.

Use IDs and safe dimensions.

---

# OpenTelemetry

OpenTelemetry is a strong fit for Chronologity because it provides vendor-neutral instrumentation for:

- traces;
- metrics;
- logs integration/context.

The exact backend remains an infrastructure choice.

---

# API Observability

`apps/api` should expose:

- request count;
- request latency;
- error rate;
- route/operation;
- authentication failures;
- authorization denials;
- command duration;
- EventStoreDB append latency;
- PostgreSQL latency;
- external provider latency.

---

# Command Observability

Every significant command should be observable.

Potential dimensions:

```text
command type
result
duration
retry count
concurrency conflict
idempotency outcome
```

---

# Concurrency Conflicts

Optimistic concurrency conflicts should be metrics, not just logs.

Useful metric:

```text
conflicts by aggregate type / command
```

An unexpected spike may indicate:

- aggregate hotspot;
- retry bug;
- workflow issue.

---

# EventStoreDB Observability

Important signals:

- append latency;
- append failure rate;
- stream read latency;
- concurrency conflicts;
- subscription lag;
- subscription disconnects;
- storage growth;
- node/cluster health.

---

# Event Publication Observability

The EventStoreDB→Kafka publication path must expose:

- source checkpoint;
- last published source position;
- publication throughput;
- publication retries;
- publication failures;
- duplicate publications where detectable;
- unsupported event versions.

---

# Kafka Observability

Important Kafka signals:

- producer throughput;
- producer error/retry rate;
- consumer throughput;
- consumer lag;
- rebalance frequency;
- processing latency;
- quarantined messages;
- poison events;
- unsupported schema versions.

---

# Consumer Lag

Lag is not one uniform concern.

Different consumers require different severity thresholds.

Examples:

```text
authorization/privacy/moderation
    → security-sensitive

Timeline projection
    → product-freshness sensitive

notifications
    → experience sensitive

analytics
    → low urgency
```

---

# Projection Observability

Every projection should expose:

- projection name/version;
- current source position;
- source target position;
- lag in events;
- lag in time;
- events/sec;
- write latency;
- retries;
- quarantine count;
- rebuild state.

---

# Projection Freshness

Projection freshness should be measurable independently from cache age.

Useful model:

```text
authoritative event time
        ↓
projection applied time
        ↓
read served time
```

---

# Rebuild Observability

Projection rebuild dashboards should expose:

- projection/version;
- start time;
- current position;
- target position;
- throughput;
- estimated remaining work where meaningful;
- errors;
- paused/running/completed state.

---

# PostgreSQL Observability

Important signals:

- connection pool usage;
- query latency;
- slow queries;
- transaction failures;
- deadlocks;
- lock wait;
- table/index growth;
- replication lag if replicas exist.

---

# ClickHouse Observability

Important signals:

- query latency;
- rows scanned;
- bytes scanned;
- insert throughput;
- merge backlog;
- mutation backlog;
- query timeout;
- projection lag;
- storage growth.

---

# Feed Aggregator Observability

`apps/feed-aggregator` should expose:

- GraphQL request count;
- operation name;
- query duration;
- Timeline slice latency;
- temporal zoom latency;
- historical jump latency;
- Moment depth latency;
- ClickHouse latency;
- DataLoader batch size;
- cache hit rate;
- eligibility filtering ratio;
- over-fetch iterations;
- query timeout;
- GraphQL complexity rejection.

---

# Timeline Observability

Timeline-specific telemetry should answer:

- are slices loading quickly;
- are backfilled Moments appearing;
- are historical jumps resolving;
- is temporal zoom responsive;
- is authorization filtering expensive;
- are cursor errors rising.

---

# Cursor Error Metrics

Track:

```text
invalid
expired/unsupported
decode failure
projection-version mismatch
```

without logging raw cursor contents.

---

# Historical Jump Diagnostics

A historical jump trace should include safe metadata such as:

- target type;
- resolution result;
- query latency;
- authorization result;
- surrounding-slice latency.

---

# Temporal Zoom Diagnostics

Useful dimensions:

- scale;
- range width;
- rows scanned;
- aggregate source;
- latency.

---

# Media Observability

Media is a separate high-volume operational subsystem.

Track:

- upload registrations;
- upload success/failure;
- bytes uploaded;
- resumptions;
- finalize failures;
- metadata extraction latency;
- image processing latency;
- video transcode latency;
- queue depth;
- retries;
- permanent validation failures;
- derivative generation;
- CDN delivery health;
- storage growth;
- egress cost signals.

---

# Media Processing Failure Categories

Classify failures such as:

```text
INVALID_MEDIA
VIDEO_TOO_LONG
UNSUPPORTED_CODEC
TRANSCODER_UNAVAILABLE
STORAGE_TIMEOUT
METADATA_PARSE_FAILED
PROCESSING_TIMEOUT
```

This makes remediation actionable.

---

# Media Queue Health

A queue can be unhealthy even if workers are running.

Track:

- oldest pending job age;
- queue depth;
- processing throughput;
- retry backlog.

---

# CDN Observability

Useful CDN metrics:

- hit ratio;
- origin requests;
- egress;
- 4xx/5xx;
- signed-access failures;
- purge latency.

---

# Authentication Observability

Track:

- login attempts;
- login success/failure;
- refresh success/failure;
- Session creation;
- Session revocation;
- refresh-token reuse detection;
- MFA challenges;
- recovery activity;
- OAuth callback failures.

---

# Authentication Privacy

Authentication metrics/logs should not expose raw email addresses unnecessarily.

Use pseudonymous account/User identifiers where possible.

---

# Authorization Observability

Track:

- permission check outcomes;
- denied privileged operations;
- role changes;
- current-state fallback checks;
- cache hit/miss if authorization cache exists;
- authorization projection lag.

---

# Authorization Denials

Ordinary expected denials are generally not application errors.

However, patterns matter.

A spike in:

```text
admin endpoint denied
```

may indicate probing or a client bug.

---

# Privileged Operation Monitoring

High-risk actions should generate:

- audit record;
- structured log;
- metric;
- trace.

Examples:

- role assignment;
- account suspension;
- deletion override;
- exact sensitive-data access.

---

# Privacy Observability

Privacy propagation must be observable.

Track:

- visibility-change propagation lag;
- block propagation lag;
- Search removal lag;
- Timeline eligibility update lag;
- CDN invalidation lag;
- deletion workflow duration;
- deletion failures;
- privacy cache invalidation failures.

---

# Privacy Convergence

For a privacy change, operators should be able to answer:

```text
Has API authority changed?
Has projection converged?
Has Search converged?
Has media delivery converged?
Have caches invalidated?
```

---

# Deletion Workflow Observability

Deletion should have state:

```text
requested
in-progress
partially-complete
completed
failed
```

Track each subsystem step.

---

# Security Observability

Security telemetry includes:

- suspicious login patterns;
- Session reuse;
- callback signature failures;
- privileged access denials;
- role changes;
- rate-limit triggers;
- malicious upload rejection;
- secret/config failures;
- unusual export/delete activity.

---

# Security Alerts

High-severity alerts must be actionable.

Each should have:

- owner;
- severity;
- runbook;
- expected response time.

---

# Notification Observability

Track:

- notification candidates;
- notifications created;
- suppressed;
- aggregated;
- deduplicated;
- unread count queries;
- push requests;
- push success/failure;
- invalid tokens;
- email delivery;
- deep-link failures;
- generation lag.

---

# Notification Delivery Lag

Delivery timing should be measurable separately from notification creation.

```text
source event
    ↓
notification created
    ↓
delivery requested
    ↓
provider accepted
```

---

# Cache Observability

Track per cache:

- hit rate;
- miss rate;
- latency;
- error rate;
- eviction;
- memory;
- invalidation;
- invalidation failure;
- fallback load.

---

# Cache Age

For sensitive caches, observe:

- entry age;
- version/epoch;
- invalidation lag.

---

# External Provider Observability

Each provider adapter should expose:

- request count;
- latency;
- error rate;
- retry rate;
- quota/rate-limit response;
- provider-specific failure category.

---

# Provider Independence

Dashboards should use provider-neutral service concepts where possible.

Example:

```text
push delivery
```

rather than tying all dashboards to one vendor name.

---

# Health Checks

Chronologity should distinguish:

```text
liveness
readiness
dependency status
```

---

# Liveness

Liveness answers:

```text
Is the process alive enough to continue?
```

A dependency outage should not always fail liveness.

---

# Readiness

Readiness answers:

```text
Can this process safely serve its responsibility?
```

Examples:

```text
API
    → cannot safely perform authoritative writes if EventStoreDB is unavailable

feed aggregator
    → cannot serve Timeline if ClickHouse unavailable

projection worker
    → not healthy if checkpoint is permanently stalled
```

---

# Worker Health

Worker health should consider progress.

A process consuming zero events for hours while lag grows is not healthy.

---

# SLI

A Service Level Indicator is a measurable behavior.

Potential SLIs:

```text
API request success rate
API command latency
Timeline slice latency
historical jump success rate
projection freshness
media processing completion latency
notification generation latency
privacy propagation lag
```

---

# SLO

A Service Level Objective defines the target for an SLI.

Concrete SLO values should be set once:

- expected load;
- product UX;
- infrastructure capabilities

are known.

This architecture document defines the categories, not arbitrary numbers.

---

# Error Budgets

Once SLOs exist, error budgets can guide:

- release risk;
- reliability work;
- incident severity.

Do not introduce error-budget bureaucracy before the measurements are meaningful.

---

# Correctness SLOs

Some system properties are more important than latency.

Examples:

- no unauthorized private content exposure;
- role revocation propagation;
- moderation restriction propagation;
- no duplicate authoritative command effect.

These may be treated as correctness/security objectives rather than traditional latency SLOs.

---

# Dashboard Strategy

Chronologity should have layered dashboards.

Potential layers:

```text
system overview
API
messaging
projections
feed/Timeline
media
auth/security
privacy
notifications
datastores
external providers
```

---

# System Overview Dashboard

Should answer:

- Are users able to use the product?
- Are writes succeeding?
- Are Timeline reads succeeding?
- Is projection lag healthy?
- Are Kafka consumers healthy?
- Is media processing healthy?
- Are security/privacy systems converging?

---

# API Dashboard

Potential panels:

- request rate;
- latency;
- error rate;
- command failure;
- EventStoreDB latency;
- PostgreSQL latency;
- auth failures;
- authorization denials.

---

# Messaging Dashboard

Potential panels:

- producer errors;
- consumer lag;
- processing throughput;
- quarantined events;
- rebalance rate;
- topic/group health.

---

# Projection Dashboard

Potential panels:

- lag by projection;
- processing rate;
- failures;
- rebuild progress;
- ClickHouse/PostgreSQL write latency.

---

# Timeline Dashboard

Potential panels:

- Timeline head latency;
- slice latency;
- temporal zoom;
- jump latency;
- rows scanned;
- cursor errors;
- eligibility filter rate;
- cache hit rate.

---

# Media Dashboard

Potential panels:

- uploads/min;
- finalize failure;
- queue depth;
- oldest pending age;
- transcode time;
- failure categories;
- storage growth;
- CDN hit ratio.

---

# Security Dashboard

Potential panels:

- login failures;
- refresh reuse;
- privileged denials;
- role changes;
- rate-limit events;
- callback verification failures;
- suspicious upload rejections.

---

# Privacy Dashboard

Potential panels:

- privacy-change lag;
- block lag;
- deletion workflow failures;
- Search removal lag;
- CDN invalidation failures;
- privacy cache invalidation failures.

---

# Alerting Principles

Alerts should be:

- actionable;
- symptom-oriented where possible;
- severity-based;
- owned;
- linked to runbooks.

Avoid alerts for every metric threshold.

---

# Alert Fatigue

An alert that is routinely ignored is worse than no alert.

Warning-level telemetry may remain dashboard-only until it represents a real intervention need.

---

# Paging Versus Ticket

Potential categories:

```text
page
    → immediate user/security impact

ticket
    → degradation requiring scheduled work

dashboard
    → informational trend
```

---

# Example Paging Conditions

Potential examples:

- API authoritative write failure spike;
- feed Timeline availability collapse;
- privacy/moderation consumer stalled;
- role revocation projection severely delayed;
- media pipeline fully stalled;
- critical provider outage;
- EventStoreDB unavailable;
- Kafka publication checkpoint stalled.

Concrete thresholds belong in operations docs.

---

# Runbooks

Every paging alert should have a runbook describing:

- impact;
- likely causes;
- diagnostic steps;
- mitigation;
- rollback/containment;
- escalation.

---

# Incident Correlation

During incidents, operators should be able to correlate:

```text
deployment
    ↓
metric change
    ↓
traces/logs
    ↓
affected workflow
```

Deployment markers should appear in dashboards.

---

# Deployment Telemetry

Record:

- deployment ID;
- git SHA;
- version;
- start/end;
- environment.

This supports change correlation.

---

# Feature Flag Telemetry

If feature flags are introduced, traces/logs may include safe flag/version context.

Do not use high-cardinality dynamic flag payloads.

---

# Configuration Version

Projection/scoring/significance algorithms may depend on configuration.

Derived telemetry should record:

- algorithm version;
- config version/hash where meaningful.

---

# Audit Versus Telemetry Retention

Audit data may require longer retention than ordinary logs/traces.

Telemetry retention should be cost- and privacy-conscious.

---

# Logs Retention

General application logs should have bounded retention.

Long-term history belongs in authoritative stores, not indefinite logs.

---

# Trace Retention

Traces are high-volume.

Use bounded retention and sampling.

---

# Metric Retention

Metrics can retain longer aggregate trends without preserving raw User data.

---

# Audit Retention

Audit retention should be driven by:

- security;
- operational need;
- policy/legal requirements.

---

# Telemetry Data Classification

Telemetry should itself be classified.

Potentially:

```text
public operational
internal
sensitive
restricted
```

Most telemetry should remain internal.

---

# Access Control

Access to observability systems should follow least privilege.

Logs/traces can expose operational identifiers and sensitive metadata even when properly minimized.

---

# Production Log Access

Not every developer needs unrestricted production log access.

Access can be scoped by:

- environment;
- service;
- role;
- incident need.

---

# Telemetry Export

If telemetry is sent to third-party providers, apply:

- data minimization;
- retention controls;
- restricted API keys;
- privacy review.

---

# Error Reporting

Crash/error reporting should capture:

- error classification;
- stack;
- safe context.

It must scrub:

- secrets;
- tokens;
- private content;
- signed URLs.

---

# User-Facing Diagnostics

The client may receive a request/correlation ID in errors to help support/debugging.

Do not expose internal stack traces.

---

# Mobile Observability

The mobile app should collect enough telemetry to diagnose:

- crashes;
- upload failures;
- playback failures;
- GraphQL/REST failures;
- navigation errors.

Avoid invasive device fingerprinting or raw private content capture.

---

# Mobile Crash Reports

Crash reports should scrub:

- tokens;
- private media paths;
- sensitive User input.

---

# Client Performance

Useful mobile performance signals:

- Timeline render latency;
- scroll/jank;
- media startup;
- upload duration;
- app startup;
- memory usage.

These are product-quality signals and complement backend telemetry.

---

# Web Observability

The Gatsby site can use lightweight:

- availability;
- page performance;
- error reporting.

Avoid unnecessary third-party scripts.

---

# Synthetic Monitoring

Synthetic checks may verify:

- API health;
- authentication smoke flow;
- feed Timeline smoke query;
- media delivery;
- public web availability.

They should use dedicated test accounts/data.

---

# End-to-End Synthetic Flow

A production-safe synthetic flow may eventually verify:

```text
create test Moment
    ↓
projection
    ↓
feed query
    ↓
cleanup
```

This is powerful but must avoid polluting real historical data.

A separate staging environment may be more appropriate.

---

# Golden Trace

A canonical golden trace should cover:

```text
Mobile CreateMoment
    ↓
API authentication
    ↓
authorization
    ↓
command
    ↓
EventStoreDB append
    ↓
Kafka publication
    ↓
Timeline projection
    ↓
ClickHouse
    ↓
feed aggregator query
```

The trace should make each boundary identifiable.

---

# Golden Media Trace

```text
RegisterUpload
    ↓
object upload
    ↓
FinalizeUpload
    ↓
processing request
    ↓
metadata/transcode
    ↓
ready state
    ↓
projection
    ↓
media delivery
```

---

# Golden Privacy Trace

```text
visibility change
    ↓
authoritative commit
    ↓
event
    ↓
Timeline/Search/media/cache propagation
    ↓
convergence
```

This is especially important because privacy failures can be distributed.

---

# Observability Testing

Instrumentation should be tested.

Potential tests:

- trace context propagation;
- correlation IDs preserved through Kafka;
- sensitive field redaction;
- expected metrics emitted;
- health checks respond correctly;
- lag calculation works;
- audit record emitted for privileged action.

---

# Redaction Tests

Unit/integration tests should assert that:

```text
token
password
signedUrl
gps
pushToken
```

do not appear in logs.

---

# Alert Tests

Where feasible, staging/chaos tests should validate critical alerts.

Examples:

- stall projection consumer;
- fail provider;
- block ClickHouse;
- force media queue buildup.

---

# Chaos Testing

Controlled failure injection can validate:

- retries;
- alerts;
- degradation;
- recovery.

Do not introduce broad chaos testing before basic observability and runbooks exist.

---

# Day-One Observability Requirements

Before launch, Chronologity must define and implement:

- structured logs;
- request IDs;
- distributed tracing;
- trace propagation through Kafka;
- stable error classification;
- API metrics;
- EventStoreDB metrics;
- Kafka metrics;
- projection lag metrics;
- PostgreSQL metrics;
- ClickHouse metrics;
- feed/Timeline metrics;
- media metrics;
- authentication metrics;
- authorization metrics;
- privacy propagation metrics;
- notification metrics;
- cache metrics;
- provider metrics;
- liveness/readiness;
- critical dashboards;
- paging alerts;
- runbooks;
- deployment markers;
- telemetry redaction;
- telemetry retention;
- observability-system access control;
- instrumentation tests.

---

# Recommended Initial Observability Architecture

A vendor-neutral initial shape is:

```text
applications/workers
    ↓
OpenTelemetry instrumentation
    ├── traces
    ├── metrics
    └── log correlation
          ↓
observability backend(s)

structured application logs
    ↓
central log platform

privileged actions
    ↓
audit store
```

The exact backend should be chosen later based on hosting, cost, and operational preferences.

---

# Open Architectural Questions

## Backend

- Which observability vendor/platform?
- Datadog?
- Grafana stack?
- Honeycomb?
- New Relic?
- cloud-native tooling?
- Should logs, metrics, and traces use one vendor or separate systems?

## OpenTelemetry

- Adopt OpenTelemetry across Node.js applications/workers from day one?
- Recommended: yes.
- Which collector deployment model?

## Logs

- Which structured logger is canonical?
- Existing architecture references Winston in some historical decisions; should that remain canonical?
- JSON logs in production?
- What retention periods?

## Metrics

- Prometheus-compatible?
- vendor-native?
- Which cardinality rules are enforced in review/tooling?

## Tracing

- Sampling percentage?
- tail-based sampling?
- always retain errors?
- provider-call spans?

## Audit

- Where is the audit store?
- PostgreSQL append-only table initially?
- Separate store later?
- Retention and query access?

## SLOs

- What concrete latency/availability targets apply to:
  - API commands;
  - Timeline slices;
  - historical jumps;
  - temporal zoom;
  - media readiness;
  - privacy propagation;
  - notification generation?

## Projection Lag

- Should lag be measured by:
  - event count;
  - wall-clock delay;
  - both?
- Recommended: both.

## Security

- Which security detections feed the observability platform?
- Which require a dedicated SIEM later?
- Recommended default: centralized telemetry first, SIEM only when operational/compliance scale justifies it.

## Privacy

- What telemetry fields are classified as sensitive?
- Which IDs may appear in traces?
- What third-party telemetry processors are acceptable?

## Mobile

- Which crash/performance provider?
- Expo tooling?
- Sentry?
- another service?
- How is User context pseudonymized?

## Runbooks

- Where do runbooks live?
- `docs/operations/`?
- Should alerts link directly to canonical markdown runbooks?

---

# Architectural Invariants

1. Observability explains behavior; it does not define domain truth.
2. Logs, metrics, traces, and audit records are distinct telemetry classes.
3. Telemetry minimizes private User data.
4. Structured logging is the default.
5. Stable error classification is used across services.
6. High-cardinality identifiers do not become metric labels.
7. Trace context crosses distributed boundaries.
8. Correlation and causation identifiers retain distinct semantics.
9. Full request/event payloads are not added to traces by default.
10. API requests expose count, latency, and error telemetry.
11. Significant commands are observable by type/result/duration.
12. Optimistic concurrency conflicts are measurable.
13. EventStoreDB append/subscription behavior is observable.
14. EventStoreDB→Kafka publisher checkpoints are observable.
15. Kafka producer/consumer lag and errors are observable.
16. Consumer lag severity depends on consumer responsibility.
17. Every projection exposes position, lag, rate, and failure telemetry.
18. Projection rebuild progress is observable.
19. PostgreSQL pool/query/lock health is observable.
20. ClickHouse latency, scan volume, merge/mutation health are observable.
21. Feed aggregator exposes GraphQL operation performance.
22. Timeline slices, zoom, depth, and historical jumps have dedicated telemetry.
23. Cursor errors are measured without logging raw cursors.
24. Media upload, processing, queue, CDN, and storage health are observable.
25. Media failures use stable categories.
26. Authentication failures and Session security events are observable.
27. Authorization denials are not automatically treated as application errors.
28. Privileged operations emit audit and operational telemetry.
29. Privacy/block/deletion propagation lag is observable.
30. Privacy convergence can be evaluated across downstream systems.
31. Deletion workflows expose step-level state.
32. Security alerts are actionable and owned.
33. Notification creation and provider delivery are measured separately.
34. Cache hit/miss/invalidation/fallback behavior is observable.
35. External providers expose normalized latency/error telemetry.
36. Liveness and readiness are distinct.
37. Worker health includes progress, not merely process uptime.
38. SLO categories are defined before arbitrary target numbers.
39. Correctness/security objectives may be stricter than latency SLOs.
40. Dashboards are layered by system and responsibility.
41. System overview dashboards answer whether users can use the product.
42. Alerting favors symptoms/actionability over raw metric thresholds.
43. Paging alerts have runbooks.
44. Deployments are marked in telemetry.
45. Telemetry retention is bounded.
46. Audit retention may differ from general telemetry retention.
47. Observability systems themselves require access control.
48. Production telemetry access follows least privilege.
49. Third-party telemetry receives minimized data.
50. User-facing errors may include correlation IDs but not internal traces.
51. Mobile observability scrubs credentials/private content.
52. Synthetic monitoring uses dedicated safe test data.
53. Canonical golden flows should be traceable end-to-end.
54. Instrumentation and redaction are tested.
55. Critical alerts should be exercised before launch.
56. Chaos testing follows, rather than precedes, basic instrumentation and runbooks.
57. OpenTelemetry is preferred for vendor-neutral instrumentation.
58. Architecture documentation changes when observability guarantees or telemetry boundaries change.

---

# Guiding Principle

When adding telemetry, ask:

> **What concrete operational question will this signal answer, can we correlate it with the surrounding workflow, and are we collecting the minimum information necessary to answer that question safely?**

Observability should make Chronologity understandable under normal operation and failure without turning logs, traces, metrics, or dashboards into uncontrolled replicas of User data.
