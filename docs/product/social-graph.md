# Chronologity Social Graph

## Purpose

This document defines the product semantics of relationships between Chronologity Users.

Chronologity is a social product, but its social graph exists to support a larger purpose: helping people preserve, navigate, understand, and share chronological history. The social graph should therefore connect people without becoming an engagement-ranking system that undermines Chronologity's chronological foundation.

The central question is:

> **How should one Chronologity User establish and control an ongoing social relationship with another User?**

This document defines product behavior and invariants rather than database schemas, graph technologies, API routes, event names, projection structures, or service boundaries.

## Core Principle

Chronologity's social graph determines **relationships and access context**.

It does not determine the chronological order of history.

```text
Social graph
    → Who is connected to whom?
    → Which relationships exist?
    → Which relationship-dependent permissions apply?
    → Which Users may contribute content to a viewing scope?

Chronology
    → In what temporal order is that content presented?
```

A social relationship may affect which Moments are eligible to appear to a User.

It must not determine an opaque relevance score that reorders those Moments.

## Relationship Model

Chronologity should use a **following model** as its foundational social relationship.

Following is directional:

```text
User A ──follows──▶ User B
```

This means User A has chosen to establish an ongoing relationship through which User B's eligible activity or historical content may become available in the appropriate Chronologity surfaces.

The inverse is:

```text
User B ──is followed by──▶ User A
```

A following relationship does not inherently require reciprocity.

## Following a User Versus Following a Context

"Follow" in this document always means following a **User**. It is a
relationship between two people, and it is the one that carries approval,
requests, and blocking.

Chronologity also lets a User follow a **historical context** — a real-world
Event, a Location, or another explicitly defined scope — in order to hear about
Moments that become associated with it. That is a different relationship with
different semantics: a context is shared history rather than a person, so
nobody approves who watches it, and there is nothing there to block.

```text
Follow a User      → their eligible Moments, subject to approval
Follow a context   → Moments associated with it, no approval
```

`timelines.md` defines context following. Neither is a relationship to a
Timeline: a Timeline is derived, and is what a viewer sees when they look at a
context.

## Why Following Rather Than Friendship

A symmetric friendship model requires both Users to agree before the relationship exists:

```text
User A ◀──── friends ────▶ User B
```

That model is unnecessarily restrictive for Chronologity.

People may reasonably want to follow:

- friends;
- family members;
- acquaintances;
- creators;
- public figures;
- historians;
- photographers;
- travelers;
- communities of interest represented by individual Users; or
- people whose historical records they find meaningful.

Requiring mutual friendship would make many legitimate relationships awkward.

Chronologity should therefore treat following as directional while allowing privacy controls to require approval where appropriate.

## Follow

A **Follow** is an ongoing directional relationship from one User to another.

Conceptually:

```text
Follower ──follows──▶ Followed User
```

A Follow is not:

- a Moment;
- a reaction;
- a one-time view;
- a notification subscription independent of the social relationship;
- proof that the Users know each other;
- proof of endorsement;
- proof of friendship; or
- permission to access everything the followed User has created.

Following expresses social interest, not unrestricted authorization.

## Followers and Following

For a given User:

- **Followers** are Users who follow that User.
- **Following** are Users that User follows.

These sets may overlap but are not equivalent.

```text
A follows B
B follows A
```

creates two directional relationships, not one special symmetric relationship.

This distinction is important because either User can independently remove their own outgoing Follow.

## Mutual Following

When two Users follow each other, they are **mutual followers**.

```text
User A ──follows──▶ User B
User A ◀──follows── User B
```

Mutual following may become useful product context, but it should not initially create a separate durable relationship type such as `Friendship`.

The mutual state can be derived from two existing Follow relationships.

```text
Mutual follow = A follows B AND B follows A
```

Chronologity should avoid persisting redundant social concepts unless they acquire distinct product semantics.

## Public and Approval-Based Following

A User's privacy configuration may determine whether another User can follow them immediately or must request approval.

Conceptually:

```text
Open follow:
A requests follow
      ↓
Follow exists

Approval-based follow:
A requests follow
      ↓
Pending request
      ↓
B accepts
      ↓
Follow exists
```

Chronologity should support both semantics even if the exact account-level privacy model is refined separately.

A Follow must never bypass the visibility rules of individual Moments.

## Follow Requests

A **Follow Request** is not yet a Follow.

It represents one User asking to establish a Follow relationship with a User whose configuration requires approval.

A pending request should be:

- accept-able by the recipient;
- decline-able by the recipient;
- cancelable by the requester; and
- invalidated when another relationship state makes it impossible or inappropriate, such as blocking.

Declining a request should not automatically block the requester.

## Repeated Follow Requests

Chronologity must prevent follow requests from becoming a harassment mechanism.

A User who declines a request should not be subjected to immediate or unlimited repeated requests from the same account.

The exact cooldown or suppression policy can be determined during detailed product design, but the social model must support it.

Blocking should prevent future follow requests while the block remains active.

## Unfollow

A User may unfollow another User at any time.

```text
A follows B
    ↓
A unfollows B
    ↓
No Follow from A to B
```

Unfollowing should not require approval from the followed User.

Unfollowing does not:

- delete either User;
- delete Moments;
- remove comments or reactions;
- automatically remove the inverse Follow;
- block either User; or
- rewrite historical interactions.

If B also follows A, B's Follow remains unless separately removed.

## Removing a Follower

A User should be able to remove another User from their Followers without blocking them.

```text
A follows B
    ↓
B removes A as follower
    ↓
A no longer follows B
```

This capability is particularly important for privacy because forcing Users to block someone merely to remove a follower would conflate two materially different intentions.

Removing a follower does not inherently prevent that User from requesting or establishing a new Follow later, subject to privacy configuration and anti-abuse rules.

## Blocking

A **Block** is a safety and privacy relationship with stronger semantics than unfollowing or removing a follower.

```text
User A ──blocks──▶ User B
```

A Block is directional as an action, but its consequences should establish a meaningful interaction boundary between both Users.

When A blocks B, at minimum:

- A must not follow B;
- B must not follow A;
- pending Follow Requests between them must be removed or invalidated;
- B must not be able to send A a new Follow Request while blocked;
- ordinary direct social discovery between them should be suppressed;
- relationship-dependent access must not survive the block; and
- relevant interactive surfaces must respect the block.

Blocking should be designed as an explicit relationship state, not as a specialized Follow flag.

## Blocking Is Not Historical Erasure

Chronologity has a complication that ordinary social networks can sometimes avoid: two people may share historical records.

Blocking another User must not automatically rewrite history.

For example:

```text
User A creates a Moment in 2024
User B appears in the Moment
User A blocks User B in 2026
```

The block occurred in 2026.

It does not mean User B was not present in 2024.

Therefore:

```text
Block
    ≠
Erase historical fact
```

However, the block may change how the Users can discover, access, interact with, or be associated with that historical record going forward.

The exact interaction among blocking, tagging, shared Moments, identity associations, and media privacy requires consistent product rules.

## Block Visibility

Chronologity should not explicitly notify a User that another User blocked them.

The blocked User may infer the relationship from product behavior, but the product should not generate a social notification announcing the block.

This reduces unnecessary confrontation and avoids turning a safety mechanism into an engagement event.

## Unblocking

The blocking User may unblock another User.

Unblocking removes the block boundary but should **not restore prior social relationships automatically**.

```text
A follows B
B follows A
A blocks B

→ both Follow relationships are removed

A later unblocks B

→ neither Follow is automatically restored
```

If either User wants to follow again, a new Follow or Follow Request must be established according to current privacy rules.

## Social Graph and the Feed

The social graph helps define which Users may contribute eligible Moments to a User's Feed.

The Feed remains chronological.

Conceptually:

```text
Users I follow
      +
Moments I am permitted to view
      +
applicable product scope
      ↓
Eligible Feed set
      ↓
Chronological ordering
```

The social graph may determine eligibility.

It must not determine relevance ranking.

Chronologity should not calculate:

```text
Friend affinity × engagement probability × predicted interest
```

and use that score to reorder the Feed.

That would undermine the product's defining chronological principle.

## Social Graph and Timeline

A User's social relationships may determine what history they are authorized or eligible to view, but they do not define Timeline chronology.

A Timeline is derived from temporal and contextual scope.

Following someone may provide access to additional eligible historical content from that person; it does not create a new Timeline container or change occurrence order.

## Social Graph and Temporal Zoom

Temporal zoom must preserve relationship and privacy constraints at every level of aggregation.

A User must not gain access to otherwise inaccessible content merely because they zoom from a day into a year, decade, location grouping, Event grouping, or other temporal representation.

Conceptually:

```text
Authorization first
      ↓
Eligible historical set
      ↓
Temporal aggregation / zoom
```

not:

```text
Aggregate everything
      ↓
Accidentally reveal restricted history
```

## Social Graph and Historical Jumps

Historical jumps may move a User across distant points in time, but they must not bypass current social and privacy rules.

A causal or temporal link may exist between two Moments without granting the viewer access to both.

If the destination is not accessible, Chronologity should preserve the privacy boundary rather than treating graph connectivity as authorization.

## Social Graph and Real-World Events

Multiple Users may have Moments associated with the same real-world Event.

Sharing Event context does not automatically create a social relationship.

```text
User A attended Event X
User B attended Event X

does not imply

User A follows User B
```

Likewise, following another User does not automatically grant access to every Moment associated with Events both Users attended.

## Social Graph and Locations

Co-presence at a location does not create a social relationship.

Chronologity should not infer:

```text
Same place + same time = social connection
```

Location and temporal overlap may be historically meaningful, but they are not evidence that two Users know one another or want to be connected.

## Social Graph and Causality

Causal relationships between Moments do not imply social relationships between the Users associated with those Moments.

Likewise, social relationships do not establish causal relationships.

```text
Social edge ≠ Causal edge
```

These graphs represent fundamentally different semantics and must remain separate.

## Social Graph and Identity

A Follow connects stable User identities, not display names or handles.

If a followed User changes their handle, display name, profile image, or other mutable identity representation, the Follow remains attached to the same User.

```text
Follow(User A → User B)
```

must not become:

```text
Follow(@old-handle → @other-handle)
```

Public identity changes must not corrupt social relationships.

## Social Graph and Account Deletion

When a User's account is deleted, active social relationships involving that account should cease to function as live Follow relationships.

The system may retain limited internal information where necessary for legal, safety, audit, or distributed cleanup purposes, but deleted accounts should not continue appearing as ordinary active followers or followed Users.

Account deletion must not cause unrelated historical records to be deleted merely because a social relationship once existed.

## Social Graph and Suspension

A suspended User's social graph may need to remain internally intact while its product behavior is restricted.

Suspension should therefore not necessarily be modeled as mass-unfollowing.

This distinction matters if the account is later reinstated.

The exact visibility and interaction behavior during suspension belongs to moderation policy, but architecture should not force suspension to destroy relationship history.

## Social Graph and Privacy

Following does not override privacy.

A User may follow another User and still be unable to view:

- private Moments;
- audience-restricted Moments;
- Moments from which they are specifically excluded;
- identity associations they are not entitled to see;
- location details they are not entitled to see; or
- other restricted historical context.

Authorization must consider the resource's actual visibility semantics.

```text
Follows User
    ≠
Can view everything from User
```

## Social Graph and Public Moments

A public Moment may be viewable by Users who do not follow its creator, subject to discovery, blocking, moderation, and other applicable rules.

Following should therefore not be treated as the only path through which public history can be discovered.

The social graph and discovery system serve different purposes.

## Social Graph and Discovery

Chronologity may recommend Users to one another, but recommendations should be treated as discovery rather than an extension of the Follow model itself.

Potential signals might eventually include shared connections, shared public context, explicit interests, or other privacy-compatible information.

Chronologity should be cautious about recommendations derived from sensitive historical co-occurrence.

A system that says:

> "You were both at this private place at this time, so you may know each other"

could reveal information neither User intended to disclose.

Discovery must therefore be privacy-aware by design.

## Contact-Based Discovery

Chronologity may eventually allow Users to discover people they already know through address-book matching or similar mechanisms.

This should not be required for the social graph to function.

If implemented, contact discovery must be opt-in or otherwise transparently permissioned, privacy-preserving, and designed to avoid exposing whether a particular non-User exists in another User's contacts.

Chronologity should not upload or retain raw address books merely because it is a common social-app pattern without first establishing a strong product need and privacy model.

## Social Counts

Chronologity may display counts such as:

- followers; and
- following.

These counts can help Users understand social context.

However, Chronologity should avoid making follower counts a dominant status mechanism.

The product is intended to center history rather than popularity competition.

Follower counts should therefore be informational rather than a primary ranking signal or gamification target.

## Public Follower Lists

Whether follower and following lists are publicly visible should be governed by explicit privacy semantics.

Even when counts are visible, the identities behind those counts need not always be universally visible.

This distinction can matter because a social connection itself may reveal sensitive information.

```text
"123 followers"
```

and:

```text
"Here are all 123 people"
```

do not expose the same amount of information.

## Social Graph and Notifications

Social actions may generate notifications.

Examples include:

- a new Follow;
- a Follow Request;
- an accepted Follow Request; and
- potentially other relationship changes where notification is useful.

Unfollowing, removing a follower, blocking, and declining a Follow Request should not ordinarily generate direct notifications.

Chronologity should avoid notifications whose primary effect is social friction.

## Social Graph and Comments

Commenting on another User's Moment does not automatically establish a Follow relationship.

Likewise, following a User does not automatically grant permission to comment on every Moment.

Comment authorization should depend on the Moment's interaction rules, privacy state, blocking state, moderation state, and other applicable context.

## Social Graph and Reactions

Reacting to another User's Moment does not establish a Follow relationship.

A Follow may increase the likelihood that a User encounters eligible Moments, but reactions and relationships remain independent concepts.

Chronologity should not automatically convert engagement into social connection.

## Social Graph and Messaging

Chronologity's core social graph should not assume the existence of direct messaging.

If messaging is introduced later, messaging permissions may depend partly on social relationships, but messaging should have its own product and safety semantics.

The Follow model should not be distorted merely to anticipate a future messaging system.

## Social Graph and Groups

The initial social model should not require Groups, Circles, Close Friends, or manually curated relationship lists.

Those capabilities may eventually be useful for audience control or navigation, but they introduce substantial complexity.

Chronologity should first establish a clear directional Follow model and a strong resource-level privacy model.

If audience groups are later introduced, they should not redefine the fundamental meaning of a Follow.

## Social Graph and Organizations

If Chronologity later supports organization identities, the product will need to decide whether following an organization has the same semantics as following a person.

The initial social graph should not assume that every future account type participates identically.

## Social Graph and Scale

A User may eventually have:

- no followers;
- a handful of followers;
- thousands of followers; or
- millions of followers.

Likewise, a User may follow a very large number of accounts.

The product model must not depend on loading an entire adjacency list into memory or synchronously updating every follower whenever a User creates a Moment.

Conceptually:

```text
User creates Moment
      ≠
Perform one synchronous write per follower
```

Architecture must support large social graphs without weakening chronological behavior.

## Fan-Out Semantics

The product does not require a specific fan-out architecture, but it imposes an important semantic constraint:

Feed delivery optimizations must not become ranking semantics.

Whether implementation eventually uses:

- fan-out on write;
- fan-out on read;
- hybrid fan-out;
- precomputed feed segments; or
- another scalable technique,

the observable product result must preserve the defined chronological ordering and authorization rules.

Performance architecture must serve the product model rather than redefine it.

## Relationship Provenance

Chronologity should preserve enough provenance to answer operationally important questions such as:

- when a Follow was created;
- whether it originated through immediate follow or approved request;
- when it ended where necessary;
- whether a Block currently exists; and
- which User initiated a directional relationship action.

Not all provenance needs to be publicly visible.

The product should distinguish internal auditability from public social history.

## Relationship History

Chronologity should not automatically expose a public history of follows, unfollows, blocks, or rejected requests.

For example, the product should not create a public chronological record saying:

```text
2025 — A followed B
2026 — A unfollowed B
2027 — A followed B again
```

unless there is a compelling future product reason.

These are product interactions, not necessarily Moments in represented history.

Internal event history may exist for system correctness without becoming user-facing historical content.

## No Social Activity Timeline

Chronologity should resist the conventional social-network pattern of converting every relationship action into feed content.

The Feed should not contain generic items such as:

```text
Richard followed Alice.
Alice followed Bob.
Bob now has 1,000 followers.
```

unless Chronologity deliberately introduces a separate activity surface in the future.

The chronological Feed should remain centered on meaningful historical content rather than account mechanics.

## No Engagement-Based Relationship Strength

Chronologity should not require an opaque "relationship strength" score to define the social graph.

The system may eventually need limited derived signals for discovery, abuse prevention, notification prioritization, or performance optimization, but those signals should not silently become a hidden social hierarchy.

A Follow means a Follow.

Mutual following means two Follows.

Chronologity should prefer explicit semantics over inferred intimacy.

## No Automatic Follows

Chronologity should not automatically create Follow relationships merely because:

- two Users appear in the same Moment;
- one User tags another;
- two Users are in the same contacts;
- two Users attended the same Event;
- two Users were at the same location;
- two Users frequently interact;
- AI predicts that they know each other; or
- their accounts are otherwise strongly associated.

A Follow should result from intentional User action or an explicit approved migration/import behavior.

```text
Inferred relationship ≠ Follow
```

## Social Graph Product Invariants

1.  Chronologity's foundational social relationship is directional following.
2.  A Follow does not require reciprocity.
3.  Two reciprocal Follows constitute a derived mutual-follow state rather than requiring a separate Friendship entity.
4.  Following expresses ongoing social interest, not unrestricted authorization.
5.  Privacy configuration may require approval before a Follow becomes active.
6.  A Follow Request is not a Follow.
7.  Users may unfollow other Users without approval.
8.  Users may remove followers without blocking them.
9.  Blocking is distinct from following, unfollowing, and follower removal.
10. Blocking removes or invalidates active Follow relationships and pending Follow Requests between the affected Users.
11. Unblocking must not automatically restore previous Follow relationships.
12. Blocking must not automatically rewrite historical facts.
13. Blocks should not generate direct social notifications to the blocked User.
14. The social graph may affect Feed eligibility but must not introduce relevance ranking into chronological ordering.
15. Social relationships must not bypass Moment-level or other resource-level privacy.
16. Temporal zoom must preserve social and privacy authorization.
17. Historical jumps must not bypass authorization.
18. Shared Events, locations, or temporal overlap must not automatically create social relationships.
19. Causal relationships and social relationships are separate graph concepts.
20. Follow relationships attach to stable User identity rather than mutable handles or display names.
21. Account deletion ends live social relationships without requiring deletion of unrelated historical records.
22. Suspension should not necessarily destroy the underlying social graph.
23. Public content may be discoverable without a Follow relationship.
24. Discovery and following are distinct product concepts.
25. Social connection information itself may be privacy-sensitive.
26. Comments and reactions do not automatically create Follow relationships.
27. Following does not automatically grant commenting or reaction permissions.
28. Chronologity should not require direct messaging, groups, or curated friend lists for the foundational social model.
29. The social graph must support Users with very large follower and following counts.
30. Feed scalability optimizations must preserve chronological ordering and authorization semantics.
31. Follow/unfollow history is not automatically user-facing historical content.
32. Chronologity should not turn ordinary social-graph actions into Timeline Moments.
33. The social graph should not depend on an opaque engagement-based relationship-strength score.
34. Follow relationships must result from intentional User action rather than inferred proximity, co-occurrence, tagging, contacts, engagement, or AI prediction.

## Day-One Social Graph Requirements

Before launch, Chronologity must have explicit product behavior for:

- following a User;
- unfollowing a User;
- Followers and Following views;
- mutual following;
- approval-based Follow Requests where required by privacy configuration;
- accepting a Follow Request;
- declining a Follow Request;
- canceling a sent Follow Request;
- repeated-request abuse prevention;
- removing a follower;
- blocking a User;
- unblocking a User;
- the effect of blocking on existing Follows;
- the effect of blocking on pending Follow Requests;
- social graph effects on Feed eligibility;
- social graph effects on User discovery;
- social graph effects on Moment access;
- notification behavior for Follow actions;
- privacy of follower/following information;
- behavior for suspended Users;
- behavior for deleted Users; and
- scalability expectations for high-degree Users.

The initial release does not require:

- Friendship as a separate relationship type;
- direct messaging;
- Close Friends;
- Circles;
- Groups;
- relationship-strength scoring;
- automatic following;
- contact importing;
- organization-follow semantics; or
- a public social-activity timeline.

Those capabilities should be added only when they solve a demonstrated product problem.

## Open Product Questions

The following questions require deliberate resolution:

- Are accounts either public or approval-based for following, or can Follow approval be configured independently from Profile visibility?
- What terminology should the UI use for approval-based accounts?
- Does a private or approval-based account expose its follower and following counts publicly?
- Are follower and following identity lists visible to everyone, followers only, mutual followers only, or according to another rule?
- Can a User hide their Following list while keeping their Followers list visible, or vice versa?
- Should Chronologity permit hiding social counts entirely?
- Does removing a follower impose a temporary cooldown before that User can request to follow again?
- How long should repeated Follow Request cooldowns last after a decline?
- Should the recipient be able to suppress future requests from a specific User without fully blocking them?
- Does canceling and resending a Follow Request trigger a new notification?
- What notification is sent when a Follow Request is accepted?
- Should an immediate Follow on an open account notify the followed User?
- What happens to Follow Requests when an account changes from approval-based to open?
- What happens to pending Follow Requests when an account changes from open to approval-based?
- If a User changes privacy mode, do existing Followers remain?
- Can a User bulk-remove Followers?
- What exact content becomes inaccessible immediately after a Block?
- How should blocking behave when both Users are associated with the same real-world Event?
- How should blocking affect existing comments and reactions between the Users?
- How should blocking affect tags and identity associations?
- How should blocking affect search results when the blocked User's content is part of shared historical context?
- Should blocked Users be completely hidden from each other in public comment threads, or should content appear in a suppressed form?
- How should a Block interact with public Moments that are accessible without following?
- Should follower counts include suspended accounts?
- When an account is suspended, should it remain visible in follower/following lists?
- How quickly must deletion propagate through large follower graphs?
- Should deleted Users disappear entirely from historical social provenance retained internally?
- Are follower/following counts exact at all scales, or may very large counts be displayed approximately?
- Should Chronologity show mutual-follow indicators?
- Should Chronologity show "followed by people you follow" as discovery context?
- Which social signals, if any, may be used for User recommendations?
- Should contact-based discovery ever be supported?
- If contact discovery is introduced, what privacy-preserving matching design is acceptable?
- What is a curator? `timeline-first-curation-and-discovery.md` gives curators identity, assertions, annotations, publishing, and moderation, and this document does not mention them. Are they a kind of User, a role in the existing authorization model, or something else?
- Should following a User and following a historical context share any semantics beyond the word, such as a combined list of what somebody follows?
- Should organization accounts eventually participate in the same Follow graph?
- Are there any circumstances in which a system or administrative actor can establish a Follow on behalf of a User?
- How should migrated relationships behave if Chronologity ever supports account import from another service?
- Should Users be able to export their follower/following relationships as part of data portability?

These questions should be resolved before implementation choices accidentally become permanent product semantics.

## Architecture Constraints

This document does not prescribe a graph database, relational schema, event model, projection design, or feed fan-out strategy.

It does impose architectural constraints.

The implementation must preserve directional relationships and distinguish at least the semantics of:

```text
Follow
Follow Request
Block
```

It must not collapse these into a single generic relationship whose meaning is inferred from flags unless doing so still preserves clear domain semantics.

Relationships must use stable User identifiers rather than mutable handles or profile attributes.

The architecture must also assume high-degree Users. Operations such as publishing a Moment, deleting an account, changing privacy configuration, suspending an account, or blocking another User must not require unsafe synchronous work proportional to an arbitrarily large follower graph when that work can be made asynchronous or derived.

Feed infrastructure may optimize delivery aggressively, but optimization must preserve two non-negotiable properties:

```text
1. Only authorized/eligible Moments are exposed.
2. Eligible Moments remain chronologically ordered according to Feed semantics.
```

The social graph should be independently projectable and rebuildable if Chronologity continues with the event-driven architecture defined for the platform.

## Guiding Principle

When making a social-graph decision, ask:

> **Does this help Users intentionally connect around shared history without allowing social mechanics to distort chronology, privacy, or historical truth?**

The social graph should determine connection.

Chronology should determine order.

Privacy should determine access.
