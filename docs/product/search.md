# Chronologity Search

## Purpose

This document defines the product semantics of **Search** in Chronologity.

Search allows a User to intentionally locate history by expressing what they are looking for. Unlike the chronological Feed, Search may rank results by relevance. Unlike Discovery, Search begins with explicit User intent rather than proactively recommending history.

The central question is:

> **How should Chronologity let Users find Moments, People, Timelines, real-world Events, Locations, and historical context without confusing relevance with chronology, popularity, historical significance, or truth?**

This document defines product behavior and invariants rather than search-engine selection, index schemas, embeddings, vector databases, ranking implementations, or API contracts.

## Definition

**Search** is an intent-driven retrieval experience over history the requesting User is permitted to access.

Conceptually:

```text
User query / filters
        |
        v
Authorized searchable history
        |
        +-- lexical relevance
        +-- semantic relevance
        +-- entity identity
        +-- temporal context
        +-- Location context
        +-- Event context
        +-- historical significance
        +-- explicit filters
        |
        v
Search results
```

Search helps a User find history. It does not determine what that history means.

## Search Versus Feed

The Feed and Search have fundamentally different ordering semantics.

```text
Feed   -> occurrence chronology
Search -> relevance to explicit intent
```

A Moment from 1998 may appear above a Moment from 2026 in Search because it better matches the query. That does not change either Moment's chronological position.

## Search Versus Discovery

Search begins with explicit User intent. Discovery does not require a query.

```text
Search:
"Show me Moments from the 2017 eclipse."

Discovery:
"You may want to explore the 2017 eclipse."
```

Both may use significance, Events, Locations, and other context, but they remain separate product experiences.

## Search Relevance Is Not Historical Significance

A result may be highly relevant to a query but historically insignificant. A historically significant Moment may be a poor match for a particular query.

```text
Search relevance != Historical significance
```

Historical significance may inform ranking where appropriate, but it must not replace query relevance.

Likewise:

```text
Popularity != Search relevance
```

A highly viewed or heavily reacted-to Moment must not automatically outrank a much better historical match.

## Searchable Entity Types

Chronologity Search should be capable of locating multiple historical entity types, including:

- Moments;
- Users and historical People;
- Timelines;
- real-world Events;
- Locations;
- historical subjects; and
- future historical scopes.

Not every entity type needs identical ranking logic.

## Unified Search

Chronologity may provide a unified Search entry point.

For example:

```text
"Woodstock"
   |
   +-- Event
   +-- Location
   +-- Timelines
   +-- Moments
   +-- People
```

Unified Search must preserve entity type so Users understand what each result represents. Chronologity should not flatten all history into an undifferentiated list of media posts.

Entity-specific result tabs or filters may provide more focused retrieval.

## Search Eligibility

A resource may appear only when:

1.  the requesting User is authorized to access it; and
2.  it is eligible for the relevant Search surface.

Authorization is a prerequisite, not a ranking signal.

```text
Resource
   |
Authorized?
   +-- No -> exclude
   +-- Yes
         |
Searchable?
   +-- No -> exclude
   +-- Yes -> candidate
```

## Visibility, Searchability, and Discoverability

These are distinct concepts.

Chronologity should preserve the possibility of:

```text
Visible + searchable + discoverable
Visible + searchable + not discoverable
Visible + not searchable + not discoverable
Restricted
```

A resource may reasonably be accessible through a direct link or known Timeline without being intended for broad Search. Likewise, a User may permit intentional Search retrieval without consenting to proactive recommendation.

Therefore:

```text
Visible != Searchable != Discoverable
```

Public accessibility must not automatically mean indexing into every Search surface.

## Search Privacy

Search infrastructure must not become an alternate path around Chronologity privacy.

Privacy applies not only to direct results but also to:

- autocomplete;
- snippets;
- highlighted text;
- query suggestions;
- result counts;
- facets;
- Event names;
- Location names;
- participant names;
- related searches;
- embeddings;
- cached results; and
- other derived artifacts.

The existence of private history can itself be sensitive.

## Query Types

Chronologity should support multiple forms of historical intent:

```text
Entity:
"Madison Square Garden"

Person:
"Richard"

Event:
"2017 solar eclipse"

Location:
"Yosemite"

Time:
"summer 2012"

Combination:
"concerts in New York in 2005"

Personal history:
"my hiking videos from Colorado"
```

The Search model must not assume every query is a simple keyword lookup.

## Keyword Search

Lexical Search remains fundamental. Names, captions, descriptions, Event titles, Location names, aliases, and other authorized textual metadata should be directly searchable.

Semantic Search should complement rather than replace exact matching. Exact names and known entities often require deterministic retrieval.

## Natural-Language and Semantic Search

Chronologity may eventually support queries such as:

```text
"Show me my hiking Moments from Colorado in 2024."

"Find public history from this Location before 1980."
```

Natural-language interpretation may translate intent into structured filters and semantic retrieval.

However:

```text
Semantically similar != Historically related
```

Semantic similarity must not silently create Event membership, causality, Person identity, Location assertions, or other authoritative historical relationships.

AI query interpretation must never broaden authorization or fabricate history.

## Structured Filters

Potential Search filters include:

- date or time range;
- Person;
- Timeline;
- Event;
- Location;
- media type;
- creator;
- historical significance where appropriate;
- visibility context; and
- future historical dimensions.

Filters constrain retrieval explicitly rather than acting as hidden ranking assumptions.

## Temporal Search

Time is a first-class Search dimension.

Users should be able to search periods such as:

```text
1998
June 1998
2010-2015
Before 1980
After graduation
```

Search must preserve the temporal precision and uncertainty defined elsewhere in Chronologity.

A Moment known only as:

```text
Summer 1998
```

must not acquire a fabricated exact timestamp merely to make filtering easier.

Queries involving historical local dates must also respect occurrence context rather than blindly applying the viewer's current time zone.

## Location Search

Users should eventually be able to search Locations through:

- current names;
- historical names;
- aliases;
- addresses where permitted;
- cities;
- regions;
- countries;
- geographic proximity; and
- other authorized place metadata.

Location Search must preserve historical place identity.

```text
Same coordinates != Same historical Location
```

Viewer-safe Location precision is mandatory. A User permitted to see only city-level context must not receive an exact-address result, map marker, facet, autocomplete suggestion, or nearby match derived from hidden coordinates.

## Nearby Search

Chronologity may support "history near this place" or similar geographic retrieval.

Nearby Search is historical retrieval, not live User tracking.

Current device Location may be used as explicit query input without becoming historical content or public User presence.

## Event Search

Real-world Events should be searchable by authorized names, aliases, dates, Locations, descriptions, subjects, and related historical context.

Different Events may share names. Search should provide enough context---such as date, Location, or Event type---to disambiguate them.

Event identity must never depend solely on title text.

Reconciled duplicate Events should eventually resolve to coherent Search results without losing historical aliases or provenance.

## Moment Search

Moment Search may consider authorized:

- captions;
- descriptions;
- occurrence time;
- creator;
- Timeline;
- Event associations;
- Location;
- historical significance;
- User-authored metadata;
- media-derived metadata where permitted; and
- other historical context.

A Moment remains one Search entity regardless of how many images and videos it contains.

Unlimited media quantity must not itself increase Search importance.

## Searchable Media Content

Chronologity may eventually index derived media information such as:

- transcripts;
- OCR text;
- object or scene descriptions;
- landmark recognition;
- and other AI-generated metadata.

These are retrieval aids, not authoritative historical assertions.

For example:

```text
AI inference:
"possible Eiffel Tower"
```

may improve retrieval but must not silently become:

```text
Authoritative Location = Eiffel Tower
```

Derived metadata must preserve provenance and uncertainty.

## People and Identity Search

Chronologity must distinguish:

```text
User account != Historical Person
```

A Person represented in history may not have a Chronologity account.

Multiple people may also share the same name.

```text
Same name != Same Person
```

Identity disambiguation may use authorized historical context, but must never expose private attributes merely to distinguish results.

## Timeline Search

Search may locate Timelines through authorized title, owner, subject, date range, Event, Location, description, or other metadata.

A Timeline result should remain a historical scope rather than being flattened into its individual Moments.

Chronologity should eventually support scoped Search such as:

```text
Search within my Timeline
Search within Event X
Search within Location Y
Search within a public Timeline
```

## Ranking

Search ranking should primarily answer:

> **Which authorized candidates best satisfy the User's expressed intent?**

Potential signals include:

- exact textual match;
- semantic match;
- entity match;
- temporal match;
- Location match;
- Event match;
- scope match;
- historical significance;
- provenance or data quality;
- publication recency when explicitly relevant; and
- bounded personalization.

No one signal should be universally dominant.

## Exact Match and Navigation

Exact entity and phrase matches should receive appropriate navigational priority.

A User searching for the exact name of a known Event should not have that Event buried beneath loosely related but popular Moments.

Search must support direct navigation as well as exploration.

## Historical Significance in Ranking

Historical significance may help distinguish similarly relevant candidates.

For example, a direct historically significant Moment from an Event may reasonably outrank a later casual reference using the same words.

But unrelated significant history must never outrank a direct query match merely because it is more important in another context.

## Personalization

Search may use bounded personalization such as:

- User-owned history;
- current historical scope;
- followed people;
- explicitly selected entities; or
- explicit interests.

Personalization must remain subordinate to the query.

Chronologity should avoid Search results becoming so personalized that explicit identical queries produce inexplicable outcomes.

## Engagement

Engagement may eventually serve as a bounded quality or tie-breaking signal, but it must not dominate Search.

Reactions, Comments, views, follower count, or watch time must not become proxies for relevance.

For the initial Search implementation, the safest default is to omit engagement unless a concrete retrieval-quality problem justifies its inclusion.

## Occurrence Recency and Publication Recency

Occurrence time and publication time answer different questions.

Occurrence recency matters when the query asks for recent history.

Publication recency matters when the query asks for newly added material.

A newly uploaded photograph from 1974 is:

```text
newly published
but
historically located in 1974
```

Search must preserve both dimensions rather than collapsing them.

## Result Context

Results should display enough authorized context to explain relevance.

Depending on entity type, that may include:

- entity type;
- occurrence date or period;
- Location;
- Event;
- Timeline;
- creator;
- historical subject;
- matched text;
- and significance context where appropriate.

Context must never leak hidden metadata.

## Snippets and Highlights

Search snippets and term highlighting are derived presentation.

They may explain why a result matched, but must not expose restricted content or imply that highlighted text is historically important.

A snippet must obey the same authorization, moderation, and privacy rules as the resource it represents.

## Result Stability

Search is relevance-ranked, so ordering may legitimately change when the query, filters, context, algorithm, or underlying history changes.

However, repeated identical queries should not appear arbitrarily randomized without product reason.

Stable behavior improves trust and navigability.

## Sort Modes

Chronologity may eventually expose explicit sort modes such as:

- relevance;
- occurrence time, newest first;
- occurrence time, oldest first;
- historical significance;
- newly added.

Alternate sort modes must be clearly labeled.

When chronological sorting is selected, occurrence semantics govern ordering and engagement must not interfere.

A significance sort must not be labeled in a way that implies universal historical truth.

## Autocomplete and Suggestions

Autocomplete may help locate People, Events, Locations, Timelines, and historical subjects.

It is itself a Search surface and therefore privacy-sensitive.

Private entity names must not leak because a User typed a matching prefix.

Related-query suggestions and spelling corrections must obey the same rule.

## Search History

Search history can reveal sensitive intent.

If Chronologity stores Search history, Users should have clear control over it, including deletion.

Search history must not become public social activity.

A future recent-searches or saved-search feature should inherit these privacy principles.

## Blocking

Blocking must propagate through Search.

Search results, snippets, autocomplete, counts, and related entities must not defeat the intended semantics of a block.

The exact directionality follows the social-graph specification.

## Moderation and Amplification

Search eligibility may be stricter than direct accessibility.

Chronologity should support:

```text
Allowed to exist
Allowed to be accessed directly
Not eligible for broad Search
```

when safety policy requires it.

Explicit Search intent may justify retrieval that would be inappropriate to recommend through Discovery, but explicit intent never overrides authorization, legal requirements, or safety controls.

## Sensitive Historical Material

Historically important material may be disturbing, graphic, traumatic, or otherwise sensitive.

Search should account for:

- explicit User intent;
- content warnings;
- age restrictions;
- moderation;
- privacy; and
- historical context.

Historical significance alone does not require unrestricted Search amplification.

## Historical Disputes

Search may return conflicting historical claims.

Ranking must not silently convert one interpretation into Chronologity's declaration of truth.

Where appropriate, competing authorized records should preserve provenance and uncertainty.

Higher Search rank means greater relevance to the query, not greater factual authority.

## Causal Search

Users may eventually search questions such as:

```text
"What led to Event X?"
"What happened because of Event Y?"
```

Only established causal relationships should be presented as established.

AI-suggested, disputed, or inferred causal relationships must preserve their status.

## Temporal Zoom

Very large Search result sets may benefit from temporal abstraction.

For example:

```text
10,000 matching Moments
        |
        v
Group by decade
        |
        v
Zoom into year
        |
        v
Individual results
```

Temporal zoom must preserve access to underlying matches and the distinction between relevance ranking and chronological representation.

## Historical Jumps

A Search result may become the starting point for historical navigation.

For example:

```text
Search Event X
      |
      v
Open Event
      |
      v
Jump to causal predecessor
```

Search finds the entry point. Historical jumps then operate according to the opened scope's semantics.

## Search, Feed, and Discovery Handoffs

Opening a Search result must not change its Feed position.

Related recommendations attached to Search results belong to Discovery and should be visually and semantically distinguishable from direct Search results.

Chronologity must keep these systems composable without collapsing their ranking semantics.

## Deletion and Privacy Changes

Deleted or newly restricted content must disappear from Search-derived artifacts, including:

- direct results;
- snippets;
- autocomplete;
- suggestions;
- facets;
- counts;
- semantic embeddings;
- cached result pages; and
- other indexes.

Search indexes are derived state, not an immutable historical record.

## Corrections

Corrections to searchable historical context may require reindexing.

Examples include:

- occurrence time;
- Location;
- Event association;
- caption or description;
- Person identity;
- Timeline metadata;
- significance;
- aliases; and
- visibility.

Search should reflect current authorized historical state.

## Search Provenance

Where derived or inferred metadata materially contributes to retrieval, Chronologity should preserve enough provenance to distinguish:

```text
User-authored metadata
Authoritative structured metadata
System-derived metadata
AI-inferred metadata
```

This matters for result explanation, correction, debugging, and trust.

## Explainability

Chronologity should be able to explain relevance at a useful level.

Examples:

- exact title match;
- matched caption;
- same Event;
- within selected date range;
- Location match;
- semantic match;
- Person match.

The product need not expose every ranking weight.

It should avoid a system that cannot explain obvious results.

## Search Quality

Search quality should be evaluated as historical retrieval, not merely click generation.

Useful measures may include:

- successful entity lookup;
- precision;
- recall;
- time to desired result;
- filter effectiveness;
- historical-period coverage;
- privacy correctness;
- ambiguity handling;
- and explicit User feedback.

Click-through rate alone is insufficient.

## Zero Results

A zero-result Search must not fabricate history.

Chronologity may:

- suggest spelling corrections;
- broaden filters;
- suggest related public entities;
- offer a transition to Discovery; or
- explain that no authorized results were found.

No result is preferable to fictional history.

## Ambiguity and Aliases

Ambiguous queries should be disambiguated when material.

For example:

```text
"Paris"
```

could identify a city, Person, Event, Timeline, or textual match.

Search should also support aliases such as:

- former Location names;
- Event aliases;
- nicknames;
- alternate spellings;
- abbreviations;
- translated names;
- and historical names.

Aliases improve retrieval without rewriting historical identity.

## Misspellings

Typo tolerance and spelling correction may improve Search, but a historically unusual spelling may be correct.

Corrections should therefore be retrieval aids or suggestions rather than silent rewriting of historical names.

## Multilingual Search

Chronologity's historical corpus may span languages and scripts.

The architecture should remain extensible to:

- Unicode text;
- language-aware tokenization;
- transliteration;
- translated aliases;
- and semantic cross-language retrieval.

Complete multilingual Search is not required on day one.

## Accessibility

Search must be usable without relying exclusively on visual cards, maps, thumbnails, or media previews.

Entity type, historical context, filters, result state, and navigation must have meaningful accessible representations.

## Scale

Chronologity's Search corpus will become larger and older continuously.

Older history is a core asset, not cold content to be excluded for performance.

Search architecture must scale without assuming only recent history matters.

## Search Product Invariants

1.  Search is explicit-intent retrieval over authorized history.
2.  Search is distinct from Feed and Discovery.
3.  Search relevance is distinct from historical significance, popularity, and truth.
4.  Search should support multiple historical entity types without flattening them into Moments.
5.  Authorization and Search eligibility precede ranking.
6.  Visibility, Searchability, and discoverability are distinct.
7.  Public accessibility does not inherently require broad Search indexing.
8.  Search-derived artifacts must obey privacy and authorization.
9.  Search must support historical textual, temporal, geographic, Event, Person, Timeline, and scoped intent as the product evolves.
10. Lexical Search remains important even if semantic Search exists.
11. Semantic similarity does not establish a historical relationship.
12. Natural-language Search must not broaden authorization or fabricate history.
13. Structured filters should explicitly constrain retrieval.
14. Temporal Search must preserve uncertainty rather than fabricate precision.
15. Location Search must preserve historical identity and viewer-safe precision.
16. Nearby Search is historical retrieval, not live User tracking.
17. Event identity must not depend solely on title text.
18. A Moment remains one Search entity regardless of its unlimited media count.
19. AI-derived media metadata remains distinct from authoritative historical assertions.
20. User accounts and historical People are distinct concepts.
21. Same name does not imply same Person.
22. Timeline Search must preserve the Timeline as a historical scope.
23. Ranking should primarily satisfy expressed User intent.
24. Exact entity matches deserve appropriate navigational priority.
25. Historical significance may inform ranking without replacing relevance.
26. Personalization must remain subordinate to query intent and privacy.
27. Engagement must not dominate Search.
28. Publication time and occurrence time must remain separate ranking/filter dimensions.
29. Results should expose enough authorized context to explain relevance.
30. Snippets and highlights must not leak restricted content.
31. Repeated identical Search should not be arbitrarily unstable.
32. Alternate sort modes must be explicit.
33. Chronological sorting uses occurrence semantics.
34. Autocomplete and query suggestions are privacy-sensitive.
35. Search history is sensitive User-intent data.
36. Blocking and moderation must propagate through Search.
37. Explicit Search intent does not override authorization or safety.
38. Ranking must not silently resolve historical disputes as truth.
39. Causal Search must preserve causal provenance and confidence.
40. Temporal abstraction must preserve access to underlying results.
41. Search ranking must never change Feed chronology.
42. Discovery recommendations attached to Search remain distinguishable from direct results.
43. Deleted or restricted history must be removed from Search-derived artifacts.
44. Search indexes are rebuildable derived state.
45. Corrections to authoritative history must propagate to Search.
46. Material inferred metadata should preserve provenance.
47. Search relevance should be explainable at a useful level.
48. Search quality must not be reduced to click-through rate.
49. Zero-result Search must not fabricate history.
50. Ambiguous queries should be disambiguated where material.
51. Aliases improve retrieval without rewriting historical identity.
52. Search should remain extensible to multilingual history.
53. Search must be accessible without requiring visual media or maps.
54. Search performance must not be achieved by excluding old history merely because it is old.
55. Search should value recall of relevant authorized history rather than opaque engagement-based omission.

## Day-One Search Requirements

Before launch, Chronologity must have explicit product behavior for:

- the boundary between Search, Feed, and Discovery;
- searchable entity types;
- unified versus entity-specific Search;
- authorization;
- Searchability;
- discoverability versus Searchability;
- public-content indexing;
- blocking;
- moderation eligibility;
- exact-name lookup;
- keyword Search;
- temporal Search;
- Location Search;
- Event Search;
- Moment Search;
- User or Person Search as applicable;
- Timeline Search;
- launch-critical structured filters;
- relevance ranking;
- chronological sorting if exposed;
- stable result behavior;
- result context and snippets;
- autocomplete if exposed;
- zero results;
- ambiguity and typo handling;
- aliases;
- deletion;
- privacy changes;
- corrections;
- handoff into temporal zoom and historical jumps;
- accessibility; and
- Search-index update expectations.

The initial release does not require:

- sophisticated semantic Search;
- vector embeddings;
- AI natural-language query planning;
- AI image understanding;
- transcript Search;
- OCR Search;
- saved searches;
- popularity ranking;
- trending queries;
- social-proof ranking;
- advanced personalized Search;
- every possible significance sort;
- perfect multilingual semantic retrieval; or
- perfect historical alias resolution.

A reliable lexical and structured Search system with strong privacy semantics is preferable to an ambitious AI Search system that cannot distinguish inference from historical fact.

## Established Search Decisions

These were open questions. Implementation settled them (ADR-118).

**One Search entry point**, over Moments, accounts, real-world Events, and
Locations at once, with an optional filter to one kind. Every result says what
it is; nothing is flattened into an undifferentiated list.

**Three sort modes ship**: relevance, occurrence newest first, and occurrence
oldest first. When a chronological mode is chosen, occurrence governs entirely
and relevance plays no part.

**No significance sort, and no score of any kind is returned.** Significance
breaks ties between comparably good matches and never promotes a weak one. A
number beside a result reads as a judgement about the past whatever it is
labelled.

**Engagement is not a ranking signal**, and the ranking code cannot reach one.

**Typo tolerance retrieves rather than rewrites.** A near miss finds the thing
meant; nothing silently corrects what somebody typed, because a historically
unusual spelling may be the correct one.

**Temporal filters overlap rather than contain.** A Moment known only as
"summer 1998" is found by a search for 1998 and never acquires an invented date.

**Proximity search is answered at the granularity the author disclosed**, and
the response says which. A Moment shared only at city level is found by a
city-sized search and not a street-sized one; a Moment with its place hidden is
never a proximity match, for anybody including its author.

**Zero results means zero results.** Nothing loosely related is substituted, and
the result count covers only what the asker may see.

**A result is not a permission.** Opening one reauthorizes against current state.

### Not yet built

**Autocomplete and suggestions**, which are their own Search surface and their
own privacy problem — a private name must not leak because somebody typed a
matching prefix.

**Facet counts**, whose leakage surface is real and which nothing day-one needs.

**Handoff into temporal zoom and historical jumps**, which runs through the feed
aggregator and waits on that application existing.

## Open Product Questions

The following questions require deliberate resolution:

- Which entity types are searchable on day one?
- Should the primary Search entry point be unified?
- How should mixed entity types be ranked?
- Should exact entity matches appear in a dedicated navigational section?
- Can Users search all private history they are authorized to see?
- Should personal Search and global Search be distinct modes?
- Should scoped Search ship on day one?
- Is Searchability an explicit resource setting?
- Does Chronologity need an unlisted state?
- Can content be searchable but not discoverable?
- What are the default Searchability rules for public Moments, Timelines, Events, and Locations?
- Should Event membership ever make an otherwise non-searchable Moment searchable? The recommended answer is no.
- Which Moment fields are indexed on day one?
- Are Comments searchable?
- If so, does a Comment match return the Comment or its Moment?
- Are usernames and display names searchable?
- How are historical People distinguished from User accounts?
- Which Location precision may appear in global Search?
- Should residential Locations be excluded from broad public Search by default?
- Does nearby Search ship on day one?
- Which temporal precision levels and range operators ship on day one?
- How should approximate temporal ranges match exact filters?
- Which structured filters are launch-critical?
- Could facet counts leak private data?
- What is the default result ordering?
- Does chronological sort ship on day one?
- Should both oldest-first and newest-first be available?
- Does significance sorting belong in v1?
- Should engagement be excluded entirely from v1 ranking? The recommended default is yes unless a concrete retrieval problem justifies a bounded role.
- Should follower count influence People Search? The recommended default is no as a general relevance signal.
- Should Search personalize results?
- If so, should own history or followed people receive bounded boosts?
- Can Users disable personalization?
- How much result explanation should be visible?
- Should semantic and AI-derived matches be labeled?
- When should semantic Search be introduced?
- Can embeddings be created from private history?
- How are embeddings invalidated after deletion or access changes?
- Should Comments, transcripts, OCR text, landmarks, filenames, or EXIF metadata be indexed?
- Should face recognition ever be used for Search, or should Chronologity reject it entirely?
- How should uncertain AI metadata affect ranking?
- Can creators inspect and correct derived Search metadata?
- How should unlimited media contribute to relevance without quantity gaming?
- How do blocks affect shared Event and People Search?
- Which content may remain directly accessible but be excluded from Search?
- How should graphic historical material appear?
- What special protections apply to Search involving minors?
- How quickly must deletion, privacy changes, and blocks propagate to indexes?
- Should every result be reauthorized when opened? The recommended answer is yes.
- How should stale cached snippets be invalidated?
- How should duplicate Events and Locations appear before reconciliation?
- How should aliases and historical names be governed?
- Which languages must launch Search support?
- Should spelling corrections be automatic or suggested?
- Should Search history be retained?
- Can Users disable or delete Search history?
- Should Search history influence Discovery?
- How do we prevent feedback loops between Search and Discovery?
- Should saved searches eventually create alerts for newly published matching history?
- How should bulk imports affect such alerts?
- Should Search itself expose temporal zoom for large result sets?
- Should opening a Moment result show the isolated Moment or its surrounding Timeline context?
- Should Users be able to jump directly to the Moment's historical position?
- Which metrics best measure successful historical retrieval?
- Should raw query text be retained in analytics?
- How should sensitive queries be protected?
- How should account deletion remove Search history, embeddings, saved searches, and personalization?
- Should Chronologity publicly document that Search rank does not determine historical significance?

These questions should be resolved before Search infrastructure hardens privacy, ranking, or identity assumptions that are expensive to reverse.

## Architecture Constraints

This document does not prescribe Elasticsearch, OpenSearch, PostgreSQL full-text Search, ClickHouse Search, a vector database, an embedding model, an indexing topology, or a query API.

It does impose architectural constraints.

Search must remain architecturally separate from Feed ordering and Discovery recommendation.

The system should distinguish:

```text
Authoritative historical state
        |
        v
Search projection / index
        |
        v
Authorization-aware candidate retrieval
        |
        v
Query-specific ranking
        |
        v
Result presentation
```

Search indexes are derived state and must be rebuildable.

The architecture must preserve:

```text
visible != searchable != discoverable
```

Authorization and Search eligibility must be enforceable before unauthorized data reaches the User.

Search-derived snippets, autocomplete, facets, counts, embeddings, and caches must participate in privacy invalidation.

Occurrence time, publication time, and indexing time must remain distinct.

Backfilled history must be indexed according to its actual occurrence semantics rather than ingestion time.

Temporal precision and uncertainty must remain representable.

Location indexing must not expose hidden geographic precision.

Stable Chronologity entity identity must remain independent of aliases, names, external search-provider identifiers, or geocoder identifiers.

Semantic embeddings, AI labels, OCR, transcripts, and other inferred metadata---if introduced---must remain distinguishable from authoritative historical assertions.

A retrieval relationship must never automatically create a causal edge, Event association, Person identity, Location assertion, or other authoritative domain relationship.

Search ranking should be versionable or traceable enough to diagnose material relevance changes without modifying authoritative history.

The architecture must support multiple entity types and scoped Search without forcing every historical resource into one identical document model.

Finally, Search must scale with an archive whose value increases as it becomes older and larger. Chronologity must not architect Search around the assumption that only recent history matters.

## Guiding Principle

When deciding whether and where something should appear in Search, ask:

> **Does this result best satisfy what the User explicitly asked to find, using only history they are permitted to retrieve, without pretending that relevance is the same thing as importance or truth?**

Search should help Users locate history.

It should never rewrite it.
