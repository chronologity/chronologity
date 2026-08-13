# Chronologity Glossary

## Purpose

This glossary defines the canonical product terminology used throughout Chronologity documentation.

Its purpose is to keep product, design, architecture, and engineering discussions semantically consistent. Terms defined here should retain the same meaning across documentation unless a document explicitly introduces a narrower context-specific definition.

The glossary is not intended to duplicate full product specifications. Each definition captures the essential meaning of a term; the corresponding product document remains authoritative for detailed behavior, invariants, requirements, and open questions.

---

## Accessibility

The product property that ensures Chronologity's meaning, capabilities, and historical context remain understandable and operable without depending exclusively on vision, hearing, motion, spatial perception, precise gestures, color, or any other single interaction modality.

Accessibility in Chronologity applies to the entire product experience, including the Timeline, temporal zoom, historical jumps, Moments, media, Search, Discovery, social interaction, privacy, moderation, and account workflows.

See `product/accessibility.md`.

## Actor

A Person, organization, group, or other identifiable participant associated with a historical occurrence, Moment, Event, causal relationship, or other historical context.

"Actor" describes participation in historical context and should not be assumed to mean a Chronologity User.

## Amplification

The proactive distribution or increased visibility of content through product surfaces such as Discovery, recommendations, Search prominence, or other mechanisms that expose content beyond direct navigation.

Chronologity distinguishes amplification from mere accessibility. Content may be permitted to exist or be accessed directly without being eligible for amplification.

See `product/discovery.md`, `product/search.md`, and `product/moderation.md`.

## Author

The User responsible for creating or publishing a particular User-generated resource, such as a Moment or Comment.

Authorship does not necessarily mean that the User originally captured every media item contained in a Moment, owns every depicted subject, or is a historical Actor represented by the content.

## Backfill

The act of adding a Moment representing an occurrence that happened before the time the Moment is created or uploaded to Chronologity.

Backfilling is a fundamental Chronologity behavior because the product is designed to represent history rather than only real-time publication.

A high volume of legitimate historical backfilling must not automatically be treated as spam.

See `product/moments.md` and `product/moderation.md`.

## Block

A User-controlled social and safety action that restricts interaction and/or visibility between Users according to Chronologity's privacy and social-graph rules.

Blocking is distinct from platform moderation. A User can block another User without Chronologity determining that the blocked User violated policy.

See `product/privacy.md`, `product/social-graph.md`, and `product/moderation.md`.

## Causal Relationship

A directed historical relationship asserting or proposing that one occurrence, Moment, Event, condition, or other historical entity caused, contributed to, enabled, influenced, or otherwise helped produce another.

A causal relationship is stronger than mere chronological proximity or general relatedness.

Causal relationships must preserve provenance and uncertainty where applicable.

See `product/causality.md`.

## Causality

The Chronologity product capability and historical model for representing cause-and-effect relationships across history.

Causality enables Users to navigate not only what happened before or after something, but how historical occurrences may be connected through consequence.

See `product/causality.md`.

## Chronological Feed

See **Feed**.

## Chronological Order

Ordering based on when represented occurrences happened rather than when their records were uploaded, created, edited, processed, or discovered by Chronologity.

Chronological order is a foundational Chronologity invariant.

See `product/feed.md`, `product/timeline.md`, and `product/moments.md`.

## Chronologity

A social historical platform organized around chronology.

Chronologity enables people to capture, reconstruct, explore, connect, and navigate history through Moments, Timelines, real-world Events, Locations, social context, causality, temporal zoom, historical jumps, Search, and Discovery.

Chronologity treats time as a first-class product dimension and occurrence time as fundamentally distinct from publication time.

See `vision.md`.

## Comment

A User-authored textual contribution associated with a Moment or another supported discussion surface.

Comments are social interactions and are independently subject to privacy, moderation, accessibility, and authorization rules.

A Comment does not alter the occurrence time or historical identity of the Moment to which it belongs.

See `product/comments.md`.

## Context

Information that helps explain, locate, relate, interpret, or navigate a historical entity without redefining the entity itself.

Context may include time, Location, Event membership, People, causal relationships, social information, provenance, historical significance, or other relationships.

## Creator

See **Author** when referring to the User who created a User-generated resource.

The term should be used carefully where "creator" could be confused with the original creator of uploaded media or a historical work.

## Derived Data

Data computed, projected, indexed, summarized, cached, ranked, clustered, transformed, or otherwise produced from authoritative product state.

Examples include Feed projections, Search indexes, Discovery candidates, Timeline abstractions, temporal-zoom clusters, historical-significance calculations, media derivatives, counts, and notification projections.

Derived data must respect privacy, moderation, deletion, authorization, and restoration semantics.

## Discovery

The Chronologity product capability for proactively helping Users encounter relevant history they did not explicitly request.

Discovery differs from Search because Search begins with explicit User intent, while Discovery proactively selects what to surface.

Discovery is an amplification surface and may therefore apply stricter eligibility rules than direct access.

See `product/discovery.md`.

## Event

See **Real-World Event**.

The unqualified word "event" should be avoided in architecture documentation where it could be confused with an event-sourcing domain event. Use **Real-World Event** for the historical product concept and **Domain Event** for an event-sourcing record.

## Feed

The chronological stream through which a User encounters eligible Moments.

The Feed is ordered by occurrence time rather than upload or publication time. Privacy, moderation, blocking, and authorization determine eligibility before presentation; they do not change the chronological ordering of the remaining Moments.

See `product/feed.md`.

## Follow

A social-graph relationship through which one User elects to receive or more easily access another User's eligible activity according to Chronologity's social and privacy rules.

Following does not override privacy, blocking, moderation, or authorization.

See `product/social-graph.md`.

## Follower

A User who follows another User.

Follower status is a social relationship, not an authorization bypass or proof of a real-world relationship.

See `product/social-graph.md`.

## Historical Context

Context that helps explain a Moment, Event, Person, Location, or other historical entity within the broader record of what occurred.

Historical context may be factual, relational, interpretive, causal, uncertain, disputed, or derived and should preserve appropriate provenance.

## Historical Correction

A proposed or accepted correction to historical metadata or context, such as an occurrence time, Location, Person identity, Event association, or other historical claim.

A historical correction is distinct from a moderation action. Incorrect historical information is not automatically a policy violation, and moderated content is not automatically historically false.

See `product/moderation.md`.

## Historical Gap

A period or position in a Timeline for which no accessible Moment or historical representation is available.

A gap may reflect genuinely undocumented history or may result from privacy, deletion, moderation, blocking, authorization, or other restrictions.

Chronologity must not fabricate history to conceal gaps.

See `product/timeline.md`, `product/privacy.md`, and `product/moderation.md`.

## Historical Integrity

The principle that Chronologity should preserve the meaning and structure of represented history rather than silently rewriting it for engagement, convenience, ranking, moderation, or technical implementation.

Historical integrity includes preserving occurrence time, distinguishing authoritative information from derived interpretation, maintaining provenance, and avoiding fabricated continuity.

Historical integrity does not mean every piece of content must remain publicly accessible forever.

## Historical Jump

A deliberate navigation operation that moves a User from one historical context to another meaningful historical context, potentially across large temporal distances.

Historical jumps may follow relationships involving Moments, Events, Locations, People, causality, historical significance, or other historical structure.

Historical jumps are a day-one Timeline capability.

A historical jump changes navigation context; it does not change the occurrence time or identity of the source or destination.

See `product/timeline.md`, `product/causality.md`, and `product/accessibility.md`.

## Historical Navigation

Movement through history using chronological position and historical relationships rather than conventional publication-order or engagement-order navigation.

Historical navigation includes Timeline traversal, temporal zoom, historical jumps, Event exploration, Location exploration, causal navigation, and related capabilities.

## Historical Record

The body of historical information represented through Chronologity.

The historical record is not equivalent to a single immutable public database. It may contain User-contributed content, derived context, uncertainty, corrections, privacy restrictions, moderated material, and information with differing provenance.

## Historical Significance

A contextual assessment of how important a Moment or other historical entity is within a particular historical frame.

Historical significance is not equivalent to popularity, engagement, virality, recency, or moral value.

It may help Chronologity determine which historical anchors remain visible or useful as temporal scale broadens, while preserving provenance, contextuality, and uncertainty.

Historical significance must not override privacy, moderation, or authorization.

See `product/historical-significance.md`.

## History

The set of past occurrences and relationships Chronologity seeks to represent and make navigable.

In Chronologity, history includes recent and personal history as well as distant, public, or conventionally "historic" events.

A Moment does not need to be famous or broadly significant to be part of history.

## Identity

The product model describing who a User is within Chronologity and how that identity is represented, authenticated, attributed, and distinguished from historical People or other entities.

Chronologity must not assume that a User account and a historical Person are the same concept.

See `product/identity.md`.

## Location

A geographic place associated with a Moment, Real-World Event, Person, or other historical context.

Location may exist at different levels of precision and is subject to privacy, authorization, safety, and moderation constraints.

Location is historical context, not merely a map coordinate.

See `product/locations.md`.

## Media

An image or video associated with a Moment.

A Moment may contain an unlimited number of images and videos at the product-model level.

Each video is independently subject to Chronologity's 90-second duration limit.

Media is part of a Moment; an individual media item is not itself the canonical historical unit.

See `product/media.md` and `product/moments.md`.

## Media Derivative

A transformed representation of original media produced for delivery, compatibility, performance, accessibility, moderation, preview, or other product purposes.

Examples may include thumbnails, resized images, compressed variants, video transcodes, poster frames, and other delivery assets.

Derived media must not silently replace the conceptual distinction between original/source media and product delivery representations.

See `product/media.md`.

## Moment

Chronologity's fundamental unit of represented history.

A Moment represents something that occurred at a particular historical time or within a historical interval and may contain an unlimited number of images and videos together with associated context.

A Moment's historical position is determined by occurrence time, not by when it was uploaded or published.

A Moment is not a container for Sub-Moments; Chronologity preserves vertical chronology rather than nesting history recursively inside Moments.

See `product/moments.md`.

## Moment Depth

The Timeline dimension representing movement from broader historical navigation into the detailed experience of a particular Moment.

Depth is a presentation and navigation concept, not a nested historical chronology.

See `product/timeline.md` and `product/accessibility.md`.

## Moderation

Chronologity's product capability for protecting people, legal compliance, and product integrity through reporting, warnings, restrictions, removal, enforcement, appeals, and related controls.

Moderation governs product distribution and participation; it does not rewrite historical occurrence.

Historical relevance does not create an unconditional right to unrestricted distribution.

See `product/moderation.md`.

## Notification

A product communication informing a User about relevant activity, state changes, social interactions, moderation actions, or other supported events.

Notifications must respect privacy, blocking, moderation, authorization, and accessibility.

See `product/notifications.md`.

## Occurrence

Something that happened in history and can be represented directly or indirectly by Chronologity.

An occurrence may be represented by a Moment, participate in a Real-World Event, have a Location, involve People, or participate in causal relationships.

## Occurrence Time

The time at which the occurrence represented by a Moment happened.

Occurrence time is the canonical basis for historical placement and chronological ordering.

It is distinct from upload time, creation time, publication time, ingestion time, processing time, and modification time.

Where the exact historical time is uncertain, Chronologity's model should represent uncertainty rather than invent false precision.

See `product/moments.md` and `product/timeline.md`.

## Original Media

The source media representation preserved by Chronologity before or independently of delivery-oriented transformations, subject to the final media architecture and applicable privacy, moderation, deletion, storage, and legal requirements.

Original media is conceptually distinct from thumbnails, transcodes, compressed variants, and other media derivatives.

See `product/media.md`.

## Person

A human being represented in historical context.

A Person may appear in or relate to Moments, Events, Locations, causal relationships, and other historical entities.

A Person is not inherently a Chronologity User, and a User account must not be treated as the sole representation of a real person in history.

See `product/identity.md`, `product/users.md`, and related historical-context specifications.

## Privacy

The product capability governing who may access User information, Moments, media, Location information, social relationships, and other protected data.

Privacy is an authorization concern and must propagate across Feed, Timeline, Search, Discovery, temporal zoom, historical jumps, derived data, notifications, and media delivery.

Privacy does not change when history occurred; it changes who may access its representation.

See `product/privacy.md`.

## Provenance

Information describing the origin, authorship, derivation, evidence, process, or confidence behind a piece of historical or product information.

Provenance is especially important for historical corrections, causal claims, historical significance, machine-generated metadata, accessibility descriptions, captions, and other derived or interpretive information.

Provenance allows Chronologity to distinguish what is known, asserted, inferred, generated, corrected, or uncertain.

## Publication Time

The time at which a Moment or other resource becomes published or otherwise available through Chronologity.

Publication time is operational/product metadata and must not determine the Moment's historical position when occurrence time is available.

## Reaction

A lightweight social interaction through which a User expresses a supported response to a Moment or other eligible resource.

Reactions are social metadata, not historical facts, and must not redefine occurrence time or historical significance.

See `product/reactions.md`.

## Real-World Event

A historical occurrence or bounded collection of related occurrences represented as a shared real-world context that may connect multiple Moments, People, Locations, and other historical information.

A Real-World Event is not a Moment and does not replace Moment chronology.

Multiple Users may contribute Moments associated with the same Real-World Event.

Use the full term when confusion with event-sourcing Domain Events is possible.

See `product/real-world-events.md`.

## Relationship

A typed connection between product or historical entities.

Relationships may include social relationships, causal relationships, Event membership, Location associations, Person associations, and other historical-context connections.

The semantics of a relationship depend on its type; Chronologity should not collapse all relationships into generic "related content."

## Search

The Chronologity product capability through which a User explicitly asks to find historical content, Users, People, Events, Locations, Moments, or other supported entities.

Search is intent-driven and differs from Discovery's proactive surfacing.

Search results remain subject to privacy, moderation, blocking, authorization, and other eligibility constraints.

See `product/search.md`.

## Social Graph

The network of User-to-User social relationships represented by Chronologity.

The social graph supports experiences such as following and other social context but must not replace historical relationships between People, Events, Locations, or Moments.

See `product/social-graph.md`.

## Sub-Moment

A deliberately unsupported concept in the current Chronologity product model.

Chronologity does not recursively nest Moments inside other Moments. A Moment may contain unlimited media, but those media items do not become Sub-Moments.

Rejecting Sub-Moments preserves a coherent vertical chronology.

See `product/moments.md` and `product/timeline.md`.

## Temporal Context

The historical time frame within which a User is currently viewing or interpreting content.

Temporal context may include a specific timestamp, day, month, year, decade, century, or another time range depending on the current temporal scale.

## Temporal Scale

The amount or granularity of historical time represented by the current Timeline view.

Temporal scale changes through temporal zoom.

A scale may represent a narrow interval containing detailed Moments or a broad interval requiring abstraction, clustering, or historically significant anchors.

See `product/timeline.md` and `product/accessibility.md`.

## Temporal Zoom

The day-one Timeline capability that allows a User to change the temporal scale at which history is viewed.

Zooming inward exposes finer-grained chronological detail.

Zooming outward represents broader spans of time and may require abstraction, clustering, or historically significant anchors while preserving access to underlying history.

Temporal zoom changes presentation and navigation scale; it does not alter occurrence time or historical truth.

See `product/timeline.md`, `product/historical-significance.md`, and `product/accessibility.md`.

## Timeline

Chronologity's primary historical navigation experience.

The Timeline is a derived chronological representation of history rather than a separate User-created container.

Its conceptual dimensions are:

```text
Vertical   -> chronology
Horizontal -> contextual relationships or groupings
Depth      -> focus into a Moment
```

The Timeline supports temporal zoom and historical jumps from day one.

Privacy, moderation, blocking, and authorization may affect what a viewer can access, but they must not rewrite the occurrence time of the history that remains.

See `product/timeline.md`.

## Timeline Context

The combination of temporal position, temporal scale, relevant historical relationships, and navigation state that determines what portion of history a User is currently exploring.

Timeline context should be restorable when a User enters a Moment and returns, and understandable after temporal zoom or historical jumps.

## Timelines

The broader product concept describing the historical chronological representations available through Chronologity.

Where `timeline.md` defines the primary Timeline experience, `timelines.md` addresses how multiple Timeline contexts or scopes are understood within the product without turning them into arbitrary User-created containers.

See `product/timelines.md`.

## Tombstone

A privacy-safe and moderation-safe placeholder that may preserve historical or navigational continuity when an underlying resource is unavailable.

A tombstone must not reveal information the viewer is not authorized to know.

Tombstones are not fabricated replacement history.

See `product/moderation.md` and applicable privacy/deletion specifications.

## Upload Time

The time at which media or a Moment is submitted to Chronologity.

Upload time is operational metadata.

It must not be substituted for occurrence time when determining where a Moment belongs in history.

## User

A person with a Chronologity account.

A User can create and interact with product resources according to their permissions and product state.

A User is an account/product concept and must remain distinct from a historical Person.

See `product/users.md` and `product/identity.md`.

## User-Authored

Information explicitly supplied or edited by a User rather than generated or inferred by Chronologity.

User-authored information should remain distinguishable from machine-generated, system-derived, imported, or inferred information where provenance matters.

## Viewer

The User or other authorized product actor for whom a particular representation is being constructed.

Eligibility, privacy, blocking, moderation, and authorization may cause different Viewers to receive different accessible subsets or representations of the same underlying historical context.

## Visibility

The access state governing which audience may view a resource.

Visibility is related to privacy but is not equivalent to Discovery or Search eligibility.

A resource may be visible to an authorized audience while remaining excluded from amplification surfaces.

## Warning

A moderation or safety presentation placed before or around sensitive content to inform a User before exposure.

Warnings may obscure previews or require explicit reveal.

A warning does not inherently mean the underlying historical content is false or historically insignificant.

See `product/moderation.md` and `product/accessibility.md`.

---

## Terminology Rules

The following terminology rules apply throughout Chronologity documentation.

### Occurrence Time Over Publication Time

Use **occurrence time** when referring to where something belongs in history.

Do not use `createdAt`, upload time, publication time, or ingestion time as synonyms for occurrence time.

### Moment as the Historical Unit

Use **Moment** for Chronologity's fundamental unit of represented history.

Do not use **post** as the canonical product term when referring to a Moment.

Implementation layers may use different technical names only where necessary, but product and domain documentation should preserve **Moment**.

### No Sub-Moments

Do not introduce **Sub-Moment** as a product entity.

Multiple media items, media groupings, pagination boundaries, processing batches, or UI sections inside a Moment do not create nested Moments.

### Timeline Is Derived

Use **Timeline** for the chronological historical experience derived from eligible history.

Do not describe a Timeline as an arbitrary User-created container unless a future product decision explicitly changes the canonical model.

### Real-World Event Versus Domain Event

Use **Real-World Event** for the historical product concept.

Use **Domain Event** for an event-sourcing event.

Avoid unqualified **Event** in architecture documentation when the meaning would be ambiguous.

### User Versus Person

Use **User** for a Chronologity account holder.

Use **Person** for a human represented in historical context.

Do not assume the two entities are identical.

### Search Versus Discovery

Use **Search** for explicit User intent to find something.

Use **Discovery** for proactive surfacing of history.

Do not use the terms interchangeably.

### Accessibility Versus Alternative Product

Accessible representations are presentations of the same Chronologity semantics, not separate reduced-capability versions of the product.

Temporal zoom, historical jumps, chronology, context, and Moment depth must remain available through accessible interaction.

### Moderation Versus Historical Correction

Use **moderation** for safety, conduct, policy, legal, and distribution enforcement.

Use **historical correction** for proposed changes to historical facts, metadata, or context.

Do not treat a disputed historical claim as a moderation violation merely because it is disputed.

### Historical Significance Versus Popularity

Use **historical significance** for contextual historical importance.

Do not use engagement, Reaction counts, virality, popularity, or reach as synonyms for historical significance.

### Privacy Versus Historical Truth

Privacy determines who may access information.

It does not determine whether the represented occurrence happened.

Do not describe privacy filtering as altering history.

### Restriction Versus Deletion

Use precise language when distinguishing:

- de-amplification;
- warning;
- visibility restriction;
- access restriction;
- removal;
- and deletion.

Do not say content was deleted when the product merely stopped recommending or displaying it on a particular surface.

### Derived Versus Authoritative Information

Where the distinction matters, explicitly identify information as:

- User-authored;
- imported;
- system-derived;
- machine-generated;
- inferred;
- corrected;
- or otherwise provenance-bearing.

Do not silently present derived interpretation as authoritative historical fact.

---

## Guiding Principle

When introducing new Chronologity terminology, ask:

> **Does this term describe a genuinely distinct product or historical concept, and can it be defined without weakening the distinctions Chronologity relies on to represent time, history, identity, context, privacy, and provenance accurately?**

Prefer a small, precise vocabulary over multiple names for the same concept.

Chronologity's terminology should make the historical model easier to reason about, not merely give familiar social-media concepts new labels.
