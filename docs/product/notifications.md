# Chronologity Notifications

## Purpose

This document defines the product semantics of **Notifications** in Chronologity.

Notifications inform a User that something relevant has happened in Chronologity without redefining the historical meaning, chronological position, or significance of the Moment or other resource involved.

The central question is:

> **How should Chronologity inform Users about new activity while preserving the distinction between activity time and historical occurrence time, respecting privacy, and avoiding an engagement system that competes with the product's chronological and historical purpose?**

This document defines user-facing notification behavior and invariants rather than queue topology, push providers, Kafka topics, database schemas, retry policies, or delivery infrastructure.

## Definition

A **Notification** is a user-facing representation of an activity or state change that Chronologity determines should be brought to a User's attention.

Conceptually:

```text
Underlying activity or state change
              |
              v
Notification eligibility
              |
              +-- recipient relevance
              +-- authorization
              +-- privacy
              +-- moderation
              +-- preferences
              +-- aggregation
              |
              v
        Notification
              |
              +-- in-app
              +-- push
              +-- future channels
```

A Notification is not the underlying event itself.

It is a derived communication about that event.

## Notifications Are About Activity, Not Historical Position

Chronologity must distinguish at least three temporal concepts:

```text
Moment occurrence time
        !=
Activity time
        !=
Notification delivery time
```

For example:

```text
Moment occurred:        July 20, 1969
Comment added:          August 10, 2026
Notification delivered: August 10, 2026
```

The notification is recent because the comment is recent.

The Moment does not become recent history because someone commented on it.

This distinction is foundational.

## Notification Time

Notifications should generally be ordered according to the time of the activity or state change that caused the notification, not the occurrence time of the historical Moment involved.

This makes the notification surface an activity-oriented experience rather than a historical chronology.

That does not permit the notification system to mutate or reinterpret the Timeline.

## Notification Causes

Chronologity may generate notifications for meaningful activities such as:

- a User following or subscribing to another User where the social model permits it;
- a Reaction to a User's Moment;
- a Comment on a User's Moment;
- a reply to a User's Comment;
- a mention or explicit reference where supported;
- a relevant change to a shared or associated historical context;
- moderation or safety actions;
- account or security events;
- media processing states that require User attention;
- privacy-sensitive changes requiring notice;
- and future product activities explicitly defined as notification-worthy.

Not every domain or integration event should create a User notification.

```text
Software event != User notification
```

Notification eligibility is a product decision.

## Notification Categories

Notifications should be categorized by their purpose rather than treated as one undifferentiated stream.

Conceptually, categories may include:

```text
Social activity
Historical/context activity
System/account
Media processing
Moderation/safety
Security
```

Categories may have different delivery rules, preference controls, urgency, aggregation behavior, and retention expectations.

## Social Notifications

Social notifications may communicate activity such as:

- new followers or subscriptions;
- Reactions;
- Comments;
- replies;
- mentions; and
- other explicit social interactions.

Social activity must not imply historical significance.

A Moment receiving many notifications-generating interactions does not become more historically important merely because it is receiving attention.

## Historical and Context Notifications

Chronologity may eventually notify Users about meaningful changes to historical context, such as:

- a confirmed association with a real-world Event;
- a correction affecting a resource the User owns or follows;
- a newly established causal relationship;
- a material contextual addition to shared history; or
- another historical change that directly affects the User's experience.

These notifications require particular care because they concern the historical model itself.

The notification should communicate the change without implying greater certainty than the underlying historical relationship supports.

## System and Account Notifications

System notifications may communicate:

- account changes;
- important preference changes;
- operational states requiring User action;
- service-related notices;
- or other account-level information.

These notifications are not historical content and should not be forced into Moment or Timeline semantics.

## Security Notifications

Security notifications may include important account-protection events such as a material authentication or credential change.

Security-critical notifications may not be suppressible through ordinary social-notification preferences.

The exact security events and channels belong in security and architecture documentation.

## Moderation and Safety Notifications

Notifications may communicate:

- report outcomes;
- content restrictions;
- enforcement actions;
- appeal status;
- safety warnings; or
- other moderation states.

Notification previews must not unnecessarily reproduce harmful or restricted content.

A moderation notification should communicate the action and available next step without redistributing the material that caused the action.

## Media Processing Notifications

Chronologity may notify a User when a media operation requires attention.

Examples include:

- processing failure;
- upload failure requiring intervention;
- unsupported media;
- or completion of a sufficiently long-running operation where a notification materially improves usability.

Routine successful processing should not automatically generate noisy notifications.

The media specification defines which media states are visible to Users; this document defines when those states warrant active notification.

## Notification Eligibility

Before creating or delivering a notification, Chronologity should evaluate whether the recipient is eligible to know about the underlying activity.

Conceptually:

```text
Activity
   |
   v
Recipient relevant?
   |
   +-- No -> no notification
   +-- Yes
          |
          v
Authorized to know?
   |
   +-- No -> no notification
   +-- Yes
          |
          v
Allowed by privacy / moderation / blocking?
   |
   +-- No -> no notification
   +-- Yes
          |
          v
Preference permits delivery?
   |
   +-- No -> suppress optional delivery
   +-- Yes -> notify
```

Authorization and privacy are prerequisites.

Preferences cannot grant access that the User otherwise lacks.

## Notification Privacy

Notifications can leak information even when the underlying resource is protected.

Potential leaks include:

- names;
- profile images;
- Moment captions;
- media thumbnails;
- Comment text;
- Event names;
- Locations;
- exact timestamps;
- relationship information;
- historical associations; and
- the existence of restricted activity itself.

Therefore, notification content must be generated from recipient-authorized information.

A notification is not exempt from privacy merely because it is short-lived or appears outside the main application.

## Privacy Changes After Creation

Authorization may change after a Notification is created.

For example:

1.  User A comments on a Moment.
2.  User B receives a notification.
3.  The Comment or Moment becomes inaccessible to User B.

Chronologity must not assume that historical notification content remains permanently safe to display.

Where practical, notification rendering should use current authorization or a privacy-safe snapshot whose retention semantics are explicitly defined.

Opening a notification must always reauthorize access to its destination.

## Notification Previews

Notification previews should reveal the minimum information needed to make the notification useful.

For example, a notification may say:

```text
Alex commented on your Moment.
```

rather than reproducing a sensitive Comment in full.

Richer previews may be appropriate when the recipient remains authorized and the content is safe to expose.

External push notifications require stricter preview defaults because they may appear on lock screens or other surfaces visible to people other than the account owner.

## Push Notification Privacy

Push notifications should assume that device surfaces may be observable by others.

Sensitive content should therefore be minimized by default.

Chronologity should support privacy-preserving push text even when richer context is available inside the application.

The application can reveal additional authorized detail after the User opens it.

## Notification Destination

A notification should normally lead to the most relevant authorized product context.

Examples:

```text
Reaction notification
    -> relevant Moment

Comment notification
    -> relevant Comment within Moment context

Follow notification
    -> relevant User/profile

Event-context notification
    -> relevant Event or affected Moment

Moderation notification
    -> moderation status/details
```

The destination should preserve historical context rather than creating a separate duplicate representation of the underlying resource.

## Destination Reauthorization

Every notification destination must be authorized at access time.

A Notification created under an earlier authorization state is never proof that the User may still access the destination.

If access has been revoked, Chronologity should provide a safe unavailable state rather than exposing stale content.

## Deleted Destinations

A notification may outlive the resource that caused it.

If its destination has been deleted, removed, or is no longer accessible, the notification should not lead to a broken privacy bypass.

Chronologity may:

- remove the notification;
- retain a privacy-safe activity record with no accessible destination;
- or show that the content is no longer available.

The exact behavior may differ by notification category.

## Notification Ordering

The primary notification list should be ordered by notification/activity time, generally newest first.

This is intentionally different from the Timeline.

```text
Timeline       -> historical occurrence order
Notifications  -> recent activity order
```

Chronologity should not force historical chronology onto an activity inbox.

Likewise, Notification ordering must never be used as evidence of Moment occurrence order.

## Grouping and Aggregation

Repeated similar activity may be aggregated to reduce noise.

For example:

```text
Alex, Jordan, and 8 others reacted to your Moment.
```

rather than ten nearly identical notifications.

Aggregation should preserve useful information without implying that engagement volume changes the Moment's historical significance.

Aggregation rules may consider:

- activity type;
- target;
- time window;
- recipient;
- actors;
- and read state.

## Aggregation Across Historical Time

Aggregation should be based on notification activity, not on how close the underlying Moments are in historical occurrence time.

Two Reactions occurring today on two Moments from 1995 and 2020 are two recent activities involving different historical resources.

Historical proximity is not a default aggregation rule.

## Mixed Notification Types

Chronologity should avoid aggregating semantically different actions merely because they concern the same Moment.

For example:

```text
Reactions
Comments
Moderation changes
Historical-context corrections
```

carry different meanings and may require different User actions.

Aggregation should preserve those distinctions.

## Actor Identity in Aggregation

Aggregated notifications may display representative actors.

The system must respect current identity visibility, blocking, deletion, and privacy.

An actor who is no longer visible to the recipient should not remain exposed merely because their identity was previously captured in an aggregate.

## Read State

Notifications should support at least:

```text
unread
read
```

Read state is User-specific activity state.

It does not alter the underlying Moment, Comment, Reaction, Event, or other resource.

Reading a notification must not imply acknowledgement, approval, historical verification, or social response.

## Marking as Read

A notification may become read when:

- the User explicitly marks it read;
- the User opens it;
- or another clearly defined interaction occurs.

The exact interaction behavior should be consistent and predictable.

Chronologity should avoid aggressive automatic read behavior that makes Users lose track of activity before they have meaningfully encountered it.

## Unread Counts

Chronologity may display an unread count or indicator.

The count is a navigation aid, not an engagement score.

It should be derived from notifications currently eligible for the User.

Deleted, revoked, or otherwise suppressed notifications should not indefinitely inflate unread state.

## Read State Synchronization

Read state should remain consistent across the User's devices within reasonable product expectations.

Temporary synchronization lag must not affect the underlying historical record.

Read state is disposable/reconstructable product state only to the extent architecture can preserve the User experience; it is not part of Moment history.

## Notification Preferences

Users should have meaningful control over optional notifications.

Preferences may operate by:

- category;
- activity type;
- delivery channel;
- relationship;
- or future notification dimensions.

Preferences should not require Users to understand internal event names or system architecture.

## In-App Versus External Delivery

Chronologity should distinguish:

```text
Notification existence
        !=
Delivery channel
```

An activity may appear in the in-app notification center while push delivery is disabled.

Likewise, disabling push notifications should not necessarily erase the underlying in-app activity.

Channel preferences should control delivery, not redefine product history.

## Required Notifications

Some notifications may be required regardless of ordinary notification preferences, particularly:

- security;
- legal;
- safety;
- material account changes; or
- other communications Chronologity is obligated to provide.

Required notifications should be narrowly defined.

The product should not label engagement-driving messages as "required" merely to bypass User preferences.

## Notification Frequency

Chronologity should minimize notification fatigue.

A technically valid event is not automatically worthy of interruption.

Push delivery in particular should favor meaningful User value over maximizing return visits.

Chronologity should not design notifications around compulsive engagement loops.

## Batching

Non-urgent notifications may be batched or summarized.

Batching can reduce interruption while preserving awareness.

For example, multiple low-priority Reactions may be summarized rather than pushed individually.

Urgency should derive from User value, safety, or required action---not popularity.

## Quiet Hours and Delivery Timing

Chronologity may eventually support quiet hours or scheduled delivery preferences.

These affect delivery time only.

They must not alter the underlying activity timestamp or the historical occurrence time of associated Moments.

A notification delayed until morning still represents activity that occurred earlier.

## Notification Expiration

Some notifications lose utility over time.

Chronologity may define retention or expiration rules by category.

For example, a transient media-processing success may need less retention than a moderation decision.

Expiration of a notification must not delete the underlying historical resource or domain event.

## Historical Context in Notifications

When a notification references an old Moment, Chronologity should provide enough temporal context to prevent confusion.

For example:

```text
Alex commented on your Moment from July 1998.
```

may be clearer than wording that makes the Moment itself appear newly created.

The interface should distinguish:

```text
new activity on old history
```

from:

```text
newly created history
```

## Backfilled Moments

A newly published Moment may describe history from years or decades ago.

Notifications related to publication, following, or interaction must not imply that the historical event just occurred.

For example:

```text
Richard added a Moment from 2003.
```

is preferable to wording that suggests the Moment occurred today.

This distinction is especially important because Chronologity explicitly supports backfilled history.

## Notifications and Feed

Notifications must not alter Feed ordering.

A Moment receiving a new Comment, Reaction, or other notification-generating activity must not move upward in the chronological Feed merely because it became active again.

```text
New engagement
      !=
New historical occurrence
```

The notification system can surface activity without corrupting chronology.

## Notifications and Timeline

Opening a notification may enter a Moment's Timeline context.

The Timeline should place the Moment according to occurrence semantics, not notification time.

Notification activity must not create a new historical position for the Moment.

## Notifications and Discovery

Notification activity may eventually be one signal available to Discovery, but the systems remain distinct.

Chronologity should not turn notifications into a hidden mechanism for engagement-driven Discovery ranking.

A burst of notification-generating activity does not itself establish historical significance.

## Notifications and Search

Notifications may link to resources that are not globally searchable.

Searchability is not a prerequisite for a direct notification when the recipient is otherwise authorized to access the resource.

Conversely, a searchable resource does not automatically warrant a notification.

## Notifications and Historical Significance

Historical significance and notification worthiness answer different questions.

```text
Historical significance:
How important is this Moment in a particular historical context?

Notification worthiness:
Should this User be informed about this activity or change?
```

A trivial social action may warrant a notification.

A highly significant historical Moment may generate no notification at all.

The two must remain independent.

## Notifications and Causality

If a notification communicates a newly established causal relationship, it must preserve the relationship's provenance and certainty.

Chronologity must not phrase an AI-generated causal hypothesis as an established historical fact merely because it appears in a notification.

## Notifications and Real-World Events

Notifications may reference a real-world Event when it provides useful context.

For example:

```text
A Moment you contributed was associated with Anime NYC 2026.
```

The notification is about the association activity.

The real-world Event retains its own occurrence semantics.

## Notifications and Locations

Location information in notifications must use recipient-authorized precision.

A push notification must not expose an exact sensitive Location merely because the associated Moment internally contains it.

Location privacy applies equally to notification previews and destinations.

## Notifications and Blocking

Blocking must affect notification eligibility and rendering.

Chronologity must prevent blocked relationships from creating notification pathways that defeat the block.

Depending on the social-graph semantics, blocking may:

- suppress future social notifications;
- remove or sanitize existing notifications;
- prevent actor identity from appearing;
- or make destinations inaccessible.

The notification system should consume blocking rules rather than inventing its own social semantics.

## Notifications and Deleted Users

If an actor deletes their account or identity becomes unavailable, existing notifications must not indefinitely expose identity information that should no longer be displayed.

The exact retained representation depends on identity and deletion policy.

Notification denormalization must not become an accidental permanent identity archive.

## Notifications and Moderated Content

If content is removed or restricted after a notification was generated, notification previews and destinations must reflect the current moderation state.

A stale push notification already delivered to a device cannot always be recalled, which strengthens the case for minimal external previews.

In-app notifications should be updated or sanitized where appropriate.

## Notification Deduplication

Users should not receive multiple equivalent notifications because the same underlying activity was processed more than once.

At the product level:

```text
One logical notification-worthy activity
        ->
One logical notification outcome
```

Technical retries and duplicate event delivery must not become duplicate User interruptions.

## Notification Corrections

If an underlying activity is corrected, reversed, or removed, the corresponding notification may need to change.

Examples include:

- a Reaction removed;
- a Comment deleted;
- an Event association corrected;
- a moderation decision reversed;
- an identity display name changed.

Notifications are derived state and should not preserve known-invalid context as though it were immutable history.

## Reactions and Notification Noise

Chronologity should be conservative about Reaction notifications at scale.

A Moment receiving thousands of Reactions should not generate thousands of push interruptions.

Aggregation, batching, and preference controls are essential.

The product should optimize for useful awareness, not the number of notifications sent.

## Comment Notifications

Comment notifications should preserve conversational context without exposing more content than necessary.

Potential notification causes include:

- a new top-level Comment on the recipient's Moment;
- a reply to the recipient's Comment;
- an explicit mention where supported.

Chronologity should avoid notifying a User merely because they once participated in a large discussion unless they explicitly subscribe to that discussion or the product defines another clear relevance rule.

## Self-Notifications

Users generally should not receive social notifications for their own actions.

For example, reacting to one's own Moment should not generate a notification to oneself.

Exceptions may exist for asynchronous operations where the initiating User needs completion or failure feedback.

## Notification Loops

A notification should not itself generate another notification merely because it was read, opened, or delivered.

Notification-system state changes such as:

```text
delivered
read
dismissed
```

are not ordinarily notification-worthy activities.

Chronologity should prevent recursive notification loops.

## Notification Actions

Notifications may expose contextual actions where useful.

Examples could include:

- open;
- reply;
- manage;
- review;
- or dismiss.

Any action must perform normal authorization and validation.

A notification action must not become a privileged shortcut around the underlying resource's rules.

## Dismissal

Chronologity may allow Users to dismiss or remove notifications from their personal view.

Dismissal affects the notification representation, not the underlying activity.

For example, dismissing a Comment notification does not delete the Comment.

## Accessibility

Notifications must be understandable without relying solely on:

- color;
- animation;
- profile images;
- thumbnails;
- spatial layout;
- or sound.

Unread state, actor, action, target, relevant historical time, and required next steps should have accessible textual semantics.

Push and in-app notification actions should remain usable with assistive technologies.

## Notification Product Invariants

1.  A Notification is derived communication about an underlying activity or state change.
2.  A Notification is not the underlying domain event or historical Event.
3.  Moment occurrence time, activity time, and notification delivery time are distinct.
4.  Notifications are activity-oriented and should generally be ordered by activity/notification time.
5.  Notification ordering must not alter Timeline or Feed chronology.
6.  Not every software event creates a User notification.
7.  Notification eligibility is a product decision.
8.  Authorization, privacy, blocking, and moderation precede notification delivery.
9.  Preferences cannot grant access the recipient otherwise lacks.
10. Notification content must not leak inaccessible source or derived data.
11. External push previews should be more privacy-conservative than authenticated in-app views.
12. Opening a notification must reauthorize access to its destination.
13. A stale notification is never proof of current access.
14. Deleted or inaccessible destinations must fail safely.
15. Aggregation reduces noise but must preserve semantic distinctions.
16. Engagement volume represented in notifications does not determine historical significance.
17. Read state is User-specific notification state and does not alter underlying history.
18. Unread counts are navigation aids, not engagement scores.
19. Notification preferences should control optional notification categories and channels.
20. Notification existence and delivery channel are distinct.
21. Disabling push does not inherently remove in-app notifications.
22. Required notifications must be narrowly limited to legitimate security, safety, legal, account, or comparable needs.
23. Notification frequency should optimize for useful awareness rather than return visits.
24. Batching and aggregation should be used where repeated activity would otherwise create noise.
25. Delivery delays must not rewrite activity timestamps.
26. Notification expiration does not delete underlying history.
27. Notifications about old or backfilled Moments must distinguish recent activity from historical occurrence.
28. New activity must not cause an old Moment to become chronologically new.
29. Notifications must not alter Feed ordering.
30. Opening a notification into Timeline context must preserve the Moment's occurrence position.
31. Notification worthiness and historical significance are independent.
32. Searchability is not required for an authorized direct notification.
33. Searchability does not itself make an activity notification-worthy.
34. Causal notifications must preserve causal provenance and certainty.
35. Location information in notifications must respect viewer-authorized precision.
36. Blocking must prevent notification pathways that defeat the block.
37. Notification denormalization must not become an accidental permanent archive of deleted identity or restricted content.
38. Moderation changes must propagate to in-app notification visibility where applicable.
39. One logical notification-worthy activity should produce one logical notification outcome.
40. Technical retries or duplicate event delivery must not create duplicate User interruptions.
41. Notifications are derived state and may be corrected or removed when their source context changes.
42. High-volume Reaction activity should be aggregated rather than producing unbounded interruptions.
43. Users should not ordinarily receive social notifications for their own actions.
44. Notification delivery, reading, or dismissal must not recursively generate notifications.
45. Notification actions must obey the same authorization and validation as direct product actions.
46. Dismissing a notification does not delete the underlying activity.
47. Notifications must be accessible without relying solely on visual, spatial, motion, or audio cues.

## Day-One Requirements

Before launch, Chronologity must explicitly define:

- which activities generate notifications;
- notification categories;
- recipient eligibility;
- in-app notification behavior;
- push notification behavior if push ships at launch;
- notification ordering;
- read and unread state;
- unread indicators or counts;
- notification destinations;
- destination reauthorization;
- privacy-safe previews;
- handling of deleted or inaccessible destinations;
- Reaction aggregation;
- Comment and reply notification rules;
- follow/subscription notifications;
- blocking behavior;
- moderation interactions;
- User notification preferences;
- delivery-channel preferences;
- self-notification rules;
- deduplication expectations;
- historical occurrence context for old and backfilled Moments;
- accessibility; and
- deletion/privacy-change behavior for notification-derived data.

The initial release does not require:

- email notifications;
- SMS notifications;
- sophisticated machine-learned notification ranking;
- engagement-optimized send-time prediction;
- trending notifications;
- arbitrary "you may have missed" re-engagement notifications;
- daily or weekly digests;
- saved-search notifications;
- complex quiet-hour scheduling;
- notification recommendations;
- cross-device notification dismissal synchronization beyond normal account-state consistency;
- or AI-generated notification summaries.

A smaller, predictable notification system is preferable to a broad engagement system that trains Users to ignore Chronologity.

## Established Notification Decisions

These were open questions. Implementation settled them (ADR-121).

**A notification stores identifiers and nothing else.** No name, no caption, no
comment, no thumbnail — and no column that could hold one. The wording is
composed when somebody reads it, from what they may see then.

**A notification about something you can no longer see is simply absent** —
gone from the list and from the unread count, rather than blanked. Nothing has
to propagate for that to happen, because nothing sensitive was ever copied out.

**The unread count covers what you can see, not what exists.** A count that
outran the list would itself say that something was there.

**Unread activity of one kind on one thing is one entry.** Three people reacting
is one notification, not three. Reading it starts a fresh one, so "what happened
since I last looked" is what an entry means.

**People are named only where you may know who they are**, at most two, and
anybody else is counted. Somebody blocked or suspended after the fact stops
being named without anything having to be rewritten.

**Nobody is notified about their own activity.**

**Whether you are entitled to know is decided before whether you want to hear
about it.** A preference can never produce a notification you were not owed.

**Moderation and security cannot be switched off**, and they are the only two
categories that cannot. Being told what was done to your content is what makes
appealing it possible, and a preference that could silence "your password was
changed" would be the first thing somebody taking over an account turned off.

**A moderation notification never names the moderator.** It says what happened
to your content, which is what you need in order to answer it.

**Opening a notification reauthorizes.** A deep link is a pointer, never a
permission.

### How a notification leaves the application

**A delivery is a row with a due time.** The service that causes a notification
opens one per channel in the same transaction, then returns. A separate
dispatcher sends them, so no provider can delay or fail a Reaction, a Moment, a
moderation decision, or a session revocation.

**Quiet hours and digests are settled when the delivery is created**, in the
account's own time zone, and stored as an instant. They affect delivery time
only, as this document requires: the latest any setting can say is "later".

**Security ignores quiet hours; moderation waits them out.** Neither can be
switched off, and that is the only way they differ. A password changed at three
in the morning is worth waking somebody for, because by morning the account may
be gone. A moderation decision will still be there at eight, and waking somebody
for it teaches them to silence the device — which silences the security alert.

**Neither required category aggregates.** A second password change collapsing
into a standing unread entry would be announced to nobody, because the first
message has already gone.

**Email names people; push counts them.** External push assumes a lock screen is
visible to whoever is standing nearby, so it says what kind of thing happened and
never who was involved. The application shows the names once it is opened.

**The words are composed when the message is sent**, from what the recipient may
see at that instant. A notification whose subject became private while the email
sat in the queue is not sent. An email cannot be unsent.

**Device tokens are credentials.** They are stored in one table, never logged,
never returned by any read, and retired rather than deleted. Registering a token
another account holds moves it, and that account stops receiving.

**Switching a category off in the application silences its email and push too**,
because the in-app entry is the notification and the other channels carry it.
The reverse does not hold.

### Not yet built

**A real push provider.** Registration, tokens, retirement, scheduling, and
retries are all real; the adapter records what it would have sent. A provider
needs credentials and a physical device, and a test for one would have to stand
in for the boundary being tested.

**New-device sign-in alerts**, which need a notion of a recognised device that
does not exist. Without one every sign-in looks new, and an alert that fires
every time is one people learn to ignore.

**Localisation and template versioning**, which want a template system. There is
one locale.

**Historical and context notifications**, which this document warns require
particular care because they concern the historical model itself and must not
imply more certainty than the underlying relationship supports.

**Retention and expiry**, which belong with privacy and deletion — and which now
have to reach delivery records and device tokens as well.

## Open Product Questions

The following questions require deliberate resolution:

- Which notification categories ship on day one?
- Which social activities generate notifications?
- Does every Reaction generate an in-app notification before aggregation?
- What aggregation threshold or behavior should apply to Reactions?
- Should Comment Reactions generate notifications?
- Should top-level Comments notify only the Moment owner?
- Should replies notify only the directly replied-to User?
- Do mentions exist on day one?
- If mentions exist, who may mention whom?
- Can a mention create access to content the mentioned User otherwise cannot see? The recommended answer is no.
- Should Users be notified when someone follows them?
- How do follow notifications behave for private or approval-based relationships if such relationships exist?
- Should unfollowing generate a notification? The recommended answer is no.
- Should a User be notified when another User removes a Reaction? The recommended answer is no.
- Should deleted Comments remove their notifications entirely or leave a sanitized "comment no longer available" record?
- Should a Reaction notification disappear when the Reaction is removed?
- Which historical-context changes are notification-worthy?
- Should Moment owners be notified when their Moment becomes associated with a real-world Event?
- Who is authorized to create or confirm such an association?
- Should Users be notified when historical significance materially changes?
- The recommended default is no unless a concrete User-facing workflow makes the change actionable; significance should not become an engagement trigger.
- Should Users be notified about new causal relationships involving their Moments?
- How should disputed or AI-suggested causal relationships be worded?
- Which media-processing states warrant notifications?
- Should successful video processing generate an in-app notification, or should the Moment UI simply update?
- When does a long-running upload justify push delivery?
- Which system notifications are mandatory?
- Which security notifications are mandatory?
- Which moderation notifications are mandatory?
- Which notification types may Users disable?
- Should preferences operate by category, activity type, channel, or all three?
- What are the default push settings?
- Should lock-screen push previews show actor names?
- Should push previews show Moment captions?
- Should push previews ever show Comment text?
- Should push previews ever show thumbnails?
- Should Users have a "hide sensitive previews" preference independent of operating-system settings?
- Should Chronologity default to minimal push previews for everyone?
- How should exact Location information be sanitized in notifications?
- Should a notification referencing an old Moment display its occurrence year or date by default?
- What wording should distinguish "added today" from "occurred today"?
- Should notifications about newly backfilled Moments ever be sent to followers?
- If so, should they say "added a Moment from 1998" rather than imply a new occurrence? The recommended answer is yes.
- Does publishing a Moment itself generate follower notifications?
- If so, would this create too much noise for Users who bulk-import history?
- Should bulk imports suppress per-Moment notifications?
- Could a batch summary be used instead?
- Should follower notification behavior differ for live/recent Moments and historical backfills?
- Would doing so accidentally privilege recent history over older history?
- Should notifications be grouped by target Moment, actor, activity type, or a combination?
- What time window defines an aggregation group?
- Should an unread notification merge with new activity after it has been displayed?
- Should a read aggregate reopen as unread when new activity is added?
- Should notification groups display all actors or only representative actors?
- How should deleted or blocked actors be removed from aggregates?
- What precisely marks a notification read?
- Does opening the notification center mark anything read automatically?
- Should opening a notification mark only that notification read?
- Can Users mark all notifications read?
- Can Users mark a notification unread again?
- Should dismissed notifications remain available anywhere?
- How long should in-app notifications be retained?
- Should retention differ by social, moderation, security, and system category?
- Should security and moderation notices have a separate durable inbox?
- Should unread counts include mandatory system notifications?
- How quickly must unread state synchronize across devices?
- Should notification preferences synchronize across devices? The recommended answer is yes because they are account preferences.
- Should notification batching happen only for push or also in-app?
- Should low-priority push notifications be delayed?
- Should Chronologity ever optimize send time algorithmically? The recommended default is not for day one.
- Should a digest be per channel only, or per category as well? Per channel is what ships; per category would multiply a settings screen this document asks to keep understandable.
- Should a notification already read in the application still be delivered by email when its digest hour arrives?
- Should Chronologity send re-engagement notifications when there is no new direct activity? The recommended default is no.
- Should Discovery recommendations ever appear as notifications? The recommended default is no unless Users explicitly opt into a future recommendation category.
- Should "historical anniversary" notifications exist eventually?
- If so, are they Notifications, Discovery, or a separate remembrance product feature?
- How would anniversary notifications behave for approximate dates?
- Should temporal zoom or historical-jump changes ever generate notifications? Generally no; they are navigation behavior, not User activity.
- Can a notification deep-link directly into a historical jump context?
- When opening a Comment notification, should the Timeline position around the Moment be preserved?
- Should a notification to a non-searchable Moment still work? The recommended answer is yes when the User is independently authorized.
- How should a notification behave if the target becomes non-searchable but remains directly accessible?
- How quickly must privacy changes sanitize existing in-app notifications?
- Can already-delivered push content be recalled on supported platforms, and should Chronologity rely on that? The product should assume it cannot.
- Should existing notifications be removed when Users block one another?
- Should they instead remain but hide actor identity and destination?
- How does blocking interact with shared public Events?
- How should account deletion affect notifications in other Users' inboxes?
- What identity representation, if any, may remain after deletion?
- Should notification content be snapshotted or rendered dynamically from current source data?
- If snapshotted, how do privacy and deletion changes propagate?
- If dynamic, how should deleted source content be represented?
- Which notification analytics are appropriate?
- Should Chronologity measure notification open rate?
- How do we avoid turning notification metrics into incentives for engagement-maximizing product behavior?
- What metrics indicate notification quality---dismissal, muting, disablement, complaint rate, usefulness feedback?
- Should Users be able to report a notification itself?
- Should abusive notification-generating behavior trigger rate limits or moderation?
- How should notification spam from repeated Comment/reply activity be controlled?
- Should there be per-actor notification collapsing?
- Should Users be able to mute notifications from a particular Moment without changing its visibility?
- Should Users be able to mute a conversation?
- Should Users be able to mute a specific User's activity while continuing to follow them?
- Should notification mute state be distinct from blocking? The recommended answer is yes.
- Do notification preferences need a global pause?
- How should accessibility announce aggregated notifications and unread state?
- Should notification actions be available directly from push notifications?
- Which actions are safe to expose without opening the application?
- Should sensitive actions always require opening the authenticated app?
- How should notification behavior work when a User has multiple active devices?
- Should opening a push notification on one device clear the push badge on another?
- How should account logout affect device push registrations?
- Should Chronologity maintain a separate notification badge count from unread in-app notifications?
- Should the app icon badge equal unread count, a capped count, or simply indicate unread activity?

These questions should be resolved before notification infrastructure hardens assumptions about privacy, aggregation, delivery channels, or engagement behavior.

## Architecture Constraints

This document does not prescribe Kafka topics, notification tables, push providers, worker topology, retry queues, database technology, or API shape.

It does impose architectural constraints.

The system must preserve:

```text
Historical occurrence time
        !=
Activity time
        !=
Notification creation time
        !=
Notification delivery time
        !=
Notification read time
```

Notification state is derived from underlying activity and User-specific delivery/read state.

Notification creation must be idempotent at the logical product level so duplicate event processing does not create duplicate User interruptions.

Notification generation must consume authoritative privacy, authorization, moderation, social-graph, and blocking semantics rather than duplicating those rules independently.

The architecture must support current authorization checks when a User opens a notification destination.

Notification previews and denormalized data must participate in deletion, privacy-change, identity-change, blocking, and moderation propagation.

External delivery must assume that already-delivered content may be impossible to retract, favoring minimal sensitive payloads.

Aggregation must preserve the identities of the underlying logical activities sufficiently to support correction, removal, privacy changes, and deduplication without treating an aggregate as authoritative history.

Read state and delivery state must remain distinct.

Conceptually:

```text
Underlying activity
        |
        v
Notification projection
        |
        +-- eligibility
        +-- aggregation
        +-- recipient-safe presentation
        |
        v
In-app notification state
        |
        +-- unread/read
        +-- dismissed
        |
        v
Optional delivery channels
        +-- push
        +-- future channels
```

The notification system must not become a second Feed ranking system.

It must not update Moment occurrence time, Feed chronology, Timeline position, historical significance, or causal truth as a side effect of activity.

Finally, the architecture must support high-volume aggregation. Chronologity should be able to absorb a Moment receiving large amounts of social activity without translating that activity into an equivalent number of User interruptions.

## Guiding Principle

When deciding whether Chronologity should create or deliver a notification, ask:

> **Does this User need or reasonably want to know about this activity now, and can we tell them without misrepresenting when the underlying history occurred or exposing information they should not see?**

Notifications should bring Users back to meaningful context.

They should not make activity masquerade as history.
