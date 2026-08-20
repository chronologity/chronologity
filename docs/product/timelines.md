# Chronologity Timelines

## Purpose

This document defines the product model and semantics of a **Timeline** in Chronologity.

A Timeline is the derived chronological structure through which Moments are organized according to when the represented experiences occurred.

This document answers:

> **What is a Timeline?**

The separate `timeline.md` document answers:

> **How does a user navigate and experience the Timeline?**

That distinction is intentional.

## Definition

A **Timeline** is a derived chronological representation of Moments ordered according to their occurrence semantics.

```text
Moments
   │
   │ occurrence semantics
   ▼
Timeline
```

A Timeline is not, by default, a user-created container, album, folder, collection, playlist, project, channel, or manually maintained list.

Users create Moments.

Chronologity derives chronological structure from those Moments.

```text
User creates Moment       ✓
User creates Timeline     ✗

Moment is a domain record ✓
Timeline is derived       ✓
Timeline must be entity   ✗
```

This is a definitive product decision.

## Why the Timeline Is Derived

Chronologity should minimize organizational work for users.

If users were required to create and maintain explicit Timeline containers, every new Moment could introduce unnecessary filing decisions:

> Which Timeline does this belong in?

> Should this be in my Travel Timeline or Family Timeline?

> Do I need another Timeline for this event?

That model would push Chronologity toward albums, folders, collections, and project-management semantics.

Chronologity's product model is simpler:

```text
Experience
    ↓
Moment
    ↓
Occurrence semantics
    ↓
Chronological structure
```

Users record history. Chronologity organizes that history chronologically.

## Timeline Is Not a Stored Entity by Product Definition

The word "Timeline" being a major product concept does not imply that it must become an independently persisted thing.

The product model does not require:

```text
TimelineCreated
TimelineRenamed
TimelineDeleted
AddMomentToTimeline
RemoveMomentFromTimeline
TimelineOwner
TimelineMembers
```

Those concepts should not be introduced merely because they are convenient nouns for implementation.

If architecture later uses a Timeline projection, Timeline read model, Timeline query service, Timeline cache, or another technical representation, that does not change the product semantics.

```text
Technical Timeline representation
        ≠
User-created Timeline entity
```

## Timeline Scope

A Timeline always exists relative to a **viewing scope**.

The most obvious scope is a person's accessible history.

Conceptually:

```text
User
  │
  └── accessible Moments
          │
          ▼
       Timeline
```

Chronologity may also derive chronological views for other product-defined contexts, such as:

- a location;
- a real-world Event;
- a set of accessible shared Moments;
- a search result transitioned into chronology; or
- another explicitly defined historical context.

These are derived chronological views, not independent user-created Timeline containers.

## Viewer-Specific Timelines

Two viewers may see different chronological representations of what appears to be the same broader historical context because they have access to different Moments.

```text
Underlying Moments
       │
       ├── Viewer A authorization
       │         ↓
       │     Timeline A
       │
       └── Viewer B authorization
                 ↓
             Timeline B
```

Therefore, a Timeline should not be assumed to be one globally materialized list shared identically by every viewer.

Privacy and authorization participate in Timeline derivation.

## Occurrence Time Is Authoritative

A Timeline orders Moments according to when the represented experiences occurred, not when the records were created.

```text
occurredAt ≠ createdAt
```

For example:

```text
Moment A
Occurred: 2018
Created: 2026

Moment B
Occurred: 2024
Created: 2024
```

The Timeline order is:

```text
2018 ── Moment A
2024 ── Moment B
```

Creation order is irrelevant to their historical relationship.

## Historical Insertion

Chronologity must allow history to be recorded after the fact.

Suppose the Timeline currently contains:

```text
2018 ── Moment A
2020 ── Moment B
2022 ── Moment C
```

In 2026, a user records a Moment that occurred in 2019.

The Timeline becomes:

```text
2018 ── Moment A
2019 ── Historical Moment
2020 ── Moment B
2022 ── Moment C
```

The new record does not appear at the end merely because it was created later.

This is a foundational distinction between Chronologity and publication-order social feeds.

## Historical Corrections

Correcting occurrence information may change a Moment's chronological position.

For example:

```text
Before correction:

2018 ── Moment A
2020 ── Moment B
2021 ── Moment C

Correction:
Moment B actually occurred in 2017

After correction:

2017 ── Moment B
2018 ── Moment A
2021 ── Moment C
```

The Timeline must reflect the corrected historical semantics.

A correction is not a new Moment unless the user is actually representing a different experience.

## Partial and Approximate Time

Not every Moment will have an exact timestamp.

A user may know:

```text
June 12, 2026 at 3:42 PM
```

or only:

```text
June 2026
```

or:

```text
2026
```

or:

```text
Approximately summer 1998
```

The Timeline model must eventually support varying temporal precision without inventing certainty.

A deterministic presentation may be required even when historical order is not fully known.

```text
Deterministic presentation order
        ≠
Claim of exact historical order
```

## Simultaneous and Unordered Moments

Two Moments may share the same known occurrence position or have insufficient temporal precision to establish which occurred first.

Chronologity may use deterministic technical tie-breakers for stable rendering, pagination, and retrieval.

Those tie-breakers must not be presented as evidence that one event historically preceded the other.

## Temporal Intervals

Some experiences may span a period rather than occur at one mathematically precise instant.

The Timeline model should not assume that every Moment must always collapse to a single exact timestamp.

The exact representation of temporal intervals belongs to subsequent product and architecture specifications.

## Chronological Integrity

Chronological integrity means the Timeline consistently represents known historical occurrence semantics.

It requires that:

- creation time does not replace occurrence time;
- engagement does not reorder history;
- historical insertion places Moments where they belong;
- corrections can reposition Moments;
- deterministic technical ordering does not manufacture historical certainty; and
- derived views preserve the underlying occurrence semantics.

## Engagement Does Not Reorder History

Comments, reactions, shares, views, notifications, edits, or other activity around a Moment do not change when the underlying experience occurred.

```text
2018 Moment
   │
   ├── comment in 2024
   ├── reaction in 2025
   └── edit in 2026

Timeline position: 2018
```

Chronologity should not transform old history into new history because it becomes active again.

## Timeline Versus Feed

Chronologity may have a Feed or other discovery surface, but a Feed and a Timeline serve different purposes.

A Feed may answer:

> What should I see now?

A Timeline answers:

> What happened when?

Conceptually:

```text
Feed
 └── discovery / current consumption

Timeline
 └── historical navigation
```

A ranking algorithm may influence a Feed.

It must not redefine the historical ordering of a Timeline.

## Search Versus Timeline

Search may rank results according to relevance.

That does not make relevance part of Timeline chronology.

```text
Search result order
        ≠
Timeline order
```

Selecting a search result may establish a historical entry point. Once the user enters Timeline navigation, the Moment belongs at its occurrence position.

## Notifications Versus Timeline

Notifications represent activity.

A notification in 2026 may point to a Moment from 2018.

```text
2026 notification
      ↓
2018 Moment
```

Opening the notification does not move the Moment into 2026.

Activity time and occurrence time remain distinct.

## Contextual Timelines

Chronologity may derive chronological views for a contextual scope.

For example:

```text
Location: Tokyo
      │
      └── accessible Moments associated with Tokyo
                         │
                         ▼
                 chronological view
```

or:

```text
Event: Concert
      │
      └── accessible Moments associated with Event
                         │
                         ▼
                 chronological view
```

These views are not separately owned Timeline containers.

They are chronology applied to a context.

## Automatic Contextual Grouping

Chronologity should prefer automatically derived context where reliable and useful rather than requiring users to maintain collections manually.

Potential context may include:

- location;
- real-world Events; and
- other explicitly defined contextual relationships.

Automatic grouping must not manufacture unsupported relationships.

Temporal proximity does not prove shared Event identity.

Geographic proximity does not prove shared meaning.

Media similarity does not prove that two Moments represent the same experience.

## Horizontal Context and Timeline Identity

Changing horizontal context changes the set or perspective of Moments being explored.

It does not create or mutate a Timeline entity.

Conceptually:

```text
Temporal position
       +
Context A
       ↓
Derived chronological view

Temporal position
       +
Context B
       ↓
Another derived chronological view
```

The experience should preserve temporal orientation across context changes as defined in `timeline.md`.

## Shared History

Multiple people may have Moments associated with the same real-world experience.

```text
Shared Event
   ├── User A Moment
   ├── User B Moment
   └── User C Moment
```

Chronologity may derive a shared chronological view from those accessible Moments.

This does not require a user-created shared Timeline container.

Shared history emerges from relationships among Moments, people, Events, locations, permissions, and other context.

## Privacy and Authorization

A Timeline is derived from information the viewer is authorized to access.

```text
All relevant Moments
        ↓
Authorization
        ↓
Viewer-accessible Moments
        ↓
Timeline
```

Private Moments must not be exposed merely because they participate in a public or shared context.

Authorization applies to:

- Moment-level chronology;
- horizontal contextual views;
- temporal aggregates;
- temporal zoom;
- historical jumps;
- counts and summaries; and
- other derived Timeline representations.

## Temporal Zoom

Temporal zoom is a **day-one Chronologity product feature**.

A Timeline must support navigation across multiple temporal scales so that users can understand and traverse histories spanning years or decades.

Conceptually:

```text
Life
 ↓
Decade
 ↓
Year
 ↓
Month
 ↓
Day
 ↓
Moment
```

The exact initial zoom levels remain an interaction-design decision, but Timeline derivation must support representations at more than one temporal scale.

A broader-scale representation may aggregate or summarize underlying Moments.

That aggregate is not itself a Moment.

```text
Temporal aggregate ≠ Moment
```

Zooming must preserve the underlying historical semantics and access boundaries.

## Historical Jumps

Historical jumps are also a **day-one Chronologity product feature**.

A user must be able to navigate directly to a distant temporal position without traversing every intervening Moment.

Conceptually:

```text
Current position: 2026
        │
        │ jump
        ▼
Target position: 2012
```

A historical jump changes navigation position.

It does not mutate history.

```text
Historical jump = Navigation
Historical jump ≠ Timeline mutation
```

The exact supported targets---year, month, day, exact date, landmark, Moment, or another form---are defined by the Timeline interaction specification.

## Sparse Time

A Timeline may contain long periods with few or no recorded Moments.

```text
2019 ── Moment
          │
          │
          │
2022 ── Moment
```

Chronologity must not interpret the gap as proof that nothing happened.

It means only that the derived Timeline contains no accessible represented Moment for that period.

Temporal zoom and historical jumps are especially important for navigating sparse history efficiently.

## Dense Time

A Timeline may contain many Moments within a short period.

```text
June 12
 ├── Moment
 ├── Moment
 ├── Moment
 ├── Moment
 └── Moment
```

Dense history must remain navigable without substituting popularity ranking for chronology.

Chronologity may use presentation techniques such as clustering, temporal aggregation, or compression while preserving access to the underlying Moments and their occurrence semantics.

## Unlimited Media Does Not Change Timeline Semantics

A Moment may contain an unlimited number of images and videos at the product-model level.

The number of media assets within a Moment does not create additional Timeline positions.

```text
One Moment
 ├── 1 image
 ├── 100 images
 └── many images + videos

Timeline positions represented: 1
```

The Timeline organizes Moments, not individual media assets.

If a Moment contains many media assets representing one coherent experience, it remains one historical Moment.

## Causality Does Not Define Timeline Order

Causal relationships between Moments are distinct from chronology.

```text
Moment A ──caused──► Moment B
```

is a semantic relationship.

The Timeline still positions both Moments according to their occurrence semantics.

Similarly:

```text
Moment A occurred before Moment B
```

does not prove that A caused B.

Chronology and causality remain separate structures over the same historical records.

## Relationship Traversal

Following a causal or semantic relationship may move the user to another Moment.

That movement is a semantic historical jump.

For example:

```text
Moment in 2018
   │
   └── led to
         │
         ▼
Moment in 2022
```

The destination belongs in 2022, and chronological navigation proceeds from that historical position.

Relationship traversal does not create adjacency between the Moments in the Timeline.

## Timeline Lifecycle

Because a Timeline is derived, it does not have an independent user-facing creation or deletion lifecycle by default.

There is no ordinary product operation equivalent to:

```text
Create Timeline
Rename Timeline
Delete Timeline
Add Moment to Timeline
Remove Moment from Timeline
```

Instead:

```text
Create Moment
      ↓
Timeline representation changes

Correct Moment occurrence time
      ↓
Timeline representation changes

Change Moment visibility
      ↓
Viewer-specific Timeline changes

Delete Moment
      ↓
Timeline representation changes
```

The Timeline evolves as its underlying accessible history changes.

## No Timeline Ownership

A derived Timeline does not require an independent owner.

Ownership or control belongs to the underlying domain information according to its own rules.

A person's Timeline may colloquially be described as "their Timeline," but that does not imply a separately owned Timeline resource.

```text
"Richard's Timeline"
        =
Chronological view of Richard's accessible history

not necessarily:

Timeline {
  ownerId: Richard
}
```

This distinction should be preserved in architecture discussions.

## No Timeline Membership

Chronologity should not introduce Timeline membership merely to model shared history.

People may participate in Moments, Events, locations, relationships, or other contexts.

Those relationships can produce shared chronological views.

```text
Shared history
        ≠
Timeline membership list
```

If Chronologity someday introduces an explicitly user-created collaborative historical container, that should be a new deliberate product concept rather than an accidental extension of Timeline.

## No Timeline Metadata by Default

Because Timeline is derived, it does not inherently need editable metadata such as:

- title;
- description;
- cover image;
- owner;
- member list;
- creation date; or
- custom sort order.

A contextual chronological view may display metadata belonging to the context itself.

For example:

```text
Event
 ├── name
 ├── location
 └── date

Event Timeline
 └── derived chronological view
```

The Event has metadata.

The derived Timeline does not need duplicate editable metadata.

## Timeline Naming

Product language may use phrases such as:

- My Timeline;
- your Timeline;
- Event Timeline;
- location Timeline; or
- shared Timeline.

These phrases describe chronological views.

They should not automatically become domain entities simply because the interface uses a noun phrase.

Product language and persistence topology are separate concerns.

## Timeline Product Invariants

1.  A Timeline is a derived chronological representation of Moments.
2.  Users create Moments; users do not create Timeline containers by default.
3.  Timeline is not, by product definition, an independently owned aggregate.
4.  Timeline does not have membership semantics by default.
5.  Timeline does not have an independent creation, rename, or deletion lifecycle by default.
6.  Timeline chronology is based on occurrence semantics rather than creation time.
7.  Historical insertion places a Moment where the represented experience occurred.
8.  Historical corrections may reposition Moments.
9.  Engagement activity does not reorder history.
10. Search ranking does not redefine Timeline order.
11. Notification time does not redefine Moment occurrence.
12. Deterministic presentation must not manufacture historical certainty.
13. Contextual chronological views remain derived views rather than user-created Timeline containers.
14. Automatic contextual grouping must not invent unsupported relationships.
15. A Timeline is viewer-specific wherever authorization affects accessible history.
16. Public context does not override private Moment access.
17. Temporal zoom is a day-one Timeline capability.
18. Historical jumps are a day-one Timeline capability.
19. Temporal aggregates are representations of history, not Moments.
20. Sparse periods do not prove that nothing happened.
21. Dense periods must remain navigable without popularity replacing chronology.
22. The number of media assets inside a Moment does not create additional Timeline positions.
23. Chronology and causality remain separate structures.
24. Relationship traversal may change navigation position without changing Timeline semantics.
25. Architecture must not create user-facing Timeline lifecycle semantics merely because a technical Timeline projection exists.

## Day-One Timeline Model Requirements

The initial product and architecture must support a Timeline model capable of:

- deriving chronology from Moments;
- ordering by occurrence semantics;
- inserting historical Moments into the correct temporal position;
- handling deterministic ordering where occurrence information is equal or ambiguous;
- enforcing viewer-specific authorization;
- deriving initial contextual chronological views;
- supporting temporal zoom;
- supporting historical jumps;
- representing sparse and dense historical periods;
- handling Moments containing potentially unlimited media without treating media as Timeline entries; and
- changing derived chronology when underlying Moment occurrence information, visibility, or existence changes.

These requirements exist from the beginning even if some advanced presentation capabilities evolve later.

## Open Product Questions

The following questions remain open and should be resolved deliberately:

- What temporal precision model should Chronologity use for exact, partial, and approximate occurrence information?
- How should intervals be represented in chronological ordering?
- What deterministic tie-breaker semantics should be visible, if any, when exact historical order is unknown?
- Which contextual chronological scopes exist on day one beyond a person's history?
- What qualifies Moments for the same real-world Event context?
- How should automatically derived contexts be corrected when they are wrong?
- What temporal aggregation semantics should power each day-one zoom level?
- How should dense periods be summarized at broader temporal scales?
- What should a historical jump return when no accessible Moment exists at the requested temporal position?
- How should a correction affecting the currently viewed Moment update active navigation?
- How should shared historical contexts behave when participants have different visibility rules?
- How should Timeline representations communicate uncertainty without making ordinary navigation cumbersome?

The following questions are resolved:

```text
Is Timeline a user-created container?        No
Do users manually add Moments to Timelines?  No
Does Timeline have an owner by default?      No
Does Timeline have members by default?       No
Is Timeline chronology derived?              Yes
Is occurrence time authoritative?            Yes
Is temporal zoom required day one?           Yes
Are historical jumps required day one?       Yes
```

## Relationship to `moments.md`

`moments.md` defines the historical records from which Timelines are derived.

```text
Moments + occurrence semantics = Timeline structure
```

Moment identity remains independent of Timeline representation.

## Relationship to `timeline.md`

This document defines **what a Timeline is**.

`timeline.md` defines **how users experience and navigate it**.

```text
timelines.md
    └── Product model

timeline.md
    └── Interaction model
```

The interaction specification defines vertical navigation, horizontal context, depth, temporal zoom, historical jumps, orientation, gestures, and navigation state.

## Relationship to `causality.md`

`causality.md` defines semantic and causal relationships between Moments.

The Timeline is temporal structure.

The causal relationship graph is semantic structure.

Neither should be substituted for the other.

## Relationship to `privacy.md`

`privacy.md` defines the access and privacy constraints under which Timeline views are derived.

Every Timeline query, context, aggregate, temporal zoom level, and historical jump must respect the viewer's authorization.

## Relationship to Architecture

This document intentionally does not prescribe a Timeline database table, aggregate, service, API, ClickHouse schema, cache, or event stream.

Architecture should derive the necessary read models from the product requirements.

The day-one requirements for temporal zoom and historical jumps mean the architecture must support efficient access across:

- distant temporal positions;
- multiple temporal scales;
- contextual scopes; and
- viewer-specific authorization.

A technical component named `timeline` is acceptable where useful.

What architecture must not do is allow that technical naming to silently introduce product semantics such as ownership, membership, manual Moment assignment, or independent Timeline lifecycle.

## Guiding Principle

When deciding whether something belongs to the Timeline product model, ask:

> **Is this a property of historical chronology, or are we accidentally turning chronology into a user-maintained container?**

Chronologity should organize history for the user rather than requiring the user to organize history for Chronologity.
