# Chronologity Notifications Architecture

## Purpose

This document defines the notifications architecture for Chronologity.

Notifications are a derived and/or authoritative product mechanism for informing Users about meaningful activity, security changes, moderation outcomes, and other events that require attention.

The architecture must distinguish:

```text
notification state
        ≠
delivery attempt
        ≠
provider receipt
        ≠
underlying domain truth
```

A notification is not the source of truth for the event that caused it.

This document defines:

- notification ownership;
- authoritative versus derived notification state;
- notification generation;
- delivery channels;
- read/unread state;
- dismissal;
- preferences;
- security notifications;
- social/activity notifications;
- aggregation and deduplication;
- deep-link behavior;
- authorization;
- privacy;
- retries;
- idempotency;
- provider integrations;
- mobile behavior;
- observability;
- testing;
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
- `docs/architecture/feed.md`.

---

# Core Principle

A notification informs a User about another fact.

It does not create that fact.

Conceptually:

```text
Integration Event
    ↓
notification generation
    ↓
Notification
    ↓
delivery attempt(s)
    ↓
push / email / in-app
```

The governing rule is:

> **Notification state must remain independent from delivery-provider state and must never become the authority for the underlying product event.**

---

# Notification Categories

Chronologity should distinguish notification categories by semantics.

Potential categories include:

```text
social/activity
security
moderation
system/product
```

The exact canonical category set should remain small and meaningful.

---

# Social / Activity Notifications

Potential examples:

- Reaction received;
- Comment received;
- Reply received;
- relevant relationship activity;
- Timeline-related activity where product-defined.

These notifications may be aggregatable and preference-controlled.

---

# Security Notifications

Potential examples:

- new Session created;
- primary email changed;
- OAuth provider linked;
- two-factor enabled;
- two-factor disabled;
- all Sessions revoked;
- suspicious authentication activity.

Security notifications may have stronger delivery requirements than ordinary social notifications.

They should generally not be suppressible through normal engagement-notification preferences where doing so would materially weaken account security.

---

# Moderation Notifications

Potential examples:

- report received;
- content restricted;
- content restored;
- appeal status changed;
- account suspended;
- moderation decision issued.

Moderation notifications are tied to authoritative moderation state.

They should be designed to communicate current actionable status rather than merely echo internal moderation events.

---

# System / Product Notifications

Potential examples:

- important service announcements;
- mandatory policy/terms notices;
- product-critical account notices.

These should be used sparingly.

Chronologity should not abuse notification infrastructure for promotional noise.

---

# Notification Ownership

The canonical API includes:

```text
features/notifications/
```

This feature owns notification lifecycle where notification state is authoritative or operationally significant.

It may own:

- notification identity;
- recipient;
- category/type;
- source reference;
- creation state;
- read/unread state;
- dismissal state;
- aggregation state;
- delivery eligibility;
- delivery-attempt coordination.

It does not own the source event that caused the notification.

---

# Underlying Source

Every notification should reference the underlying domain context where appropriate.

Examples:

```text
Moment ID
Reaction ID
Comment ID
Moderation Case ID
Session ID
User ID
```

The notification should not duplicate more source data than necessary.

---

# Notification Source of Truth

A notification may be authoritative as a notification record.

For example:

```text
NotificationCreated
NotificationRead
NotificationDismissed
```

may be authoritative facts about the notification itself.

However:

```text
ReactionAdded
```

remains authoritative for the Reaction.

The notification merely references it.

---

# Event-Sourced Versus Relational Notification State

Notification is one of the features that should be evaluated pragmatically.

Two viable models exist.

## Event-sourced notification

Potential benefits:

- lifecycle auditability;
- clear read/dismiss state history;
- consistent event model.

Potential costs:

- very high event volume;
- limited value from full history;
- more replay complexity.

## Relational-authoritative notification

Potential benefits:

- simple high-volume updates;
- natural unread/read queries;
- easier aggregation.

The recommended initial direction is:

> **PostgreSQL is the authoritative notification store, as it is for every other feature (ADR-092).**

Notification-related Integration Events may still be published regardless.

---

# Notification Record

A notification record may include:

```text
notificationId
recipientUserId
type
category
sourceType
sourceId
createdAt
readAt
dismissedAt
aggregationKey
priority
deepLinkTarget
```

Sensitive content should be minimized.

---

# Notification ID

Each logical notification has a stable application-generated Notification ID.

It is separate from:

- the identifier of the Integration Event that prompted it;
- provider message ID;
- push token;
- delivery-attempt ID.

---

# Notification Generation

Notifications should normally be generated asynchronously from authoritative events.

Conceptually:

```text
ReactionAdded
    ↓
notification consumer
    ↓
evaluate recipient eligibility/preferences
    ↓
create Notification
```

This prevents ordinary social notification generation from extending command latency.

---

# Security Notification Generation

Security notifications may be generated synchronously or asynchronously depending on urgency.

The important requirement is reliable creation/delivery intent.

For critical security events, a successful underlying command should not be considered contingent on email/push delivery success.

---

# Notification Candidate

A useful conceptual distinction is:

```text
Notification Candidate
        ↓
eligibility/preferences/aggregation
        ↓
Notification
```

Not every change must produce a notification.

---

# Eligibility

Before creating a notification, the system should evaluate:

- recipient exists;
- recipient/account state;
- source remains eligible;
- blocking;
- privacy;
- notification preferences;
- category-specific mandatory rules;
- aggregation/deduplication.

---

# Authorization

A notification must not reveal information the recipient is not allowed to know.

Example:

```text
User loses access to private Moment
        ↓
stale Reaction notification exists
        ↓
notification open must reauthorize destination
```

A notification is not a permanent access grant.

---

# Notification Content

Stored notification content should minimize duplicated source data.

Prefer:

```text
type
source IDs
small display snapshot if justified
```

over storing full Moment/User copies.

Display snapshots may be useful to preserve understandable notification history, but privacy/deletion behavior must be explicit.

---

# Live Composition Versus Snapshot

Two models exist.

## Live composition

Notification references source entities and resolves display data at read time.

Advantages:

- current privacy;
- current names/content.

Risks:

- old notifications may become unintelligible;
- more read fan-out.

## Snapshot composition

Notification stores a small display snapshot at creation.

Advantages:

- stable historical notification text;
- fewer reads.

Risks:

- stale/private/deleted information;
- PII duplication.

Chronologity should prefer a hybrid model:

```text
stable notification semantics
+
minimal safe snapshot
+
current authorization at read/open time
```

---

# Deep Links

Notifications should link into current product context.

Potential targets:

```text
Moment
Timeline around Moment
Moderation case/status
Security/session settings
User profile
```

The deep link should use stable IDs, not UI coordinates.

---

# Timeline Deep Links

For a notification referencing a Moment:

```text
Notification
    ↓
Moment ID
    ↓
feed aggregator
    ↓
GetTimelineAroundMoment
    ↓
current authorized context
```

This keeps notification navigation aligned with Timeline architecture.

---

# Destination Reauthorization

Every deep-link destination must be reauthorized when opened.

If unavailable:

- show semantic unavailable state;
- do not leak restricted metadata;
- preserve the notification record if product semantics require.

---

# Read State

Read/unread is notification state.

A read transition may be authoritative relational state or a command/event depending on the final model.

Conceptually:

```text
MarkNotificationRead
```

is a command because it changes state.

---

# Dismissal

Dismissal is distinct from read.

```text
read
    → User has seen/opened it

dismissed
    → User intentionally removes/hides it
```

If the product does not need dismissal, do not add it merely because many notification systems have it.

---

# Bulk Read

The system may support:

```text
MarkAllNotificationsRead
```

or category-scoped bulk read.

This operation should be bounded/efficient.

Avoid emitting one independent command/event per notification if a scalable current-state representation can handle bulk semantics.

---

# Unread Count

Unread count is derived from notification state.

It may be projected/cached.

The count itself is not authoritative.

---

# Notification Ordering

Notifications should typically order by:

```text
notification creation time
+
deterministic tie-breaker
```

This is product-notification chronology, not Moment occurrence chronology.

Do not confuse the two.

---

# Notification Pagination

Use keyset/cursor pagination for large notification histories.

Offset pagination may become unstable under new inserts.

---

# Retention

Notification history retention should be explicit.

Not every notification must live forever.

Retention may vary by category:

```text
social
security
moderation
system
```

Security/moderation records may have longer retention than ordinary activity.

---

# Aggregation

High-volume social activity should be aggregatable.

Example:

```text
User A reacted
User B reacted
User C reacted
```

may become:

```text
3 people reacted to your Moment
```

Aggregation reduces noise.

---

# Aggregation Is Not Ranking

Aggregation groups semantically similar notifications.

It does not rank or suppress history based on engagement.

---

# Aggregation Key

An aggregation key may include:

```text
recipientUserId
notification type
source resource
time window / aggregation generation
```

The exact design should prevent unrelated activities from collapsing together.

---

# Aggregation Window

Aggregation may be:

- fixed time window;
- until read;
- bounded by count;
- another product-defined rule.

The exact strategy belongs in product/technical specs.

---

# Aggregated Actors

An aggregated notification should not store an unbounded list of actors.

Store:

- bounded representative actor IDs;
- total count;
- source ID.

Full actor lists can be queried separately if needed.

---

# Deduplication

The notification system must prevent duplicate logical notifications from duplicate event delivery.

Potential dedupe key:

```text
sourceDomainEventId
recipientUserId
notificationType
```

or another stable key.

---

# Idempotency

Notification generation consumers must be idempotent.

At-least-once Kafka delivery must not create duplicate user-visible notifications.

---

# Notification Preferences

Users may configure notification preferences where product-defined.

Potential dimensions:

```text
category
channel
notification type
```

Preferences must remain understandable.

Avoid an excessively granular matrix initially.

---

# Mandatory Notifications

Some notifications may bypass ordinary preferences.

Potential examples:

- account security;
- legal notices;
- severe moderation/account status.

Mandatory categories should be explicitly documented and minimal.

---

# Channel Preferences

Delivery channels may include:

```text
in-app
push
email
```

In-app notification state should not be disabled merely because push/email delivery is disabled.

---

# In-App Notifications

In-app notifications are the canonical product representation of normal notification state.

They should be queryable through the API.

They do not depend on push provider availability.

---

# Push Notifications

Push is a delivery channel.

Push provider success does not define whether the notification exists.

---

# Email Notifications

Email is also a delivery channel.

Security/legal notifications may use email even when normal social email notifications are disabled, according to policy.

---

# Delivery Intent

A notification may generate one or more delivery intents.

Conceptually:

```text
NotificationCreated
    ↓
PushDeliveryRequested
EmailDeliveryRequested
```

Delivery requests are Integration Events or operational jobs.

---

# Delivery Attempt

Each provider attempt may have its own operational record.

Potential fields:

```text
deliveryAttemptId
notificationId
channel
provider
attempt
status
providerMessageId
createdAt
completedAt
errorCategory
```

These are operational delivery state.

---

# Delivery Status

Potential statuses:

```text
pending
sent
accepted
failed
expired
```

Provider-specific states should be normalized.

---

# Provider Receipt

A provider may report:

```text
accepted by provider
delivered to device
opened
bounced
```

These are provider/delivery facts.

They do not change the underlying notification truth automatically.

---

# Retry

Transient delivery failures may retry.

Permanent failures should stop.

Examples:

```text
temporary provider outage
    → retry

invalid device token
    → stop + invalidate token

permanent email bounce
    → stop + update delivery metadata
```

---

# Retry Boundaries

Retry must be bounded.

Provider delivery should never block:

- Reaction command success;
- Moment creation;
- moderation decision persistence;
- session revocation.

---

# Push Token Ownership

Push device tokens are sensitive operational credentials.

They should be stored server-side and associated with:

- User;
- device/app installation;
- platform;
- status;
- last-seen/updated time where useful.

They must not appear in client-readable general profile data.

---

# Push Token Lifecycle

The system must support:

- registration;
- refresh/change;
- invalidation;
- logout behavior;
- uninstall/provider invalidation.

---

# Multiple Devices

A User may have multiple active device tokens.

Push delivery may target all eligible active devices.

In-app notification state remains one logical User-level notification.

---

# Logout

Logout should not necessarily delete notification history.

Push token/session relationship behavior should be explicit.

A device no longer associated with the User should not continue receiving private notifications.

---

# Device Token Security

Device tokens must not be logged broadly.

They should use restricted datastore access.

---

# Email Delivery

Email delivery should use a dedicated integration adapter.

Email provider IDs and bounce data remain operational.

The domain does not need to understand provider-specific terminology.

---

# Provider Abstraction

Canonical integrations such as:

```text
integrations/push/
integrations/email/
```

should expose provider-neutral operations.

Do not leak vendor types into the notification domain.

---

# Template Rendering

Notification display text may be rendered:

- server-side;
- client-side from structured payload;
- hybrid.

The architecture should prefer structured notification semantics over storing only final English text.

---

# Localization

Structured notification types support localization.

Potential representation:

```text
type
actor IDs
source ID
count
```

allows the client/server to render localized text.

Do not make one English sentence the only canonical representation.

---

# Template Versioning

If server-rendered notification text is stored, template/version provenance may be useful.

This is not required for all notifications.

---

# Privacy and Content Leakage

Push/email channels can expose notification content on lock screens or email previews.

Sensitive notifications should minimize content.

Example:

Prefer:

```text
You have a new account security alert.
```

over exposing private details in a lock-screen notification.

---

# User-Controlled Preview

The product may eventually support notification preview privacy settings.

This is a client/product decision.

The backend should support safe minimal payloads.

---

# Blocking

Blocking should prevent notification creation/delivery for blocked interactions according to product semantics.

A stale already-created notification may remain but must reauthorize destination.

---

# Moderation

If source content becomes restricted before delivery, delivery should be suppressed where possible.

Already-delivered push content cannot always be retracted.

This reinforces the need for minimal sensitive previews.

---

# Account Suspension

A suspended User may still receive:

- moderation outcome;
- appeal update;
- security alert.

Normal social notification delivery may be suppressed.

---

# Account Deletion

Account deletion should:

- stop future notification generation;
- invalidate push tokens;
- apply notification retention/deletion policy;
- remove sensitive snapshots.

---

# Notification Read Models

The notification table is authoritative and serves API reads directly.

Mobile never reads a store other than through the API or the feed aggregator.

---

# Notification API

Conceptual REST operations include:

```text
GetNotifications
GetUnreadNotificationCount
MarkNotificationRead
MarkAllNotificationsRead
DismissNotification
UpdateNotificationPreferences
RegisterPushToken
UnregisterPushToken
```

Exact routes belong in API specs.

---

# Notification Feed

Notification history is not the Chronologity Timeline.

Do not route notification list queries through the feed aggregator merely because it resembles a feed.

Notifications belong to the API unless future scale demands a separate read service.

---

# Mobile Notification State

The mobile app should maintain:

- fetched notification pages;
- unread badge state;
- optimistic read state;
- push-received state;
- deep-link navigation state.

Server state remains authoritative.

---

# Push Receipt in Mobile

Receiving a push may:

- show OS notification;
- update badge;
- trigger background refresh;
- navigate on tap.

It should not be treated as proof that the backend notification has been marked read.

---

# Mark Read

A notification should generally become read when:

- User explicitly opens it;
- client performs a successful read command according to product semantics.

Simply receiving the push is insufficient.

---

# Badge Count

Badge count should derive from current unread state.

The mobile client may optimistically adjust it but should reconcile with server state.

---

# Offline Behavior

Offline notification history may display cached entries.

State changes such as mark-read may be queued/retried.

The client must handle conflicts/reconciliation safely.

---

# Notification Ordering Across Devices

Read state is User-level.

If one device marks a notification read, another device should eventually reflect that state.

---

# Realtime In-App Updates

Chronologity may later use WebSocket/SSE/push-triggered refresh for realtime in-app notification updates.

Realtime transport is optional.

Polling/refresh may be sufficient initially.

Do not introduce a realtime service until product requirements justify it.

---

# Notification and Timeline Freshness

A notification may arrive before the destination Moment appears in the Timeline projection.

Opening it should handle temporary projection lag.

Possible behavior:

```text
notification open
    ↓
destination exists authoritatively
    ↓
Timeline projection pending
    ↓
show processing/pending context or retry resolution
```

Do not falsely report "not found" solely because projection lag exists if authoritative state confirms existence.

---

# Security Notifications and Timeline

Security notifications generally deep link to account/security screens, not Timeline.

Keep those flows separate.

---

# Moderation Notifications and Timeline

Moderation notifications may deep link to:

- moderation status;
- appeal flow;
- affected Moment context if still accessible.

---

# Notification Delivery and Analytics

Delivery/open analytics may be collected as operational/product analytics.

They do not change notification authority.

---

# Metrics

Important metrics include:

- notification candidates;
- notifications created;
- notifications suppressed;
- aggregation rate;
- duplicate suppression;
- unread counts;
- push requested/sent/failed;
- email requested/sent/failed;
- invalid push tokens;
- delivery latency;
- provider latency;
- read latency;
- deep-link failure;
- notification generation lag.

---

# Observability

A notification should be traceable:

```text
source Integration Event
    ↓
notification generation
    ↓
Notification ID
    ↓
delivery intent
    ↓
provider attempt
    ↓
mobile deep link
```

---

# Logging

Logs may include:

- Notification ID;
- source Event ID;
- recipient User ID where appropriate;
- channel;
- delivery result;
- provider message ID;
- correlation ID.

Avoid logging:

- full push content;
- private source content;
- device token;
- email address unless strictly needed.

---

# Alerts

Potential alerts:

- notification-generation consumer stalled;
- push-provider outage;
- email-provider outage;
- high invalid-token rate;
- delivery failure spike;
- security-notification failure;
- aggregation backlog;
- notification projection lag.

---

# Rate Limiting / Notification Abuse

The system should protect Users from notification flooding.

Potential controls:

- aggregation;
- per-source throttling;
- abuse suppression;
- notification type limits.

Rate limits must not suppress mandatory security/moderation notices.

---

# High-Volume Reactions

Popular Moments may receive very high Reaction volume.

The system should aggregate rather than create one notification per Reaction indefinitely.

Possible strategy:

```text
first Reaction
    ↓
create aggregate notification

subsequent Reactions
    ↓
increment actor/count summary
```

The exact aggregation algorithm should be deterministic and idempotent.

---

# Comments and Replies

Comments/replies may deserve separate notifications because they carry higher semantic value than simple Reactions.

Aggregation rules can differ by notification type.

---

# Self-Notifications

The system should generally not notify a User about their own action unless the product explicitly requires it.

---

# Duplicate Source Events

Duplicate Kafka delivery must not create duplicate logical notifications.

Use stable deduplication keys.

---

# Notification Expiration

Some notifications may expire operationally.

Example:

- temporary invitation or action prompt.

Expired notification behavior should be explicit.

Historical social notifications may simply age out by retention policy.

---

# Actionable Notifications

A notification may contain one or more actions.

Examples:

```text
view Moment
review security activity
open appeal
```

Actions should map to explicit product routes/commands.

Do not encode arbitrary executable instructions in notification payloads.

---

# Notification Priority

A small priority model may distinguish:

```text
normal
high
critical
```

Priority may affect:

- channel selection;
- delivery retry;
- presentation.

Do not use priority as an engagement-ranking system.

---

# Quiet Hours

User-configurable quiet hours may apply to normal push notifications.

Critical security notifications may bypass them according to policy.

This is a product preference decision.

---

# Time Zones

Notification delivery scheduling/preferences should use the User's configured/local timezone where relevant.

Stored notification timestamps remain canonical UTC.

---

# Scheduled Notifications

Chronologity should avoid scheduled notification infrastructure unless a concrete product use case requires it.

Most notifications are event-driven.

---

# Provider Failure

If a push/email provider is unavailable:

- notification record still exists;
- delivery attempts retry according to policy;
- in-app notification remains accessible.

This separation is essential.

---

# Provider Migration

Vendor-specific identifiers must not leak into core notification contracts.

A provider can be changed without rewriting notification domain semantics.

---

# Multiple Push Providers

If iOS/Android delivery paths differ, normalize them behind the push integration.

The notification domain should request:

```text
deliver push to User/device
```

not APNs/FCM-specific operations.

---

# Testing

## Generation Tests

Verify:

- the expected Integration Event creates a candidate;
- self-action suppression;
- privacy/blocking suppression;
- preference handling;
- mandatory notification handling.

## Deduplication Tests

Verify duplicate event delivery creates one logical notification.

## Aggregation Tests

Verify:

- count increments;
- representative actors bounded;
- unrelated sources do not merge;
- concurrent updates remain correct.

## Read-State Tests

Verify:

- mark read;
- mark all read;
- idempotency;
- multi-device convergence.

## Delivery Tests

Verify:

- push intent;
- email intent;
- retry;
- invalid token;
- provider outage;
- permanent bounce.

## Deep-Link Tests

Verify:

- current authorization;
- deleted source;
- blocked source;
- projection lag;
- Timeline-around-Moment resolution.

## Security Tests

Verify security notifications bypass ordinary preference suppression where policy requires and do not leak sensitive lock-screen content.

## Integration Tests

Use provider sandbox/fakes and real PostgreSQL/Kafka behavior where relevant.

---

# Golden Notification Flow

```text
1. ReactionAdded is committed authoritatively.

2. Messaging delivers the event to notification generation.

3. Consumer checks recipient, blocking, privacy, preferences, and dedupe.

4. Notification is created or aggregated in PostgreSQL.

5. PushDeliveryRequested is emitted if push is enabled.

6. Push provider receives the delivery attempt.

7. Mobile receives push and refreshes notification state.

8. User opens notification.

9. Mobile marks notification read.

10. If destination is a Moment, feed aggregator reauthorizes and resolves current Timeline context around that Moment.
```

---

# Day-One Notification Requirements

Before launch, Chronologity must define and implement:

- authoritative notification storage model;
- notification categories/types;
- Notification ID;
- generation consumers;
- eligibility rules;
- blocking/privacy suppression;
- self-action suppression;
- preferences;
- mandatory security/moderation notification policy;
- deduplication;
- aggregation for high-volume activity;
- read/unread state;
- bulk mark-read;
- unread count;
- keyset pagination;
- push-token registration/lifecycle;
- push delivery;
- email delivery where required;
- provider-neutral adapters;
- delivery retries;
- invalid-token handling;
- deep links;
- current destination authorization;
- Timeline-around-Moment resolution;
- account suspension/deletion behavior;
- observability;
- provider failure handling;
- generation/dedup/aggregation/delivery/deep-link tests.

---

# Recommended Initial Architecture

```text
authoritative change, published through the outbox
        ↓
Kafka
        ↓
Notification Generator
        ↓
PostgreSQL authoritative notification state
        ↓
optional Integration Events
        ├── PushDeliveryRequested
        └── EmailDeliveryRequested
                ↓
          delivery workers
                ↓
            providers

apps/mobile
    ↓ REST
apps/api
    ↓
notification queries + read state

Moment deep link
    ↓
apps/feed-aggregator
    ↓
current Timeline context
```

---

# Open Architectural Questions

## Authoritative Model

- Are security and moderation notifications stored differently from ordinary ones?

## Notification Types

- What exact types ship at launch?
- Reactions?
- Comments?
- Replies?
- Follows/subscriptions?
- Moderation?
- Security?
- System?

## Aggregation

- Which notification types aggregate?
- What aggregation window?
- Until read?
- Time-based?
- How many representative actors are stored?

## Preferences

- Which categories can Users disable?
- Which channels can be disabled?
- Which security/moderation types are mandatory?
- Are quiet hours supported at launch?

## Push Provider

- APNs directly?
- FCM?
- Expo push service?
- Another provider?
- How are tokens mapped across platforms?

## Email Provider

- Which provider?
- Which notification categories use email?
- How are bounces/complaints handled?

## Realtime

- Is push-triggered refresh enough?
- Do we need WebSocket/SSE for in-app notification list updates?
- Recommended default: no dedicated realtime channel initially unless needed.

## Retention

- How long are social notifications retained?
- Security notifications?
- Moderation notifications?
- Does dismissal remove or only hide?

## Deep Links

- Exact target model?
- Generic target union?
- How is projection lag handled?
- How does client preserve return context?

## Security

- Which security events must always notify?
- Which channels are mandatory?
- What preview text is safe on lock screens?

---

# Architectural Invariants

1. Notifications do not create the underlying domain fact.
2. Notification state is distinct from provider delivery state.
3. Provider success does not define notification existence.
4. Notification IDs are distinct from Integration Event IDs and provider IDs.
5. Notification generation is normally asynchronous.
6. Not every change produces a notification.
7. Eligibility is evaluated before creation/delivery.
8. Notifications must not reveal inaccessible content.
9. Notification deep links reauthorize destinations.
10. Notification existence never grants access.
11. Stored notification payloads minimize duplicated sensitive source data.
12. A hybrid minimal-snapshot + current-authorization model is preferred.
13. Read/unread is notification state.
14. Read is distinct from delivery.
15. Read is distinct from dismissal.
16. Unread count is derived.
17. Notification ordering is not Moment occurrence chronology.
18. Notification history uses bounded pagination.
19. High-volume activity should aggregate.
20. Aggregation does not become engagement ranking.
21. Aggregated actor lists are bounded.
22. Duplicate event delivery creates at most one logical notification.
23. Notification generation consumers are idempotent.
24. User preferences apply according to notification category/channel.
25. Security-critical notifications may bypass ordinary preferences.
26. In-app notification state exists independently of push/email.
27. Push and email are delivery channels.
28. Delivery attempts are operational state.
29. Provider receipts do not mutate underlying domain truth automatically.
30. Delivery retries are bounded.
31. Invalid push tokens are retired.
32. Push tokens are sensitive operational credentials.
33. Multiple devices may receive one User-level notification.
34. Logout prevents stale device delivery where appropriate.
35. Provider-specific types stay behind integration adapters.
36. Structured notification semantics are preferred over English-only canonical text.
37. Localization does not change notification meaning.
38. Lock-screen/email previews minimize sensitive data.
39. Blocking suppresses relevant notifications according to product semantics.
40. Moderation restriction can suppress pending delivery.
41. Suspended Users may still receive moderation/security notices.
42. Account deletion stops future generation and applies retention/deletion policy.
43. Notification queries belong in the API, not feed aggregator.
44. Mobile cached notification state is not authoritative.
45. Receiving push does not mark a notification read.
46. Read state converges across devices.
47. Realtime transport is optional, not assumed.
48. Notification deep links must handle Timeline projection lag.
49. Delivery/open analytics remain derived operational data.
50. Notification-generation lag is observable.
51. Logs avoid raw device tokens and private notification payloads.
52. Notification flooding is mitigated through aggregation/throttling.
53. Mandatory notifications are not suppressed by normal anti-noise controls.
54. Users are generally not notified about their own actions.
55. Actionable notification commands/routes are explicit.
56. Notification priority is not a social ranking mechanism.
57. Provider outage does not erase notification state.
58. Provider migration does not change domain semantics.
59. Real delivery/provider integration tests are required.
60. Architecture documentation changes when notification authority or delivery semantics change.

---

# Guiding Principle

When designing a notification capability, ask:

> **What underlying fact does the User need to know, should Chronologity create one durable notification for it, and how can that notification remain useful without becoming a source of authority, a privacy leak, or a noisy substitute for the Timeline itself?**

Notifications should surface meaningful attention without distorting the historical product model.
