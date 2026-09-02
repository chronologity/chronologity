# Chronologity Historical Significance

## Purpose

This document defines how Chronologity understands the **historical significance** of a Moment and how that concept may be used throughout the product.

Chronologity needs to distinguish between content that receives attention and history that matters. Reactions, comments, views, follower counts, and other engagement signals may describe social response, but they do not establish historical importance.

The central question is:

> **What makes a Moment historically significant within a particular historical context?**

Historical significance matters directly to Chronologity because the product must help Users navigate potentially enormous bodies of history across different temporal scales. Temporal zoom, historical jumps, Event representation, causal navigation, and future historical summarization all require a principled way to reason about which Moments are especially meaningful without turning Chronologity into an engagement-ranked social network.

This document defines product semantics and constraints rather than prescribing a particular scoring algorithm, machine-learning model, graph database, ranking service, or user-interface treatment.

## Core Principle

Historical significance is **contextual importance within history**.

It is not popularity.

It is not engagement.

It is not a universal property that can always be represented correctly by one scalar score.

```text
Historical significance
        ≠
Popularity
        ≠
Engagement
        ≠
Display ranking
```

A Moment may be historically significant because it changed what happened afterward, marks an important transition, represents an important personal experience, documents a major shared Event, provides unusual evidence, or acquires greater meaning as later history unfolds.

Chronologity should therefore model historical significance as a multidimensional concept.

## Contextual Significance

A Moment is not simply "significant" or "insignificant" in the abstract.

Its significance depends on the historical scope being considered.

For example, a Moment may be:

- highly significant to one User;
- significant within a family;
- significant within a community;
- significant within a particular real-world Event;
- significant within a city;
- significant within a nation;
- significant within a cultural or historical subject; or
- globally significant.

Consider:

```text
Moment:
A family's first photograph after immigrating to the United States
```

That Moment may have little global significance while being one of the most consequential Moments in that family's history.

By contrast:

```text
Moment:
The first human landing on the Moon
```

may be significant across many independent historical scopes.

Therefore:

```text
Significance(Moment, Context)
```

is a better conceptual model than:

```text
Significance(Moment)
```

The historical context is part of the meaning.

## Historical Scope

A **Historical Scope** is the context within which Chronologity evaluates or presents history.

Potential scopes include:

- a User;
- a Person;
- a family or other future historical grouping;
- a real-world Event;
- a location;
- a period of time;
- a causal chain;
- a collection of related Moments;
- a community;
- a subject; or
- a broader historical context.

Not every scope must become a first-class persisted domain entity.

The important product principle is that significance must be evaluated relative to what history the User is currently examining.

## Significance Is Multidimensional

Chronologity should reason about multiple dimensions of historical significance rather than assuming one signal can explain historical importance.

The foundational dimensions are:

```text
Historical Significance
│
├── causal significance
├── structural significance
├── temporal significance
├── personal significance
├── collective significance
├── Event significance
├── evidentiary significance
└── retrospective significance
```

These dimensions may overlap.

They should not be assumed to have equal weight in every context.

Additional dimensions may be introduced later if Chronologity discovers a historical distinction that cannot be represented adequately by these concepts.

## Causal Significance

**Causal significance** describes how consequential a Moment is to subsequent history.

A Moment may be significant because later Moments depend on it.

For example:

```text
Moment A
   │
   ├────▶ Moment B
   │        │
   │        └────▶ Moment D
   │
   └────▶ Moment C
            │
            ├────▶ Moment E
            └────▶ Moment F
```

Moment A may be highly causally significant because a substantial amount of later history descends from it.

Causal significance must not be reduced to the number of direct outgoing causal relationships.

Consider:

```text
A ──▶ B ──▶ C ──▶ D ──▶ E
```

Moment A has only one direct outgoing relationship, but it may still be foundational to the entire downstream chain.

Chronologity should therefore leave room for recursive or graph-derived causal significance.

Conceptually:

```text
Direct consequences
        +
Consequences of consequences
        +
Position within causal structure
        ↓
Causal significance
```

The exact computation is an architectural and algorithmic decision.

## Recursive Causal Significance

Causal significance may evolve recursively.

If Moment A causes Moment B, and Moment B later becomes highly consequential, Moment A may become more significant as a result.

```text
A
│
▼
B
│
▼
Large consequential history
```

This does not mean every causal relationship should trigger synchronous recursive recalculation.

Chronologity may compute recursive significance asynchronously, incrementally, periodically, or through another scalable mechanism.

The product invariant is semantic:

> Later causal structure may change Chronologity's understanding of the significance of earlier Moments.

## Structural Significance

**Structural significance** describes how important a Moment is because of its position within a larger historical graph or chronology.

A structurally important Moment may:

- connect otherwise distinct portions of history;
- serve as an anchor around which many Moments organize;
- bridge historical periods;
- connect multiple causal paths;
- represent a convergence or divergence point; or
- occupy another unusually important structural position.

For example:

```text
Earlier history
      │
      ▼
   Moment X
    /     \
   ▼       ▼
Path A   Path B
```

Moment X may be structurally significant even if Users have never explicitly marked it as important.

Structural significance may eventually use graph-analysis techniques, but the product concept should remain independent of a specific algorithm.

## Temporal Significance

**Temporal significance** describes the importance of a Moment as a boundary, transition, beginning, ending, or marker within history.

Examples may include:

- birth;
- graduation;
- moving to another country;
- marriage;
- beginning a career;
- founding a company;
- retirement;
- the beginning or ending of a war;
- a natural disaster;
- an election;
- the opening or closing of an institution; or
- another transition that meaningfully separates "before" from "after."

Conceptually:

```text
Before
  │
  ▼
Moment
  │
  ▼
After
```

A temporally significant Moment may help Chronologity divide long spans of history into meaningful periods.

Temporal significance is especially relevant to temporal zoom.

## Personal Significance

**Personal significance** describes how important a Moment is to a particular person.

Personal significance cannot always be inferred from observable structure.

A Moment may have:

```text
0 reactions
0 comments
few views
no known causal relationships
```

and still be one of the most important Moments in a person's life.

For example, a photograph may be personally defining because it is the last photograph someone took with a loved one.

Chronologity must therefore leave room for explicit human attribution of importance.

Conceptually:

```text
User says:
"This Moment matters deeply to me."

        ↓

Personal significance signal
```

The initial product does not need to expose a numerical personal-significance rating.

Chronologity may eventually use concepts such as milestone, important, defining, or another carefully designed vocabulary.

The semantics should be established before selecting the interface terminology.

## Self-Attributed Significance Is Not Universal Significance

A User marking a Moment as personally important establishes information about that User's relationship to the Moment.

It does not establish that the Moment is globally important.

```text
Personally significant
        ≠
Universally significant
```

Likewise, another User should not be able to override the subject's personal significance merely because they disagree with it.

Different significance contexts may coexist.

## Collective Significance

**Collective significance** describes importance that emerges when many independent histories converge around the same occurrence, subject, place, or Event.

For example:

```text
Moment A ─┐
Moment B ─┤
Moment C ─┤
Moment D ─┼──▶ Real-World Event X
...       │
Moment N ─┘
```

A large number of independent historical records associated with the same real-world Event may provide evidence that the Event has broad collective significance.

However:

```text
Many Moments
    ≠
Automatically historically important
```

Large attendance, mass posting, coordinated behavior, or platform popularity can create volume without deep historical significance.

Collective significance should therefore be one signal rather than a universal truth.

## Independent Historical Convergence

Collective significance becomes more meaningful when historical records come from independent sources or perspectives.

Chronologity should conceptually distinguish:

```text
Many independent historical perspectives
```

from:

```text
Many copies, reposts, coordinated duplicates, or derivative records
```

This distinction may become important for historical Events, corroboration, evidentiary value, and abuse resistance.

The initial product does not need a perfect independence-detection system, but the model should not equate raw content volume with collective importance.

## Event Significance

**Event significance** describes significance inherited from or contributed to a real-world Event.

A Moment may be significant because it documents an important Event.

Likewise, a real-world Event may become significant partly because many consequential or evidentially valuable Moments are associated with it.

Conceptually:

```text
Moment significance
       ↕
Real-World Event significance
```

The relationship may operate in both directions.

Chronologity should avoid assuming that every Moment associated with an important Event is equally significant.

A routine photograph and the only known recording of a pivotal occurrence may belong to the same Event while having very different historical value.

The detailed semantics of real-world Events belong in `real-world-events.md`.

## Evidentiary Significance

**Evidentiary significance** describes how valuable a Moment is as documentation or evidence of an occurrence.

A Moment may have high evidentiary significance because it:

- uniquely documents something;
- provides a rare perspective;
- corroborates another historical record;
- contains primary-source media;
- establishes temporal or location context;
- preserves information unavailable elsewhere; or
- contributes materially to understanding what occurred.

For example:

```text
500 Moments associated with Event X

499 show ordinary crowd scenes
1 captures the only known recording of a pivotal occurrence
```

The unique Moment may have unusually high evidentiary significance even if it has little social engagement.

## Evidentiary Significance Is Not Truth

Chronologity must be careful with the word "evidence."

A Moment providing evidence does not automatically establish that every interpretation of that evidence is true.

Media can be incomplete, misleading, misdated, manipulated, misunderstood, or stripped of context.

Therefore:

```text
Evidentiary value
        ≠
Guaranteed truth
```

Chronologity should preserve provenance and context rather than presenting algorithmic confidence as historical certainty.

## Retrospective Significance

**Retrospective significance** describes importance that becomes apparent only as later history unfolds.

History frequently changes the meaning of earlier events.

For example:

```text
Moment A:
Two people meet.

Years later:
      ↓
They create something historically consequential.
```

The meeting may acquire significance that could not reasonably have been known when it occurred.

Similarly:

```text
Moment:
First use of an emerging technology

Later:
Technology transforms an industry
```

The earlier Moment may become historically more important in retrospect.

Chronologity's significance model must therefore be capable of evolving.

## Significance Is Not Immutable

The underlying Moment remains historically stable.

Chronologity's interpretation of its significance may change.

```text
Historical occurrence
        → stable

Understanding of significance
        → may evolve
```

This distinction is critical.

A later significance change must not rewrite:

- when the Moment occurred;
- who created it;
- the media it originally contained;
- its historical provenance;
- its causal assertions; or
- other authoritative historical facts.

Significance is interpretive metadata about history, not a replacement for history.

## Significance Over Time

Chronologity may need to retain or reconstruct how significance was understood at different times, particularly if significance affects derived product experiences.

However, the initial product does not require a publicly visible history of significance calculations.

Internal provenance may eventually include:

- algorithm version;
- computation time;
- source signals;
- historical scope;
- causal graph state;
- Event associations; and
- explicit User attributions.

This allows derived significance to evolve without becoming opaque or irreproducible.

## Engagement

Engagement signals include things such as:

- reactions;
- comments;
- views;
- follower activity;
- shares, if Chronologity later supports them;
- notification interactions; and
- other measures of social attention.

These signals may be useful for understanding social response.

They must not be treated as synonymous with historical significance.

```text
Highly engaged
    ≠
Historically important

Historically important
    ≠
Highly engaged
```

A Moment can satisfy either, both, or neither condition.

## Why Engagement Must Remain Separate

Engagement optimization creates incentives that are fundamentally different from historical preservation.

If engagement becomes the primary significance signal, Chronologity would reward:

- sensationalism;
- controversy;
- celebrity;
- recency;
- large existing audiences;
- coordinated attention;
- outrage;
- repeated consumption; and
- other behaviors that may have little relationship to historical importance.

Chronologity should not recreate an attention-ranking network under historical terminology.

## Reactions and Significance

Reactions express Users' social responses to a Moment.

They may provide contextual information but must not directly define historical significance.

A Moment with one Reaction may be more historically significant than a Moment with one million Reactions.

Reaction counts should therefore remain outside the authoritative historical-significance model unless Chronologity later defines a narrow, explicit derived use that does not confuse attention with importance.

## Comments and Significance

Comment volume does not establish historical significance.

A Moment may receive many Comments because it is controversial, amusing, confusing, or currently popular.

Comments may nevertheless contain information that helps humans understand significance, identify causal relationships, provide corrections, or recognize evidentiary value.

That information should enter formal historical models only through explicit workflows rather than raw Comment counts.

## Views and Significance

View count measures consumption.

It does not measure historical importance.

Chronologity should never assume:

```text
Most viewed
    =
Most historically significant
```

View data may be useful for operations, analytics, creator feedback, or discovery, but it should remain conceptually separate.

## Significance and Popularity

Popularity describes how much attention something receives.

Historical significance describes how consequential or important something is within history.

These concepts can correlate without being equivalent.

For example:

```text
Popular but historically minor
Historically significant but obscure
Popular and historically significant
Neither popular nor historically significant
```

Chronologity should preserve all four possibilities.

## Historical Significance Profile

Rather than requiring a single universal score, Chronologity should conceptually support a **Historical Significance Profile**.

For example:

```text
Moment Significance
│
├── causal
├── structural
├── temporal
├── personal
├── collective
├── Event
├── evidentiary
└── retrospective
```

The profile represents different reasons a Moment may matter.

It does not require every dimension to be represented numerically.

Some dimensions may eventually be:

- derived;
- asserted;
- categorical;
- graph-based;
- confidence-weighted;
- scope-specific; or
- unavailable.

The product model should not force artificial precision.

## Composite Significance

Chronologity may eventually compute composite significance for a specific product operation.

For example, temporal zoom may need a way to compare candidate Moments within a particular scope.

Such a composite should be understood as:

```text
Context-specific derived value
```

not:

```text
Universal objective measure of historical importance
```

Different contexts may weight dimensions differently.

For example, a personal Timeline may emphasize:

```text
personal
causal
temporal
```

while a real-world Event view may emphasize:

```text
collective
Event
evidentiary
causal
```

The exact weighting should be versioned and explainable enough to avoid silently changing the meaning of the product.

## Significance Versus Salience

Chronologity should distinguish **historical significance** from **display salience**.

Historical significance asks:

> How important is this Moment within the current historical context?

Display salience asks:

> Should this Moment be shown or emphasized in this particular interface state?

These are different questions.

A Moment may be historically significant but:

- inaccessible to the current viewer;
- redundant with another selected Moment;
- outside the current temporal scope;
- too similar to neighboring representative Moments;
- unsuitable for the current display capacity; or
- intentionally hidden by the User.

Therefore:

```text
Historical significance
        │
        ▼
Candidate importance

+ authorization
+ temporal scope
+ display capacity
+ diversity
+ redundancy reduction
+ User preferences
        │
        ▼
Display salience
```

Historical significance should inform salience.

It should not completely determine it.

## Significance Versus Ranking

Chronologity's chronological Feed must remain chronological according to its defined Feed semantics.

Historical significance must not become an excuse to reorder the primary chronological Feed into an algorithmic relevance Feed.

```text
Chronological Feed
        ≠
Significance-ranked Feed
```

Significance may be used for:

- temporal zoom;
- representative Moment selection;
- historical summaries;
- navigation aids;
- Event representation;
- historical exploration;
- contextual emphasis; and
- other explicitly significance-aware surfaces.

Those uses must remain distinct from ordinary chronological ordering.

## Temporal Zoom

Historical significance is a foundational input to temporal zoom.

As a User zooms outward, Chronologity cannot display every Moment with equal visual prominence.

For example:

```text
Detailed scope
    ↓
Thousands of Moments

Zoom outward
    ↓
Hundreds of representative Moments

Zoom outward again
    ↓
Dozens of representative Moments
```

Chronologity must select which Moments best represent the broader historical scope.

Historical significance should inform that selection.

## Representative Moment Selection

Temporal zoom should not simply select:

- the most reacted-to Moments;
- the most commented-on Moments;
- the most viewed Moments;
- the newest Moments;
- Moments from the most-followed Users; or
- Moments predicted to maximize engagement.

Instead, representative selection may consider:

```text
historical significance
        +
temporal coverage
        +
contextual diversity
        +
redundancy reduction
        +
authorization
        +
display constraints
        ↓
Representative Moments
```

This allows Chronologity to compress history without turning temporal zoom into a popularity ranking.

## Temporal Coverage

Significance alone is insufficient for representative selection.

Suppose the ten most significant Moments in a decade all occurred during the same week.

Showing only those Moments may produce a poor representation of the decade.

Temporal zoom should therefore balance significance with coverage.

Conceptually:

```text
High significance
        +
Representative temporal distribution
        ↓
Useful historical abstraction
```

This is one reason significance and salience must remain distinct.

## Diversity and Redundancy

A historical scope may contain many highly similar Moments.

For example, hundreds of Moments may document the same Event from nearly identical perspectives.

Temporal zoom should not necessarily choose all of them merely because each has high Event significance.

Representative selection may reduce redundancy while preserving diverse perspectives.

Potential diversity considerations include:

- different times;
- different locations;
- different people;
- different causal branches;
- different Events;
- different media perspectives; and
- different historical roles.

The exact selection algorithm belongs in architecture and product-design specifications.

## User Control in Temporal Zoom

Algorithmic significance should not eliminate User agency.

If a User explicitly identifies a Moment as personally important, Chronologity should strongly consider that signal when representing that User's history at broader temporal scales.

However, Users should not necessarily be able to declare their own Moment universally significant to every historical scope.

```text
Personal importance
        → strong personal-scope signal

Personal importance
        ≠ automatic global importance
```

## Historical Jumps

Historical jumps allow Users to navigate to distant points in time.

Significance may help Chronologity identify useful jump destinations, such as:

- major causal predecessors;
- major causal consequences;
- temporal boundaries;
- important Event anchors; or
- other significant Moments within the current historical scope.

However, significance must not override authorization.

```text
Significant destination
        +
Not authorized
        ↓
Do not expose destination
```

Graph connectivity and importance are not permissions.

## Causal Navigation

Causal significance may help prioritize which causal relationships are most useful to expose when a Moment participates in a large causal graph.

This is a salience decision.

The underlying causal relationships remain independent historical assertions.

Chronologity must not delete or falsify lower-significance causal relationships merely because the interface cannot show them all simultaneously.

## Real-World Events

Real-world Events are natural convergence points for historical significance.

A significant Event may contain many Moments of varying significance.

Likewise, a collection of important Moments may contribute to Chronologity's understanding of the Event.

The Event model should support:

- many independent perspectives;
- uneven Moment significance;
- Event-level temporal boundaries;
- causal connections;
- evidentiary diversity; and
- collective historical convergence.

Event significance must not be derived solely from the number of associated Moments.

## Locations

A Moment may be significant within a location-specific historical scope even if it is not significant globally.

For example:

```text
First building opened at Location X
```

may be extremely important to the history of that location.

Location context may therefore affect significance evaluation.

Co-location alone does not establish significance.

## People

A Moment may be significant because of its relationship to one or more people.

Chronologity should not assume that a person's public popularity determines the historical significance of Moments involving them.

A Moment involving an unknown person may be personally or evidentially more significant than one involving a globally famous person.

Person identity is context, not an automatic importance multiplier.

## Shared History

The same Moment may have different significance to different people represented by it.

For example:

```text
Moment:
Graduation ceremony

Person A:
Defining personal milestone

Person B:
Ordinary work assignment

Person C:
Important family milestone
```

Chronologity should allow these perspectives to coexist.

Historical significance is not necessarily unanimous.

## Conflicting Significance Assessments

Users, communities, historians, algorithms, or later evidence may disagree about what matters.

Chronologity should not require all significance assessments to collapse into one authoritative opinion.

Where significance is explicitly attributed, provenance should identify the source of the assessment.

Conceptually:

```text
Significance assertion
        │
        ├── who or what asserted it?
        ├── in what scope?
        ├── when?
        └── on what basis?
```

This becomes increasingly important if Chronologity later supports institutional, scholarly, community, or AI-assisted historical interpretation.

## AI and Historical Significance

AI may eventually assist with:

- identifying possible temporal boundaries;
- detecting structurally important Moments;
- summarizing causal structures;
- suggesting representative Moments;
- identifying redundancy;
- recognizing possible Event convergence; or
- explaining why a Moment may be significant.

AI should not become an unreviewable authority on historical importance.

```text
AI significance inference
        ≠
Historical fact
```

Where AI-derived significance materially affects the product experience, Chronologity should preserve enough provenance to distinguish inference from explicit human attribution or graph-derived structure.

## Explainability

Chronologity should prefer significance systems whose outputs can be meaningfully explained.

A User should not necessarily see a mathematical score, but the system should be capable of reasoning in terms such as:

- "This Moment begins a major causal chain."
- "You marked this as personally important."
- "This Moment represents a major transition in this period."
- "This is one of several independent records of this Event."
- "This Moment provides a unique perspective on the Event."

Chronologity should avoid a black-box system whose only explanation is:

> "The algorithm determined this was important."

## Significance Confidence

Some significance dimensions may be uncertain.

Chronologity should leave room to distinguish high-confidence structural information from speculative inference.

For example:

```text
Explicit personal significance
        → directly asserted

Confirmed Event association
        → established relationship

AI-inferred temporal boundary
        → probabilistic inference
```

These signals should not necessarily be treated as equally authoritative.

The initial product does not require exposing numerical confidence values to Users.

## Manipulation Resistance

Any significance mechanism that affects visibility or prominence may attract manipulation.

Chronologity should assume Users may attempt to increase apparent importance through:

- artificial engagement;
- duplicate Moments;
- coordinated activity;
- false Event associations;
- fabricated causal relationships;
- mass significance attribution; or
- other gaming behavior.

The product should therefore avoid significance models that can be trivially manipulated through social-volume metrics.

Explicit User significance should primarily affect scopes in which that User's assessment is legitimately relevant.

## No Universal Historical Leaderboard

Chronologity should not introduce a universal leaderboard of "most historically significant Moments."

Such a leaderboard would falsely imply that unrelated personal, local, cultural, national, and global histories can be reduced to one objective ordering.

It would also create strong incentives to game significance.

Chronologity may eventually provide curated or context-specific historical exploration, but those surfaces should make their scope explicit.

## No Universal Significance Score in the UI

The product should not initially display:

```text
Historical Significance: 87.4
```

A number of this kind implies more objectivity and precision than the underlying concept warrants.

Internal numerical representations may be useful for computation.

The user-facing product should prefer meaningful historical context over false precision.

## Significance and Privacy

Historical significance does not override privacy.

A highly significant Moment may remain private.

A Moment's importance does not grant other Users a right to access it.

```text
Historically significant
        ≠
Public
```

Temporal zoom, Event aggregation, historical summaries, discovery, and representative selection must apply authorization before exposing restricted Moments or sensitive derived information.

## Significance Leakage

Even if a private Moment itself is hidden, derived significance can leak information.

For example:

> "A major life event occurred here"

could reveal sensitive information even if the Moment is not shown.

Chronologity must therefore treat significance metadata and aggregate summaries as potentially privacy-sensitive.

Authorization must apply to derived representations, not only source Moments.

## Significance and Blocking

Blocking does not rewrite historical significance.

If a blocked User participated in a historically important Moment, the historical relationship may still exist.

However, the block may affect what either User can see or how shared context is presented.

Safety and privacy constraints take precedence over significance-driven salience.

## Significance and Deletion

Deleting a Moment removes it from ordinary significance-driven product experiences according to the applicable deletion semantics.

Derived significance calculations must eventually stop selecting or exposing deleted content.

If internal records must be retained for legal, safety, or audit reasons, that retention does not imply continued product visibility.

Deleting one Moment may also change the computed significance of other Moments if the deleted Moment participated in a derived graph calculation.

## Significance and Corrections

If Chronologity supports correction of historical metadata, significance may need to be recomputed after a correction changes relevant context.

For example, correcting:

- occurrence time;
- Event association;
- causal relationships;
- location;
- participant association; or
- other historical context

may change a Moment's significance within a scope.

The correction changes the relevant historical model.

The significance system should respond to the corrected model rather than preserving a stale interpretation.

## Significance Provenance

Derived significance should preserve enough provenance to understand how it was produced.

Depending on the mechanism, provenance may include:

- significance dimension;
- historical scope;
- source relationships;
- explicit User attribution;
- algorithm version;
- configuration version;
- computation time;
- graph position or event position;
- confidence or inference status; and
- relevant historical inputs.

This does not require exposing all internal provenance publicly.

It does require avoiding unexplained derived importance that cannot be audited or reproduced.

## Versioning

Any algorithm used to derive historical significance should be versioned.

Chronologity's understanding of history may improve as the product evolves.

For example:

```text
Significance model v1
        ↓
Significance model v2
```

may produce different representative selections without changing the underlying Moments.

Versioning allows Chronologity to distinguish:

```text
History changed
```

from:

```text
Our interpretation algorithm changed
```

Those are fundamentally different events.

## Recomputability

Derived significance should be recomputable from authoritative historical data and explicit significance inputs wherever practical.

Chronologity should avoid making an opaque derived score the only surviving record of why a Moment was considered important.

Conceptually:

```text
Authoritative history
        +
Explicit significance inputs
        +
Versioned derivation
        ↓
Recomputable significance
```

This aligns significance with Chronologity's broader emphasis on provenance and derived read models.

## Eventual Consistency

Historical significance does not need to update synchronously after every relevant change.

For example, adding a causal relationship may eventually change recursive significance across a larger graph.

Chronologity may process such changes asynchronously.

The product should tolerate:

```text
Authoritative history updated now
Significance projection catches up shortly afterward
```

provided the system does not misrepresent stale derived significance as authoritative historical fact.

## Historical Significance Product Invariants

1.  Historical significance describes contextual importance within history.
2.  Historical significance is distinct from popularity, engagement, and display ranking.
3.  Significance must be evaluated within an explicit or implicit historical scope.
4.  A Moment may have different significance in different scopes.
5.  Chronologity should model significance as multidimensional rather than inherently reducible to one universal score.
6.  Foundational dimensions include causal, structural, temporal, personal, collective, Event, evidentiary, and retrospective significance.
7.  Causal significance must not be reduced to direct outgoing causal-edge count.
8.  Later causal history may increase the significance of earlier Moments.
9.  Structural position within history may itself be a source of significance.
10. Temporal boundaries and transitions may be historically significant.
11. Personal significance must be able to exist without social engagement or graph-derived importance.
12. A User's personal-significance attribution does not establish universal significance.
13. Collective significance must not be reduced to raw Moment volume.
14. Independent historical convergence is more meaningful than duplicated or coordinated volume.
15. Moments associated with the same real-world Event may have different significance.
16. Evidentiary significance does not establish guaranteed truth.
17. A Moment may acquire retrospective significance as later history unfolds.
18. The historical occurrence remains stable even when Chronologity's understanding of its significance changes.
19. Reactions, Comments, views, follower counts, and similar engagement metrics must not define historical significance.
20. Popularity and historical significance may correlate but are not equivalent.
21. Chronologity should conceptually support a Historical Significance Profile rather than requiring one universal score.
22. Context-specific composite significance may be computed where a product operation requires comparison.
23. Historical significance and display salience are distinct concepts.
24. Historical significance must not reorder the primary chronological Feed into an engagement or relevance Feed.
25. Historical significance is a foundational input to temporal zoom.
26. Temporal zoom should balance significance with temporal coverage, diversity, redundancy reduction, authorization, and display constraints.
27. Explicit personal importance should strongly influence representation within appropriate personal historical scopes.
28. Historical jumps may use significance to identify useful destinations but must not bypass authorization.
29. Causal salience must not erase less-prominent causal relationships from the underlying historical model.
30. Person popularity must not automatically increase Moment significance.
31. The same Moment may legitimately have different significance to different people.
32. Conflicting significance assessments may coexist when their provenance and scope differ.
33. AI-derived significance is inference, not historical fact.
34. Significance mechanisms should be explainable enough to communicate why a Moment was considered important.
35. Significance systems must anticipate manipulation and should not be trivially gameable through engagement volume.
36. Chronologity should not provide a universal historical-significance leaderboard.
37. Chronologity should not initially expose a universal numerical Historical Significance Score to Users.
38. Historical significance never overrides privacy or authorization.
39. Derived significance and summaries must not leak restricted historical information.
40. Blocking affects access and presentation, not the truth of historical significance.
41. Deletion and historical correction may require derived significance to be recomputed.
42. Derived significance should preserve provenance appropriate to its source and computation.
43. Significance algorithms should be versioned.
44. Derived significance should be recomputable from authoritative historical data and explicit inputs wherever practical.
45. Significance computation may be eventually consistent when recursive or large-scale analysis makes synchronous computation impractical.

## Day-One Historical Significance Requirements

Historical significance is a day-one architectural requirement because temporal zoom and historical jumps are day-one Chronologity features.

Before launch, Chronologity must have explicit product and implementation behavior for:

- distinguishing historical significance from engagement;
- evaluating significance within a historical scope;
- representing at least the significance signals required by day-one temporal zoom;
- incorporating explicit personal importance if personal significance ships in the initial experience;
- using causal structure as an input where causal information exists;
- recognizing important temporal boundaries where supported;
- using real-world Event context where available;
- selecting representative Moments at broader temporal zoom levels;
- balancing significance with temporal coverage;
- reducing redundant representative Moments;
- preserving diversity across representative history;
- enforcing authorization before significance-driven selection is exposed;
- preventing significance metadata from leaking inaccessible history;
- keeping the primary Feed chronologically ordered;
- recomputing derived significance when relevant authoritative history changes;
- versioning any derived significance algorithm used in production; and
- preserving enough provenance to distinguish explicit human significance from algorithmic inference.

The initial release does not require:

- a universal Historical Significance Score;
- a public significance leaderboard;
- perfect evidentiary analysis;
- scholarly consensus modeling;
- AI-determined historical truth;
- a complete global historical-significance graph;
- public numerical confidence values;
- public algorithmic provenance details;
- universal reconciliation of conflicting significance assessments; or
- synchronous recursive significance updates.

Day one does require enough of the model to make temporal zoom principled rather than engagement-driven or arbitrary.

## What Is Settled

**All eight dimensions ship** (ADR-115): causal, structural, temporal, personal, collective, Event, evidentiary, and retrospective.

**Significance is stored per Moment, per scope, per dimension** — a person, a real-world Event, a place, or globally. There is no single value per Moment, because a family's first photograph after immigrating may be among the most consequential Moments in that family's history and globally unremarkable.

**Causal significance counts everything reachable downstream**, bounded in depth, never the number of direct edges. In a chain every Moment has one outgoing edge and the whole chain descends from the first.

**Retrospective significance is what recomputation reveals**, not a separate analysis. Each dimension keeps what it scored when first assessed, and the difference is what later history changed.

**Personal significance is one binary mark.** Anybody may mark any Moment they can see — the last photograph of a loved one may have been taken by somebody else — and every mark is private. Nothing anywhere reports another person's mark.

**A temporal boundary is inferred from position**: the earliest or latest in a record, at a place, or among those tied to an Event. Gap-based inference was rejected because it needs a threshold nobody can justify, and an arbitrary constant inside a significance algorithm is the accidental definition of importance this document warns against. What position misses, the personal mark covers.

**Collective significance counts distinct people, never Moment volume** — and it is knowingly weak. Preventing coordinated posting from manufacturing convergence is unsolved; the dimension carries its own algorithm version so it can be replaced alone, and nothing consumes significance until temporal zoom exists.

**Engagement cannot reach significance.** The code that computes it imports nothing from reactions or comments, and a test asserts it. Separation is enforced rather than intended.

**Nothing exposes a significance score.** The only endpoints concern somebody's own mark.

## Open Product Questions

The following questions require deliberate resolution:

- Can Users choose to make their personal-significance attribution visible to others?
- Should the creator of a Moment know when another participant marks it personally significant?
- Should Users be able to remove or change personal-significance attribution?
- How should personal significance differ from bookmarking or saving a Moment?
- If recursive significance ships on day one, how frequently should it be recomputed?
- How should causal confidence or disputed causal relationships affect significance?
- Should Chronologity allow Users to explicitly mark beginnings, endings, and transitions?
- How should significance be evaluated when occurrence time is imprecise?
- How should significance behave for Moments spanning a period rather than a point in time?
- Which structural graph signals are useful enough to implement initially?
- How should collective significance distinguish independent perspectives from duplicates?
- How should coordinated posting be prevented from manufacturing collective significance? Counting distinct authors raises the cost without closing the hole, and this remains the weakest dimension.
- How many independent Moments are necessary before collective convergence becomes meaningful?
- Should collective significance be normalized for the number of active Chronologity Users in a place, period, or Event?
- How should Chronologity prevent coordinated posting from manufacturing collective significance?
- What Event properties contribute to Event significance?
- Can Event significance be explicitly curated or asserted by Users?
- Should Event significance itself be multidimensional?
- How does significance flow between an Event and its associated Moments?
- How should Chronologity treat a highly significant Event containing an ordinary Moment?
- What evidentiary signals, if any, should exist in the initial release?
- Should evidentiary significance ever be user-asserted?
- How should corroborating Moments affect one another's evidentiary significance?
- How should contradictory evidence affect significance?
- Should media uniqueness contribute to evidentiary significance?
- How should manipulated or disputed media affect evidentiary significance?
- How quickly should retrospective significance respond to new causal or Event relationships?
- Should Users be informed when an old Moment becomes more prominent because later history changed its significance?
- Should Chronologity preserve historical snapshots of significance calculations internally?
- What significance provenance should be visible to Users?
- Should Users ever see explanations such as "shown because this was a major transition"?
- Should Users be able to override representative Moment selection in their own Timeline?
- Can a User pin a Moment so it always survives certain personal temporal zoom levels?
- If pinning exists, is that a significance signal or merely a presentation preference?
- How many representative Moments should appear at each temporal zoom level?
- Should the number depend on screen size, device orientation, density, or user preference?
- How should temporal coverage be balanced against significance?
- How should diversity be defined for representative selection?
- How aggressively should near-duplicate Moments be collapsed at broader zoom levels?
- When several Moments represent the same Event, should Chronologity prefer one representative Moment or an Event-level representation?
- How should private significant Moments affect a public or shared temporal summary?
- Can Chronologity reveal that hidden significant history exists without revealing what it is?
- Should significance influence search ranking?
- Should significance influence discovery outside the chronological Feed?
- If so, which dimensions are appropriate for those surfaces?
- Should significance influence notifications?
- Should significance affect storage, retention, or media quality policies? The recommended default is no.
- If engagement is ever used, what safeguards prevent popularity from dominating?
- Should historical significance be exportable as part of User data portability?
- Should Users be able to inspect why one Moment was selected over another during temporal zoom?
- What happens when two significance-model versions produce substantially different representations of the same period?
- Should representative selections be cached by historical scope and zoom level?
- What freshness guarantees are required after causal, Event, privacy, or deletion changes?
- How should significance be recomputed for extremely large historical graphs?
- Which significance computations must be deterministic?
- Which significance calculations may use probabilistic or AI-assisted inference?
- How should AI-assisted significance be labeled internally and, where appropriate, publicly?
- What auditability is required for significance-driven historical representation?

These questions should be resolved before the temporal-zoom implementation hardens an accidental definition of what Chronologity considers important.

## Architecture Constraints

This document does not prescribe a significance service, scoring engine, graph algorithm, database, projection schema, machine-learning model, or API.

It does impose several architectural constraints.

Authoritative Moment data and derived historical significance must remain separate.

Conceptually:

```text
Authoritative historical model
        │
        ├── Moments
        ├── occurrence semantics
        ├── causal relationships
        ├── Event associations
        ├── people
        ├── locations
        └── explicit significance inputs
                │
                ▼
       Derived significance
                │
                ▼
         Product salience
```

A significance recalculation must not mutate the authoritative historical occurrence.

Derived significance should be independently recomputable wherever practical.

Any production significance algorithm should have explicit version identity so Chronologity can distinguish algorithm evolution from historical change.

The architecture must support significance evaluation by scope rather than assuming one global value per Moment.

It must also support asynchronous recomputation because causal, structural, collective, Event, and retrospective significance may depend on large graphs or later-arriving history.

Temporal-zoom read models may cache or project significance-driven representative selections, but those representations must remain invalidatable when relevant authorization, privacy, deletion, causal, Event, or significance inputs change.

Engagement metrics should remain architecturally separable from historical-significance inputs so that a future optimization cannot casually turn reaction or view counts into historical importance.

Where AI contributes significance inference, the architecture should preserve the distinction between:

```text
explicit human attribution
graph-derived significance
rule-derived significance
AI-inferred significance
```

so that Chronologity does not lose provenance as the system becomes more sophisticated.

## Guiding Principle

When deciding whether a Moment should be considered historically significant, ask:

> **Why does this Moment matter within the history being examined?**

Not:

> **How much attention did this Moment receive?**

Chronologity should preserve history first, understand its structure second, and use significance to help people navigate that history without allowing popularity to decide what matters.
