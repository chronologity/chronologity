# Chronologity Real-World Events

## Purpose

This document defines the product semantics of **real-world Events** in Chronologity.

A real-world Event is historical context that can connect multiple Moments around a shared occurrence such as a concert, wedding, conference, protest, sporting event, festival, natural disaster, launch, ceremony, or other bounded happening in the world.

The central question is:

> **When should multiple Moments be understood as perspectives on the same real-world occurrence, and what does that shared Event mean?**

This document concerns historical real-world Events. It does not define software, domain, or integration events.

## Definition

A **real-world Event** is a historical occurrence or bounded happening that provides shared context for one or more Moments.

Conceptually:

```text
Real-World Event
      │
      ├── Moment A
      ├── Moment B
      ├── Moment C
      └── Moment D
```

The Event represents the shared occurrence.

The Moments represent experiences or perspectives associated with it.

For example:

```text
Event:
Anime NYC 2026

Moments:
├── User A arriving at the convention
├── User B attending a panel
├── User C meeting an artist
└── User D recording the closing ceremony
```

The Event does not replace those Moments.

It provides context connecting them.

## Event Versus Moment

A Moment represents an experience.

An Event represents a shared historical occurrence that may contain or contextualize many experiences.

```text
Event ≠ Moment
```

A wedding may be an Event.

A photograph of the bride walking down the aisle may belong to a Moment associated with that Event.

A concert may be an Event.

A User's experience of hearing a particular song during the concert may be a Moment associated with it.

A Moment can exist without an Event.

An Event can exist even when Chronologity currently contains only one associated Moment.

## Event Identity

An Event must have identity independent of any individual Moment.

If one associated Moment is edited, hidden, deleted, or removed, the Event does not automatically cease to exist.

Likewise, multiple Users independently creating Moments about the same occurrence should not require Chronologity to create permanently separate Events merely because the Moments were authored separately.

Conceptually:

```text
Moment A ─┐
Moment B ─┼──▶ Event X
Moment C ─┘
```

rather than:

```text
Moment A ──▶ Event X1
Moment B ──▶ Event X2
Moment C ──▶ Event X3
```

when all three genuinely refer to the same occurrence.

## Event Identity Is Historical Identity

Two Events are the same Event when they represent the same historical occurrence, not merely because they have the same name.

For example:

```text
"The Eras Tour"
```

may refer to a broader tour consisting of many distinct concerts.

Individual performances in different cities and on different dates are not necessarily the same Event.

Likewise:

```text
"Weekly Team Meeting"
```

may be the same recurring type of occurrence while each meeting remains a distinct historical Event.

Chronologity must distinguish Event identity from Event naming or categorization.

## Event Boundaries

An Event has historical boundaries.

Those boundaries may include:

- temporal boundaries;
- geographic boundaries;
- organizational or semantic boundaries; and
- relationships to broader or narrower Events.

Some Events are tightly bounded:

```text
Concert
Start: 8:00 PM
End: 10:45 PM
Venue: Madison Square Garden
```

Others are less precise:

```text
Neighborhood blackout
Approximate start
Approximate restoration
Affected area
```

Chronologity must support uncertainty rather than requiring false precision.

## Event Time

An Event may have:

- an exact start time;
- an exact end time;
- an approximate start;
- an approximate end;
- a date without exact clock time;
- a multi-day span; or
- another historically meaningful temporal range.

Event time and Moment occurrence time are related but distinct.

A Moment associated with an Event may occur:

- before the formal Event begins;
- during the Event;
- immediately after it; or
- in another period legitimately considered part of the Event experience.

For example:

```text
Concert Event:
8:00 PM – 11:00 PM

Associated Moments:
6:30 PM — arriving at venue
7:15 PM — waiting in line
9:20 PM — performance
11:30 PM — leaving venue
```

The product must not require every associated Moment timestamp to fall mechanically inside the Event's formal start/end interval.

## Event Duration

Events may be instantaneous, short, long, or multi-day.

Examples include:

```text
Proposal
Concert
Wedding
Conference
Festival
Election Day
Storm
Multi-day convention
```

Chronologity should not impose one arbitrary maximum Event duration.

However, an Event should represent a coherent occurrence rather than becoming an unlimited container for unrelated history.

## Event Location

An Event may be associated with one or more locations.

A simple Event may occur at one venue.

A larger Event may span:

- multiple rooms;
- multiple buildings;
- a campus;
- a neighborhood;
- a city;
- multiple cities;
- a route;
- a region; or
- geographically distributed locations.

For example:

```text
Marathon
  └── route across many locations
```

or:

```text
Global product launch
  ├── New York
  ├── London
  └── Tokyo
```

The Event model must therefore not assume exactly one geographic point.

Detailed location semantics belong in `locations.md`.

## Event Name

An Event may have a recognized name.

Examples:

```text
Anime NYC 2026
Super Bowl LX
Richard and Alice's Wedding
Company All Hands — August 2026
```

But not every historical Event has an official name.

Chronologity must support Events described by useful contextual labels without implying that those labels are globally canonical historical names.

Names may also change or differ among communities.

Event identity must therefore not depend solely on normalized Event-name text.

## Event Description

An Event may have descriptive historical context explaining what occurred.

Descriptions should not silently become authoritative historical truth merely because they are attached to an Event.

Chronologity may eventually distinguish:

- User-authored descriptions;
- collaboratively established context;
- imported factual metadata;
- institutional descriptions;
- AI-generated summaries; and
- other provenance.

The source of historical interpretation matters.

## Event Types

Chronologity may categorize Events.

Potential categories include:

- personal;
- family;
- cultural;
- entertainment;
- sporting;
- political;
- civic;
- educational;
- professional;
- religious;
- natural;
- technological; and
- other categories.

These categories should be treated as classification rather than Event identity.

A single Event may legitimately fit multiple categories.

The initial product should avoid an excessively rigid taxonomy.

## Personal Events

Not every Event needs broad public significance.

Personal history contains Events such as:

- weddings;
- birthday parties;
- graduations;
- reunions;
- vacations;
- funerals;
- family gatherings; and
- private celebrations.

A private Event can be historically significant within a personal or family scope even if no public record of it exists.

Chronologity's Event model must therefore work equally well for private and public history.

## Public Events

Public Events may connect large numbers of independent Users and Moments.

Examples include:

- concerts;
- conventions;
- sporting events;
- elections;
- protests;
- public ceremonies;
- disasters; and
- major cultural occurrences.

A public Event may accumulate enormous historical depth over time.

The Event model must not assume that all associated Moments can be loaded or processed synchronously.

## Event Hierarchy

Real-world history often contains Events within Events.

For example:

```text
Anime NYC 2026
  │
  ├── Opening Ceremony
  ├── Panel A
  ├── Panel B
  └── Closing Ceremony
```

or:

```text
Olympic Games
  │
  ├── Opening Ceremony
  ├── Swimming Competition
  │      └── Final Race
  └── Closing Ceremony
```

Chronologity should support Event hierarchy where the historical relationship is meaningful.

A child Event is a distinct historical occurrence within the context of a broader parent Event.

```text
Child Event ≠ merely an arbitrary grouping
```

## Event Hierarchy Is Not Moment Nesting

Event hierarchy must not reintroduce Sub-Moments.

Chronologity has intentionally kept Moment chronology flat.

```text
Event
  ├── Child Event
  │     ├── Moment
  │     └── Moment
  └── Moment
```

does not imply:

```text
Moment
  └── Sub-Moment
```

Events organize shared historical context.

Moments remain independently ordered historical experiences.

## Parent and Child Event Time

A child Event should generally occur within or meaningfully overlap the historical span of its parent Event.

Chronologity should not require exact containment when real-world boundaries are approximate.

However, obviously contradictory relationships should be rejected or flagged.

For example:

```text
Parent Event:
2026

Child Event:
2024
```

would require an explicit historical explanation rather than being accepted silently.

## Event Series

Repeated Events may belong to a common series without being the same Event.

For example:

```text
Anime NYC
  ├── Anime NYC 2024
  ├── Anime NYC 2025
  └── Anime NYC 2026
```

or:

```text
Annual Family Reunion
  ├── 2024 Reunion
  ├── 2025 Reunion
  └── 2026 Reunion
```

Chronologity should distinguish:

```text
Event instance
```

from:

```text
Event series
```

The initial product does not necessarily require Event Series as a first-class user-facing entity, but the Event model should not make future representation impossible.

## Recurring Events

Recurring Events are separate historical occurrences connected by recurrence.

```text
Monday meeting — August 3
Monday meeting — August 10
Monday meeting — August 17
```

These are not one Event stretched across three weeks.

Chronologity should preserve occurrence identity rather than collapsing recurrence into one historical Event.

## Event Association

A Moment may be associated with a real-world Event when the Moment meaningfully relates to that Event.

Association should represent historical context.

It should not merely mean:

> "This Moment happened near the Event."

For example, a User eating lunch across the street from a convention venue during the convention is not necessarily participating in the convention Event.

Chronologity should avoid inferring Event association from temporal and geographic proximity alone.

## Explicit Event Association

Users should be able to explicitly associate a Moment with an Event where they have sufficient access and the association is historically appropriate.

Conceptually:

```text
Moment
  │
  └── associated with
          │
          ▼
        Event
```

The product must preserve provenance indicating whether an association was:

- explicitly established by a User;
- suggested by the system;
- inferred algorithmically;
- imported from trusted metadata; or
- established through another future mechanism.

## Automatic Event Suggestions

Chronologity may suggest likely Event associations based on information such as:

- occurrence time;
- location;
- media metadata;
- existing Event context;
- people;
- User-provided text; or
- other relevant signals.

A suggestion is not an established historical fact.

```text
System suggests Event X
        ≠
Moment is definitively part of Event X
```

Users should be able to confirm or reject suggestions where appropriate.

AI or automated systems must not silently establish uncertain Event associations as authoritative historical truth.

## Event Creation

Users should be able to establish a real-world Event when no appropriate Event already exists, subject to product permissions and moderation rules.

Creating an Event should not require the creator to own every Moment that may eventually become associated with it.

An Event represents shared historical context rather than a private folder controlled absolutely by its creator.

## Event Creator

The User who initially establishes an Event has creation provenance.

That does not necessarily make that User the owner of the historical occurrence.

```text
Created Event record
        ≠
Owns the real-world Event
```

This distinction is essential for public history.

A User who creates the first Chronologity record for a concert, election, protest, disaster, or public ceremony should not gain unilateral authority over everyone else's historical association with that Event.

## Event Stewardship

Chronologity may eventually need Event-management or stewardship capabilities for correcting metadata, resolving duplicates, moderating descriptions, or managing contested context.

Those capabilities should not be modeled as ordinary ownership.

Potential future models may include:

- creator privileges;
- participant contributions;
- community correction;
- trusted curators;
- institutional verification;
- moderation intervention; or
- another provenance-aware system.

The initial Event model should preserve enough provenance to evolve toward such mechanisms.

## Duplicate Events

Multiple Users may independently create records for what is actually the same real-world Event.

Chronologity must therefore support duplicate detection and eventual reconciliation.

For example:

```text
Event A:
Anime NYC 2026

Event B:
Anime NYC
November 2026
Javits Center
```

may represent the same occurrence.

Duplicate detection may use:

- names;
- times;
- locations;
- associated Moments;
- participants;
- external identifiers;
- Event hierarchy;
- semantic similarity; or
- other signals.

Automatic detection should not automatically merge uncertain Events without appropriate confidence or review.

## Event Merging

When two Event records are confirmed to represent the same historical occurrence, Chronologity should be able to merge or reconcile them without losing provenance.

Conceptually:

```text
Event A ─┐
         ├──▶ Canonical Event X
Event B ─┘
```

Associated Moments should continue referring to the correct historical Event after reconciliation.

The system should preserve enough internal history to understand that separate Event records once existed and were reconciled.

## Event Splitting

The inverse problem also exists.

An Event may initially be modeled too broadly and later be recognized as multiple distinct historical occurrences.

For example:

```text
"Conference 2026"
```

may incorrectly combine two unrelated conferences with similar names.

Chronologity should eventually support splitting or correcting Event identity without rewriting Moment occurrence history.

This operation is more complex than ordinary metadata editing and should preserve provenance.

## Event Correction

Event metadata may be wrong.

Chronologity should allow correction of information such as:

- name;
- start time;
- end time;
- location;
- description;
- hierarchy;
- series association; or
- other contextual metadata.

Corrections should not silently alter the authoritative content of associated Moments.

If an Event time is corrected, the Moments remain at their own occurrence times.

The Event relationship may need re-evaluation if the correction reveals that an association was erroneous.

## Event Deletion

Deleting an Event record must not automatically delete its associated Moments.

```text
Delete Event
    ≠
Delete Moments
```

If an Event is removed because it was a duplicate, associated Moments should normally be reassociated with the surviving Event.

If an Event is removed because it was invalid or fabricated, its Moments remain historical records but lose that invalid Event association unless another valid association exists.

## Event Visibility

Event visibility cannot be modeled as one universal flag independent of associated history.

An Event may have:

- public metadata;
- private metadata;
- public Moments;
- private Moments;
- Moments visible to different audiences; and
- sensitive contextual information.

For example, a private wedding Event should not become publicly discoverable merely because one participant accidentally creates a public-facing association.

Likewise, a public Event does not make every associated Moment public.

```text
Public Event
    ≠
Public Moments
```

## Event Privacy

Chronologity must apply privacy to Event-derived experiences.

A User should only see Event information they are authorized to see.

This applies to:

- Event pages or views;
- Moment collections;
- participant context;
- temporal zoom;
- historical jumps;
- search;
- discovery;
- notifications;
- counts;
- summaries;
- maps; and
- other derived representations.

Event aggregation must not become a privacy bypass.

## Private Events

Chronologity must support Events whose existence itself may be private.

Examples could include:

- private family gatherings;
- sensitive support meetings;
- private ceremonies;
- confidential professional Events; or
- other restricted occurrences.

In these cases, even revealing:

```text
"An Event occurred here at this time"
```

may leak sensitive information.

Chronologity must therefore treat Event existence, not merely associated media, as potentially privacy-sensitive.

## Public Events With Private Participation

A public Event may contain private personal participation.

For example:

```text
Public Event:
Anime NYC 2026

Private Moment:
User attended with family
```

Chronologity may expose the public Event without revealing that the User attended it.

Event participation and Moment association must respect their own authorization boundaries.

## Event Participants

Chronologity should be cautious about modeling a universal participant list.

A Person appearing in an Event-associated Moment does not automatically mean Chronologity should publicly assert:

> "This person attended this Event."

Likewise, a User associating their own Moment with an Event may establish some participation context without granting Chronologity permission to expose that participation everywhere.

Participant semantics require provenance and privacy.

## Event Attendance

Attendance is a historical assertion.

It should not be inferred merely because:

- a User follows people who attended;
- a User reacted to Event-related Moments;
- a User commented on Event-related Moments;
- a device was near the location;
- a contact attended;
- AI believes the User appears in media; or
- another weak association exists.

If Chronologity eventually exposes attendance explicitly, the basis for that assertion must be clear.

## Event and Identity

People may be associated with an Event without being Chronologity Users.

This follows the broader distinction:

```text
Person ≠ User
```

Historical Events may include:

- current Users;
- people without accounts;
- deceased people;
- unidentified people;
- public figures;
- organizations; and
- other historical actors.

Event modeling must not require every participant to have an account.

## Event and Social Graph

Sharing an Event does not create a social relationship.

```text
User A attended Event X
User B attended Event X

does not imply

User A follows User B
```

Chronologity should not automatically connect people merely because their histories converge.

Event context may contribute to discovery only where privacy rules permit it and the product explicitly chooses to use it.

## Event and Comments

Comments remain attached to Moments under the initial Comment model.

Associating multiple Moments with one Event does not merge their Comment threads into an Event-wide discussion.

```text
Event
  ├── Moment A
  │     └── Comments A
  └── Moment B
        └── Comments B
```

If Event-level discussion is introduced later, it should have explicit semantics rather than emerging accidentally from Moment comments.

## Event and Reactions

Reactions to a Moment remain reactions to that Moment.

They should not automatically become reactions to the Event.

Likewise, aggregate Reaction counts across Event-associated Moments must not be treated as an Event's historical significance.

```text
Moment engagement
    ≠
Event significance
```

## Event and Causality

Events may participate in causal historical understanding, but Chronologity's existing causal model is centered on relationships between Moments.

The product should not silently infer:

```text
Same Event
    =
Causally related Moments
```

Two Moments may occur during the same Event without one causing the other.

Likewise, Moments from different Events may have strong causal relationships.

Event association provides shared context, not causality.

## Causal Events

A real-world Event may itself be consequential to later history.

For example:

```text
Event X
    ↓
Many later Moments
```

Chronologity may eventually represent causal relationships involving Events directly if the product model requires it.

The initial Event model should not force that extension prematurely.

For day one, Event significance and Moment-level causal structure can coexist without requiring Events to become causal graph nodes.

## Event and Historical Significance

Real-world Events are major contextual inputs to historical significance.

An Event may contribute to the significance of an associated Moment.

A collection of significant Moments may also contribute to Chronologity's understanding of the Event.

However:

```text
Important Event
    ≠
Every associated Moment is equally important
```

and:

```text
Many associated Moments
    ≠
Event is automatically important
```

Event significance must remain contextual and multidimensional.

## Event Convergence

Events provide natural convergence points for independent historical perspectives.

For example:

```text
User A Moment ─┐
User B Moment ─┤
User C Moment ─┼──▶ Event X
User D Moment ─┘
```

This convergence can help Chronologity understand:

- collective historical significance;
- multiple perspectives;
- corroboration;
- disagreement;
- evidentiary diversity;
- temporal structure; and
- geographic structure.

Chronologity should preserve perspective rather than collapsing all Event-associated Moments into one canonical narrative.

## No Canonical Perspective

An Event may have many legitimate perspectives.

Chronologity should not assume that one Moment, one User, one description, or one algorithmic summary represents the complete Event.

For example, the same protest may be experienced differently by:

- participants;
- organizers;
- journalists;
- police;
- bystanders;
- local residents; and
- people affected afterward.

Chronologity should preserve those distinct historical perspectives while allowing shared Event context.

## Conflicting Accounts

Event-associated Moments may conflict.

Users may disagree about:

- what occurred;
- when something happened;
- who participated;
- why it happened;
- what caused it;
- what it meant; or
- how it should be described.

Chronologity should not erase disagreement merely to create a clean Event summary.

Where the product provides synthesized context, it should distinguish established metadata from interpretation, disputed claims, and AI-generated summaries.

## Event Summaries

Chronologity may eventually provide Event summaries.

A summary is a derived representation.

It must not replace the underlying Moments or erase their provenance.

Conceptually:

```text
Many Moments
    +
Event metadata
    +
authorized context
        ↓
Derived Event summary
```

If AI generates the summary, it must remain identifiable as derived output rather than historical fact authored by participants.

Summary generation must also respect privacy.

## Event and Timeline

Events provide context within Timeline navigation.

They do not replace chronological ordering.

A User's Timeline may contain Moments associated with many Events.

Those Moments remain positioned according to their occurrence semantics.

Event grouping may visually connect them without moving them to an Event-specific artificial timestamp.

## Event Grouping

Chronologity may group Event-associated Moments when that improves comprehension.

For example:

```text
Timeline

10:00 Moment A
10:15 Moment B
10:30 Moment C

Shared context:
Event X
```

Grouping must preserve the individual occurrence semantics of each Moment.

The Event should not become a container that destroys vertical chronology.

## Event and Temporal Zoom

Events are especially important at broader temporal zoom levels.

When many Moments belong to one Event, Chronologity may represent the Event as a higher-level historical abstraction rather than displaying every associated Moment simultaneously.

Conceptually:

```text
Detailed zoom:
Moment A
Moment B
Moment C
Moment D

Broader zoom:
[Event X]
```

This is a display abstraction.

The underlying Moments remain independent historical records.

Zooming into the Event should allow Chronologity to reveal appropriate representative Moments and eventually the full authorized history.

## Event Representation at Broad Zoom

An Event shown at broad temporal zoom should not necessarily use the most popular associated Moment as its representative.

Representative selection should consider historical significance, temporal coverage, evidentiary value, personal relevance where appropriate, diversity, authorization, and redundancy.

This follows the significance model defined in `historical-significance.md`.

## Event and Historical Jumps

Historical jumps may use Events as navigation anchors.

A User might jump:

```text
Moment
  ↓
Related Event
  ↓
Earlier or later significant Moment
```

or:

```text
Event X
  ↓
Causally or temporally related Event Y
```

where such navigation is supported.

Historical jumps must never bypass privacy or authorization.

## Event Discovery

Public or otherwise discoverable Events may serve as entry points into historical exploration.

Discovery may surface Events based on:

- time;
- location;
- explicit interest;
- search relevance;
- historical significance;
- social context;
- current cultural relevance; or
- other permitted signals.

Discovery ranking must not redefine Event chronology or historical truth.

Private Event existence must not leak through discovery.

## Event Search

Users should eventually be able to search for Events they are authorized to discover.

Search may use:

- Event name;
- date;
- location;
- category;
- associated people where permitted;
- description;
- series;
- related Moments; or
- other indexed context.

Search-result relevance is distinct from historical significance and chronological ordering.

## Event Notifications

Event association may contribute to notifications in the future.

For example, a User might be notified when another authorized User associates a Moment with a shared Event.

However, Event notifications must not expose private participation or Event existence.

The initial Event model should not require high-volume Event notification fan-out.

## Event Counts

Chronologity may display derived counts such as:

- number of associated Moments;
- number of distinct contributing Users;
- number of locations;
- number of child Events; or
- other contextual measures.

Counts must respect authorization.

A User should not infer the existence of hidden Moments merely because a public count includes them.

Therefore, counts shown to a viewer should generally represent information visible or otherwise safe to reveal to that viewer.

## Event Historical Integrity

Event metadata and Event associations are historical claims.

Chronologity should preserve provenance and correction history sufficient to distinguish:

- original assertions;
- later corrections;
- automated suggestions;
- merges;
- splits;
- moderation changes; and
- derived interpretations.

This does not require every internal change to become a public Timeline item.

Historical integrity requires traceability, not indiscriminate public exposure of system mechanics.

## Event Provenance

Chronologity should preserve enough provenance to answer questions such as:

- who or what established the Event;
- when the Event record was created in Chronologity;
- what historical time the Event represents;
- who or what associated a Moment with the Event;
- whether an association was explicit or inferred;
- what metadata has been corrected;
- whether Events were merged or split; and
- which information is derived rather than asserted.

Product presentation may expose only the subset appropriate to the context.

## Event Creation Time Versus Event Occurrence Time

Chronologity must distinguish:

```text
Event occurred:
November 20, 1998

Event record created in Chronologity:
August 10, 2026
```

The Event belongs historically in 1998.

Its Chronologity record was created in 2026.

Record creation must not alter historical placement.

## Event Editing Time

Editing Event metadata today must not move the Event to today.

Likewise, associating a new Moment with an old Event must not make the Event historically recent.

```text
Product activity time
    ≠
Historical occurrence time
```

This mirrors the distinction already established for Moments and Comments.

## Event Moderation

Event records and metadata are subject to moderation.

Chronologity must be able to address:

- fabricated Events;
- abusive Event names or descriptions;
- harassment;
- false associations;
- impersonation;
- illegal content;
- sensitive private Events exposed without authorization;
- spam Event creation; and
- other misuse.

Historical integrity does not require Chronologity to preserve abusive product representations publicly.

## Event Disputes

Public history can be contested.

Chronologity should not assume that moderation alone can resolve every historical disagreement.

Some disagreements concern product abuse.

Others concern legitimate competing interpretations of history.

The product should eventually distinguish:

```text
Policy violation
```

from:

```text
Historical dispute
```

A disagreement should not be removed merely because it is inconvenient if it represents a legitimate competing historical perspective.

## Event Verification

Chronologity may eventually support verification or stronger provenance for certain Event metadata.

Potential sources might include:

- official organizers;
- institutions;
- public records;
- trusted external data;
- multiple independent contributors; or
- other provenance mechanisms.

Verification should identify the basis of confidence rather than creating a generic "truth badge."

The initial product does not require institutional Event verification.

## External Event Data

Chronologity may eventually import Event information from external sources.

Imported metadata must preserve source provenance.

External data should not silently override User-contributed historical information merely because it comes from an API or institution.

Conflicts should be handled explicitly.

## Event Scalability

A real-world Event may range from one associated Moment to millions.

The product model must therefore support:

- large numbers of associated Moments;
- large numbers of contributing Users;
- many locations;
- child Events;
- high read volume;
- incremental updates;
- derived counts;
- significance calculations;
- search indexing; and
- privacy-aware retrieval.

Creating or associating one Moment must not require synchronously rewriting every Event participant's history.

## Event Projection

Event-centric views are naturally derived representations.

Chronologity may project:

```text
Event
  ├── authorized associated Moments
  ├── representative Moments
  ├── time range
  ├── locations
  ├── derived counts
  ├── child Events
  └── significance context
```

These projections may be eventually consistent.

The authoritative historical relationships must remain distinguishable from disposable read models.

## Event Consistency

After a User explicitly associates a Moment with an Event and the operation succeeds, the authoritative relationship should exist.

Derived Event pages, counts, search indexes, temporal-zoom representations, and discovery surfaces may update asynchronously.

Chronologity should distinguish:

```text
Authoritative Event association
```

from:

```text
Eventually consistent Event representation
```

## Real-World Event Product Invariants

1.  A real-world Event represents a historical occurrence or bounded happening that may contextualize multiple Moments.
2.  A real-world Event is distinct from a Moment and from software/domain events.
3.  Moments represent experiences or perspectives; Events provide shared historical context.
4.  An Event has identity independent of any individual associated Moment.
5.  Event identity must not depend solely on Event-name text.
6.  Repeated or similarly named occurrences remain distinct Events when they represent distinct historical happenings.
7.  Event boundaries may be exact or approximate.
8.  Event time and Moment occurrence time are related but distinct.
9.  Associated Moments need not fall mechanically inside the Event's formal start/end interval when the broader Event experience legitimately includes them.
10. Events may span one or many locations.
11. Event classification does not define Event identity.
12. Private and personal Events are first-class historical concepts, not lesser versions of public Events.
13. Event hierarchy may represent meaningful Events within broader Events.
14. Event hierarchy must not create Sub-Moments or destroy flat Moment chronology.
15. Recurring Event instances are distinct historical Events.
16. Event Series, if introduced, must remain distinct from individual Event instances.
17. Temporal and geographic proximity alone must not establish Event association.
18. Event associations should preserve provenance indicating how they were established.
19. Automated or AI Event suggestions are hypotheses until appropriately established.
20. Creating the Chronologity record for an Event does not grant ownership of the real-world occurrence.
21. Public Events must not be controlled as private folders by whichever User created their record first.
22. Chronologity must support duplicate Event reconciliation without losing provenance.
23. Event splitting or correction must not rewrite Moment occurrence history.
24. Deleting an Event must not automatically delete associated Moments.
25. Public Event visibility does not make associated Moments public.
26. Event aggregation and Event-derived surfaces must preserve privacy and authorization.
27. Event existence itself may be privacy-sensitive.
28. Public Event existence must not reveal private User participation.
29. Event participation and attendance are historical assertions requiring appropriate provenance.
30. People associated with Events need not be Chronologity Users.
31. Sharing an Event does not create a social relationship.
32. Moment Comments do not automatically become Event-wide discussion.
33. Moment Reactions do not automatically become Event Reactions or Event significance.
34. Shared Event context does not imply causality between Moments.
35. Real-world Events are contextual inputs to historical significance.
36. An important Event does not make every associated Moment equally significant.
37. Raw Moment volume does not automatically make an Event historically significant.
38. Events should preserve multiple independent historical perspectives rather than collapse them into one canonical narrative.
39. Conflicting Event-associated accounts may coexist.
40. Event summaries are derived representations and must not replace underlying historical provenance.
41. Event grouping must preserve Moment occurrence ordering.
42. Events may serve as higher-level abstractions during temporal zoom.
43. Broad-zoom Event representation must not simply select the most popular associated Moment.
44. Historical jumps through Events must preserve authorization.
45. Event discovery and search must not expose private Event existence or participation.
46. Viewer-visible Event counts must not leak hidden Moments or participants.
47. Event creation time and Event occurrence time are distinct.
48. Editing or newly associating content with an Event must not change its historical occurrence time.
49. Event metadata and associations are subject to moderation without requiring legitimate historical disagreement to be erased.
50. Event-centric read models may be eventually consistent while authoritative Event relationships remain stable.
51. The Event model must scale from private Events with one Moment to public Events with potentially millions of associated Moments.

## Day-One Real-World Event Requirements

Before launch, Chronologity must have explicit product behavior for:

- Event identity;
- Event creation;
- Event names and descriptions;
- exact and approximate Event time;
- Event duration;
- Event location association;
- associating a Moment with an Event;
- removing or correcting a Moment's Event association;
- provenance of explicit versus suggested Event associations;
- automated Event suggestions, if implemented;
- Event hierarchy required by day-one navigation;
- duplicate Event handling;
- Event metadata correction;
- Event deletion semantics;
- Event visibility and privacy;
- private Event existence;
- public Events containing private Moments;
- Event representation in Timeline navigation;
- Event behavior in temporal zoom;
- Event use in historical jumps;
- Event significance context;
- authorization-aware Event counts and summaries;
- moderation of fabricated or abusive Events; and
- scalability for Events with large numbers of Moments.

Because temporal zoom and historical jumps are day-one features, Event representation cannot be postponed entirely. Chronologity needs at least enough Event semantics to represent shared historical occurrences without flattening them into unrelated Moments or converting Events into arbitrary folders.

The initial release does not require:

- a sophisticated Event Series product;
- institutional verification;
- direct Event-level comments;
- Event-level reactions;
- universal public attendance lists;
- a canonical Event narrative;
- direct Event-to-Event causal graph semantics;
- public Event-edit histories;
- complex collaborative Event governance;
- perfect automatic duplicate detection;
- fully automated Event merging;
- AI-authored authoritative Event descriptions; or
- exhaustive external Event-data integrations.

## Established Event Decisions

These were open questions. Implementation settled them, and they are requirements now rather than possibilities. Several are answers about the initial product specifically, and say nothing about whether the capability should exist later.

**Recording an Event requires a name and an occurrence.** Nothing else. Other names it goes by and the places it happened are optional.

**Every Event has a name.** It is a useful label rather than a canonical historical name, and it is never identity: two Events may carry the same name, and one Event may carry several through its aliases.

**An Event's time is one bounded interval with the precision it is actually known at** — `instant`, `day`, `month`, or `year` (ADR-100). The interval is what carries approximation, so "sometime in 1969" is that year at year precision rather than an invented timestamp. A known day with an unknown clock time is `day` precision, which is exactly what the model exists to express.

**An Event may have any number of Locations, including none.** The model does not assume one geographic point. They are unordered: ordering would describe a route, and how routes are represented is not settled.

**What the first Event implementation built is identity, names and aliases, occurrence, Locations, and creator provenance — and nothing else.** Descriptions, types, hierarchy, series, recurrence, suggestions, participants, merging, splitting, and correction were left out because the questions governing them are unanswered, not because they were decided against. Their absence records the state of the questions below; it decides none of them.

One piece of context for whoever answers the hierarchy question: `timeline-first-curation-and-discovery.md` describes `parent_of` and `child_of` as relationships between *Timelines*, while this document describes containment as a property of Events. Whether it belongs to Events, to Timelines, or to both should be settled once, across both documents, rather than separately in each.

**One Moment may belong to several Events** (ADR-102). A photograph at a wedding that is also part of a family reunion is genuinely both, and the two occurrences do not conflict. When that is redundant rather than legitimate is left to judgement rather than to a constraint.

**Whether somebody may know an Event exists is derived, not set** (ADR-143). An Event is visible to a reader exactly when they can see a Moment that was part of it — plus whoever recorded it, which is provenance granting what provenance should: you may read the record you caused to exist.

There is deliberately no visibility flag, and the reason is that there is nobody whose flag it would be. An Event belongs to nobody (ADR-100), so if two people recorded Moments at the same wedding and disagreed about whether the occasion was private, a setting would have to pick one of them. Derivation also cannot produce the failure this document warns about above — one participant's public association making a private occasion discoverable — because an Event becomes visible only through history somebody was already entitled to read.

An occurrence nobody has recorded a visible Moment for is unreachable, including by its creator's readers. That is accepted: an Event with no visible history is context for nothing.

**Duplicate Events are permitted and expected.** Nothing prevents two people recording the same occurrence separately, because identity is the identifier rather than the name and reconciliation does not exist yet. Refusing the second would refuse real history to protect a guess.

**An Event may be followed** (ADR-105). Anybody may ask to hear about Moments that become associated with it, and no approval is involved: an Event is shared history, and whoever recorded it first holds provenance rather than authority over who may watch it. Following grants no access to Moments that are not otherwise visible.

**Recording an Event confers no ownership of the occurrence.** The creator is stored as provenance only.

## Open Product Questions

The following questions require deliberate resolution:

- Does Chronologity need an explicit Event-description field on day one?
- Should Event hierarchy ship on day one?
- Should Event Series become a first-class product concept now or remain future-compatible only?
- Should automatic Event suggestions ship on day one?
- Should Event participant lists exist at all in the initial product?
- How should unnamed personal Events be represented?
- Can Event names be changed by Users other than the creator?
- What Event metadata may the original creator edit?
- Which Event metadata may other participants propose corrections to?
- Who may edit an Event description?
- Should Event descriptions support multiple competing perspectives?
- Which Event types, if any, should ship as a predefined taxonomy?
- Should Users be able to assign multiple Event categories?
- Can an Event have an unknown start or end?
- How should ongoing Events be represented?
- How should historical Events with disputed dates be represented?
- How should Event time zones be established?
- Can one Event explicitly span multiple time zones?
- What exact location semantics must an Event support before `locations.md` is finalized?
- How should route-based Events such as races, marches, and trips be represented?
- If so, how many hierarchy levels should the product support?
- Can one child Event belong to multiple parent Events?
- How should recurring Events be created efficiently without collapsing occurrence identity?
- Who may associate a Moment with an existing Event?
- Can a User associate another User's Moment with an Event, or only propose the association?
- Can an Event creator remove another User's Moment association?
- Who can dispute an Event association?
- What happens while an Event association is disputed?
- If yes, when is that historically legitimate rather than redundant?
- Should parent-Event association be derived when a Moment belongs to a child Event?
- What exact provenance should be visible for Event associations?
- Which signals may power Event suggestions?
- What confidence is required before Chronologity shows a suggestion?
- Should Users be able to disable Event suggestions?
- Can Chronologity ever automatically establish an Event association without User confirmation?
- How should Event suggestions behave for imported media with old timestamps and locations?
- Who may create public Events?
- Should private Events and public Events use the same creation workflow?
- Can an Event change from private to public or public to private?
- If Event privacy changes, what happens to associated Moments with different visibility?
- How should Event existence visibility be determined when associated Moments have mixed privacy?
- Should a public Event page expose the number of hidden/private Moments at all? The recommended default is no.
- Should Users be able to explicitly mark themselves as attending an Event?
- If attendance exists, is it historical metadata, social metadata, or both?
- Can Users hide attendance while leaving their Event-associated Moments visible?
- How should non-User participants be represented?
- What constitutes sufficient evidence that two Event records are duplicates?
- Who may confirm an Event merge?
- Can Users challenge a merge?
- What happens to URLs or identifiers for merged Events?
- How should Event splitting work?
- Which Event corrections require moderation or review?
- Should Event correction history be visible to Users?
- How should Event deletion differ from Event archival, merge, or moderation removal?
- Can a User delete a public Event merely because they created its Chronologity record? The recommended answer is no.
- How should Chronologity handle an Event whose creator deletes their account?
- What happens to private Events when their creator deletes their account?
- Should Event stewardship transfer to another participant?
- Should Event summaries ship on day one?
- If summaries exist, are they User-authored, system-generated, or both?
- How should conflicting accounts appear within Event views?
- Should Chronologity explicitly label disputed Event metadata?
- How should historical significance be represented at the Event level?
- Which significance dimensions apply directly to Events?
- How does significance flow between Events and Moments?
- At what temporal zoom level should multiple Moments collapse into an Event representation?
- Should that threshold be fixed, density-dependent, or display-dependent?
- How should Chronologity choose representative Moments for an Event at broad zoom?
- Can Users control which of their Moments represents an Event in their personal Timeline?
- Should an Event itself appear as a navigable node in Timeline depth?
- How should Event hierarchy interact with temporal zoom?
- How should Event-based historical jumps be selected?
- Should search return Events before Moments when both match?
- Should Event discovery use current popularity at all, or only relevance/significance/context?
- What Event information may appear in notifications?
- How should Event-derived counts behave when authorization differs among viewers?
- Should Event views display contributing-User counts?
- How should large Events paginate Moments while preserving chronology and perspective diversity?
- Should Event views default to chronology, representative significance, perspective grouping, or another organization?
- If an Event has millions of Moments, what does "view Event" mean at the product level?
- How should Event data portability work?
- Should Users be able to export Events they created but do not own historically?
- Which Event provenance should survive deletion or privacy changes?
- What Event information may be imported from external services?
- How should external Event identifiers be stored and reconciled?
- Should official organizer metadata receive special treatment?
- How should Chronologity represent Events whose commonly accepted historical interpretation changes over time?
- How should AI-generated Event summaries or classifications be labeled?
- What protections prevent spam Users from manufacturing fake Events or mass false associations?

These questions should be resolved before implementation choices turn Event records into simplistic folders or allow Event aggregation to bypass Chronologity's historical and privacy semantics.

## Architecture Constraints

This document does not prescribe an Event aggregate, table, graph database, API, projection, topic, or service.

It does impose architectural constraints.

The implementation must distinguish real-world Event identity from Moment identity and from software/domain events.

Event relationships must use stable identifiers rather than Event-name text as identity.

The architecture must support:

```text
Event
  ├── temporal semantics
  ├── one or more locations
  ├── associated Moments
  ├── hierarchy where required
  ├── provenance
  ├── privacy
  └── derived significance/context
```

without requiring every Event to have all possible fields populated.

Moment-to-Event associations must preserve provenance and must be independently correctable.

The architecture should assume duplicate Event records will occur and must support reconciliation without breaking associated Moment references.

Event deletion, merge, split, and correction must be distinguishable operations.

Event-centric read models should be treated as derived and rebuildable where practical.

Authorization must be enforced before Event aggregation is exposed. This includes counts, summaries, representative Moments, participant context, temporal zoom, search, discovery, and historical jumps.

The architecture must not require synchronous work proportional to every associated Moment or participant when one Event changes.

Because large Events may contain millions of Moments, retrieval and representative selection must be incremental, pageable, and projection-friendly.

The system must also preserve the distinction among:

```text
User-established Event association
system-suggested Event association
AI-inferred Event association
imported Event association
```

where those mechanisms exist.

Finally, Event semantics must remain compatible with Chronologity's flat Moment chronology. Event hierarchy and Event grouping are contextual structures, not a reason to introduce Sub-Moments or nested Timeline ordering.

## Guiding Principle

When deciding whether information belongs to a real-world Event, ask:

> **Does this describe the shared historical occurrence that gives multiple experiences common context, or does it describe one person's experience of that occurrence?**

Shared occurrence belongs to the Event.

Individual experience belongs to the Moment.

Chronologity should connect the perspectives without collapsing them into one version of history.
