# Chronologity Moments

## Purpose

This document defines the product semantics, lifecycle, invariants, and expected behavior of a **Moment**, the fundamental unit of recorded experience in Chronologity.

It builds on `concepts.md` and focuses on what a Moment means to users rather than prescribing database schemas, service boundaries, event streams, API routes, or other implementation details.

## Definition

A **Moment** represents an experience or event that occurred at a particular point or interval in time.

A Moment is part of a chronological record. It is not merely content published into a feed.

```text
Moment ≠ Post
Moment ≠ Media
Moment ≠ Upload
Moment ≠ Draft
```

A Moment may use media and metadata to represent an experience, but the Moment itself is the historical product concept.

## Product Role

Moments are the primary building blocks of Chronologity.

```text
Experience
    ↓
Recorded as
    ↓
Moment
    ↓
Placed according to occurrence time
    ↓
Chronological experience
```

Comments, reactions, discovery, search, notifications, and other capabilities may lead users to or enrich Moments, but they do not redefine the historical position of those Moments.

## Moment Identity

Every Moment has a stable identity belonging to the represented experience rather than to any particular image, video, caption, location, comment, reaction, or feed appearance.

Changing a description, changing visibility, adding a reaction, or changing associated media does not inherently create a new Moment. A new Moment should represent a new historical record, not merely a new version of surrounding metadata.

## Moment Content

A Moment may contain or reference information that helps represent the underlying experience, including images, videos, descriptive information, occurrence time, optional location context, people or participants, contextual relationships, comments, reactions, and other metadata.

Not every Moment must contain every type of information. The minimum information required to create a Moment should be defined deliberately by the product experience.

## Media

Media is one way of representing a Moment.

```text
Moment ≠ Media
```

A media asset is evidence, representation, or documentation associated with an experience. The Moment represents the experience itself.

Media has its own lifecycle: uploads may fail, video may require transcoding, images may have multiple processed representations, and assets may be removed or replaced. Those operations should not automatically redefine the identity or occurrence time of the Moment.

## Unlimited Media Per Moment

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

Chronologity should not force a user to split one coherent historical experience into multiple Moments merely because that experience is represented by many media assets.

The semantic boundary is the experience:

```text
One coherent experience
        ↓
One Moment
        ↓
Any number of associated images and videos
```

Media count does not determine Moment identity.

```text
Number of media assets ≠ Number of Moments
```

Likewise, adding or removing media from an existing Moment does not inherently create a new historical event.

### Product Semantics Versus Operational Constraints

"Unlimited" describes the **product model**, not the absence of infrastructure safeguards.

Chronologity may impose practical constraints such as:

- maximum individual file sizes;
- the 90-second maximum duration for each individual video;
- supported media formats;
- upload concurrency limits;
- request-size limits;
- storage quotas or fair-use protections;
- rate limits;
- abuse-prevention controls; and
- processing-capacity protections.

Those constraints must not be misrepresented as defining how many media assets constitute a Moment.

If infrastructure cannot process all media in a single operation, the product may upload or process assets incrementally without changing the semantic model.

```text
Operational batching ≠ Multiple Moments
```

## Mixed Media

A single Moment may contain both images and videos.

```text
Moment
 ├── Image
 ├── Video
 ├── Image
 └── Video
```

Chronologity should not require users to create separate Moments based solely on media type.

Images and videos are representations of the same underlying experience when the user intends them to belong to the same Moment.

## Media Ordering Within a Moment

When a Moment contains multiple media assets, their presentation order is distinct from the Moment's position in the Timeline.

Chronologity should support a deterministic media order within the Moment.

The exact initial behavior for choosing that order---such as upload order, user-defined order, capture time, or another mechanism---should be resolved through product design.

```text
Timeline ordering
      ≠
Media ordering within a Moment
```

Changing media order within a Moment does not change when the Moment occurred.

## Images

Chronologity supports image-based and mixed-media Moments.

A Moment may contain any number of images at the product-model level.

Image processing, compression, thumbnail generation, delivery formats, and storage are technical concerns defined by the media architecture.

## Video

Chronologity supports video-based and mixed-media Moments.

A Moment may contain any number of videos at the product-model level.

An **individual video** has a maximum duration of **90 seconds**.

```text
Maximum videos per Moment: unlimited
Maximum duration per video: 90 seconds
```

The 90-second limit applies independently to each video asset. It is not a cumulative duration limit across the Moment.

For example, a Moment may semantically contain:

```text
Video A: 45 seconds
Video B: 90 seconds
Video C: 72 seconds
Video D: 90 seconds
...
```

without requiring those videos to become separate Moments merely because their combined playback duration exceeds 90 seconds.

The limit preserves the idea that each individual video captures a focused representation rather than turning Chronologity into a general-purpose long-form video platform.

### Video Quality

Chronologity should prioritize meaningful visual quality when processing video. Compression is necessary for practical storage and delivery, but the product should not aggressively sacrifice quality merely to minimize infrastructure cost.

Exact encoding profiles, resolutions, bitrates, and adaptive-delivery strategies are architecture decisions.

### Video Playback

Video Moments are intended to autoplay with sound by default when they become active in the primary Moment experience. Users should eventually be able to disable autoplay according to their preferences.

When a Moment contains multiple videos, autoplay and intra-Moment playback behavior require deliberate interaction design. The product should avoid uncontrolled simultaneous playback or competing audio.

Playback must respect platform capabilities, accessibility considerations, user preferences, network conditions, and operating-system restrictions.

### No Automatic AI Segmentation

Chronologity should not automatically use AI to divide a video longer than 90 seconds into multiple Moments.

The user determines what constitutes a Moment.

The product may provide ordinary editing or trimming tools for an individual video. It may also allow a user to select multiple compliant video segments for the same Moment. However, Chronologity should not silently infer historical Moment boundaries on the user's behalf.

A media-processing constraint must not be confused with a historical boundary.

## Occurrence Time

Every Moment must have a meaningful temporal position.

The most important temporal concept is **occurrence time**: when the represented experience happened.

```text
occurredAt ≠ createdAt
```

Occurrence time determines the Moment's historical position.

For example:

```text
Event occurred: June 12, 2014
Moment created: August 9, 2026
```

The Moment belongs historically in June 2014.

## Historical Moments

Chronologity should support recording experiences from the past. A user should not be limited to documenting events in real time.

A user may create a Moment today for an event that occurred yesterday, several years ago, during childhood, or at another meaningful point in the past. Creation date must not displace historical occurrence date.

## Future Times

A Moment represents something that happened.

A future plan, scheduled event, reminder, or prediction is therefore not automatically a Moment. If Chronologity later introduces concepts for future events or planned experiences, those concepts should be modeled explicitly rather than weakening the semantics of Moment.

## Time Precision

Users may not always know the exact time an event occurred.

Chronologity should eventually support temporal precision appropriate to the information available, such as an exact timestamp, a specific day, a month and year, a year, or an approximate period.

The product should not create false precision. If a user knows that an event happened in 1998 but does not know the month or day, Chronologity should not require an invented date merely to satisfy a storage representation.

The detailed model for partial and approximate dates should be designed explicitly before implementation.

## Time Zones

The meaning of an occurrence time may depend on local context.

Chronologity should preserve enough temporal context to reconstruct the user's intended historical meaning when exact local time matters. The precise technical representation belongs in architecture documentation.

## Chronological Position

A Moment's position in chronological navigation is determined by its occurrence semantics.

Later activity surrounding the Moment must not change that position.

```text
Moment occurred:   2020
Comment added:     2024
Reaction added:    2025
Caption corrected: 2026
```

The Moment remains historically positioned in 2020.

## Deterministic Ordering

Two Moments may have the same known occurrence time. Chronologity must still present a stable and deterministic order when an ordering is required.

The technical tie-breaking mechanism is an architecture decision, but deterministic behavior is a product requirement. When historical information genuinely does not establish which Moment occurred first, the interface should avoid implying more certainty than the data supports.

## Duration

Some experiences occur at an instant while others span an interval.

Chronologity should not assume that every Moment necessarily represents a mathematically instantaneous event. The product may eventually distinguish a point in time, time interval, or approximate period.

Event duration is conceptually distinct from the playback duration of any media associated with the Moment.

```text
Event duration ≠ Individual video duration
Event duration ≠ Combined media duration
```

A collection of several short videos may represent an event that lasted hours, days, or another meaningful interval.

## Location

A Moment may include location context.

Location can make a historical record more meaningful by answering where something happened, but it is optional and potentially sensitive.

Chronologity must not assume that every Moment has a location, has a precise location, should expose its location publicly, or should retain location at the same precision originally captured by a device.

## Description

A Moment **must** include descriptive text saying what happened.

Media and a timestamp alone are a photograph with a date on it. The caption is
what makes the record be about an experience rather than about a file, which is
the distinction this document opens with. This was decided deliberately and
replaces an earlier statement that descriptive text was optional.

Editing descriptive text should not change occurrence time or move the Moment through chronological navigation. The product should distinguish enriching the representation of history from changing the historical event itself.

## People and Participation

A Moment may involve people other than the creator.

Chronologity may eventually represent participants, people appearing in media, contributors, or other relationships between Users and Moments. These relationships require careful product and privacy design.

Being depicted in a Moment, being tagged in a Moment, contributing to a Moment, and owning a Moment are not necessarily the same relationship and should not be collapsed into one generic association.

## Moment Creation

Creating a Moment is the act of committing an experience into Chronologity's historical model.

```text
Capture or select content
        ↓
Prepare Draft
        ↓
Provide required historical context
        ↓
Commit
        ↓
Moment
```

A Draft remains distinct from a Moment until the creation process reaches the product-defined commitment point.

## Drafts

A Draft represents work in progress.

```text
Draft ≠ Moment
```

A Draft may be changed freely, abandoned, or retried without implying that the historical record changed. It may reference any number of media assets that are selected, uploading, processing, completed, or failed.

Chronologity should avoid treating partially completed creation flows as committed Moments unless the product intentionally supports such a state.

## Uploads and Moment Creation

Media upload and Moment creation are related but separate processes.

```text
Select Media
    ↓
Upload one or more assets
    ↓
Process Media
    ↓
Associate assets with Draft
    ↓
Create Moment
```

For a Moment containing many media assets, upload and processing may happen concurrently, incrementally, or in batches.

The exact implementation may allow steps to overlap, but the product semantics should remain clear.

Successfully uploading one file---or many files---does not by itself create a Moment.

## Partial Media Failure

Because a Moment may contain many media assets, individual uploads or processing operations may fail independently.

The product should not automatically reinterpret one intended Moment as several Moments because media processing occurred in separate batches or because some assets required retrying.

The exact commitment behavior when some media assets succeed and others fail is an open interaction decision.

## Moment Lifecycle

A Moment's conceptual lifecycle may include transitions such as:

```text
Draft
  ↓
Created
  ↓
Available
  ↓
Visibility changed
  ↓
Metadata corrected
  ↓
Removed or otherwise restricted
```

This describes possible product transitions rather than prescribing a state machine. Architecture should not create lifecycle states merely because they are technically convenient; each state should correspond to meaningful product behavior.

## Editing

Chronologity should permit appropriate corrections and enrichment without treating history as casually mutable.

Potentially editable information may include description, location, occurrence metadata, visibility, media ordering, and associated media subject to product rules.

Not all edits are semantically equivalent. Changing a caption differs from changing the claimed occurrence date. Changing visibility differs from adding or removing media. Correcting a historical fact differs from adding a comment.

## Adding Media After Creation

Adding images or videos to an existing Moment should be treated as enriching the representation of the existing experience when those assets represent the same historical Moment.

```text
Existing Moment
      +
Additional media from same experience
      =
Enriched Moment
```

It should not automatically create a new Moment or change the existing Moment's chronological position.

## Removing Media

Removing an image or video from a Moment removes that representation from the Moment according to the product's deletion semantics.

It does not inherently delete the Moment itself.

```text
Delete media asset ≠ Delete Moment
```

A Moment may continue to exist if other content remains and the product's minimum Moment requirements are still satisfied.

The behavior when the final remaining media asset is removed depends on whether Chronologity ultimately permits media-less Moments.

## Correcting Occurrence Time

Changing a Moment's occurrence time is especially significant because it changes where the Moment belongs in history.

The product should treat this as a historical correction rather than an ordinary cosmetic edit. A correction may cause the Moment to move within chronological navigation.

Chronologity should eventually make such changes understandable and auditable where appropriate without creating unnecessary friction for ordinary mistakes.

## Deletion and Removal

Users must be able to remove content when product, privacy, safety, or legal requirements demand it.

The term **delete** should not obscure potentially different outcomes: removing a Moment from ordinary access, deleting associated media, removing it from a contextual grouping, retaining limited records required for security or legal reasons, or permanently erasing data.

The exact deletion model requires dedicated privacy and architecture decisions. Historical integrity does not justify retaining content that Chronologity is obligated to remove.

## Visibility

A Moment's visibility determines who may access or discover it.

Visibility is independent of occurrence time. Changing a Moment from private to public does not make it newly occurring, and changing a public Moment to private does not change when the represented event happened.

## Comments

Comments provide discussion around a Moment and are temporally separate activities.

```text
Moment
 ├── occurredAt
 └── Comments
      ├── createdAt
      ├── createdAt
      └── createdAt
```

Comment activity must not change the historical occurrence time of the Moment.

## Reactions

Reactions provide lightweight social interaction around a Moment.

```text
More reactions ≠ More recent
More reactions ≠ More historically important
```

Chronologity may display reaction information, but engagement metrics should not silently become the ordering principle for history.

## Relationships Between Moments

A Moment may eventually have explicit relationships with other Moments.

Possible semantics may include causal, contextual, part-of, continuation, related experience, or other product-defined relationships.

These relationships should not be inferred merely from chronological proximity.

```text
Moment A before Moment B
```

does not automatically mean:

```text
Moment A caused Moment B
```

## Shared Historical Context

A Moment may be meaningful in more than one context.

A collection of images and videos from a concert may simultaneously be relevant to the creator's personal history, the concert, the venue, the performing artist, the city, and other people who attended.

Chronologity's long-term model should allow richer context without forcing a Moment to lose its original identity. The same historical record should not need to be duplicated merely because it participates in multiple meaningful contexts.

## Discovery and Search

A Moment may be surfaced through discovery or ranked in search without changing its chronology.

Discovery and search determine how a user finds a Moment. Occurrence semantics determine where the Moment belongs in history.

A highly relevant Moment from 2012 may appear above a less relevant Moment from 2026 in search results without implying that the 2012 event occurred later.

## Notifications

Activity related to a Moment may generate notifications.

A notification is not the Moment and does not alter the Moment's chronology. A notification about a new comment on an old Moment communicates new activity around old history.

## Historical Integrity

Chronologity should preserve the meaning and provenance of Moments without imposing absolute technical immutability.

```text
Preserve historical meaning.
Represent corrections explicitly.
Respect privacy and removal requirements.
```

Historical integrity means users should be able to trust what a Moment represents and where it belongs in history. It does not mean preventing legitimate corrections or retaining data indefinitely against a user's rights.

## Product Invariants

1.  A Moment represents an experience or event in time.
2.  A Moment has an identity distinct from its media.
3.  **A Moment may contain an unlimited number of images and videos at the product-model level.**
4.  **A single Moment may contain both images and videos.**
5.  **The 90-second video limit applies independently to each individual video, not cumulatively to the Moment.**
6.  Media count does not determine the number of Moments.
7.  Operational upload or processing limits must not redefine Moment boundaries.
8.  Occurrence time and creation time are different concepts.
9.  Social activity does not change a Moment's historical position.
10. Upload completion does not by itself create a Moment.
11. A Draft is not part of the committed historical record.
12. A Moment may represent an event recorded long after it occurred.
13. A future plan is not automatically a Moment because a Moment represents something that happened.
14. Chronological proximity does not establish causality.
15. Changes to occurrence time are historically significant corrections.
16. Visibility changes affect access, not occurrence time.
17. Search and discovery ranking do not redefine chronology.
18. Media-processing state should not redefine historical meaning.
19. Adding media from the same experience may enrich an existing Moment without creating a new Moment.
20. Removing an individual media asset does not inherently delete the Moment.
21. Historical integrity must coexist with correction, privacy, safety, and deletion requirements.
22. The product should not imply temporal precision that the user does not actually know.

## Established Moment Decisions

These were open questions. They were decided deliberately, ahead of the implementation that depends on them, rather than being answered by accident during it.

**A Moment requires an occurrence, at least one image or video, and a caption.** A Location and a real-world Event are optional. Media-less Moments are therefore not permitted in the initial product.

This has a consequence `moments.md` anticipated: because the last media asset cannot be removed without leaving a Moment that could not have been created, **removing the final media asset is refused**. It does not silently delete the Moment. Deleting a media asset and deleting a Moment remain different operations, and an edit must not destroy history as a side effect. Someone who wants the Moment gone deletes the Moment.

**A Moment's occurrence is an interval with the precision it is actually known at**, using the same `start`, `end`, and precision that `packages/contracts/src/time.ts` already defines and that real-world Events use (ADR-100). A Moment known only as "summer 1998" is that interval at `month` precision, and never acquires a fabricated exact timestamp. This is what lets a Moment represent an interval rather than a point.

**Media within a Moment carries an explicit position**, set from the order supplied at creation and changeable afterwards. Position is presentation only: it orders media inside the depth view and never affects where the Moment sits in chronology, which is determined by occurrence time alone.

**A Moment is private, restricted to people its author named, or public** (ADR-108) — the three models `privacy.md` describes, and no more. A Moment is public unless its author says otherwise, which they may do while recording rather than only afterwards. Nothing recorded before that default existed was changed by it.

Every read requires a Viewer, public Moments included. That is what lets a Block take effect: a blocked person must not be able to route around it by signing out. Reading and editing are separately gated, so seeing a Moment is never enough to change one.

**A Moment may be connected to another Moment by an explicit claim** (ADR-111) — `led_to`, `contributed_to`, `related_to`, `alternate_perspective`, or `contradicts`. A relationship is always something somebody said, never something derived from chronological order, and it records whose reading of history it is. One end must belong to whoever makes the claim, and a relationship is visible only when both its ends are.

**A Moment's author chooses how much of its place other people are told** (ADR-109) — exact, the neighbourhood, the city, or nothing. The author always sees the exact place. New Moments disclose exactly unless their author says otherwise, and the choice can be made while recording.

Below exact, the response carries no Location identifier and no coordinates, which is what stops the reduction being undone by looking the place up. Disclosure is a separate thing from a Location's precision: precision says how well the place is known and is the same for everybody, disclosure says how much of that a Viewer receives.

**Media must be checked before it can represent a Moment.** An upload reaches
`ready` only once a decoder has opened it and found it to be what it claimed
(ADR-086), and nothing else may be attached. So a Moment cannot be committed
while a video is still processing — a real constraint on the experience, and the
consequence of media being mandatory: a Moment built on a file that later failed
would be one that could not have been created.

**A Moment's caption, occurrence, and media may be changed after it is recorded, and every change is kept.** `moment_edits` records what kind of change it was and what the changed thing was before, in the same transaction as the change itself (ADR-103). Correcting when something happened is its own operation, separate from correcting a caption, because the two are not the same act: one moves the Moment through chronology and the other does not.

Nothing reads that history back yet. How corrections should be presented remains open, and exposing them would answer it by implementation.

**Deletion is a tombstone, and erasure is separate work.** A deleted Moment is retained as a row, disappears from every read, and its stored media is left untouched. What a deletion service must erase, in what order, and what must be retained for abuse prevention or legal reasons are deliberately unresolved and listed below. Foreign keys remain `RESTRICT` (ADR-097), so nothing is removed as a silent consequence of removing something else.

## Open Product Questions

The following behaviors should remain open until deliberately designed rather than answered accidentally during implementation:

- What should happen when some media assets succeed during upload or processing and others fail?
- How should extremely large Moments be presented without making Moment depth difficult to navigate?
- How should historical corrections be presented to users?
- How should participation, tagging, and consent work when other people appear in a Moment?
- Can multiple users collaboratively contribute to the same Moment?
- How should Moments participate in automatically derived location and event groupings?

The following questions are **resolved** and should not be reopened accidentally during implementation:

```text
How many images may a Moment contain?   Unlimited
How many videos may a Moment contain?   Unlimited
May images and videos coexist?          Yes
Maximum duration of one video?          90 seconds
Is 90 seconds cumulative per Moment?    No
```

## Relationship to `privacy.md`

`privacy.md` defines the privacy consequences of Moment content, including media, location, people, derived context, and potentially large media collections.

The unlimited-media decision does not weaken privacy requirements. Every media asset and every derived representation must participate in the Moment's access and deletion model.

## Relationship to Architecture

This document defines product semantics, not implementation boundaries.

A Moment does not necessarily require a dedicated microservice, database, Kafka topic, API shape, or storage technology.

The unlimited-media requirement does, however, impose an important architectural constraint:

> The architecture must not assume that all media belonging to a Moment can be uploaded, processed, returned, cached, or rendered in one bounded operation.

The implementation should support potentially large media collections through mechanisms such as incremental uploads, independent media processing, pagination or windowing where appropriate, and resilient partial-failure handling.

Those mechanisms must preserve the product invariant that operational batching does not create artificial Moment boundaries.

The architecture must preserve all product invariants defined here while using the simplest technical model capable of doing so.

## Guiding Principle

When deciding whether content belongs to one Moment or several, ask:

> **How many historical experiences does the user intend to represent?**

Do not ask:

> **How many files are there?**

The experience defines the Moment. The media represents it.
