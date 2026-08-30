# Saved Views

## Overview

Saved Views allow a user to persist a particular way of exploring Chronologity's Moment universe.

A Saved View does not persist a Timeline. Timelines are derived views of Moments. Instead, a Saved View persists the inputs and navigation state needed to derive a Timeline again later.

A Saved View is therefore best understood as a persistent lens over Moments:

```text
Saved View specification
        ↓
current Moment graph and authorized data
        ↓
Timeline derivation
        ↓
current Timeline view
```

Because the Timeline is derived when the Saved View is opened, a Saved View can become richer as new Moments and contextual relationships are added to Chronologity.

## Product Principle

> A Saved View remembers how a user wants to look at history, not a frozen list of Moments.

This distinction is fundamental.

Chronologity stores canonical Moments and the contextual relationships used to organize and discover them. A Saved View stores a user's chosen perspective into that information. Opening the Saved View derives the appropriate Timeline from the current canonical state.

Saved Views must never introduce a persistent Timeline entity merely to support saving, resuming, sharing, or following a view.

## Goals

Saved Views should:

- let users return to meaningful historical explorations;
- preserve temporal and contextual orientation;
- allow derived Timeline results to evolve as Chronologity gains new Moments;
- provide a foundation for resuming exploration;
- support saved historical interests without duplicating Moments;
- eventually support following, sharing, and update discovery;
- preserve Chronologity's distinction between canonical Moments and derived Timelines.

## Non-Goals

Saved Views are not:

- persistent Timeline objects;
- frozen snapshots of every Moment visible when saved;
- Collections;
- replacements for individual Moment bookmarks;
- arbitrary persisted SQL, GraphQL, or database queries;
- mechanisms for bypassing current privacy or authorization rules.

## Core Concepts

### Moment Bookmark

A Moment Bookmark answers:

> "Which specific Moment do I want to remember?"

It references a canonical Moment.

```text
Moment Bookmark
      ↓
Moment
```

Moment Bookmarks are appropriate when the content itself is what the user wants to revisit.

### Saved View

A Saved View answers:

> "How do I want to look at the Moment universe?"

It persists a supported Timeline derivation specification and, where appropriate, the user's position within that derived view.

```text
Saved View
    ↓
View Specification
    ↓
Timeline derivation
    ↓
current authorized Moments
```

### Collection

A Collection answers:

> "Which Moments have I intentionally assembled together?"

A Collection has explicit Moment membership.

```text
Collection
├── Moment A
├── Moment F
├── Moment Q
└── Moment X
```

A Saved View instead contains derivation criteria:

```text
Saved View
├── context: Apollo 11
├── temporal range: July 1969
├── temporal zoom: day
└── anchor: Moon landing
```

The distinction is important:

- a Collection changes when its membership is intentionally changed;
- a Saved View can produce different results as the canonical Moment universe evolves.

## View Specification

Saved Views must persist a stable product-level View Specification rather than an implementation-specific query.

A View Specification may include:

- primary context;
- context type;
- temporal range;
- temporal anchor;
- temporal zoom level;
- perspective;
- supported filters;
- anchor Moment;
- navigation position;
- derivation version.

### Perspective

Perspective is **which lens is applied to a context's Moments**. Context type
says whose or what history is being explored; perspective says which of it.

For a person:

```text
all           everything on their Timeline
authored      only what they recorded
participated  only what they took part in
```

`timelines.md` defines a person's Timeline as what they authored together with
what they participated in, and the two halves are worth separating: "what my
father photographed" and "where my father was" are different questions about the
same person, and a view that could not tell them apart would answer neither.

A Location and a real-world Event have one perspective, `all`. Nothing about a
place distinguishes recording from taking part — everything at a place was
recorded by somebody. A perspective other than `all` on such a context is
refused rather than quietly ignored, because a saved view that silently meant
something else than it said would be worse than one that failed to open.

### Filters

A filter **narrows within a context without changing what the context is**. The
set is closed and enumerated:

```text
author              only Moments this person recorded
location            only Moments at this place
real-world Event    only Moments that were part of this occurrence
```

That makes "my father's photographs in Tokyo in the nineties" a view: a person as
the context, a place as a filter, a decade as the range.

**Closed on purpose.** A Timeline is chronology over a context; Search is what
answers questions. An engine that accepted arbitrary predicates would become a
second query language beside Search, which is the failure the specification
exists to prevent — and an open filter set cannot be persisted safely, because
nothing bounds what a stored view might ask of a later engine.

A filter naming the same thing as the context is refused. Filtering a Location's
Timeline by that Location is a statement with no content, and filtering it by a
different one is a view that can never hold anything; both are more likely to be
a mistake than an intention.

Supported context types may include product concepts such as:

- person;
- place;
- subject;
- real-world event;
- Collection;
- other canonical contextual entities supported by Timeline derivation.

The exact set of context types should evolve with the canonical product model.

Saved Views must not store raw SQL, arbitrary GraphQL documents, or datastore-specific query expressions as their product representation.

## Temporal State

A Saved View may preserve where the user was within an exploration.

For example:

```text
Context: World Trade Center construction
Temporal position: March 1969
Temporal zoom: day
Anchor Moment: <moment-id>
Perspective: place
```

When reopened, Chronologity should attempt to restore the user near that historical position while deriving the view from current data.

The anchor Moment is an orientation aid, not a frozen membership boundary.

If the anchor Moment is no longer visible to the user, Chronologity should derive the view using the remaining specification and choose an appropriate authorized position.

## Dynamic Derivation

Saved Views are dynamic by default.

Saving a view such as:

```text
Context: New York City
Range: 1970-1980
```

must not persist the IDs of every Moment currently matching that view.

Instead:

```text
Saved View specification
        ↓
derive against current canonical data
        ↓
current matching Moments
```

If previously unavailable Moments from 1974 are later added, they should naturally appear when the Saved View is reopened if they satisfy its derivation criteria.

This allows Chronologity's representation of the past to become richer without changing the meaning of the Saved View.

## Fixed and Rolling Temporal Ranges

Saved Views should distinguish between fixed and rolling temporal semantics.

### Fixed Range

A fixed range represents a specific historical interval.

Examples:

- August 24, 2026;
- 1960-1969;
- July 16-24, 1969.

Reopening the view retains that interval.

### Rolling Range

A rolling range is evaluated when the view is opened.

Examples:

- today;
- this year;
- last 30 days;
- since the beginning of the current month.

A rolling range should persist its semantic definition rather than resolving permanently to the dates that were current when saved.

The UI must make the difference between fixed and rolling ranges understandable to the user.

## Resume Exploration

Saved Views should support continuity across sessions.

A user who leaves an exploration should be able to return to approximately the same:

- context;
- temporal position;
- temporal zoom;
- perspective;
- filters;
- anchor Moment.

This enables Chronologity to support exploration as a continuing activity rather than an ephemeral feed session.

A future home or Saved experience may surface actions such as:

- Resume exploration;
- Continue from 1969;
- Return to Lower Manhattan;
- Reopen Apollo 11.

## Saved Views Experience

A Saved Views surface should emphasize historical entrances rather than a generic media grid.

A Saved View representation may communicate:

- user-defined or generated title;
- primary context;
- temporal range;
- temporal zoom;
- last explored position;
- representative Moment/media;
- whether new matching Moments are available;
- last visited time.

Example:

```text
Apollo 11
July 1969 · Day view
Resume: July 20
14 new Moments
```

The exact presentation is a design concern, but Saved Views should visually communicate that each item represents an exploration rather than an individual post.

## New-Moment Awareness

Because Saved Views are derivations, Chronologity can determine when newly available Moments satisfy a saved specification.

The initial Saved Views feature may simply indicate that the derived result has changed since the user's last visit.

It does not. Both shapes of that indication — a boolean and a count — were measured against 50,000 Moments before being built, and both cost about a second for a list of ten views before any authorization is resolved. New-Moment awareness therefore has to be precomputed rather than queried on the list path, which is a different design from either shape measured, and it is its own piece of work. ADR-132 records the numbers.

Potential later behavior includes:

- count of new matching Moments;
- highlighting newly available historical material;
- notifications for meaningful additions;
- summaries of what changed.

New-Moment awareness should not imply that the underlying historical subject itself changed. It indicates that Chronologity's available representation of that history has expanded or changed.

## Following a Saved View

Following is a potential evolution of saving.

Saving means:

> "Keep this perspective so I can return to it."

Following means:

> "Keep this perspective and surface meaningful changes to it."

A followed view could notify or otherwise inform the user when significant new Moments become available within its derivation.

This creates a Chronologity-native form of following:

```text
Follow historical context
        ↓
newly contributed past Moments
        ↓
representation of history becomes richer
```

Following Saved Views is not required for the initial Saved Views implementation, but the data model should avoid preventing it.

## Sharing

Saved Views are shareable.

What a link discloses about its sender is the sender's choice, and by default it discloses neither the view's title nor who saved it. A title is somebody's words about their own history, and a link outlives the conversation it was sent in, so revealing is an act rather than a consequence of sharing at all. One view may be shared more than once on different terms.

A link can be withdrawn, and a withdrawn one answers exactly as a link nobody was ever given does.

Sharing a Saved View should share a View Specification or stable reference to one, not a materialized list of visible Moments.

When another user opens the shared view:

```text
Shared Saved View
        ↓
load View Specification
        ↓
authorize for current Viewer
        ↓
derive Timeline
        ↓
return only currently visible Moments
```

The recipient may therefore see a different result from the sender when privacy or authorization differs.

Sharing must never confer access to a Moment that the recipient could not otherwise view.

## Privacy and Authorization

Saved Views are subject to current authorization every time they are opened.

Chronologity must not assume that because a user could see a Moment when the view was saved, the user can still see it later.

The derivation process must:

- authorize the current Viewer;
- exclude inaccessible Moments;
- respect blocks and privacy changes;
- respect moderation state;
- handle unavailable anchor Moments safely;
- avoid leaking inaccessible Moment metadata through counts, previews, titles, or notifications.

Saved View caches, if introduced, must preserve the same authorization guarantees.

## Deletion and Availability

A Saved View should remain valid when individual Moments become unavailable whenever the remaining View Specification can still be resolved.

If:

- an anchor Moment becomes unavailable;
- a contextual entity is merged or superseded;
- filters no longer produce results;

Chronologity should degrade gracefully rather than treating the Saved View as corrupt.

If the primary context itself can no longer be resolved, the product may mark the Saved View as unavailable and allow the user to remove it.

## View Versioning

Timeline derivation behavior may evolve.

Saved Views should therefore support a versioned View Specification or equivalent derivation version.

Versioning should allow Chronologity to:

- interpret older Saved Views;
- migrate specifications when semantics change;
- preserve user intent across derivation-engine changes;
- avoid coupling long-lived Saved Views to transient implementation details.

Versioning does not require preserving identical Moment results forever. The goal is to preserve the meaning of the saved perspective.

## Suggested Product Model

Conceptually:

```text
SavedView
├── id
├── userId
├── name
├── context
│   ├── type
│   └── id
├── temporalRange
│   ├── type
│   └── parameters
├── temporalZoom
├── perspective
├── filters
├── anchorMomentId?
├── anchorTime?
├── derivationVersion
├── createdAt
├── updatedAt
└── lastVisitedAt?
```

This is a product-level model, not a final database schema.

Implementation details should be defined in the relevant architecture and data-storage specifications.

## Relationship to Timeline Derivation

Saved Views depend on a stable Timeline derivation contract.

Conceptually:

```text
View Specification
        ↓
Timeline Derivation Engine
        ↓
ordered authorized Moments
        ↓
Timeline presentation
```

The derivation engine should accept equivalent inputs whether they originate from:

- active user navigation;
- a Saved View;
- a shared view;
- discovery;
- a curated path;
- another supported Chronologity entry point.

Saved Views should therefore reuse Timeline derivation semantics rather than implementing a separate saved-view query system.

## Discovery Implications

Saved Views can become a valuable personalization signal.

Saving a view may indicate interest in:

- a context;
- a historical period;
- a place;
- a subject;
- a perspective;
- a style of temporal exploration.

Chronologity may use these signals to improve discovery, subject to the broader product rules governing personalization.

A Saved View must not become an excuse to replace Chronologity's chronological Timeline with engagement-ranked content.

## Success Criteria

Saved Views are successful if they help users:

- return to explorations they care about;
- resume without reconstructing context manually;
- discover newly available Moments within previously explored history;
- develop durable interests in places, subjects, people, events, or periods;
- move from isolated Moment consumption toward sustained historical exploration.

Useful product metrics may include:

- Saved Views created per active explorer;
- Saved View reopen rate;
- time between save and reopen;
- resumed exploration depth;
- percentage of reopened views containing newly available Moments;
- transitions from reopened views into adjacent contexts;
- retention among users who create Saved Views versus those who do not.

These metrics should measure exploration utility rather than optimize for compulsive engagement.

## Initial Scope

The initial Saved Views implementation should support:

- creating a Saved View from a currently derived Timeline;
- naming or accepting a generated name for the view;
- persisting supported View Specification fields;
- preserving an optional temporal/ Moment anchor;
- listing a user's Saved Views;
- reopening a Saved View;
- deriving current authorized Moments when reopened;
- updating the saved exploration state;
- removing a Saved View.

The initial implementation does not need:

- public Saved Views;
- following;
- notifications for new matching Moments;
- collaborative Saved Views;
- social popularity metrics;
- complex sharing;
- arbitrary user-authored derivation expressions.

## Future Extensions

Potential extensions include:

- follow a Saved View;
- notify users about meaningful new matching Moments;
- share Saved Views;
- public or discoverable Saved Views;
- duplicate/remix another user's shared View Specification;
- organize Saved Views into folders or Collections of views;
- compare two Saved Views temporally;
- use Saved Views as inputs to curated paths;
- recommend adjacent perspectives from a Saved View;
- synchronize Saved View state across devices in real time.

These should be introduced only when they deepen temporal exploration rather than turning Saved Views into another generic social-content surface.

## Product Invariants

1. Moments are canonical objects; Timelines are derived views.
2. Saving a view must not create a persistent Timeline merely to support the feature.
3. A Saved View stores derivation intent and exploration state, not a frozen list of matching Moments.
4. Reopening a Saved View derives its Timeline from current canonical data.
5. Newly available qualifying Moments may appear in an existing Saved View.
6. Current privacy and authorization are always reapplied.
7. A Saved View cannot grant access to a Moment.
8. Collections and Saved Views have different semantics: explicit membership versus dynamic derivation.
9. Moment Bookmarks and Saved Views have different semantics: remembered object versus remembered perspective.
10. View Specifications must be product-level, stable, and versionable rather than datastore-specific queries.
11. Saved Views must preserve chronological Timeline behavior and must not introduce engagement-based ordering.
12. The feature should strengthen exploration continuity and temporal discovery rather than imitate conventional social-media bookmarking.
