# Chronologity Discovery

## Purpose

This document defines the product semantics of **Discovery** in Chronologity.

Discovery helps Users encounter public or otherwise discoverable history outside the people, Timelines, Events, and other historical contexts they already follow. It is where Chronologity may deliberately use relevance, historical significance, interests, Events, Locations, social context, and other signals without compromising the chronological semantics of the primary Feed.

The central question is:

> **How should Chronologity help Users find history they did not already know to look for without turning historical significance into popularity, violating privacy, or allowing recommendation algorithms to redefine the product?**

This document defines product behavior and invariants rather than recommendation models, machine-learning architecture, search indexes, embedding systems, analytics pipelines, or API contracts.

## Definition

**Discovery** is the set of product experiences that introduce a User to authorized history outside their established Feed relationships or explicit search query.

Conceptually:

```text
Discoverable history
        │
        ├── authorization
        ├── privacy
        ├── safety
        ├── historical context
        ├── relevance
        ├── significance
        ├── diversity
        └── User interests / intent
                │
                ▼
            Discovery
```

Discovery is exploratory.

It is not authoritative history, and its ordering does not determine historical importance.

## Discovery Versus Feed

Discovery and the primary Feed must remain distinct.

The Feed answers:

> **What eligible history from my established context should I encounter chronologically?**

Discovery answers:

> **What other history might be worth exploring?**

The Feed preserves chronological ordering.

Discovery may rank or organize candidates according to explicit discovery objectives.

```text
Feed
  → chronology

Discovery
  → exploration
```

Chronologity should not silently merge the two.

## Discovery Versus Search

Discovery is also distinct from Search.

Search begins with explicit User intent expressed through a query or structured filter.

Discovery can begin without a query.

```text
Search:
"I am looking for X."

Discovery:
"Show me history I may want to explore."
```

Search relevance and Discovery relevance may use overlapping signals, but they solve different product problems.

## Discovery Is Not Historical Truth

A Moment or Event appearing prominently in Discovery does not mean Chronologity has declared it more historically important than content shown elsewhere.

Discovery ordering reflects a product decision about what may be useful to surface to a particular User in a particular context.

Therefore:

```text
Discovery rank
        ≠
Historical significance
        ≠
Popularity
        ≠
Historical truth
```

These concepts must remain separate.

## Discovery Candidates

Potential Discovery candidates may include authorized:

- Moments;
- real-world Events;
- Timelines;
- People or Users where appropriate;
- Locations;
- historical periods or collections;
- causal paths;
- other future historical scopes; or
- contextual groupings derived from Chronologity history.

Not every candidate type must ship on day one.

The product should nevertheless avoid designing Discovery as though it can only ever recommend individual Moments.

## Discoverability

Visibility and discoverability are different concepts.

A resource may be accessible to a User without being eligible for broad Discovery.

For example:

```text
Accessible by direct link
        ≠
Eligible for recommendation
```

Chronologity should support the possibility that Users can allow content to be viewed when reached intentionally while excluding it from recommendation surfaces.

This distinction is particularly important for personal history.

## Public Does Not Necessarily Mean Discoverable

A public Moment should not automatically become eligible for every Discovery surface.

Chronologity may eventually support privacy or publication controls that distinguish:

```text
Public and discoverable

Public but unlisted / non-discoverable

Restricted
```

The exact user-facing terminology requires deliberate design.

The underlying product model should not equate public accessibility with recommendation consent.

## Discovery Authorization

Authorization is evaluated before recommendation.

```text
Candidate
   │
   ▼
Can this User access it?
   │
   ├── No → exclude
   │
   └── Yes
         │
         ▼
Is it eligible for this Discovery surface?
```

A recommendation system must never use its ability to infer the existence of content as permission to expose that content.

## Privacy and Derived Signals

Discovery can leak private information even when the underlying Moment is not directly shown.

For example, the following recommendation may itself reveal sensitive history:

> "Explore Moments from a private Event your friend attended."

Chronologity must therefore apply privacy not only to candidate content but also to:

- recommendation explanations;
- Event associations;
- Location associations;
- participant relationships;
- counts;
- inferred interests;
- historical significance;
- causal relationships; and
- other derived context.

## Discovery Surfaces

Chronologity may eventually provide several explicit Discovery surfaces.

Examples include:

- Explore;
- Events;
- Places;
- People;
- historical periods;
- nearby history;
- significant history;
- related history;
- causal exploration;
- thematic collections; or
- contextual recommendations attached to a Moment, Event, or Location.

The initial product does not need all of these.

Each surface should have a clear discovery objective rather than sharing one opaque universal ranking.

## Explore

An **Explore** experience may provide broad discovery across authorized public history.

It should not simply be a clone of conventional engagement-ranked social-media Explore pages.

A Chronologity Explore surface should emphasize historically meaningful exploration, potentially including:

- significant Events;
- interesting Locations;
- diverse perspectives;
- history related to explicit User interests;
- historical anniversaries;
- causal connections;
- underrepresented perspectives;
- newly available public history; and
- other contextually useful material.

Engagement may describe how Users interact with the surface, but it should not become the sole definition of what deserves exposure.

## Event Discovery

Real-world Events are natural Discovery entry points.

Users may discover Events based on:

- time;
- Location;
- historical significance;
- explicit interests;
- people or Timelines they follow;
- related Events;
- search or browsing context;
- cultural relevance;
- current occurrence where appropriate; or
- other authorized signals.

An Event's raw number of Moments, Reactions, Comments, or views must not automatically define its historical importance.

## Location Discovery

Locations may serve as Discovery scopes.

Potential experiences include:

```text
History near this place
History of this venue
Events in this city
Moments along this trail
```

Location Discovery must not become live User tracking.

The product should recommend historical content associated with places, not expose where Users currently are unless Chronologity later introduces an explicit real-time capability with separate privacy semantics.

## "Near Me" Discovery

If Chronologity offers "history near me," the User's current location may be used as a query context.

That does not mean the current location should be stored as historical content or disclosed to other Users.

Conceptually:

```text
Current location
     │
     └── query input
             │
             ▼
     Nearby authorized history
```

not:

```text
Current location
     ↓
Public User presence
```

Users should be able to use historical Location Discovery without enabling persistent live-location sharing.

## People Discovery

Chronologity may help Users discover People or Users whose public history they may want to explore or follow.

Potential signals include:

- explicit interests;
- shared public Events;
- public historical subjects;
- mutual social context;
- Location or community context;
- public Timelines;
- User-selected profile information; or
- other permitted signals.

Chronologity should avoid turning People Discovery into covert inference about sensitive personal attributes.

Shared Event participation should not automatically expose private attendance.

## Timeline Discovery

Public or otherwise discoverable Timelines may be surfaced as coherent historical scopes.

This may be preferable to recommending isolated Moments when the broader history provides necessary context.

For example:

```text
Instead of:
One isolated Moment from a trip

Discovery may surface:
A public Timeline representing the trip
```

where the Timeline semantics make that history more understandable.

Discovery should preserve the distinction between User-created historical scope and algorithmic recommendation.

## Moment Discovery

Individual Moments may be discoverable when they are independently meaningful entry points into history.

A Moment recommendation should preserve enough context to avoid presenting historical media as decontextualized engagement bait.

Relevant context may include:

- occurrence time;
- creator or historical subject where authorized;
- Event;
- Location;
- Timeline;
- causal context; or
- why the Moment is being surfaced.

The exact amount of context depends on the interface.

## Related History

Chronologity may recommend history related to what a User is currently viewing.

For example:

```text
Current Moment
     │
     ├── same Event
     ├── same Location
     ├── causal predecessor
     ├── causal consequence
     ├── same historical period
     └── related Timeline
```

Related-history recommendations should prioritize meaningful historical relationships over generic engagement similarity.

## Causal Discovery

Causality gives Chronologity a distinctive form of Discovery.

A User viewing one Moment may discover:

- what led to it;
- what followed from it;
- parallel causal branches;
- historically consequential predecessors; or
- later consequences.

Causal Discovery must preserve the difference between established causal relationships and suggestions or hypotheses.

An AI-generated causal recommendation must not be presented as historical fact.

## Temporal Discovery

Time itself may be a Discovery dimension.

Potential experiences include:

- On this date;
- this year in history;
- a decade;
- an anniversary;
- earlier history from followed contexts;
- significant history from a selected period; or
- historical jumps to distant periods.

Chronologity should avoid resurfacing old content as though it occurred today.

An anniversary surface may say:

```text
20 years ago today
```

rather than inserting the Moment into today's chronological Feed.

## Anniversary Discovery

Anniversaries are a natural way to resurface history without corrupting chronology.

Potential candidates may include:

- personal milestones;
- Events;
- historically significant Moments;
- public history;
- Location-specific history; or
- User-selected important Moments.

Anniversary Discovery should respect privacy and should not assume every old Moment is appropriate to resurface.

Users may need controls over sensitive anniversaries.

## Historical Significance in Discovery

Historical significance may be an important Discovery signal.

However, significance is contextual and multidimensional.

Discovery should not reduce it to:

```text
Universal significance score
        ↓
Global ranking
```

Instead, a Discovery surface may use significance appropriate to its historical scope.

For example:

```text
History of Location X
        ↓
Location-contextual significance
```

or:

```text
Related to Event Y
        ↓
Event-contextual significance
```

The significance model informs Discovery without becoming the sole objective.

## Personal Significance in Discovery

Personal significance requires particular care.

A User marking a Moment personally important does not automatically consent to broader recommendation.

Personal significance may improve representation within that User's own history without making the Moment globally discoverable.

```text
Personally important
        ≠
Publicly recommendable
```

Discovery must honor both significance scope and visibility.

## Collective Significance in Discovery

Collective convergence may help identify history worth exploring.

For example, many independent perspectives on one Event may make that Event a useful Discovery entry point.

However, raw volume is vulnerable to popularity bias and manipulation.

Chronologity should distinguish independent historical convergence from:

- duplicates;
- repost-like behavior;
- coordinated campaigns;
- spam;
- bot activity; and
- derivative content.

## Evidentiary Significance in Discovery

Evidentially valuable Moments may deserve prominence within an Event or historical context even if they have little engagement.

This is especially useful when Discovery aims to help Users understand history rather than maximize time spent.

Evidentiary significance does not establish truth.

Chronologity must preserve provenance and uncertainty.

## Retrospective Significance in Discovery

Later history may make older Moments newly relevant.

Discovery is an appropriate place to surface that changing historical interpretation.

For example:

```text
Earlier Moment
      │
      └── later history makes it consequential
```

Chronologity may recommend the earlier Moment with context explaining why it matters now.

It should not move the Moment to the top of the chronological Feed.

## Engagement as a Discovery Signal

Unlike the primary Feed, Discovery does not need to prohibit all use of engagement signals.

However, engagement should be treated as a limited contextual signal rather than the definition of relevance or importance.

For example, engagement might help identify:

- whether Users find a recommendation useful;
- whether a candidate is generating active discussion;
- whether a Discovery experience is functioning; or
- whether content quality problems exist.

Chronologity should resist optimization loops in which engagement becomes the dominant ranking objective.

## Why Engagement Cannot Dominate Discovery

If Discovery optimizes primarily for clicks, watch time, reactions, or comments, it will predictably favor:

- sensationalism;
- controversy;
- celebrity;
- outrage;
- novelty;
- already-popular creators;
- repeated consumption; and
- content engineered for recommendation systems.

That would undermine Chronologity's historical purpose even if the primary Feed remained chronological.

The product should optimize Discovery for useful historical exploration, not merely attention extraction.

## Popularity and Discovery

Popularity can sometimes be relevant.

A culturally prominent Event may be worth surfacing because it affected many people.

But:

```text
Popular
    ≠
Historically significant

Popular
    ≠
Personally relevant

Popular
    ≠
Best Discovery result
```

Chronologity should not build a global "most popular history" engine and call it Discovery.

## Trending

Chronologity should be cautious with conventional "Trending" surfaces.

Trending usually measures rapid attention, which is inherently different from historical significance.

If Chronologity introduces trending content, it should be labeled according to what it actually measures.

For example:

```text
Receiving attention now
```

must not be presented as:

```text
Most important history
```

A trending surface is not required for the initial product.

## Current Events

Chronologity may contain Moments associated with Events occurring now.

Discovery may surface current Events.

However, Chronologity should preserve the same historical semantics:

- Moments remain ordered by occurrence;
- Event associations retain provenance;
- popularity does not become historical significance;
- live Location is not inferred casually; and
- recommendation does not override privacy.

Chronologity can represent history as it happens without becoming a conventional breaking-news ranking platform.

## Diversity

Discovery should avoid collapsing historical exploration around only the most prominent creators, places, cultures, or Events.

Diversity can mean several things depending on context:

- different people;
- different Locations;
- different time periods;
- different Events;
- different perspectives;
- different causal branches;
- different media forms;
- different levels of historical significance; or
- different communities.

Diversity should improve historical breadth rather than operate as an unexplained randomization mechanism.

## Perspective Diversity

Real-world Events may contain many perspectives.

Discovery should avoid selecting only the perspective with the highest engagement.

For example:

```text
Event X
  ├── participant perspective
  ├── organizer perspective
  ├── observer perspective
  └── later consequence
```

A useful Discovery experience may deliberately expose several perspectives.

This aligns with Chronologity's refusal to collapse history into one canonical narrative.

## Temporal Diversity

Discovery should not overconcentrate on recent history merely because recent content generates more engagement.

Chronologity's archive becomes more valuable as history accumulates.

Discovery should be capable of reaching:

- yesterday;
- last year;
- decades ago; and
- older imported history

when that history is relevant to the User's exploration.

## Geographic Diversity

Location-aware Discovery should avoid allowing major cities or highly active Locations to consume all exposure.

Depending on context, Chronologity may deliberately broaden geographic representation.

Geographic diversity is especially important for historical exploration because content volume will vary dramatically by place.

## Creator Diversity

Discovery systems often create winner-take-most exposure.

Chronologity should avoid making follower count or past recommendation success a self-reinforcing prerequisite for future discovery.

Creator identity may matter to context, but the historical value of a Moment should not be reduced to creator popularity.

## Novelty

Discovery may consider whether the User has already seen or repeatedly encountered a candidate.

Novelty is a presentation signal.

It is not historical significance.

A highly significant Event may remain worth revisiting even when it is not novel.

The product should balance useful resurfacing with repetitive recommendation.

## Serendipity

Discovery should allow some controlled serendipity.

A User exploring one historical subject may benefit from encountering an unexpected but meaningful connection.

Causal relationships, shared Locations, temporal overlap, and Event relationships provide historically grounded ways to create serendipity.

Chronologity should prefer meaningful historical adjacency over arbitrary recommendation randomness.

## Recommendation Explanations

Where practical, Discovery should be able to explain why something was surfaced.

Examples include:

- "Related to an Event you follow."
- "From a Location you've been exploring."
- "A causal predecessor to this Moment."
- "Another perspective on this Event."
- "Twenty years ago today."
- "Part of a public Timeline you viewed."

Explanations improve trust and help keep recommendation logic tied to understandable historical context.

Chronologity should avoid explanations that expose sensitive inferred information.

## User Control

Users should have meaningful control over Discovery.

Potential controls may include:

- not interested;
- show less like this;
- hide this Event;
- hide this Person;
- hide this Location;
- hide this topic;
- do not recommend this Moment;
- disable certain Discovery categories; or
- reset Discovery preferences.

The exact controls depend on the recommendation system.

The product should not require Users to accept opaque personalization indefinitely.

## Explicit Interests

Chronologity may allow Users to express interests directly.

Explicit interests are preferable to relying exclusively on behavioral inference because they give Users understandable control.

Interests might include:

- historical subjects;
- entertainment;
- sports;
- places;
- Events;
- time periods;
- people;
- cultural topics; or
- other categories.

Interest design must avoid forcing sensitive identity disclosure.

## Behavioral Personalization

Chronologity may infer interests from product behavior such as:

- Events viewed;
- Locations explored;
- searches;
- followed Timelines;
- followed Users;
- Moments opened;
- causal paths explored; or
- Discovery feedback.

Behavioral personalization should be bounded by privacy expectations.

The product should not infer or expose sensitive personal attributes merely because a recommendation model can statistically predict them.

## Sensitive Inferences

Chronologity should avoid using inferred sensitive characteristics as ordinary Discovery targeting signals.

Historical activity can reveal information about:

- health;
- religion;
- political activity;
- sexuality;
- family circumstances;
- precise Location patterns; and
- other sensitive areas.

A history platform must be especially careful because its underlying data can be deeply personal.

Discovery should use contextual relevance without constructing unnecessary sensitive profiles.

## Social Context

Social relationships may inform Discovery.

For example:

```text
Several people you follow contributed public Moments to Event X
```

may make Event X relevant.

But social context must not expose private relationships, private participation, or restricted Moments.

Chronologity should not use social proof as a privacy side channel.

## Social Proof

Counts such as:

```text
3 people you follow viewed this
5 friends attended
20 people you follow reacted
```

can create privacy and behavioral-surveillance concerns.

Chronologity should not assume these are desirable merely because conventional social platforms use them.

Any social proof should have explicit product value, appropriate consent, and privacy semantics.

The initial product does not require social-proof counters.

## Discovery and Blocking

Blocked relationships must affect Discovery.

Chronologity should not recommend:

- a blocked User;
- restricted content from a blocked User;
- a private Event association that reveals the blocked User;
- or another surface that defeats the block's intended effect.

Blocking should propagate through derived recommendation systems.

## Discovery and Muting

If muting exists, Discovery semantics should define whether mute affects only the Feed or broader recommendation.

A useful distinction may be:

```text
Mute from Feed
```

versus:

```text
Do not recommend
```

The product should avoid assuming one control means both unless clearly communicated.

## Discovery and Moderation

Moderation eligibility precedes recommendation.

Content restricted from a Discovery surface should not be recommended merely because it remains accessible in another context.

Chronologity may apply stricter standards to broad algorithmic amplification than to direct access.

This distinction can reduce the harm caused by recommending borderline or sensitive material to Users who did not seek it.

## Amplification Is a Product Choice

Making content public and algorithmically amplifying it are not equivalent.

Chronologity should recognize recommendation as an amplification decision.

Therefore, content may be:

```text
Allowed to exist
Allowed to be accessed
Not eligible for broad recommendation
```

without contradiction.

This is an important moderation and safety boundary.

## Sensitive Historical Content

Historically important material may be disturbing, graphic, traumatic, or otherwise sensitive.

Historical significance does not create an obligation to recommend it broadly.

Discovery should consider:

- User intent;
- content warnings;
- age appropriateness;
- moderation policy;
- context;
- historical value; and
- potential harm.

A User explicitly researching an Event may receive different results from someone casually browsing Explore.

## Discovery and Minors

Discovery involving minors requires heightened privacy and safety considerations.

Chronologity should avoid broad recommendation of sensitive personal history involving children merely because the underlying Moment is technically visible.

Detailed age and safety policy belongs in moderation and privacy specifications.

The Discovery model must support stricter eligibility rules.

## Discovery and Private Events

Private Events must not appear in Discovery for unauthorized Users.

Even aggregate or indirect references to them may leak sensitive information.

For example:

```text
"Popular private Events near you"
```

would itself be an unacceptable disclosure.

Private Event existence must be treated as protected data.

## Discovery and Location Privacy

Location-based recommendations must respect viewer-appropriate Location precision.

A Moment whose public Location is city-level must not be recommended through a precise map marker derived from hidden GPS coordinates.

The Discovery system must consume privacy-safe geographic representations rather than bypassing them.

## Discovery and Temporal Zoom

Discovery may lead into a Timeline, Event, Location, or other historical scope that supports temporal zoom.

The Discovery card itself does not need to reproduce the full temporal-zoom experience.

However, broad historical recommendations may benefit from representing an Event or Timeline instead of one isolated Moment when that abstraction better communicates the history.

## Discovery and Historical Jumps

Discovery can act as an entry point for historical jumps.

For example:

```text
Discovered Event
      ↓
Jump to 1998
      ↓
Explore surrounding history
```

or:

```text
Discovered Moment
      ↓
Causal predecessor
      ↓
Earlier historical period
```

Once the User enters a historical scope, navigation should follow the semantics of that scope rather than Discovery ranking.

## Discovery and Notifications

Chronologity should be cautious about sending unsolicited notifications based purely on recommendation.

A notification is more intrusive than an Explore card.

Potential notification-worthy discovery may include:

- an explicitly followed Event becoming active;
- an anniversary the User opted into;
- new public history strongly related to an explicitly followed scope; or
- another high-intent relationship.

Generic "you might like this" notifications are not required for the initial product.

## Discovery and New History

Newly published history may be a Discovery signal without being treated as newly occurring history.

For example:

```text
Newly added:
Photographs from 1974

Discovery label:
Newly added historical material

Historical placement:
1974
```

This allows Chronologity to surface newly available archives honestly.

## Discovery and Imports

Bulk-imported historical archives can create valuable Discovery opportunities.

Chronologity should not flood Discovery merely because thousands of Moments arrived simultaneously.

Publication volume is not historical significance.

The system may instead surface:

- the Timeline;
- the archive;
- a representative Event;
- a historically significant subset; or
- another coherent entry point.

## Discovery and Unlimited Moment Media

A Moment may contain unlimited images and videos.

Media quantity must not automatically increase Discovery rank.

Otherwise, Users could gain recommendation advantage merely by attaching more media.

Discovery should evaluate the Moment as a historical unit.

## Discovery and Media Format

Image and video Moments should be eligible according to historical and contextual relevance rather than a platform preference for whichever media format maximizes engagement.

Autoplay behavior must not become a hidden ranking advantage for video.

## Recommendation Feedback

Chronologity should distinguish explicit recommendation feedback from ordinary social engagement.

For example:

```text
Not interested
Show me more history like this
Hide this topic
```

are Discovery-control signals.

They are not Reactions to the Moment.

This distinction prevents recommendation mechanics from contaminating the historical or social meaning of Reactions.

## Negative Feedback

A User saying "not interested" should normally affect that User's recommendation experience.

It should not reduce the Moment's historical significance or visibility for everyone else.

```text
Personal recommendation feedback
        ≠
Global historical judgment
```

## Discovery Metrics

Chronologity may measure Discovery performance.

Useful metrics may include:

- recommendation opens;
- follows resulting from Discovery;
- Event exploration;
- Timeline exploration;
- historical depth traversed;
- explicit positive or negative feedback;
- repeat exploration;
- diversity of history explored; and
- other product-health measures.

The product should be cautious about selecting one attention metric such as watch time as the universal optimization target.

## Success Criteria

A successful Discovery system should help Users:

- find history they care about;
- understand context;
- encounter perspectives they would not otherwise see;
- explore Events and Locations;
- move deeper into Timelines;
- discover causal relationships;
- find people worth following;
- uncover older history; and
- maintain trust in why content is being surfaced.

The goal is not simply to maximize minutes consumed.

## Cold Start

A new User may have little behavioral history.

Chronologity should support Discovery without requiring invasive inference.

Cold-start signals may include:

- explicitly selected interests;
- chosen Locations;
- followed Users;
- followed Timelines or Events if supported;
- imported contacts where explicitly permitted;
- broad public history;
- temporal or geographic exploration; or
- intentionally diverse recommendations.

The product should not require extensive surveillance before it becomes useful.

## Non-Personalized Discovery

Chronologity should support meaningful Discovery even with little or no personalization.

Potential non-personalized surfaces include:

- historically significant public Events;
- history by date;
- history by Location;
- curated collections;
- newly available archives;
- broad categories; or
- editorially selected historical themes.

Non-personalized does not mean engagement-ranked.

## Editorial Discovery

Chronologity may eventually support human-curated historical collections.

Editorial curation should be clearly distinguishable from algorithmic recommendation and from authoritative historical significance.

For example:

```text
Curated by Chronologity
```

or:

```text
Curated by Institution X
```

preserves provenance of the selection.

## Institutional Discovery

Museums, archives, historians, cultural institutions, or other trusted organizations may eventually create public historical collections.

Chronologity should preserve who curated or supplied the collection.

Institutional authority does not automatically make every interpretation uncontested historical truth.

## Discovery Explainability

Discovery systems should preserve enough provenance to answer:

- which surface produced the recommendation;
- which major signals contributed;
- whether the recommendation was personalized;
- whether historical significance was used;
- whether social context was used;
- whether Location was used;
- whether AI contributed; and
- what User controls can affect similar recommendations.

This does not require exposing proprietary model internals.

It does require avoiding a system that cannot meaningfully explain its own behavior.

## AI in Discovery

AI may eventually assist with:

- semantic similarity;
- historical-topic understanding;
- Event clustering;
- Location recognition;
- causal suggestions;
- representative selection;
- diversity;
- summarization;
- recommendation explanations; or
- interest matching.

AI output must remain subject to authorization, privacy, moderation, and historical-provenance rules.

AI recommendation does not establish historical fact.

## Recommendation Versioning

Material recommendation logic should be versioned or otherwise traceable internally.

Chronologity should be able to distinguish:

```text
History changed
```

from:

```text
Discovery algorithm changed
```

This matters for debugging, experimentation, trust, and auditability.

## Experimentation

Chronologity may experiment with Discovery ranking.

Experiments must not change authoritative historical data.

They also must not quietly change the chronological Feed.

Discovery experimentation should remain bounded to explicit recommendation surfaces.

## Manipulation Resistance

Any recommendation system creates incentives to game it.

Chronologity should anticipate:

- fake engagement;
- duplicate Moments;
- misleading Event associations;
- false Locations;
- keyword stuffing;
- coordinated activity;
- bot accounts;
- mass following;
- manipulated media;
- artificial significance claims; and
- other attempts to gain exposure.

Discovery should not make one easily manipulated signal overwhelmingly valuable.

## No Pay-to-Rank History

Chronologity should not allow Users to purchase higher historical significance.

If paid promotion is ever introduced, it must be explicitly labeled as promotion and must remain separate from historical significance.

```text
Paid placement
        ≠
Historically important
```

The product should be particularly careful because paid amplification could otherwise corrupt Users' understanding of what Chronologity considers historically meaningful.

## Discovery Product Invariants

1.  Discovery introduces Users to authorized history outside their established Feed context or explicit Search query.
2.  Discovery is distinct from the primary Feed.
3.  Discovery is distinct from Search.
4.  Discovery ordering does not establish historical truth or universal historical significance.
5.  Discovery may recommend multiple historical entity types rather than only Moments.
6.  Visibility and discoverability are distinct concepts.
7.  Public accessibility must not automatically imply recommendation eligibility.
8.  Authorization must be evaluated before recommendation.
9.  Derived recommendation context must not leak private information.
10. Discovery surfaces should have explicit objectives rather than relying on one universal opaque ranking.
11. Event Discovery may use significance, time, Location, interests, and other authorized context.
12. Location Discovery must not become live User tracking.
13. Current Location may be a query input without becoming public historical presence.
14. People Discovery must not expose private Event attendance or sensitive inferred relationships.
15. Timeline Discovery may provide better historical context than isolated Moment recommendations.
16. Moment Discovery should preserve sufficient historical context.
17. Related-history recommendations should prefer meaningful historical relationships over generic engagement similarity.
18. Causal Discovery must distinguish established relationships from hypotheses.
19. Temporal and anniversary Discovery must not pretend old history occurred today.
20. Historical significance may inform Discovery but must remain contextual and multidimensional.
21. Personal significance does not imply recommendation consent.
22. Collective significance must not be reduced to raw volume.
23. Evidentiary significance does not establish truth.
24. Retrospective significance may appropriately resurface old history through Discovery without changing Feed position.
25. Engagement may be a limited Discovery signal but must not become the sole or dominant definition of historical value.
26. Popularity is distinct from Discovery relevance and historical significance.
27. Trending, if introduced, must be labeled as attention rather than importance.
28. Discovery should preserve perspective, temporal, geographic, and creator diversity where appropriate.
29. Follower count must not automatically determine recommendation priority.
30. Novelty is a presentation signal rather than historical significance.
31. Serendipity should preferably arise from meaningful historical relationships.
32. Recommendation explanations should be understandable without leaking sensitive information.
33. Users should have meaningful control over personalization and unwanted recommendations.
34. Explicit interests should remain distinguishable from behaviorally inferred interests.
35. Discovery should avoid unnecessary sensitive-attribute inference.
36. Social context must not become a privacy side channel.
37. Blocking must propagate through Discovery.
38. Muting and recommendation suppression should have explicit semantics.
39. Moderation eligibility precedes algorithmic amplification.
40. Public accessibility and broad algorithmic amplification are distinct product decisions.
41. Sensitive historical content may require stricter Discovery treatment despite historical significance.
42. Private Events and private participation must not leak through Discovery.
43. Location recommendations must use viewer-safe geographic precision.
44. Discovery may lead into temporal zoom and historical jumps without changing those features' semantics.
45. Recommendation notifications should require stronger justification than passive Discovery cards.
46. Newly published old history must be labeled honestly as newly available historical material.
47. Bulk imports must not gain recommendation advantage merely from publication volume.
48. Unlimited Moment media must not increase rank merely because more media is attached.
49. Media format must not become an implicit recommendation advantage.
50. Recommendation feedback is distinct from social Reactions.
51. Personal negative recommendation feedback must not alter global historical significance.
52. Discovery success should measure useful historical exploration rather than only attention consumption.
53. Chronologity should support useful cold-start and non-personalized Discovery without invasive surveillance.
54. Editorial or institutional curation must preserve selection provenance.
55. AI-assisted Discovery remains subject to historical, privacy, authorization, and moderation rules.
56. Material Discovery logic should be internally traceable or versioned.
57. Discovery experiments must not modify authoritative history or the primary Feed's chronological semantics.
58. Discovery should anticipate manipulation and avoid dependence on easily gamed signals.
59. Paid promotion, if ever introduced, must never masquerade as historical significance.

## Day-One Discovery Requirements

Before launch, Chronologity must have explicit product behavior for:

- the boundary between Feed, Search, and Discovery;
- which historical entity types are discoverable;
- discoverability eligibility;
- public versus discoverable content;
- authorization before recommendation;
- blocking;
- moderation eligibility;
- sensitive-content eligibility;
- basic Discovery ranking objectives;
- historical-significance usage;
- engagement-signal usage or explicit exclusion;
- diversity;
- recommendation explanations where appropriate;
- recommendation feedback;
- cold-start behavior;
- non-personalized Discovery;
- Event Discovery if public Events ship at launch;
- Location Discovery if Location exploration ships at launch;
- privacy-safe use of Location;
- newly added old history;
- bulk imports;
- temporal context;
- deep links into Timeline, Event, or Moment history;
- interaction with temporal zoom and historical jumps; and
- clear separation from the chronological Feed.

The initial release does not require:

- a sophisticated machine-learning recommender;
- a "For You" Feed;
- trending content;
- paid promotion;
- social-proof counters;
- institutional curation;
- editorial collections;
- AI-generated recommendation explanations;
- continuous live-location recommendations;
- inferred sensitive-interest profiles;
- generic recommendation push notifications;
- every possible Discovery surface; or
- one universal ranking model.

A simple, principled Discovery system is preferable to a sophisticated attention-optimization system that undermines Chronologity's historical identity.

## Open Product Questions

The following questions require deliberate resolution:

- What is the day-one name of the primary Discovery surface: Explore, Discover, or something else?
- Which entity types appear in day-one Discovery: Moments, Events, Timelines, People, Locations, or some subset?
- Should Discovery primarily recommend historical scopes such as Events and Timelines rather than isolated Moments?
- What exactly makes a public Moment discoverable?
- Should discoverability be an explicit creator setting?
- Should public content be discoverable by default or require opt-in?
- Does Chronologity need an "unlisted" state?
- Can discoverability differ by surface?
- Can a Moment be searchable but not recommendable?
- Can an Event be discoverable while some of its public Moments are not individually recommendable?
- Can a Timeline be discoverable while individual Moments are excluded from general Discovery?
- How should discoverability work for People who are not Chronologity Users?
- What is the primary objective of day-one Discovery?
- Is the objective to help Users find people to follow, history to explore, Events, or all three?
- Which ranking signals are permitted on day one?
- Should historical significance be the strongest signal?
- Should engagement be excluded entirely from v1 Discovery?
- If engagement is included, what hard limits prevent it from dominating?
- Should follower count ever be a ranking signal? The recommended default is no.
- Should recency be a Discovery signal?
- If so, how do we avoid systematically burying old history?
- Should newly published old history receive a temporary "newly available" signal?
- How long should such a signal last?
- Should publication freshness and occurrence recency be represented separately?
- How should bulk imports be surfaced?
- Should a large imported archive produce one Discovery candidate representing the Timeline or collection rather than thousands of Moments?
- What diversity dimensions are required on day one?
- How should perspective diversity be measured?
- How should temporal diversity be enforced?
- How should geographic diversity be enforced without creating arbitrary quotas?
- How should creator diversity prevent recommendation monopolies?
- Should Chronologity deliberately surface low-engagement but historically significant content?
- How should evidentiary significance affect Discovery?
- How should disputed or uncertain historical content affect recommendation eligibility?
- Should causal predecessors and consequences appear directly in Discovery or only within historical navigation?
- Should anniversary Discovery ship on day one?
- If so, should anniversaries be personal, public, or both?
- Can Users disable specific anniversaries?
- How should traumatic or sensitive anniversaries be handled?
- Should "On this day" include history from people the User does not follow?
- Should Discovery use explicit interests?
- If so, when are interests collected?
- Should Users be able to edit or reset them?
- Which interest categories are appropriate?
- Should Chronologity infer interests behaviorally?
- What behavioral signals are allowed?
- How long should inferred-interest history persist?
- Should Users be able to see why Chronologity thinks they are interested in a topic?
- What categories of sensitive inference are prohibited?
- Should social relationships influence Discovery?
- If so, which relationship signals are safe?
- Should mutual follows influence People Discovery?
- Should shared public Event participation influence recommendations?
- How do we prevent that from revealing private attendance?
- Should social proof appear at all?
- Should Users see "people you follow also follow this person"?
- Should Users see "people you follow contributed to this Event"?
- What consent is required for those statements?
- Does muting someone suppress them from Discovery?
- Should "not interested" be available for every Discovery candidate?
- Should Users be able to block recommendation of an entire Event, Location, Person, Timeline, or topic?
- How should feedback on one Moment affect related Moments?
- Should negative feedback decay over time?
- Should Users be able to reset their recommendation profile?
- Should there be a non-personalized Discovery mode?
- Could Users disable personalized Discovery entirely?
- What should cold-start Discovery show before the User follows anyone?
- Should onboarding ask Users to select interests?
- Should it ask for Locations?
- Should contact-based discovery exist?
- If so, what explicit permission and privacy rules are required?
- Should "history near me" ship on day one?
- If so, is current Location processed ephemerally?
- Should the server retain current Location used for Discovery?
- What precision is necessary for nearby-history queries?
- Should Users be able to choose a place manually instead of granting device Location?
- How should sensitive Locations be excluded or generalized?
- Should Discovery include a map surface?
- How should map Discovery remain accessible to screen-reader Users?
- How should private or reduced-precision Locations appear?
- Should public Event Discovery have its own surface?
- How should large Events be represented?
- Should Event recommendations show representative Moments?
- How are those representatives selected?
- Should Event popularity have any role?
- Should current Events receive special treatment?
- How should Chronologity distinguish "happening now" from "historically significant"?
- Should Trending exist at all?
- If it exists, what exactly does it measure?
- Would a Trending surface undermine Chronologity's product philosophy enough that it should be rejected entirely?
- Should Discovery recommendations have visible explanations?
- Which explanations are useful without cluttering the interface?
- Should Users be able to tap an explanation to inspect more detail?
- How much recommendation provenance should be retained internally?
- Should Discovery algorithms be versioned per recommendation?
- How long should recommendation logs be retained?
- What experimentation is acceptable?
- Can A/B tests optimize for follows or historical exploration rather than watch time?
- Which metrics define useful exploration?
- Should "historical depth traversed" be a first-class product metric?
- How do we prevent optimization for depth from becoming another manipulative engagement metric?
- Should Discovery consider whether a User completed viewing a Moment containing many media items?
- How do we prevent unlimited media quantity from biasing ranking?
- Should video completion affect recommendation? The recommended default is not as a direct historical-value signal.
- Should Chronologity recommend People primarily from the history they publish rather than generic profile similarity?
- Should public Timelines be followable directly?
- Should Events be followable directly?
- Should Locations be followable?
- If those scopes become followable, does their future history enter the primary Feed?
- How does that affect the Feed eligibility model?
- Should Discovery show content from blocked Users when the historical Event itself is public? The recommended default is to avoid exposing the blocked User's content while allowing independently accessible Event history.
- How should moderation standards differ between direct access and recommendation?
- Which content categories are allowed to exist publicly but excluded from broad amplification?
- How should graphic historical material be handled?
- Should explicit research intent permit broader Discovery results than passive browsing?
- How should age restrictions affect Discovery?
- Should AI be used in day-one Discovery?
- If yes, for which bounded tasks?
- Should semantic embeddings be allowed to infer related history without asserting a factual relationship?
- How should AI-generated "related" recommendations be labeled when no explicit historical relationship exists?
- Should Chronologity distinguish "historically related" from "semantically similar"?
- How should recommendation manipulation be detected?
- What signals should be ignored because they are too easy to game?
- Should Users ever be able to pay to promote public history?
- If paid promotion is eventually allowed, where can it appear without contaminating historical Discovery?
- Should Chronologity publish a product commitment explaining that paid placement does not affect historical significance?
- What Discovery analytics are necessary at launch?
- What analytics should be deliberately avoided?
- How should User data exports represent inferred Discovery interests?
- How should account deletion affect recommendation profiles and embeddings?
- How quickly must privacy changes remove content from Discovery indexes and caches?
- How quickly must blocks affect recommendations?
- How should offline or cached Discovery surfaces respond to revoked access?
- Should Chronologity preserve recommendation history so Users can revisit previously discovered material, or is that a separate saved-history feature?
- How does saving a discovered Moment differ from reacting to it, following its creator, or marking it personally significant?

These questions should be resolved before recommendation infrastructure hardens assumptions borrowed from engagement-optimized social networks.

## Architecture Constraints

This document does not prescribe a recommendation service, vector database, embedding model, ranking framework, feature store, experimentation platform, or search engine.

It does impose architectural constraints.

Discovery must remain architecturally separable from the primary Feed so recommendation logic cannot accidentally become Feed ordering logic.

The system should distinguish:

```text
Authorization
        ↓
Discoverability eligibility
        ↓
Candidate generation
        ↓
Ranking / selection
        ↓
Presentation
```

Authorization and discoverability are prerequisites, not ranking features.

A candidate that is not authorized or not discoverable for the viewer must not enter the ranking stage.

Discovery must support multiple candidate entity types without requiring every recommendation to be flattened into a Moment.

Historical significance should be consumed as contextual derived data rather than treated as one global immutable rank.

Engagement features, if used, should remain separately identifiable so their influence can be constrained, audited, or removed.

Recommendation feedback must remain distinct from Reactions and other historical/social interactions.

The architecture must support privacy-safe features. Raw private Event participation, hidden Location precision, blocked relationships, and other restricted context must not be copied into recommendation features in ways that make later enforcement impossible.

Privacy, blocking, deletion, and moderation changes must invalidate or suppress affected candidates and derived recommendation artifacts.

The system should preserve enough recommendation provenance to identify major contributing signal classes and algorithm/model versions where material.

AI- or embedding-derived similarity must not be persisted as though it were an authoritative causal, Event, Location, or identity relationship.

Discovery experimentation must be isolated from authoritative historical state and from chronological Feed ordering.

Finally, the recommendation architecture should allow Chronologity to optimize for useful historical exploration rather than requiring watch time, clicks, or engagement to become the universal objective function.

## Guiding Principle

When deciding whether Chronologity should recommend something, ask:

> **Will surfacing this help the User discover meaningful history they are permitted to explore, or are we merely optimizing for attention?**

Discovery may be algorithmic.

Chronologity's values should not be.
