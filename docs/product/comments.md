# Chronologity Comments

## Purpose

This document defines the product semantics, lifecycle, ordering, visibility, authorship, editing, deletion, privacy, and moderation behavior of **Comments** in Chronologity.

A Comment is discussion attached to historical content. It is not itself part of the represented historical occurrence merely because it appears beneath a Moment.

The central question is:

> **How should Users discuss a Moment without allowing present-day conversation to alter the historical meaning, chronology, or integrity of that Moment?**

This document defines product behavior rather than database schemas, API routes, event contracts, projection structures, moderation infrastructure, or storage technology.

## Definition

A **Comment** is a User-authored conversational contribution associated with a Moment.

Conceptually:

```text
Moment
  │
  └── discussion
        ├── Comment
        ├── Comment
        └── Comment
```

A Comment belongs to the discussion around a Moment.

It does not become part of the Moment's occurrence merely because it discusses that Moment.

## Comment Time Versus Moment Time

Chronologity must preserve a strict distinction between:

- when the Moment occurred; and
- when a Comment was authored.

For example:

```text
Moment occurred:  July 4, 2004
Comment authored: August 10, 2026
```

The Comment is a 2026 product interaction concerning a 2004 historical experience.

Therefore:

```text
Comment creation time ≠ Moment occurrence time
```

A Comment must never change the Moment's position in a Timeline.

## Comments Are Not Moments

Creating a Comment does not create a new Moment.

```text
Comment
    ≠
Moment
```

A Comment may contain meaningful discussion, interpretation, recollection, correction, or context, but Chronologity should not silently promote conversational activity into the historical record.

If a User wants to preserve a distinct experience as history, they should create a Moment through the appropriate Moment-creation workflow.

## Comments Are Mutable Conversation

Chronologity's historical content model emphasizes integrity and stable occurrence semantics. Comments serve a different purpose.

Comments should be editable and removable by their authors, subject to moderation, legal, safety, and retention requirements.

This distinction is intentional:

```text
Moment
    → historical record

Comment
    → conversation about the record
```

Chronologity should not impose Moment-level immutability semantics on Comments merely for architectural consistency.

## Comment Authorship

Every User-authored Comment must have a stable author relationship to the User who created it.

Authorship must attach to stable User identity rather than mutable display names or handles.

```text
Comment
  └── authored by User
```

Changing a User's handle, display name, profile image, or other mutable identity information must not change who authored the Comment.

## Comment Identity

Each Comment should have a stable identity independent of its text.

Editing a Comment should modify the existing Comment rather than creating a new publicly visible Comment identity.

This allows Chronologity to distinguish:

```text
Same Comment, edited
```

from:

```text
Different Comment
```

The implementation may retain revision history internally where necessary, but the product should not require each edit to appear as a separate Comment.

## Comment Scope

Comments should initially be attached to **Moments**.

Chronologity should resist making every domain concept independently commentable without a demonstrated product need.

In particular, the initial model should not assume first-class comments directly on:

- Timelines;
- locations;
- real-world Events;
- causal relationships;
- User Profiles; or
- arbitrary temporal aggregations.

Those surfaces may eventually expose discussion through associated Moments or gain their own explicit discussion semantics if justified.

## Replies

Comments should support **replies** so Users can respond to specific contributions rather than forcing every discussion into a flat stream.

Conceptually:

```text
Moment
  └── Comment A
        ├── Reply B
        └── Reply C
```

A reply is still a Comment.

It has an additional relationship to another Comment.

```text
Reply = Comment + parent Comment relationship
```

## Reply Depth

Chronologity should support **one level of visible reply nesting** for the initial product.

Conceptually:

```text
Top-level Comment
  ├── Reply
  ├── Reply
  └── Reply
```

If a User replies to an existing reply, the new Comment should remain within the same reply thread rather than creating progressively deeper visual nesting.

This prevents discussions from becoming difficult to navigate on mobile devices while preserving conversational context.

The underlying product relationship may retain which Comment was directly replied to where useful, but the presentation should not become an arbitrarily deep tree.

## Comment Ordering

Top-level Comments should be presented in **chronological order**, oldest first.

Replies within a thread should also be presented chronologically, oldest first.

```text
Oldest
  ↓
Newer
  ↓
Newest
```

This ordering aligns with Chronologity's broader preference for explicit temporal semantics and avoids opaque engagement ranking.

Chronologity should not reorder Comments based on predicted engagement, popularity, follower relationships, or personalized relevance.

## Why Oldest First

Comments are conversations.

Showing the beginning of the discussion first preserves conversational causality and makes later replies easier to understand.

Newest-first ordering would privilege recency at the expense of conversational context, while engagement ranking would make discussion order opaque.

Chronologity should therefore prefer:

```text
Conversation chronology
```

over:

```text
Engagement optimization
```

## Comment Pagination

Large discussions must be pageable or incrementally loadable.

Pagination must preserve deterministic chronological ordering.

A User loading additional Comments should not see existing Comments unpredictably change position because engagement metrics changed.

New Comments may appear after the currently loaded range according to the product's refresh or live-update behavior.

The exact cursor contract belongs in API and architecture documentation.

## Comment Counts

A Moment may display the number of Comments associated with it.

The product must define whether that count includes replies. The recommended semantic is:

```text
Comment count = top-level Comments + replies
```

because Users generally understand the count as total discussion activity.

Counts are derived information and may be eventually consistent at scale.

A temporary count discrepancy must not affect the existence, authorship, or ordering of actual Comments.

## Editing Comments

A Comment author should be able to edit their Comment.

Editing should preserve:

- Comment identity;
- authorship;
- original creation time; and
- placement within the conversation.

The product should also preserve an `edited` indication when the visible text has been changed after publication.

Conceptually:

```text
Created 10:00
Edited  10:15

Displayed:
Comment text · Edited
```

The exact visual treatment is a UI decision.

## Edit Time

Editing a Comment must not change its original chronological position.

```text
Comment created at 10:00
Comment edited at 14:00

Ordering timestamp remains 10:00
```

Otherwise, editing would become a mechanism for moving Comments through the discussion.

Chronologity may retain the latest edit time separately.

## Edit History

Chronologity does not need to expose a public Comment revision history in the initial product.

Internal revision information may be retained where required for moderation, abuse investigation, or legal compliance.

Internal retention must remain subject to privacy and retention requirements.

If public edit history is introduced later, it should be a deliberate product capability.

## Deleting Comments

A Comment author should be able to delete their Comment.

Deletion should remove the Comment's ordinary visible content from the conversation, subject to moderation, legal, security, and retention requirements.

Deletion must not alter the underlying Moment.

```text
Delete Comment ≠ Delete Moment
```

## Deleting a Top-Level Comment With Replies

Deleting a top-level Comment that has replies creates a structural problem.

Chronologity should preserve the reply thread without continuing to display the deleted author's original text.

The recommended behavior is a visible tombstone such as:

```text
[Comment deleted]
  ├── Reply
  └── Reply
```

This preserves conversational coherence while honoring removal of the deleted Comment's visible content.

The tombstone should expose no more identity information than necessary.

## Deleting a Reply

A deleted reply with no dependent conversational context may disappear from ordinary presentation.

If preserving its position is necessary to make subsequent replies understandable, Chronologity may display an equivalent deletion tombstone.

The guiding rule is:

```text
Preserve conversation structure when necessary
without preserving deleted content unnecessarily.
```

## Author Identity After Comment Deletion

When a User deletes an individual Comment, Chronologity should not continue displaying the deleted text merely because replies exist.

Whether the author's public identity remains visible on a structural tombstone should be minimized and resolved consistently with privacy requirements.

The initial product should prefer a generic deleted-comment representation rather than preserving unnecessary author identity.

## Account Deletion

Account deletion and Comment deletion are distinct operations.

Chronologity must define how authored Comments behave when an account is deleted.

The product should not assume that all Comments can simply remain attributed to an active Profile after the account no longer exists.

Potential handling may include deletion, anonymization, or preservation of limited conversational structure according to privacy, legal, and historical-context requirements.

The exact account-deletion policy remains an open product decision.

## Moment Deletion or Unavailability

If the underlying Moment is no longer available to a viewer, its Comments must not remain independently accessible through a path that bypasses the Moment's privacy or availability state.

Conceptually:

```text
Cannot access Moment
      ↓
Cannot use Comments to reconstruct restricted Moment context
```

Comments are subordinate to the access boundary of the Moment they discuss.

## Comment Visibility

A Comment's effective visibility is constrained by the visibility of its Moment.

A Comment on a restricted Moment must not become publicly visible merely because the Comment itself contains no sensitive text.

At minimum:

```text
Viewer can access Comment
        only if
Viewer can access underlying Moment
```

Additional Comment-specific interaction rules may further restrict participation.

## Visibility Changes

If a Moment's visibility changes, Comment access must follow the new effective authorization state.

For example, if a formerly public Moment becomes private, its existing Comments must not remain exposed through search, notifications, cached views, direct links, or other derived surfaces to Users who no longer have access.

Privacy revocation applies to discussion as well as source content.

## What Is Settled

**Three policies, chosen per Moment by its author** (ADR-114): `anyone` who can see it, `followers` of the author, or `disabled`. The author may always comment on their own Moment under every one.

**`followers` grants no access.** A stranger who could read the Moment still can; what changes is whether they may speak. That is why it does not contradict the rule that a Follow never bypasses a visibility rule — nothing here is a visibility rule.

**Closing a discussion leaves it readable.** New comments are refused; what was already said stays. This deliberately differs from disabling reactions, which hides the counts: hiding a tally erases an aggregate nobody authored, while hiding a conversation erases speech and leaves replies answering questions that are no longer there.

**Blocking hides each party's comments from the other and from nobody else.** Future interaction is refused and prior conversation stands for everybody else, so nothing a third person wrote becomes incoherent. The reactions the two left on each other's comments are severed, because a count is not something anybody else took part in.

**Five hundred characters**, measured after normalisation. Whitespace alone is not a comment.

**A mention stores a person, never a handle**, so it survives its target renaming. Mentioning somebody a Block separates you from is refused, and a comment may name at most ten people.

**A retried submission is not a duplicate.** The caller may name the submission: the same identifier twice yields one comment, while the same text twice without one yields two, because repeating yourself deliberately is allowed.

**Reactions on comments ship**, using the same four kinds a Moment takes. A Moment's own reaction setting does not reach the discussion underneath it.

## Who May Comment

Being able to view a Moment does not automatically imply the right to comment.

Chronologity should support Moment-level or creator-level interaction rules determining who may participate in discussion.

Potential policies could include:

- comments disabled;
- followers may comment;
- approved audience may comment; or
- anyone who can view may comment.

The exact day-one options remain to be finalized.

The product model must preserve:

```text
Can view ≠ Can comment
```

## Disabling Comments

A Moment creator should be able to disable new Comments on their Moment.

Disabling Comments should not automatically delete existing discussion.

Conceptually:

```text
Comments enabled
      ↓
Existing discussion
      ↓
Creator disables new Comments
      ↓
Existing discussion remains readable
No new Comments accepted
```

A separate action would be required if product policy permits hiding or removing existing discussion.

## Re-Enabling Comments

If a creator later re-enables Comments, the existing discussion should continue from its prior state rather than being recreated as a new thread.

Moderation or enforcement restrictions may override creator-level settings.

## Comment Permissions and Blocking

Blocking must affect Comment interactions consistently.

A blocked relationship must not provide a route for direct conversational interaction that defeats the purpose of the block.

The exact presentation of pre-existing Comments between blocked Users requires careful design because public or shared discussions may contain contributions from both parties.

Chronologity should distinguish:

```text
Prevent future interaction
```

from:

```text
Rewrite all prior conversation
```

Blocking should not automatically falsify or rewrite previous discussion, but the interface may suppress or hide content according to safety requirements.

## Comment Permissions and Following

Following a User does not automatically grant permission to comment on all of their Moments.

Likewise, a User need not necessarily follow a creator in order to comment on a Moment whose interaction policy permits it.

```text
Follow relationship ≠ Comment permission
```

Comment authorization must be evaluated in the context of the Moment.

## Comment Permissions and Suspension

A suspended or interaction-restricted User may be prevented from creating or editing Comments according to moderation policy.

Existing Comments may remain, be hidden, or be removed depending on the enforcement action.

Suspension should not require rewriting Comment authorship.

## Mentions

Chronologity may support mentioning another User in a Comment using their handle or another explicit identity mechanism.

A mention is not a tag on the underlying Moment.

```text
Mention in Comment
      ≠
Person tagged in Moment
```

A mention says that the Comment refers to a User in conversation.

It must not assert that the mentioned User participated in the historical experience.

## Mention Identity

Mentions should resolve to stable User identity rather than permanently encoding a mutable handle as the authoritative relationship.

If the mentioned User changes their handle, the underlying mention should still refer to the same User.

Presentation may display the current appropriate public identity.

## Mention Privacy and Abuse

Mentions can create unwanted attention and must respect blocking, moderation, and notification rules.

Chronologity should not permit mentions to become a mechanism for bypassing social or safety boundaries.

The product may eventually require limits on repeated or mass mentions.

## Links

Comments may eventually support links.

If enabled, link handling should account for spam, malicious destinations, unsafe previews, and moderation.

Rich embedding of arbitrary external content is not required for the initial Comment model.

## Media in Comments

The initial Comment model should be **text-first**.

Images, videos, GIFs, audio, stickers, and other media attachments should not be required for day one.

Chronologity already has a rich historical media model through Moments. Adding media to Comments would substantially expand upload, moderation, storage, accessibility, privacy, and abuse complexity without being necessary for meaningful discussion.

If a User wants to preserve media as part of history, a Moment is the appropriate first-class construct.

## Rich Text

The initial Comment model should avoid a complex rich-text editor.

Plain text with basic platform-supported text behavior is sufficient.

If formatting is added later, it should remain constrained enough to preserve readability, accessibility, security, and consistent rendering across mobile and future clients.

## Comment Length

Comments should have a maximum length to protect usability, performance, and abuse controls.

The exact limit remains an implementation-informed product decision and should not be chosen arbitrarily in this document.

The limit should be large enough for meaningful historical discussion but small enough that Comments do not become an alternative long-form publishing system.

## Empty Comments

A Comment must contain meaningful user-visible content after normalization.

Whitespace-only Comments should not be accepted.

If mentions or future structured elements exist, the product must define whether they count as sufficient content.

## Duplicate Comments

Chronologity should tolerate legitimate repeated text while preventing accidental duplicate submission caused by retries, network failures, or repeated taps.

This is primarily an idempotency concern rather than a rule that identical Comment text is prohibited.

```text
Same text twice intentionally
        may be valid

Same submission delivered twice accidentally
        should not create duplicates
```

## Comments and Historical Corrections

Users may use Comments to dispute or clarify information in a Moment.

A Comment does not automatically modify the Moment's authoritative historical fields.

For example:

```text
Comment:
"This was actually in 2012, not 2011."
```

does not itself change the Moment's occurrence time.

If Chronologity supports formal historical corrections, they require an explicit correction workflow.

```text
Discussion ≠ Historical mutation
```

## Comments and Causality

A User may discuss causal relationships in Comments.

Such discussion does not create a formal causal edge between Moments.

```text
"This led to..."
written in a Comment

≠

Recorded causal relationship
```

Formal causal relationships must follow the semantics defined for causality.

## Comments and Real-World Events

Discussion beneath a Moment associated with a real-world Event remains discussion of that Moment.

It should not automatically become Event-wide discussion visible beneath every Moment associated with the Event.

If Event-level discussion is introduced later, it should be explicitly modeled.

## Comments and Timeline

Comments must not affect Timeline ordering.

A Moment receiving a new Comment today must not move to today in a historical Timeline if the Moment occurred years ago.

```text
New Comment
    ≠
New historical occurrence
```

This is a foundational invariant.

## Comments and Feed

Comment activity should not cause a Moment to be reordered by engagement within a chronological Feed.

If the Feed eventually surfaces explicit recent social activity, that must be modeled separately from the Moment's historical occurrence ordering.

Chronologity should not silently implement:

```text
Recently commented
      ↓
Bump old Moment to top
```

when the Feed contract is chronological by Moment semantics.

## Comments and Temporal Zoom

Comment activity must not alter how a Moment is positioned within temporal zoom.

Aggregating history by day, month, year, decade, or another temporal scale should use Moment occurrence semantics, not Comment timestamps.

Comment counts may be displayed as contextual metadata if useful, but they must not become temporal placement signals.

## Comments and Historical Jumps

A historical jump to a Moment may expose its discussion only if the viewer is authorized to access both the Moment and applicable Comments.

A Comment must not provide a backdoor for navigating to otherwise inaccessible historical content.

## Comments and Search

Chronologity may eventually index Comments for search, but Comment search is not required merely because Moment search exists.

If Comments are searchable, results must respect current Moment visibility, Comment availability, blocking, moderation, and deletion state.

Search-result ranking must not change Comment order within the discussion itself.

## Comments and Discovery

Comments may provide signals for discovery in the future, but Chronologity should be cautious about allowing engagement volume to become a proxy for historical importance.

A highly discussed Moment is not necessarily more historically significant than a quiet Moment.

```text
Engagement ≠ Historical importance
```

## Comment Notifications

Comment activity may generate notifications.

Potential notification causes include:

- another User comments on a User's Moment;
- another User replies to a User's Comment; and
- another User mentions a User in a Comment.

Notification behavior must respect blocking, privacy, moderation, and user preferences.

A notification should describe recent product activity without implying that the underlying historical event occurred recently.

## Notification Privacy

Notification previews must not reveal Comment or Moment information to a recipient who is no longer authorized to access the underlying content.

If access changes after a notification is generated, opening the notification must enforce current authorization.

Push-notification previews may require additional privacy controls.

## Reactions to Comments

Chronologity may support reactions to Comments, but this is not required merely because Moments support reactions.

If Comment reactions are supported, they should follow explicit reaction semantics and must not determine Comment ordering.

The initial product should prioritize clear discussion over engagement mechanics.

## Moderation

Comments are subject to moderation.

Chronologity must be able to:

- report a Comment;
- restrict or remove prohibited Comment content;
- prevent abusive Comment creation;
- apply User-level enforcement where appropriate; and
- preserve necessary internal evidence according to policy and law.

Historical integrity does not require continued distribution of abusive conversational content.

## Reporting

A User who can view a Comment should be able to report it through the applicable moderation workflow.

Reporting a Comment does not automatically remove it for everyone.

The product may hide or suppress reported content for the reporter where appropriate while moderation is pending.

The exact reporting and enforcement model belongs to moderation policy.

## Moderator Removal

A Comment removed by moderation should no longer display its prohibited content to ordinary Users.

Where replies depend on the removed Comment's structural position, Chronologity may preserve a generic unavailable-content tombstone.

The product should distinguish author deletion from moderation removal internally even if their ordinary visual treatment is similar.

## Comment Provenance

Chronologity should preserve sufficient provenance to establish:

- the stable Comment identity;
- the author;
- the Moment;
- the parent Comment, if any;
- creation time;
- edit state;
- deletion or moderation state where applicable; and
- relevant actor provenance for moderation actions.

Not all provenance must be publicly exposed.

## Comment Activity Is Not Historical Provenance of the Moment

A Comment may provide useful context about how people interpreted a Moment later.

That does not make the Comment part of the Moment's original historical provenance.

Chronologity should preserve the distinction between:

```text
Evidence/context attached to history
```

and:

```text
The historical occurrence itself
```

If future product capabilities elevate particular annotations, corrections, sources, or testimony into stronger historical constructs, those should receive explicit semantics rather than inheriting Comment behavior.

## Scalability

A Moment may receive no Comments, a few Comments, thousands of Comments, or potentially far more.

The product model must not assume the entire discussion can be loaded at once.

Likewise, creating a Comment should not require synchronous work proportional to every participant in the discussion.

Notification fan-out, counts, search indexing, moderation analysis, and other derived work may be asynchronous so long as the visible Comment semantics remain correct.

## Consistency

After successful Comment creation, the author should receive clear confirmation that the Comment exists.

Derived data such as counts, notifications, search indexes, or analytics may update asynchronously.

Chronologity should distinguish:

```text
Authoritative Comment existence
```

from:

```text
Eventually consistent derived representations
```

A delayed count must not cause the Comment itself to disappear or duplicate.

## Comment Product Invariants

1.  A Comment is User-authored discussion associated with a Moment.
2.  A Comment is not a Moment.
3.  Comment creation time is distinct from Moment occurrence time.
4.  Creating, editing, replying to, reacting to, or deleting a Comment must not change the Moment's historical position.
5.  Comments attach to stable User identities rather than mutable handles or display names.
6.  Comments have stable identities independent of their current text.
7.  Comments should initially be attached directly to Moments rather than every Chronologity domain concept.
8.  Replies are Comments with parent-Comment context.
9.  The initial product should use one level of visible reply nesting.
10. Top-level Comments should be ordered chronologically, oldest first.
11. Replies should be ordered chronologically, oldest first.
12. Comment ordering must not use engagement ranking or personalized relevance.
13. Editing a Comment must preserve its original creation time and chronological position.
14. Edited Comments should visibly indicate that they were edited.
15. Public edit history is not required for day one.
16. Comment authors may delete their Comments subject to applicable policy and law.
17. Deleting a Comment must not delete or modify the underlying Moment.
18. Deleted Comments may retain a minimal tombstone when required to preserve reply context.
19. A Comment cannot be accessible to a viewer who is not authorized to access its underlying Moment.
20. Moment visibility changes must propagate to Comment access and derived surfaces.
21. Ability to view a Moment does not inherently imply ability to comment.
22. Moment creators should be able to disable new Comments without automatically deleting existing discussion.
23. Following does not inherently grant Comment permission.
24. Blocking must prevent Comment interactions from bypassing the social safety boundary.
25. Mentions in Comments do not tag Users into the underlying Moment.
26. Mentions must resolve to stable User identity rather than mutable handle text alone.
27. The initial Comment model should be text-first and should not require media attachments.
28. Comments must not directly mutate Moment historical fields.
29. Statements about causality in Comments do not create formal causal relationships.
30. Comments on a Moment associated with a real-world Event do not automatically become Event-wide discussion.
31. Comment activity must not reorder the Timeline or chronological Feed.
32. Temporal zoom must use Moment occurrence semantics rather than Comment activity time.
33. Historical jumps must not use Comments to bypass authorization.
34. Search or discovery of Comments, if supported, must respect current privacy, deletion, blocking, and moderation state.
35. Engagement with Comments must not define historical importance.
36. Comment notifications describe product activity, not the occurrence time of the underlying Moment.
37. Comments are subject to reporting and moderation.
38. Historical integrity does not require continued distribution of abusive or prohibited Comments.
39. The product must support discussions too large to load in a single operation.
40. Derived Comment counts, notifications, search indexes, and analytics may be eventually consistent without weakening authoritative Comment semantics.

## Day-One Comment Requirements

Before launch, Chronologity must have explicit product behavior for:

- creating a Comment on a Moment;
- replying to a Comment;
- one-level visible reply threading;
- chronological Comment ordering;
- chronological reply ordering;
- pagination or incremental loading;
- Comment counts;
- editing a Comment;
- displaying edited state;
- deleting a Comment;
- deleting a Comment that has replies;
- disabling and re-enabling new Comments on a Moment;
- determining who may comment;
- Comment visibility when Moment visibility changes;
- Comment behavior under blocking;
- Comment behavior for suspended Users;
- Comment behavior when the underlying Moment is unavailable;
- Comment notifications;
- reporting Comments;
- moderation removal;
- plain-text content validation;
- maximum Comment length;
- accidental duplicate-submission prevention; and
- accessibility of Comment threads and reply relationships.

The initial release does not require:

- arbitrary-depth nested threads;
- media attachments in Comments;
- rich-text editing;
- public Comment revision history;
- Comment ranking by engagement;
- personalized Comment ordering;
- Event-level discussion;
- Timeline-level discussion;
- location-level discussion;
- direct messaging derived from Comment threads; or
- Comment reactions unless separately justified by the reaction specification.

## Open Product Questions

The following questions require deliberate resolution:

- What exact maximum Comment length should apply?
- What Comment interaction options should a Moment creator be able to choose?
- Should "anyone who can view" be a day-one Comment permission?
- Should "followers only" be a day-one Comment permission?
- Should mutual followers receive a distinct Comment permission option?
- What should the default Comment permission be for newly created Moments?
- Can a creator change Comment permissions after discussion already exists?
- If Comment permissions become more restrictive, what happens to existing Comments from Users who would no longer be permitted to create new ones?
- Should creators be able to hide the entire existing discussion without deleting individual Comments?
- Should creators be able to delete Comments authored by other Users, or should they only be able to report/hide them subject to moderation semantics?
- If creators can hide Comments from their own Moment, is that action visible to the Comment author?
- Should Comment counts include replies? The recommended answer is yes, but this should be finalized.
- Should reply threads be collapsed by default after a threshold?
- How many replies should initially be shown before expansion is required?
- When replying to a reply, should the interface visibly indicate the specific User being answered even though visual nesting remains one level?
- Should `@mentions` ship on day one?
- If mentions ship, can a User disable mention notifications?
- Can a User prevent particular Users from mentioning them without blocking?
- Are links permitted in day-one Comments?
- Should URLs receive previews?
- What anti-spam treatment should apply to links?
- Should Comment text support basic formatting such as line breaks only, or a constrained Markdown subset?
- How should emoji be handled?
- Should Comment authors have a time-limited edit window or unlimited editing?
- Should substantial edits trigger new notifications to prior participants?
- Should replies remain visible if their parent Comment is author-deleted?
- What exact tombstone text should appear for deleted Comments?
- Should an author's identity remain visible on a deleted-Comment tombstone?
- How should Comments be handled when the author's account is deleted?
- Should account deletion remove Comment text, anonymize authorship, or preserve some Comments?
- How should Comments behave when a User blocks another User after both have participated in the same public thread?
- Should blocked Users' existing Comments be hidden completely, collapsed, or shown normally in shared public discussions?
- Can a User individually hide another User's Comments without blocking them?
- Should muted Users or muted conversations exist as concepts distinct from blocking?
- Should Users be able to mute notifications for a specific Comment thread?
- Does commenting on a Moment automatically subscribe the User to future reply notifications?
- Which Comment notifications are enabled by default?
- Should creators receive notifications for every Comment on high-volume Moments, or should notifications aggregate automatically?
- Should Comment reactions ship on day one?
- If Comment reactions exist, which reaction types are allowed?
- Should Comments be searchable?
- If searchable, are they searchable globally or only within a Moment?
- Should deleted or moderated Comments remain in User data exports?
- What moderation evidence must be retained after author deletion?
- How quickly must Comment deletion propagate through caches, notifications, search indexes, and other derived stores?
- Should a Comment be allowed while its Moment's media is still processing?
- Can Users comment on a Moment whose creator account is suspended?
- What happens to Comments if a Moment is removed by moderation and later restored?
- Should Comments support translation in the future, and if so, how is translated text distinguished from authored text?

These questions should be resolved before implementation choices accidentally become permanent product semantics.

## Architecture Constraints

This document does not prescribe a Comment aggregate, relational table, event stream, Kafka topic, projection, or service.

It does impose several architectural constraints.

The implementation must preserve stable Comment identity, stable User authorship, Moment association, parent-Comment context where applicable, creation time, edit state, and deletion/moderation state.

Authoritative ordering must derive from Comment creation semantics rather than mutable engagement metrics.

The architecture must not denormalize mutable User handles or display names in a way that causes Comment authorship to become historically incorrect after identity changes.

Authorization must be enforceable consistently across authoritative and derived representations, including notifications, search indexes, caches, and high-volume read models.

The system must also support large discussions without requiring an entire thread to be loaded or rewritten for ordinary operations.

Whatever Chronologity stores internally about a Comment's revisions must not force those revisions to become publicly visible, and must not prevent privacy-compliant deletion and suppression.

## Guiding Principle

When deciding how Comments should behave, ask:

> **Does this preserve useful human conversation around history without allowing present-day engagement to rewrite the history itself?**

Moments represent what happened.

Comments represent what people say about it.
