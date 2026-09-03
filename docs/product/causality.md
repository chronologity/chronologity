# Chronologity Causality

## Purpose

This document defines how Chronologity represents **causal and other meaningful relationships between Moments**.

Chronology answers:

> What happened before or after this?

Causality answers:

> What led to this, and what did this lead to?

These questions are related, but they are not equivalent.

Chronologity's Timeline establishes temporal relationships between Moments. Causal relationships must be represented separately and explicitly because temporal sequence alone is not evidence that one event caused another.

```text
Chronology ≠ Causality
```

This distinction is foundational to Chronologity's goal of creating a trustworthy chronological record of human experience.

## Definition

A **causal relationship** is an explicit assertion that one Moment meaningfully contributed to, enabled, motivated, triggered, resulted in, or otherwise influenced another Moment.

For example:

```text
Graduated from College
        │
        ▼
Accepted First Job
        │
        ▼
Moved to New York
```

The sequence may describe a meaningful causal chain.

However, Chronologity must not infer that chain merely because the Moments occurred in that order.

The chronological facts may be:

```text
Graduation occurred first.
Job acceptance occurred second.
Move occurred third.
```

The causal assertions are separate:

```text
Graduation contributed to Job Acceptance.
Job Acceptance led to Move.
```

Chronologity should preserve both kinds of information without conflating them.

## Why Causality Matters

Chronology provides structure, but human histories are meaningful partly because events influence one another.

A Timeline can show:

```text
2018 ── Graduated
2019 ── Started Company
2021 ── Company Failed
2022 ── Joined New Company
2025 ── Started Another Company
```

That sequence tells the user **what happened**.

Relationships between those Moments may tell a deeper story:

```text
Started Company
      │
      ▼
Company Failed
      │
      ▼
Learned From Failure
      │
      ▼
Started Another Company
```

Chronologity's long-term value should extend beyond storing isolated Moments. It should help users understand how experiences relate across time.

That makes relationships between Moments an important part of the product model.

## Chronology Is Not Evidence of Causality

The most important rule in this document is:

> **Chronologity must never infer causality solely from chronological proximity.**

If Moment A occurred before Moment B, Chronologity knows only that A preceded B.

```text
A ──time──► B
```

does not imply:

```text
A ──caused──► B
```

Similarly, events occurring close together do not necessarily have a meaningful relationship.

```text
8:00 AM ── Had Breakfast
9:00 AM ── Received Job Offer
```

Breakfast did not necessarily cause the job offer.

This rule applies regardless of how sophisticated future machine-learning or recommendation systems become.

## Causality Must Be Explicit

A causal relationship should exist only when there is an explicit basis for asserting it.

Initially, that basis should come from a user intentionally establishing the relationship.

Conceptually:

```text
Moment A
   │
   │ user establishes relationship
   ▼
Moment B
```

Chronologity may eventually assist users in discovering possible relationships, but assistance must not silently transform a suggestion into historical fact.

## User-Asserted Relationships

The initial authority for causal relationships should be the user.

A user may indicate that one Moment:

- led to another;
- contributed to another;
- enabled another;
- motivated another; or
- otherwise meaningfully influenced another.

The exact vocabulary exposed in the interface should remain intentionally small until product testing demonstrates that users need more precision.

The product should avoid creating an elaborate ontology of causal relationships before understanding how people naturally describe their histories.

## Suggested Relationships

Chronologity may eventually identify possible relationships between Moments.

For example, the system might observe:

- temporal proximity;
- shared people;
- shared location;
- shared real-world Event;
- similar descriptive language; or
- explicit references in descriptions.

These signals may justify a suggestion:

> These Moments may be related.

They do not justify an assertion:

> This Moment caused that Moment.

The distinction should be visible in both the product model and the interface.

```text
Suggested relationship ≠ Confirmed relationship
```

## AI and Causal Inference

Future AI systems may be capable of identifying plausible causal relationships from a user's history.

Chronologity should treat such output as **hypothesis generation**, not historical authority.

An AI system may propose:

```text
Possible relationship:
Accepted Job → Moved to New York
```

The product may allow the user to confirm, reject, or refine the suggestion.

Until confirmed according to the product's rules, the relationship should not be presented as an established part of the user's history.

AI confidence is not equivalent to historical truth.

```text
Model confidence ≠ Historical certainty
```

## Relationship Direction

Causal relationships are directional.

If Moment A led to Moment B:

```text
A ──led to──► B
```

that does not imply:

```text
B ──led to──► A
```

The direction of the relationship is part of its meaning.

This differs from some contextual relationships, which may be naturally symmetric.

For example:

```text
Moment A ──related to── Moment B
```

may be meaningful in both directions even though the underlying relationship is stored with a particular orientation.

## Temporal Constraints on Causality

In ordinary causal relationships, a cause cannot occur after its effect.

Therefore, when Chronologity represents a relationship such as:

```text
A ──caused──► B
```

the temporal semantics should normally be consistent with:

```text
A occurred before or during B.
```

If the relationship conflicts with known occurrence times, Chronologity should not silently accept the contradiction.

Possible explanations may include:

- incorrect occurrence information;
- an incorrectly directed relationship;
- approximate or uncertain dates;
- a relationship whose semantics are not actually causal; or
- another modeling issue.

The product should help resolve the contradiction rather than rewriting history automatically.

## Approximate and Uncertain Time

Chronologity may contain Moments whose dates are approximate or partially known.

This means temporal validation of causal relationships cannot always be absolute.

For example:

```text
Moment A: sometime in 1998
Moment B: June 1998
```

Chronologity may not know whether A occurred before B.

The product should preserve uncertainty rather than rejecting a potentially valid relationship or inventing precision.

```text
Unknown order ≠ Invalid relationship
```

## Causal Chains

Multiple causal relationships may form a chain.

```text
Moment A
   │
   ▼
Moment B
   │
   ▼
Moment C
   │
   ▼
Moment D
```

Such chains can help users understand longer arcs within their histories.

However, Chronologity should not automatically apply transitive causality.

If:

```text
A caused B
B caused C
```

Chronologity must not automatically assert:

```text
A caused C
```

A may have indirectly contributed to C, but that is a different claim.

```text
Direct causality ≠ Transitive causality
```

## Multiple Causes

A Moment may have more than one cause or contributing factor.

```text
Moment A ─────┐
              │
Moment B ─────┼──► Moment D
              │
Moment C ─────┘
```

Chronologity should not force human history into a single-parent chain.

Real experiences are often influenced by multiple prior events.

## Multiple Effects

Similarly, one Moment may influence multiple later Moments.

```text
              ┌──► Moment B
              │
Moment A ─────┼──► Moment C
              │
              └──► Moment D
```

The relationship model should therefore support a graph rather than assuming a simple linear tree.

## Relationship Graph

The Timeline and the relationship graph represent different structures over the same Moments.

### Timeline

```text
Moment A
   │
   ▼
Moment B
   │
   ▼
Moment C
   │
   ▼
Moment D
```

The Timeline is primarily ordered by time.

### Relationship Graph

```text
Moment A ─────► Moment C
    │
    └─────────► Moment D

Moment B ─────► Moment D
```

The relationship graph represents semantic connections.

Chronologity should not attempt to force one structure to serve both purposes.

```text
Timeline = temporal structure
Relationship graph = semantic structure
```

## Beyond Causality

Not every meaningful relationship between Moments is causal.

Chronologity may eventually support a small set of relationship categories.

Potential examples include:

- **led to** --- one Moment meaningfully resulted in another;
- **contributed to** --- one Moment was one of multiple influences;
- **part of** --- one Moment belongs to a broader experience represented by another concept;
- **continuation of** --- one Moment continues an earlier experience;
- **related to** --- the Moments are meaningfully associated without a stronger causal claim.

The exact vocabulary should remain conservative.

Too many relationship types would create cognitive burden and make histories harder rather than easier to understand.

## Causal Versus Contextual Relationships

Contextual relationships and causal relationships should remain distinct.

For example:

```text
Moment A and Moment B occurred at the same concert.
```

This establishes shared Event context.

It does not establish:

```text
Moment A caused Moment B.
```

Likewise:

```text
Moment A and Moment B occurred in New York.
```

establishes shared location context, not causality.

Chronologity should derive contextual relationships where appropriate while requiring stronger evidence for causal assertions.

## Relationship Identity

A relationship is meaningful information in its own right.

Conceptually:

```text
Relationship
 ├── Source Moment
 ├── Target Moment
 ├── Type
 ├── Provenance
 └── State
```

This is a conceptual model, not a prescribed database schema.

Treating the relationship as meaningful information allows Chronologity to distinguish who asserted it, whether it was suggested, whether it was confirmed, and whether it was later removed or corrected.

## Relationship Provenance

Chronologity should preserve enough provenance to understand why a relationship exists.

Possible provenance may include:

- asserted by a user;
- confirmed from a system suggestion;
- established through another explicit product action; or
- derived as contextual information rather than causal information.

Provenance becomes especially important if Chronologity eventually uses AI to suggest relationships.

Users should be able to distinguish:

> I said these events were related.

from:

> Chronologity suggested these events might be related.

## Relationship Confidence

User-asserted causal relationships should generally be treated as the user's representation of their own history rather than assigned a pseudo-scientific numerical probability.

Chronologity should avoid displaying arbitrary causal confidence scores such as:

```text
87% likely that Moment A caused Moment B
```

unless there is a compelling, well-defined product reason and a trustworthy interpretation for that number.

Human histories are not improved by false mathematical precision.

## Conflicting Relationships

Different users may disagree about the relationship between shared historical events.

For example, two people may agree that certain events occurred while disagreeing about why they occurred.

Chronologity's long-term shared-history model should not assume that every causal assertion is universally objective.

Where multiple perspectives are possible, the product may need to preserve provenance and perspective rather than forcing one canonical causal interpretation.

This is especially important as Chronologity expands from personal histories toward shared or public histories.

## Personal Perspective

For personal history, a causal relationship may represent the user's own understanding of their experiences.

For example:

> Moving to New York led me to meet the person who became my cofounder.

That is meaningful even if the relationship is subjective.

Chronologity does not need to transform personal narrative into an externally provable historical claim before allowing the user to represent it.

However, the product should preserve whose perspective the relationship represents.

## Shared and Public History

Causal claims become more complicated when Moments participate in shared or public history.

A statement such as:

```text
Event A caused Event B
```

may be disputed.

Chronologity should therefore be cautious about promoting user assertions into platform-wide historical facts.

The product may eventually need distinctions such as:

```text
Personal assertion
Shared assertion
Verified factual relationship
Disputed relationship
```

Those categories are not day-one requirements, but the architecture should avoid assuming that every relationship has one universally accepted truth value.

## Editing Relationships

Users should be able to correct relationships they established.

Possible operations include:

- changing the relationship type;
- reversing direction where appropriate;
- removing the relationship; or
- replacing an incorrect relationship.

Changing a relationship should not change the occurrence time or identity of either Moment.

## Removing Relationships

Removing a relationship removes the asserted semantic connection.

It does not delete either Moment.

```text
Delete relationship ≠ Delete Moment
```

Similarly, deleting a Moment may affect relationships referencing it, but the exact cleanup and historical semantics belong in architecture and privacy documentation.

## Relationships and Timeline Navigation

Relationships should provide another way to explore history without replacing the Timeline.

A user viewing a Moment may enter depth and see related Moments:

```text
Current Moment
   │
   ├── Led to Moment B
   ├── Contributed to Moment C
   └── Related to Moment D
```

Following one of those relationships may move the user to another historical position.

That operation is conceptually a **historical jump through a semantic relationship**.

The destination Moment retains its actual occurrence position.

## Relationships and Historical Jumps

Because historical jumps are a day-one Timeline capability, relationship traversal should be compatible with the same navigation model whenever causal relationships become available.

For example:

```text
Moment in 2018
   │
   └── led to
         │
         ▼
Moment in 2022
```

Following the relationship should move the Timeline's temporal position to 2022 while preserving the user's ability to navigate chronologically from there.

The relationship itself does not create a shortcut in chronology. It creates a navigation path between historical positions.

## Relationships and Temporal Zoom

At broader temporal zoom levels, Chronologity may eventually summarize meaningful causal arcs.

For example:

```text
2018 ───────────────► 2022
Started Company       Sold Company
```

However, zoomed-out causal representations must not imply relationships that do not exist in the underlying Moment graph.

Aggregation may simplify presentation but must not manufacture causality.

## Relationship Cycles

Causal relationships should generally not create impossible temporal cycles.

For example:

```text
A caused B
B caused C
C caused A
```

is inconsistent with ordinary forward-moving causality if all occurrence times are known and distinct.

Chronologity should detect contradictions where its temporal information is sufficiently precise.

However, not every semantic relationship is causal, so cycle restrictions should apply according to relationship type rather than to the entire relationship graph.

## Causal Integrity

Chronologity should preserve **causal integrity** in addition to chronological integrity.

Causal integrity means:

1.  causal claims are not inferred merely from temporal ordering;
2.  relationship direction is preserved;
3.  provenance is preserved;
4.  uncertainty is not converted into false certainty;
5.  system suggestions remain distinguishable from confirmed relationships;
6.  relationship changes do not rewrite Moment occurrence information; and
7.  contradictory causal structures are surfaced rather than silently normalized.

## Day-One Scope

Chronologity's day-one product must preserve the distinction between chronology and causality even if sophisticated causal authoring is introduced incrementally.

At minimum, the initial product model and architecture must not:

- infer causal relationships from Timeline order;
- encode chronological adjacency as causal linkage;
- make future causal relationships impossible to represent; or
- conflate contextual grouping with causal relationship.

The full causal relationship authoring experience does not need to be as sophisticated as the day-one Timeline navigation experience.

The important architectural requirement is that Chronologity does not make a modeling decision now that prevents explicit relationships between Moments later.

## Product Invariants

1.  Chronology and causality are separate concepts.
2.  Temporal sequence alone never establishes causality.
3.  Causal relationships must have an explicit basis.
4.  User assertions and system suggestions must remain distinguishable.
5.  AI-generated causal suggestions are hypotheses, not historical facts.
6.  Causal relationships are directional.
7.  Known temporal information should normally be consistent with causal direction.
8.  Temporal uncertainty must not be replaced with invented precision.
9.  Causal relationships may form graphs rather than simple chains.
10. A Moment may have multiple causes and multiple effects.
11. Direct causality must not automatically be treated as transitive causality.
12. Contextual relationships do not imply causal relationships.
13. Relationship provenance should be preserved.
14. Removing a relationship does not delete its Moments.
15. Editing a relationship does not change Moment occurrence time.
16. Different users may hold different causal interpretations of shared history.
17. Relationship traversal may move the user's Timeline position without altering chronology.
18. Aggregated or zoomed-out representations must not manufacture causal relationships.
19. Causal cycle validation should depend on relationship semantics and known temporal information.
20. The architecture must preserve the ability to represent explicit relationships between Moments even if the complete authoring experience is introduced later.

## What Is Settled

**Five relationship kinds ship** (ADR-111). `led_to` and `contributed_to` assert influence; `related_to`, `alternate_perspective`, and `contradicts` deliberately do not. The split is the point: without a non-causal option, every connection somebody wants to draw would have to be phrased as causation.

**A relationship is a claim, stored with who made it.** Nothing is derived from chronological order.

**One end must belong to whoever makes the claim**, and both ends must be Moments they can see. This keeps every reading of history anchored to a history its author lived, while still allowing the cross-author claims shared history depends on.

**A causal claim contradicting known times is refused, and says why.** Only a cause whose interval begins strictly after its effect's interval ends is contradictory. An order nobody can establish — "sometime in 1998" against "June 1998" — is allowed, because refusing it would invent a certainty the history does not have.

**Cycles are handled by the temporal rule**, plus the one check it cannot make: `led to` running both ways between two Moments is refused as a logical contradiction whatever the dates say. Where dates are too coarse to establish order, longer cycles are permitted, because nothing can disprove them.

**A relationship is visible only when both its ends are.** An identifier pointing at an inaccessible Moment is itself a disclosure, so such a relationship is omitted rather than redacted.

**No confidence scores**, as this document requires.

## Open Product Questions

Settled: **relationships appear within Moment depth as a bounded list, in both directions** (ADR-142). Each carries its kind, its origin, who asserted it, and nothing about the Moment at the far end. A relationship whose far end privacy withholds is absent entirely — an identifier pointing at an inaccessible Moment is itself a disclosure — while one Chronologity withheld remains, marked unavailable, so a chain keeps its shape. Whether relationships also appear directly in the Timeline is still open.

The following questions should be resolved deliberately:

- Can another person propose a relationship for a Moment they do not own? Asserting one about two Moments that are both somebody else's is refused; whether a stranger may *propose* one, awaiting acceptance, is a different question and remains open.
- Should the author of the far Moment be able to see, dispute, or remove a claim somebody else made about it?
- What consent model is required for shared causal relationships?
- How should users discover the relationship-authoring capability?
- Should relationships appear directly in the Timeline or only in Moment detail?
- When should Chronologity begin suggesting possible relationships?
- What evidence is sufficient for the system to suggest a relationship?
- Should users be able to disable AI relationship suggestions?
- How should rejected suggestions be treated?
- How should conflicting causal assertions from multiple users be represented?
- When, if ever, should a relationship be considered platform-verified?
- How should relationships involving approximate or uncertain dates be validated?
- Should Chronologity prevent obviously impossible causal relationships or warn and allow them?
- How should relationship traversal interact with back navigation?
- At what temporal zoom levels, if any, should causal relationships become visible?
- Should causal chains or broader life arcs eventually have their own visualization?

These questions should be resolved through product design, user research, and careful consideration of historical integrity rather than by convenience in the persistence model.

## Relationship to `moments.md`

`moments.md` defines the historical records being related.

This document defines semantic relationships between those records.

```text
Moment identity
      +
Moment identity
      +
Relationship assertion
      =
Connected history
```

The relationship must not become part of either Moment's identity.

## Relationship to `timelines.md`

`timelines.md` defines the chronological structure of Moments.

This document defines an additional semantic graph over those Moments.

```text
Timeline
   │
   └── ordered by time

Relationship Graph
   │
   └── connected by meaning
```

Chronologity needs both concepts because temporal order and human meaning are not interchangeable.

## Relationship to `timeline.md`

`timeline.md` defines how users navigate history through time, context, depth, temporal zoom, and historical jumps.

Causal relationships may become navigation paths within that experience.

Following a causal relationship is a semantic historical jump: the user moves from one Moment to another because of an explicit relationship rather than because the Moments are adjacent in time.

The Timeline remains chronologically authoritative after the jump.

## Relationship to Architecture

This document does not prescribe whether relationships are stored in relational tables, graph structures, event streams, projections, or another representation.

It also does not require a dedicated graph database.

The initial architecture should choose the simplest storage and query model that supports the actual relationship requirements.

However, the architecture should preserve several important properties from the beginning:

- Moment identities must be independently addressable.
- Relationships must be capable of referencing two Moments.
- Relationship direction and type must be representable.
- Provenance must be preservable.
- Relationships must not be encoded solely through Timeline adjacency.
- The model should not assume that a Moment has only one parent or one child.
- Future traversal of relationship graphs should not require rewriting the core Moment model.

A graph-shaped domain does not automatically require graph-database infrastructure.

## Guiding Principle

When evaluating a causal feature, ask:

> **Are we representing a relationship that is actually known or intentionally asserted, or are we turning proximity and correlation into a story the system invented?**

Chronologity should help people understand how their experiences connect without pretending to know why something happened when it does not.
