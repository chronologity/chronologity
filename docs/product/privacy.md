# Chronologity Privacy

## Purpose

This document defines the product principles, semantics, boundaries, and invariants governing privacy in Chronologity.

Chronologity is designed to preserve and navigate personal and shared history. That makes privacy a foundational product concern rather than a settings page added after the core experience is built.

A Moment may contain images, videos, descriptions, occurrence times, locations, people, relationships, comments, reactions, and other contextual information. Some of that information may be deeply personal even when the media itself appears ordinary.

The central privacy question is:

> **Who should be able to know what, about whom, in which historical context?**

This document defines product semantics rather than prescribing encryption schemes, database policies, authorization middleware, retention jobs, or regulatory implementation details.

## Core Principle

Chronologity should collect, expose, retain, and infer only the information necessary to provide the product behavior the user reasonably expects.

Privacy should not depend on users understanding the internal architecture.

A user should be able to reason about access in product terms:

```text
Who can see this?
What can they see?
Why can they see it?
Can I change that?
What happens if I remove it?
```

The answers should remain understandable even as Chronologity's underlying systems become complex.

## Privacy Is Not One Boolean

Chronologity must not reduce privacy to a single `isPrivate` flag.

A historical record may contain multiple independently sensitive dimensions:

```text
Moment
 ├── Media
 ├── Description
 ├── Occurrence Time
 ├── Location
 ├── People
 ├── Relationships
 ├── Comments
 └── Reactions
```

The eventual product may allow some of these dimensions to have different visibility or precision.

For example, a user may reasonably want to share a Moment while withholding its precise location.

```text
Moment visible
Location hidden
```

That is different from making the entire Moment private.

## Privacy and Visibility

**Visibility** describes who may access or discover product information.

**Privacy** is broader. It includes visibility, data minimization, location precision, participation and consent, inference, retention, deletion, export, and the handling of sensitive historical context.

```text
Visibility ⊂ Privacy
```

A technically private resource can still create privacy problems if Chronologity collects unnecessary information, retains it indefinitely, exposes it through inference, or uses it in ways the user did not reasonably expect.

## Default Privacy

Chronologity should use conservative defaults where disclosure could expose personal history unexpectedly.

**A Moment is public unless its author says otherwise** (ADR-108). This was decided rather than inherited from whatever the schema happened to hold, and the recording flow accepts a visibility so that choosing privacy does not mean publishing first and correcting after.

Nothing recorded before that default existed was changed by it. Those Moments were recorded under a promise that they were private, and a changed default is not consent.

Whatever default is chosen, the creation experience should make the resulting audience understandable.

The product should avoid patterns where users believe they are privately recording history while actually publishing it broadly.

## Moment Visibility

A Moment's visibility determines who may access it through ordinary Chronologity product experiences.

Potential visibility models may include:

- private;
- restricted to explicitly permitted people or groups;
- broadly visible or public.

The final vocabulary and access model should remain as simple as possible.

**The vocabulary is settled**: `private`, `restricted`, and `public`. A restricted Moment carries its own list of people rather than pointing at a reusable group, because editing a shared group would silently change the audience of every Moment already using it.

There is deliberately no value meaning "my followers". `social-graph.md` requires that a Follow never override privacy, and a followers audience would quietly make following and being entitled to see the same thing.

A Block hides two people from each other in both directions, including from each other's public Moments.

Chronologity should not reproduce a complicated matrix of social-network privacy controls unless actual user needs justify it.

## Visibility and Chronology

Visibility must not affect historical position.

```text
Private → Public
```

does not mean:

```text
Old Moment → New Moment
```

A Moment becoming visible later remains positioned according to when the represented experience occurred.

Likewise, making a Moment private does not change its occurrence time.

## Visibility and Context

A Moment may participate in contextual groupings such as a location or real-world Event.

Context must not override the Moment's access rules.

```text
Public Event Context
        +
Private Moment
        ≠
Public Moment
```

A public contextual grouping must not automatically expose otherwise inaccessible Moments.

Derived contexts should include only information the viewer is authorized to access.

## Visibility and Causality

Relationships between Moments can reveal information even when the individual Moments appear harmless in isolation.

For example:

```text
Moment A ──led to──► Moment B
```

may disclose a personal narrative the user did not intend to make public.

Relationship visibility therefore requires explicit consideration rather than being assumed to equal the visibility of either endpoint.

At minimum, Chronologity must never use a visible relationship to reveal an inaccessible Moment.

## Unlimited Media Within a Moment

A Moment may contain an **unlimited number of images and videos at the product-model level**.

```text
Moment
 ├── Image
 ├── Image
 ├── Video
 ├── Image
 ├── Video
 ├── ...
 └── No product-level media-count limit
```

This is a deliberate product decision.

Chronologity must not define the identity of a Moment according to an arbitrary media-count limit. If many media assets represent one coherent experience, the product model should allow them to remain one Moment.

Infrastructure may impose practical constraints such as individual file-size limits, video-duration limits, supported formats, upload concurrency, processing capacity, storage quotas, abuse protections, or fair-use controls. Those constraints are distinct from the semantic question of how many media assets constitute one Moment.

The existing **90-second maximum applies to an individual video**, not to the number of videos a Moment may contain.

## Media Privacy

Media can expose information beyond what a user explicitly enters.

Images and videos may reveal:

- faces;
- homes;
- workplaces;
- schools;
- vehicle information;
- documents;
- screens;
- bystanders;
- timestamps;
- location clues;
- audio conversations; and
- other contextual details.

Chronologity should not assume that stripping structured metadata eliminates all privacy risk from media.

The product should avoid presenting automated media analysis as harmless merely because the original file is not shared directly.

## Media Metadata

Uploaded files may contain embedded metadata such as timestamps, device information, or geolocation.

Chronologity should collect and retain only metadata required for legitimate product behavior.

Metadata useful during ingestion does not automatically need to become permanent historical data.

If Chronologity extracts information from media to assist Moment creation, the product should distinguish:

```text
Detected information
        ↓
User confirms
        ↓
Historical metadata
```

from:

```text
Detected information
        ↓
Silently becomes historical fact
```

The latter should be avoided where the information is uncertain or privacy-sensitive.

## Location Privacy

Location deserves special treatment because historical location can reveal patterns about a person's life.

A Moment may have:

- no location;
- an approximate location;
- a named place;
- a city or region;
- a precise geographic position; or
- another product-defined level of location context.

Chronologity should not require greater location precision than the product experience needs.

### Location Precision

The system should preserve the distinction between knowing that an event occurred:

```text
New York City
```

and knowing that it occurred at:

```text
Exact latitude and longitude
```

The product should not expose greater precision than the user intended merely because the underlying device supplied it.

### Location Capture

Device location should not automatically become Moment location without a clear product reason and appropriate user understanding.

The location where a media file was uploaded is also not necessarily the location where the represented event occurred.

```text
Upload location ≠ Occurrence location
```

### Location and Horizontal Context

Because location may drive horizontal Timeline navigation, privacy enforcement must happen before location-based contextual results are presented.

Chronologity must not leak the existence of inaccessible Moments through map markers, counts, empty placeholders, context labels, or other derived indicators.

## People in Moments

A Moment may involve people other than its creator.

Chronologity should distinguish relationships such as:

- creator;
- depicted person;
- participant;
- tagged person;
- contributor; and
- viewer.

These roles are not interchangeable.

Being visible in media does not automatically make someone a contributor or grant them control over the Moment. Likewise, being tagged should not automatically imply consent to every possible use of the Moment.

## Tagging and Consent

Tagging can connect another person's identity to a historical event.

That can reveal:

- where they were;
- who they were with;
- what they were doing;
- when an event occurred; or
- relationships they may not wish to expose.

Chronologity should therefore treat tagging as a privacy-sensitive action.

The exact consent model remains an open product decision, but the architecture should not assume that one user's decision to identify another person is sufficient to make that association universally visible.

## Bystanders

Images and videos may contain people who are neither Chronologity users nor intentional participants in the Moment.

The product should not assume it has a meaningful identity relationship with every person appearing in media.

Future face recognition or automated identity matching would introduce substantial privacy implications and should not be treated as a default extension of media processing.

## Facial Recognition

Chronologity should **not require facial recognition** for the core product.

If identity-recognition capabilities are ever considered, they should require a separate product, privacy, legal, and security decision.

A technically convenient ability to recognize faces does not establish that Chronologity should do so.

## Biometric Data

Chronologity should avoid creating biometric identity systems unless a future capability has a compelling user benefit that cannot reasonably be achieved through less sensitive means.

This is an area where product restraint is preferable to speculative capability.

## Historical Sensitivity

Information can become sensitive because of its historical context.

A photograph that appears ordinary may become revealing when combined with:

- a precise date;
- a location;
- another person's identity;
- a causal relationship;
- a real-world Event; or
- surrounding Moments.

Privacy decisions must therefore consider **combinations of information**, not only individual fields.

```text
Low-sensitivity field
        +
Low-sensitivity field
        +
Low-sensitivity field
        =
Potentially sensitive history
```

## Temporal Inference

Chronologity's chronological structure can reveal patterns even when individual Moments are access-controlled correctly.

For example, a sequence may imply:

- residence changes;
- employment changes;
- recurring routines;
- travel patterns;
- relationships;
- periods of absence; or
- participation in particular events.

The product should avoid exposing aggregate or derived temporal patterns more broadly than the underlying information permits.

## Contextual Inference

Automatically derived contextual groupings create similar risks.

A system must not reveal that:

> Three private Moments belong to this Event.

if the viewer cannot access those Moments.

Counts, rankings, summaries, relationship edges, and contextual labels can all leak information.

Authorization therefore applies not only to raw records but also to projections and aggregates.

## Search Privacy

Search must respect the same access boundaries as direct navigation.

An inaccessible Moment should not become discoverable through:

- title or description matches;
- location searches;
- people searches;
- Event searches;
- autocomplete;
- snippets;
- counts; or
- semantic search.

Search indexes and search projections are not exempt from privacy rules because they are derived data.

## Discovery Privacy

Recommendation and discovery systems must not surface inaccessible Moments or reveal their existence indirectly.

A recommendation algorithm should operate over the set of information the viewer is permitted to discover.

```text
Eligible for ranking
        ↓
Authorized and discoverable
        ↓
Recommendation
```

Authorization should not be applied only after ranking if the ranking process itself can expose private information through scores, counts, or explanations.

## Notification Privacy

Notifications may expose sensitive historical information on lock screens, shared devices, email, or other external surfaces.

Chronologity should minimize sensitive content in notification previews by default where appropriate.

A notification should also respect current authorization. If access to a Moment has been revoked, an old notification should not remain a bypass into that Moment.

## Deep-Link Privacy

Deep links do not override authorization.

A user possessing a Moment URL or identifier should not gain access merely because they know the identifier.

```text
Knowledge of identifier ≠ Authorization
```

Deep links should resolve according to the viewer's current permissions.

## Comments and Reactions

Comments and reactions have their own privacy implications.

A viewer should not necessarily be able to discover a private Moment merely because someone they follow reacted to it.

Likewise, activity counts should not leak hidden participation.

The eventual product should define whether comments and reactions inherit Moment visibility, have additional restrictions, or follow another deliberately designed model.

The simplest safe model should be preferred initially.

## Activity Privacy

Chronologity should distinguish:

```text
Historical occurrence
```

from:

```text
Recent activity around history
```

A user's comments, reactions, edits, or relationship changes may reveal what old history they are currently viewing or engaging with.

Chronologity should not automatically broadcast that activity unless the product explicitly defines such behavior and users can reasonably understand it.

## Draft Privacy

Drafts are not committed Moments.

Draft content should be treated as private to the creator and any explicitly supported collaborators unless the product deliberately introduces another model.

Partially uploaded or processed media should not become discoverable merely because backend processing has begun.

## Upload Privacy

Upload endpoints, temporary object locations, processing queues, transcoding outputs, thumbnails, and intermediate representations must not become accidental public surfaces.

This is primarily an architectural and security requirement, but the product invariant is simple:

> Uploading media does not publish it.

## Processing Privacy

Media processing may require Chronologity systems or approved infrastructure to access uploaded content.

The product should minimize processing to what is required for expected functionality.

If future processing introduces materially new analysis, such as identifying objects, extracting text, recognizing faces, inferring events, or generating semantic embeddings, that should be treated as a product and privacy decision rather than merely an implementation optimization.

## AI Privacy

AI features should follow the same privacy boundaries as the rest of Chronologity.

An AI system should not receive broader access to a user's historical data merely because it is an internal product feature.

AI-generated summaries, relationship suggestions, search results, or contextual groupings must not reveal information the requesting user could not otherwise access.

AI should also avoid converting uncertain inference into stored historical fact without appropriate user confirmation.

## Privacy and Temporal Zoom

Temporal zoom is a day-one Timeline feature.

At broader zoom levels, Chronologity may aggregate or summarize history. Those representations must preserve access boundaries.

For example, a year-level view must not reveal:

```text
12 Moments in June
```

if the viewer is not authorized to know those Moments exist.

The privacy model must therefore apply at every temporal scale.

```text
Moment level
Month level
Year level
Decade level
Life level
```

Zooming out must not become a privacy bypass.

## Privacy and Historical Jumps

Historical jumps are also a day-one Timeline feature.

A user may navigate directly to a year, month, date, Moment, search result, landmark, or other supported historical target.

A jump target must be resolved within the viewer's authorized history.

Chronologity should not reveal inaccessible Moments merely because they are near the requested temporal position.

Historical navigation should distinguish:

```text
No accessible Moment here
```

from any internal knowledge that inaccessible Moments exist.

## Privacy and Relationship Traversal

Following causal or semantic relationships may move a user to another historical position.

Relationship traversal must not bypass the access rules of the destination Moment.

If the destination is inaccessible, Chronologity should not expose private information through the relationship label, destination preview, timestamp, or other metadata unless explicitly permitted.

## Shared History

Chronologity's long-term potential includes shared history: multiple people may have Moments associated with the same Event, place, or experience.

Shared context does not erase individual privacy.

```text
Shared Event
    ├── User A's Moment
    ├── User B's Moment
    └── User C's Moment
```

Each Moment may have different access rules.

A viewer's representation of the shared Event should be constructed from the subset of information they are authorized to access.

## Ownership and Control

The creator or appropriate rights holder should have meaningful control over the Moment they created, subject to legitimate product, legal, safety, and shared-content constraints.

However, "ownership" should not be used as a shortcut for every privacy question.

A Moment may contain:

- another person's image;
- another person's comment;
- jointly created media;
- information about a shared Event; or
- relationships asserted by multiple people.

Control over the Moment container does not automatically establish unrestricted rights over every piece of information associated with it.

## Editing Privacy Settings

Users should be able to change applicable visibility and privacy settings without changing the historical occurrence of a Moment.

Changes should take effect consistently across:

- Timeline navigation;
- contextual groupings;
- search;
- discovery;
- notifications;
- deep links;
- relationship traversal; and
- derived read models.

Privacy changes should not require users to understand which backend projection currently contains their data.

## Revocation

When access is revoked, Chronologity should stop granting future ordinary access through product surfaces as promptly as reasonably possible.

Caches, indexes, projections, and generated representations should not create long-lived authorization inconsistencies.

The exact consistency guarantees belong in architecture documentation, but privacy-sensitive revocation should be designed intentionally.

## Deletion

Users must be able to remove content where product, privacy, safety, or legal requirements demand it.

Chronologity should distinguish between concepts that may have different technical and legal meanings:

- removing content from ordinary product access;
- deleting media;
- deleting a Moment;
- deleting derived representations;
- deleting account-associated information;
- retaining narrowly required security or legal records; and
- permanent erasure where applicable.

The user-facing model should be understandable even if backend deletion occurs across multiple systems.

## Deletion and Append-Only Storage

Chronologity's architecture uses append-only storage in places, currently the transactional outbox and Kafka topics.

Append-only storage does not override privacy requirements.

The architecture must not interpret "events are immutable" as "personal data can never be removed."

Where deletion or erasure obligations conflict with immutable historical storage, the architecture must use patterns that preserve system integrity without retaining prohibited personal content in accessible form.

The product requirement takes precedence over architectural purity.

## Deletion of Media

Deleting a media asset should remove it from ordinary access and from future derived media delivery according to the product's deletion semantics.

Thumbnails, transcodes, cached variants, and other derived media must be considered part of the deletion lifecycle.

A product cannot truthfully claim that a video was deleted while continuing to serve a transcoded copy.

## Deletion of a Moment

Deleting a Moment may affect:

- media;
- descriptions;
- comments;
- reactions;
- contextual groupings;
- search indexes;
- discovery indexes;
- causal relationships;
- notifications;
- deep links; and
- temporal aggregates.

The precise behavior of each dependent record should be defined before implementation.

Deleting a Moment should not silently delete unrelated Moments merely because they shared context.

## Account Deletion

Account deletion requires its own explicit lifecycle.

Chronologity must eventually define what happens to:

- Moments created by the user;
- media;
- comments;
- reactions;
- relationships;
- shared Event participation;
- tags involving other users;
- notifications;
- security records; and
- derived data.

This should be specified before launch rather than delegated to ad hoc cleanup code.

## Retention

Chronologity should retain personal information only as long as necessary for legitimate product, safety, security, legal, or user-directed historical purposes.

Different categories of data may require different retention periods.

For example, committed Moments and temporary failed-upload artifacts should not automatically have the same retention semantics.

## Data Export

Users should eventually be able to obtain a meaningful export of their Chronologity data.

An export should preserve enough context to remain useful outside the application, including occurrence semantics and relationships where appropriate.

The exact export formats and day-one scope remain product decisions.

Exportability reinforces the principle that Chronologity is preserving a user's history rather than trapping it inside an interface.

## Data Portability and Media

Because a Moment may contain an unlimited number of images and videos, export and portability mechanisms must be designed for potentially large histories.

This is not a reason to impose an arbitrary media-count limit on Moments.

Large exports may require asynchronous preparation, chunking, manifests, or other architecture mechanisms.

## Security and Privacy

Security and privacy overlap but are not identical.

Security asks whether unauthorized parties can access data.

Privacy additionally asks whether Chronologity should collect, use, infer, retain, or expose that data in the first place.

```text
Securely stored unnecessary data
        =
Still a privacy problem
```

Both disciplines are required.

## Internal Access

Chronologity should apply least-privilege principles to internal access.

Employees, contractors, operators, and automated systems should not receive unrestricted access to user history merely because the information resides within Chronologity infrastructure.

Administrative access should be purposeful, limited, and auditable according to the eventual security architecture.

## Logging

Logs, traces, metrics, analytics, crash reports, and debugging systems must not become shadow databases of personal history.

Chronologity should avoid unnecessarily recording:

- raw media URLs;
- descriptions;
- precise locations;
- private Moment content;
- access tokens;
- sensitive relationship information; or
- other personal data.

Observability should diagnose systems without casually duplicating user history.

## Analytics

Product analytics should collect the minimum information necessary to understand product behavior.

Chronologity should prefer aggregate or privacy-preserving measurements where individual historical content is unnecessary.

The desire to measure engagement does not justify copying the semantic content of users' Moments into analytics systems.

## Advertising and Data Brokerage

Chronologity should not build its core business model around selling users' personal historical data or turning intimate life records into behavioral dossiers for third parties.

A product whose value depends on users trusting it with years or decades of history should treat that trust as strategic infrastructure.

Any future advertising model would require separate scrutiny regarding whether it is compatible with that principle.

## Privacy Invariants

1.  Privacy is a foundational product property, not an implementation afterthought.
2.  Privacy must not be reduced to a single boolean.
3.  Visibility affects access, not historical occurrence.
4.  Public context must not expose private Moments.
5.  Derived groupings, counts, summaries, search indexes, and recommendations must respect access boundaries.
6.  A Moment may contain an unlimited number of images and videos at the product-model level.
7.  The 90-second video limit applies per individual video and does not limit the number of videos in a Moment.
8.  Infrastructure constraints must not be confused with the semantic definition of a Moment.
9.  Chronologity should not expose greater location precision than the user intended.
10. Upload location and occurrence location are different concepts.
11. Tagging another person is privacy-sensitive and must not automatically imply universal consent.
12. Chronologity should not require facial recognition or biometric identity systems for its core product.
13. Combinations of otherwise ordinary historical data may become sensitive.
14. Search, discovery, notifications, deep links, and relationship traversal must not bypass authorization.
15. Drafts and incomplete uploads are not published Moments.
16. AI systems must operate within the same privacy boundaries as ordinary product features.
17. AI inference must not silently become stored historical fact where confirmation is appropriate.
18. Temporal zoom must preserve privacy at every temporal scale.
19. Historical jumps must resolve only within information the viewer is authorized to access.
20. Shared history does not erase individual Moment privacy.
21. Privacy-setting changes must propagate consistently across derived product surfaces.
22. Append-only storage does not override deletion or erasure requirements.
23. Deleting media must account for derived copies such as thumbnails and transcodes.
24. Logs and analytics must not become uncontrolled copies of personal history.
25. Security does not eliminate the need for data minimization.
26. Internal access should follow least privilege.
27. The product should not depend on selling users' personal historical data.

## Day-One Privacy Requirements

Before Chronologity launches, the product and architecture must have explicit answers for at least the following:

- the default Moment visibility — public unless its author says otherwise (ADR-108);
- the initial visibility modes — `private`, `restricted`, and `public`;
- authorization for Timeline reads;
- authorization for horizontal contextual groupings;
- privacy behavior at every day-one temporal zoom level;
- privacy behavior for historical jumps;
- location capture and location visibility;
- media access;
- draft and upload access;
- comments and reactions;
- search eligibility;
- deep-link authorization;
- notification preview behavior;
- deletion of Moments and media;
- account deletion;
- propagation of privacy changes to projections and caches;
- observability data minimization; and
- internal administrative access.

These are launch requirements, not post-launch hardening tasks.

## Open Product Questions

The following questions should be resolved deliberately:

- Should visibility be configurable per Moment only, or can users establish defaults? A per-account default would change what happens when somebody says nothing, which is exactly the decision the public default settles for everybody. Worth deciding on evidence about how people actually record rather than in advance.
- Can media, description, location, and other Moment dimensions have different visibility?
- If so, which dimensions justify that complexity initially?
- What location precision options should users have?
- Should Chronologity retain exact coordinates when only a named place is displayed?
- When should device or media location metadata be offered during Moment creation?
- What is the consent model for tagging another user?
- Can tagged users remove their identity association from another user's Moment?
- Can users request removal or obscuring of themselves from media?
- What privacy model applies to comments and reactions?
- Can users see who viewed a Moment?
- Should view history exist at all?
- How should relationship visibility compose when connected Moments have different visibility?
- How should shared Event contexts represent private participation?
- What information, if any, should appear when a historical jump lands in a period containing only inaccessible Moments?
- Which temporal aggregates are safe to expose at broader zoom levels?
- What data export capabilities belong in the initial release?
- What are the precise deletion semantics for a Moment?
- What happens to comments authored by other users when a Moment is deleted?
- What happens to relationships when one endpoint is deleted?
- What happens to shared-history participation when an account is deleted?
- Which data categories require retention for security or legal reasons?
- Should Chronologity ever use facial recognition?
- Which future AI processing capabilities require separate opt-in?
- What analytics are truly necessary to improve the product?
- What business models are compatible with users entrusting Chronologity with decades of personal history?

These questions should be answered before implementation assumptions make the privacy model difficult to change.

## Relationship to `moments.md`

`moments.md` defines what a Moment represents and how it participates in history.

This document defines privacy constraints around the information contained in and associated with a Moment.

The product-level media-count decision is definitive:

```text
Number of images per Moment: unlimited
Number of videos per Moment: unlimited
Maximum duration per individual video: 90 seconds
```

"Unlimited" describes the semantic model. It does not prohibit infrastructure protections against abuse or operational limits on individual files and requests.

## Relationship to `timelines.md`

`timelines.md` defines the derived chronological structure of Moments.

A Timeline must always be constructed from the set of Moments and contextual information the viewer is permitted to access.

There is no privacy exemption for derived chronology.

## Relationship to `timeline.md`

`timeline.md` defines vertical chronology, horizontal context, Moment depth, temporal zoom, and historical jumps.

Every navigation dimension must preserve privacy.

```text
Vertical navigation → authorized history
Horizontal context  → authorized context
Depth               → authorized Moment data
Temporal zoom       → authorized aggregates
Historical jump     → authorized destination
```

Navigation convenience must never become an authorization bypass.

## Relationship to `causality.md`

`causality.md` defines semantic and causal relationships between Moments.

Relationship provenance, endpoints, labels, and traversal can themselves expose personal history.

Relationship privacy must therefore be evaluated independently rather than assumed from chronological visibility.

## Relationship to Architecture

This document does not prescribe a specific authorization framework, encryption technology, identity provider, key-management system, deletion mechanism, or regulatory architecture.

However, privacy requirements constrain the architecture from the beginning.

The architecture must support:

- authorization before returning Moment data;
- authorization-aware Timeline projections;
- authorization-aware horizontal contexts;
- privacy-preserving temporal aggregates for zoom;
- privacy-preserving historical jumps;
- private media storage and controlled delivery;
- deletion across source data and derived representations;
- revocation across caches and projections;
- data minimization in events, logs, analytics, and integrations;
- provenance for privacy-sensitive associations where required; and
- scalable handling of Moments containing potentially large numbers of media assets.

Kafka, ClickHouse, PostgreSQL, object storage, search systems, caches, and analytics systems must each participate in the privacy model. No component becomes exempt merely because it stores a projection or derivative rather than the original record.

## Guiding Principle

When evaluating a privacy decision, ask:

> **Would a reasonable user understand that Chronologity knows this information, understand who can access it, and consider that use consistent with trusting Chronologity to preserve their history?**

If the answer is no, technical correctness is not enough.
