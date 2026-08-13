# Chronologity Moderation

## Purpose

This document defines the product semantics of **moderation** in Chronologity.

Chronologity exists to preserve and navigate history, but historical preservation does not require the product to continue distributing abusive, illegal, dangerous, privacy-violating, or otherwise prohibited content. Moderation must therefore preserve a clear distinction between the existence of historical information and Chronologity's decision to host, expose, recommend, index, or amplify it.

The central question is:

> **How should Chronologity protect people and the integrity of the product while preserving legitimate historical context and avoiding the false assumption that historical value creates an unconditional right to distribution?**

This document defines user-facing moderation behavior and product invariants rather than classifier architecture, moderation-vendor selection, administrative tooling, queue topology, database schemas, legal procedures, or internal operational playbooks.

## Core Principle

Chronologity must preserve the distinction:

```text
Historically relevant
        !=
Permitted to distribute without restriction
```

A piece of content may be historically meaningful and still require:

- a warning;
- reduced visibility;
- age or audience restrictions;
- exclusion from Discovery;
- exclusion from Search;
- removal of particular media;
- removal from public access;
- or complete removal from Chronologity.

Likewise, content does not become historically insignificant merely because Chronologity restricts or removes it.

Moderation governs product distribution and participation.

It does not rewrite history.

## Moderation Scope

Moderation may apply to any user-generated or user-controlled product surface, including:

- Moments;
- images;
- videos;
- captions and descriptions;
- Comments;
- Reactions where their use can be abusive;
- profiles and identity fields;
- usernames and handles;
- real-world Event contributions;
- Location-related contributions;
- causal claims;
- historical-context contributions;
- reports;
- social interactions;
- and future user-generated surfaces.

Moderation may also apply to behavior rather than a single content item.

## Content Moderation and Conduct Moderation

Chronologity should distinguish:

```text
Content moderation
    -> What may be hosted, displayed, indexed, recommended, or shared?

Conduct moderation
    -> How may Users behave toward other people and the platform?
```

A User may engage in prohibited conduct even when no individual Moment is independently prohibited.

Examples may include:

- targeted harassment;
- spam;
- coordinated abuse;
- impersonation;
- repeated unwanted contact;
- evasion of blocks;
- malicious reporting;
- scraping or platform abuse;
- and other harmful patterns.

This distinction matters because removing one item may not address a behavioral problem.

## Historical Integrity and Safety

Chronologity should not use "preserving history" as a reason to avoid safety decisions.

At the same time, moderation should avoid unnecessarily destroying legitimate historical context.

Where appropriate, the product should prefer the least destructive intervention that adequately addresses the risk.

Conceptually:

```text
No intervention
      |
      v
Context / warning
      |
      v
Distribution restriction
      |
      v
Access restriction
      |
      v
Content removal
      |
      v
Account-level enforcement
```

This is not a mandatory escalation ladder. Serious content or conduct may require immediate stronger action.

The principle is proportionality, not procedural delay.

## Moderation Is Not Historical Judgment

A moderation decision answers questions such as:

> May this content be distributed through Chronologity?

> Under what conditions may it be accessed?

> May this User continue participating in this way?

It does not inherently answer:

> Is this historically important?

> Is this historical claim true?

> Is this Person morally good or bad?

> Which interpretation of a disputed Event is correct?

Moderation and historical interpretation must remain distinct.

## Moderation States

Chronologity should support moderation outcomes expressive enough to avoid a simplistic:

```text
allowed / deleted
```

model.

Potential product states include:

```text
Allowed
Allowed with warning
Restricted from amplification
Restricted to an authorized audience
Age/audience restricted
Temporarily unavailable during review
Removed
```

Not every state must ship on day one, but the product model should not assume deletion is the only intervention.

## Allowed Content

Content that complies with Chronologity policy may remain available according to its ordinary privacy and visibility rules.

"Allowed" does not mean:

- recommended;
- searchable;
- historically significant;
- endorsed by Chronologity;
- verified as true; or
- appropriate for every audience.

Those are separate dimensions.

## Warnings

Warnings may be appropriate when historically legitimate content is sensitive but does not require removal.

Examples may include some depictions or discussions of:

- violence;
- injury;
- death;
- war;
- disasters;
- traumatic Events;
- disturbing historical material;
- or other sensitive subjects.

A warning should provide useful context without sensationalizing the content.

Warnings may obscure previews until the User chooses to proceed.

## Distribution Restrictions

Chronologity must distinguish direct accessibility from amplification.

A resource may be:

```text
Allowed to exist
Allowed to be accessed directly
Not eligible for Discovery
Not eligible for broad Search
Not eligible for recommendation
```

This distinction is especially important for content that has legitimate historical value but should not be algorithmically amplified.

Distribution restrictions must not be presented as changes to the content's occurrence time or historical position.

## Search Restrictions

Moderation may remove otherwise accessible content from broad Search.

Explicit Search intent can justify access to some material that would be inappropriate to recommend proactively, but explicit intent never overrides:

- authorization;
- law;
- safety policy;
- blocking;
- age/audience restrictions;
- or applicable moderation decisions.

Search-result absence does not mean the underlying history did not occur.

## Discovery Restrictions

Discovery is an amplification surface and may apply stricter eligibility rules than direct access.

Chronologity should be particularly conservative about proactively recommending:

- graphic content;
- harassment;
- privacy-invasive material;
- dangerous content;
- disputed sensitive material without context;
- or other content whose unsolicited exposure could cause harm.

Historical significance alone does not require Discovery eligibility.

## Feed Restrictions

The Feed is chronological, but chronological ordering does not exempt content from moderation.

If a User is not permitted to encounter a resource, the resource must not appear merely because it would otherwise occupy the correct chronological position.

Moderation filtering occurs before presentation.

The remaining Feed must preserve chronological ordering among eligible Moments.

## Timeline Restrictions

The Timeline may contain historical gaps when content is unavailable because of:

- privacy;
- deletion;
- blocking;
- moderation;
- or authorization.

Chronologity must not fabricate replacement history to conceal such gaps.

Where useful and safe, the interface may indicate that content is unavailable without revealing prohibited information.

## Temporal Zoom

Temporal zoom is required from day one and must be moderation-aware.

A restricted Moment must not reappear through:

- cluster previews;
- representative thumbnails;
- aggregate labels;
- significance summaries;
- counts;
- or other zoom-derived representations.

Temporal abstraction cannot bypass moderation.

## Historical Jumps

Historical jumps are required from day one and must respect moderation.

A causal, Event, Person, Location, or other historical relationship must not become a route around a moderation restriction.

If the destination is unavailable, Chronologity should fail safely while preserving whatever surrounding context the User remains permitted to access.

## Causality

Moderation of a Moment does not automatically erase every causal relationship involving that Moment from the historical model.

However, the product must not expose restricted content or sensitive derived information through causal navigation.

Chronologity may need to preserve an internal relationship while withholding or sanitizing its user-facing representation.

## Historical Significance

Moderation must remain independent of historical significance.

A highly significant Moment can be restricted.

A trivial Moment can be prohibited.

A moderation action must not automatically lower a Moment's historical-significance assessment as though safety policy were a historical ranking mechanism.

Likewise, significance must not exempt a resource from moderation.

## Real-World Events

A real-world Event may contain or connect Moments with different moderation states.

Moderating one Moment should not automatically remove the entire Event unless the Event representation itself violates policy or cannot be presented safely.

Event summaries, representative media, participant lists, counts, and other derived context must exclude information the viewer is not permitted to access.

## Locations

Location-based historical navigation must respect moderation.

A map, Location page, nearby-history result, cluster, or Location count must not expose restricted content or create an alternate discovery path to it.

Location itself may also be sensitive or abusive when used to expose, threaten, stalk, or target people.

Moderation and privacy must work together rather than treating Location as neutral metadata.

## Comments

Comments are independently moderatable.

A prohibited Comment should not require removal of the underlying Moment unless the Moment itself is implicated.

Comment moderation may include:

- removal;
- hiding;
- restrictions;
- warnings where appropriate;
- User-level enforcement;
- or other defined outcomes.

Removing a Comment must not change the occurrence time or historical position of the Moment.

## Reactions

Reactions are lightweight, but their use may still contribute to abuse.

Chronologity may moderate:

- abusive reaction patterns;
- automated Reaction spam;
- coordinated harassment;
- or future reaction types whose meaning itself violates policy.

Reaction counts must update when underlying Reactions are removed or made ineligible.

Historical significance must not depend on preserving moderated engagement counts.

## Profiles and Identity

Profiles and identity fields are moderation surfaces.

Chronologity should address misuse such as:

- impersonation;
- deceptive identity claims;
- harassment;
- hateful or abusive profile content;
- prohibited imagery;
- spam;
- or other policy violations.

Moderation must preserve the distinction between a Chronologity User account and a historical Person represented in the product.

Restricting an account does not mean deleting the historical existence of that Person from legitimate history.

## Impersonation

Chronologity should prohibit deceptive impersonation where a User falsely represents themselves as another person or entity in a manner that creates material confusion or harm.

This is distinct from:

- historical discussion about a Person;
- parody where clearly represented as such and otherwise permitted;
- or a historical Person record that is not a User account.

Identity verification, if ever introduced, should not be assumed to solve every impersonation problem.

## Harassment

Chronologity should prohibit targeted abusive behavior that materially interferes with another person's ability to participate safely.

Historical disagreement, criticism, and documentation of uncomfortable facts are not inherently harassment.

Context matters.

Moderation must avoid turning "this historical claim is upsetting" into an automatic removal rule while still protecting Users from targeted abuse.

## Threats and Incitement

Credible threats, encouragement of violence, and other dangerous conduct require strong safety treatment.

Historical documentation of a threat or violent statement is not necessarily equivalent to endorsing or issuing that threat.

Chronologity must consider context, including whether content is:

- documentary;
- educational;
- condemnatory;
- journalistic;
- historical;
- or actively threatening or encouraging harm.

Historical context may affect the moderation outcome without creating blanket immunity.

## Graphic Historical Material

Chronologity may contain legitimate documentation of war, disasters, violence, death, or other graphic history.

The product should support contextual handling rather than forcing a false choice between unrestricted display and erasure.

Depending on policy and severity, treatment may include:

- warnings;
- blurred or hidden previews;
- explicit opt-in viewing;
- age/audience restrictions;
- exclusion from Discovery;
- Search limitations;
- or removal.

The exact content policy belongs in a dedicated policy or trust-and-safety specification rather than being fully enumerated here.

## Illegal Content

Chronologity must not knowingly preserve public availability of content whose possession, hosting, or distribution is unlawful.

Historical importance does not override legal obligations.

Legal preservation, evidence handling, reporting, or retention requirements may differ from public product availability and belong in legal/security/operations procedures.

## Privacy-Violating Content

Content may be moderated when it exposes sensitive personal information, facilitates stalking, violates another person's privacy, or otherwise conflicts with Chronologity's privacy rules.

The fact that information is historically interesting does not automatically justify publishing it.

Moderation should coordinate with `privacy.md` rather than creating an independent definition of privacy.

## Minors

Content involving minors requires heightened care.

Chronologity should not infer that parental upload, public visibility elsewhere, or historical relevance automatically makes unrestricted distribution appropriate.

Specific protections should be defined before launch based on the product's actual audience, features, jurisdictions, and legal obligations.

## Spam

Spam may include repetitive, irrelevant, deceptive, automated, or manipulative activity that degrades Chronologity's historical and social experience.

Spam controls may operate at:

- content level;
- Comment level;
- Reaction level;
- follow/subscription level;
- reporting level;
- upload level;
- or account level.

Spam detection must not silently reinterpret old or bulk-imported legitimate history as abuse merely because it arrives at high volume.

## Bulk Historical Import Versus Spam

Chronologity explicitly values backfilled history.

Therefore:

```text
High publication volume
        !=
Spam
```

A User importing years of legitimate personal history may create many Moments in a short period.

Abuse systems must distinguish bulk historical contribution from manipulative repetitive behavior.

This is a critical Chronologity-specific moderation constraint.

## Misinformation and Historical Disputes

Chronologity should not assume that every disputed historical claim can or should be resolved by content removal.

The product must preserve:

- provenance;
- uncertainty;
- competing accounts;
- corrections;
- and contextual disagreement

where appropriate.

However, historical framing does not exempt content from other safety policies.

For example, fabricated claims used for targeted harassment, fraud, impersonation, or dangerous conduct may still require enforcement.

Moderation should not become a universal truth ministry.

## Corrections Versus Moderation

Chronologity must distinguish:

```text
Historical correction
        !=
Moderation action
```

A wrong date, mistaken Location, incorrect Event association, or disputed causal relationship may require correction without being a policy violation.

Conversely, removing abusive content is not necessarily a statement that every factual claim within it was false.

The product and internal tooling should preserve this distinction.

## Reporting

Users should be able to report content or conduct that they reasonably believe violates Chronologity rules.

Reportable targets may include:

- Moments;
- individual media items;
- Comments;
- profiles;
- Users;
- identity misuse;
- real-world Event contributions;
- Location misuse;
- and other relevant surfaces.

Reporting should be accessible from the context where the problem occurs.

## Report Reasons

Report reasons should be understandable to ordinary Users rather than mirroring internal policy taxonomies too literally.

Potential high-level reasons may include:

- harassment or abuse;
- threat or dangerous behavior;
- hate or hateful conduct;
- sexual or exploitative content;
- graphic or disturbing content;
- privacy violation;
- impersonation;
- spam or manipulation;
- illegal content;
- intellectual-property concern through the appropriate process;
- false or misleading historical information where Chronologity provides such a reporting path;
- and other.

The final taxonomy requires policy and legal review.

## Historical Accuracy Reports

Chronologity should consider a distinct mechanism for reporting historical inaccuracies.

A User saying:

```text
"This Moment occurred in 2004, not 2005."
```

is raising a historical correction issue.

A User saying:

```text
"This content threatens me."
```

is raising a safety issue.

These should not necessarily enter the same workflow.

Conflating them would encourage safety moderators to become arbiters of historical metadata and historical reviewers to handle urgent abuse.

## Reporting Does Not Determine Guilt

A report is an allegation or request for review.

It is not proof of a violation.

Report volume alone must not automatically determine enforcement.

Otherwise coordinated reporting could become a mechanism for erasing legitimate history or silencing Users.

## Coordinated Reporting Abuse

Chronologity must anticipate malicious mass reporting.

High report volume may affect review priority but should not itself establish that content violates policy.

The system should support detection and enforcement against abusive reporting patterns.

## Reporter Privacy

The identity of a reporter should generally not be disclosed to the reported User merely because a report was submitted.

There may be legal or procedural exceptions, but the default product expectation should protect reporters from retaliation.

## Report Status

Where practical, Users should receive understandable status for reports they submit.

Potential states include:

```text
Submitted
Under review
Resolved
Closed
```

The product need not reveal sensitive internal moderation details, classifier results, reviewer identity, or information about another User that the reporter is not entitled to receive.

## Enforcement

Moderation enforcement may apply to:

- a specific media item;
- a Comment;
- a Moment;
- profile content;
- an account capability;
- distribution eligibility;
- an entire account;
- or another product scope.

Enforcement should be scoped to the problem where practical.

A violation in one Comment should not automatically destroy unrelated historical contributions unless account-level action is warranted.

## Account-Level Enforcement

Serious or repeated violations may require account-level restrictions.

Potential outcomes may include:

- warnings;
- temporary capability restrictions;
- temporary suspension;
- permanent suspension;
- or other measures.

The exact enforcement ladder belongs in policy.

Chronologity should not assume every account sanction requires deleting every historical contribution associated with that account.

## Suspended Users and Historical Contributions

If a User is suspended, Chronologity must explicitly decide what happens to otherwise legitimate historical Moments they previously contributed.

Possible treatment may depend on:

- the reason for suspension;
- content ownership and rights;
- privacy;
- legal obligations;
- whether the content itself violates policy;
- and whether continued attribution creates harm.

The default should not be an accidental cascade deletion merely because account status and content identity were tightly coupled in implementation.

## Removal

Removal should be precise about what is being removed.

Possible meanings include:

```text
Removed from public distribution
Removed from a particular surface
Removed for a particular viewer
Removed from Chronologity product access
Deleted from active product systems
```

These are not necessarily identical.

Product language should avoid telling Users something was "deleted" when it was merely de-amplified or hidden from one surface.

## Historical Tombstones

Chronologity may sometimes need to preserve the existence of a historical position or relationship without displaying removed content.

For example:

```text
Moment A
   |
[unavailable historical content]
   |
Moment C
```

A tombstone may preserve navigation continuity without revealing the prohibited content.

Tombstones must be privacy-safe and moderation-safe.

They should not expose titles, thumbnails, actors, Locations, Event associations, or other information the viewer is not permitted to know.

Whether and where tombstones are appropriate remains a product decision.

## Removal and Derived Data

When content is removed or restricted, moderation must propagate to derived surfaces.

This includes, as applicable:

- Feed projections;
- Timeline projections;
- temporal zoom;
- historical jumps;
- Search indexes;
- Search snippets;
- autocomplete;
- Discovery candidates;
- recommendation caches;
- Event summaries;
- Location aggregates;
- significance-derived presentation;
- notifications;
- Comment counts;
- Reaction counts;
- media thumbnails;
- transcodes;
- previews;
- analytics surfaces exposed to Users;
- and future derived experiences.

Moderating only the authoritative source while leaving derived copies accessible is not sufficient.

## Cached Content

Caches must not become moderation bypasses.

When a moderation action requires content to become unavailable, Chronologity must be able to invalidate or expire applicable cached representations within defined expectations.

External caches and already-delivered data may have practical limits, which should be addressed honestly rather than hidden by product promises.

## Notifications

Moderation actions may generate notifications to affected Users where appropriate.

Notifications should communicate:

- what general action occurred;
- which content or capability is affected where safe;
- whether action is required;
- and whether appeal is available.

They should not unnecessarily reproduce prohibited content.

## Appeals

Users should have a meaningful appeal path for consequential moderation decisions where appropriate.

Appeals are particularly important because Chronologity may contain historically valuable material that automated or context-poor review could misunderstand.

An appeal should permit relevant context to be considered.

## Appeal Independence

An appeal should be more than an identical automated re-run of the original decision when the original decision was consequential.

Chronologity should design for meaningful reconsideration, particularly where:

- historical context matters;
- documentary content resembles prohibited content;
- identity is disputed;
- context changes interpretation;
- or the consequence is severe.

The exact reviewer model is an operational decision.

## Appeal Outcomes

An appeal may:

- uphold the original decision;
- reverse it;
- reduce the restriction;
- increase or otherwise modify the restriction where policy permits;
- or request additional information.

Users should receive a clear outcome at an appropriate level of detail.

## Restoration

If content is restored after successful appeal, relevant derived systems should eventually restore eligibility consistent with current privacy and product rules.

Restoration does not require preserving the exact previous ranking or cache state.

For example, restored content may return to its correct chronological position without being artificially boosted because it was absent.

## Moderation and Immutable History

Chronologity's historical-integrity principles must not be implemented as technical immutability that prevents moderation.

If Moment history or domain events are append-only, the system must still support product-level restriction, removal, redaction, deletion, or erasure where required.

Append-only event history does not mean:

```text
Every historical payload remains forever retrievable by every product reader.
```

Architecture must preserve both auditability and enforceable product safety/privacy semantics.

## Moderation Provenance

Chronologity should preserve internal provenance for moderation actions sufficient to support:

- auditability;
- appeals;
- correction;
- consistency;
- legal obligations;
- and operational review.

Moderation provenance is sensitive internal data.

It should not automatically become public historical metadata.

## Automated Moderation

Automation may assist with:

- prioritization;
- classification;
- obvious spam;
- known prohibited material;
- safety triage;
- duplicate abuse;
- or other high-volume tasks.

Automated moderation should not be treated as infallible.

Historical material is especially context-sensitive.

A classifier may see:

```text
graphic violence
```

while the actual product context is:

```text
documentary evidence of a historically significant Event
```

The content may still require restriction, but context can materially change the appropriate intervention.

## AI Moderation and Historical Context

AI moderation systems must not silently become authorities on historical truth.

They may estimate whether content violates a policy.

They should not establish:

- historical significance;
- Person identity;
- Event membership;
- causal truth;
- or historical accuracy

unless a separate product process explicitly governs that determination.

## Human Review

Human review should be available for moderation categories or consequences where context, ambiguity, severity, or appeal requires it.

Chronologity should not promise that every report receives manual review if that cannot be sustained.

The product should instead define where human judgment is required and build operations accordingly.

## Moderation Consistency

Similar cases should receive reasonably consistent treatment.

Perfect consistency is unrealistic because context differs, but arbitrary treatment undermines trust.

Chronologity should support internal policy versioning, guidance, and auditability so changes in moderation policy can be understood over time.

## Policy Changes

Moderation policy will evolve.

A policy change does not automatically mean all past moderation decisions were wrong.

Chronologity should be able to:

- apply new policy prospectively;
- reevaluate categories of existing content where necessary;
- restore previously restricted content when appropriate;
- or impose new restrictions when required.

Policy evolution must not alter Moment occurrence time.

## Transparency

Chronologity should explain its moderation principles publicly at a useful level.

Users should understand:

- what broad categories of content or conduct are prohibited;
- what kinds of restrictions may occur;
- how reporting works;
- whether appeals exist;
- and how historical context affects moderation.

Transparency does not require publishing abuse-detection thresholds, evasion-sensitive rules, or private enforcement data.

## Moderation Metrics

Moderation quality should not be measured solely by removal volume or speed.

Useful measures may include:

- time to address urgent harmful content;
- appeal reversal rate;
- repeat violation rate;
- false-positive indicators;
- report abuse;
- enforcement consistency;
- privacy leakage;
- restoration correctness;
- derived-data propagation;
- and User safety outcomes.

A high removal count is not inherently evidence of a good moderation system.

## Moderation Product Invariants

1.  Historical relevance does not create an unconditional right to unrestricted distribution.
2.  Moderation governs product distribution and participation; it does not rewrite historical occurrence.
3.  Content moderation and conduct moderation are distinct.
4.  Chronologity should use proportionate interventions while permitting immediate strong action for serious violations.
5.  Moderation is not a universal judgment of historical significance, factual truth, or moral worth.
6.  The product model must support outcomes more expressive than only allowed or deleted.
7.  Allowed content is not automatically recommended, searchable, verified, or endorsed.
8.  Sensitive legitimate history may require warnings or restricted presentation rather than erasure.
9.  Direct accessibility and amplification are distinct moderation dimensions.
10. Discovery may apply stricter eligibility than direct access.
11. Search intent does not override moderation, authorization, privacy, law, or safety.
12. Chronological Feed ordering does not exempt content from moderation.
13. Moderation filtering must occur before Feed presentation while preserving chronology among eligible Moments.
14. Timeline gaps caused by moderation must not be filled with fabricated history.
15. Temporal zoom must not expose restricted content through derived clusters, previews, labels, counts, or representatives.
16. Historical jumps must not bypass moderation.
17. Causal relationships must not become alternate routes to restricted content.
18. Moderation status and historical significance are independent.
19. Historical significance does not exempt content from moderation.
20. Moderating one Moment does not automatically remove an associated real-world Event.
21. Event- and Location-derived representations must respect moderation eligibility.
22. Comments are independently moderatable from their Moments.
23. Removing engagement must not alter Moment chronology or historical significance.
24. Account identity moderation must remain distinct from historical Person representation.
25. Restricting a User account does not automatically erase that Person from legitimate history.
26. Historical disagreement and criticism are not inherently harassment.
27. Historical or documentary context may materially affect how sensitive content is moderated without creating blanket immunity.
28. Illegal distribution obligations override historical-preservation preferences.
29. Privacy-violating content may be moderated even when historically interesting.
30. Content involving minors requires heightened safeguards.
31. High-volume backfilling of legitimate history must not automatically be treated as spam.
32. Chronologity should distinguish disputed history from policy-violating conduct.
33. Historical correction and moderation are separate workflows.
34. Users should have accessible mechanisms to report relevant content or conduct.
35. Report volume alone must not establish a violation.
36. Coordinated malicious reporting must not become a mechanism for erasing legitimate history.
37. Reporter identity should generally remain private from the reported User.
38. Moderation enforcement should be scoped to the violation where practical.
39. Account-level enforcement does not inherently require deletion of all otherwise legitimate historical contributions.
40. Product language must distinguish de-amplification, restriction, removal, and deletion where those states differ.
41. Privacy-safe tombstones may preserve historical/navigation continuity where appropriate without exposing prohibited information.
42. Moderation actions must propagate to applicable derived data and product surfaces.
43. Caches must not become moderation bypasses.
44. Moderation notifications must not unnecessarily reproduce prohibited content.
45. Consequential moderation decisions should have a meaningful appeal path where appropriate.
46. Appeals should allow relevant historical context to be reconsidered.
47. Restored content returns according to normal historical and privacy semantics rather than receiving artificial ranking compensation.
48. Append-only or event-sourced architecture must not prevent enforceable moderation, deletion, redaction, or erasure.
49. Internal moderation provenance should support auditability and appeals without becoming public historical metadata by default.
50. Automated moderation is assistive and fallible.
51. AI moderation must not silently determine historical truth, significance, Person identity, Event membership, or causality.
52. Human review should be available where context, severity, ambiguity, or appeals require it.
53. Moderation should be reasonably consistent while remaining context-sensitive.
54. Policy changes must not rewrite historical occurrence time.
55. Moderation principles should be publicly understandable without exposing abuse-sensitive implementation details.
56. Moderation quality must not be reduced to removal volume.

## Day-One Requirements

Before launch, Chronologity must explicitly define:

- the initial content and conduct rules;
- reportable surfaces;
- reporting entry points;
- report-reason taxonomy;
- urgent safety-report handling;
- distinction between safety reports and historical-accuracy corrections;
- reporter privacy;
- basic report status;
- moderation states used by the initial product;
- content warnings where applicable;
- removal behavior;
- Comment moderation;
- Moment moderation;
- media-level moderation;
- profile and identity moderation;
- spam handling;
- blocking integration;
- enforcement scope;
- account suspension behavior;
- treatment of historical contributions from suspended accounts;
- Feed filtering;
- Timeline filtering;
- temporal-zoom filtering;
- historical-jump filtering;
- Search moderation;
- Discovery moderation;
- notification behavior for consequential actions;
- privacy-change interaction;
- deletion/removal propagation to derived state;
- cache invalidation expectations;
- appeal eligibility;
- appeal submission;
- appeal outcome behavior;
- restoration behavior;
- automated-versus-human review boundaries;
- moderation audit/provenance requirements;
- accessibility of reporting and appeal workflows;
- and escalation for legally or operationally urgent material.

The initial release does not require:

- a sophisticated public moderation-transparency dashboard;
- crowdsourced moderation;
- community voting on removals;
- reputation-weighted moderation;
- engagement-based moderation;
- public moderator identities;
- public moderation case files;
- AI adjudication of historical truth;
- AI determination of historical significance;
- perfect automated historical-context understanding;
- a universal fact-checking system;
- public annotations on every disputed claim;
- or a complex multi-tier enforcement ladder beyond what launch safety actually requires.

Chronologity should launch with a smaller enforceable policy system rather than an elaborate moderation taxonomy that the team cannot operate consistently.

## Open Product Questions

The following questions require deliberate resolution:

- What exact content-policy categories apply at launch?
- What exact conduct-policy categories apply at launch?
- What jurisdictions and age groups must the initial policy account for?
- What minimum age may use Chronologity?
- Does Chronologity permit minors to create accounts?
- What additional protections apply to Moments depicting minors?
- Which categories require immediate removal?
- Which categories may use warnings rather than removal?
- Which categories require age or audience restrictions?
- Does Chronologity need age-gated content at launch?
- If age gating does not ship, must content that would require it be removed instead?
- Which content is allowed by direct link but excluded from Discovery?
- Which content is allowed in Search but excluded from Discovery?
- Which content is excluded from both Search and Discovery while remaining directly accessible?
- Should the Feed ever suppress otherwise accessible content based on sensitivity preferences?
- If so, is that moderation, User preference, or both?
- How should warning-gated Moments appear in chronological Feed positions?
- How should warning-gated Moments appear in temporal zoom?
- Can a sensitive Moment serve as a zoom cluster's representative media? The recommended answer is no unless the viewer has explicitly enabled such previews and policy permits it.
- How should historical jumps communicate that a destination is unavailable?
- Should a moderation tombstone exist in the Timeline?
- When does a tombstone preserve useful historical continuity versus leak the existence of restricted content?
- Should tombstone behavior differ for moderation, privacy, deletion, and blocking?
- What user-facing terminology distinguishes removed, restricted, unavailable, and deleted content?
- Should Chronologity ever display the policy reason for a removed Moment to other viewers?
- How much reason detail should the affected creator receive?
- How much detail could enable abuse evasion?
- Can individual media items be removed while the Moment remains?
- If a removed image was the cover media, how is a replacement selected?
- Does removing one media item require an edit-history indication?
- Can graphic media be warning-gated individually while the rest of a Moment remains visible?
- If a video violates policy but the images do not, can the Moment remain?
- What happens when every media item in a Moment is removed?
- Can the Moment retain non-media historical metadata?
- Must every Moment contain media? This must align with `moments.md` and `media.md`.
- Which Comment violations result in Comment-only removal?
- When should a Comment violation affect the author's account?
- Should Moment owners be able to hide or remove Comments independently of platform moderation?
- If so, how is creator-controlled Comment management distinguished from policy enforcement?
- Can Users report Reactions?
- Which reaction patterns qualify as harassment?
- How should automated Reaction spam be handled?
- How should follow/unfollow spam be handled?
- How should repeated Commenting across many old Moments be evaluated for harassment or spam?
- How do we distinguish legitimate historical research activity from suspicious high-volume traversal or interaction?
- How should bulk historical imports be distinguished from spam?
- Should bulk imports have a special product state visible to abuse systems?
- Should newly created accounts have temporary upload-rate safeguards?
- How do those safeguards avoid becoming semantic media or Moment limits?
- What constitutes impersonation?
- Are parody and fan accounts allowed?
- How must they identify themselves?
- Does Chronologity ever verify identities?
- If so, what does verification assert?
- Can a historical Person page exist independently of a User account?
- How can a real Person dispute their representation in historical content?
- Is that a privacy workflow, moderation workflow, historical-correction workflow, or legal workflow?
- How are deceased people handled differently, if at all?
- How should reports about incorrect Person identity be routed?
- How should reports about incorrect Event membership be routed?
- How should reports about incorrect Location be routed?
- How should reports about incorrect occurrence time be routed?
- Should `Report historical inaccuracy` be a distinct product action from `Report content`? The recommended answer is yes.
- Who may propose historical corrections?
- Does a correction request affect content visibility while under review?
- How do we prevent historical-correction mechanisms from becoming censorship mechanisms?
- What kinds of misinformation, if any, violate Chronologity policy independent of another harm category?
- Should demonstrably fabricated historical media be labeled, restricted, or removed?
- How do we handle satire, reenactment, dramatization, restoration, colorization, and AI-generated historical imagery?
- Must synthetic or materially altered historical media be labeled?
- Does Chronologity permit AI-generated reconstructions at all?
- If permitted, can they ever be attached to a Moment as though they were original evidence? The recommended answer is no.
- Should manipulated media policy be defined in `media.md`, moderation policy, or both?
- How should historical photographs that were themselves manipulated at the time be represented?
- What does authenticity mean for scans, restorations, crops, and color corrections?
- How should documentary footage of extremist, hateful, or violent material be treated?
- How should symbols or slogans be evaluated in historical context?
- How do we distinguish documentation from glorification or recruitment?
- How should graphic war photography be handled?
- How should death and dead bodies be handled?
- How should medical or disaster imagery be handled?
- How should sexual content be handled?
- How should nudity in art, protest, medicine, history, or documentary contexts be handled?
- What categories are prohibited regardless of historical context?
- What legal escalation paths are required?
- What must happen when content appears to involve imminent danger?
- What emergency disclosure policies are needed?
- These require legal and security review rather than product speculation.
- How are intellectual-property complaints handled?
- Are copyright complaints part of ordinary in-app reporting or a separate legal process?
- How are counter-notices or disputes handled where legally applicable?
- How should privacy complaints be routed?
- How should doxxing be defined given Chronologity's Location features?
- What Location precision is categorically unsafe to publish in particular contexts?
- How should public historical addresses differ from current private residential addresses?
- How should stalking-related patterns affect Location visibility?
- Can a Location itself be reported?
- Can a real-world Event be reported?
- Can an Event title or description be moderated independently of associated Moments?
- How should Event-level abuse affect associated legitimate Moments?
- Can a causal relationship be reported?
- Can a historical-significance assessment be challenged?
- Are those moderation issues or historical-context correction issues?
- What content-warning categories exist?
- Can Users configure sensitivity preferences?
- Do those preferences apply to Feed, Search, Discovery, Timeline, and direct links?
- Can a User permanently opt into seeing particular categories without repeated warnings?
- Which warnings must always appear?
- How should warnings work with accessibility technologies?
- How should autoplay behave for warning-gated video? The recommended answer is that gated media must not autoplay before the User chooses to reveal it.
- How should sound-on autoplay interact with sensitive media warnings?
- What appears in push notifications when the target content later becomes moderated?
- Should existing in-app notifications be removed or sanitized?
- How quickly must moderation changes propagate to Search?
- How quickly to Discovery?
- How quickly to Feed projections?
- How quickly to Timeline/zoom projections?
- How quickly to media CDN caches?
- What user-facing guarantee can realistically be made?
- How should moderation state interact with EventStoreDB's append-only history?
- Which event payloads may contain content that later requires erasure?
- Should sensitive content be stored outside immutable event payloads with references from events?
- This is primarily an architecture decision, but the product requires enforceable removal and erasure.
- What moderation data must be retained after content removal?
- For how long?
- Which data may be retained for abuse prevention, appeals, legal obligations, or security?
- How does retention align with `privacy.md`?
- What report evidence may be retained after the reported content is deleted?
- How are moderator notes protected?
- Who internally may access moderation evidence?
- Should Chronologity support temporary holds during review?
- Which content remains visible during review?
- Should severe reports trigger temporary restriction before final review?
- How do we limit malicious reports from causing automatic censorship?
- What risk thresholds justify precautionary restriction?
- How are urgent reports prioritized?
- Does report count influence priority?
- How do we prevent coordinated reports from gaming priority?
- What signals can assist triage without determining guilt?
- Which decisions may be fully automated?
- Which require human review?
- Which require human review before enforcement?
- Which may be automated but require human appeal?
- Which categories should never be adjudicated solely by AI?
- What confidence threshold, if any, may trigger automated restrictions?
- How are false positives measured?
- Should historical/documentary content receive specialized review?
- Do moderators need contextual Timeline/Event views?
- Should moderation tooling show surrounding historical context?
- Could showing excessive private context to moderators violate privacy principles?
- What is the minimum internal access needed for review?
- How are moderator accesses audited?
- Should moderation reviewers see exact Location when the report does not require it?
- Should reviewers see the reporter's identity?
- How are conflicts of interest handled?
- How are appeals assigned?
- Does a different reviewer need to handle an appeal?
- Which enforcement actions are appealable?
- Are warnings appealable?
- Are Discovery/Search restrictions appealable?
- Are temporary suspensions appealable?
- Are permanent suspensions appealable?
- How long may Users appeal?
- Can new evidence reopen a closed decision?
- How many appeals are permitted?
- How should repeated abusive appeals be handled?
- What status information does the reporter receive after resolution?
- Should a reporter be told that another User was suspended? The recommended default is to communicate that action was taken where appropriate without disclosing unnecessary account details.
- What status information does the reported User receive?
- Should affected Users see the exact policy version applied?
- Should moderation actions have stable case identifiers?
- Should Users be able to export their moderation history?
- How does account deletion interact with active appeals?
- How does account deletion interact with reports against the User?
- Can a suspended User access an appeal interface?
- Can a suspended User export their own historical data?
- What happens to legitimate Moments after permanent suspension?
- Should attribution remain?
- Should profile links become unavailable?
- Should Moments remain only where independently historically valuable?
- Who decides that?
- Would such a rule accidentally make moderation depend on historical significance?
- A safer default may be to separate content eligibility from account eligibility and evaluate the content itself.
- How should blocking interact with moderation?
- Does blocking automatically hide prior notifications?
- Can a blocked User still report public content?
- Can blocking be used to prevent legitimate reports? It should not.
- Can a blocked User still encounter the other User within shared public Event history?
- The social-graph and privacy specifications should govern this.
- Should moderation actions ever automatically create blocks?
- Should Users be offered a block after reporting harassment?
- Should report submission automatically mute the reported content while review is pending?
- Should Users be able to hide content for themselves without reporting it?
- Personal hide/mute behavior should be distinguished from platform moderation.
- Should Users be able to hide a Moment, Event, Location, or Person from their own experience?
- Does personal hiding affect historical jumps?
- Does it affect temporal zoom?
- Should personal hiding have its own product document or live in privacy/preferences?
- What anti-spam protections apply to reporting itself?
- What anti-retaliation protections apply after reports?
- Should a reported User know which content was reported before a decision?
- Could that expose reporter identity through context?
- What transparency reporting should Chronologity publish?
- Should aggregate enforcement statistics be public?
- Should appeal reversal rates be public?
- How do we preserve User privacy in transparency reporting?
- How are law-enforcement requests handled?
- How are government removal requests handled?
- How does Chronologity distinguish legal compliance from platform-policy moderation in its records?
- Should Users be told when content is unavailable due to legal demand where permitted?
- How should geographically restricted content behave in global Timelines?
- Can the same Moment be accessible in one jurisdiction and unavailable in another?
- How does that affect temporal zoom and historical jumps?
- How should Chronologity handle policy differences across countries?
- Should one global baseline policy apply with additional legal restrictions by jurisdiction?
- What moderation staffing or operational capability is required for launch?
- What response-time targets are realistic?
- Which categories require 24/7 escalation?
- What happens if Chronologity cannot safely operate a product feature at launch because moderation tooling is incomplete?
- The feature should not ship merely because its core implementation is complete.
- What metrics should define moderation health?
- How do we ensure metrics do not reward excessive removal?
- How should appeal reversals feed policy improvement?
- How should false-negative incidents feed policy improvement?
- How are policy versions recorded?
- Should previously allowed content be automatically rescanned after major policy changes?
- How do we avoid unnecessary retrospective enforcement while still addressing newly recognized harms?
- When restored content becomes searchable again, should it regain its original historical Search context?
- When restored content returns to the Feed, should it appear at its occurrence position rather than as newly published? The recommended answer is yes unless publication itself was genuinely new.
- How should restored content affect notifications?
- Should followers receive a "restored" notification? The recommended default is no.
- How should accessibility apply to reporting, warnings, appeals, and moderation notices?
- Can every moderation action be understood without relying on color or icons?
- How should graphic-content warnings be announced to screen readers without unnecessarily exposing graphic descriptions?
- How should moderation work for future media types or product surfaces not yet defined?

These questions should be resolved before moderation infrastructure hardens assumptions about content states, enforcement scope, appeals, historical corrections, privacy, or derived-data propagation.

## Architecture Constraints

This document does not prescribe moderation vendors, classifier models, administrative applications, queue implementations, Kafka topics, databases, case-management software, or internal staffing.

It does impose architectural constraints.

Moderation must be representable independently from historical occurrence semantics.

The system must support the possibility that:

```text
Authoritative historical relationship exists
        |
        v
Product access to one resource is restricted
        |
        v
Authorized surrounding history remains navigable
```

Moderation state must be enforceable across authoritative and derived read paths.

Conceptually:

```text
Authoritative content / activity
          |
          +--> moderation state
          |
          v
Derived projections and indexes
          |
          +-- Feed
          +-- Timeline
          +-- temporal zoom
          +-- historical jumps
          +-- Search
          +-- Discovery
          +-- Events
          +-- Locations
          +-- notifications
          +-- media delivery
          |
          v
Viewer-authorized presentation
```

A projection, cache, search index, CDN asset, or precomputed aggregate must not become an alternate route around moderation.

The architecture must distinguish:

```text
content state
account state
report state
appeal state
distribution eligibility
privacy/authorization state
```

rather than collapsing them into one generic status flag.

Moderation actions must be idempotent and traceable enough to support retries, appeals, reversals, and auditability.

Restoration must be possible without rewriting historical occurrence timestamps or treating restored content as newly occurring history.

Event sourcing and append-only logs must not make prohibited content permanently retrievable through ordinary product paths.

Where immutable records contain references to content that must later be erased, architecture must permit the sensitive payload itself to become inaccessible while preserving only legally and product-appropriate structural history.

Moderation-derived denormalization must support:

- removal;
- sanitization;
- restriction;
- restoration;
- privacy changes;
- User deletion;
- and policy evolution.

The system must support separate workflows for:

```text
Safety / policy report
        !=
Historical correction request
```

even if some operational tooling is shared.

Bulk historical imports must be distinguishable from abuse-oriented high-volume behavior; rate and volume alone cannot define spam.

Automated moderation outputs must preserve:

- model/rule provenance where operationally required;
- policy version;
- confidence where applicable;
- and the distinction between automated detection and final moderation outcome.

Internal moderation access must be authorization-controlled and auditable.

Finally, moderation must be designed as a cross-cutting product capability from day one. It cannot be bolted onto the API after Feed, Timeline, Search, Discovery, media, and historical navigation have each invented independent eligibility rules.

## Guiding Principle

When deciding how Chronologity should moderate content or conduct, ask:

> **What is the least destructive intervention that adequately protects people, the law, and the integrity of the product without pretending that restricting distribution changes what happened in history?**

Chronologity should preserve history responsibly.

Preservation is not the same thing as unconditional amplification.
