# Chronologity Reactions

## Purpose

This document defines the product semantics, lifecycle, uniqueness, visibility, privacy, and historical boundaries of **Reactions** in Chronologity.

A Reaction is a lightweight expression made by a User in response to a Moment. Reactions support social interaction around history, but they do not become part of the represented historical occurrence and must not determine a Moment's chronological position or historical importance.

The central question is:

> **How should Users express lightweight responses to Moments without allowing engagement mechanics to distort chronology, privacy, or historical meaning?**

This document defines product behavior rather than database schemas, API routes, event contracts, projection structures, notification infrastructure, or storage technology.

## Definition

A **Reaction** is a lightweight, structured expression from one User toward one Moment.

Conceptually:

```text
User
  │
  └── reacts to
        │
        ▼
      Moment
```

A Reaction records that a User expressed one of Chronologity's supported reaction types toward a Moment.

A Reaction is not:

- a Moment;
- a Comment;
- a causal relationship;
- a historical correction;
- a social Follow;
- proof of participation in the Moment;
- proof of endorsement of every aspect of the Moment; or
- a measure of historical importance.

## Reactions Are Social Activity, Not Historical Occurrence

Chronologity must preserve a strict distinction between the occurrence time of a Moment and the time a User reacts to it.

For example:

```text
Moment occurred:  June 12, 1998
Reaction added:   August 10, 2026
```

The Reaction is a 2026 product interaction concerning a Moment from 1998.

Therefore:

```text
Reaction time ≠ Moment occurrence time
```

Adding, changing, or removing a Reaction must never change the Moment's position in a Timeline.

## Reactions Are Not Moments

Creating a Reaction does not create a Moment.

```text
Reaction ≠ Moment
```

Reactions are metadata about present-day interaction with historical content. They should not appear as independent historical occurrences merely because they have timestamps.

## Reaction Target

The initial Reaction model should apply directly to **Moments**.

Chronologity should not assume that every product concept needs reactions.

The initial model should not require first-class reactions to:

- Timelines;
- real-world Events;
- locations;
- causal relationships;
- User Profiles; or
- temporal aggregations.

Reactions to Comments may be considered separately, but they should not be assumed merely because Moment reactions exist.

## Reaction Types

Chronologity should support a **small, explicit set of reaction types** rather than an unbounded or user-defined reaction vocabulary.

The reaction set should be expressive enough to support lightweight human response while remaining understandable, accessible, stable across clients, and suitable for aggregation.

The exact day-one reaction set remains an open product decision.

Chronologity should avoid choosing reaction types that imply unsupported historical claims. For example, a reaction should not mean that the reacting User confirms the Moment occurred exactly as represented unless the product explicitly introduces a separate verification capability.

## Semantic Stability

Once a reaction type is publicly available, its meaning should remain reasonably stable.

Changing the icon or label associated with a stored reaction must not silently transform its semantic meaning.

For example, if a reaction type originally means appreciation, Chronologity should not later reuse that same stored type to mean agreement.

Stable reaction semantics are especially important for long-lived historical content whose engagement may span many years.

## One Active Reaction Per User Per Moment

The recommended foundational rule is:

```text
One User + One Moment = At most one active Reaction
```

A User may react to many different Moments, and many Users may react to the same Moment, but a single User should not simultaneously hold multiple reaction types on the same Moment.

This keeps interaction simple, prevents reaction inflation, and makes replacement semantics clear.

## Adding a Reaction

If a User has no active Reaction on a Moment, selecting a reaction type creates one active Reaction.

```text
No Reaction
    ↓
Select ❤️
    ↓
❤️ active
```

The action should be idempotent from the User's perspective. Accidental retries must not create duplicate active Reactions.

## Replacing a Reaction

If a User already has an active Reaction and selects a different reaction type, the existing Reaction should be replaced.

```text
❤️ active
    ↓
Select 😂
    ↓
😂 active
```

Chronologity should not require the User to remove the first Reaction manually before selecting another.

Replacement preserves the invariant that a User has at most one active Reaction per Moment.

## Removing a Reaction

A User may remove their active Reaction.

```text
❤️ active
    ↓
Remove
    ↓
No active Reaction
```

Removing a Reaction must not modify the Moment or any other User's Reaction.

The product should make removal easy and reversible through a future new Reaction.

## Reaction Identity

The product should treat the active Reaction relationship as having stable domain identity sufficient to distinguish creation, replacement, and removal semantics.

The implementation does not need to expose a public Reaction identifier unless required by an API or client interaction.

What matters at the product level is the authoritative state:

```text
User A currently reacts to Moment X with Reaction Type Y
```

Internal event history may preserve previous reaction types without exposing them as simultaneously active Reactions.

## Reaction History

Chronologity should not expose a public history of every Reaction change.

For example, the product should not ordinarily show:

```text
10:00 — Richard reacted ❤️
10:02 — Richard changed reaction to 😂
10:05 — Richard removed reaction
10:08 — Richard reacted ❤️ again
```

These are product interactions, not represented historical occurrences.

Internal history may exist for system correctness, abuse prevention, analytics, or auditability without becoming public historical content.

## Reaction Counts

A Moment may display aggregate counts for active Reactions.

Conceptually:

```text
❤️ 24   😂 7   😮 3
```

Counts represent the current active reaction state according to the applicable product semantics.

Removed or replaced Reactions should not continue contributing to their previous active counts.

Counts are derived information and may be eventually consistent at scale.

## Total Reaction Count

Chronologity may also display a total number of active Reactions on a Moment.

If shown:

```text
Total active Reactions = sum of active Reaction counts
```

A User with one active Reaction contributes exactly one to the total.

Historical Reaction changes must not inflate the current total.

## Reaction Counts Are Not Historical Importance

Chronologity must not treat Reaction counts as a measure of historical importance.

```text
More Reactions ≠ More historically important
```

A private family Moment with two Reactions may be more meaningful to its participants than a public Moment with millions.

Reaction volume is social engagement metadata, not historical truth or significance.

## Reaction Ordering

If Chronologity displays the identities of Users who reacted, those Users should not be ranked by inferred importance, influence, closeness, or engagement value unless a future feature explicitly requires such behavior.

A deterministic presentation such as reaction time, social context, or another transparent rule may be used.

The exact presentation order remains an open UI/product decision.

## Reaction Visibility

A Reaction cannot be more broadly visible than the Moment to which it belongs.

At minimum:

```text
Viewer can access Reaction context
        only if
Viewer can access underlying Moment
```

A direct Reaction reference, notification, search result, cached projection, or aggregate must not expose otherwise restricted Moment information.

## Who May React

Being able to view a Moment does not necessarily imply the right to react.

Chronologity should support interaction authorization that can distinguish:

```text
Can view
Can comment
Can react
```

These permissions may overlap, but they are not semantically identical.

The exact day-one Reaction permission options should align with the broader Moment interaction model.

## Disabling Reactions

A Moment creator should be able to disable new Reactions on their Moment if Chronologity exposes creator-controlled interaction settings.

Disabling Reactions should not necessarily delete existing Reactions.

Conceptually:

```text
Reactions enabled
      ↓
Existing Reactions
      ↓
Creator disables new Reactions
      ↓
Existing state remains visible, subject to policy
No new Reactions accepted
```

Whether existing Reactions remain visible when reactions are disabled is an open product decision that should be consistent with Comment interaction controls.

## Re-Enabling Reactions

If Reactions are later re-enabled, existing active Reactions should continue from their prior state unless they were explicitly removed or otherwise invalidated.

Re-enabling should not create new Reactions automatically.

## Reaction Privacy

Reaction identity can itself reveal information about a User's interests, relationships, beliefs, or attention.

Chronologity should therefore distinguish between:

- displaying aggregate Reaction counts; and
- displaying exactly which Users reacted.

```text
❤️ 142
```

reveals less than:

```text
Here are the 142 Users who reacted ❤️
```

The visibility of reactor identity requires explicit product semantics.

## Moment Visibility Changes

If a Moment becomes inaccessible to a User, that User must not continue receiving access to Reaction details through derived surfaces.

If a Moment's audience becomes more restrictive, Reaction lists, notifications, caches, search indexes, analytics surfaces exposed to Users, and other projections must respect the new authorization state.

Privacy revocation applies to engagement metadata as well as source content.

## Reaction by a User Who Later Loses Access

Chronologity must define what happens when a User reacts to a Moment and later loses access to it.

The recommended semantic is that the Reaction should no longer be exposed to that User through the inaccessible Moment, while the authoritative active Reaction may be removed or retained according to the reason access was lost.

For example, blocking may reasonably invalidate the Reaction, while a temporary authorization failure may not.

This behavior requires explicit resolution for each relevant access transition.

## Following and Reactions

Following a User does not automatically grant permission to react to every Moment they create.

Likewise, a User need not necessarily follow a creator in order to react to a Moment whose interaction policy permits it.

```text
Follow relationship ≠ Reaction permission
```

## Blocking and Reactions

Blocking must prevent Reactions from becoming a route around the intended safety boundary.

When a Block is established between two Users, Chronologity must define the treatment of existing Reactions between them and prevent prohibited future interaction.

The recommended baseline is that a blocked User cannot add or change Reactions on the blocking User's Moments while the Block exists.

Whether existing Reactions are removed, hidden, or retained but inaccessible should be resolved consistently with the broader blocking model.

## Suspension and Reactions

A suspended or interaction-restricted User may be prevented from creating, replacing, or removing Reactions according to moderation policy.

Existing Reactions may remain, be hidden, or be removed depending on the enforcement action.

Suspension must not rewrite the historical occurrence represented by the Moment.

## Account Deletion

Chronologity must define how active Reactions behave when the reacting User deletes their account.

Because a Reaction is lightweight social activity tied to the User's identity, the recommended behavior is to remove the deleted User's active Reactions from ordinary product state and aggregate counts, subject to any limited internal retention required for security, abuse prevention, audit, or legal obligations.

A deleted account should not remain visible indefinitely as an ordinary reactor identity.

## Moment Deletion or Unavailability

If a Moment is deleted or otherwise unavailable, its Reactions must not remain independently accessible as orphaned social objects.

Derived Reaction counts and reactor lists should cease to be presented through ordinary product surfaces when the underlying Moment is unavailable.

Internal retention, where required, does not imply continued public availability.

## Reactions and Comments

Reacting to a Moment is distinct from commenting on it.

```text
Reaction
    → lightweight structured response

Comment
    → authored conversational content
```

A User may react without commenting, comment without reacting, do both, or do neither.

Neither interaction should automatically create the other.

## Reactions to Comments

The initial Moment Reaction model does not require reactions to Comments.

Comment reactions introduce additional decisions around reaction types, counts, notifications, moderation, thread presentation, and engagement incentives.

They should be introduced only if they materially improve conversation rather than because reaction mechanics already exist elsewhere.

## Reactions and Timeline

Reaction activity must not affect Timeline ordering.

A Moment from 2007 that receives a Reaction in 2026 remains positioned according to its 2007 occurrence semantics.

```text
New Reaction
    ≠
New historical occurrence
```

This is a foundational invariant.

## Reactions and Temporal Zoom

Reaction counts may be displayed as contextual metadata where useful, but they must not determine temporal placement or aggregation.

Temporal zoom must continue to derive from Moment occurrence semantics.

Chronologity should not make high-engagement Moments consume disproportionate temporal space merely because they received more Reactions unless a future visualization explicitly communicates that it is showing engagement rather than chronology.

## Reactions and Historical Jumps

Reaction activity must not create historical jumps by itself.

A Reaction does not establish a causal, temporal, or semantic relationship between two Moments.

If Reaction-derived discovery is ever used to suggest another Moment, that suggestion must remain distinct from an explicit historical relationship.

## Reactions and Causality

A Reaction is not evidence of causality.

```text
User reacted to Moment A
User reacted to Moment B

≠

Moment A caused Moment B
```

Reaction patterns must not silently create causal relationships.

## Reactions and Real-World Events

Reacting to a Moment associated with a real-world Event does not mean the User attended, participated in, witnessed, or endorses the Event.

```text
Reacted to Event-related Moment
        ≠
Event participant
```

Chronologity must not infer participation from engagement.

## Reactions and Locations

A Reaction to a Moment associated with a location does not establish that the reacting User has been to that location.

Engagement must not become inferred location history.

## Reactions and Identity

A Reaction attaches to stable User identity, not a mutable handle or display name.

If a User changes public identity information, their active Reaction remains associated with the same User.

The presentation should resolve identity according to current privacy and identity rules.

## Reactions and the Feed

Reaction activity must not bump or reorder Moments in the chronological Feed.

Chronologity should not implement:

```text
Moment receives many Reactions
      ↓
Move Moment upward
```

if the Feed's contract is chronological.

Reaction metadata may be displayed on a Feed item without changing that item's chronological position.

## Reactions and Discovery

Reaction data may eventually contribute to discovery, but Chronologity should treat this carefully.

Using engagement to identify potentially interesting public content is different from using engagement to define historical importance or reorder a Timeline.

Any Reaction-derived discovery mechanism must respect privacy and should be explicit about its purpose.

Private or restricted Reaction behavior must not leak through aggregate discovery signals.

## Reactions and Search

Reaction counts may eventually be searchable or filterable metadata, but search-result relevance must not redefine Timeline or Reaction semantics.

Search must not expose reactor identity or restricted Moment information beyond the viewer's authorization.

## Reaction Notifications

Reaction activity may generate notifications to the Moment creator or other applicable recipients.

The initial product should avoid sending a separate notification for every Reaction when volume becomes high.

Notification aggregation may produce behavior such as:

```text
Alice and 12 others reacted to your Moment.
```

The exact aggregation rules belong in the notification specification.

## Notification Semantics

A Reaction notification describes recent product activity.

It must not imply that the Moment itself occurred recently.

For example, a Reaction today to a Moment from 1995 is a notification about today's Reaction, not a claim that the historical experience happened today.

## Notification Privacy

Reaction notification previews must respect current Moment visibility and User privacy.

If access changes after a notification is generated, opening the notification must enforce current authorization.

Push previews should avoid exposing sensitive Moment information beyond the recipient's configured notification privacy behavior.

## No Negative Social Punishment by Default

Chronologity should be cautious about reaction types designed primarily for public negative judgment.

The product's purpose is preserving and understanding history, not maximizing adversarial engagement.

A public "dislike" or equivalent may incentivize pile-ons, status competition, and engagement gaming without adding meaningful historical context.

The day-one reaction set should therefore favor expressive responses over public down-ranking mechanics.

This does not prevent Users from expressing disagreement or criticism through Comments where context can be provided.

## No Engagement Score

Chronologity should not collapse Reactions, Comments, views, follows, or other interactions into a universal engagement score attached to a Moment.

```text
Reaction count
Comment count
View count
Follower count
        ↓
NOT automatically
        ↓
Historical importance score
```

Such a score would create pressure for ranking and optimization behavior that conflicts with Chronologity's chronological foundation.

## No Reaction-Based Ranking of History

Reaction volume must not determine:

- Timeline position;
- temporal zoom position;
- causal significance;
- historical-jump priority as though it were historical truth;
- Event participation;
- location association;
- Moment authenticity; or
- historical importance.

Reaction data may support clearly separated social or discovery features, but it must never silently redefine history.

## Accessibility

Reaction controls must be accessible without relying solely on emoji appearance, color, animation, hover behavior, or gesture.

Each reaction type must have a meaningful accessible label.

Selected state, count, and removal/replacement behavior must be understandable to screen-reader and assistive-technology users.

Motion or celebratory effects, if used, must respect reduced-motion requirements.

## Localization

Reaction icons may appear visually universal but their labels and meanings still require localization.

Chronologity should avoid assuming that an icon has identical cultural meaning everywhere.

Accessible labels and explanatory text should use localized product terminology.

## Reaction Provenance

Chronologity should preserve sufficient provenance to establish:

- the reacting User;
- the Moment;
- the active reaction type;
- when the active Reaction was established or most recently changed where operationally necessary; and
- removal or moderation state where applicable.

Internal event history may preserve prior states.

Not all provenance should be publicly visible.

## Scalability

A Moment may receive no Reactions, a handful, thousands, or millions.

The product model must not depend on loading every reactor in order to display a Moment.

Aggregate counts, reactor lists, notifications, analytics, and discovery signals may be projected asynchronously.

Creating or replacing one User's Reaction must not require synchronous work proportional to every other reactor.

## Consistency

After a successful Reaction action, the acting User should receive immediate and coherent feedback about their own active state.

Derived counts may be eventually consistent.

For example:

```text
User selects ❤️
      ↓
Their UI immediately shows ❤️ active
      ↓
Aggregate count may reconcile asynchronously
```

Temporary count lag must not cause duplicate active Reactions or ambiguous User state.

## Idempotency

Reaction operations must tolerate retries safely.

Repeated delivery of the same intended action should not create duplicate active Reactions or inflate counts.

The product semantics should remain stable under unreliable networks and repeated taps.

## Reaction Product Invariants

1. A Reaction is a lightweight structured User response to a Moment.
2. A Reaction is not a Moment, Comment, causal relationship, historical correction, Follow, or proof of participation.
3. Reaction time is distinct from Moment occurrence time.
4. Adding, replacing, or removing a Reaction must not change Moment chronology.
5. The initial Reaction target is the Moment.
6. Chronologity should use a small explicit set of stable reaction types.
7. Reaction types must not imply historical verification unless explicitly designed to do so.
8. A User may have at most one active Reaction per Moment.
9. Selecting a different reaction type replaces the User's current active Reaction.
10. A User may remove their active Reaction.
11. Reaction operations must be idempotent from the User's perspective.
12. Public Reaction-change history is not required.
13. Aggregate counts represent active Reaction state rather than lifetime Reaction actions.
14. Removed or replaced Reactions must not continue contributing to previous active counts.
15. Reaction counts are social metadata, not measures of historical importance.
16. A Reaction cannot be exposed more broadly than its underlying Moment.
17. Ability to view a Moment does not inherently imply ability to react.
18. Following does not inherently grant Reaction permission.
19. Blocking must prevent Reaction interaction from bypassing the social safety boundary.
20. Account deletion should remove the deleted User's active Reactions from ordinary product state, subject to required internal retention.
21. Reactions must not remain independently accessible when their Moment is unavailable.
22. Reacting and commenting are independent actions.
23. Moment Reactions do not require Comment Reactions.
24. Reaction activity must not affect Timeline or chronological Feed ordering.
25. Reaction activity must not alter temporal zoom placement.
26. Reaction activity does not create historical jumps or causal relationships by itself.
27. Reacting to Event- or location-associated content does not establish participation or presence.
28. Reactions attach to stable User identity rather than mutable public identifiers.
29. Reaction-derived discovery, if introduced, must remain distinct from historical ordering and truth.
30. Reaction notifications describe product activity rather than Moment occurrence.
31. The day-one Reaction model should avoid public negative-ranking mechanics by default.
32. Chronologity should not create a universal engagement score from Reactions and other interactions.
33. Reaction controls and states must be accessible through semantic labels and assistive technology.
34. The product must support Moments with very large Reaction counts without loading every reactor.
35. The acting User's Reaction state should be immediately coherent even when aggregate counts are eventually consistent.

## Day-One Reaction Requirements

Before launch, Chronologity must have explicit product behavior for:

- the supported Reaction types;
- adding a Reaction;
- replacing an existing Reaction;
- removing a Reaction;
- enforcing one active Reaction per User per Moment;
- idempotent Reaction actions;
- displaying the acting User's active Reaction;
- displaying aggregate Reaction counts;
- deciding whether to display total Reaction count;
- deciding whether reactor identities are viewable;
- Reaction authorization;
- disabling and re-enabling Reactions on a Moment if creator interaction controls support it;
- Reaction behavior when Moment visibility changes;
- Reaction behavior under blocking;
- Reaction behavior for suspended Users;
- Reaction behavior after account deletion;
- Reaction behavior when the underlying Moment becomes unavailable;
- Reaction notifications and aggregation expectations;
- moderation and abuse controls applicable to Reactions;
- accessibility labels and selected-state behavior; and
- scalability for high-Reaction Moments.

The initial release does not require:

- reactions to Comments;
- reactions to Profiles;
- reactions to Timelines;
- reactions to real-world Events;
- reactions to locations;
- reactions to causal relationships;
- arbitrary user-defined reaction types;
- public Reaction edit/history logs;
- engagement-ranked Reaction lists;
- Reaction-based Timeline ranking;
- a universal engagement score; or
- public down-ranking or dislike mechanics.

## Open Product Questions

The following questions require deliberate resolution:

- What exact Reaction types should ship on day one?
- Should Chronologity use familiar emoji-style reactions, named semantic reactions, or a combination?
- Should a simple "like" be one of the available reactions?
- Should any reaction represent empathy, remembrance, surprise, humor, appreciation, or another historically appropriate response?
- Are there reaction types that should be avoided because their meaning is too culturally ambiguous?
- Should the available reaction set be identical for every Moment?
- Should reaction types ever be versioned or retired?
- If a reaction type is retired, how should existing active Reactions of that type be displayed?
- Should selecting the currently active Reaction remove it, or should removal require a separate interaction?
- Should a quick tap apply a default Reaction while a long press or expanded control selects alternatives?
- Should Reaction counts be visible on every Moment by default?
- Should total Reaction count be displayed in addition to per-type counts?
- Should zero-count reaction types be displayed?
- Can a Moment creator hide Reaction counts while still allowing Reactions?
- Can a User hide their own Reaction activity from other viewers while still reacting?
- Who can see the list of Users behind a Reaction count?
- Does reactor-list visibility follow the Moment audience exactly, or can it be more restrictive?
- Should Users be able to see which mutual followers reacted without exposing the complete reactor list?
- What deterministic ordering should be used when displaying reactor identities?
- What Reaction permissions should Moment creators be able to configure?
- Should "anyone who can view" be the default Reaction permission?
- Should Reaction permission and Comment permission be independently configurable?
- What happens to existing Reactions when a creator disables Reactions?
- Should disabling Reactions hide existing counts or merely prevent new actions?
- What happens when a User who reacted later loses access because the creator changes the Moment's audience?
- What happens to existing Reactions when one User blocks another?
- Should blocking remove those Reactions from aggregate counts or merely hide their identities from the affected Users?
- What happens to active Reactions when a User is suspended temporarily?
- How quickly must account deletion remove a User's Reactions from aggregate counts and derived projections?
- Should Reaction removal generate any notification?
- Should changing from one Reaction type to another generate a second notification?
- How aggressively should high-volume Reaction notifications aggregate?
- Can Moment creators mute Reaction notifications for individual Moments?
- Should Users be able to disable all Reaction notifications globally?
- Should Reactions appear in any account-level activity history visible only to the reacting User?
- Should Reaction data be included in a User's data export?
- Should public discovery ever use Reaction counts as a signal?
- If it does, how should Chronologity prevent popularity from becoming historical ranking?
- Should Reaction counts be exact at very large scale or may the UI abbreviate them visually?
- Should aggregate counts update live while a User is viewing a Moment?
- How should Reaction controls behave offline or during intermittent connectivity?
- What visual and haptic feedback should accompany a Reaction while respecting reduced-motion and accessibility settings?
- How should reaction labels be localized when emoji meaning differs culturally?
- What abuse patterns require rate limits even though only one active Reaction per User per Moment is allowed?
- Should moderation ever remove a Reaction independently of suspending or deleting the reacting User?

These questions should be resolved before implementation choices accidentally become permanent product semantics.

## Architecture Constraints

This document does not prescribe a Reaction aggregate, relational table, event stream, Kafka topic, projection, or service.

It does impose several architectural constraints.

The implementation must be able to enforce the authoritative invariant:

```text
At most one active Reaction per User per Moment
```

Replacement and removal must update aggregate state without creating duplicate active Reactions or count inflation under retries and concurrency.

Relationships must attach to stable User and Moment identities rather than mutable display attributes.

The architecture must distinguish authoritative Reaction state from eventually consistent derived counts, notifications, search/discovery signals, analytics, and reactor-list projections.

Authorization and privacy revocation must propagate to every derived surface that exposes Reaction information.

The system must support Moments with very large Reaction counts without requiring synchronous work proportional to all reactors for an individual Reaction operation.

If Reaction state is event sourced, retained historical events must not force previous Reaction states to remain publicly visible or prevent privacy-compliant deletion and suppression behavior.

## Guiding Principle

When deciding how Reactions should behave, ask:

> **Does this let Users express lightweight human responses to history without turning engagement into a ranking system for history itself?**

Reactions express response.

They do not define importance.

Chronology still defines historical position.
