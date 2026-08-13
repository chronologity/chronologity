# Chronologity Timeline Experience

## Purpose

This document defines how users experience and navigate Chronologity's Timeline. Where `timelines.md` defines what a Timeline is at the product-model level, this document defines the interaction model through which a user moves through time, changes contextual perspective, and enters individual Moments.

Chronologity's Timeline experience is organized conceptually across three dimensions:

```text
Vertical   → Time
Horizontal → Context
Depth      → Moment
```

These dimensions are semantic interaction principles. They do not require every interface to render a literal three-dimensional scene.

## Experience Goal

The Timeline should make history feel navigable. A user should be able to understand where they are in time, what happened before and after the current Moment, what context they are exploring, what other context exists around the same point in time, and how to inspect a Moment more deeply without losing their place.

The central question is not "What content should the system show me next to maximize engagement?" It is:

> Where am I in this history, and where do I want to go from here?

## The Three-Dimensional Model

```text
                         CONTEXT
                   ◄────────────────►
                  Location / Event groups

                           │
                           ▼
                        Moment
                           │
TIME                    Moment
  │                        │
  ▼                     Moment
                           │
                        Moment
                           │
                           ▼
                         DEPTH
                    Moment details
```

| Dimension  | Meaning | Primary Question                                      |
| ---------- | ------- | ----------------------------------------------------- |
| Vertical   | Time    | What happened before or after this?                   |
| Horizontal | Context | What else was happening around this point in time?    |
| Depth      | Moment  | What is contained within or connected to this Moment? |

## Vertical Dimension: Time

Vertical movement navigates through Moments according to occurrence semantics.

```text
Earlier
   ▲
   │
Moment A
   │
Moment B
   │
Moment C
   │
   ▼
Later
```

Chronology is authoritative. Creation time, upload time, comments, reactions, popularity, recommendations, and other engagement signals must not determine vertical ordering.

Users should be able to move both backward and forward through history. Chronologity must support both "What happened next?" and "What happened before this?"

### Historical Insertion

A Moment recorded later must appear where it belongs historically.

```text
2018 ── Moment A
2019 ── Newly recorded historical Moment
2020 ── Moment B
2022 ── Moment C
```

The Timeline represents history rather than publication order.

### Deterministic Ordering Without False Certainty

When Moments share the same known temporal position, presentation must remain deterministic, but a technical tie-breaker must not be presented as known historical sequence.

```text
Deterministic presentation order ≠ Known historical order
```

## Horizontal Dimension: Context

Horizontal movement changes contextual perspective around a point in time.

Initial contextual groupings may include locations and real-world events. Additional contexts should be introduced only when their semantics are explicit.

Horizontal movement answers:

> What other relevant context can I explore around here?

Context is not another chronology. Changing context does not redefine when a Moment occurred.

### Automatic Context

Chronologity should prefer automatically derived contextual groupings over requiring users to manually file Moments into collections. Users create Moments; Chronologity uses available information to expose meaningful context.

Automatic grouping must not invent relationships. Temporal proximity, geographic proximity, or similar media alone do not prove that Moments belong to the same real-world event.

## Preserving Temporal Position Across Context

Horizontal navigation should preserve temporal orientation as closely as the available history allows.

```text
Context A                       Context B

2025                            2025
 │                               │
June 2026  ─── horizontal ───►  June 2026
 │                               │
2027                            2027
```

Changing perspective should not unexpectedly transport the user to the beginning, end, or most popular portion of the new context.

If no Moment exists at the exact temporal position, Chronologity should preserve orientation rather than fabricate a match. The interface may position the user near the closest relevant Moment while making the temporal relationship understandable.

## Depth Dimension: Moment

Depth represents entering a Moment to understand it more completely.

```text
Timeline
   │
   ▼
Moment
   │
   ▼
Moment Detail
   ├── Media
   ├── Description
   ├── Time
   ├── Context
   ├── Comments
   ├── Reactions
   └── Relationships
```

Entering depth should not destroy the user's Timeline position. Exiting should return the user to the same meaningful chronological and contextual position whenever possible.

Conceptually, navigation state includes:

```text
Time Position + Context Position + Moment Position
```

## Active Moment

One Moment may be the active or focused Moment in the primary Timeline experience. This can drive media presentation, video playback, contextual indicators, accessibility focus, and loading of nearby Moments.

Being active does not alter a Moment's historical significance or domain identity.

## Images and Video

Image and video Moments participate in the same chronology.

```text
Image Moment
     ↓
Video Moment
     ↓
Image Moment
```

Media type affects presentation, not historical ordering.

When a video Moment becomes active, it is intended to autoplay with sound by default. Users should eventually be able to disable autoplay. Playback must respect platform restrictions, accessibility, network conditions, and explicit preferences.

## Orientation

Chronologity should continuously provide enough information for users to understand their position without overwhelming the interface. Useful signals may include date or temporal period, location or event context, neighboring relationships, movement direction, and broader temporal scale.

The exact visual design is not prescribed here. The requirement is that users should not become disoriented about when or in what context they are exploring.

## Temporal Landmarks

Long histories may benefit from year, month, date, or other meaningful temporal markers. Landmarks help communicate scale and movement but should not become artificial Moments unless they represent actual experiences.

## Sparse and Dense Time

Real histories are unevenly documented.

Sparse periods should be represented honestly. A gap means Chronologity has no represented Moment for that period; it does not prove that nothing happened.

Dense periods must remain navigable without replacing chronology with popularity ranking. Techniques may include clustering, temporal compression, zoom, or summaries that preserve access to underlying Moments.

## Temporal Zoom

**Temporal zoom is a day-one Chronologity product feature.**

A Timeline intended to represent years or decades of history cannot require users to navigate only one Moment at a time. From the initial product release, users must be able to change the temporal scale at which they explore history.

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

The exact set of exposed zoom levels may be refined through interaction design, but the ability to move between broader and narrower temporal scales is foundational rather than optional.

Zooming out should allow users to understand and traverse larger spans of history efficiently. Zooming in should progressively expose greater chronological detail until the user reaches individual Moments.

A zoomed-out representation may summarize, cluster, or otherwise represent a period, but that representation must not be confused with an underlying Moment.

```text
Temporal summary ≠ Moment
```

Zooming back in must preserve access to the actual chronological records represented by the broader view.

### Temporal Position During Zoom

Changing temporal scale should preserve the user's historical orientation.

For example, if a user is exploring June 2026 and zooms outward:

```text
June 12, 2026
      ↓ zoom out
June 2026
      ↓ zoom out
2026
```

Zooming inward should return toward the same temporal region rather than arbitrarily repositioning the user.

```text
2026
 ↓ zoom in
June 2026
 ↓ zoom in
June 12, 2026
```

The system should preserve an anchor representing the user's temporal position as scale changes.

### Zoom and Context

Temporal zoom and horizontal context are separate dimensions.

A user should be able to change temporal scale without silently changing the context being explored.

Conceptually:

```text
Temporal Scale + Temporal Position + Context
```

should remain independently understandable.

### Zoom and Sparse History

Zooming out is especially important when history is sparse. A user should not need to traverse large empty periods sequentially merely because few Moments were recorded.

### Zoom and Dense History

Zooming out also helps make dense historical periods understandable without resorting to engagement-based ranking.

Chronologity may summarize or cluster dense periods at broader scales while preserving the ability to zoom into the individual Moments.

## Historical Jumps

**Historical jumps are a day-one Chronologity product feature.**

Sequential movement must not be the only way to traverse history. Users must be able to intentionally move to distant temporal positions without navigating through every intervening Moment.

A user should be able to express an intent conceptually equivalent to:

> Take me to 2018.

or:

> Take me to June 2024.

The precise controls and temporal precision available in the initial interface should be resolved through interaction design, but historical jumping itself is not optional.

### Jump Targets

Historical jumps may target temporal positions such as:

- a year;
- a month;
- a day or exact date, where supported;
- a temporal landmark;
- a known Moment;
- a search result;
- a contextual landmark;
- a deep link; or
- another explicitly defined historical entry point.

The initial product does not necessarily need every possible target type, but it must provide a practical mechanism for moving directly across large spans of time.

### Jumping Does Not Change History

A historical jump changes navigation position.

It does not alter the Timeline or the Moments within it.

```text
Historical jump = Navigation operation
Historical jump ≠ Historical mutation
```

### Jumping to Sparse Periods

A requested temporal position may contain no Moment.

For example:

```text
Jump target: June 2021

Nearby Moments:
February 2021
November 2021
```

Chronologity should preserve the requested temporal orientation rather than silently redefining the target as one of the nearby Moments.

The interface may expose the nearest surrounding Moments while making clear that the requested position lies between them.

### Jumping and Context

A historical jump should preserve the current contextual perspective unless the jump itself explicitly specifies another context.

```text
Current Context + New Temporal Position
```

is different from:

```text
New Context + New Temporal Position
```

The product should avoid changing both dimensions implicitly when the user intended to change only time.

### Jumping and Temporal Zoom

Historical jumps and temporal zoom should work together.

A user might zoom out to a year-level view, jump to a distant year, and then zoom inward toward a specific month, day, or Moment.

Conceptually:

```text
Moment
  ↓ zoom out
Year 2026
  ↓ historical jump
Year 2012
  ↓ zoom in
Month
  ↓ zoom in
Moment
```

This combination is essential to making long-lived Timelines practical to navigate.

## Search, Discovery, Notifications, and Deep Links

Search and discovery may establish entry points into history without redefining chronology.

```text
Search or Discovery
        ↓
      Moment
        ↓
Chronological context
```

A notification may similarly lead to an old Moment because something new happened around it. New activity around old history must not collapse activity time and occurrence time into one concept.

Deep links should provide a path from a directly opened Moment into its surrounding historical context.

These mechanisms may also function as historical jumps because they establish a new temporal navigation position.

## Context Switching

Changing horizontal context should feel like changing perspective rather than starting a new session.

```text
Same approximate time + Different context = Horizontal navigation
```

This principle should hold whether context represents location, real-world event, or another deliberately defined perspective.

## Navigation History

Users should be able to reverse meaningful navigation actions predictably.

If a user:

```text
Zooms out
   ↓
Jumps to another year
   ↓
Changes context
   ↓
Enters a Moment
```

back navigation should unwind that journey coherently while preserving useful state.

## Loading and Continuity

A Timeline may contain more history than can be loaded at once. Loading boundaries must not feel like the end of history when more Moments exist.

Chronologity should progressively load nearby information while preserving position and preventing disruptive jumps. Pagination, cursors, prefetching, caching, and virtualization are implementation concerns that should remain largely invisible to the user.

Temporal zoom and historical jumps make this especially important because the client must be capable of moving efficiently to regions of history that are not currently loaded.

## Offline and Intermittent Connectivity

Where practical, mobile clients should preserve the user's current position and already available nearby content during temporary connectivity loss.

Offline behavior must not imply that locally cached history is complete when additional records may exist.

The exact extent to which temporal zoom and historical jumps function offline depends on the locally available historical index and cached data and should be specified separately.

## Accessibility

The three-dimensional model, temporal zoom, and historical jumps must not depend exclusively on visual spatial metaphors.

The semantics of time, context, Moment depth, temporal scale, and direct historical navigation must remain usable with screen readers, keyboard or switch navigation, reduced-motion settings, captions, alternative media descriptions, and other assistive technologies.

Animation may reinforce movement, but it must not be required to understand the navigation model.

## Gestures

Touch gestures may provide natural controls, such as vertical swipes for chronology, horizontal swipes for context, and deliberate actions for entering a Moment.

Temporal zoom may also use gestures where appropriate, but it must have an accessible and discoverable interaction model that does not depend exclusively on pinch gestures or other visually oriented controls.

Historical jumps similarly require an explicit, discoverable mechanism rather than depending on gesture knowledge.

Gesture mappings are interaction-design choices rather than immutable product rules.

## Navigation Invariants

1.  Vertical navigation represents movement through time.
2.  Vertical ordering is determined by occurrence semantics rather than engagement.
3.  Horizontal navigation represents contextual movement rather than a second chronology.
4.  Horizontal changes should preserve temporal position as closely as available history allows.
5.  Context should be derived automatically where reliable and useful rather than requiring unnecessary user organization.
6.  Automatic grouping must not invent unsupported relationships.
7.  Depth represents entering a Moment for greater detail and context.
8.  Exiting depth should restore the prior Timeline position whenever possible.
9.  Image and video Moments participate in the same chronological experience.
10. Social activity does not change historical position.
11. Search, discovery, notifications, and deep links may establish entry points without redefining chronology.
12. Deterministic presentation must not imply historical certainty Chronologity does not possess.
13. Sparse periods must not be interpreted as proof that nothing happened.
14. Dense periods must remain navigable without replacing chronology with popularity ranking.
15. **Temporal zoom is a foundational navigation capability and must be available from the initial product release.**
16. **Historical jumps are a foundational navigation capability and must allow users to reach distant temporal positions without sequentially traversing intervening Moments.**
17. Zooming or jumping through time changes navigation position without changing the underlying historical record.
18. Temporal zoom should preserve the user's temporal anchor as scale changes.
19. Historical jumps should preserve the current context unless the user explicitly changes context.
20. Temporal zoom and historical jumps must work together coherently.
21. Loading and caching must not cause unexplained position changes.
22. The three-dimensional model must remain understandable without relying exclusively on animation, gestures, or visual spatial perception.
23. Navigation state should preserve enough temporal scale, temporal position, context, and Moment information for users to remain oriented.

## Day-One Timeline Experience

The initial Timeline experience must include:

```text
Chronological Moments
        +
Stable vertical navigation
        +
Contextual grouping
        +
Moment depth
        +
Preserved navigation position
        +
Temporal zoom
        +
Historical jumps
```

Temporal zoom and historical jumps are not advanced enhancements. They are foundational to Chronologity.

A chronological product that can accumulate years or decades of history cannot require users to traverse Moments sequentially to reach distant periods. Likewise, a Timeline cannot remain understandable at large scale if users have no way to change temporal resolution.

Sophisticated clustering, complex relationship traversal, and other advanced navigation capabilities can evolve later. Their absence must not prevent users from navigating history at multiple temporal scales or moving directly to distant historical positions.

## Open Product Questions

The existence of temporal zoom and historical jumps is decided. The following questions concern their interaction design and scope:

- Does upward movement mean earlier or later in time?
- What is the exact interaction for horizontal context switching?
- Which contextual groupings are available initially?
- How are locations and real-world events visually distinguished?
- How does a user discover that horizontal context exists?
- What happens when a target context has no Moment near the current temporal position?
- How should partial or approximate dates appear during navigation?
- How are simultaneous or historically unordered Moments presented?
- How should dense periods be grouped?
- What temporal landmarks appear by default?
- What interaction should users use to move rapidly through years or decades?
- Which temporal zoom levels must the initial experience expose?
- How should users transition between temporal zoom levels?
- Which historical jump targets must be supported initially: year, month, day, exact date, or another combination?
- How should historical jumps behave when no Moment exists at the requested temporal position?
- How should temporal zoom and historical jumps interact with approximate dates?
- How should the Timeline behave when a correction moves the active Moment?
- How should autoplay behave after horizontal navigation, temporal zoom, historical jumps, or returning from depth?
- Which Timeline state should be encoded in deep links?
- How much navigation state should survive application restarts?
- What offline behavior belongs in the initial mobile release?
- What gesture model best represents the dimensions without harming accessibility or discoverability?

These questions should be answered through prototypes and usability testing rather than backend architecture.

## Relationship to `timelines.md`

`timelines.md` defines the Timeline product model. This document defines the Timeline experience.

```text
timelines.md → What is the chronological structure?
timeline.md  → How does a user navigate and experience it?
```

Neither document should introduce a user-created Timeline container unless the product model is intentionally changed.

## Relationship to Architecture

The navigation dimensions do not require separate database dimensions, separate services, a literal 3D rendering engine, a persisted navigation entity, separate APIs for every movement operation, or a specific client navigation library.

However, because temporal zoom and historical jumps are day-one requirements, the architecture must support efficient retrieval across both **temporal scale** and **distant temporal positions** from the beginning.

This has direct implications for Timeline query design, indexing, cursor semantics, client navigation state, caching, and read-model design. These implications should be addressed explicitly in the architecture documentation rather than deferred as future scaling concerns.

Architecture should provide the data and state necessary to preserve the interaction invariants using the simplest reliable implementation.

## Guiding Principle

When evaluating Timeline interaction design, ask:

> **Does the user understand where they are in time, at what temporal scale they are viewing history, what context they are exploring, and how to move to another point in history without losing orientation?**

The Timeline succeeds when navigating years or decades of history feels coherent, direct, and trustworthy rather than algorithmically arbitrary.
