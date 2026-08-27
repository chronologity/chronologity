# Chronologity Privacy Architecture

## Purpose

This document defines the privacy architecture for Chronologity.

Privacy is not a presentation-layer preference.

It is an architectural constraint that affects:

- authoritative state;
- authorization;
- projections;
- Timeline composition;
- Search and Discovery;
- media delivery;
- notifications;
- caches;
- logging;
- analytics;
- backups;
- deletion and erasure.

Chronologity is a historical product. That makes privacy especially important because the system may preserve historical context for long periods while still needing to respect:

- current visibility choices;
- blocking;
- account deletion;
- moderation;
- legal erasure;
- sensitive Location;
- authentication data;
- media access;
- historical uncertainty;
- provenance.

This document defines:

- privacy principles;
- visibility;
- audience rules;
- blocking;
- Location privacy;
- historical privacy semantics;
- data minimization;
- PII handling;
- projections and read models;
- media privacy;
- notification privacy;
- caching;
- logs and telemetry;
- analytics;
- retention;
- deletion;
- erasure;
- backup implications;
- privacy testing;
- and open architectural questions.

This document is grounded in:

- the finalized product specifications;
- `docs/architecture/overview.md`;
- `docs/architecture/principles.md`;
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
- `docs/architecture/caching.md`.

---

# Core Principle

Chronologity should preserve historical meaning without preserving more personal data than necessary.

The governing rule is:

> **Historical integrity does not override privacy, and privacy does not require Chronologity to erase non-sensitive historical structure when the product can preserve that structure without retaining unnecessary personal data.**

---

# Privacy Is Authorization

Privacy settings are enforced through authorization.

For example:

```text
Moment visibility = followers
```

does not itself decide access.

The authorization system evaluates:

```text
Viewer
+
Moment visibility
+
relationship
+
block state
+
moderation state
+
account state
```

and returns the current decision.

---

# Privacy Is Not Only Visibility

Privacy also includes:

- which data is collected;
- where it is stored;
- how long it is retained;
- which services receive it;
- whether it is copied into immutable events;
- whether it appears in logs;
- whether exact Location is exposed;
- whether media remains accessible after revocation;
- whether projections can be rebuilt safely.

---

# Data Minimization

Chronologity should collect and retain only data that serves a concrete product, security, legal, or operational purpose.

Before adding a field, ask:

1. Why is this needed?
2. Who needs it?
3. Which datastore should own it?
4. Does it need to be durable?
5. Does it need to be replicated?
6. How is it deleted?
7. What happens during replay?
8. Does it need exact precision?

---

# Personally Identifiable Information

PII may include:

- email address;
- authentication-provider identifiers;
- exact Location;
- device/session metadata;
- IP address;
- private profile information;
- media metadata;
- potentially identifying historical details.

The architecture should distinguish:

```text
identity/security PII
product/profile PII
historical/content PII
operational PII
```

because retention and access requirements differ.

---

# Sensitive Authentication Data

Authentication data receives especially strict treatment.

Raw:

- access tokens;
- refresh tokens;
- OAuth tokens;
- recovery codes;
- signing secrets

must never appear in:

- Integration Events;
- Kafka;
- logs;
- analytics;
- read projections.

---

# Visibility

Moment visibility is authoritative product state.

Potential visibility models may include:

```text
public
network/followers
private
```

or another finalized product vocabulary.

The exact visibility enum belongs in product/API specifications.

---

# Visibility Changes

A visibility change affects all downstream exposure surfaces.

Conceptually:

```text
MomentVisibilityChanged
        ↓
authorization
        ↓
Timeline projection
        ↓
Search
        ↓
media delivery
        ↓
caches
        ↓
notifications
```

The system must observe and verify propagation.

---

# Public Content

Public content is eligible for broader read access.

Public does not mean:

- unrestricted administrative access;
- permission to expose exact sensitive metadata;
- permanent access after deletion;
- permission to bypass moderation.

---

# Private Content

Private content should be visible only to the authorized subject(s) defined by product semantics.

The architecture should fail closed when privacy state cannot be verified safely.

---

# Network / Relationship Visibility

Relationship-based visibility requires current social state.

A stale relationship projection can create privacy leakage.

The acceptable consistency window must be bounded.

---

# Blocking

Blocking is a privacy and interaction control.

A block may affect:

- profile visibility;
- Moment visibility;
- Comments;
- Reactions;
- Search;
- Discovery;
- Timeline eligibility;
- notifications;
- causal/contextual exposure.

Blocking is distinct from moderation.

---

# Block Directionality

The exact semantics of blocking must be explicit.

Questions include:

- Is visibility symmetric?
- Can blocked Users see public historical contributions in shared Real-World Events?
- Are existing Comments/Reactions hidden?
- Can either party Search the other?
- What happens to shared network context?

These rules must be product-defined before implementation.

---

# Blocking Propagation

Blocking should propagate quickly enough that:

```text
block accepted
        ↓
restricted exposure ceases
```

within a tightly bounded interval.

Caches and read projections must not preserve stale access indefinitely.

---

# Location Privacy

Location is especially sensitive.

Chronologity should support precision-aware access.

Conceptually:

```text
exact coordinates
city/neighborhood-level
named place
region
hidden
```

The exact precision model belongs in product/location specifications.

Precision attaches to a Moment's association with a place rather than to the
place itself (ADR-098). A Location is shared reference data with no audience of
its own, so there is nothing on it to reduce precision for; what varies by
viewer is one person's assertion that something happened somewhere.

---

# Precision-Aware Authorization

Authorization may return:

```text
allowedPrecision
```

rather than only allow/deny.

Example:

```text
owner
    → exact

public Viewer
    → city-level
```

---

# Exact Location

Exact Location should be stored and exposed only when product semantics require it.

Do not copy exact coordinates into:

- broad Timeline projections;
- Kafka events;
- notification payloads;
- logs;
- public Search indexes

unless strictly necessary.

---

# Historical Location

A Moment may be associated with a historical Location whose:

- name;
- boundaries;
- political jurisdiction

changed over time.

Privacy precision and historical correctness must remain separate concerns.

---

# Embedded GPS

GPS metadata extracted from media is untrusted/sensitive.

It may be used as a suggestion.

It must not automatically become public authoritative Location.

---

# Location in Read Models

Read models should contain the minimum Location precision needed for the read surface.

A public Timeline may need:

```text
Location ID
display name
coarse precision
```

not exact coordinates.

---

# Historical Privacy

Chronologity stores history.

Historical visibility may change later.

Example:

```text
Moment public in 2026
        ↓
made private in 2028
```

The current privacy state governs current access.

Past public availability does not automatically grant permanent future access.

---

# Historical Snapshots

If Chronologity ever exposes historical snapshots of what was public at a past time, that would require an explicit product/legal architecture decision.

It must not emerge accidentally from event replay.

---

# Append-Only Storage and Privacy

Anything append-only creates a privacy challenge, because what is written cannot
be corrected. Chronologity has two such surfaces: the transactional outbox and
Kafka topics (ADR-095).

The architecture must keep erasable content out of both.

Prefer:

```text
message references the record by identifier
```

over:

```text
message contains the raw sensitive value
```

The consumer then reads what it needs from PostgreSQL, which can be corrected,
erased, or refused.

Authentication follows this rather than being exempt from it. It publishes one
event — that something about an account's security changed — carrying the
Identity, the account, which change, and when. No password, no hash, no token,
no phone number, and no address: anything a consumer needs in order to reach
somebody is read from authoritative state, where erasure can still reach it.
The accountability requirement is met by a relational audit trail, which the
event does not duplicate.

where erasure may be required.

---

# Externalized PII

Sensitive values that may need deletion should live outside immutable event payloads where practical.

Examples:

- email;
- exact Location;
- provider identifiers;
- moderation evidence;
- sensitive profile fields.

Events preserve the domain transition while the sensitive record remains erasable.

---

# Pseudonymous References

Events and projections should prefer stable IDs over raw PII.

Example:

```text
recipientUserId
```

rather than:

```text
recipientEmail
```

---

# Event Metadata Privacy

Event metadata is subject to the same privacy rules as payloads.

Do not casually store:

- IP address;
- raw User-Agent;
- email;
- exact coordinates;
- device fingerprint.

---

# Event Redaction

Exceptional redaction may be required for:

- accidental secret leakage;
- legal erasure;
- prohibited content;
- severe privacy defects.

Redaction must be:

- controlled;
- auditable;
- rare.

---

# Cryptographic Erasure

Chronologity may use cryptographic erasure where immutable encrypted data must become unreadable after deletion.

This should be reserved for concrete use cases because it increases:

- key management;
- backup complexity;
- operational risk.

---

# User Profile Privacy

Public profile fields should be explicitly defined.

Authentication identifiers such as email should not become public profile data unless product semantics intentionally expose them.

---

# Identity Versus User

The privacy boundary should reinforce:

```text
Identity
    → authentication/security

User
    → product/account/profile
```

This limits unnecessary propagation of authentication PII into product read models.

---

# Session Privacy

Session data may include:

- device/client type;
- creation time;
- approximate location where justified;
- last activity.

Do not collect precise device fingerprinting or Location unless the security benefit clearly justifies it.

---

# IP Addresses

IP addresses are operational/security data.

They should have explicit:

- purpose;
- retention;
- access controls.

They should not appear in product-facing read models.

---

# Device Metadata

Device metadata should be minimized and used primarily for:

- session identification;
- security;
- push delivery.

It should not become a hidden behavioral identity graph.

---

# Media Privacy

Media access follows resource authorization.

A private Moment's media must not remain accessible through a stale permanent URL.

---

# Signed Media Access

Private delivery should use bounded credentials such as signed URLs/cookies.

Revocation must take effect within a defined maximum window.

---

# Media Metadata Privacy

Sensitive media metadata includes:

- exact GPS;
- capture device;
- embedded owner information;
- filesystem names.

The processing pipeline should strip or isolate unnecessary sensitive metadata from public derivatives.

---

# Original Media Privacy

Originals may contain more sensitive metadata than derivatives.

Access to originals should be stricter than access to ordinary display derivatives.

Viewing a Moment does not necessarily imply permission to download its original media.

---

# CDN Privacy

CDN caching must not defeat access revocation.

Private media strategies may include:

- signed requests;
- short expiration;
- versioned URLs;
- purge on deletion/restriction.

---

# Notification Privacy

Notifications can expose content outside the app through:

- lock screen;
- push preview;
- email preview.

Sensitive notifications should use minimal content.

---

# Notification Deep Links

A notification does not grant permanent access.

The destination is reauthorized at open time.

---

# Notification Snapshots

Stored notification display snapshots must be minimal.

If underlying content becomes private/deleted, snapshot retention must not leak details indefinitely.

---

# Search Privacy

Search indexes are derived.

They must not contain content that the Viewer should not be able to discover through Search.

Searchability can be stricter than direct-access visibility.

---

# Search Removal

Privacy or blocking changes should remove/update Search entries within a defined SLO.

---

# Discovery Privacy

Discovery is amplification.

Eligibility should be at least as strict as direct-access rules and may be stricter.

A private or blocked resource must never surface through Discovery.

---

# Timeline Privacy

Timeline composition must enforce:

- scope access;
- item visibility;
- blocking;
- moderation;
- Location precision;
- account state.

Derived Timeline metadata must not leak hidden resources.

---

# Temporal Zoom Privacy

Broad temporal aggregates can leak information through:

- counts;
- thumbnails;
- labels;
- significance anchors.

Temporal zoom must exclude or safely aggregate unauthorized data.

---

# Historical Jump Privacy

A historical jump target is reauthorized.

If unavailable, do not leak:

- exact time;
- Location;
- creator;
- Event;
- significance.

---

# Causality Privacy

A causal edge must not reveal an inaccessible node.

If one endpoint is hidden, the relationship may need to be hidden or redacted.

---

# Historical Significance Privacy

Historical significance does not override privacy.

A significant private Moment remains private.

---

# Projection Privacy

Every projection should define:

- what sensitive data it contains;
- why it needs it;
- how privacy changes update it;
- how deletion removes it;
- how rebuild avoids resurrection.

---

# Privacy-Safe Replay

Replay must use current privacy/deletion state.

A rebuild must never reconstruct a stale public representation solely because older events once indicated public visibility.

---

# Deleted Externalized Data During Replay

If an event references erased PII:

```text
emailRecordId
```

and the record no longer exists, replay should produce the correct erased/redacted state.

It must not fail by assuming the sensitive value is permanent.

---

# Projection Denormalization

Denormalized read models should duplicate only what is required.

Avoid copying:

- email;
- exact Location;
- moderation evidence;
- raw provider identifiers

into Timeline rows unless a concrete read requirement exists.

---

# Cache Privacy

Caches must preserve Viewer separation.

A cache leak is a privacy incident even if the underlying database authorization is correct.

---

# Cache Key Privacy

Viewer-sensitive responses require Viewer-safe cache keys.

Public and personalized namespaces remain separate.

---

# Cache Invalidation

Privacy changes require high-priority invalidation.

TTL is a fallback, not the only control.

---

# Mobile Cache Privacy

The mobile app may retain private content locally.

Logout/account switching should clear or isolate sensitive cached content according to client policy.

---

# Offline Privacy

Explicit offline support creates longer-lived device copies of private content.

It requires dedicated product/security semantics and is not assumed by ordinary caching.

---

# Logging Privacy

Logs should not contain full private payloads by default.

Prefer:

```text
Moment ID
User ID
trace ID
event type
error code
```

rather than:

```text
caption
email
exact Location
signed URL
raw event payload
```

---

# Structured Logging

Structured logs make redaction and field policies easier.

Sensitive fields should be excluded structurally rather than relying solely on engineer discipline.

---

# Trace Privacy

Tracing systems may collect:

- route;
- IDs;
- durations;
- error codes.

Avoid placing raw request bodies or sensitive GraphQL variables into spans.

---

# Metrics Privacy

Metrics should avoid high-cardinality User/entity IDs.

Operational counts and latencies are preferred.

---

# Error Reporting

Crash/error systems must scrub:

- tokens;
- emails;
- signed URLs;
- exact Location;
- private content.

---

# Analytics Privacy

Analytics should use the minimum data required to understand product behavior.

Analytics should not become a shadow copy of the entire product database.

---

# Analytics Identity

Use pseudonymous User identifiers where practical.

Avoid sending authentication identifiers to analytics systems.

---

# Analytics Content

Do not send private Moment captions/media metadata to analytics unless a specific, approved measurement requires it.

---

# Analytics Retention

Analytics retention should be shorter where possible and independent from domain retention.

---

# Data Classification

Chronologity should maintain a small internal classification model.

Potential classes:

```text
public
internal
sensitive
restricted
```

Examples:

```text
public Moment preview
    → public

User ID
    → internal

email
    → sensitive

auth token / moderation evidence
    → restricted
```

Exact classification definitions belong in security/privacy operations docs.

---

# Access Control by Classification

Datastore/service permissions should reflect classification.

A Timeline worker should not gain access to restricted authentication tables merely because both use PostgreSQL.

---

# Retention

Every privacy-relevant data category should have an explicit retention policy.

Examples:

- identity PII;
- session metadata;
- notifications;
- logs;
- analytics;
- moderation evidence;
- media originals;
- media derivatives;
- provider callbacks;
- backups.

---

# Retention Is Not One Global TTL

Different data has different value and risk.

Do not apply one blanket retention period to all stores.

---

# Data Deletion

Deletion may mean:

- logical product deletion;
- visibility suppression;
- anonymization;
- physical row/object deletion;
- cryptographic erasure;
- event redaction.

The required operation depends on the data.

---

# User-Initiated Account Deletion

Account deletion is a cross-system privacy workflow.

It is also two steps rather than one. The first sends a confirmation link to the
verified address; the second consumes it. A session proves somebody signed in
once; consuming a link proves they can read the mailbox now, which is the
strengthening `changePassword` gets from demanding the current password and is
available to every account rather than only those that have one. The mail
arriving is a control in its own right: an account that has been taken over
cannot be quietly deleted.

The synchronous half is only what must be immediate — the account stops working
and its credentials go. Erasing what it recorded is unbounded work and is
written down as an erasure request instead, handled by the same worker and the
same ledger a single deleted Moment uses. Erasing an account is a coordinator:
it hands its Moments to that path in bounded batches, and sweeps its own rows
only once none remain.

Potential steps:

```text
revoke Sessions
    ↓
mark account deleted
    ↓
stop authentication
    ↓
erase identity/profile PII
    ↓
delete private media
    ↓
remove Search/Timeline exposure
    ↓
invalidate caches
    ↓
apply notification retention/deletion
    ↓
retain only permitted non-sensitive historical structure
```

---

# Historical Structure After Deletion

Chronologity may preserve non-sensitive historical structure when product/legal semantics permit.

For example, a historical Moment could potentially remain as:

```text
anonymous/deleted attribution
```

only if this is explicitly allowed by product/privacy policy.

It must not be assumed.

It is not assumed here, and the decision went the other way for content: a
deleted account's Moments, media, comments, and reactions are erased rather than
kept under anonymous attribution.

What survives is narrower than that, and structural. The `users` row is
tombstoned — no handle, no display name, no biography, a `deleted` status — so
that the thirty-nine references pointing at it stay valid. Two of those are the
reason: `locations.recorded_by_user_id` and `real_world_events.created_by_user_id`
are shared reference data other people's Moments name, and both columns are
`NOT NULL`. Removing the row would mean either loosening shared attribution or
destroying history belonging to everybody else.

The tombstone preserves no content and no attribution. It preserves the ability
of other people's history to keep working.

---

# Hard Delete Versus Tombstone

A tombstone can preserve:

```text
something existed and is now unavailable
```

without exposing deleted data.

A hard delete physically removes data.

Both may be required in different stores.

Deleting a Moment uses both, in that order. Marking it deleted is synchronous
and is what makes it vanish from every surface at once; it also blanks the
caption and the body of every comment on it, so that what waits in the erasure
queue is structure rather than anybody's words. The row itself is then hard
deleted by the erasure worker, cascading the twelve tables that reference it.

Moderation records are not among those twelve. They name their subject
polymorphically with no foreign key and survive deliberately: an appeal against
a decision whose record vanished with the content is not one.

---

# Deletion Propagation

Deletion must reach:

- PostgreSQL;
- ClickHouse;
- Search;
- object storage;
- CDN;
- caches;
- notification snapshots;
- analytics where required.

Erasure reaches Search and object storage directly rather than waiting to be
told. The Search document is removed in the same transaction as the row, so
deletion never queues behind a reindex — which is what *restriction and deletion
propagate at higher priority than ordinary indexing* means in practice. The
event-driven indexer remains the backstop and converges on the same answer, so
the two cannot disagree.

Notifications need no propagation at all. They store identifiers and compose
their wording at read time from what the reader may currently see, so a
notification about an erased Moment stops rendering, and leaves the unread
count, without anything having to reach it.

ClickHouse is absent from this path because there are no Timeline projections
yet. When they arrive they must join it: a projection that erasure cannot reach
is not ready to hold personal history.

---

# Deletion Completion

A deletion workflow should have observable completion state.

It should be possible to determine:

- pending;
- partially completed;
- completed;
- failed.

---

# Deletion Retry

Cross-store deletion should be retryable and idempotent.

Failure in one subsystem must not silently stop the workflow.

---

# Backups

Backups complicate erasure.

Deleted data may remain inside historical backup media until backup expiration.

The architecture must define:

- backup retention;
- access controls;
- restore behavior;
- post-restore reapplication of deletions.

---

# Restore and Re-Erasure

If a backup is restored:

```text
restore authoritative data
    ↓
reapply deletion/erasure ledger
    ↓
resume service
```

where legally/operationally required.

---

# Deletion Ledger

A durable deletion/erasure ledger may be useful so restores/rebuilds know which subjects/resources must remain erased.

This ledger itself should minimize sensitive information.

---

# Legal Hold

If legal hold requirements ever exist, they must be modeled explicitly.

Legal hold must not become a hidden exception to user-facing deletion promises.

---

# Moderation Retention

Restricted/deleted content may need temporary retention for:

- appeal;
- safety;
- legal obligations.

This retention should be isolated from ordinary product access.

---

# Privacy Versus Moderation

Moderation may retain evidence that normal product deletion removes from public/private product surfaces.

Access must be purpose-bound and auditable.

---

# Data Export

If Chronologity provides User data export, the export should include data the User is entitled to receive without exposing:

- other Users' private data;
- internal moderation evidence;
- secrets;
- operational-only identifiers.

Those four exclusions are enforced in two places rather than one, because a leak
can be introduced in either. The shaping is a set of pure builders that
construct every field explicitly and never spread a row, tested by handing them
records full of addresses and identifiers and searching the output. The reads
are keyed on the account and select only what may travel, tested by fetching a
prepared export through its own signed links and searching the artefact for
every address and Identity in the database.

The queries are the isolation story. Nothing selects by anything but the
account, so no result can belong to somebody else; the one place other people
appear is as the authors of comments and reactions on the account's own Moments,
joined for a handle and a display name and nothing more.

An export is prepared asynchronously and written in parts. Media is never
copied: the manifest points at the originals, signed for minutes at the moment
somebody asks, so the only new copy preparing an export creates is the data
itself — and that copy expires.

---

# Privacy Preferences

Privacy settings should be explicit and comprehensible.

Avoid ambiguous controls where Users cannot tell what becomes visible.

---

# Default Privacy

Default visibility should be chosen deliberately.

The architecture should support explicit defaults without hard-coding them into unrelated read logic.

---

# Privacy Versioning

Privacy policy semantics may evolve.

Stored state should use stable values.

If meanings change materially, migration/versioning must be explicit.

---

# Privacy Events

Potential authoritative events include:

```text
MomentVisibilityChanged
UserBlocked
UserUnblocked
AccountDeleted
```

Exact ownership belongs to relevant features.

---

# Privacy Integration Events

Derived systems may consume events such as:

```text
MomentEligibilityChanged
UserRelationshipVisibilityChanged
```

if stable cross-boundary contracts are needed.

---

# Privacy and Messaging

Privacy changes are high-priority messages.

Consumers should have:

- tight lag monitoring;
- retries;
- quarantine handling;
- alerts.

---

# Privacy and Search

Search indexing should fail safe.

If privacy state cannot be verified, do not expose the result.

---

# Privacy and Feed Aggregator

Feed authorization failures fail closed.

Optional enrichment may degrade.

Privacy evaluation may not.

---

# Privacy and Media Delivery

If authorization backend is unavailable, private media delivery should fail closed.

Public media may remain available according to policy.

---

# Privacy and Notifications

If eligibility cannot be verified, suppress or delay notification rather than expose private content.

---

# Privacy and Caching

When uncertain, serve from current source or deny rather than trust stale sensitive cache state.

---

# Third-Party Services

Any third-party provider receiving Chronologity data must have a defined purpose.

Potential providers:

- object storage/CDN;
- transcoding;
- push;
- email;
- analytics;
- error reporting.

Each provider should receive only required data.

---

# Provider Data Minimization

Examples:

```text
push provider
    → device token + minimal notification payload

transcoder
    → media object reference

analytics
    → pseudonymous event metadata
```

Avoid sending complete User/profile/history data.

---

# Provider Retention

Where provider controls permit, configure retention consistent with Chronologity policy.

---

# Cross-Border Data

If Chronologity later operates globally, data residency/cross-border transfer may require separate architecture decisions.

Do not prematurely design a global residency system without regulatory/product need.

---

# Children's Data

If Chronologity allows minors, privacy architecture may need additional controls.

This is a product/legal decision and is not assumed here.

---

# Biometric Data

Chronologity should not collect biometric identifiers unless an explicit product feature requires them.

Device biometric unlock should remain device-local where possible and should not transmit biometric templates to Chronologity.

---

# Sensitive Historical Content

Historical Moments may include sensitive events.

Privacy controls must remain independent of historical significance.

A historically important Moment does not become public by virtue of importance.

---

# Public Historical Record Philosophy

Chronologity may aim to preserve meaningful historical context, but that philosophy must operate within explicit privacy choices and applicable obligations.

"Historical record" is not permission to ignore deletion or access controls.

---

# Privacy Observability

Useful metrics include:

- privacy-change propagation lag;
- block propagation lag;
- deletion workflow duration;
- deletion failures;
- Search removal lag;
- CDN invalidation lag;
- unauthorized access denials;
- cache invalidation failures;
- projection rebuild privacy violations in test;
- stale visibility detections.

---

# Privacy Alerts

Alerts should exist for:

- privacy consumer stalled;
- deletion workflow failed;
- Search removal backlog;
- CDN purge failure;
- authorization cache invalidation failure;
- blocked User exposure detected;
- sensitive log-field detection.

---

# Privacy Auditing

Privileged access to sensitive data should be auditable.

Potential examples:

- moderation evidence view;
- exact Location access by privileged role;
- security operations;
- deletion override/legal hold.

Ordinary public reads do not need full audit logs.

---

# Testing

## Visibility Tests

Verify:

- public;
- private;
- relationship-based;
- owner;
- anonymous.

## Blocking Tests

Verify:

- Timeline;
- Search;
- notifications;
- Comments/Reactions;
- historical jumps;
- shared-context semantics.

## Location Tests

Verify:

- precision levels;
- unauthorized exact-coordinate denial;
- embedded GPS handling.

## Projection Tests

Verify privacy changes update:

- PostgreSQL read models;
- ClickHouse;
- Search;
- caches.

## Replay Tests

Verify replay does not resurrect:

- deleted User data;
- erased PII;
- private content as public;
- restricted content.

## Media Tests

Verify signed access expiry, revocation, CDN behavior, original restrictions.

## Notification Tests

Verify lock-screen-safe payloads and deep-link reauthorization.

## Logging Tests

Verify sensitive fields are scrubbed.

## Deletion Tests

Verify cross-store idempotent deletion and post-restore re-erasure behavior.

---

# Golden Privacy Change Flow

```text
1. User changes Moment from public to private.

2. API authorizes and commits authoritative visibility change.

3. Privacy-related event is published.

4. Timeline projection updates eligibility.

5. Search removes/restricts result.

6. Feed caches are invalidated/versioned.

7. Media delivery stops issuing public access.

8. CDN access expires/purges according to policy.

9. Notifications no longer reveal destination to unauthorized Users.

10. Monitoring confirms downstream convergence.
```

---

# Golden Account Deletion Flow

```text
1. User requests account deletion.

2. API performs step-up/authorization checks.

3. Sessions are revoked.

4. User/Identity enter deleted state.

5. PII erasure workflow begins.

6. Media cleanup executes.

7. PostgreSQL/ClickHouse/Search projections remove or anonymize data.

8. Caches/CDN invalidate.

9. Notification/push data is cleaned according to retention policy.

10. Deletion ledger records completion for future restore/rebuild safety.
```

---

# Day-One Privacy Requirements

Before launch, Chronologity must define and implement:

- canonical visibility model;
- blocking semantics;
- Location precision model;
- Viewer authorization rules;
- sensitive-field classification;
- authentication PII isolation;
- event PII minimization;
- externalized sensitive-data strategy;
- privacy-safe projections;
- privacy-safe replay;
- media delivery revocation;
- notification privacy;
- Search/Discovery privacy;
- cache invalidation;
- logging scrubbing;
- analytics minimization;
- account deletion workflow;
- cross-store deletion;
- deletion status/retry;
- backup retention and restore re-erasure;
- privacy propagation metrics;
- privacy alerts;
- privacy tests.

---

# Recommended Initial Privacy Architecture

```text
authoritative privacy state
        ↓
Domain/Integration Events
        ↓
authorization + projection updates
        ↓
PostgreSQL / ClickHouse / Search
        ↓
feed/media/notification/cache enforcement
```

Sensitive values that may require erasure should remain outside immutable event payloads wherever practical.

---

# Open Architectural Questions

## Visibility

- What exact visibility levels ship at launch?
- Public?
- network/followers?
- private?
- Any per-Moment custom audience?
- Recommended default: keep the initial model small.

## Blocking

- Exact directionality?
- Shared Real-World Event behavior?
- Existing Comments/Reactions?
- Search visibility?
- Causal links?

## Location

- What precision levels exist?
- Who sees exact coordinates?
- Are exact coordinates retained at all after coarse Location is established?
- How is historical Location uncertainty represented?

## PII Storage

- Which Identity fields are externalized?
- Which User profile fields are erasable?
- Does any event contain raw display name?
- How are provider IDs retained after unlink?

## Deletion

- What remains after User deletion?
- Are Moments removed?
- Anonymized?
- Retained only in moderation/legal cases?
- How long does deletion completion take?

## Backups

- Backup retention period?
- How is the deletion ledger applied after restore?
- When is data considered fully erased?

## Media

- Are originals always deleted on account deletion?
- Are public/shared historical media ever retained?
- Can Users delete individual media while retaining Moment?
- What CDN revocation SLO?

## Notifications

- How long are notification snapshots retained after source deletion?
- Are security notifications retained longer?
- What push-preview policy ships by default?

## Search

- What Search visibility rules differ from direct access?
- How quickly must privacy removal propagate?

## Analytics

- Which product analytics vendor?
- What pseudonymous identifier model?
- What retention?
- What raw content is prohibited?

## Legal/Regional

- Is global launch planned?
- Are regional data-residency requirements likely?
- Are minors in scope?
- These should remain explicit product/legal decisions rather than implicit assumptions.

---

# Architectural Invariants

1. Historical integrity does not override privacy.
2. Privacy is a backend authorization concern.
3. Privacy is broader than visibility.
4. Data minimization applies at collection, storage, replication, and logging.
5. Authentication secrets never enter the outbox, Kafka, logs, analytics, or read models.
6. Moment visibility is authoritative state.
7. Current privacy state governs current access.
8. Past public visibility does not imply permanent future access.
9. Blocking is distinct from moderation.
10. Blocking affects all relevant exposure surfaces.
11. Block propagation is privacy-sensitive.
12. Location access may be precision-based.
13. Exact Location is minimized and tightly controlled.
14. Embedded GPS does not automatically become public Location.
15. Append-only storage does not permit indefinite retention of erasable personal data.
16. Sensitive values should be externalized from immutable events where practical.
17. Event metadata follows the same privacy rules as payloads.
18. Event redaction is exceptional but possible.
19. Cryptographic erasure is optional and requires justification.
20. Identity/security PII remains separate from product profile data.
21. Session/device data is minimized.
22. IP retention is explicit.
23. Media privacy follows resource authorization.
24. Private media access is revocable.
25. Original media may have stricter access than derivatives.
26. CDN caching must not defeat revocation.
27. Notifications minimize lock-screen/email leakage.
28. Notification deep links reauthorize.
29. Search indexes cannot become a privacy bypass.
30. Discovery eligibility is at least as strict as direct access.
31. Timeline metadata must not leak restricted content.
32. Temporal zoom excludes unauthorized anchors/counts where needed.
33. Historical jumps do not reveal inaccessible targets.
34. Causal edges do not leak inaccessible endpoints.
35. Historical significance does not override privacy.
36. Every projection documents its privacy/delete/replay behavior.
37. Replay must not resurrect deleted or erased data.
38. Denormalized read models minimize sensitive duplication.
39. Cache isolation is part of privacy correctness.
40. Privacy cache invalidation is high priority.
41. Mobile cached private data has logout/account-switch policy.
42. Logs avoid private payloads by default.
43. Traces avoid raw sensitive request variables.
44. Metrics avoid User/entity high-cardinality identifiers.
45. Error reporting scrubs sensitive data.
46. Analytics is not a shadow product database.
47. Analytics uses minimum necessary data.
48. Data classification influences access and retention.
49. Retention is explicit per data category.
50. Product deletion and physical erasure are distinct.
51. Account deletion is a cross-system workflow.
52. Deletion is observable, retryable, and idempotent.
53. Backups participate in privacy architecture.
54. Restores reapply deletion/erasure state.
55. Moderation/legal retention is isolated from normal product access.
56. Third-party providers receive only necessary data.
57. Provider-specific retention/access is considered.
58. Historical importance does not force public exposure.
59. Privacy changes are monitored for downstream convergence.
60. Privileged sensitive-data access is auditable.
61. Privacy behavior receives direct integration and replay testing.
62. Architecture documentation changes when privacy guarantees or retention semantics change.

---

# Guiding Principle

When designing a feature that stores or exposes User-related data, ask:

> **What is the minimum information Chronologity needs to preserve the historical meaning of this feature, who should be able to access it now, and how can we later restrict, delete, or erase it without corrupting unrelated historical structure?**

Privacy should be designed into the system's sources of truth, projections, and delivery paths—not retrofitted at the UI layer.
