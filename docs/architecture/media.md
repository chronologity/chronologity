# Chronologity Media Architecture

## Purpose

This document defines the media architecture for Chronologity.

Media is central to the Moment model, but media files themselves are not Moments and must not become embedded directly into EventStoreDB, Kafka, or ordinary relational payloads.

Chronologity must support:

- unlimited images and videos per Moment at the product level;
- a 90-second maximum duration for each video;
- high-quality image and video preservation;
- direct-to-object-storage upload;
- resumable and retryable upload flows;
- asynchronous metadata extraction;
- image processing;
- video transcoding;
- thumbnails and poster frames;
- moderation and safety processing;
- revocable media access;
- privacy changes;
- deletion;
- derivative regeneration;
- media pagination inside Moment depth;
- mobile-friendly delivery;
- observability and recovery.

This document is grounded in the finalized Moment product specification and the established architecture documents for the API, events, messaging, projections, data storage, Timeline, and feed aggregator.

## Core Principle

A Moment may contain an unlimited number of media items.

That is a **product semantic**.

It does not mean any one technical operation should be unbounded.

```text
unlimited product-level media membership
        ↓
bounded technical operations
        ↓
pagination
batching
resumable uploads
background processing
incremental delivery
```

The architecture must preserve the product rule without introducing hidden arbitrary media-count limits.

## Media Is Not the Moment

A Moment is the historical unit.

Media is associated with that Moment.

```text
Moment
    ├── Image
    ├── Image
    ├── Video
    ├── Image
    └── ...
```

A media item does not become a nested Sub-Moment.

The architecture must not reintroduce recursive chronology through media structure.

## Media Types

Chronologity initially supports:

```text
image
video
```

Additional media types require an explicit product decision.

## Video Duration

Each video is limited to:

```text
90 seconds
```

This is a product rule.

It should be enforced at multiple layers where appropriate:

```text
mobile preflight
        ↓
upload metadata validation
        ↓
server-side metadata verification
        ↓
processing/transcoding pipeline
```

Client validation improves UX.

Server-side verification remains authoritative.

## Media Count

There is no product-level cap on:

```text
number of images per Moment
number of videos per Moment
combined media count per Moment
```

Operational systems may impose page size, upload concurrency, batch size, request payload size, or processing concurrency.

Those are implementation bounds, not Moment media-count limits.

## Canonical Media Boundary

The canonical API includes:

```text
features/uploads/
```

and integrations such as:

```text
integrations/storage/
integrations/transcoder/
integrations/metadata/
```

These boundaries remain distinct.

## Upload Feature

The Upload feature owns authoritative upload lifecycle.

Potential states include:

```text
registered
uploading
received
validating
processing
ready
failed
deleted
```

The exact state machine belongs in focused implementation specifications.

## Media Identity

Each media item should have a stable application-generated Media ID or Upload ID before object storage is finalized.

This enables direct-upload authorization, retries, processing state, Moment association, callback deduplication, and projection updates.

Object-storage keys are infrastructure details.

## Object Storage

Object storage owns media bytes.

It stores:

- original images;
- original videos;
- thumbnails;
- resized images;
- poster frames;
- video transcodes;
- other approved derivatives.

Object storage does not own Moment semantics.

## Direct Upload

Media should upload directly from the client to object storage using a short-lived authorized upload mechanism.

```text
Mobile
  ↓
RegisterUpload
  ↓
API
  ↓
signed/resumable upload authorization
  ↓
Mobile → Object Storage
```

The API should not proxy all media bytes.

## Upload Registration

Before direct upload, the client requests an authoritative upload registration.

The API may record:

- Upload ID;
- User ID;
- intended media type;
- expected size;
- expected content type;
- associated draft/Moment context where applicable;
- registration time;
- expiration;
- processing state.

## Upload Authorization

Upload authorization must be scoped to the object, User, media type, maximum size, expiration, and allowed operation.

A signed upload URL must not permit arbitrary writes.

## Multipart and Resumable Upload

Large media uploads should support resumability through multipart upload, resumable upload sessions, or equivalent provider functionality.

## Upload Concurrency

The mobile client should use bounded parallel upload concurrency.

A Moment containing many media items should not launch hundreds of simultaneous uploads.

The exact concurrency limit is a technical tuning value, not a product media limit.

## Upload Completion

Client upload success is not enough to make media authoritative.

The server should verify that the expected object exists and satisfies validation requirements.

```text
client upload complete
        ↓
FinalizeUpload
        ↓
storage verification
        ↓
authoritative state transition
```

## Trust Boundary

The API must not trust client-declared file type, duration, dimensions, checksum, or upload completion without verification where correctness or security requires it.

## MIME and Format Validation

Declared MIME type should be compared with observed or decoded media type where practical.

A filename or client MIME header is not proof.

Images should be decodable and within technical dimension/resource limits.

Videos should be decodable, supported or transcodable, and no longer than 90 seconds.

## File Size

Technical maximum file sizes should protect storage cost, abuse, processing capacity, and mobile UX.

These are per-file technical limits, not per-Moment media-count limits.

Exact sizes belong in technical constraints.

## Original Media Preservation

Chronologity prioritizes media quality.

The recommended default is to retain original uploads unless privacy, legal, cost, or explicit product policy permits removal.

Original retention enables future higher-quality derivatives, transcoder improvements, verification, and migration.

## Derivatives

Processed derivatives may include:

```text
image thumbnail
image display sizes
video poster frame
video preview
video streaming renditions
```

Derivatives are read/delivery optimizations.

They are not authoritative domain state.

## Derivative Regeneration

If originals remain available, derivatives should be regenerable.

This enables codec upgrades, CDN migration, resolution changes, and quality improvements.

## Image Processing

Image processing may include orientation normalization, resizing, thumbnail generation, format conversion, and metadata extraction.

It must not silently alter historical meaning.

## Video Transcoding

Video transcoding should produce delivery-friendly renditions optimized for mobile compatibility, bandwidth adaptation, quality preservation, efficient seeking, and CDN delivery.

The exact encoding ladder belongs in media technical specifications.

## Autoplay

The product expects video autoplay with sound by default, with a later User preference to disable autoplay.

Autoplay is primarily a mobile/client concern.

The backend must support fast-start delivery suitable for autoplay without encoding autoplay policy into authoritative media state.

## Streaming

A streaming format such as HLS may be appropriate.

The exact protocol/provider should be selected based on mobile compatibility, CDN support, transcoding cost, startup latency, and adaptive bitrate requirements.

## Poster Frames

Video poster frames should be generated asynchronously.

They support Timeline preview, loading placeholders, and efficient rendering.

Poster frame selection is derived media metadata.

## Media Metadata

Media metadata may include media ID, upload ID, type, dimensions, duration, orientation, codec/container, checksum, processing state, storage references, derivative references, and technical capture metadata.

## Metadata Authority

Technical metadata may be trusted after server-side extraction.

Historical metadata requires stronger semantics.

```text
EXIF capture time
        ≠
authoritative Moment occurrence time
```

unless product-defined validation/acceptance makes it so.

## Embedded Metadata

Embedded metadata may be missing, incorrect, manipulated, or timezone ambiguous.

Chronologity may use it as evidence or suggestion, but it must not silently overwrite authoritative historical time.

## GPS Metadata

Embedded GPS metadata is sensitive.

It should not automatically become a public Location.

If used, it must flow through privacy policy, Location semantics, and User confirmation or product-defined acceptance.

## Metadata Extraction

Metadata extraction should run asynchronously after upload receipt.

```text
UploadReceived
    ↓
MetadataExtractionRequested
    ↓
metadata worker
    ↓
MetadataExtracted
    ↓
application workflow
```

## Processing Workflow

A typical media-processing flow is:

```text
RegisterUpload
    ↓
client direct upload
    ↓
FinalizeUpload
    ↓
verify object
    ↓
extract metadata
    ↓
validate media
    ↓
transcode/process
    ↓
generate derivatives
    ↓
mark ready
```

Failures must be explicit and recoverable.

## Processing State

Media-processing state should not be inferred from object existence alone.

Potential states:

```text
pending
received
validating
processing
ready
failed
deleted
```

## Failure and Retry

A processing failure should include a safe error category, retryability, attempt count, and operational correlation data.

Transient failures may retry.

Permanent failures such as invalid media, unsupported format, or video longer than 90 seconds must not retry forever.

## Idempotency

Media-processing consumers must be idempotent.

Duplicate processing requests must not create conflicting derivatives or duplicate authoritative transitions.

## Provider Callbacks

External provider callbacks are untrusted.

They must be authenticated or verified, schema validated, deduplicated, and mapped to the correct Upload/Media ID.

Provider callback existence is not authoritative truth by itself.

## Media Association with Moment

A media item becomes part of a Moment through authoritative domain association.

Uploading media alone does not imply that it belongs to a published Moment.

## Draft Media

Media may exist before Moment publication.

```text
uploaded media
        ≠
published Moment media
```

This allows draft composition, retries, reordering, and abandonment.

## Media Ordering

Media ordering within a Moment is authoritative product state.

The system should represent stable order without relying on object-storage key ordering.

## Reordering

If Users can reorder media, the change should be authoritative and represented explicitly by the Moment domain model.

## Adding and Removing Media

Adding or removing media after Moment creation must follow the finalized Moment edit/immutability semantics.

Removing a media association is distinct from deleting the underlying stored object.

## Shared Media Objects

Chronologity should avoid cross-User shared physical media references unless explicitly designed.

Global deduplication can create privacy, deletion, and ownership ambiguity.

Checksum equality does not automatically justify shared storage ownership.

## Moment Publication

The exact publishability rule must be explicit.

The recommended initial model is:

```text
required media validated/ready
        ↓
Moment publishable
```

This avoids broken Moments entering the Timeline.

If later product needs allow processing after publish, placeholders, failure recovery, and projection state must be explicit.

## Unlimited Media and Publication

A Moment with a very large media collection must not require one giant transaction.

Use bounded workflows that validate and associate media incrementally while preserving publication semantics.

## Media Read Models

Derived media read models may contain delivery references, derivative types, dimensions, duration, poster frames, readiness, ordering, and accessibility metadata.

Do not store long-lived signed URLs as durable read-model truth.

## Signed URLs

Signed URLs should be generated near delivery time and have bounded lifetime.

Read models should store media identity and derivative/storage references instead.

## Public and Private Media

Public accessibility does not imply public storage administration.

Private media requires Viewer authorization before delivery metadata is returned.

Private delivery credentials must expire so revocation can take effect.

## CDN

A CDN should serve media efficiently through edge caching, byte-range support where appropriate, streaming delivery, image delivery, and bounded invalidation/expiration.

The CDN is delivery infrastructure, not domain authority.

## Timeline Media

Timeline slices should return lightweight media summaries such as preview image, poster frame, aspect ratio, duration, and media type.

Do not return a Moment's complete media collection for every Timeline node.

## Moment Depth Media

Moment depth should expose the full collection through pagination.

A typical GraphQL model may use a media connection with nodes and page information.

## Media Pagination

Media pagination must preserve stable ordering.

A cursor may use Moment ID, media ordinal, and media ID or an equivalent deterministic ordering scheme.

## Media Prefetch

The client may prefetch nearby media, but prefetch must be bounded based on connection quality, device memory, playback position, and User settings.

## Image Delivery

Images should support responsive derivatives such as thumbnail, Timeline, detail, and full-resolution forms.

Exact widths and formats belong in technical specs.

## Video Delivery

Video delivery should support at least Timeline preview/poster and playback-ready rendition, with adaptive quality where adopted.

## Mobile Cache

The mobile app may cache downloaded media.

Client cache is disposable and must respect privacy/logout behavior where appropriate.

## Offline Media

Offline media support is not implied by caching.

Explicit offline saving would require separate product/security semantics.

## Accessibility

Media should support accessibility metadata where available.

Distinguish:

```text
Moment caption/text
video closed captions
image alt text
```

These are separate semantics.

The architecture must not assume AI-generated captions are authoritative or mandatory.

If AI later suggests accessibility metadata, provenance and correction semantics must remain explicit.

## Moderation

Media moderation may inspect image content, video frames, audio, and metadata.

Automated moderation outputs are signals or evidence.

The moderation domain decides authoritative enforcement.

## Restricted Media

When content is restricted:

- delivery URLs must no longer be issued to unauthorized Viewers;
- CDN invalidation/expiry applies;
- Timeline projections suppress the content;
- retained originals may remain for appeal/evidence according to policy.

## Privacy

Media privacy follows Moment/resource authorization.

Storage ACLs alone must never define product visibility.

Exact GPS/EXIF data should not be placed into ordinary media read models without explicit need and authorization.

## Account and Moment Deletion

Deletion must coordinate:

- original objects;
- derivatives;
- projections;
- CDN;
- retention requirements.

Unassociated uploads must eventually expire and be cleaned up.

## Orphan Detection

The system should detect:

- object without Upload record;
- Upload record without object;
- derivative without source;
- Moment media reference to unavailable object.

## Object Key Design

Object keys should avoid sensitive information.

A reasonable shape is:

```text
media/<mediaId>/original
media/<mediaId>/derivatives/...
```

or equivalent.

## Checksums

Checksums support integrity, upload verification, and corruption detection.

They must not automatically imply shared ownership or global deduplication.

## Untrusted Media Safety

Uploaded media is untrusted.

Processing should guard against malformed files, decompression bombs, decoder vulnerabilities, excessive dimensions, and resource exhaustion.

Media decoders/transcoders should run with bounded CPU, memory, timeouts, and restricted privileges where practical.

## Processing Backpressure

Upload spikes should create bounded queue lag rather than overload API HTTP processes.

Media workers scale independently.

## Messaging

Media workflow messages may include:

```text
MediaProcessingRequested
MediaProcessingCompleted
MediaProcessingFailed
MediaMetadataExtractionRequested
```

Messages reference Media/Upload IDs.

They never carry media bytes.

## Storage Responsibilities

EventStoreDB may record authoritative Upload/Moment lifecycle events.

PostgreSQL may store metadata, processing state, provider job IDs, callback deduplication, workflow state, and projections.

ClickHouse contains lightweight media summaries required by Timeline composition.

Kafka transports workflow signals.

Object storage contains the bytes.

## Media Worker Deployment

Media workers should run separately from API HTTP processes.

They may initially remain under the same code ownership boundary while deploying independently.

## Canonical Ownership

```text
API
    → upload registration, authoritative lifecycle,
      Moment media association, privacy/deletion commands

Media workers
    → technical processing

Object storage
    → bytes

Feed aggregator
    → media read composition

Mobile
    → capture/selection/upload UX and playback
```

## Mobile Upload State

The mobile app may track local states such as queued, uploading, uploaded, processing, ready, and failed.

Client state is UX state.

Server state remains authoritative.

## Retry UX

Users should be able to retry failed media independently without rebuilding an entire Moment draft.

Stable per-media IDs enable this.

## Draft Recovery

The mobile app should preserve draft composition state where appropriate, especially for large Moments.

## Background Upload

Background upload support should be evaluated for iOS and Android.

The architecture should not require every upload to complete while the app remains foregrounded if platform capabilities permit more reliable behavior.

## Network Changes

Upload workflows should tolerate interrupted connectivity, app suspension, retries, and network transitions.

## Quality Preservation

Chronologity prioritizes quality.

Prefer original upload followed by server-controlled derivatives rather than irreversible aggressive client compression unless mobile constraints demand otherwise.

## Storage Economics

Unlimited media count makes storage economics important.

Cost controls should target compression, derivative strategy, cold storage, CDN efficiency, and lifecycle policies—not arbitrary per-Moment media-count ceilings.

## Media Deduplication

Per-User duplicate detection may eventually be useful.

Cross-User global deduplication should not be introduced initially without privacy and ownership analysis.

## Historical Fidelity

Delivery transformations should preserve historical source content.

Technical normalization such as orientation correction is acceptable.

Automatic stylistic edits or filters should not silently alter historical media.

## Media Time

The architecture distinguishes:

```text
media file metadata time
Moment occurrence time
upload time
processing time
```

These are separate semantics.

## Media Provenance

Derived media may record original Media ID, derivative source, processing version, transcoder profile, and generation time.

This supports regeneration and debugging.

## API Contracts

The REST API should expose upload lifecycle operations conceptually such as:

```text
RegisterUpload
FinalizeUpload
GetUploadStatus
DeleteUpload
```

Exact routes belong in API specs.

## Feed Contracts

GraphQL should expose read-oriented media contracts containing stable product fields rather than provider-specific storage details.

## Client Contract Stability

Mobile clients may remain deployed for long periods.

Media contracts should evolve additively where possible.

Storage-provider URLs must not become durable public semantics.

## Playback Errors

Playback failures should distinguish expired access, network failure, unavailable derivative, processing state, and restricted content.

## Observability

Media observability should include:

- upload registration/completion/failure;
- bytes uploaded;
- processing queue depth;
- metadata latency;
- image-processing latency;
- transcode latency;
- processing failure categories;
- retry rate;
- derivative generation;
- CDN hit rate;
- playback startup latency where measurable;
- orphan count;
- storage growth;
- egress.

## Tracing

A media operation should be traceable:

```text
RegisterUpload
    ↓
Upload ID
    ↓
Object Storage
    ↓
FinalizeUpload
    ↓
Processing Job
    ↓
Media Ready
    ↓
Moment Projection
```

## Logging

Logs should include stable IDs but avoid signed URLs, storage credentials, raw EXIF/GPS, private captions, and full provider payloads.

## Alerts

Potential alerts include processing queue stalls, transcode failure spikes, storage outages, callback failures, orphan growth, CDN access failures, and privacy-invalidation failures.

## Testing

Media tests should cover:

- upload registration and authorization;
- upload expiration;
- finalize verification;
- missing/wrong objects;
- image format validation;
- malformed images;
- extreme dimensions;
- video <= 90 seconds accepted;
- video > 90 seconds rejected;
- unsupported codecs;
- transcode failure;
- retries;
- duplicate callbacks;
- provider outage;
- orphan cleanup;
- private-media denial;
- deletion/revocation;
- unlimited-media association semantics;
- stable ordering;
- paginated Moment depth media;
- lightweight Timeline previews;
- real storage/processing integration behavior.

## Golden Media Flow

```text
1. User selects image/video in mobile app.

2. Mobile requests RegisterUpload.

3. API creates authoritative Upload ID and returns scoped upload authorization.

4. Mobile uploads directly to object storage.

5. FinalizeUpload verifies the stored object.

6. Media processing is requested asynchronously.

7. Metadata worker validates type, dimensions, and duration.

8. Video longer than 90 seconds is rejected.

9. Valid media is processed/transcoded.

10. Derivatives are created.

11. Upload/Media state becomes ready.

12. Moment associates ordered Media IDs.

13. Projections publish lightweight media summaries to ClickHouse.

14. Feed aggregator returns previews in Timeline and paginated media in Moment depth.
```

## Day-One Media Requirements

Before launch, Chronologity must define and implement:

- media ID strategy;
- upload registration;
- direct object-storage upload;
- resumable upload;
- upload expiration;
- finalize verification;
- supported image/video formats;
- per-file size limits;
- 90-second server-verified video limit;
- image/video metadata extraction;
- image derivatives;
- video transcoding;
- poster frames;
- processing state machine;
- bounded retries;
- failure classification;
- callback verification/deduplication;
- Moment media ordering;
- unlimited media membership;
- paginated Moment depth media;
- lightweight Timeline previews;
- signed/revocable delivery;
- privacy/moderation propagation;
- deletion workflow;
- orphan cleanup;
- worker isolation;
- observability;
- storage/egress metrics;
- integration/security tests.

## Recommended Initial Architecture

```text
apps/mobile
    ↓ RegisterUpload
apps/api
    ↓ scoped upload authorization
Object Storage
    ↓
FinalizeUpload
    ↓
apps/api authoritative Upload state
    ↓
Kafka / workflow
    ↓
Media Worker
    ├── metadata extraction
    ├── image processing
    └── video transcoding
          ↓
Object Storage derivatives
          ↓
authoritative ready state
          ↓
projection
          ↓
ClickHouse media summaries
          ↓
feed aggregator
          ↓
mobile
```

## Open Architectural Questions

### Object Storage

- Which provider?
- What bucket/prefix topology?
- Which resumable/multipart mechanism?
- How long do incomplete uploads live?

### Upload Model

- Is Upload definitively event sourced?
- Is there a separate Media entity/aggregate?
- Or does Upload become Media when ready?
- Which identifiers are canonical?

### Moment Publication

- Must all media be ready before Moment publication?
- Recommended initial direction: yes.
- Can Users preserve drafts across sessions?
- How long may draft uploads remain?

### File Limits

- Maximum image size?
- Maximum video size?
- Maximum image dimensions?
- Supported formats?

### Video

- Accepted codecs/containers?
- Output codecs?
- HLS at launch?
- Adaptive bitrate ladder?
- Audio normalization?
- HDR?

### Images

- Output formats?
- Responsive widths?
- Which EXIF fields are retained or stripped?

### Processing Provider

- Managed transcoder or self-hosted workers?
- CPU/GPU needs?
- Retry and cost model?

### Moderation

- Is media safety scanning synchronous before publish?
- Which automated signals block versus flag?
- How is evidence retained?

### Delivery

- Which CDN?
- Signed URL or signed cookie?
- Expiration duration?
- Can Users download originals?

### Original Retention

- Keep originals indefinitely?
- Cold storage?
- Can originals be deleted after processing?
- Recommended default: retain originals initially.

### Accessibility

- Manual image alt text at launch?
- Video captions?
- Manual transcript workflow?
- AI remains optional/suggestive rather than authoritative.

### Mobile

- Which Expo/native upload library?
- Background upload support?
- Maximum concurrent uploads?
- Cellular preferences?

### Privacy

- Required revocation latency?
- How are CDN caches purged?
- What exact EXIF/GPS retention policy applies?

## Architectural Invariants

1. A Moment may contain unlimited media items.
2. Unlimited media count is implemented through bounded technical operations.
3. Media is associated with Moments; media is not a Sub-Moment.
4. Recursive media/Moment chronology is prohibited.
5. Each video is limited to 90 seconds.
6. Video duration is verified server-side or by trusted processing.
7. Client validation is UX, not authority.
8. Object storage owns media bytes.
9. Object-store keys are infrastructure details.
10. Stable application Media/Upload IDs exist independently of storage keys.
11. The API does not proxy all media bytes.
12. Direct uploads use scoped short-lived authorization.
13. Large uploads support resumability.
14. Upload concurrency is bounded.
15. Upload completion is server verified.
16. Client-declared type/duration/metadata is untrusted.
17. Original media should be retained initially unless policy says otherwise.
18. Derivatives are rebuildable read/delivery artifacts.
19. Media processing is asynchronous.
20. Media processing does not run inside API request handlers.
21. Processing state is explicit.
22. Processing retries are bounded and failure-aware.
23. Processing consumers are idempotent.
24. Provider callbacks are authenticated, validated, and deduplicated.
25. Uploading media does not automatically publish a Moment.
26. Media ordering within a Moment is authoritative and stable.
27. Media ordering is distinct from Timeline ordering.
28. Per-media failure does not require rebuilding an entire Moment draft.
29. Read models do not store long-lived signed URLs as truth.
30. Signed delivery access is revocable and time bounded.
31. Feed Timeline responses use lightweight media previews.
32. Moment depth media is paginated.
33. Page-size limits do not create total media limits.
34. Object-storage ACLs do not define product privacy.
35. CDN caches must respect deletion, privacy, and moderation.
36. Embedded metadata does not automatically become historical truth.
37. EXIF capture time is distinct from Moment occurrence time.
38. GPS metadata is sensitive.
39. Media binaries never go into EventStoreDB.
40. Media binaries never go through Kafka.
41. ClickHouse stores summaries, not media bytes.
42. Moderation signals do not automatically become authoritative enforcement.
43. Restricted media access fails closed.
44. Account/Moment deletion coordinates object storage, projections, and caches.
45. Orphan uploads have cleanup policy.
46. Object keys do not contain sensitive User data.
47. Checksums support integrity but do not imply shared ownership.
48. Untrusted media processing runs with resource limits and isolation.
49. Processing queues use backpressure.
50. API HTTP and media processing scale independently.
51. Client upload state is not authoritative.
52. Server-side original/derivative state is observable.
53. Video autoplay policy belongs primarily to the client.
54. Server media delivery supports fast playback startup.
55. Quality preservation is preferred over destructive client compression.
56. Storage economics must not be solved by arbitrary media-count limits.
57. Cross-User global media deduplication is not introduced casually.
58. Media searchability remains derived and privacy-aware.
59. Technical orientation correction is not a historical edit.
60. Media-related timestamps retain distinct semantics.
61. Processing pipeline versions may be recorded for derivative provenance.
62. REST contracts do not expose storage-provider internals.
63. Mobile clients handle expiring media-delivery credentials.
64. Logs never include signed URLs or sensitive EXIF by default.
65. Media privacy invalidation failures are observable.
66. Real upload/storage/processing integration tests are required.
67. Architecture documentation changes when media ownership or publication semantics change.

## Guiding Principle

When designing a media capability, ask:

> **How can Chronologity preserve the Moment's historical media faithfully, support an unlimited collection over time, and deliver it efficiently without making binary storage, processing infrastructure, or client behavior the source of domain truth?**

The media system should be scalable and technically bounded while preserving the product promise that a Moment is not constrained by an arbitrary media-count ceiling.
