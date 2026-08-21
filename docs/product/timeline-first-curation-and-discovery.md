# Chronologity: Timeline-First Curation and Discovery

## Status

Product and implementation direction for Chronologity's curation, discovery, and Timeline graph.

## Core Thesis

Most social media platforms recommend the next individual piece of content. Chronologity should recommend the next direction through history.

On Chronologity, the Timeline—not an individual photo, video, or Moment—is the primary unit of discovery. A piece of media may attract a user and a Moment may provide an entry point, but both should lead into a larger chronology.

> On other platforms, content leads to more content. On Chronologity, every Moment opens a path through time.

Chronologity's discovery system should answer questions such as:

- What happened next?
- What came before this?
- What larger history contains this event?
- What more specific history exists inside it?
- What happened elsewhere at the same time?
- How did another participant experience the event?
- Which Timeline records the causes or consequences?

Discovery is therefore a navigational system, not merely a ranked media feed.

## Product Principles

### The Timeline is the destination

Individual media and Moments may appear in search results, shares, notifications, or previews. Opening them should expose the containing Timeline and the meaningful directions available from it.

### Personalize entrances, not historical order

Chronologity may personalize which Timelines, curated paths, and entry points a user sees. Once the user enters a Timeline, its Moments retain their canonical chronological order.

Algorithms may help people find history; they should not rewrite it.

### Relationships should be explainable

A recommendation should be able to say why it exists:

- A continuation of the Timeline you explored
- A broader Timeline containing this history
- Another perspective on the same event
- A Timeline about the same place during the same period
- A consequence of the event you just viewed
- Selected by a curator you follow

Chronologity should prefer meaningful, inspectable relationships over opaque similarity alone.

### Exploration should have direction

The user should understand whether an action will move forward, backward, deeper, outward, or sideways through the Timeline graph.

## Discovery Directions

### Continue

Move forward within the current Timeline or into its direct continuation.

Examples:

- The next Moment
- The next significant period
- The next turning point
- The point at which the user stopped previously
- New Moments added since the user's last visit

### Go back

Move toward earlier events, origins, or contributing causes.

Examples:

- Events leading to a protest
- An artist's career before a breakthrough
- A neighborhood before redevelopment
- Earlier construction at the same location

### Go deeper

Move into a more focused child Timeline or expand the details and media contained by a Moment.

Example:

`Space Race -> Apollo program -> Apollo 11 -> Launch day`

### Zoom out

Move from a focused Timeline to a broader parent Timeline.

Example:

`Apollo 11 launch -> Apollo 11 mission -> Apollo program -> Space Race`

### Move sideways

Move to a related Timeline sharing a time, place, participant, subject, cause, consequence, or alternative perspective.

Examples:

- The same event from another participant's perspective
- Another neighborhood during the same decade
- A competing team's season
- A parallel technological development
- A Timeline that disputes the current interpretation

## Timeline Graph

### Concept

Timelines should form a graph rather than a flat collection.

- A **Timeline** is a graph node.
- A **Timeline relationship** is a directed, typed edge from one Timeline to another.
- A relationship may be asserted by a user, curator, institution, or system process.
- A relationship has provenance and moderation state so that Chronologity does not present every assertion as an undisputed fact.

This graph is the structural foundation for Timeline-first discovery. It should be stored independently from personalized recommendation scores, which are derived and user-specific.

### Initial relationship types

| Type | Directional meaning | Typical inverse | Example |
| --- | --- | --- | --- |
| `parent_of` | Source is broader and contains the target | `child_of` | Apollo program -> Apollo 11 |
| `child_of` | Source is narrower and belongs within the target | `parent_of` | Apollo 11 -> Apollo program |
| `precedes` | Source occurs before the target in a meaningful sequence | `continues` or `succeeds` | Phase One -> Phase Two |
| `continues` | Source directly continues the target | `precedes` | Phase Two -> Phase One |
| `overlaps` | Source and target occur during overlapping periods | `overlaps` | Two concurrent movements |
| `same_location` | Source and target concern the same place | `same_location` | Two eras of Times Square |
| `same_subject` | Source and target concern the same entity or topic | `same_subject` | Two periods in an artist's career |
| `related_person` | Source connects to a Timeline centered on a participant | Context-dependent | Apollo 11 -> Neil Armstrong |
| `caused_by` | Source documents an outcome attributable to the target | `resulted_in` | Protest -> precipitating event |
| `resulted_in` | Source contributed to the target outcome | `caused_by` | Precipitating event -> protest |
| `alternate_perspective` | Target provides another account of substantially the same event | `alternate_perspective` | Witness account A -> witness account B |
| `contradicts` | Source disputes a claim or interpretation represented by the target | `contradicts` | Competing historical accounts |
| `inspired_by` | Source was meaningfully influenced by the target | `inspired` if later required | Film -> earlier work |
| `related_to` | A deliberately broad association when no stronger type applies | `related_to` | Two contextually related histories |

`curated_collection` should not be a Timeline-to-Timeline relationship type. Curated collections and paths require ordered membership, editorial annotations, and potentially selected entry and exit Moments. They should use separate tables.

Likewise, `same_location`, `same_subject`, and temporal overlap may eventually be derived from normalized place, subject, and time data. They can remain explicit edge types initially, but the implementation should record whether an edge was asserted or derived.

### Directed-edge semantics

Every stored relationship must have an unambiguous sentence-level interpretation:

> `{source_timeline} {relationship_type} {target_timeline}`

For example:

> `The Apollo 11 Timeline child_of The Apollo Program Timeline.`

The API must not silently reverse a directional relationship. If clients require both directions, the read layer can derive the inverse or store a paired inverse edge through one controlled service. Application code should not independently create both sides because they can drift apart.

Symmetric types such as `overlaps`, `same_location`, `same_subject`, `alternate_perspective`, `contradicts`, and `related_to` should have one canonical stored orientation, such as the lower UUID first. Query code can expose them in either direction.

### Relationship properties

A Timeline relationship should support the following properties:

| Property | Purpose |
| --- | --- |
| `id` | Stable relationship identifier |
| `source_timeline_id` | Timeline at the directed edge's origin |
| `target_timeline_id` | Timeline at the directed edge's destination |
| `relationship_type` | Controlled semantic type |
| `status` | Proposed, accepted, disputed, rejected, or removed |
| `origin` | User-asserted, curator-asserted, institution-asserted, system-derived, or imported |
| `created_by_user_id` | User responsible for the assertion, when applicable |
| `created_by_system` | System or importer responsible for a derived relationship, when applicable |
| `confidence` | Optional confidence for derived or probabilistic relationships; not a popularity score |
| `rationale` | Optional concise explanation of why the relationship exists |
| `evidence` | Structured references supporting the assertion |
| `metadata` | Sparse extension data that does not replace modeled columns |
| `valid_from` / `valid_to` | Optional interval during which the relationship itself applies |
| `created_at` / `updated_at` | Audit timestamps |
| `accepted_at` | When the assertion became eligible for canonical discovery |
| `removed_at` | Tombstone timestamp when public traversal should no longer use the edge |

`confidence` must not become a universal truth score. It is appropriate for machine-derived connections but often inappropriate for editorial or contested historical interpretations. Disagreement should be represented with status, provenance, evidence, and alternate edges—not collapsed into a single number.

### Recommended Postgres shape

The following is a starting point, not a final migration:

```sql
create type timeline_relationship_type as enum (
  'parent_of',
  'child_of',
  'precedes',
  'continues',
  'overlaps',
  'same_location',
  'same_subject',
  'related_person',
  'caused_by',
  'resulted_in',
  'alternate_perspective',
  'contradicts',
  'inspired_by',
  'related_to'
);

create type timeline_relationship_status as enum (
  'proposed',
  'accepted',
  'disputed',
  'rejected',
  'removed'
);

create type timeline_relationship_origin as enum (
  'user_asserted',
  'curator_asserted',
  'institution_asserted',
  'system_derived',
  'imported'
);

create table timeline_relationships (
  id uuid primary key,
  source_timeline_id uuid not null references timelines(id),
  target_timeline_id uuid not null references timelines(id),
  relationship_type timeline_relationship_type not null,
  status timeline_relationship_status not null default 'proposed',
  origin timeline_relationship_origin not null,
  created_by_user_id uuid null references users(id),
  created_by_system text null,
  confidence numeric(5, 4) null check (confidence between 0 and 1),
  rationale text null,
  evidence jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  valid_from timestamptz null,
  valid_to timestamptz null,
  accepted_at timestamptz null,
  removed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source_timeline_id <> target_timeline_id),
  check (valid_to is null or valid_from is null or valid_to > valid_from),
  check (created_by_user_id is not null or created_by_system is not null)
);

create unique index timeline_relationships_active_unique
  on timeline_relationships (
    source_timeline_id,
    target_timeline_id,
    relationship_type
  )
  where removed_at is null and status not in ('rejected', 'removed');

create index timeline_relationships_source_traversal
  on timeline_relationships (source_timeline_id, relationship_type, status)
  where removed_at is null;

create index timeline_relationships_target_traversal
  on timeline_relationships (target_timeline_id, relationship_type, status)
  where removed_at is null;
```

### Enum versus lookup table

A Postgres enum is reasonable for the initial closed vocabulary and gives the application a strong contract. A lookup table is preferable if Chronologity expects administrators, institutions, or later product versions to define types without a database migration.

The recommended initial choice is an enum because relationship semantics will affect traversal behavior, inverse mapping, validation, and user-interface language. Adding a type is therefore an application change, not merely a data change. Migrate to a lookup table only if the product develops a genuine extensibility requirement.

### Evidence representation

`evidence` can begin as JSONB, but each entry should conform to an application schema. A possible shape is:

```json
[
  {
    "kind": "moment",
    "momentId": "uuid",
    "note": "This Moment identifies the event as a direct continuation."
  },
  {
    "kind": "external_source",
    "url": "https://example.org/source",
    "title": "Source title",
    "accessedAt": "2026-08-21T00:00:00Z"
  }
]
```

If evidence later needs independent moderation, citations, reuse, or querying, promote it to `timeline_relationship_evidence` rather than expanding JSONB indefinitely.

### Integrity rules

The service layer should enforce rules that are cumbersome or unsafe as database-only checks:

- Prevent direct `parent_of` and `child_of` cycles.
- Prevent a Timeline from continuing itself, directly or transitively.
- Validate that inverse types are exposed consistently.
- Canonicalize the stored orientation of symmetric relationships.
- Require suitable provenance before accepting an edge.
- Prevent a derived edge from overwriting a human assertion.
- Preserve disputed relationships and their audit history instead of destructively replacing them.
- Exclude rejected, removed, and normally proposed edges from canonical traversal.

Do not attempt to enforce that the entire graph is acyclic. Some legitimate relationship types are symmetric or cyclic. Cycle rules must be specific to hierarchical and sequential subgraphs.

### Read model and API considerations

The write table should remain authoritative. High-volume discovery queries can use a projection optimized for traversal.

Useful query shapes include:

- Get accepted outgoing edges from a Timeline grouped by relationship type.
- Get accepted incoming edges and expose their inverse meaning.
- Get parent and child Timelines.
- Get direct predecessors and continuations.
- Get alternate perspectives and contradictions.
- Traverse a bounded number of hops for discovery candidates.
- Explain the path connecting two Timelines.

The public API should return both the relationship and a human-readable explanation. A recommendation response should preserve the relationship IDs and graph path used to produce it so the product can explain and debug discovery decisions.

Postgres recursive CTEs are sufficient for bounded traversal initially. Chronologity should not adopt a graph database merely because the domain contains a graph. Reconsider specialized graph infrastructure only after observed workloads show that Postgres cannot meet traversal latency or operational requirements.

## Curation Model

### Structural curation

Structural curation comes from modeled relationships:

- Chronological position
- Parent and child Timelines
- Temporal overlap
- Shared places
- Shared subjects
- Participants
- Causes and consequences
- Alternate perspectives

This layer enables meaningful discovery without engagement-based ranking.

### Human curation

Users, trusted curators, communities, and institutions can assemble meaningful histories and journeys. Their authority and identity should remain visible.

Human curation adds interpretation, but it must not modify the canonical order or ownership of Moments in the underlying Timelines.

### Personalized curation

Chronologity may rank Timeline candidates based on user interests, followed people, location, saved Timelines, exploration history, and quality signals.

Personalization should select:

- Which Timeline to surface
- Why to surface it
- Where the user should enter it
- Which graph direction may be most relevant

It should not reorder Moments inside the Timeline.

## Curated Paths

A curated path is an intentional, ordered journey through selected sections of one or more Timelines. It is not itself a graph relationship and should not duplicate the underlying Moments.

- A **Timeline** records what happened.
- A **Path** presents an argument, theme, or guided journey through what happened.

A path needs at least:

- Identity, title, description, visibility, and curator
- Ordered path steps
- A Timeline reference for every step
- Optional entry and exit Moment references
- Editorial annotation for every step
- Optional transition text explaining why one step leads to the next
- Publication and moderation state

Possible relational tables:

```text
curated_paths
curated_path_steps
```

`curated_path_steps.position` should provide explicit ordering. A path step references canonical content; it does not move or reorder that content in its original Timeline.

## Discovery Modes

### Subject discovery

Explore a person, place, organization, event, work, or topic.

### Temporal discovery

Explore what happened during a date or period, including simultaneous events.

### Spatial discovery

Explore histories associated with a location, route, building, park, or neighborhood.

### Relational discovery

Follow participants, influences, causes, consequences, continuations, and related movements.

### Perspective discovery

Explore multiple witness, participant, local, institutional, retrospective, or disputed accounts of an event.

Chronologity should not imply that one Timeline is necessarily complete or neutral. Alternate and contradictory perspectives must remain discoverable and clearly attributed.

### Serendipitous discovery

Offer meaningful destinations when the user has no explicit target:

- On this day
- Near you
- Recently expanded Timelines
- Timelines gaining historical significance
- Overlooked Timelines related to the user's interests
- Events occurring simultaneously
- Surprising graph connections
- Short Timelines that fit the user's available time

## Home Experience

Chronologity's home experience should present invitations into Timelines rather than an endless feed of disconnected Moments.

Candidate sections include:

- Continue exploring
- New chapters
- Because you explored...
- Happening now
- Near you
- On this day
- Curated journeys
- From people you follow
- Unexpected connections

A Timeline preview should communicate:

- Subject and date range
- Complete or ongoing state
- Number of Moments or major chapters
- Estimated exploration time
- Curator or contributors
- Why it was recommended
- The proposed entry point

## Ranking and Recommendation Boundaries

There are two distinct ranking decisions:

1. Which Timeline should the user encounter?
2. Where should the user enter that Timeline?

Timeline ranking may consider relevance, graph proximity, quality, freshness, trusted curation, location, user interest, and perspective diversity.

Entry-point selection may choose:

- The beginning of a short Timeline
- The user's previous position
- The newest chapter
- A major turning point
- A Moment connected to the referring Timeline
- The period matching the user's search
- The present, with an invitation to move backward

Once entered, the Timeline remains chronological.

Personalized recommendation data should live separately from `timeline_relationships`. For example, a derived store may contain:

```text
user_timeline_recommendations
- user_id
- timeline_id
- entry_moment_id
- score
- reason_code
- explanation
- source_relationship_ids
- model_version
- generated_at
- expires_at
```

This data is disposable and recalculable. The Timeline graph is durable domain data.

## Success Metrics

Chronologity should optimize for meaningful Timeline exploration rather than isolated media impressions.

Candidate metrics include:

- Timelines entered
- Timeline continuation rate
- Number of periods explored
- Temporal distance traveled
- Depth transitions
- Related Timelines opened
- Curated paths completed
- Timelines saved or followed
- Return visits to ongoing Timelines
- Moments contributed after exploration
- Diversity of periods and perspectives explored

A candidate north-star metric is:

> Weekly users who meaningfully explore or contribute to a Timeline.

The precise threshold for "meaningfully explore" should be validated empirically. It may combine multiple Moments viewed, temporal movement, graph transitions, saves, follows, and return visits. It should not be reduced to raw session duration.

## Implementation Sequence

### Phase 1: Canonical graph

- Create typed Timeline relationships with provenance and status.
- Support parent/child, sequential, overlapping, causal, subject/location, and perspective relationships.
- Expose incoming and outgoing relationships.
- Add bounded traversal using Postgres.
- Render explainable discovery directions from the graph.

### Phase 2: Timeline-first discovery

- Build Timeline previews and entry-point selection.
- Add continue, go back, go deeper, zoom out, and sideways actions.
- Introduce home sections based on explicit graph and follow relationships.
- Measure meaningful Timeline exploration.

### Phase 3: Human curation

- Add curated paths and ordered path steps.
- Add curator identity, annotations, publishing, and moderation.
- Support paths that cross multiple Timelines without copying canonical content.

### Phase 4: Personalized discovery

- Rank Timeline candidates and entry points.
- Preserve explanation and source relationship IDs.
- Add serendipitous discovery and perspective diversity.
- Evaluate ranking against exploration quality, not only engagement.

## Non-Goals and Guardrails

- Do not make individual media the primary recommendation unit.
- Do not reorder canonical Timeline history for personalization.
- Do not store personalized recommendation scores on canonical graph edges.
- Do not treat curated paths as Timeline relationships.
- Do not use generic `related_to` when a stronger semantic type is known.
- Do not present machine-derived or user-proposed connections as accepted historical facts.
- Do not optimize the product primarily for media views, watch time, or endless scrolling.
- Do not adopt a graph database before actual Postgres workload evidence justifies it.

## Product Positioning

Conventional social platforms predict the next object likely to hold a user's attention. Chronologity should help the user choose the next direction that expands their understanding.

> Chronologity is a social timeline for preserving and exploring human experience.

The discovery system makes that promise concrete: the next destination is a Timeline, and every Timeline is connected to a larger graph of history.
