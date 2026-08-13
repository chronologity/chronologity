# Chronologity Media

## Purpose

This document defines the product semantics of **media** in Chronologity.

Media is how a Moment is experienced visually and audibly, but media is not itself the historical unit. A Moment represents an experience and may contain an unlimited number of images and videos at the product-model level. Images and videos may coexist within the same Moment, and each individual video has a maximum duration of 90 seconds.

The central question is:

> **How should Chronologity let Users capture, upload, organize, process, view, and interact with potentially large collections of images and videos inside a Moment without allowing storage or processing constraints to redefine what a Moment means?**

This document defines user-facing media behavior and invariants rather than object-storage layout, upload protocols, codecs, transcoding infrastructure, CDN behavior, job queues, database schemas, or implementation-specific media pipelines.

## Core Principle

Chronologity must preserve the distinction:

```text
Moment
    !=
Media file
```

A Moment is the historical experience.

Media provides evidence, perspective, and representation of that experience.

A Moment may contain:

```text
1 image
1 video
many images
many videos
images + videos
```

and, at the product-model level:

```text
media count per Moment = unlimited
```

Media count must not determine Moment boundaries.

## Media Types

Chronologity's initial product model supports:

- images; and
- videos.

A Moment may contain either or both.

Other media types may be introduced later, but they must not be assumed merely because the underlying storage system can accept arbitrary files.

## Unlimited Media Per Moment

There is no product-level maximum number of images or videos that may belong to a Moment.

This is a deliberate semantic rule.

Chronologity must not impose rules such as:

```text
Maximum 10 photos per Moment
Maximum 4 videos per Moment
Maximum 20 media items total
```

as part of the Moment model.

Operational safeguards may exist to protect the service, but they must not silently redefine the domain as though a Moment inherently ends after an arbitrary file count.

## Unlimited Does Not Mean Unbounded Resource Consumption

"Unlimited media per Moment" is a product-model statement, not a promise that infinite data can be uploaded instantaneously or without operational constraints.

Chronologity may legitimately enforce:

- per-file size limits;
- supported formats;
- upload-rate limits;
- account abuse controls;
- temporary concurrency limits;
- storage quotas if the product explicitly adopts them;
- processing backpressure;
- network-aware behavior; and
- other infrastructure protections.

These controls regulate resource consumption.

They do not define how many media items conceptually constitute one Moment.

## Mixed Media

Images and videos may coexist in the same Moment.

Chronologity must not require Users to split one experience into separate photo and video Moments merely because the media types differ.

For example:

```text
Moment: Hiking Half Dome

1 establishing photo
8 trail photos
2 summit videos
17 additional photos
1 descent video
```

may remain one Moment if those media items represent the same experience.

## Individual Video Duration

Each individual video has a maximum duration of:

```text
90 seconds
```

The limit applies independently to every video.

Therefore:

```text
Video A: 90 seconds
Video B: 90 seconds
Video C: 90 seconds
```

is valid within one Moment.

The limit is not cumulative across the Moment.

A Moment containing ten 90-second videos does not violate the per-video duration rule.

## Why the 90-Second Limit Exists

The 90-second limit reflects Chronologity's concept of a Moment as a bounded representation of an experience rather than a long-form video-hosting product.

The limit should constrain individual video artifacts without artificially constraining how many perspectives or clips may represent the larger Moment.

Chronologity should not gradually turn the per-video limit into a hidden total-duration limit unless the product model is intentionally revised.

## Video Trimming

When a User selects a video longer than 90 seconds, Chronologity should provide a clear path to create an eligible clip rather than merely rejecting the file without assistance.

Conceptually:

```text
Selected video > 90 seconds
          |
          v
Choose / trim a segment
          |
          v
Eligible video <= 90 seconds
```

The original source file on the User's device is not modified by Chronologity merely because a shorter clip is selected for upload.

The exact trimming interface is a design decision.

## Media Ordering

Media within a Moment must have a deterministic presentation order.

The creator should be able to establish or adjust that order before publication and, subject to Chronologity's Moment-editing semantics, afterward where permitted.

Media ordering represents presentation within the Moment.

It does not create independent historical occurrence times for every media item unless Chronologity explicitly captures such metadata for another purpose.

## Media Order Is Not Chronology

The first media item in a Moment is not necessarily the earliest thing that happened.

Likewise:

```text
Media position 1
Media position 2
Media position 3
```

does not inherently mean:

```text
Occurred first
Occurred second
Occurred third
```

The ordering may be narrative, aesthetic, evidentiary, or User-selected.

Chronologity must not infer causal or temporal relationships from media position alone.

## Cover Media

Chronologity may allow one media item to act as the representative or cover media for a Moment.

Cover selection affects presentation only.

It must not imply:

- greater historical significance;
- earlier occurrence;
- causal priority;
- stronger evidentiary status; or
- separate ownership.

If no cover is explicitly selected, Chronologity may choose a deterministic presentation default.

## Large Moments

Because a Moment may contain unlimited media, the product must be designed for large Moments from the beginning.

A large Moment must not require rendering or downloading every media asset before the User can open it.

The product experience should support progressive access to media while preserving the Moment as one conceptual unit.

Potential presentation techniques include:

- incremental loading;
- windowed or virtualized media lists;
- progressive thumbnails;
- sections or visual grouping;
- pagination internal to media presentation;
- lazy loading;
- or other scalable interaction patterns.

These are presentation strategies.

They must not turn one Moment into multiple Moments.

## Internal Media Pagination

Chronologity may paginate or incrementally retrieve media inside a Moment for performance.

For example:

```text
Moment
  |
  +-- media 1-50
  +-- media 51-100
  +-- media 101-150
```

remains:

```text
one Moment
```

Internal retrieval boundaries are not product boundaries.

## Media Grouping Within a Moment

For very large Moments, Chronologity may eventually provide non-authoritative visual groupings to help Users navigate the media.

Possible grouping signals might include:

- capture time;
- device metadata;
- media type;
- User-defined sections;
- visual similarity; or
- other presentation context.

Such grouping must not silently create Sub-Moments.

Chronologity has deliberately rejected Sub-Moments as a mechanism that would compromise the vertical chronological model.

## Images

Images should preserve enough quality to represent history faithfully while remaining practical to upload and view.

Chronologity may generate derived representations such as:

- thumbnails;
- previews;
- responsive sizes;
- compressed delivery versions; and
- other optimized assets.

The existence of derived versions must not alter the identity of the original media contribution.

## Image Quality

Image processing should favor preserving meaningful visual detail rather than aggressive compression solely to minimize infrastructure cost.

Historical photographs may contain small details whose value is not apparent when they are first uploaded.

Chronologity should therefore treat media quality as part of preserving useful historical context.

This does not require delivering original-resolution files in every interface.

## Video Quality

Video compression and transcoding should prioritize preserving perceptual quality while supporting reliable playback across supported devices and network conditions.

Chronologity should not treat the lowest possible bitrate as the primary product objective.

A historical media product benefits from retaining useful visual detail.

## Original Media

Chronologity should preserve the concept of an original uploaded media asset separately from delivery derivatives.

Conceptually:

```text
Original upload
      |
      +-- thumbnail
      +-- preview
      +-- responsive image
      +-- video rendition A
      +-- video rendition B
      +-- future derivatives
```

Derived assets are replaceable representations.

They are not independent Moments.

The exact retention policy for originals must align with privacy, deletion, storage, and product commitments.

## Media Processing

Some media requires asynchronous processing before all presentation forms are available.

A media item may therefore have user-visible states such as:

```text
uploading
uploaded / processing
ready
failed
```

The exact state names may differ in the interface, but Users should not be left unable to tell whether media is still being processed or has failed.

## Processing Is Not Publication Time

Media processing completion does not change when the Moment occurred.

It also should not silently redefine when the Moment was published.

Chronologity must preserve distinctions between:

- historical occurrence;
- Moment creation;
- Moment publication;
- media upload;
- media processing completion; and
- later derivative generation.

## Partial Processing

A Moment may contain many media items, some of which are ready while others are still processing.

Chronologity should not assume all-or-nothing processing unless required for a specific publication workflow.

For example:

```text
Moment
  +-- Image A: ready
  +-- Image B: ready
  +-- Video A: processing
  +-- Video B: failed
```

is a legitimate operational state that the product must be able to represent.

The User should be able to understand which items require attention.

## Partial Upload Failure

When some selected media uploads fail, Chronologity should preserve successfully uploaded items rather than forcing the User to restart the entire Moment upload.

The product should make failed items identifiable and retryable where possible.

For large Moments, failure isolation is essential.

## Retry Behavior

Retrying a failed media upload or processing operation should not create duplicate visible media when the logical media item already exists.

Technical retry behavior must preserve the User's intended media set and order.

## Drafts and Incomplete Uploads

Chronologity may need a draft or pre-publication state so Users can assemble Moments containing many media items without requiring the entire operation to succeed atomically.

The precise Moment draft model belongs in the Moment lifecycle specification, but media architecture and UX must support large multi-file composition without accidental publication of incomplete history.

## Publication Readiness

Chronologity should define what media conditions are required before a Moment can be published.

Potential policies include:

- every selected media item must be uploaded;
- videos may continue processing after publication;
- failed items must be resolved or explicitly removed;
- at least one media item must be ready;
- or another clearly defined rule.

This remains an open product decision.

Whatever rule is chosen must behave sensibly for Moments containing large numbers of media items.

## Media Replacement

Replacing media is not necessarily equivalent to editing metadata.

If Chronologity permits replacement of an image or video after publication, it must preserve historical integrity and make the semantics explicit.

A replacement should not silently cause materially different evidence to occupy the identity of the original media without traceability.

The precise edit-history model should align with `moments.md`.

## Media Removal

Removing a media item from a Moment must follow the Moment's editing and deletion semantics.

Removing media should not automatically delete the entire Moment unless the resulting Moment would violate a product invariant such as requiring at least one media item.

If a Moment may exist without media, that should be explicitly established elsewhere rather than inferred here.

## Media Identity

Each media item should have stable identity within Chronologity independent of:

- its current storage key;
- CDN URL;
- transcoded rendition;
- thumbnail URL;
- filename; or
- processing job.

Infrastructure identifiers must not become product identity.

## Filenames

Original filenames may be useful to the creator for upload diagnostics or organization, but they are not canonical historical labels.

Filenames may also contain sensitive device or personal information.

Chronologity should not expose original filenames publicly by default.

## Media Metadata

Media may carry metadata such as:

- dimensions;
- duration;
- orientation;
- capture timestamp;
- device information;
- geolocation;
- codec information; and
- other embedded fields.

Not all metadata is safe, accurate, or appropriate to expose.

Chronologity must distinguish technical metadata from authoritative historical assertions.

## EXIF and Embedded Location

Embedded image or video metadata may contain precise coordinates.

Chronologity must not automatically expose that precision merely because it exists in the uploaded file.

Location privacy rules apply before embedded location metadata becomes visible or participates in Discovery, Search, Timeline context, or notifications.

## Capture Time Metadata

Media capture timestamps may help Users establish Moment occurrence time or organize media.

However, device timestamps can be:

- wrong;
- missing;
- shifted by time zone;
- edited;
- inherited from exports;
- or otherwise unreliable.

Chronologity may use capture time as evidence or a suggestion.

It must not silently treat it as unquestionable historical truth.

## Metadata Corrections

Where media metadata influences visible historical context, Users should be able to correct relevant inaccuracies according to the applicable product rules.

Correcting a Moment's occurrence time should not require rewriting the underlying binary media file.

Chronologity should preserve the distinction between source metadata and authoritative product metadata.

## Media Orientation

Images and videos should display according to their intended orientation.

Chronologity should correctly interpret orientation metadata during processing and presentation.

A processing normalization should not be treated as a substantive edit to historical content.

## Media Integrity

Chronologity should avoid transformations that materially misrepresent User-uploaded media without explicit User intent.

Routine technical transformations such as resizing, transcoding, rotation normalization, or compression are acceptable when they preserve the represented content.

Transformations that alter substantive visual or audio meaning belong to a different product category and should not be silently applied.

## AI Media Modification

Chronologity should not automatically use generative AI to modify the historical content of uploaded images or videos.

Examples of prohibited silent transformations include:

- adding or removing people;
- reconstructing missing scene content as though authentic;
- changing backgrounds;
- altering expressions;
- replacing objects;
- fabricating frames; or
- otherwise generating visual evidence that did not exist in the upload.

Historical preservation requires a strong boundary between optimization and synthetic alteration.

## AI-Derived Metadata

AI may eventually derive metadata from media for Search, accessibility, moderation, or organization.

Examples include:

- scene descriptions;
- object labels;
- landmark suggestions;
- transcript generation;
- OCR;
- content classifications; and
- accessibility descriptions.

AI-derived metadata must retain provenance and must not silently become authoritative historical fact.

## Accessibility Metadata

Images should support meaningful alternative text or equivalent accessible description.

Videos should support accessibility mechanisms appropriate to their content, including captions where speech is present.

Chronologity should distinguish:

- User-authored accessibility descriptions;
- machine-generated accessibility descriptions; and
- machine-generated transcripts or captions.

Machine-generated accessibility content may be useful but should be correctable and should not be represented as User-authored.

## Video Captions

Video captions should be supported where speech or meaningful audio requires them.

Chronologity may eventually generate captions automatically, but generated captions should be reviewable or correctable where practical.

Caption text is a representation of audio, not a replacement for the original media.

## Audio

Videos may contain audio.

Chronologity's previously established playback behavior is that videos autoplay with sound on by default, with a future User preference to disable autoplay.

The product should ensure that audio behavior remains understandable and controllable, especially where accessibility, device state, or platform policies require different behavior.

Autoplay implementation must not compromise accessibility or User control.

## Autoplay

Where videos appear in supported Chronologity viewing experiences, autoplay is part of the intended product behavior.

However, autoplay must be implemented responsibly.

The experience must account for:

- multiple videos in view;
- large Moments;
- bandwidth;
- device performance;
- reduced-motion or accessibility preferences where applicable;
- platform restrictions;
- and User settings.

"Autoplay" does not mean every video in a large Moment should simultaneously play.

## Active Video

When multiple videos are visible or nearly visible, Chronologity should have deterministic rules for which video, if any, is actively playing.

The product should avoid overlapping audio from multiple videos.

The exact viewport and playback-selection behavior is a design decision.

## Manual Playback

Users must retain the ability to:

- play;
- pause;
- replay;
- seek where supported;
- mute or unmute;
- and otherwise control video playback.

Autoplay must not remove manual control.

## User Autoplay Preference

Chronologity should support a User preference to disable autoplay.

When autoplay is disabled, videos should remain directly playable.

The preference changes playback behavior only.

It does not affect media eligibility, historical significance, or ordering.

## Sound Behavior

Chronologity's intended default is autoplay with sound.

This is an unusually strong default compared with many social products and must be implemented with care.

Platform-level restrictions may prevent sound-on autoplay in some contexts; when that occurs, Chronologity should degrade predictably rather than creating inconsistent or misleading playback state.

Users should always have direct mute/unmute control.

## Bandwidth Awareness

Large Moments and video-heavy Moments can consume substantial bandwidth.

Chronologity should use adaptive delivery, progressive loading, and other techniques to avoid unnecessary transfer.

A User should not be forced to download every full-resolution asset in an unlimited-media Moment simply by opening it.

Bandwidth optimization must not redefine the Moment's media membership.

## Offline and Intermittent Connectivity

Chronologity should tolerate interrupted connectivity during upload and viewing.

For uploads, the product should preserve progress where technically practical and allow failed items to be retried.

For viewing, already available media may remain usable while unavailable assets communicate their state clearly.

Full offline support is not necessarily a day-one requirement.

## Upload Progress

Multi-file uploads should expose understandable progress.

For large Moments, a single percentage may be insufficient.

Chronologity should make it possible to understand:

- overall progress;
- individual failed items;
- items still uploading;
- items processing;
- and whether the User can safely leave the current screen.

The exact interface is a design decision.

## Background Uploads

Large Moments may take long enough that Users should not be forced to keep a single foreground screen open for the entire upload.

Chronologity should support resilient upload continuation within the capabilities of the platform.

Operating-system constraints may limit background execution.

The product should communicate those constraints clearly rather than silently losing upload state.

## Duplicate Media

Users may accidentally select the same file multiple times.

Chronologity may detect likely duplicates and warn the User.

However, automatic deduplication must be conservative.

The same underlying image may intentionally appear more than once in different presentation positions, and two visually identical files are not necessarily semantically interchangeable.

Chronologity should not silently remove User-selected media solely because hashes or visual similarity suggest duplication unless the product explicitly defines that behavior.

## Media Reuse Across Moments

The same source media may potentially relate to more than one Moment.

Chronologity should not assume that binary identity alone determines historical membership.

If media reuse is supported, each Moment's association must preserve its own context.

The architecture may deduplicate storage internally without collapsing product relationships.

## Media and Historical Significance

The number, size, quality, or format of media items must not directly determine a Moment's historical significance.

A Moment represented by one photograph may be more historically significant than a Moment represented by hundreds of files.

Likewise, video must not inherently outrank images.

Media richness and historical significance are separate concepts.

## Media and Timeline

A Moment occupies one position in the Timeline according to the Moment's occurrence semantics.

Its media items do not each create separate Timeline positions merely because they have individual capture timestamps.

Temporal zoom must treat the Moment as the historical unit unless another explicit historical entity is involved.

## Media and Historical Jumps

Historical jumps should lead to Moments, Events, or other defined historical entities---not arbitrary media renditions.

A deep link may open a particular media item within a Moment for convenience, but the historical destination remains the Moment context.

## Media and Feed

A Moment appears in the Feed as a Moment, regardless of how many media items it contains.

The Feed must be capable of representing mixed and large media sets without allowing media count to dominate chronology.

Adding another media item through a permitted edit must not automatically make the Moment chronologically new.

## Media and Discovery

Discovery may use media-derived signals to identify potentially relevant Moments.

Those signals must not turn inferred visual similarity into authoritative historical relationships.

Discovery should recommend the Moment, not treat a thumbnail or rendition as an independent historical object.

## Media and Search

Search may eventually index authorized media-derived metadata such as captions, transcripts, OCR, or landmark suggestions.

Search results should preserve the Moment as the historical unit unless the product explicitly provides an internal media match.

A matching frame or image may explain why the Moment matched without becoming a separate historical record.

## Media and Privacy

Media visibility follows the applicable Moment and privacy semantics.

Chronologity must also account for media-specific privacy risks, including:

- embedded geolocation;
- faces;
- bystanders;
- minors;
- documents visible in images;
- license plates;
- screens;
- audio conversations;
- and other sensitive information.

The existence of media does not weaken privacy requirements.

## Media and People

A media item may depict people who are not Chronologity Users.

Chronologity must not equate:

```text
Person visible in media
        =
Chronologity User identity
```

Any tagging, recognition, or identity association must follow identity and privacy rules.

## Face Recognition

Chronologity should not assume face recognition is necessary merely because it could improve media organization or Search.

Face recognition creates substantial privacy, consent, and abuse risks.

If ever considered, it requires a separate explicit product and privacy decision.

It should not emerge implicitly from a media-processing implementation.

## Media and Moderation

Media is subject to Chronologity moderation and safety policies.

Historical value does not create an unlimited right to distribute prohibited content.

Moderation may:

- restrict visibility;
- remove media;
- require warnings;
- prevent recommendation;
- prevent Search indexing;
- or remove the entire Moment where appropriate.

The moderation specification defines these policies.

## Sensitive Media

Some historically legitimate media may contain:

- violence;
- injury;
- death;
- nudity;
- traumatic events;
- disasters;
- war;
- or other sensitive material.

Chronologity should be able to preserve historical context while applying warnings, access restrictions, preview suppression, or other appropriate protections.

The exact policy belongs in moderation documentation.

## Media Deletion

When media is deleted under applicable product rules, Chronologity must remove or make inaccessible its derived representations according to privacy, retention, and legal requirements.

Deletion responsibilities may include:

- originals;
- thumbnails;
- transcodes;
- previews;
- cached copies;
- Search-derived metadata;
- AI-derived metadata;
- temporary upload artifacts; and
- other derivatives.

Deletion must not stop at the primary storage object.

## Media Privacy Changes

When a Moment's visibility becomes more restrictive, media delivery must follow the new authorization state.

Previously public URLs, cached assets, derivatives, and external delivery paths must not become permanent privacy bypasses.

The architecture must support revocable access where product privacy requires it.

## Sharing Media

If Chronologity supports sharing, the primary shared object should ordinarily be the Moment rather than a raw storage URL.

A shared media-specific deep link may identify an item within the Moment, but access must still resolve through current authorization.

Infrastructure URLs must not become permanent public capabilities by accident.

## Downloading

Whether Users may download original or derived media belonging to themselves or others requires an explicit product decision.

Viewing permission does not automatically imply permission to obtain an unrestricted original file.

Chronologity should distinguish:

```text
view
share
download
```

rather than assuming they are identical rights.

## Screenshots and External Capture

Chronologity cannot guarantee that visible media cannot be captured externally through screenshots, screen recording, cameras, or other means.

Product privacy should not make impossible promises.

The system should nevertheless avoid making unauthorized extraction easier through permanent raw asset URLs or unnecessarily exposed originals.

## Media Ownership and Rights

Uploading media does not itself prove that the uploader owns all intellectual-property or privacy rights associated with it.

Chronologity's legal and moderation policies must address rights and takedown processes.

The product model should preserve uploader attribution without presenting it as a legal determination of ownership.

## Media Product Invariants

1.  A Moment is the historical unit; a media file is not a Moment.
2.  A Moment may contain an unlimited number of images and videos at the product-model level.
3.  Images and videos may coexist within the same Moment.
4.  Media count must not determine Moment boundaries.
5.  Operational safeguards may regulate resource consumption without redefining the unlimited-media product model.
6.  Each individual video has a maximum duration of 90 seconds.
7.  The 90-second limit is per video, not cumulative across the Moment.
8.  A video longer than 90 seconds should have a clear trimming path where supported.
9.  Media within a Moment has deterministic presentation order.
10. Media order does not inherently establish chronology or causality.
11. Cover media affects presentation only.
12. Large Moments must remain usable without loading every asset at once.
13. Internal media pagination or incremental loading must not create multiple Moments.
14. Visual grouping within a large Moment must not silently create Sub-Moments.
15. Derived image and video renditions do not become independent historical entities.
16. Media processing states must be understandable to the User.
17. Processing completion must not alter historical occurrence time.
18. Partial processing and partial upload failure must be representable.
19. Successful media items should not ordinarily be discarded because another item failed.
20. Technical retries must not create duplicate visible media.
21. Media identity must remain independent of storage URLs, filenames, renditions, and processing jobs.
22. Original filenames are not canonical historical labels and should not be publicly exposed by default.
23. Embedded metadata is not automatically authoritative historical truth.
24. Embedded geolocation must not bypass Location privacy.
25. Device capture time may inform historical context without becoming unquestionable occurrence truth.
26. Routine technical transformations must preserve substantive media meaning.
27. Chronologity must not silently use generative AI to alter uploaded historical media.
28. AI-derived media metadata must preserve provenance and uncertainty.
29. Accessibility descriptions, captions, and transcripts must distinguish User-authored and machine-generated content where relevant.
30. Users retain direct control over video playback.
31. Autoplay must not cause multiple videos to produce overlapping audio.
32. Chronologity should support a User preference to disable autoplay.
33. Autoplay preferences affect playback only, not history or media membership.
34. Large Moments must not force unnecessary full-resolution downloads.
35. Multi-file upload progress and failures must be understandable.
36. Duplicate detection must not silently discard intentionally repeated media.
37. Binary storage deduplication must not collapse distinct product associations.
38. Media quantity and format do not determine historical significance.
39. A Moment has one Timeline position regardless of the number of media items it contains.
40. Individual media capture timestamps do not automatically create separate Timeline positions.
41. Historical jumps should preserve Moment context even when opening a specific media item.
42. Adding media through an allowed edit must not make a Moment chronologically new.
43. Media-derived Search or Discovery signals must not silently create authoritative historical relationships.
44. Media visibility must respect Moment privacy and media-specific privacy risks.
45. A person depicted in media is not automatically a Chronologity User identity.
46. Face recognition requires an explicit future product and privacy decision and must not emerge implicitly.
47. Historical value does not exempt media from moderation.
48. Sensitive historical media may require warnings or restricted presentation.
49. Media deletion must propagate to applicable derivatives and caches.
50. Privacy changes must propagate to media delivery and derived assets.
51. Raw infrastructure URLs must not become accidental permanent access capabilities.
52. Viewing, sharing, and downloading are distinct permissions.
53. Chronologity must not promise prevention of external screenshots or capture.
54. Uploader identity does not by itself establish legal ownership of uploaded media.

## Day-One Requirements

Before launch, Chronologity must explicitly define and support:

- images and videos as Moment media;
- mixed media within one Moment;
- unlimited media per Moment at the product-model level;
- the 90-second per-video maximum;
- handling of selected videos longer than 90 seconds;
- deterministic media ordering;
- cover/representative media behavior if exposed;
- large-Moment presentation;
- incremental media loading;
- supported image formats;
- supported video formats;
- per-file size constraints;
- upload progress;
- individual upload failure;
- retry behavior;
- duplicate upload protection;
- user-visible processing states;
- video processing behavior;
- image processing behavior;
- publication readiness rules;
- media removal/edit behavior consistent with Moment semantics;
- original-versus-derived asset semantics;
- video playback controls;
- autoplay behavior;
- sound behavior;
- User autoplay preference if it is part of the initial product commitment;
- prevention of overlapping autoplay audio;
- bandwidth-aware delivery;
- embedded metadata privacy;
- Location metadata handling;
- deletion propagation;
- privacy-change propagation;
- moderation integration;
- accessible images and videos;
- captions or an explicit launch policy for video accessibility;
- and behavior for very large media collections.

The initial release does not require:

- long-form video;
- videos longer than 90 seconds;
- a cumulative video-duration allowance;
- Sub-Moments;
- AI-generated captions for Moment descriptions;
- generative alteration of uploaded media;
- face recognition;
- automatic Person identification;
- semantic visual Search;
- OCR Search;
- transcript Search;
- AI landmark recognition;
- advanced media clustering;
- automatic highlight reels;
- collaborative media editing;
- arbitrary filters or visual effects;
- public original-file downloads;
- offline access to entire large Moments;
- or perfect background uploading on platforms that prohibit it.

Chronologity should solve reliable capture, preservation, processing, and presentation before adding AI-heavy media interpretation.

## Open Product Questions

The following questions require deliberate resolution:

- Must every Moment contain at least one image or video?
- Can a text-only Moment ever exist, or is media fundamental to Moment identity?
- Which image formats are accepted on day one?
- Which video formats are accepted on day one?
- What are the maximum per-file image and video sizes?
- Should per-file size limits differ by platform?
- Should Chronologity impose any account-level storage quota?
- If so, how do we preserve the invariant that a Moment itself has no media-count limit?
- Should paid storage tiers ever exist?
- Would storage monetization distort the historical-preservation mission?
- How should abuse-oriented upload limits differ from product-level limits?
- How many files may upload concurrently from one device?
- Should concurrency adapt to network quality and device capability?
- How should extremely large Moments be composed before upload?
- Should Users be able to select hundreds or thousands of files at once?
- What platform picker limits constrain this?
- Should Chronologity provide its own multi-stage media selection workflow for very large Moments?
- Is there a draft state for assembling a Moment over multiple sessions?
- Can Users add more media to an unpublished draft later?
- Can Users add media after a Moment has been published?
- If yes, does that count as editing the historical record?
- How should the edit be represented?
- Can media be reordered after publication?
- Can cover media be changed after publication?
- Can a published media item be replaced?
- If replacement is allowed, how is the original retained or represented in edit history?
- Can media be removed after publication?
- What happens if the last media item is removed?
- What makes a Moment ready to publish?
- Must all uploads finish first?
- Must all images finish processing?
- May videos continue transcoding after publication?
- Can a Moment publish when one selected media item has failed?
- Should the User explicitly confirm removal of failed media before publication?
- How should a partially processed Moment appear to other Users?
- Should unfinished media placeholders be visible to viewers?
- Should only the creator see processing placeholders?
- How long may media remain in processing before it is considered failed?
- Should a long-running successful processing job create a notification?
- What is the exact trimming UX for videos longer than 90 seconds?
- Can a User create multiple \<=90-second clips from one source video and add all of them to the same Moment?
- The product model permits this; should the UI make it easy?
- Should Chronologity ever automatically split a long source video into multiple clips? The recommended default is no unless the User explicitly chooses that operation.
- If automatic assistance exists, must the User approve every resulting clip?
- What video aspect ratios are supported?
- Should vertical, horizontal, and square video all be first-class?
- Should Chronologity crop media automatically? The recommended default is to preserve the full media and use presentation framing rather than destructive crop.
- How are panoramic images presented?
- How are animated image formats handled?
- Are Live Photos or equivalent compound formats supported?
- If supported, are they represented as image-plus-video, one compound media item, or converted?
- Are burst photos supported as independent images?
- How should RAW images be handled?
- Are originals retained indefinitely while the Moment exists?
- Can Users request their original uploads?
- Can viewers download media?
- If download exists, do they receive originals or delivery derivatives?
- Should creators be able to disable downloads?
- Is a cover media item required?
- If no cover is chosen, how is the representative media selected?
- Should the first media item be the default cover?
- Can video be cover media?
- If video is cover media, should a poster frame represent it in static contexts?
- How is the poster frame selected?
- Can the User choose a video poster frame?
- How should media ordering work during multi-file selection?
- Should initial order follow picker selection order, capture time, filename, or another rule?
- The recommended default is explicit selection order where the platform provides it, with User reordering available.
- How should drag-and-drop/reordering scale to hundreds of media items?
- Should large Moments support sections purely for navigation?
- If sections exist, are they User-authored presentation metadata rather than Sub-Moments?
- Should sections have names?
- Could sections accidentally become a second Timeline hierarchy?
- What large-Moment threshold changes the presentation?
- Should that threshold be implementation-specific rather than product-visible?
- Should media retrieval use an internal cursor without exposing pagination to the User?
- How much media should preload around the current viewport?
- Should preload behavior differ on cellular versus Wi-Fi?
- Should Users have a "data saver" preference?
- Should video autoplay be disabled automatically under data saver?
- Does that conflict with the established default autoplay behavior, or is it an explicit User override?
- Should autoplay with sound be the launch default on every platform where technically permitted?
- How should Chronologity behave where operating systems or browsers prohibit sound-on autoplay?
- Should the app remember mute state across videos?
- Should mute state be session-scoped, account-scoped, or per-device?
- Is autoplay preference account-scoped or device-scoped?
- Should reduced-motion preferences disable autoplay automatically?
- How should accessibility requirements interact with autoplay?
- When multiple videos are visible, what determines the active video?
- Should scrolling stop playback immediately or after a visibility threshold?
- Should offscreen videos pause automatically? The recommended answer is yes.
- Should videos loop automatically?
- If so, should looping differ between Timeline previews and full Moment depth?
- Should video controls always be visible or appear on interaction?
- Should video seeking be available for all videos?
- Should playback speed controls exist?
- Should picture-in-picture exist?
- Should AirPlay/Cast or equivalent external playback be supported?
- Which of these belong in day one versus later?
- Should image zoom and pan exist?
- Should Users be able to enter a full-screen media viewer?
- How does full-screen viewing preserve the Moment context?
- Should swiping between media items in full-screen mode follow User-defined media order?
- How should a User return to the exact Timeline depth and position after viewing media?
- Should individual media items have deep-linkable anchors?
- If so, do those links remain stable after media reorder?
- Should a deep link to removed media resolve to the Moment with an unavailable state?
- How are media-specific accessibility descriptions authored?
- Is alt text required, optional, or machine-assisted?
- Should Chronologity generate accessibility descriptions automatically?
- If generated, how are they labeled and corrected?
- Are video captions required before publication when speech is detected?
- Would that make large uploads impractically slow?
- Should auto-generated captions be available after publication?
- Can creators edit generated captions?
- Should viewers be able to report caption inaccuracies?
- Are transcripts stored separately from captions?
- Should transcripts ever become searchable?
- How are multilingual videos captioned?
- How should non-speech audio be represented accessibly?
- Should media retain original color profiles?
- How much image compression is acceptable?
- What quality target should video transcoding use?
- Should originals be used to regenerate future higher-quality derivatives?
- How do we prevent infrastructure cost from incentivizing destructive loss of historical media quality?
- Should Chronologity expose an "original quality" viewing option?
- Should original-resolution viewing be restricted to the creator?
- How should HDR images and videos be handled?
- How should older codecs or unusual historical media formats be imported?
- Should Chronologity support media created before modern metadata standards?
- How should scanned photographs be represented?
- Should Users be able to indicate that an image is a scan of a physical historical photograph?
- Would that metadata belong in media or Moment context?
- How should media capture time differ from scan/import time?
- Should media capture timestamps ever be shown publicly?
- How do we handle a Moment whose media items have capture timestamps spanning hours, days, or longer?
- Does that indicate the Moment occurrence range may be wrong, or can one Moment legitimately span that period?
- Should Chronologity warn rather than automatically split the Moment?
- The recommended behavior is to preserve User intent and surface a warning/suggestion rather than silently creating multiple Moments.
- Should EXIF capture time automatically propose Moment occurrence time?
- Should embedded coordinates automatically propose a Location?
- If so, must the User confirm before the data becomes authoritative or public?
- The recommended answer is yes for sensitive historical metadata.
- Should EXIF be stripped from public delivery derivatives?
- Which metadata should originals retain internally?
- Should device make/model ever be exposed?
- Should filenames ever be searchable by the creator?
- Should filenames be removed from public metadata entirely?
- How should duplicate detection work?
- Should exact binary duplicates trigger a warning?
- Should visually similar images trigger a warning?
- Should duplicate warnings be advisory only? The recommended answer is yes.
- Can one uploaded asset be associated with multiple Moments?
- If yes, how should edits/deletion of one association affect the others?
- Should Chronologity internally deduplicate identical media across Users?
- What privacy and side-channel risks would cross-User deduplication create?
- Should cross-User storage deduplication be prohibited even if technically efficient?
- How are media rights handled when the same photograph is uploaded by different Users?
- Should Users be able to tag People in individual media items or only at the Moment level?
- If media-level tagging exists, how does it interact with Person privacy and Moment-level context?
- Should Chronologity ever detect faces solely for moderation or accessibility without identifying them?
- Should face recognition be rejected as a product capability?
- Should license plates, documents, or other sensitive details be automatically detected?
- If detected, should Chronologity suggest redaction rather than silently altering the original?
- If redaction tools exist, should the original remain privately preserved?
- Would preserving an unredacted original create privacy obligations that outweigh historical value?
- How should minors depicted in media be handled?
- Which sensitive media requires warnings?
- Are warnings attached to individual media or the entire Moment?
- If one image is graphic, should the whole Moment be warning-gated?
- Can individual sensitive media remain blurred while other media in the Moment is visible?
- How should moderation of one media item affect a multi-media Moment?
- Can the remaining Moment stay available?
- Does removal of a media item require a visible historical-edit indicator?
- How quickly must deleted media disappear from CDN caches?
- How are transcodes and thumbnails invalidated after privacy changes?
- Should private media use signed URLs or another revocable mechanism? This is architectural, but the product requires revocability.
- How long may temporary upload artifacts persist after failed or abandoned uploads?
- How should account deletion affect original media and derivatives?
- Which media, if any, may be retained for legal or abuse-prevention reasons?
- How should exports work if Users request a copy of their Chronologity data?
- Should exports contain original uploads?
- Should exports preserve media ordering and Moment associations?
- Should Chronologity support importing media from external photo libraries or cloud services later?
- If so, how are occurrence time, Location, and metadata provenance preserved?
- Should bulk import be a separate product workflow?
- How does bulk import avoid flooding followers with notifications?
- How does bulk import avoid making old Moments appear newly occurring?
- Should imported media be processed identically to newly captured media?
- What metrics should define media quality?
- Upload success rate?
- Processing success rate?
- Time to first viewable media?
- Playback startup latency?
- Rebuffer rate?
- Compression quality?
- Failure recovery?
- How should media metrics avoid incentivizing lower quality solely for speed?
- What is the acceptable experience when one Moment contains thousands of media items?
- Should Chronologity explicitly test 10,000-media Moments as a product-scale invariant even if ordinary Moments are much smaller?
- What practical upper bounds must infrastructure support before operational controls intervene?
- How should such controls be communicated without turning them into a semantic Moment limit?

These questions should be resolved before media infrastructure hardens assumptions about count limits, editing, processing, playback, metadata, privacy, or long-term preservation.

## Architecture Constraints

This document does not prescribe object-storage providers, multipart-upload protocols, CDN vendors, codecs, transcoding software, Kafka topics, worker implementations, database schemas, or cache architecture.

It does impose architectural constraints.

The architecture must represent:

```text
Moment
  |
  +-- ordered media association 1
  +-- ordered media association 2
  +-- ordered media association 3
  +-- ...
```

without a product-level media-count ceiling.

Media identity must remain stable independently of physical storage location and derived rendition URLs.

The system must distinguish:

```text
original media
        !=
derived rendition
        !=
Moment
```

and:

```text
capture metadata
        !=
authoritative Moment occurrence semantics
```

Upload and processing workflows must tolerate partial success.

The system must not require one giant atomic transaction across every file in a potentially large Moment.

Processing must be asynchronous where necessary without allowing processing timestamps to redefine occurrence or publication semantics.

The architecture must support deterministic media ordering and scalable retrieval of media subsets within one Moment.

It must support retry and idempotency so network retries, worker retries, and duplicate message delivery do not create duplicate visible media.

The architecture must support the 90-second limit per individual video without introducing an accidental cumulative-duration constraint.

Original assets and all derived assets must participate in deletion and privacy-change workflows.

Private or restricted media delivery must remain revocable; static asset URLs must not become accidental permanent authorization tokens.

Embedded metadata must be treated as potentially sensitive input.

Derived AI metadata, transcripts, OCR, accessibility descriptions, and other future enrichments must retain provenance and be independently correctable or removable without modifying the original media.

The architecture must support large Moments without requiring:

- all media metadata in one database row;
- all binaries to be loaded simultaneously;
- all processing to complete in one transaction;
- all media to be returned in one API response; or
- every media item to be eagerly downloaded by clients.

Storage optimization may deduplicate physical data where safe, but it must not collapse distinct Moment-media relationships or create privacy side channels.

Finally, the media architecture must assume that historical value can increase over time. Original and high-quality media should not be destructively discarded merely because today's delivery format does not need their full information content unless Chronologity explicitly adopts a retention policy permitting that loss.

## Guiding Principle

When making a media product decision, ask:

> **Does this preserve the Moment as the historical unit while allowing Users to represent that experience with as much image and video evidence as it genuinely requires?**

Infrastructure should scale around the Moment model.

The Moment model should not shrink to accommodate infrastructure convenience.
