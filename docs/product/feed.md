# Chronologity Feed

## Purpose

This document defines the product semantics of the **Feed** in Chronologity.

The Feed is the primary stream through which a User encounters Moments from the people and histories they are permitted to follow or otherwise receive. Chronologity is intentionally built around chronology rather than engagement optimization, so the Feed must preserve temporal ordering even when doing so conflicts with conventional social-media ranking practices.

The central question is:

> **What should appear in a User's Feed, in what order, and under what rules, if Chronologity is genuinely committed to chronology?**

This document defines product behavior and invariants rather than API design, ClickHouse schemas, GraphQL types, aggregation workers, caching strategies, or pagination implementation.

## Definition

The **Feed** is a derived chronological stream of Moments that are eligible to appear for a particular User.

Conceptually:

```text
Eligible Moments
      │
      ├── authorization
      ├── relationship eligibility
      ├── visibility
      ├── blocking
      └── other explicit Feed rules
              │
              ▼
      Chronological ordering
              │
              ▼
            Feed
```

The Feed does not determine historical truth.

It presents authorized history in chronological order.

## Feed Versus Timeline

The Feed and Timeline are related but distinct.

A **Timeline** represents history within a particular historical scope.

The **Feed** combines eligible Moments from multiple histories into a User-specific chronological stream.

Conceptually:

```text
Timeline A ─┐
Timeline B ─┼──▶ Feed
Timeline C ─┘
```

The Feed is therefore a derived view across histories.

It is not itself the authoritative history of those Moments.

## Feed Versus Discovery

The Feed is not the same as Discovery.

The Feed answers:

> **What new or relevantly available history from my established context should I see chronologically?**

Discovery answers:

> **What history outside my established context might I want to explore?**

Chronologity should not quietly inject discovery recommendations into the Feed and thereby turn it into an algorithmic recommendation surface.

If Chronologity introduces recommended content, it should appear in an explicitly differentiated product experience.

## Core Ordering Principle

The primary Feed is chronological.

```text
Earlier occurrence
        ↓
Later occurrence
```

Chronologity must not reorder ordinary Feed Moments according to:

- reactions;
- comments;
- views;
- predicted engagement;
- creator popularity;
- follower count;
- historical significance;
- advertising value;
- recommendation score;
- machine-learning relevance; or
- another hidden ranking score.

This is a foundational product invariant.

## What "Chronological" Means

Chronological ordering must be based on the Moment's **historical occurrence semantics**, not merely on when the Moment was uploaded or when Chronologity first learned about it.

For example:

```text
Moment A
Occurred: 2026-08-01
Created in Chronologity: 2026-08-10

Moment B
Occurred: 2026-08-09
Created in Chronologity: 2026-08-09
```

Moment A is historically earlier than Moment B even though Moment A was uploaded later.

Chronologity must preserve that distinction.

## Occurrence Time Versus Publication Time

Chronologity should distinguish at least:

```text
Occurrence time
Publication / creation time
```

Occurrence time determines historical placement.

Publication time determines when the Moment became available to the product and potentially eligible for delivery.

These timestamps answer different questions and must not be conflated.

## Late-Arriving History

Users may create Moments long after the underlying experience occurred.

This creates a deliberate tension:

```text
Historical order
        versus
New-content awareness
```

Chronologity should not solve that tension by pretending the old Moment occurred today.

The Moment must remain historically positioned at its actual occurrence time.

The product may separately provide a mechanism to tell followers that new historical content has been added without corrupting chronological ordering.

## Feed Direction

The canonical Feed ordering should be deterministic and explicitly defined.

For a conventional top-to-bottom Feed presentation, the default should be **reverse chronological**:

```text
Newest eligible occurrence
        ↓
Older eligible occurrence
```

This allows Users to encounter the most recent history first while preserving chronology.

Chronological integrity refers to ordering by occurrence time, not necessarily oldest-first presentation.

## Stable Tie-Breaking

Multiple Moments may share the same occurrence timestamp or have insufficient precision to establish a strict temporal order.

Chronologity therefore needs deterministic tie-breaking.

Tie-breaking must not use engagement.

Potential implementation-level tie-breakers may include stable historical or record identifiers.

The exact technical rule belongs in architecture documentation, but the product invariant is:

> Equal or ambiguous occurrence times must produce stable ordering without implying unsupported historical precision.

## Imprecise Time

A Moment may have:

- exact timestamp;
- approximate timestamp;
- date only;
- month only;
- year only; or
- another supported level of temporal precision.

The Feed must not invent an exact order between Moments when the historical data does not justify one.

For example:

```text
Moment A:
June 1998

Moment B:
June 1998
```

Chronologity may need a deterministic display order, but that order must not be interpreted as a historical claim that A occurred before B.

## Feed Eligibility

A Moment may enter a User's Feed only if the User is authorized to see it and it satisfies the Feed's explicit relationship rules.

Eligibility may depend on:

- following or subscription relationships;
- Moment visibility;
- User privacy;
- blocking;
- account status;
- moderation state;
- Event or Timeline visibility where relevant; and
- future explicit Feed controls.

Eligibility and ordering are separate concerns.

```text
First:
Can this Moment appear?

Then:
Where does it belong chronologically?
```

## Following

The primary source of Feed eligibility should be histories the User has intentionally chosen to follow or subscribe to according to Chronologity's social-graph semantics.

Chronologity should not treat every public Moment as Feed-eligible merely because it is technically visible.

Public visibility means a User may be allowed to access the Moment.

It does not necessarily mean the Moment should be pushed into every public User's Feed.

## Public Moments

A public Moment may be:

- accessible directly;
- searchable;
- discoverable;
- associated with a public Event;
- visible through a public Timeline; or
- otherwise available according to product rules

without appearing in the primary Feed of Users who have no established Feed relationship to it.

This distinction prevents the Feed from becoming an unbounded global stream.

## Private and Restricted Moments

Private or audience-restricted Moments may appear only for Users whose authorization permits access.

Feed aggregation must not weaken source privacy.

```text
Feed eligibility
    cannot exceed
Moment authorization
```

A derived Feed is not a privacy boundary of its own.

It must honor the privacy boundaries of its source history.

## Blocking

Blocking affects Feed eligibility.

If User A blocks User B according to Chronologity's blocking semantics, Moments that should no longer be visible across that relationship must disappear from the affected Feed experience.

Blocking does not rewrite history.

It changes access and presentation.

Cached or projected Feed data must not continue exposing content that current authorization forbids.

## Muting

Chronologity may support muting as a Feed-specific preference distinct from blocking.

Conceptually:

```text
Block
  → relationship / access constraint

Mute
  → presentation preference
```

A muted User's otherwise authorized Moments may remain accessible elsewhere while being omitted from the muting User's Feed.

Whether muting ships on day one should be decided explicitly.

## Feed Membership Is Derived

A Moment should not need to store a permanent list of every Feed in which it appears.

Feed membership is derived from current relationships, authorization, preferences, and product rules.

Conceptually:

```text
Moment
+
Viewer
+
Relationships
+
Authorization
+
Feed preferences
        ↓
Feed eligibility
```

This is important for scalability and privacy correctness.

## Feed Membership Can Change

A Moment that once appeared in a Feed may later become ineligible because:

- privacy changed;
- a follow relationship ended;
- a block was created;
- moderation removed the content;
- the Moment was deleted;
- account state changed; or
- another relevant rule changed.

Chronologity should treat Feed membership as current derived state rather than immutable historical fact.

## New Follow Relationships

When a User follows someone, Chronologity must decide how much existing history enters the Feed.

There are at least two distinct possibilities:

```text
Prospective:
Only Moments that become Feed-eligible after the follow

Historical:
Existing authorized Moments also become available in Feed history
```

The product should resolve this deliberately.

My recommended default is that following should grant access to the followed history through that person's Timeline immediately, while the primary Feed should avoid flooding the User with an entire historical archive as though it were newly published.

The Feed can still make older history reachable through scrolling, Timeline navigation, temporal zoom, and historical jumps according to the final pagination model.

## Unfollowing

Unfollowing should remove future Feed delivery under that relationship.

Whether already encountered Moments remain reachable depends on their independent visibility and authorization.

Unfollowing should not delete the source Moments or rewrite the fact that they existed.

## Backfilled Moments

A followed User may add a Moment from years ago.

Chronologity must preserve the Moment's historical placement.

It should not be inserted at the top of the Feed merely because it was uploaded now.

For example:

```text
Today:
User adds a Moment from 2012

Feed historical position:
2012

Not:
Today
```

This is one of the most important consequences of a genuinely chronological product.

## Awareness of Backfilled History

Strict historical placement creates a discoverability problem: followers may never notice newly added old history.

Chronologity should solve this with a separate awareness mechanism rather than corrupting the Feed.

Potential mechanisms include:

- a notification;
- a "new history added" indicator;
- an activity surface;
- a Timeline marker;
- a historical jump;
- a lightweight Feed annotation that does not reorder the Moment itself; or
- another explicitly non-historical presentation.

The exact mechanism remains an open product decision.

## Edited Moments

Editing a Moment must not move it to the top of the Feed.

```text
Edit time
    ≠
Occurrence time
```

If the Moment remains Feed-eligible, it stays in its historical position.

Chronologity may indicate that it was edited where appropriate, but editing is not a new historical occurrence.

## Comments and Feed Position

New Comments must not move a Moment within the Feed.

A Moment from last year remains in last year's historical position even if someone comments on it today.

Chronologity must reject conventional "bump on activity" behavior in the primary Feed.

## Reactions and Feed Position

Reactions must not move a Moment within the Feed.

Reaction count and Reaction velocity are engagement signals, not chronological signals.

A newly popular old Moment remains old history.

## Historical Significance and Feed Position

Historical significance must not reorder the primary Feed.

A historically significant Moment may receive:

- special contextual presentation;
- temporal-zoom prominence;
- historical-jump relevance;
- Event representation; or
- other significance-aware treatment

without moving ahead of later Moments in the chronological Feed.

```text
Significance
    ≠
Feed rank
```

## Event Significance and Feed Position

Association with a major real-world Event must not move a Moment out of chronological order.

Likewise, an Event becoming newly significant in retrospect must not cause its old Moments to jump to the top of the Feed.

Chronologity may provide separate historical resurfacing experiences.

Those experiences must be visibly distinct from chronological ordering.

## Pinned Content

Conventional social platforms often allow pinned posts.

Chronologity should be cautious with pins inside the primary Feed because pinning content above newer history breaks chronology.

If Users can pin Moments to profiles or Timelines, the pin should be treated as a separate presentation area rather than an exception to Feed ordering.

The primary Feed itself should remain chronological.

## Sponsored Content

Advertising or sponsored content inserted into the primary Feed would create a direct conflict with the Feed's historical semantics because an advertisement does not have a legitimate occurrence position within the User's followed history.

Chronologity should therefore not treat sponsored material as if it were a Moment in the chronological Feed.

If monetization later introduces advertising, it should be explicitly distinguished from historical content and should not alter the ordering semantics of Moments.

## System Messages

System notices are not Moments.

If Chronologity needs to display:

- onboarding prompts;
- safety notices;
- product announcements;
- connection suggestions;
- update banners; or
- other system UI

inside the Feed interface, they must be visually and semantically distinct from the historical stream.

They must not receive fake historical timestamps to masquerade as Moments.

## Empty Feed

A new or minimally connected User may have no Feed-eligible Moments.

Chronologity should not solve the empty-Feed problem by silently abandoning chronology and filling the Feed with arbitrary recommendations.

Instead, the product may guide the User toward:

- following people;
- exploring public Timelines;
- searching;
- discovering Events;
- importing or creating their own history; or
- another explicit discovery mechanism.

The empty state should preserve the conceptual boundary between Feed and Discovery.

## Feed Refresh

Refreshing the Feed should retrieve newly available eligible history and relevant eligibility changes.

It should not reshuffle existing Moments merely to create novelty.

Given the same eligible set and temporal data, Feed ordering should remain stable.

## Determinism

The Feed should be deterministic enough that Users do not perceive arbitrary reorderings.

If no underlying occurrence data, authorization, or eligibility rule has changed, refreshing should not produce a materially different ordering.

This is both a product-quality requirement and a trust requirement.

## Pagination

Feed pagination must preserve chronological continuity.

Users should be able to move through history without:

- duplicates;
- unexplained gaps;
- unstable reshuffling;
- repeated Moments caused by new writes; or
- missing Moments caused by naive offset pagination.

The exact cursor design belongs in architecture documentation.

The product requirement is continuity across a changing chronological dataset.

## New Moments During Pagination

New eligible Moments may arrive while a User is scrolling older history.

Chronologity should avoid suddenly shifting the User's current viewport or causing already viewed content to reorder.

Newer history may be indicated separately until the User chooses to return to the top or refresh.

## Backfilled Moments During Pagination

A newly created Moment may belong chronologically inside a range the User has already traversed.

The product should preserve historical correctness while avoiding confusing live insertion into the User's current viewport.

A later refresh or revisitation may include the newly backfilled Moment at its proper historical position.

Chronologity should not pretend that the historical dataset is immutable merely to simplify pagination.

## Deleted Moments

Deleted Moments must disappear from Feed representations according to Chronologity's deletion semantics.

Their removal may create gaps in previously cached Feed pages.

Those gaps should not be filled by reordering neighboring history incorrectly.

Derived Feed projections must eventually reflect deletion.

## Moderated Moments

Moments removed or restricted through moderation must no longer appear where the viewer is not authorized to access them.

Feed caches and projections must honor moderation changes.

Chronological ordering never overrides safety or legal requirements.

## Privacy Changes

If a Moment changes from public or shared visibility to a more restrictive state, affected Feeds must stop exposing it.

This includes:

- Feed pages;
- cached previews;
- media URLs;
- notifications linking to the Moment;
- counts where sensitive;
- offline data where technically controllable; and
- other derived representations.

Feed correctness includes current authorization, not merely historical ordering.

## Feed and Offline Use

If Chronologity supports offline Feed access, cached history may temporarily outlive server-side eligibility changes.

The product should minimize the window in which revoked content remains locally accessible and refresh authorization when connectivity returns.

Offline caching must be designed with privacy revocation in mind.

## Feed and Temporal Zoom

Temporal zoom is a Timeline capability and may also be useful when navigating large Feed history.

If Chronologity supports zooming the Feed across longer periods, zoomed representations may use historical significance, Events, temporal coverage, Location diversity, and other salience signals to summarize history.

However:

```text
Detailed Feed order
        =
chronological

Zoomed representation
        =
chronological abstraction
```

Significance may determine which representative items survive abstraction, but it must not redefine the underlying order.

## Feed and Historical Jumps

Historical jumps may allow Users to move rapidly through Feed history.

Potential destinations include:

- a particular date;
- a year;
- an Event;
- a historically significant Moment;
- a followed person's history; or
- another authorized temporal anchor.

Historical jumps are navigation.

They do not change Feed rank.

## Feed Grouping

Chronologity may visually group related Moments without changing their chronological semantics.

Possible groupings include:

- shared real-world Event;
- same day;
- same Location;
- same creator;
- another explicit historical context.

Grouping should help comprehension without creating hidden ranking.

If grouping collapses multiple Moments, the User must be able to expand the group and recover the underlying chronological history.

## Event Grouping in Feed

Many followed Users may create Moments about the same public Event.

Chronologity may eventually reduce repetitive Feed density by representing those Moments through an Event-aware group.

For example:

```text
8:00 PM  Moment A ─┐
8:03 PM  Moment B ─┼── Event X
8:05 PM  Moment C ─┘
```

A grouped representation must preserve:

- the Event's historical position;
- the individual Moments' occurrence times;
- authorization;
- perspective diversity; and
- access to the underlying Moments.

Grouping is not permission to select only the most popular perspective.

## Same-Creator Bursts

A User may create many Moments within a short period.

Chronologity may eventually group or compact such bursts for readability.

Any compaction must preserve chronology and allow the underlying Moments to be recovered.

Chronologity should not suppress Moments solely because a creator posts frequently unless the viewer has chosen a Feed preference such as muting or density reduction.

## Feed Density

Chronologity may need presentation controls for dense historical periods.

Density management is a salience problem, not a ranking problem.

Potential mechanisms include:

- temporal grouping;
- Event grouping;
- representative abstraction at broader zoom;
- expandable clusters; or
- User-controlled density.

The product should prefer explicit compression over invisible engagement-based omission.

## No Engagement-Based Deduplication

Chronologity should not decide that one of several similar Moments is the "winner" because it has more Reactions or Comments.

If redundancy reduction is needed, selection should use historical context, perspective diversity, authorization, and explicit salience rules.

Engagement should not determine which history survives presentation.

## Feed Filters

Chronologity may eventually allow Users to filter their Feed.

Potential filters include:

- people;
- date range;
- Event;
- Location;
- media type;
- Timeline;
- visibility context; or
- other historical dimensions.

Filters constrain the eligible set.

They should not change chronological ordering within the filtered result.

## Media Type Filters

If Users choose to see only images or only videos, the remaining Moments should stay chronological.

The presence of unlimited media within a Moment does not change the Moment's Feed identity.

A Moment containing both images and videos remains one Moment in Feed chronology.

## Feed and Autoplay

Video playback behavior is presentation, not ordering.

Chronologity's chosen autoplay behavior must not cause video Moments to receive preferential Feed placement over image Moments.

Media format must not become an implicit ranking signal.

## Feed and Notifications

Notifications may alert Users to activity that does not change Feed position.

For example:

- a new Comment on an old Moment;
- a Reaction;
- newly added old history;
- a new follower;
- Event association; or
- another product event.

Opening a notification may deep-link the User to the historical position of the relevant Moment rather than moving the Moment to the top of the Feed.

## Feed and Search

Search results may use relevance ranking.

That does not change Feed semantics.

```text
Search relevance
        ≠
Feed ordering
```

A User may find an old Moment first in search because it best matches a query while the same Moment remains historically positioned in the Feed.

## Feed and Discovery

Discovery may use recommendations, historical significance, interests, Events, Locations, social context, or other explicit ranking signals.

Those mechanisms should remain outside the primary Feed.

If a discovered Moment leads the User to follow a Person or Timeline, future Feed eligibility can then arise through that established relationship.

## Feed and Location

Location may constrain or filter Feed views but must not silently prioritize nearby history.

Chronologity should not assume that geographically close Moments are more Feed-relevant than chronologically adjacent Moments.

A separate location-based exploration experience may use different presentation rules.

## Feed and Historical Significance

Historical significance may support:

- zoomed Feed abstraction;
- historical jumps;
- contextual markers;
- representative Event groups; and
- optional historical exploration

without affecting ordinary Feed order.

This separation is critical to keeping Chronologity chronological while still making large histories navigable.

## Feed and Causality

Causal relationships may provide navigation from a Feed Moment to earlier or later related history.

They do not alter Feed ordering.

A consequence does not move next to its cause if another Moment occurred between them.

The Feed preserves time.

Causal navigation provides another dimension through history.

## Feed and Multiple Time Zones

Moments may occur across time zones.

Chronologity must order history according to actual occurrence semantics rather than naive local clock strings.

For example:

```text
8:00 PM in New York
5:30 PM in Los Angeles
```

cannot be ordered correctly by comparing the displayed clock values alone.

The implementation must preserve enough temporal information to establish real chronological order where it is known.

Display may still localize times for the viewer.

## Viewer Time Zone

Changing the viewer's time zone may change displayed date/time labels.

It must not change the underlying order of Moments whose actual occurrence order is known.

```text
Display localization changes
        ≠
History changes
```

## Day Boundaries

Because Users may view Moments from many time zones, day-grouping labels require explicit semantics.

A Moment's historical local date may differ from the viewer's local date.

Chronologity should preserve the occurrence context rather than silently rewriting historical days around the viewer's current location.

The exact UI treatment remains a product-design decision.

## Feed Freshness

The Feed should feel current without sacrificing chronology.

Freshness means newly eligible recent history becomes available promptly.

It does not mean older content should be artificially resurfaced as if new.

Chronologity should solve freshness through efficient delivery and awareness mechanisms, not ranking.

## Feed Completeness

Within the Feed's defined eligibility rules, Chronologity should aim for historical completeness rather than selective algorithmic omission.

A User should not wonder whether the platform secretly hid a followed Moment because it predicted low engagement.

If the product intentionally compresses or filters history, that behavior should be explicit and recoverable.

## Feed Trust

Chronologity's chronological promise is a trust contract.

Users should be able to understand why one Moment appears before another.

The answer should usually be:

> **Because it occurred later.**

Not:

> **Because an opaque system predicted you would engage with it more.**

Exceptions caused by uncertain time, grouping, privacy, or explicit User filters should be explainable.

## Feed Product Invariants

1.  The primary Feed is a derived chronological stream of eligible Moments.
2.  The Feed is distinct from a Timeline and from Discovery.
3.  Feed ordering is based on Moment occurrence semantics rather than engagement.
4.  The canonical top-to-bottom Feed should be reverse chronological unless an explicit alternate view is selected.
5.  Publication time and occurrence time are distinct.
6.  Late-created historical Moments retain their historical occurrence position.
7.  Backfilled history must not be moved to the top merely because it was newly uploaded.
8.  Chronologity may provide separate awareness mechanisms for newly added old history.
9.  Equal or imprecise occurrence times require deterministic presentation without inventing unsupported historical precision.
10. Feed eligibility and Feed ordering are separate concerns.
11. A Moment must be authorized for the viewer before it can be Feed-eligible.
12. Public visibility does not automatically make a Moment eligible for every User's Feed.
13. Feed eligibility should primarily arise from explicit social or subscription relationships and other deliberate product rules.
14. Blocking and privacy changes must remove content from affected Feed representations.
15. Muting, if supported, is a presentation preference distinct from blocking.
16. Feed membership is derived and may change over time.
17. Following must not make an entire historical archive appear as newly occurring content.
18. Unfollowing does not delete source history.
19. Editing a Moment must not change its Feed position.
20. Comments must not bump Moments.
21. Reactions must not bump Moments.
22. Historical significance must not reorder the primary Feed.
23. Event significance must not reorder the primary Feed.
24. Pinned content should not violate the primary Feed's chronological ordering.
25. Sponsored or system content must not masquerade as historically ordered Moments.
26. Empty Feed states must not silently turn the Feed into Discovery.
27. Refreshing the Feed must not arbitrarily reshuffle unchanged history.
28. Feed pagination must preserve chronological continuity.
29. New writes should not unexpectedly move the User's active viewport.
30. Backfilled writes must eventually appear at their correct historical position.
31. Deleted or moderated Moments must disappear from affected Feed representations.
32. Current authorization takes precedence over cached Feed membership.
33. Offline Feed behavior must account for privacy revocation.
34. Temporal zoom may abstract Feed history without changing its underlying chronology.
35. Historical jumps are navigation and do not alter rank.
36. Feed grouping may compress history but must preserve and recover underlying chronological Moments.
37. Event grouping must preserve multiple authorized perspectives rather than choose an engagement winner.
38. Dense posting may be explicitly compacted but not secretly engagement-ranked.
39. Redundancy reduction must not use engagement to decide which history matters.
40. Feed filters constrain eligibility while preserving chronology within the result.
41. Media type must not affect Feed rank.
42. Video autoplay behavior must not affect Feed rank.
43. Notifications may surface activity without moving Moments.
44. Search relevance does not affect Feed ordering.
45. Discovery ranking does not affect Feed ordering.
46. Location must not silently reorder the Feed.
47. Causal relationships provide navigation rather than Feed ranking.
48. Time-zone display changes must not alter known chronological order.
49. Feed freshness must be achieved without falsifying occurrence order.
50. Within explicit eligibility rules, Chronologity should prefer transparent historical completeness over opaque algorithmic omission.
51. Users should generally be able to explain Feed order from historical time rather than hidden engagement scoring.

## Day-One Feed Requirements

Before launch, Chronologity must have explicit product behavior for:

- Feed eligibility;
- relationship-based inclusion;
- authorization;
- blocking;
- reverse-chronological ordering;
- occurrence time versus publication time;
- exact and imprecise occurrence times;
- stable tie-breaking;
- late-arriving and backfilled history;
- edits;
- deletion;
- moderation;
- privacy changes;
- pagination;
- new Moments arriving while scrolling;
- backfilled Moments arriving inside previously traversed history;
- time-zone-aware ordering;
- day grouping;
- image and video coexistence;
- Event-aware Feed behavior where required;
- temporal zoom over Feed history if that experience is included at launch;
- historical jumps from Feed history;
- empty Feed behavior;
- Feed refresh;
- deterministic ordering; and
- a day-one mechanism or explicit product decision for awareness of newly added old history.

The initial release does not require:

- engagement ranking;
- machine-learning Feed ranking;
- "For You" recommendations inside the primary Feed;
- sponsored Moments;
- algorithmic bumping;
- trending insertion;
- universal Event grouping;
- sophisticated same-creator burst compression;
- advanced Feed filters;
- custom ranking preferences;
- live-location prioritization;
- popularity-based resurfacing; or
- arbitrary pinned Moments above chronological history.

## Open Product Questions

The following questions require deliberate resolution:

- Is reverse chronological the only day-one Feed direction, or should Users be able to switch to oldest-first?
- What exact Moment relationships make content Feed-eligible on day one?
- Does following a User automatically include every authorized Moment they create?
- Can Users follow Timelines or other historical scopes independently of following a User?
- If Timeline subscriptions exist, how do overlapping User and Timeline subscriptions deduplicate Moments?
- Should public Moments from non-followed Users ever enter the primary Feed? The recommended default is no.
- Should shared real-world Events ever cause Moments from non-followed Users to appear in the primary Feed? The recommended default is no unless the User explicitly follows the Event or another relevant scope.
- Should Events themselves be followable?
- If an Event is followable, do Event-associated Moments enter the same primary Feed or a separate Event stream?
- Does muting ship on day one?
- Can Users mute a Person, Event, Timeline, or Location independently?
- Should Feed preferences be global or per followed relationship?
- When a User follows someone, how much of that person's existing history should be scrollable through the Feed?
- Should the Feed have a fixed historical boundary based on follow time?
- If not, how do we avoid making a new follow feel like millions of old Moments were just delivered?
- Should older authorized history be reachable only through the followed person's Timeline rather than the Feed?
- What is the exact product distinction between Feed history and Timeline history after a new follow?
- How should newly added old history be surfaced?
- Should Chronologity send a notification such as "Richard added a Moment from 2008"?
- Should there be a "new history added" section separate from the Feed?
- Could a small non-Moment annotation appear at the current Feed position without violating chronology?
- Should Users be able to disable notifications about backfilled history?
- How should bulk imports behave?
- If a User imports 10,000 historical Moments, should followers receive any awareness notification?
- Should bulk-import awareness be summarized rather than emitted per Moment?
- What timestamp precision levels are supported on day one?
- How should Moments with only a year be interleaved with Moments having exact dates inside that year?
- Should imprecise Moments appear in a dedicated temporal band rather than receive arbitrary point placement?
- What stable tie-breaker should the implementation use for equal timestamps?
- Should tie-breaker behavior ever be visible to Users?
- How should historical local time zones be represented when creating old Moments?
- What happens when the User knows local clock time but not the historical time zone?
- Should Feed day headers use the Moment's local occurrence date or the viewer's current time zone?
- How should travel across the International Date Line appear?
- Should edits display an "edited" indicator?
- Should substantial edits generate notifications without changing Feed position?
- If occurrence time is corrected, should the Moment move to its corrected Feed position? The recommended answer is yes.
- How should the UI communicate that a previously seen Moment moved because its historical timestamp was corrected?
- If a Moment's privacy changes from private to public years later, does it appear only at its historical position?
- Should followers receive awareness that previously private history became available?
- If a block is removed, should old Moments become reachable again in Feed history?
- Does the Feed support explicit date jumps on day one?
- Should temporal zoom be directly available from the Feed or only from dedicated Timeline views?
- If Feed temporal zoom exists, what historical scope does significance use when selecting representatives?
- Should Feed zoom prioritize personal relevance from followed relationships while still preserving historical significance?
- How should Event groups be positioned when their Moments span a long time range?
- When should Event-associated Moments collapse into a group?
- Can Users disable Event grouping?
- Should Event groups show only Moments from followed Users or all authorized Event Moments?
- The recommended default for the primary Feed is followed/explicitly subscribed sources only; should Event exploration expose the broader set separately?
- How should same-creator bursts be displayed?
- Should the product ever automatically collapse many Moments from one User?
- If it does, what guarantees that every Moment remains recoverable?
- How should a Moment with unlimited media be previewed without making media quantity affect Feed prominence?
- How many images or videos from a Moment should appear in its collapsed Feed card before the User opens it?
- Should video autoplay with sound apply identically in Feed and Timeline views?
- How should multiple simultaneously visible videos behave?
- Should autoplay pause when the User opens temporal zoom or another overlay?
- What is the exact empty-Feed experience?
- Should onboarding explicitly encourage following before showing Discovery?
- Should Discovery content appear beneath an empty-state boundary rather than inside the Feed itself?
- Should system notices ever be inserted between Moments?
- If yes, how should they be visually separated so they cannot be mistaken for history?
- Should Chronologity ever support advertising in the Feed?
- If so, can it be done without compromising the product's chronological identity?
- What pagination behavior should Users experience when new Moments arrive?
- Should a "new Moments" indicator appear rather than automatically inserting them?
- How should pagination handle corrected occurrence times?
- How should it handle Moments deleted between page loads?
- How should it handle newly backfilled history inside an already traversed cursor range?
- What level of Feed completeness can the product promise under eventual consistency?
- Should Feed projections expose a "last updated" state if aggregation is delayed?
- What latency is acceptable between Moment creation and Feed availability?
- How quickly must privacy revocation propagate?
- How quickly must blocks propagate?
- How should offline Feed caches expire?
- Can Users explicitly download Feed history for offline access?
- How are revoked Moments removed from offline caches?
- Which Feed filters, if any, are necessary on day one?
- Should Users be able to filter to one Person without leaving the Feed, or should that always navigate to that Person's Timeline?
- Should media-type filters exist?
- Should Location filters exist?
- Should Event filters exist?
- Should Feed state remember the User's last historical position across sessions?
- If the User returns after a week, should Chronologity return them to where they stopped or to the newest history?
- Should the product mark a boundary such as "You're caught up"?
- What exactly does "caught up" mean when backfilled history can appear anywhere in the past?
- Should "caught up" refer only to newly published eligible Moments since the last Feed visit?
- Do read/unread semantics belong in the Feed at all?
- If so, are they based on publication awareness rather than historical occurrence?
- Should a User be able to hide a Moment from their own Feed without affecting access elsewhere?
- Is "hide from Feed" distinct from mute?
- Should hidden Feed preferences sync across devices?
- Should historical significance ever produce a visual marker in the detailed Feed?
- If so, how do we avoid creating an implicit ranking hierarchy?
- Should causal relationships be visible directly from Feed cards?
- Should Feed cards expose Event and Location context by default?
- How much context is appropriate before the Feed becomes visually overloaded?
- How should accessibility work for grouped or zoomed Feed representations?
- How should keyboard and screen-reader navigation preserve chronological semantics?
- What analytics may Chronologity collect about Feed use without turning those metrics into ranking signals?
- Should the product make an explicit public promise that the primary Feed is not engagement-ranked?

These questions should be resolved before Feed implementation hardens conventional social-network assumptions that conflict with Chronologity's core chronological identity.

## Architecture Constraints

This document does not prescribe a Feed service, GraphQL schema, ClickHouse table, Kafka topology, cursor format, cache, or aggregation worker.

It does impose architectural constraints.

The Feed must be derived from authoritative Moment, relationship, authorization, moderation, and preference state.

The architecture must preserve the distinction:

```text
Moment occurrence time
        ≠
Moment publication time
        ≠
Feed projection time
```

Feed storage and query paths must order by historical occurrence semantics, with deterministic treatment of ties and imprecision.

The system must not require engagement scores to construct the primary Feed.

Reaction, Comment, view, popularity, and historical-significance projections should remain architecturally separable from detailed Feed ordering.

The architecture must support backfilled Moments whose occurrence time is arbitrarily older than their ingestion time.

This means a simple append-only "new posts at the top" projection is insufficient as the sole Feed model.

Pagination must remain stable under:

- newly created recent Moments;
- newly created old Moments;
- deletions;
- privacy changes;
- blocks;
- corrected occurrence times; and
- other eligibility changes.

Feed projections may be eventually consistent, but authorization must be revalidated where necessary so stale projections do not become a security boundary.

The Feed architecture must not materialize unbounded per-Moment recipient lists if doing so prevents Chronologity from scaling large social graphs or privacy changes.

The implementation should support efficient fan-out or read-time aggregation according to scale without changing product semantics.

If Feed grouping or temporal zoom uses significance or Event projections, those are secondary presentation inputs.

They must not become the authoritative ordering key.

Finally, the Feed architecture must support the product promise that, absent explicit filtering or abstraction, Users can traverse eligible history chronologically without opaque engagement-based omission.

## Guiding Principle

When deciding whether the Feed should move, promote, suppress, or insert a Moment, ask:

> **Did the history change, did the User's authorization or explicit Feed preference change, or are we merely trying to make the stream more engaging?**

If the answer is only engagement, the primary Feed should not change.

Chronologity's Feed should make chronology useful---not compromise chronology to imitate conventional social media.
