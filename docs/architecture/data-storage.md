# Chronologity Data Storage Architecture

## Purpose

This document defines the data-storage architecture for Chronologity.

Chronologity intentionally uses multiple persistence technologies because its authoritative write workloads, relational operational state, high-volume Timeline reads, media storage, and caches have different requirements.

The architecture must preserve one central distinction:

```text
authoritative state
        ≠
derived state
```

This document defines:

- storage ownership;
- authoritative versus derived data;
- PostgreSQL responsibilities;
- ClickHouse responsibilities;
- object storage responsibilities;
- cache responsibilities;
- data movement between stores;
- consistency expectations;
- lifecycle and retention;
- privacy/deletion implications;
- backup/recovery;
- migrations;
- scaling;
- and rules for introducing new datastores.

This document is grounded in:

- `docs/architecture/overview.md`;
- `docs/architecture/principles.md`;
- `docs/architecture/api.md`;
- `docs/architecture/events.md`;
- `docs/architecture/messaging.md`;
- `docs/architecture/projections.md`.

---

# Core Principle

Every important data category must have one clearly defined source of authority.

The governing model is:

```text
One authoritative owner
        ↓
zero or more derived representations
```

not:

```text
multiple writable copies
        ↓
eventual hope they agree
```

A datastore is not authoritative merely because it is durable.

Authority is a domain/architecture decision.

---

# Storage Technologies

Chronologity currently uses:

```text
PostgreSQL
ClickHouse
Object Storage
Caches
```

Kafka is not included as an authoritative datastore in this list.

Kafka is messaging infrastructure.

---

# Storage Responsibility Matrix

| Store          | Primary role                                        | Authoritative?             | Rebuildable?                                   |
| -------------- | --------------------------------------------------- | -------------------------- | ---------------------------------------------- |
| PostgreSQL     | Authoritative state for every feature                | Yes                        | No; it is the source                           |
| ClickHouse     | High-volume derived Timeline/historical read models  | No                         | Yes                                            |
| Object storage | Media binaries and derivatives                       | Yes for stored media bytes | Derivatives yes; originals depend on retention |
| Cache          | Performance acceleration                             | No                         | Yes                                            |

PostgreSQL is unambiguously authoritative (ADR-092). There is no second write
store to reconcile it against, and no table in it is a projection of one.

A handful of PostgreSQL tables are still derived rather than authoritative —
`projection_processed_events` records what a consumer has already applied — and
that distinction must be explicit per table. What has gone is the case where a
table mirrored state that lived authoritatively somewhere else.

---

# PostgreSQL

## Role

PostgreSQL holds authoritative state for every feature (ADR-092).

That is the whole of its role, and stating it plainly matters: the previous
architecture split authority between an event store and PostgreSQL, which meant
every write committed twice, in two systems, with no transaction spanning them.
A failure between the two left one holding a record the other never recorded.
There is now one authority and one commit.

---

# PostgreSQL Authoritative State

PostgreSQL is authoritative for:

- identities, their addresses, and their credentials;
- Sessions, including whether one may still authenticate a request;
- accounts, profiles, handles, and restricted personal data;
- roles and the audit trail of every change to them;
- uploads and their lifecycle state;
- locations;
- and every feature added after these.

The row is the record, not a projection of one. What is written is what the
system accepts as true.

---

# PostgreSQL Derived and Infrastructure Tables

A small number of tables are not authoritative:

- `outbox_messages` — infrastructure. Messages waiting to reach Kafka, written
  in the same transaction as the change they describe.
- `projection_processed_events` — infrastructure. What a consumer has already
  applied, so that repeated delivery is safe.

These are rebuildable or discardable. Nothing else in PostgreSQL is.

---

# PostgreSQL Table Classification

Every PostgreSQL table should be classified as one of:

```text
authoritative
operational
infrastructure
```

Examples:

```text
users, sessions, uploads, locations, identity_emails
    → authoritative

magic_link_tokens
    → operational; short-lived security artifacts

auth_audit_events, authorization_audit_events
    → authoritative; evidence, written with the change it describes

outbox_messages, projection_processed_events, schema_migrations
    → infrastructure
```

There is deliberately no `projection` classification for a PostgreSQL table
holding domain state. A table that mirrors authoritative state living elsewhere
is the thing this architecture removed.

The classification should be stated in the migration that creates the table.

---

# PostgreSQL Constraints

Authoritative tables should use database constraints to reinforce invariants,
and in several places the constraint *is* the invariant.

Examples:

- unique normalized email, which is what makes two simultaneous first sign-ins
  resolve to one Identity rather than two;
- unique normalized handle, which decides who wins a race for a name;
- unique source reference on a location, so two people choosing the same search
  result reach one place;
- check constraints on coordinates and precision;
- foreign keys where ownership semantics are relational.

Deciding a uniqueness rule in application code — read, then write if absent —
leaves a gap that a concurrent request commits inside. The constraint has no gap.

## Foreign Keys and Deletion

Every relational reference between authoritative tables is a foreign key, and
every one of them is `ON DELETE RESTRICT`.

That is not caution. `docs/product/users.md:299` states that account deletion is
not equivalent to `DELETE FROM users`, lists the categories of data a User may
relate to, and requires the fate of each to be decided deliberately. `CASCADE`
would decide all of them silently, by a schema default nobody revisits — and it
would leave the media bytes in object storage that no constraint reaches.

`RESTRICT` makes the database refuse a naive delete until each dependant has
been dealt with. It blocks nothing that exists today, because nothing deletes a
User; what it does is oblige the deletion service, when it is built, to answer
the question rather than have a default answer it.

One exception. `authorization_user_roles.assigned_by` is `ON DELETE SET NULL`:
it is already nullable, because a role granted from the command line has no
acting User, and a role change should survive the departure of whoever made it.
What it loses is the attribution, not the fact.

The two audit tables deliberately have none. `auth_audit_events` and
`authorization_audit_events` reference identities, sessions, and users, and a
foreign key on any of those would force a choice between destroying evidence on
deletion and preventing deletion entirely. Audit rows are evidence, retained on
their own basis and their own schedule, and they are meant to outlive what they
describe.

Three other columns look like references and are not. `outbox_messages
.aggregate_id` is polymorphic. `projection_processed_events.event_id` identifies
a message rather than a row. `magic_link_tokens.email` is issued for addresses
that have no Identity on purpose — redeeming a sign-in link is what creates the
account.

---

# PostgreSQL Transactions

Use local PostgreSQL transactions for authoritative changes.

Do not extend a transaction across:

- Kafka;
- ClickHouse;
- object storage;
- external providers.

Use the outbox instead. Do not hold a transaction open across a network
conversation with any of them — an SMTP exchange inside a transaction ties a
database connection to a remote server's latency, and a slow decoder would do
the same.

Expensive CPU work belongs outside the transaction too. Password hashing is
deliberately slow, and holding a connection for its duration would exhaust the
pool under exactly the load that endpoint attracts.

---

# PostgreSQL Outbox

Every Integration Event reaches Kafka this way, and only this way (ADR-093):

```text
transaction
    ├── authoritative state change
    └── outbox message
```

Both commit or neither does. A publisher then claims batches with
`FOR UPDATE SKIP LOCKED`, publishes them, and marks them published inside the
same transaction that claimed them — so a crash mid-publish re-delivers rather
than losing the message, and several publisher instances can run without
coordinating.

Outbox rows are infrastructure. They are not the domain record of anything, and
nothing reads them to learn what happened.

Because the outbox is append-only and feeds Kafka, erasable personal data must
not be written into it (ADR-095). What a consumer needs is an identifier and
enough to act; what it does not need must not become impossible to erase.

Two operational questions remain open: retention of published rows, and when to
stop retrying a message that cannot succeed.

---

# PostgreSQL Schema Ownership

Tables should be owned by:

- a feature;
- a projection;
- infrastructure.

Avoid one giant shared schema with unclear responsibility.

Naming conventions should make ownership visible where practical.

---

# ClickHouse

## Role

ClickHouse stores high-volume derived read models optimized for:

- chronological range scans;
- Timeline slices;
- denormalized composition;
- temporal aggregations;
- historical navigation;
- contextual grouping;
- analytics-like read patterns required by product experiences.

ClickHouse is not authoritative.

---

# ClickHouse Owns No Domain Truth

A ClickHouse row must always be traceable conceptually back to:

- authoritative PostgreSQL state;
- another explicitly canonical source.

If ClickHouse is lost, it should be rebuildable.

---

# ClickHouse Consumers

Normal ClickHouse readers include:

```text
apps/feed-aggregator
```

Projection workers write ClickHouse.

The feed aggregator should use read-only credentials where possible.

---

# ClickHouse Timeline Read Models

ClickHouse may contain:

- Moment Timeline rows;
- User Timeline projections;
- Location Timeline projections;
- Real-World Event Timeline projections;
- tag/context projections;
- Reaction summaries;
- moderation visibility;
- historical-significance summaries;
- temporal zoom buckets;
- historical-jump indexes.

Exact tables belong in `docs/data/clickhouse.md`.

---

# ClickHouse Historical Ordering

Ordering keys must preserve historical semantics.

At minimum:

```text
occurrenceTime
+
deterministic tie-breaker
```

Event ingestion time is not sufficient.

---

# ClickHouse Backfilled Data

Backfilled Moments must be insertable into old historical positions.

The table design cannot assume:

```text
new message
    → newest chronology
```

---

# ClickHouse Updates and Corrections

ClickHouse does not behave like PostgreSQL.

Projection design must account for:

- corrections;
- versioned rows;
- deduplication;
- replacement/merge engines where appropriate;
- immutable insert patterns;
- materialized views if used.

Exact engine choices belong in focused ClickHouse design.

---

# ClickHouse Deletion

Deletion/restriction propagation must be explicit.

Possible strategies:

- delete mutations;
- versioned eligibility rows;
- tombstone columns;
- replacing rows;
- filtered current-state views.

The chosen model must support:

- privacy revocation;
- moderation;
- account deletion;
- Moment deletion.

---

# ClickHouse Security

ClickHouse read credentials should follow least privilege.

The feed aggregator should not have:

- schema-admin permission;
- unrestricted mutation permission;
- credentials for any authoritative store.

Projection workers have only the write privileges required for their target tables.

---

# Object Storage

## Role

Object storage owns media bytes.

This includes:

- original images;
- original videos;
- processed images;
- thumbnails;
- poster frames;
- video transcodes;
- other media derivatives.

The object store is not the authoritative owner of Moment semantics.

---

# Media Identity

Domain state references media by stable media/upload IDs.

Object-storage keys are infrastructure details.

Public/domain identifiers must not encode:

- bucket name;
- region;
- provider hostname.

---

# Original Media

Original media may be retained according to product/privacy policy.

The architecture must decide:

- whether originals are always retained;
- whether some originals may be deleted after processing;
- whether Users can request original deletion;
- backup implications.

These are media/data-retention decisions.

---

# Media Derivatives

Derivatives are rebuildable if originals remain.

Examples:

- thumbnail;
- resized image;
- transcoded video;
- poster frame.

If originals are deleted, some derivatives may become effectively authoritative delivery assets.

That consequence must be explicit.

---

# Media Metadata

Media metadata is authoritative in PostgreSQL, on the Upload's row. What the server measured by opening the file outranks anything the client declared.

Examples:

- media ID;
- object key reference;
- media type;
- width/height;
- duration;
- processing state;
- checksum;
- codec;
- creation/processing metadata.

Do not rely on listing object-store contents as the system of record.

---

# Signed Media Access

Private media delivery should use revocable authorization mechanisms.

Potential approaches:

- signed URLs;
- signed cookies;
- authenticated CDN;
- another controlled delivery mechanism.

Object-store public ACLs should not define product privacy.

---

# Media Deletion

Media deletion must remove:

- original object where required;
- derivatives;
- stale read-model references;
- CDN caches where applicable.

Deletion is a workflow across storage and projections.

---

# Orphan Media

Uploads can become orphaned.

Examples:

- User uploads but never creates/finalizes Moment;
- upload workflow fails;
- command is cancelled.

Object storage needs lifecycle/cleanup policies for orphaned temporary objects.

---

# Caches

## Role

Caches improve performance.

They are always disposable.

Examples may include:

- request cache;
- authorization cache;
- Timeline cache;
- metadata cache;
- CDN cache.

A cache must never be the only source of a domain fact.

---

# Cache Authority

The rule is:

```text
cache miss
    ↓
system can still determine correct answer
```

If correctness depends on the cache existing, it is not merely a cache.

---

# Authorization Caches

Authorization caches require bounded staleness.

Role removal, blocking, privacy change, suspension, or moderation restriction must not remain cached indefinitely.

Security-sensitive caches should use:

- short TTL;
- explicit invalidation;
- version/epoch keys;
- current-state checks for high-risk actions.

---

# Timeline Caches

Timeline caching must account for:

- Viewer identity;
- visibility;
- blocking;
- moderation;
- temporal range;
- context;
- cursor;
- scale.

Public and personalized Timeline results should not share unsafe cache keys.

---

# CDN Cache

Media/CDN caches require invalidation/expiration consistent with privacy and deletion.

A private media URL should not become publicly reusable forever because of CDN caching.

---

# Redis

Redis is **not** currently a canonical required datastore.

The architecture should not introduce Redis automatically.

If later needed for:

- distributed cache;
- rate limiting;
- short-lived auth artifacts;
- revocation cache;
- distributed coordination;

it must have a clearly defined responsibility.

In-memory/request-local caching should be preferred where sufficient.

---

# Search Store

A dedicated Search engine is not yet a canonical storage technology.

Search may initially use PostgreSQL or another solution.

If a dedicated engine such as OpenSearch is later introduced, it is derived state.

It must obey:

- privacy;
- deletion;
- moderation;
- rebuild.

---

# Storage Ownership by Application

## API

May access:

```text
PostgreSQL
Object Storage
Kafka, through the outbox
ClickHouse only where an operational need is justified
```

The HTTP API should not use ClickHouse for normal Timeline reads.

## Projection Workers

May access:

```text
Kafka
PostgreSQL target projections
ClickHouse target projections
Search target
```

depending on worker responsibility.

## Feed Aggregator

Normally accesses:

```text
ClickHouse
request-local cache
possibly tightly scoped authorization read state
```

It does not write authoritative stores.

## Mobile

No direct datastore access.

## Web

No direct datastore access.

---

# Data Movement

A typical Moment flow:

```text
Mobile
  ↓
API
  ↓
PostgreSQL          authoritative state, and the outbox message, in one transaction
  ↓
Outbox publisher
  ↓
Kafka
  ↓
Projection Worker
  ↓
ClickHouse
  ↓
Feed Aggregator
  ↓
Mobile
```

Media flows separately:

```text
Mobile
  ↓
authorized upload          registered by the API, written directly to storage
  ↓
Object Storage
  ↓
finalize                   verifies what arrived, enqueues the arrival
  ↓
media worker               opens the file, measures it, produces derivatives
  ↓
PostgreSQL                 authoritative media state
  ↓
read projections
```

---

# Data Duplication

Duplication is allowed on the read side.

Examples:

- creator display name in Timeline row;
- Location label in read model;
- Reaction count;
- media preview metadata.

The authoritative source remains elsewhere.

Read duplication improves latency and query simplicity.

---

# Sensitive Data Duplication

Sensitive data should not be duplicated casually.

Avoid copying:

- email;
- exact Location;
- authentication metadata;
- moderation evidence;
- provider identifiers

into every projection.

Store only what the read responsibility needs.

---

# Data Classification

Chronologity should classify data by sensitivity.

Potential classes:

```text
public
internal
sensitive
restricted
```

Classification should influence:

- datastore access;
- logging;
- encryption;
- retention;
- backups;
- projection eligibility.

---

# Encryption at Rest

Production datastores and object storage should use encryption at rest.

Provider-managed encryption may be sufficient for many stores.

Highly sensitive fields may require application-level encryption.

The preferred approach is still minimizing sensitive persistence.

---

# Encryption in Transit

All datastore communication should use encrypted transport in production.

This includes:

- PostgreSQL;
- ClickHouse;
- Kafka;
- object storage.

---

# Secrets

Database credentials, storage keys, and signing secrets must live in secure runtime secret management.

Never embed secrets in:

- repository files;
- mobile app;
- Gatsby bundle;
- shared packages;
- logs.

---

# Data Retention

Retention must be explicit per data category.

Categories include:

- authoritative events;
- relational operational state;
- read projections;
- media originals;
- media derivatives;
- Kafka messages;
- logs;
- backups;
- caches.

Retention should balance:

- historical integrity;
- privacy;
- security;
- legal requirements;
- cost.

---

# Event Retention

Non-sensitive authoritative history may be long-lived.

Sensitive data should be externalized or erased according to privacy policy.

---

# Projection Retention

Projection retention follows query/product needs.

Timeline read models may retain broad historical data.

Operational projections may keep only current state.

---

# Cache Retention

Caches use bounded TTL or explicit invalidation.

They do not define data-retention policy.

---

# Backup Retention

Backup retention must account for erasure requirements.

Deletion from the primary store does not instantly remove data from historical backups.

The architecture must define:

- backup retention window;
- restore procedures;
- post-restore re-erasure/reconciliation.

---

# Data Deletion

Deletion semantics vary by store.

## PostgreSQL

- delete;
- anonymize;
- tombstone;
- retention purge.

## ClickHouse

- remove/tombstone/version update;
- rebuild if needed.

## Object Storage

- delete original;
- delete derivatives;
- invalidate CDN.

## Caches

- invalidate/delete.

Deletion must be coordinated.

---

# Account Deletion

Account deletion is a cross-store workflow.

Potential sequence:

```text
revoke Sessions
    ↓
mark User deleted
    ↓
erase/externalize PII
    ↓
remove private media
    ↓
update PostgreSQL projections
    ↓
update ClickHouse
    ↓
remove Search documents
    ↓
invalidate caches
```

Historical non-sensitive facts may remain according to product/privacy policy.

---

# Privacy Changes

Privacy changes may not require physical deletion but require visibility updates across derived systems.

A privacy change is incomplete if:

- API says private;
- ClickHouse still serves public;
- Search still indexes;
- media URL remains public.

Propagation must be monitored.

---

# Blocking

Blocking data may remain in authoritative social state and be projected into read eligibility structures.

Avoid creating per-Viewer copies of all Timeline data unless necessary.

---

# Moderation

Moderation restrictions may be represented as eligibility fields rather than destructive removal so restoration is possible.

Exact strategy depends on target store.

---

# Data Consistency

Different data classes use different consistency levels.

## Strong/authoritative consistency

Required for:

- every authoritative write;
- role assignment and removal;
- session revocation, which takes effect on the next request;
- critical privacy state;
- domain invariants.

## Eventual consistency

Acceptable for:

- Timeline read projection;
- Reaction counts;
- Search indexing;
- historical-significance recomputation.

Consequence determines consistency.

---

# Cross-Store Consistency

Chronologity does not attempt synchronous ACID consistency across all stores.

Instead:

```text
authoritative commit, with its outbox message
    ↓
Integration Events
    ↓
eventual derived convergence
```

The system must detect when convergence stops.

---

# Source-of-Truth Matrix

Every read model should document its upstream authority.

Example:

```text
timeline_moment
    ← Moment Integration Events
    ← User profile inputs
    ← moderation state
    ← privacy state
```

This dependency information is critical for rebuild.

---

# Read Path Selection

Choose a datastore based on query responsibility.

Examples:

```text
current authoritative state
    → PostgreSQL

Timeline chronological slice
    → ClickHouse

media binary
    → object storage
```

Do not query a datastore merely because the data exists there.

---

# Avoid Cross-Store Joins

Critical request paths should avoid synchronous joins across many stores.

Instead use purpose-built read models.

For example, the feed aggregator should not need:

```text
ClickHouse
+
PostgreSQL
+
object-storage metadata call
```

per Moment.

Denormalize needed safe data.

---

# Materialized Read Models

Read models may intentionally duplicate stable display data.

The system must have update propagation for:

- User profile changes;
- Location corrections;
- moderation;
- privacy.

---

# Data Freshness

Derived stores should expose freshness operationally.

Potential metadata:

- source version;
- source position;
- projection version;
- updatedAt.

---

# Schema Migrations

Each datastore has its own migration strategy.

## PostgreSQL

Use versioned migrations.

Prefer:

```text
expand
migrate/backfill
contract
```

for rolling compatibility.

## ClickHouse

Prefer new tables/projection versions for material changes.

## Kafka

Integration Event payloads evolve through explicit versioning. A published event
is immutable and a consumer may be older than the producer, so a change that
removes or repurposes a field is a new version rather than an edit.

## Object Storage

Object key/version migration should use copy/transition workflows rather than assuming filesystem semantics.

---

# Migration Ownership

Migrations belong to the application/subsystem that owns the datastore schema.

The repository should keep migration code close to that owner.

Do not maintain one opaque global migration directory across unrelated stores if ownership becomes unclear.

---

# Database Naming

Names should use canonical Chronologity terminology.

Avoid infrastructure-driven names such as:

```text
post_table
content_record
generic_entity
```

Prefer:

```text
moment
user_authorization
moderation_case
timeline_moment
```

where semantics are clear.

---

# IDs

IDs should be application-generated where practical.

This supports:

- distributed creation;
- cross-store references;
- stable identity before persistence.

IDs must not depend on database sequences when cross-store identity is needed.

---

# Foreign Keys

PostgreSQL foreign keys are useful within relational ownership boundaries.

Do not create fake cross-database foreign keys.

Cross-store integrity is maintained through application/events/workflows.

---

# Unique Constraints

Use unique constraints for invariants such as:

- username uniqueness;
- external provider linkage uniqueness;
- idempotency key uniqueness;
- processed Event ID uniqueness.

---

# Time Storage

Persist timestamps in UTC.

Domain types should distinguish:

- occurrence time;
- event time;
- created time;
- updated time;
- processing time.

Do not let generic timestamp names erase semantics.

---

# Historical Time Precision

Chronologity may represent uncertain/imprecise historical time.

Storage schemas must support:

- exact timestamps;
- date-only;
- ranges;
- uncertain values

as defined by product semantics.

Do not force all history into false millisecond precision.

---

# Location Storage

Location storage may need:

- canonical place ID;
- coordinates;
- precision;
- historical names;
- privacy-reduced representation.

Exact geospatial design belongs in data/location documentation.

PostgreSQL/PostGIS may be considered if geospatial querying requires it.

That is not yet a canonical dependency unless explicitly adopted.

---

# Media Checksums

Media may use checksums for:

- integrity;
- deduplication;
- processing verification.

A checksum does not automatically imply cross-User media deduplication is product/privacy-safe.

---

# Large Values

Large binary values must not live in:

- Kafka;
- ClickHouse;
- ordinary PostgreSQL rows

when object storage is appropriate.

---

# JSON Columns

PostgreSQL JSON/JSONB should be used selectively.

Avoid using JSON as an excuse to skip schema design for stable domain data.

JSON is appropriate for:

- provider metadata;
- extensible technical fields;
- sparse operational attributes

when relational access is limited.

---

# Data Access Interfaces

Application code should depend on purpose-specific ports/adapters where useful.

Avoid one universal:

```text
Repository<T>
```

across PostgreSQL, ClickHouse, and object storage.

These systems have different semantics.

---

# Connection Management

Each process owns its datastore connection pools/clients.

Clients should be:

- initialized at startup;
- reused;
- closed gracefully.

Do not create a new database connection per request.

---

# Timeouts

All remote datastore operations require explicit timeouts.

A hung database call should not consume request/worker capacity indefinitely.

---

# Retries

Retry policy depends on operation.

Safe examples:

- idempotent read;
- projection upsert;
- Kafka publish.

Unsafe automatic retry may include:

- non-idempotent external side effect;
- command after ambiguous authoritative commit.

Retry semantics must be explicit.

---

# Circuit Breaking

Circuit breakers may be useful for repeatedly failing external stores/providers.

Do not add them automatically.

Use where they materially improve failure isolation.

---

# Connection Pool Isolation

If projection workers and HTTP API have different load patterns, they should use separate process-level connection pools.

A large rebuild should not exhaust the API's PostgreSQL connections.

---

# Scaling PostgreSQL

Scale progression may include:

- query/index optimization;
- connection pooling;
- read replicas for eligible reads;
- partitioning;
- vertical scaling;
- sharding only when justified.

Do not jump directly to sharding.

---

# PostgreSQL Read Replicas

Read replicas may serve stale-tolerant operational queries.

They must not serve security-critical current-state checks where replica lag is unsafe.

---

# Scaling ClickHouse

ClickHouse can scale by:

- partitioning;
- sharding;
- replicas;
- distributed tables;
- batch ingestion.

The physical topology should follow measured Timeline workload.

---

# ClickHouse Partitioning

Partition keys should support data lifecycle and query performance.

Do not choose partitioning solely from one current query.

Exact partition keys belong in `docs/data/clickhouse.md`.

---

# Scaling Object Storage

Object storage/CDN handles large binary scale naturally.

Application design must avoid routing all media bytes through API servers.

---

# Cost

Storage cost must be measured separately for:

- PostgreSQL;
- ClickHouse;
- media originals;
- media derivatives;
- CDN;
- backups.

Media and Timeline history are likely major cost centers.

---

# Storage Observability

Metrics should include:

## Outbox

- depth of unpublished messages;
- publication lag;
- messages whose attempts keep climbing.

## PostgreSQL

- query latency;
- connection saturation;
- lock contention;
- transaction failures;
- index/cache health;
- table growth.

## ClickHouse

- query latency;
- insert throughput;
- merge backlog;
- storage growth;
- projection lag.

## Object Storage

- upload failures;
- download errors;
- storage size;
- egress;
- orphan object count;
- processing backlog.

---

# Storage Health

Health checks should reflect the application's responsibility.

The API should fail readiness if it cannot safely perform required authoritative writes.

The feed aggregator may fail readiness if ClickHouse is unavailable.

A media-processing worker may remain healthy even if unrelated PostgreSQL read replicas are down.

---

# Backup and Recovery

Each authoritative store requires tested recovery.

Derived stores may be rebuilt, but backups may still reduce recovery time.

## PostgreSQL

PostgreSQL is the only authoritative store, which makes its recovery the whole
of the system's recovery. Backups and PITR according to RPO/RTO, and tested.

Infrastructure tables — the outbox, processed-event records — are rebuildable
only in the sense that losing them costs undelivered messages rather than
authoritative facts. They are backed up with everything else.

## ClickHouse

May rely more heavily on projection rebuild, but backups can reduce recovery time.

## Object Storage

Original media requires durable redundancy/retention according to product policy.

---

# Recovery Priority

In a major incident:

```text
1. restore authoritative state
2. restore media authority
3. resume event publication
4. rebuild critical projections
5. rebuild lower-priority derived systems
```

Do not prioritize a read cache over authoritative history.

---

# Disaster Recovery

Disaster recovery documentation should define:

- RPO;
- RTO;
- backup frequency;
- restore procedures;
- credentials/secrets restoration;
- event subscription checkpoint handling;
- projection rebuild sequence.

---

# Data Integrity Verification

Chronologity should have tools/checks to verify:

- event stream readability;
- PostgreSQL constraints;
- projection source versions;
- media object existence;
- ClickHouse projection counts/ranges.

---

# Orphan Detection

The system should detect:

- media metadata without object;
- object without metadata;
- projection row without valid source;
- outbox message whose attempts keep climbing without succeeding;
- published outbox rows that nothing ever removes.

---

# New Datastore Decision Rule

A new datastore may be introduced only when existing stores cannot appropriately satisfy a concrete requirement.

Before adding one, document:

1. required workload;
2. why PostgreSQL, ClickHouse, and object storage are insufficient;
3. authority status;
4. consistency model;
5. backup/rebuild strategy;
6. operational burden;
7. privacy/security implications;
8. migration path.

---

# Avoid Datastore Fashion

Do not add:

- Redis;
- Elasticsearch;
- Neo4j;
- MongoDB;
- Cassandra;
- DynamoDB

merely because a feature resembles a common use case.

Use the existing stack until a demonstrated requirement justifies another technology.

---

# Graph Data

Causality/social relationships may look graph-like.

That does not automatically justify a graph database.

PostgreSQL, projections, or purpose-built adjacency indexes may be sufficient initially.

A graph database should be introduced only if traversal/query requirements materially exceed existing stores.

---

# Search

Search technology should be decided from product/query needs.

If PostgreSQL search is sufficient initially, use it.

If dedicated Search becomes necessary, it remains a derived index.

---

# Analytics

Analytics infrastructure is separate from product-authoritative storage.

Analytics data should not become hidden authority for product features unless explicitly promoted.

---

# Data Governance

Each schema/table/read model should document:

- owner;
- classification;
- authoritative/derived status;
- retention;
- deletion behavior;
- backup requirement;
- consumers.

---

# Day-One Storage Requirements

Before launch, Chronologity must define and implement:

- authoritative-store matrix;
- PostgreSQL table classifications;
- PostgreSQL migration framework;
- ClickHouse migration/projection version strategy;
- object-storage provider;
- media key/ID strategy;
- signed media access;
- cache policy;
- data classification;
- encryption at rest/in transit;
- secret management;
- backup/restore procedures;
- deletion workflows;
- privacy propagation;
- moderation propagation;
- projection rebuild paths;
- datastore observability;
- least-privilege database credentials;
- local development infrastructure.

---

# Open Architectural Questions

## PostgreSQL Authority

- Where do idempotency records live?
- What are the retention rules for published outbox rows?
- When does a repeatedly failing outbox message stop being retried, and where
  does it go?
- When are foreign keys added across the schema?

## ClickHouse

- What are the canonical tables?
- What engines are used?
- What order/primary keys?
- What partition keys?
- How are correction/version rows represented?
- How are privacy/moderation deletes represented?

## Object Storage

- Which provider?
- Which bucket/key topology?
- Direct multipart upload?
- Original retention?
- Derivative retention?
- CDN provider?
- How is cache invalidation handled?

## Cache

- Is Redis needed at launch?
- Recommended default: no unless a concrete distributed-cache/rate-limit/revocation use case requires it.
- Which caches are request-local?
- Which are shared?
- What are authorization-safe TTLs?

## Search

- Is PostgreSQL sufficient initially?
- When would a dedicated Search engine be introduced?
- How is the index rebuilt?
- What privacy lag is acceptable?

## Location

- Do we adopt PostGIS?
- What geospatial queries are required at launch?
- How is privacy-reduced Location represented?

## Backups

- PostgreSQL?
- Object storage?
- Are ClickHouse backups necessary or is replay sufficient?
- How are backup erasure obligations handled?

## Data Classification

- What formal classification taxonomy is used?
- Which tables/topics/object prefixes are restricted?
- How is classification reflected in access control?

---

# Architectural Invariants

1. Every important data category has one clear authoritative owner.
2. Durability alone does not make a datastore authoritative.
3. PostgreSQL holds authoritative state for every feature; there is no second write store.
4. PostgreSQL also holds a small number of infrastructure tables, and each table is classified.
5. ClickHouse is always derived product-read state.
6. Object storage owns media bytes, not Moment semantics.
7. Caches are always disposable.
8. Kafka is not an authoritative datastore.
9. Multiple writable copies of the same domain state are prohibited.
10. No table in PostgreSQL mirrors domain state that lives authoritatively elsewhere.
11. A uniqueness rule is enforced by a constraint, not by reading before writing.
12. PostgreSQL local transactions do not extend across other stores.
13. Every Integration Event reaches Kafka through the transactional outbox, enqueued in the same transaction as the change it describes.
14. ClickHouse read models are rebuildable.
15. Backfilled history must be supported in ClickHouse.
16. ClickHouse event arrival time does not define chronology.
17. Feed Aggregator uses ClickHouse for normal Timeline reads.
18. Feed Aggregator is read-only where practical.
19. API-side ClickHouse access remains projection/operations scoped.
20. Object-store keys are infrastructure details, not domain IDs.
21. Media metadata has an explicit authoritative owner separate from object listing.
22. Private media delivery remains revocable.
23. Orphan media has cleanup policy.
24. Authorization-sensitive caches have bounded staleness.
25. Redis is not introduced without a concrete responsibility.
26. Search engines, if introduced, are derived.
27. Read-side denormalization is allowed.
28. Sensitive-data duplication is minimized.
29. Data classification influences access, encryption, retention, and logging.
30. Encryption in transit is required for production datastore communication.
31. Secrets never live in client bundles or source control.
32. Retention is explicit per data category.
33. Backup retention participates in erasure policy.
34. Deletion propagates across all stores and caches.
35. Privacy change is incomplete until all exposure paths converge.
36. Strong consistency is reserved for consequence-sensitive authoritative/security data.
37. Eventual consistency is accepted for derived reads where safe.
38. Cross-store ACID transactions are avoided.
39. Read paths select stores by responsibility, not convenience.
40. Critical reads avoid synchronous cross-store joins where denormalization is appropriate.
41. Client contracts do not expose raw datastore schemas.
42. Migrations are owned by the schema owner.
43. PostgreSQL rolling migrations prefer expand/migrate/contract.
44. ClickHouse material changes prefer versioned tables/projections.
45. Integration Event schemas evolve through explicit versioning, because a published event is immutable and consumers may be older than producers.
46. Application-generated stable IDs are preferred where cross-store identity is needed.
47. Historical time semantics are preserved explicitly.
48. False temporal precision is prohibited.
49. Large binaries stay out of relational and message stores.
50. JSON columns do not replace schema design casually.
51. Universal repository abstractions across heterogeneous datastores are avoided.
52. Processes reuse managed connection pools.
53. Datastore calls use explicit timeouts.
54. Retry semantics are operation-specific.
55. Projection/rebuild workloads must not exhaust API connection pools.
56. Sharding is introduced only when measured scale justifies it.
57. Media scale should bypass API byte proxying.
58. Storage cost is measured by subsystem.
59. Authoritative-store recovery is prioritized before derived systems.
60. New datastores require a documented unmet requirement.
61. Graph-like data does not automatically justify a graph database.
62. Analytics stores do not become hidden product authority.
63. Storage schemas/read models have explicit ownership and lifecycle.
64. Architecture documentation changes when datastore authority changes.

---

# Guiding Principle

When choosing where Chronologity data belongs, ask:

> **Which system is responsible for deciding this fact, which system is best suited to serve this read pattern, and can we preserve one authoritative owner while safely deriving every other representation?**

If the answer creates multiple competing sources of truth, the storage design is wrong.
