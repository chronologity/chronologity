# Chronologity Locations

## Purpose

This document defines the product semantics of **Locations** in Chronologity.

Location is a fundamental dimension of history. Moments occur not only at a time but often somewhere in the physical world, and real-world Events may be bounded, distributed, moving, or otherwise geographically contextualized.

The central question is:

> **How should Chronologity represent where history occurred without reducing place to a coordinate, inventing false precision, or allowing location data to violate privacy?**

This document defines product behavior and domain semantics rather than geospatial database technology, map providers, geocoding vendors, indexing strategies, or API contracts.

## Definition

A **Location** represents a place or geographic context associated with historical information in Chronologity.

A Location may describe:

- an exact physical point;
- a venue;
- a building;
- a property;
- a street or route;
- a neighborhood;
- a city;
- a region;
- a country;
- a natural feature;
- an approximate area; or
- another meaningful geographic scope.

Conceptually:

```text
Moment
  │
  └── occurred at or within
          │
          ▼
       Location
```

and:

```text
Real-World Event
  │
  └── occurred at, within, or across
          │
          ▼
       Location(s)
```

A Location is historical context.

It is not merely presentation metadata for a map.

## Location Versus Coordinates

Coordinates and Locations are not the same concept.

```text
Coordinates
    =
geospatial measurement

Location
    =
meaningful place or geographic context
```

For example:

```text
40.7505, -73.9934
```

is a coordinate.

```text
Madison Square Garden
```

is a Location.

The Location may be associated with coordinates, boundaries, an address, a city, and other geographic information, but its identity and historical meaning should not depend solely on one latitude/longitude pair.

## Location Identity

A Location should have stable identity independent of its current display name, address formatting, map provider, or coordinates.

For example, a venue may:

- change names;
- change ownership;
- receive a new street address;
- be renovated;
- be demolished; or
- be replaced by another venue on the same site.

Chronologity must not assume:

```text
Same coordinates = Same Location
```

or:

```text
Same name = Same Location
```

Historical place identity may require temporal context.

## Place Versus Site

The same physical site may contain different historically meaningful Locations over time.

For example:

```text
Physical site
  │
  ├── Building A (1900–1975)
  ├── Vacant lot (1975–1985)
  └── Building B (1985–present)
```

A Moment from 1950 should not be described as occurring at Building B merely because Building B now occupies the same coordinates.

Chronologity must preserve the difference between:

- geographic position; and
- historically valid place identity.

## Historical Location Names

Location names may change over time.

Chronologity should be capable of preserving historically appropriate naming without losing the ability to resolve a Location to its present-day identity.

For example:

```text
Historical name
        ↓
Same underlying place
        ↓
Current name
```

The product should not silently rewrite old history to use only the newest place name when doing so would make the historical record misleading.

Likewise, historical names should not prevent Users from finding the place through its current name.

## Location Hierarchy

Locations naturally exist within broader geographic contexts.

Conceptually:

```text
Venue
  ↓
Neighborhood
  ↓
City
  ↓
State / Province / Region
  ↓
Country
```

Chronologity should support hierarchical geographic context where meaningful.

However, the hierarchy must not be assumed to be universally simple or permanent.

Administrative boundaries change.

Places may overlap.

A route may cross many jurisdictions.

A natural feature may not fit neatly inside one administrative hierarchy.

The product should therefore avoid treating one rigid tree as the complete truth about geography.

## Multiple Geographic Contexts

A Location may legitimately participate in multiple geographic relationships.

For example, a park may be:

- inside a city;
- part of a county;
- within a watershed;
- adjacent to a neighborhood;
- within a historic district; and
- part of a larger protected area.

Chronologity does not need to model every possible geographic ontology on day one.

It does need to avoid an architecture that assumes each Location has exactly one meaningful parent forever.

## Location Granularity

Location can be represented at different levels of precision.

For example:

```text
Exact:
Seat 14, Row C, Theater 2

Venue:
Movie theater

Neighborhood:
Midtown

City:
New York City

Region:
New York

Country:
United States
```

The appropriate level depends on:

- what is historically known;
- what the User chooses to provide;
- what media metadata supports;
- what privacy permits; and
- what the product context requires.

Chronologity must not invent a more precise Location than the historical evidence supports.

## Location Precision

Location precision is a first-class semantic concern.

Chronologity should distinguish between:

```text
Exact location
Approximate location
Broad location
Unknown location
```

A User who knows only that a Moment occurred in New York City should not be required to select a fabricated exact coordinate.

Likewise, a device-derived coordinate should not necessarily be exposed at full precision.

The product must preserve both historical uncertainty and privacy-driven reduction of precision.

## Unknown Location

A Moment does not require a known Location to be historically valid.

```text
Known time + unknown place
```

is legitimate history.

Chronologity must support Moments whose Location is:

- unknown;
- intentionally omitted;
- unavailable;
- historically uncertain; or
- hidden from a particular viewer.

The absence of visible Location must not imply that the Moment itself is invalid.

## Approximate Location

Chronologity should support approximate geographic claims.

Examples:

```text
Somewhere in Central Park
Near Syracuse
Northern Italy
Along this hiking trail
```

Approximation may result from:

- incomplete memory;
- old photographs without metadata;
- privacy choices;
- uncertain historical records;
- imported archives; or
- intentionally broad descriptions.

Approximate Location should not be silently converted into exact coordinates.

## Location Provenance

Chronologity should preserve how Location information was established.

Potential sources include:

- explicit User selection;
- device location;
- media metadata;
- imported metadata;
- Event association;
- another User's historical assertion;
- geocoding;
- system inference; or
- AI inference.

Conceptually:

```text
Location assertion
      │
      ├── value
      ├── precision
      ├── source
      └── confidence / status where applicable
```

Not all sources carry the same authority.

## Device Location

Device location can provide useful historical context but is sensitive.

Chronologity should not assume that permission to access device location means permission to publish exact location.

The product should distinguish:

```text
Permission to capture
        ≠
Permission to disclose
```

Device location may be used to suggest a Location while allowing the User to:

- confirm it;
- change it;
- broaden it;
- remove it; or
- keep it private.

## Media Metadata

Images and videos may contain geographic metadata.

Chronologity may use that metadata to suggest or establish historical Location according to product rules.

However:

```text
Embedded GPS metadata
        ≠
Automatically public exact location
```

Imported media may contain sensitive coordinates the User did not realize were present.

Chronologity should therefore treat media-derived Location as potentially sensitive input rather than automatically visible metadata.

## User-Entered Location

Users should be able to provide Location context manually.

Manual entry may be especially important for:

- old media;
- scanned photographs;
- historical archives;
- memories;
- Moments created after the occurrence;
- Locations whose device metadata is absent; and
- correction of inaccurate automated suggestions.

Manual assertions should preserve provenance.

## Location Suggestions

Chronologity may suggest Locations based on:

- device location;
- media metadata;
- occurrence time;
- nearby known places;
- Event association;
- User history;
- text;
- other authorized contextual signals; or
- AI-assisted inference.

A suggestion is not necessarily historical fact.

```text
Suggested Location
        ≠
Confirmed Location
```

Chronologity should avoid silently converting uncertain inference into authoritative historical context.

## AI Location Inference

AI may eventually infer likely Locations from visual or textual evidence.

For example, it may recognize a landmark or venue.

Such inference must remain distinguishable from explicit User assertion or reliable embedded metadata.

AI inference should not create false historical certainty.

Where the inference is uncertain, the product should treat it as a suggestion.

## Moment Location

A Moment may have Location context describing where the experience occurred.

Because a Moment may contain unlimited images and videos, the product must not assume every media item necessarily has identical raw metadata.

The Moment-level historical Location should represent the experience as a whole.

Individual media metadata may provide supporting evidence without automatically fragmenting the Moment into separate Locations.

If the media genuinely represents multiple geographically distinct experiences, that may indicate the User has created a Moment whose historical boundaries should be reconsidered rather than requiring arbitrary per-media Timeline semantics.

## Multiple Locations in a Moment

A Moment may legitimately involve movement or more than one Location.

Examples include:

- a hike;
- a road trip segment;
- a train ride;
- a parade;
- a marathon;
- a flight;
- a walking tour; or
- another continuous experience spanning space.

Chronologity should therefore not make "exactly one point Location per Moment" a foundational invariant.

The initial product may choose a simpler primary-Location presentation while retaining enough domain flexibility for spatially extended Moments.

## Primary Location

Where a Moment involves multiple Locations, Chronologity may use a primary Location for concise presentation.

A primary Location is a display or contextual simplification.

It must not necessarily imply that all media or activity occurred at that one point.

If the User explicitly chooses the primary Location, that provenance should be preserved.

## Routes and Areas

Some historical experiences are better represented as a route or area than a point.

For example:

```text
Hike
  └── trail route

Road trip
  └── route segment

Festival
  └── venue grounds

Wildfire
  └── affected region
```

Chronologity should leave room for geographic geometries beyond points.

The day-one interface does not need a sophisticated geographic editor, but the domain model should not make future route or area representation impossible.

## Event Locations

A real-world Event may have one or many Locations.

Examples:

```text
Concert
  └── one venue

Conference
  └── convention center

Marathon
  └── route

Distributed protest
  └── many sites

Global Event
  └── many cities
```

Event Location and Moment Location are related but not interchangeable.

A Moment associated with an Event may occur at a specific sub-location within the Event's broader geographic context.

## Event Association Does Not Determine Exact Location

Associating a Moment with an Event must not automatically assign the Event's entire Location as the Moment's exact Location.

For example:

```text
Event:
Festival across 50 acres

Moment:
One performance at Stage B
```

The Event provides broad context.

The Moment may have more precise Location information.

Conversely, if the Moment's exact Location is unknown, the Event may provide a reasonable broader Location without inventing precision.

## Location and Event Hierarchy

Child Events may provide increasingly specific geographic context.

For example:

```text
Convention
  └── Convention Center
        │
        └── Panel Event
              └── Room 1A
```

This hierarchy may help resolve Event context, but Chronologity should not require Event hierarchy merely to represent geographic containment.

Location and Event structures remain distinct concepts.

## Location and Timeline

Location does not determine Timeline order.

Moment chronology remains based on occurrence semantics.

```text
Same Location
    ≠
Same time
```

and:

```text
Nearby Locations
    ≠
Adjacent Timeline positions
```

Location provides another dimension through which history can be explored without replacing chronological ordering.

## Spatial Exploration

Chronologity may eventually allow Users to explore history geographically.

For example:

```text
Location
   ↓
Authorized Moments over time
```

or:

```text
Map area
   ↓
Historical Events
   ↓
Moments
```

Spatial exploration should complement the Timeline rather than become a separate truth about historical ordering.

A map view may organize content spatially while each Moment retains its occurrence time.

## Location History

Places themselves have histories.

Chronologity may eventually allow Users to explore:

```text
Location
  │
  ├── Moment — 1980
  ├── Event — 1995
  ├── Moment — 2010
  └── Event — 2026
```

This is a natural extension of Chronologity's historical model.

The Location becomes a scope through which authorized history can be examined.

This does not mean the Location "owns" the Moments.

## Location as Historical Scope

Location may serve as a Historical Scope for evaluating significance.

A Moment can be highly significant to the history of a place without being globally significant.

For example:

```text
First performance at a local theater
```

may matter enormously within that theater's history.

Location-specific significance should therefore be contextual.

## Location and Historical Significance

Location can contribute to historical significance by providing context such as:

- first or last occurrence at a place;
- geographic convergence;
- location-specific causal history;
- transformation of a place;
- unique evidence from a site;
- historical boundaries; or
- association with a significant Event.

But:

```text
Popular Location
    ≠
Historically significant Moment
```

and:

```text
Exact GPS precision
    ≠
Greater historical significance
```

Location is a significance input, not a universal multiplier.

## Location and Temporal Zoom

Temporal zoom may use Location to preserve representative diversity.

For example, when selecting representative Moments from a year containing extensive travel, Chronologity may avoid selecting ten highly significant Moments from one city while ignoring major history elsewhere.

Location can therefore contribute to display salience and redundancy reduction.

It must not replace historical significance or chronology.

## Location and Historical Jumps

Historical jumps may use Location as a navigation dimension.

Potential examples include:

```text
This Moment
   ↓
Earlier Moment at this Location
```

or:

```text
Event at Location X
   ↓
Later historically significant Event at Location X
```

Such navigation must respect authorization and privacy.

A hidden Location must not become discoverable merely because the graph contains related history.

## Location and Feed

The primary Feed remains chronological.

Location must not silently reorder the Feed based on proximity.

Chronologity should not transform the chronological Feed into:

```text
Things near you
```

unless the product introduces an explicitly separate location-based discovery surface.

Location relevance and Feed chronology are different concerns.

## Location and Discovery

Location may be valuable for explicit discovery experiences such as:

- history near a place;
- Events in a city;
- historical Moments at a landmark;
- travel exploration; or
- local historical context.

Discovery must respect privacy and should not imply that precise User location is publicly exposed.

The product should distinguish:

```text
Discover history near a place
```

from:

```text
Reveal where Users currently are
```

Chronologity is a historical platform, not a live people-tracking system.

## Historical Location Versus Current Location

Chronologity must distinguish a Moment's historical Location from a User's current physical location.

```text
Moment occurred at Location X in 2018
        ≠
User is at Location X now
```

Historical Location should never be treated as a live-presence indicator unless Chronologity intentionally introduces a separate real-time capability with its own privacy model.

## No Live Location by Implication

Posting a Moment should not automatically expose a User's live location.

This is particularly important when a Moment is created during or immediately after the experience.

Chronologity may need safeguards such as:

- broader default precision;
- delayed disclosure;
- explicit confirmation;
- privacy-aware visibility; or
- another protection.

The exact day-one treatment should be resolved deliberately.

## Sensitive Locations

Some Locations are intrinsically or contextually sensitive.

Examples may include:

- homes;
- shelters;
- medical facilities;
- schools;
- places associated with minors;
- protected natural sites;
- confidential workplaces; or
- other locations where disclosure could create harm.

Chronologity should support reducing, hiding, or restricting Location precision when necessary.

Historical accuracy does not require exposing dangerous precision to every viewer.

## Home Locations

Residential addresses require particular care.

A Moment occurring at a private residence should not automatically expose the exact address publicly.

Chronologity should prefer privacy-preserving presentation appropriate to the viewer and context.

For example, the system may know an exact coordinate internally while exposing only:

```text
Syracuse, New York
```

or another broader Location to unauthorized viewers.

The precise behavior requires final privacy design.

## Children and Location

Location information involving children can create heightened safety risk.

Chronologity's moderation and privacy systems should be capable of applying stricter treatment where necessary.

This document does not define age-policy details, but the Location model must support privacy reduction rather than assuming one globally visible precision level.

## Location Visibility

Location visibility may differ from Moment visibility.

A viewer may be allowed to see a Moment while receiving only reduced or no Location information.

Conceptually:

```text
Can view Moment
        ≠
Can view exact Location
```

This is a crucial distinction.

Moment authorization establishes whether the content can be seen.

Location authorization or presentation rules may determine what geographic precision is safe to reveal.

## Viewer-Relative Precision

Different viewers may legitimately receive different Location precision for the same Moment.

For example:

```text
Creator:
Exact venue

Close connection:
Neighborhood

Public viewer:
City only
```

Chronologity should therefore avoid storing one pre-rendered Location string as the sole authoritative representation.

Privacy-aware geographic presentation may be viewer-relative.

## Location Privacy Is Derived-Data Privacy

Reducing Location visibility must apply to all derived surfaces.

A hidden exact Location must not leak through:

- maps;
- Event pages;
- search;
- discovery;
- notifications;
- captions;
- metadata downloads;
- media EXIF exposure;
- URLs;
- analytics;
- counts;
- historical jumps; or
- temporal zoom.

Privacy must apply to source and derived geographic information.

## Media Delivery and Metadata

Chronologity should ensure that delivering media does not accidentally expose hidden embedded coordinates.

If original media contains GPS metadata, privacy controls applied at the product layer must not be defeated by downloadable or inspectable metadata unless the User is explicitly authorized to receive it.

Media processing requirements belong primarily in `media.md`, but Location privacy constrains them.

## Location Corrections

Location information may be corrected after a Moment or Event is created.

A correction may change:

- the selected place;
- coordinate;
- geographic precision;
- address;
- historical name;
- Event sub-location; or
- another geographic attribute.

A correction must not change the Moment's occurrence time.

It may affect:

- search;
- discovery;
- Event association;
- historical significance;
- map placement;
- temporal-zoom diversity; or
- historical jumps.

Derived representations should update accordingly.

## Historical Location Corrections

A Location itself may be corrected.

For example, Chronologity may discover that two place records are duplicates or that a historical venue was misidentified.

Such corrections should preserve provenance and avoid silently changing historical meaning.

If two Location records represent the same historical place, Chronologity should eventually support reconciliation.

If one Location record incorrectly combines distinct historical places, the system should support separation.

## Duplicate Locations

Duplicate place records are inevitable.

They may arise from:

- spelling differences;
- abbreviations;
- old and new names;
- multiple languages;
- geocoder differences;
- address changes;
- User-created records; or
- imported data.

Chronologity must not use display-name equality as the only duplicate rule.

Reconciliation should preserve historical aliases and provenance.

## Location Merging

When two records are confirmed to represent the same historical Location, Chronologity should be able to reconcile them without losing historical associations.

A merge should not imply that every historical name, coordinate, address, or boundary was simultaneously valid.

Temporal validity may still matter.

## Location Splitting

A Location record may later prove to represent multiple distinct places.

For example, a generic venue name may have been used for two separate branches.

Chronologity should eventually support correction without rewriting the occurrence time or authorship of associated Moments.

## Renamed Locations

Renaming is not the same as merging.

A place may remain historically the same place while its name changes.

Chronologity should preserve:

```text
Location identity
        +
name valid during historical period
        +
current searchable aliases
```

where practical.

This allows history to remain historically legible while still being discoverable through contemporary terminology.

## Relocated Organizations and Venues

An organization or venue name may move to a new physical site.

Chronologity must not assume that shared naming means shared Location identity.

For example:

```text
Store X at Address A
```

and later:

```text
Store X at Address B
```

may be historically different Locations even though they belong to the same organization.

The product should preserve physical historical context.

## Demolished and Former Locations

A Location does not cease to be historically valid because it no longer exists physically.

Chronologity must support former places.

Examples include:

- demolished buildings;
- closed venues;
- former businesses;
- renamed streets;
- changed borders;
- lost landmarks; and
- natural features that have changed.

Historical Locations should remain navigable as history where authorized.

## Administrative Boundary Changes

Cities, countries, regions, districts, and other boundaries change over time.

Chronologity should not assume that present-day administrative geography is always the correct historical context.

The initial product does not need a complete historical GIS system.

It should, however, preserve enough flexibility to avoid permanently encoding current boundaries as timeless truth.

## Location Search

Users should be able to find Locations through names and relevant geographic context.

Search may eventually consider:

- current names;
- historical names;
- aliases;
- addresses;
- cities;
- regions;
- countries;
- coordinates;
- nearby places; and
- Event context.

Search relevance does not determine historical significance.

Private or restricted Location associations must not leak through search.

## Location Display Names

Chronologity may need concise display labels for Locations.

The label shown may depend on context.

For example:

```text
Madison Square Garden
```

may be sufficient in one view, while another may show:

```text
Madison Square Garden
New York, NY
```

Display formatting is derived presentation.

It must not become Location identity.

## Location and Language

Locations may have names in multiple languages or scripts.

Chronologity should avoid assuming one globally correct display name.

The initial product may use a primary localized label while preserving aliases where available.

Historical naming and localization are related but distinct concerns.

## Location and Accessibility

Location information should not rely exclusively on maps.

Users who cannot perceive or operate a map must still be able to understand relevant geographic context through accessible text and navigation.

Map markers, routes, regions, and spatial relationships should have appropriate nonvisual representations where they are part of the product experience.

## Location and Moderation

Location data can be abused.

Chronologity must be able to address:

- doxxing;
- exposure of private residences;
- stalking;
- false Location associations;
- malicious tagging of sensitive places;
- spam Locations;
- offensive place names entered by Users;
- dangerous disclosure of protected sites; and
- other geographic abuse.

Moderation may remove or reduce visible Location information without changing the historical occurrence time of a Moment.

## Location Disputes

Historical Location may be disputed.

For example, different sources may disagree about where an old photograph was taken.

Chronologity should not require uncertain history to be represented as false certainty.

Future capabilities may allow competing assertions or provenance-aware corrections.

The initial product should at minimum preserve uncertainty and source provenance.

## Location Deletion

Deleting or suppressing a Location record must not automatically delete associated Moments.

If the Location was invalid, Moments may lose or correct that association.

If the Location was merged, associations should resolve to the surviving historical place.

If Location visibility is restricted for privacy, the underlying Moment may remain visible with reduced geographic context.

## Location Counts

Chronologity may eventually show derived information such as the number of Moments or Events associated with a Location.

Viewer-visible counts must not leak restricted history.

A public count should not silently include private Moments in a way that reveals hidden activity.

## Location Scalability

Some Locations may have only one associated Moment.

Others may have millions.

Examples include:

- a private home;
- a famous landmark;
- a stadium;
- a city;
- a country; or
- a major natural feature.

Location-centric views must therefore support:

- pagination;
- temporal filtering;
- Event grouping;
- representative selection;
- authorization-aware aggregation;
- search;
- significance-aware exploration; and
- scalable derived counts.

Adding one Moment must not require synchronously recomputing all history associated with a large Location.

## Location Product Invariants

1.  A Location represents meaningful geographic or place context, not merely a coordinate.
2.  Location identity must be independent of mutable display names, address formatting, map providers, and raw coordinates.
3.  Same coordinates do not necessarily mean the same historical Location.
4.  Same name does not necessarily mean the same Location.
5.  Historically distinct places may occupy the same physical site at different times.
6.  Chronologity should preserve historically appropriate place identity and naming where relevant.
7.  Location hierarchy is useful but must not be modeled as one universally rigid tree.
8.  Location precision must reflect what is historically known and what privacy permits.
9.  Chronologity must support exact, approximate, broad, unknown, and hidden Location states.
10. Chronologity must not invent geographic precision unsupported by evidence.
11. A Moment does not require a known Location to be valid.
12. Approximate Location must not be silently converted into exact Location.
13. Location assertions should preserve provenance.
14. Permission to capture device Location does not imply permission to disclose it.
15. Embedded media coordinates must not automatically become public.
16. Automated or AI Location inference should remain distinguishable from explicit human assertion.
17. A Moment's historical Location describes the experience rather than requiring identical raw metadata across all media.
18. A Moment may legitimately span multiple Locations.
19. The domain model must not assume every Moment is exactly one geographic point.
20. Routes and areas are legitimate geographic forms even if day-one UI support is limited.
21. Real-world Events may span one or many Locations.
22. Event Location must not automatically become a Moment's exact Location.
23. Event structure and Location structure remain distinct concepts.
24. Location does not determine Timeline ordering.
25. Spatial exploration complements rather than replaces chronological history.
26. Locations may themselves serve as historical scopes.
27. Location can inform historical significance without determining it.
28. Popularity of a place does not determine historical significance.
29. Location may inform temporal-zoom diversity and redundancy reduction.
30. Historical jumps using Location must preserve privacy and authorization.
31. Location must not silently reorder the primary chronological Feed.
32. Historical Location is distinct from a User's current live Location.
33. Posting historical content must not automatically expose live presence.
34. Sensitive Locations must support reduced or hidden precision.
35. Ability to view a Moment does not inherently grant access to its exact Location.
36. Different viewers may legitimately receive different Location precision for the same Moment.
37. Location privacy must propagate to maps, search, discovery, notifications, metadata, historical jumps, temporal zoom, and other derived surfaces.
38. Media delivery must not defeat Location privacy through embedded metadata.
39. Location corrections must not change Moment occurrence time.
40. Location corrections may require derived representations and significance to be recomputed.
41. Duplicate Locations must be reconcilable without relying solely on name equality.
42. Location merging must preserve historically valid aliases and temporal context.
43. Renaming a place is distinct from merging two Locations.
44. Organizations or venues moving between sites must not cause those physical Locations to collapse into one.
45. Demolished, closed, renamed, or former Locations remain valid historical places.
46. Current administrative boundaries must not be assumed to be timeless historical truth.
47. Location search must respect privacy and authorization.
48. Display labels are presentation, not Location identity.
49. Location experiences must remain accessible without requiring map interaction.
50. Location data is subject to moderation and safety controls.
51. Location suppression or deletion must not automatically delete associated Moments.
52. Viewer-visible Location aggregates must not leak restricted history.
53. Location-centric experiences must scale from one associated Moment to millions.

## Day-One Location Requirements

Before launch, Chronologity must have explicit product behavior for:

- Moment Location association;
- Event Location association;
- exact versus approximate Location;
- unknown Location;
- manual Location entry;
- device-derived Location;
- media-metadata-derived Location;
- Location suggestions;
- Location provenance;
- Location correction;
- Location removal;
- Location visibility;
- viewer-relative Location precision where required;
- sensitive Location treatment;
- prevention of accidental live-location disclosure;
- prevention of embedded media metadata bypassing privacy;
- Location search sufficient for Moment and Event creation;
- stable Location identity;
- historical and current Location names where needed;
- duplicate Location handling;
- former or closed Locations;
- one-to-many Event Location semantics;
- Moments that span more than one Location, even if represented simply in the initial UI;
- Location behavior in temporal zoom;
- Location behavior in historical jumps;
- authorization-aware Location-derived surfaces;
- accessible non-map Location presentation; and
- moderation of abusive or dangerous Location disclosure.

Because temporal zoom and historical jumps are day-one features, Location must be available as a contextual and diversity signal from the beginning. Chronologity does not need a complete historical geographic information system before launch, but it must avoid architectural assumptions that would make historically correct place semantics impossible later.

The initial release does not require:

- a full historical GIS;
- arbitrary polygon editing;
- sophisticated route editors;
- live friend maps;
- continuous background location sharing;
- real-time User tracking;
- complete historical administrative-boundary reconstruction;
- exhaustive multilingual place-name support;
- public exact-address disclosure;
- automatic AI establishment of uncertain Locations;
- a universal Location hierarchy;
- advanced Location-based social recommendations; or
- perfect duplicate-place reconciliation.

## Established Location Decisions

These were open questions. Implementation settled them, and they are requirements now rather than possibilities.

**A Location's identity is a Chronologity identifier and nothing else.** Not its name, not its coordinates, and not any provider's reference (ADR-090). Two places at the same coordinates are not thereby the same place, and the same ground holds different places over time.

**OpenStreetMap is the initial place provider** (ADR-090). What comes back from it are candidates, not Locations: a Location exists only once somebody chooses one, and it is created carrying an identifier of ours.

**A provider reference is recorded as provenance, never as identity.** It is stored in `source_reference` and is what makes two people choosing the same search result reach one place. Because identity is separate, a rename by the provider cannot rewrite what a place was called when someone recorded it.

**A Location may be created that no provider has heard of.** The provider reference is optional, so a name typed by hand is a first-class place rather than a degraded one.

**How a place came to be known is recorded and returned.** `source` distinguishes a place someone searched for and chose, one a device reported, and one read out of a photograph's metadata. The distinction cannot be recovered once lost, and the three are not equally strong claims.

## Open Product Questions

The following questions require deliberate resolution:

- Is Location optional for every Moment?
- What Location precision options should Users see explicitly?
- Should the product use labels such as exact, approximate, city-level, and hidden?
- If so, how is free-form historical text later reconciled with stable Location identity?
- Should day-one Moments support multiple explicit Locations?
- If not, how should routes and moving experiences be represented without corrupting the domain model?
- Should a primary Location be required when multiple Locations exist?
- Can individual media items expose different supporting Location metadata within one Moment?
- Should Users be able to inspect per-media metadata without turning it into separate Moment chronology?
- Should device-derived Location require explicit confirmation before becoming historical metadata?
- Should media GPS metadata require explicit confirmation?
- Should Chronologity strip GPS metadata from all delivered media by default?
- Should original files retain metadata in private storage?
- Can Users download their own original media with original metadata intact?
- How should Location behave when a User creates a Moment while still physically present at the place?
- Should public exact Location disclosure be delayed for newly created Moments?
- Should certain sensitive categories automatically reduce precision?
- How should Chronologity identify a private residence?
- Should residential addresses ever be publicly displayable by explicit User choice?
- What protections apply to Locations involving minors?
- Should Users be able to set default Location precision by audience?
- Can a Moment be public while its Location is completely private?
- Can Location visibility be changed after publication?
- If Location becomes more restrictive, how quickly must derived surfaces remove the old precision?
- Should Location visibility inherit from Moment privacy by default, or have independent defaults?
- What viewer groups, if any, should receive different Location precision?
- Should the Moment creator always see the highest known precision?
- How should shared Moments work when participants have different Location privacy preferences?
- Can another participant propose a Location correction?
- Who may confirm a Location correction?
- How should disputed Location claims be represented?
- Should Chronologity preserve the original Location assertion after correction?
- How should provider changes or provider disagreements be handled?
- How should private or personal places be named?
- Should a private home become a reusable Location entity?
- How should unnamed natural Locations be represented?
- Should coordinates be stored for every Location where available?
- What precision should stored coordinates use?
- How should uncertainty in coordinates be represented?
- Do Locations need validity intervals for historical names, addresses, and place identity on day one?
- How should renamed streets be displayed for old Moments?
- Should Users see the historical name, current name, or both?
- How should demolished buildings appear in search?
- How should a venue that moves to a new address be modeled?
- How should chains with many branches be distinguished?
- What duplicate-detection signals are sufficient to suggest a Location merge?
- Who may approve Location merges?
- How should incorrect Location merges be reversed?
- Can one Location belong to multiple geographic hierarchies?
- Which geographic hierarchy should the UI display by default?
- How should administrative-boundary changes be handled initially?
- Should Location pages exist on day one?
- If Location pages exist, what history should they show by default?
- Should Location-centric history be strictly chronological?
- How should representative Moments be selected for Locations with millions of Moments?
- Should real-world Events be shown before individual Moments on broad Location views?
- How should Location contribute to historical-significance calculations?
- How strongly should Location diversity affect temporal-zoom representative selection?
- Should historical jumps include "earlier at this place" and "later at this place" from day one?
- How broad must a Location match be for such jumps?
- Should search support "Moments near this Location" on day one?
- Should discovery support "history near me"?
- If so, how do we ensure the feature does not become live User tracking?
- Should Users be able to disable all use of current device Location while still entering historical Locations manually?
- Should Chronologity retain device Location after it has been converted into a confirmed broader Location?
- How should location-based analytics avoid exposing sensitive individual history?
- What Location information may appear in notifications?
- Should notification previews ever include exact place names?
- What Location information is included in User data exports?
- How should deletion requests affect raw device coordinates, geocoding records, and derived Location projections?
- Should AI landmark recognition be considered for day one or deferred?
- How should AI Location suggestions communicate uncertainty?
- Can Event association provide a default Location suggestion for a Moment?
- Can Moment Locations contribute to Event Location inference?
- How should conflicting Moment Locations affect Event geography?
- When should an Event be represented as a point, set of points, route, or region?
- What geographic capabilities are necessary to support hiking, travel, races, marches, and other moving experiences well?
- Which of those capabilities must be present on day one versus merely supported by the domain model?

These questions should be resolved before implementation choices accidentally equate historical place with a geocoder result or expose sensitive location information through derived product surfaces.

## Architecture Constraints

This document does not prescribe a geospatial database, map SDK, geocoder, search provider, coordinate system, Location aggregate, or API.

It does impose architectural constraints.

Chronologity must distinguish:

```text
Location identity
        ≠
display name
        ≠
address
        ≠
coordinate
        ≠
external provider identifier
```

Stable internal Location identity should survive changes to display names, providers, addresses, and other mutable metadata.

The model must support geographic precision and uncertainty explicitly enough that broad or approximate history is not stored as false exactness.

Location provenance must be retained where the source of a geographic assertion matters.

The architecture must allow Moment and Event Location relationships to be corrected independently of occurrence time.

It must not assume exactly one point Location for every Moment or Event, even if the first user interface simplifies presentation around a primary place.

The system should remain extensible to:

```text
points
areas
routes
multiple Locations
historical names
former places
temporal place metadata
```

without requiring Moment identity or Timeline semantics to change.

External geocoding or map-provider identifiers must not become the sole authoritative identity of Chronologity Locations.

Authorization and privacy must be enforceable at geographic precision, not only at the whole-Moment level.

Derived surfaces must therefore be capable of receiving viewer-appropriate Location representations.

Location privacy changes must invalidate or update relevant:

- search indexes;
- discovery projections;
- Event views;
- maps;
- notifications;
- historical jumps;
- temporal-zoom representations;
- cached metadata; and
- media-delivery behavior.

Media processing must be capable of preventing embedded geographic metadata from bypassing application-level privacy.

Location-centric projections should scale independently of authoritative Moment writes and should support temporal filtering and pagination.

Finally, Chronologity should keep historical Location separate from real-time User presence. Nothing in the Location architecture should require continuous tracking or live-location sharing for the historical product to function.

## Guiding Principle

When deciding how Chronologity should represent place, ask:

> **What geographic context is historically justified, meaningful to the experience, and safe for this viewer to know?**

Chronologity should preserve where history happened without pretending to know more than the evidence supports and without turning historical place into live surveillance.
