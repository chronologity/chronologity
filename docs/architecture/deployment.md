# Chronologity Deployment Architecture

## Purpose

This document defines the deployment architecture for Chronologity.

Deployment architecture translates Chronologity's logical application and worker boundaries into independently deployable runtime units while preserving:

- security;
- availability;
- rollback safety;
- environment isolation;
- configuration consistency;
- observability;
- migration discipline;
- workload independence.

Chronologity's deployment model must support:

- `apps/api`;
- `apps/feed-aggregator`;
- `apps/mobile`;
- `apps/web`;
- API-owned worker processes;
- projection workers;
- media-processing workers;
- notification workers;
- event publishers;
- database migration jobs;
- infrastructure dependencies such as EventStoreDB, PostgreSQL, ClickHouse, Kafka, object storage, and CDN.

This document defines:

- deployable units;
- environment model;
- build artifacts;
- configuration and secrets;
- process topology;
- worker deployment;
- rolling deployment;
- rollback;
- health/readiness;
- migrations;
- feature flags;
- version skew;
- mobile/web deployment;
- infrastructure deployment;
- disaster recovery implications;
- CI/CD expectations;
- and open architectural questions.

This document is grounded in:

- `docs/architecture/overview.md`;
- `docs/architecture/principles.md`;
- `docs/architecture/monorepo.md`;
- `docs/architecture/api.md`;
- `docs/architecture/feed.md`;
- `docs/architecture/media.md`;
- `docs/architecture/notifications.md`;
- `docs/architecture/messaging.md`;
- `docs/architecture/projections.md`;
- `docs/architecture/data-storage.md`;
- `docs/architecture/caching.md`;
- `docs/architecture/security.md`;
- `docs/architecture/observability.md`;
- `docs/architecture/scalability.md`.

---

# Core Principle

Deployment boundaries should preserve logical architecture without forcing unnecessary service fragmentation.

The governing rule is:

> **Chronologity deploys independently where workload, availability, security, or release cadence requires independence—and keeps code ownership cohesive where separate deployment provides no concrete benefit.**

---

# Canonical Applications

The canonical monorepo contains:

```text
apps/
├── api/
├── feed-aggregator/
├── mobile/
└── web/
```

There is no separate admin application.

Administrative functions remain inside the consumer application and are protected through role-based authorization.

---

# Backend Runtime Units

The backend should initially deploy as a small number of runtime units derived from the existing applications.

Recommended starting units:

```text
api-http
feed-aggregator-http
event-publisher
postgres-projection-worker
clickhouse-timeline-projection-worker
media-worker
notification-worker
migration-job
```

These are deployment units.

They do not need to become separate source-code applications.

---

# API HTTP Process

The `api-http` deployment runs the public Fastify API.

It owns synchronous authoritative command handling and operational reads.

It should not run:

- heavy media processing;
- large projection rebuilds;
- long-running backfills;
- unbounded asynchronous jobs

inside the HTTP process.

---

# Feed Aggregator HTTP Process

The feed-aggregator deployment serves GraphQL Timeline/read traffic.

It should be:

- stateless;
- horizontally scalable;
- read-only with respect to domain authority;
- independently deployable from API HTTP.

---

# Worker Processes

Workers should run with entry points separate from the HTTP processes.

Examples:

```text
apps/api/src/workers/event-publisher.ts
apps/api/src/workers/postgres-projections.ts
apps/api/src/workers/clickhouse-projections.ts
apps/api/src/workers/media.ts
apps/api/src/workers/notifications.ts
```

Exact paths must match the canonical monorepo tree and should be finalized during implementation.

---

# Deployment Unit Versus Application

A deployable unit is not necessarily a top-level `apps/` directory.

Example:

```text
apps/api
    ├── api-http deployment
    ├── event-publisher deployment
    ├── projection-worker deployment
    └── notification-worker deployment
```

This is intentional.

It allows operational separation without source-tree fragmentation.

---

# Containerization

Backend services and workers should be packaged as container images unless the chosen hosting platform provides an equivalent immutable deployment artifact.

Containers should:

- be reproducible;
- run as non-root where practical;
- contain only required runtime files;
- use pinned base images;
- expose health endpoints where applicable.

---

# Image Strategy

A practical starting strategy is:

```text
one API code image
    ↓
different command/entrypoint
        ├── api-http
        ├── event-publisher
        ├── projection worker
        ├── media worker
        └── notification worker
```

This reduces build duplication.

If workloads later require substantially different dependencies or runtime images, split them deliberately.

---

# Feed Aggregator Image

`apps/feed-aggregator` should produce its own deployable image because it has a different runtime responsibility and dependency profile.

---

# Web Deployment

The Gatsby marketing site should deploy as static assets to a static hosting/CDN platform where possible.

It should not require backend container capacity merely to serve marketing pages.

---

# Mobile Deployment

The React Native Expo application follows app-store/mobile release workflows.

Mobile is fundamentally different from backend deployment because old client versions may remain active for long periods.

Therefore backend contracts must support version skew.

---

# Environment Model

Recommended environments:

```text
local
test/CI
staging
production
```

Additional ephemeral preview environments may be introduced where useful.

---

# Local Environment

Local development should provide the required infrastructure through containerized/dev tooling where practical:

- PostgreSQL;
- EventStoreDB;
- ClickHouse;
- Kafka;
- object-storage-compatible development service where needed.

Developers should not require production credentials.

---

# CI Environment

CI should run:

- unit tests;
- contract tests;
- integration tests;
- migration checks;
- static analysis;
- dependency/security checks;
- build verification.

Tests should use isolated ephemeral infrastructure where practical.

---

# Staging

Staging should resemble production architecture closely enough to validate:

- deployment;
- migrations;
- Kafka/EventStoreDB behavior;
- projections;
- object-storage workflow;
- provider integrations/sandboxes;
- observability;
- authorization.

It should not contain casually copied production data.

---

# Production

Production uses isolated:

- credentials;
- databases;
- Kafka topics/clusters/namespaces;
- buckets;
- provider configuration;
- observability access.

---

# Environment Isolation

No application should infer its environment from hostnames or arbitrary runtime behavior.

Environment identity should be explicit configuration.

---

# Configuration

Configuration should be injected at runtime.

Examples:

- datastore endpoints;
- Kafka brokers;
- topic names;
- object-storage settings;
- provider endpoints;
- feature flags;
- log level;
- timeouts;
- limits.

---

# Configuration Ownership

Configuration belongs to the deployable workload.

Shared defaults may live in:

```text
packages/config
```

but environment-specific values must remain outside source code.

---

# Configuration Validation

Every service/worker should validate required configuration at startup.

Misconfiguration should fail fast.

Avoid discovering missing critical environment variables only after serving traffic.

---

# Secrets

Secrets are injected from the deployment platform's secret-management mechanism.

Examples:

- DB credentials;
- Kafka credentials;
- EventStoreDB credentials;
- OAuth secrets;
- storage credentials;
- provider keys;
- signing keys.

Secrets must not be baked into container images.

---

# Secret Rotation

Deployment strategy must allow secret rotation without requiring broad code changes.

Where possible:

```text
new secret introduced
    ↓
deploy workloads supporting both
    ↓
switch active secret
    ↓
retire old secret
```

---

# Build Artifacts

Build artifacts should be immutable.

A deployment should reference:

- image digest;
- app version;
- git SHA;
- build ID.

Avoid deploying mutable `latest` tags as the only identity.

---

# Reproducibility

Given the same:

- source revision;
- lockfile;
- build configuration;

the build process should be reproducible enough for debugging and rollback.

---

# Version Metadata

Each running service should expose safe version metadata such as:

```text
service
version
git SHA
build ID
```

This may be surfaced through health/info endpoints or telemetry.

---

# CI/CD Pipeline

A typical backend pipeline:

```text
checkout
    ↓
install locked dependencies
    ↓
lint / typecheck
    ↓
unit tests
    ↓
integration tests
    ↓
security scans
    ↓
build image
    ↓
publish immutable artifact
    ↓
deploy staging
    ↓
smoke/verification
    ↓
promote to production
```

Exact approval gates depend on team maturity.

---

# Build Once, Promote

Prefer:

```text
build once
    ↓
promote same artifact
```

across staging and production.

Do not rebuild different binaries for each environment unless platform constraints require it.

---

# Deployment Strategy

Backend services should support rolling deployment by default.

A rolling deployment assumes temporary mixed versions.

Therefore:

- APIs must be backward compatible;
- event schemas must tolerate version skew;
- DB migrations must be rollout-safe;
- workers must understand overlapping contract versions.

---

# Rolling Deployment

A typical rollout:

```text
old replicas serving
    ↓
new replica starts
    ↓
readiness passes
    ↓
traffic shifts gradually
    ↓
old replica drains
```

---

# Readiness Before Traffic

A new instance should not receive traffic until:

- configuration validated;
- essential dependencies reachable;
- initialization completed;
- health/readiness checks pass.

---

# Graceful Shutdown

HTTP services should:

1. stop accepting new requests;
2. finish in-flight requests within a deadline;
3. close datastore connections;
4. stop telemetry exporters cleanly.

Workers should:

1. stop polling new work;
2. finish or safely abandon in-flight work;
3. checkpoint only completed work;
4. close Kafka/provider/datastore clients.

---

# Deployment Draining

Load balancers/orchestrators should allow graceful connection draining.

Abrupt termination increases:

- duplicate work;
- failed requests;
- consumer rebalance churn.

---

# Rollback

Every production deployment should have a rollback path.

Rollback may include:

```text
redeploy previous image
```

but database/event schema changes complicate rollback.

---

# Rollback Compatibility

A safe rollout should answer:

- Can old code read the new schema?
- Can new code read old data?
- Can consumers handle new event versions?
- Has a migration removed fields old code needs?

This is why expand/migrate/contract is preferred.

---

# Database Migrations

Database migration runs should be separate from normal application startup.

Do not let every API replica race to apply migrations.

---

# PostgreSQL Migration Strategy

Use:

```text
expand
    ↓
deploy compatible code
    ↓
backfill/migrate
    ↓
switch behavior
    ↓
contract later
```

for breaking changes.

---

# ClickHouse Migration Strategy

Material read-model changes should prefer:

```text
new table/projection version
    ↓
rebuild
    ↓
validate
    ↓
switch readers
    ↓
retire old
```

rather than destructive in-place mutation.

---

# EventStoreDB Migration Strategy

Persisted Domain Events are not migrated like tables.

Use:

- event versioning;
- upcasters;
- compatibility readers;
- exceptional controlled redaction/migration only when necessary.

---

# Migration Job Identity

Migration jobs should use a dedicated privileged datastore role.

Runtime application credentials should not automatically have schema-owner privileges.

---

# Migration Observability

Migration jobs should emit:

- migration version;
- start/end;
- result;
- rows affected/backfill progress where relevant.

---

# Backfill Deployment

Large backfills should run as explicit jobs/workers.

They must be:

- resumable;
- throttled;
- observable;
- isolated from interactive traffic.

---

# Projection Rebuild Deployment

Projection rebuilds should run using dedicated worker capacity.

They should not share API request-process connection pools/resources.

---

# Feature Flags

Feature flags may be useful for:

- staged rollout;
- risky features;
- switching projection versions;
- enabling new GraphQL fields/behavior;
- operational kill switches.

Flags are not a substitute for versioned contracts.

---

# Feature Flag Ownership

Flags should have:

- owner;
- purpose;
- default;
- expiry/removal plan.

Avoid permanent "temporary" flags.

---

# Kill Switches

High-risk external integrations or expensive features may have operational kill switches.

Examples:

- disable media processing provider;
- disable broad temporal zoom;
- disable a notification channel.

Kill switches must not disable authorization/privacy enforcement.

---

# Version Skew

Chronologity must tolerate version skew across:

- API replicas;
- feed-aggregator replicas;
- Kafka producers/consumers;
- projection workers;
- mobile clients.

---

# Mobile Version Skew

Mobile creates the longest-lived compatibility window.

Backend changes should be additive where possible.

Do not assume every User upgrades immediately.

---

# GraphQL Versioning

GraphQL should use additive schema evolution/deprecation rather than whole-version endpoint proliferation unless necessary.

---

# REST Versioning

REST contracts should similarly prefer compatible additions.

If a breaking API version is necessary, the migration path must support old mobile clients.

---

# Event Version Skew

New producers must not emit breaking Integration Event versions before consumers support them.

Rollout order matters.

---

# Worker Version Skew

Different worker versions may temporarily process messages concurrently.

Consumer logic must tolerate this or deployments must enforce safe sequencing.

---

# Deployment Order

When a change spans producer and consumer:

Recommended sequence:

```text
1. deploy consumers that understand old + new
2. deploy producer emitting new form
3. observe
4. retire old support later
```

---

# Projection Cutover

For new read-model versions:

```text
1. deploy projection v2 writer
2. rebuild v2
3. catch up live
4. validate
5. deploy reader capable of v2
6. switch read config
7. observe
8. retire v1 later
```

---

# Blue/Green Deployment

Blue/green may be useful for high-risk backend releases.

It is not required for every deployment.

Use when rollback speed or environment-level validation materially benefits.

---

# Canary Deployment

Canary deployment may be introduced when traffic scale warrants it.

Potential use:

- API changes;
- feed query changes;
- media delivery changes.

Canary metrics must be strong enough to compare safely.

---

# Mobile Rollout

Mobile releases may use:

- staged app-store rollout;
- Expo update mechanisms where appropriate;
- remote feature flags.

Any over-the-air update mechanism must respect platform rules and contract compatibility.

---

# Web Rollout

Static web deployments should be atomic where hosting platform supports it.

Rollback is typically switching to previous asset deployment.

---

# Infrastructure as Code

Production infrastructure should be defined through Infrastructure as Code.

Potential tools include:

- Terraform;
- Pulumi;
- cloud-native IaC.

The exact tool belongs in infrastructure decisions.

---

# Infrastructure Changes

Infrastructure changes should be reviewed and traceable like application changes.

Avoid undocumented console-only production configuration.

---

# Stateful Infrastructure

EventStoreDB, PostgreSQL, ClickHouse, and Kafka require careful deployment/upgrade planning.

Prefer managed services where operational burden reduction justifies cost.

---

# Managed Services

Managed infrastructure may reduce:

- patching;
- backups;
- failover operations;
- cluster management.

It does not eliminate:

- schema design;
- security configuration;
- capacity planning;
- cost management.

---

# EventStoreDB Deployment

Exact topology belongs in infrastructure documentation.

Requirements include:

- durable authoritative storage;
- backup;
- monitoring;
- secure client access;
- recovery procedures.

---

# PostgreSQL Deployment

Production should use:

- durable managed storage;
- backups/PITR where required;
- connection pooling;
- encryption;
- monitoring.

---

# ClickHouse Deployment

ClickHouse topology should support:

- Timeline query load;
- projection ingestion;
- eventual replication/scaling.

Initial topology can remain simple until measured load requires a cluster.

---

# Kafka Deployment

Kafka should use a reliable deployment appropriate to the expected workload.

Requirements:

- durable brokers;
- authenticated clients;
- encrypted transport;
- monitoring;
- retention policy;
- topic ACLs.

---

# Object Storage Deployment

Object storage should be managed/regionally durable.

Uploads should not depend on API node-local filesystem.

---

# CDN Deployment

CDN configuration is part of the media delivery infrastructure.

Changes affecting privacy or signed access should be treated as security-sensitive deployments.

---

# DNS

DNS changes should be controlled and low-risk.

Production hostnames should not be coupled to ephemeral workload identity.

---

# Certificates

TLS certificate issuance/renewal should be automated where possible.

Expiration should be monitored.

---

# Networking

Backend deployments should sit behind controlled ingress.

Datastores should not have unrestricted public ingress.

---

# Autoscaling

Deployment manifests/configuration should support workload-appropriate autoscaling.

Potential signals:

```text
API/feed
    → request concurrency, CPU/event-loop, latency

workers
    → Kafka lag, queue depth, oldest job age

media
    → queue depth, CPU/GPU
```

---

# Minimum Capacity

Autoscaling should preserve minimum replica counts where availability requires it.

A production service should not necessarily scale to zero.

---

# Maximum Capacity

Autoscaling requires upper bounds to prevent runaway cost or downstream overload.

---

# Resource Requests and Limits

Containerized workloads should define CPU/memory expectations.

Media workers may have very different limits from API/feed processes.

---

# Pod/Instance Disruption

Where orchestrator supports it, disruption budgets may protect minimum availability during:

- node maintenance;
- rolling deployment;
- infrastructure upgrades.

---

# Availability Zones

Production stateful/critical services should use multi-zone availability where provider architecture and cost justify it.

---

# Region Strategy

Recommended initial architecture:

```text
single primary region
+
multi-zone availability
+
global CDN/edge
+
tested backup/disaster recovery
```

Avoid active-active multi-region writes initially.

---

# Disaster Recovery

Deployment architecture must support recovery into a replacement environment/region.

Recovery order should prioritize:

```text
authoritative datastores
    ↓
secrets/config
    ↓
messaging
    ↓
API/workers
    ↓
critical projections
    ↓
feed
    ↓
lower-priority derived systems
```

---

# Restore Validation

A restored environment should verify:

- EventStoreDB continuity;
- PostgreSQL correctness;
- object-media availability;
- Kafka/subscription recovery;
- projection checkpoints;
- deletion/privacy state.

---

# Deployment Observability

Every deployment should appear in observability systems.

Record:

- service;
- environment;
- version;
- git SHA;
- deployment start/end;
- result.

---

# Deployment Health

After rollout, verify:

- error rate;
- latency;
- consumer lag;
- projection freshness;
- media queue health;
- authorization/privacy signals.

Deployment success is not merely "pods are running."

---

# Smoke Tests

Production/staging smoke tests may validate:

- API health;
- auth smoke flow;
- feed Timeline query;
- Kafka consumer progress;
- media delivery path;
- web availability.

Use safe dedicated test data/accounts.

---

# Release Gates

High-risk deployments may require gates based on:

- tests;
- migration status;
- security scans;
- staging smoke tests;
- projection readiness.

Keep gates proportionate to risk.

---

# Deployment Approval

As the team grows, production deployment permissions should follow least privilege.

Avoid shared deployment credentials.

---

# Rollout Automation

Automation should handle:

- artifact selection;
- environment config;
- rollout status;
- failure detection;
- rollback invocation.

Manual SSH-based deployment should not be the normal production path.

---

# Production Console Access

Direct console access should be exceptional.

Normal operational changes should go through versioned configuration/IaC/deployment systems.

---

# Secrets During CI

CI jobs should receive only the secrets required for their stage.

Pull-request/test jobs should not automatically receive production deployment credentials.

---

# Artifact Registry

Container/build artifacts should be stored in a controlled registry with:

- immutable references;
- access control;
- retention;
- vulnerability scanning where supported.

---

# SBOM / Provenance

As maturity increases, builds should produce:

- software bill of materials;
- artifact provenance;
- dependency manifest.

This improves supply-chain incident response.

---

# Database Seed Data

Production seed/bootstrap operations must be explicit and idempotent.

Do not rely on application startup scripts to silently create production domain data.

---

# Role Bootstrap

Initial privileged roles/administrative User setup must be a controlled process.

Because there is no separate admin app, bootstrapping authorization requires a secure operational mechanism.

Potential approaches:

- one-time migration/bootstrap command;
- tightly controlled operational script;
- manually approved role assignment through a secured process.

The exact mechanism must be finalized before launch.

---

# Bootstrap Security

Bootstrap operations should be:

- non-public;
- authenticated operationally;
- auditable;
- disabled or constrained after initial use.

---

# Scheduled Jobs

Scheduled maintenance jobs may include:

- orphan upload cleanup;
- retention cleanup;
- projection maintenance;
- backup verification;
- notification cleanup.

They should deploy as explicit jobs/cron workloads.

---

# Job Idempotency

Scheduled jobs must be retry-safe.

A rerun should not corrupt state.

---

# Job Concurrency

Where only one instance should run, use explicit leader/lock semantics rather than assuming the platform schedules one forever.

---

# Deployment and Privacy

A deployment must not bypass privacy controls.

Migration/rebuild jobs must preserve:

- deletion state;
- visibility;
- moderation;
- blocking.

---

# Deployment and Security

Runtime workloads must use least-privilege identities.

Deployment automation itself is a privileged system and requires strong controls.

---

# Deployment and Observability

New deployments should automatically register:

- version metadata;
- telemetry resource attributes;
- health checks.

---

# Cost Environments

Non-production environments should control cost.

Examples:

- smaller ClickHouse;
- shorter retention;
- scaled-down Kafka;
- provider sandboxes.

Do not compromise production-like behavior so much that integration testing becomes meaningless.

---

# Ephemeral Environments

Ephemeral environments may be useful for:

- PR validation;
- schema preview;
- frontend integration.

Stateful dependency cost may make full-stack ephemeral environments expensive.

Use selectively.

---

# Day-One Deployment Requirements

Before launch, Chronologity must define and implement:

- backend container build strategy;
- separate HTTP and worker entry points;
- immutable artifact/versioning;
- local/test/staging/production environments;
- configuration validation;
- managed secret injection;
- CI build/test/security pipeline;
- artifact registry;
- staging promotion process;
- rolling deployment;
- graceful shutdown;
- health/readiness;
- PostgreSQL migration job;
- ClickHouse projection-version migration process;
- EventStoreDB event-version compatibility;
- deployment telemetry;
- rollback procedures;
- worker autoscaling/resource limits;
- Infrastructure as Code;
- backup/restore deployment procedures;
- production least-privilege deployment access;
- initial privileged-role bootstrap process;
- mobile release strategy;
- Gatsby static deployment.

---

# Recommended Initial Deployment Model

```text
Public Edge / Load Balancer
    ├── api-http replicas
    └── feed-aggregator-http replicas

Worker Deployments
    ├── event-publisher
    ├── postgres-projection-worker
    ├── clickhouse-timeline-projection-worker
    ├── media-worker
    └── notification-worker

Stateful / Managed Services
    ├── EventStoreDB
    ├── PostgreSQL
    ├── Kafka
    ├── ClickHouse
    └── Object Storage + CDN

Static Delivery
    └── Gatsby web

Mobile Distribution
    └── App Store / Play Store / approved Expo update path
```

---

# Open Architectural Questions

## Hosting Platform

- Which cloud/provider?
- AWS?
- GCP?
- Azure?
- another provider?
- Which region is initial production primary?

## Container Runtime

- Kubernetes?
- ECS/Fargate?
- Cloud Run?
- another managed container platform?
- Recommended default: choose the simplest managed platform that supports independent HTTP/worker scaling and secure networking.

## EventStoreDB

- Managed EventStoreDB Cloud or self-hosted?
- Region/topology?
- Backup strategy?

## PostgreSQL

- Managed PostgreSQL provider?
- PITR?
- PgBouncer/provider pooling?
- Multi-AZ?

## Kafka

- Managed Kafka provider?
- Topic provisioning through IaC?
- ACL provisioning?

## ClickHouse

- ClickHouse Cloud?
- self-managed?
- Initial single service/cluster size?
- multi-AZ?

## Object Storage / CDN

- Which provider?
- Is CDN tied to same cloud?
- How are signed/private delivery credentials managed?

## Secrets

- Which secret manager?
- How do local/staging/prod configs differ?
- How is rotation automated?

## CI/CD

- GitHub Actions?
- another CI platform?
- How are production promotions approved?
- What deployment identity is used?

## IaC

- Terraform or Pulumi?
- How are application and infrastructure repos/paths organized?
- Same monorepo or separate infrastructure repo?

## Worker Layout

- One general projection worker or separate PostgreSQL and ClickHouse workers?
- Recommended: separate major workload types.
- Is media worker built from API image initially?

## Autoscaling

- Which workload signals?
- Minimum/maximum replicas?
- How does worker scaling respect Kafka partitions/provider quotas?

## Rollout

- Rolling only initially?
- Canary later?
- Blue/green for high-risk changes?
- What automatic rollback signals are trustworthy?

## Feature Flags

- Which system/provider?
- Are flags stored internally at first?
- Which features need kill switches?

## Bootstrap

- How is the first privileged User assigned a role?
- What operational tool performs this?
- How is it disabled/audited afterward?

## Mobile

- Expo EAS Build/Submit?
- OTA updates?
- What changes are allowed through OTA versus app-store release?
- Minimum supported app version policy?

---

# Architectural Invariants

1. Deployment units follow workload needs without forcing source-code fragmentation.
2. The canonical top-level applications remain API, feed aggregator, mobile, and web unless explicitly changed.
3. There is no separate admin deployment.
4. Administrative security remains server-side role based.
5. HTTP and heavy asynchronous workers run as separate processes.
6. One API codebase may produce multiple worker deployments.
7. Backend workloads use immutable deployable artifacts.
8. Container images do not contain production secrets.
9. Environment-specific configuration is injected at runtime.
10. Required configuration is validated at startup.
11. Production, staging, test, and local environments use isolated credentials/data.
12. Developers do not require production credentials for local work.
13. Builds are identifiable by version, git SHA, and build ID.
14. Build once/promote is preferred.
15. Rolling deployments are the default backend rollout strategy.
16. Temporary mixed-version deployment is expected.
17. Contracts and schemas support version skew.
18. New instances do not receive traffic before readiness.
19. Services and workers shut down gracefully.
20. Database migrations are not raced by every application replica.
21. PostgreSQL breaking migrations use expand/migrate/contract.
22. ClickHouse material changes favor side-by-side projection/table versions.
23. EventStoreDB schemas evolve through event compatibility, not table migrations.
24. Migration jobs use dedicated privileges.
25. Large backfills/rebuilds are explicit, throttled workloads.
26. Feature flags do not replace compatible contracts.
27. Kill switches cannot disable security/privacy enforcement.
28. Consumer upgrades precede breaking producer output.
29. Projection reader cutover follows successful rebuild/catch-up validation.
30. Rollback is planned before production rollout.
31. Mobile compatibility windows are longer than backend compatibility windows.
32. Gatsby marketing site is deployed statically where practical.
33. Infrastructure is defined through versioned IaC.
34. Production console-only configuration is minimized.
35. Managed services are preferred when they reduce operational burden without compromising requirements.
36. Internal datastores are not publicly exposed.
37. Autoscaling uses workload-appropriate signals.
38. Autoscaling has minimum/maximum bounds.
39. Resource requests/limits differ by workload class.
40. Initial regional deployment favors one primary region with multi-zone resilience and global CDN.
41. Active-active multi-region writes are not a day-one deployment requirement.
42. Disaster recovery restores authoritative state before derived systems.
43. Restore validation includes privacy/deletion state.
44. Deployment events are visible in observability tooling.
45. Deployment success includes application and pipeline health, not just process startup.
46. Smoke tests use safe dedicated data.
47. Production deployment permissions follow least privilege.
48. Normal production deployment is automated rather than SSH-driven.
49. CI jobs receive only necessary secrets.
50. Artifact registries use immutable controlled references.
51. Scheduled jobs are explicit deployable workloads.
52. Scheduled jobs are idempotent.
53. Privileged-role bootstrap is controlled and auditable.
54. Deployment/rebuild/migration operations preserve privacy and moderation semantics.
55. Architecture documentation changes when deployment boundaries or environment guarantees change.

---

# Guiding Principle

When deciding how to deploy a Chronologity component, ask:

> **Does this workload need independent scaling, failure isolation, security boundaries, or release cadence—and can we provide that through a separate runtime process without unnecessarily fragmenting the source architecture?**

Deployment should make Chronologity easier to operate and recover, not make the codebase more distributed than the product requires.
