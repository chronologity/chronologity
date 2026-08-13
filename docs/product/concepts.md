# Chronologity Product Concepts

## Purpose

This document defines the core product vocabulary of Chronologity. These definitions establish conceptual boundaries that should guide product design, architecture, APIs, persistence models, events, and user interfaces.

Technical implementations may evolve, but they should preserve these distinctions unless the product model itself is intentionally changed. Terminology should be used consistently throughout the project.

## Conceptual Model

At its core, Chronologity represents experiences through **Moments** arranged chronologically and explored through contextual groupings.

```text
User
 │
 ├── creates ──────────────► Moment
 │                             │
 │                             ├── references ───────────► Media
 │                             ├── receives ─────────────► Comment
 │                             ├── receives ─────────────► Reaction
 │                             └── relates to ───────────► Moment
 │
 └── participates in the chronological experience
                               │
                               ▼
                            Timeline
                               │
                               ▼
                              Feed
```

This diagram is conceptual rather than a statement about database ownership or service boundaries.

## Moment

A **Moment** is the fundamental unit of recorded experience in Chronologity.

A Moment represents something that happened at a particular point or interval in time. It may be represented by images, video, descriptive information, temporal metadata, location metadata, or some combination of those elements.

A Moment exists independently of whether it is currently visible in a feed.

```text
Moment ≠ Post
```

A conventional social-media post is generally modeled as something published into a distribution system. A Moment is modeled as part of a chronological record.

### Occurrence Time

The **occurrence time** describes when the represented experience happened.

Occurrence time is not necessarily the same as the time the Moment was recorded in Chronologity. A user may create a Moment in 2026 representing an event from 2010.

```text
occurredAt ≠ createdAt
```

The occurrence time determines the Moment's historical position.

### Creation Time

The **creation time** describes when the Moment record was created in Chronologity. It is useful for provenance, auditing, synchronization, and operational behavior, but it does not determine historical position.

### Update Time

An **update time** describes when mutable information associated with a Moment was most recently changed. Updating information about a historical Moment does not imply that the represented event occurred again or change its occurrence time.

### Moment Identity

A Moment has a stable identity independent of its media. Replacing, removing, or modifying associated media does not implicitly create a different Moment unless the product explicitly defines the operation that way.

## Media

**Media** is visual or audiovisual material associated with a Moment.

Examples include images and videos.

```text
Moment ≠ Media
```

A Moment represents an experience. Media represents material associated with that experience.

A media asset should therefore not automatically become the domain identity of a Moment.

### Video

A video is a type of Media. Chronologity limits an individual video Moment to a maximum video duration of **90 seconds**.

The constraint preserves the idea of a focused Moment rather than turning Chronologity into a general-purpose long-form video platform. The platform should not automatically use AI to divide long videos into Moments; deciding what constitutes a Moment remains a user decision.

## Timeline

A **Timeline** is the chronological structure through which Moments are experienced.

Its defining characteristic is chronology.

```text
Earlier
   │
   ▼
Moment A
   │
   ▼
Moment B
   │
   ▼
Moment C
   │
   ▼
Later
```

Moment ordering is determined primarily by occurrence time, not creation time or engagement activity. If two Moments have equivalent occurrence times, the product must still provide deterministic ordering.

### Timeline Context

A Timeline can be experienced through contextual groupings. Chronologity may group Moments according to characteristics such as location, event, people, subject, or other meaningful context.

The product should avoid prematurely treating every contextual grouping as a separate user-created object. Some groupings may be derived automatically from Moments and their metadata.

## Feed

A **Feed** is the presentation and retrieval experience through which Moments are delivered to a user.

```text
Timeline ≠ Feed
```

A Timeline represents chronological organization. A Feed represents a way of retrieving and presenting Moments.

This distinction allows Chronologity to build different retrieval or discovery experiences without changing the historical meaning of the underlying Moments.

## Three-Dimensional Navigation

Chronologity conceptualizes navigation across three dimensions:

```text
Vertical   → Time
Horizontal → Context
Depth      → Moment
```

These dimensions describe interaction semantics rather than literal geometric requirements for every screen.

### Vertical: Time

Vertical movement navigates through chronological Moments and answers:

> What happened before or after this?

### Horizontal: Context

Horizontal movement navigates among contextual groupings of Moments, such as locations or events, without abandoning the user's chronological position.

### Depth: Moment

Depth means entering a Moment to inspect it more completely. It may expose additional media, descriptive information, metadata, comments, reactions, and relationships.

## Chronology

**Chronology** is the temporal ordering of Moments according to when their represented events occurred.

Chronology is a product invariant rather than merely a sorting preference. Filters, search, discovery, and contextual navigation must not alter the historical occurrence time of a Moment.

A **chronological relationship** exists when one event occurred before, after, or contemporaneously with another event.

Chronological relationships do not imply causality.

## Causality

**Causality** describes an explicit relationship in which one Moment is understood to have contributed to, resulted in, motivated, enabled, or otherwise meaningfully influenced another Moment.

```text
Chronology ≠ Causality
```

For example:

```text
Graduated
    │
    ▼
Accepted Job
    │
    ▼
Moved to New York
```

The product should not infer causal relationships merely because events occurred in sequence.

## Context

**Context** is information that helps explain or situate a Moment beyond its occurrence time.

Context may include location, event, people, surrounding Moments, descriptive metadata, relationships to other Moments, and social discussion.

Context enriches history without replacing chronology.

## Location

A **Location** describes where a Moment occurred when geographic context is available and the user chooses to provide or permit it.

Location is optional. Location data should not be assumed to be present, precise, public, or safe to expose.

A location may contribute to horizontal grouping in the Timeline experience. Privacy requirements around historical location information should be treated as especially important.

## Event

Within the product domain, an **Event** is a real-world occurrence or contextual grouping that may connect multiple Moments. A concert, graduation, wedding, conference, or other shared occurrence may provide such context.

This product meaning must not be confused with a software **Domain Event** or **Integration Event**.

When ambiguity is possible, engineering documentation and code should use qualified terminology:

```text
Real-world Event
Domain Event
Integration Event
```

## User

A **User** is a person with an account in Chronologity.

Users can create and interact with Moments and participate in social experiences according to their permissions.

The User concept should not automatically be treated as equivalent to a public social-media profile. Account identity, public representation, privacy settings, and historical content are related but distinct concepts.

## Profile

A **Profile** is the representation of a User that other users may be permitted to view.

A Profile may expose identity information, descriptive information, and entry points into public or shared experiences.

```text
Profile ≠ Timeline
```

A Profile answers questions about a person. A Timeline answers questions about what happened through time.

## Comment

A **Comment** is a conversational contribution associated with a Moment or another explicitly supported product entity.

Comments add discussion and context without changing the historical occurrence time of the Moment they reference.

```text
Moment occurred: 2024
Comment added:    2026
```

The Moment remains historically positioned in 2024.

## Reaction

A **Reaction** is a lightweight expression made by a User in response to a Moment or another supported entity.

A Reaction represents interaction, not historical significance.

```text
Reaction ≠ Popularity
```

Reaction counts should not automatically determine chronological ordering or historical importance.

## Subscription

A **Subscription** represents a User's request to receive updates associated with another supported Chronologity entity or context.

```text
Subscription ≠ Follower
```

Chronologity should not inherit conventional follower/following semantics unless the product explicitly adopts them.

## Notification

A **Notification** is information delivered to a User to make them aware of relevant activity or state changes.

Notifications communicate activity. They are not themselves part of the historical chronology unless the underlying activity independently represents a Moment.

## Visibility

**Visibility** defines who is permitted to discover or access content.

Visibility is different from ownership. A User may control content while allowing other people to view it.

Potential visibility models include public, private, and restricted or invite-based access. The exact model is defined separately.

Visibility changes do not change when the underlying Moment occurred.

## Ownership

**Ownership** describes the authority a User or supported entity has over content or another product resource.

Ownership may affect permissions such as editing metadata, changing visibility, associating or removing media, managing participation, and requesting removal.

Ownership does not necessarily imply exclusive visibility.

## Historical Integrity

**Historical integrity** is the principle that Chronologity should preserve the meaning, chronology, and provenance of recorded experiences.

Historical integrity does not mean that every byte must remain permanently immutable. Users may legitimately need to correct inaccurate information, change visibility, remove content, exercise privacy rights, or comply with legal requirements.

```text
Historical integrity ≠ Absolute immutability
```

The system should represent these actions with clear semantics rather than casually rewriting historical meaning.

## Discovery

**Discovery** is the process through which Chronologity helps a User find Moments, people, contexts, or histories they may wish to explore.

Discovery may eventually use search, recommendations, contextual relationships, or other mechanisms.

```text
Discovery can determine what to explore.
Chronology determines when it happened.
```

A discovery system may recommend an entry point into history. It should not silently rewrite historical ordering within that context.

## Search

**Search** allows a User to intentionally retrieve relevant Chronologity content based on a query.

Search results may be ranked according to relevance because search is a retrieval experience rather than a historical ordering. Entering a Moment through search does not change that Moment's chronological position.

## Draft

A **Draft** is content that a User has begun creating but has not yet committed as a Moment.

```text
Draft ≠ Moment
```

Drafts may be editable, incomplete, locally stored, synchronized, or discarded without implying a change to the historical record.

## Upload

An **Upload** is the process or state associated with transferring Media into Chronologity.

```text
Upload ≠ Media
Upload ≠ Moment
```

An Upload may fail, retry, or complete before the associated Moment is created or finalized. Keeping these concepts separate is important for media-processing and offline workflows.

## Product Concept Boundaries

| Concept              | Is Not                | Reason                                                                                           |
| -------------------- | --------------------- | ------------------------------------------------------------------------------------------------ |
| Moment               | Post                  | A Moment represents an experience in history rather than merely content distributed into a feed. |
| Moment               | Media                 | Media is material associated with an experience; it does not define the experience itself.       |
| Timeline             | Feed                  | A Timeline represents chronological structure; a Feed retrieves and presents content.            |
| Profile              | Timeline              | A Profile represents a person; a Timeline represents progression through time.                   |
| Occurrence Time      | Creation Time         | An event may be recorded long after it happened.                                                 |
| Chronology           | Causality             | Temporal sequence does not prove a causal relationship.                                          |
| Reaction             | Popularity            | Interaction does not inherently determine historical significance.                               |
| Subscription         | Follower              | Subscription semantics should not inherit conventional follower behavior accidentally.           |
| Draft                | Moment                | Uncommitted content is not yet part of the historical record.                                    |
| Upload               | Media                 | Upload represents transfer/process state; Media represents an asset.                             |
| Media                | Moment                | An asset associated with an experience is not the experience itself.                             |
| Historical Integrity | Absolute Immutability | History should be trustworthy while supporting legitimate correction, privacy, and removal.      |
| Discovery            | Chronology            | Discovery chooses what to explore; chronology preserves when it happened.                        |
| Real-world Event     | Domain Event          | A human occurrence and a software architectural event are different concepts.                    |

## Naming Principles

When introducing a new product concept:

1.  Prefer terminology that describes the product meaning rather than the implementation.
2.  Avoid reusing an existing term with a second meaning.
3.  Define how the concept differs from adjacent concepts.
4.  Avoid importing conventional social-media terminology unless Chronologity intentionally adopts the same semantics.
5.  Keep technical implementation details out of product definitions unless they materially define product behavior.

If a new concept cannot be clearly distinguished from an existing concept, determine whether a new concept is actually necessary.

## Conceptual Invariants

The following invariants should guide future product and architecture decisions:

1.  A Moment has a historical occurrence time independent of when it was created in Chronologity.
2.  A Moment's chronological position is not changed by comments, reactions, or other later social activity.
3.  Media and Moments have separate identities.
4.  A Timeline's fundamental organizing principle is chronology.
5.  A Feed is a presentation and retrieval mechanism rather than the authoritative definition of history.
6.  Chronological proximity does not imply causality.
7.  Discovery mechanisms may select entry points without redefining historical ordering.
8.  Visibility and ownership are distinct concepts.
9.  Historical integrity must coexist with legitimate correction, privacy, and removal requirements.
10. Product terminology should describe domain meaning rather than current technical implementation.

## Relationship to Technical Architecture

This document intentionally avoids defining service boundaries, database schemas, event-store streams, Kafka topics, API routes, or TypeScript types.

Those are architectural and implementation decisions.

Defining **Moment** as a product concept does not require Chronologity to have a separately deployed `moment-service`. Similarly, defining **Comment** as a distinct concept does not require comments to have their own database, event stream, or microservice.

The technical architecture should emerge from the domain model and operational requirements rather than treating every product noun as a service boundary.

## Guiding Rule

When terminology becomes ambiguous, return to the underlying product meaning:

> **What does this concept represent to the person using Chronologity?**

The implementation should follow that meaning rather than redefining the product around the implementation.
