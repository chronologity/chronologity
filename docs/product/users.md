# Chronologity Users

## Purpose

This document defines the product semantics, lifecycle, capabilities, boundaries, and invariants of a **User** in Chronologity.

A User is a person who has an account and can participate in Chronologity. This document deliberately separates the User concept from authentication credentials, public identity, social relationships, people depicted in Moments, and historical content.

The central question is:

> **What does it mean to be a Chronologity User?**

This document defines product behavior rather than prescribing database schemas, aggregate boundaries, authentication providers, authorization middleware, API routes, or service topology.

## Definition

A **User** is a person with a Chronologity account who can act within the product.

A User may create and interact with historical records, establish product preferences, participate in social relationships, and access information according to the applicable privacy and authorization rules.

```text
Person
  │
  │ creates account
  ▼
User
```

However:

```text
User ≠ Profile
User ≠ Credentials
User ≠ Session
User ≠ Social graph
User ≠ Timeline
User ≠ Person appearing in media
```

These concepts may be associated with a User, but they should not be collapsed into one model.

## User Versus Person

Chronologity must distinguish a **User** from a **Person**.

A User has an account.

A Person may exist in historical context without having a Chronologity account.

For example, a Moment may depict:

```text
Moment
 ├── Richard      → Chronologity User
 ├── Friend       → Chronologity User
 ├── Grandparent  → not a Chronologity User
 └── Bystander    → unidentified person
```

The historical world represented by Chronologity is larger than the set of people who have accounts.

Chronologity should not require every person represented in history to become a User.

## User Versus Identity

A User is the account-level actor.

Identity describes how a person is represented, named, discovered, or associated with historical information.

```text
User
  │
  ├── account participation
  ├── product preferences
  ├── permissions
  └── lifecycle

Identity
  │
  ├── name
  ├── handle
  ├── profile representation
  ├── discoverability
  └── associations with historical records
```

The detailed identity model belongs in `identity.md`.

This distinction allows Chronologity to reason about account lifecycle independently from public representation.

## User Versus Authentication

Authentication establishes that an actor is entitled to act as a User.

It does not define the User.

```text
Credentials
    ↓
Authentication
    ↓
Authenticated as User
```

Changing a password, replacing an authentication provider, refreshing a session, or signing in on another device does not create a different User.

Authentication is an architectural and security mechanism around User identity, not the product definition of the User.

## User Versus Profile

A Profile is a representation of a User.

The User is the actor behind that representation.

Profile information may change while the User remains the same.

```text
User
 └── Profile
      ├── display name
      ├── avatar
      ├── biography
      └── other identity information
```

The exact profile model belongs in `identity.md`.

## User Versus Timeline

A User does not own a Timeline entity merely by having an account.

As defined in `timelines.md`, a Timeline is derived chronology.

The phrase:

```text
Richard's Timeline
```

means conceptually:

```text
Chronological representation of the history
available in the applicable Richard-related scope
```

not necessarily:

```text
Timeline {
  ownerId: Richard
}
```

A User creates Moments. Chronologity derives Timeline views.

## User Versus Moment

A User may create a Moment, but User identity and Moment identity are independent.

```text
User
  │
  └── creates
       │
       ▼
     Moment
```

A Moment represents an experience.

The creator represents the account responsible for committing that historical record to Chronologity.

The creator is not necessarily the only person represented by or participating in the Moment.

## User Roles Around a Moment

Chronologity should distinguish different relationships between Users, people, and Moments.

Potential relationships include:

- creator;
- contributor;
- depicted person;
- participant;
- tagged person;
- commenter;
- reactor;
- viewer; and
- moderator or authorized operator where applicable.

These relationships are semantically different.

For example:

```text
Created by User A
Depicts User B
Tagged User C
Commented on by User D
Viewed by User E
```

Chronologity should not model all of these as generic "Moment users."

## Account Creation

A person becomes a Chronologity User by completing the product-defined account-creation process.

The exact registration requirements, verification mechanisms, minimum age, supported authentication methods, and jurisdictional constraints require separate product, legal, architecture, and security decisions.

Account creation should establish a stable User identity independent of any particular session or device.

## User Identity Stability

A User should have a stable internal identity across:

- profile changes;
- handle changes, if handles are mutable;
- email or phone changes;
- password changes;
- device changes;
- authentication-provider changes;
- session renewal;
- application reinstallations; and
- other ordinary account maintenance.

User-facing identifiers may change.

The underlying User should remain the same account actor.

## User Lifecycle

At the product level, a User may pass through states or conditions such as:

```text
Account created
      ↓
Active
      ↓
Restricted / suspended, if required
      ↓
Reactivated, where permitted
      ↓
Account deletion requested
      ↓
Account removed according to deletion semantics
```

This is a conceptual lifecycle, not a prescribed state machine.

Architecture should introduce explicit states only when they correspond to meaningful product or operational behavior.

## Active User

An active User may use the product capabilities available to their account and authorization context.

Being active does not imply that every feature, Moment, person, Event, location, or social relationship is accessible.

```text
Authenticated
    ≠
Authorized for everything
```

Authorization remains contextual.

## Account Restrictions

Chronologity must be able to restrict a User when required for safety, abuse prevention, legal obligations, security, or enforcement of product rules.

Restrictions may eventually vary in scope.

Potential examples include:

- preventing creation of new Moments;
- preventing comments or reactions;
- limiting social interactions;
- preventing public distribution;
- restricting account access; or
- suspending the account entirely.

The exact enforcement model belongs in `moderation.md`.

The User model should not assume that account access is always binary.

## Suspension

Suspension should be treated as an account-level enforcement condition rather than deletion.

Suspending a User does not inherently mean that all historical content associated with that User should be permanently erased.

The visibility and treatment of content belonging to a suspended User must be defined by moderation, privacy, and legal requirements.

## Account Deletion

A User must be able to request account deletion subject to applicable product, safety, security, and legal requirements.

Account deletion is not equivalent to:

```text
DELETE FROM users
```

A User may have relationships to:

- Moments;
- media;
- comments;
- reactions;
- social relationships;
- tags;
- real-world Events;
- notifications;
- shared history;
- moderation records;
- security records; and
- derived projections.

The deletion process must define the fate of each category deliberately.

Detailed deletion and retention behavior belongs in `privacy.md`, `moderation.md`, and subsequent architecture/data specifications.

## User Deletion and Other People's History

Deleting one User must not automatically erase historical records owned or created by other Users merely because the deleted User participated in them.

For example:

```text
User A creates Moment
Moment depicts User B

User B deletes account
```

does not necessarily imply:

```text
Delete User A's Moment
```

However, associations identifying User B, privacy rights, tagging behavior, media-removal requests, and applicable legal obligations may require separate handling.

Account deletion and removal from another person's historical record are different problems.

## User Deletion and Shared Context

Shared historical context makes account deletion more complex.

A deleted User may have contributed information to:

- shared real-world Events;
- comments on another User's Moment;
- reactions;
- causal assertions;
- tags;
- collaborative content, if supported later; or
- other shared structures.

Chronologity should avoid designing account deletion around the assumption that all User-associated data is exclusively owned by that User.

## User Data Ownership

"Ownership" should be used carefully.

A User may control content they create, but Chronologity may contain information involving multiple people or multiple authors.

Examples include:

```text
Moment created by User A
Comment authored by User B
Reaction created by User C
Photo depicts User D
Event context shared by many Users
```

No single generic `ownerId` can correctly express all of these relationships.

Product semantics should use specific relationships such as creator, author, participant, contributor, or subject where those distinctions matter.

## User Preferences

A User may have preferences controlling their personal Chronologity experience.

Potential preference categories include:

- autoplay behavior;
- notification settings;
- privacy defaults;
- accessibility preferences;
- discovery preferences;
- content presentation;
- language or locale;
- time and date presentation; and
- other user-specific behavior.

Preferences should affect the User's experience without rewriting historical facts.

For example:

```text
User preference:
Display dates in a different format
```

must not alter the underlying occurrence semantics of Moments.

## Autoplay Preference

Chronologity's intended default is for videos to autoplay with sound when they become active in the primary Moment experience, subject to platform capabilities and restrictions.

Users should be able to disable autoplay through a preference.

The exact preference granularity---such as autoplay entirely, autoplay sound, cellular-network behavior, or other controls---belongs in `media.md`.

## Accessibility Preferences

Accessibility requirements should not be treated merely as optional preferences.

Some user-configurable behavior may support accessibility, but Chronologity itself must remain accessible without requiring users to discover hidden configuration.

Potential User preferences may include reduced motion or media behavior, while foundational accessibility requirements belong in `accessibility.md`.

## Privacy Defaults

Chronologity may allow Users to establish default privacy or visibility behavior for newly created Moments.

A default is not necessarily a permanent property of every Moment.

Conceptually:

```text
User privacy default
        ↓
Applied during Moment creation
        ↓
Moment receives its own visibility semantics
```

Changing the User's future default should not silently rewrite the visibility of historical Moments unless the product explicitly offers such a bulk operation.

## User Locale and Time

Chronologity represents history across time zones and potentially across decades.

A User may have locale, language, time-zone, or date-format preferences used for presentation.

Presentation preferences must remain separate from historical occurrence data.

```text
Stored historical semantics
        ↓
User-specific presentation
```

The system should not mutate historical time merely because a User changes location or display preferences.

## Social Participation

A User may establish social relationships with other Users according to the model defined in `social-graph.md`.

The User concept itself should not encode assumptions about whether those relationships are:

- following;
- friendship;
- subscription;
- mutual connection;
- approval-based;
- public; or
- private.

Those are social-graph semantics.

## Blocking

Blocking is a relationship between Users with privacy, discovery, communication, and safety consequences.

Blocking should not be represented merely as another ordinary follow relationship.

The exact product behavior belongs in `social-graph.md` and `moderation.md`.

At minimum, the architecture must eventually be able to apply blocking consistently across relevant surfaces.

## User Discovery

Users may be discoverable through search, recommendations, shared historical context, social relationships, or other product mechanisms.

Discoverability is not inherent to having an account.

Chronologity should distinguish:

```text
User exists
      ≠
User is publicly discoverable everywhere
```

The detailed discoverability model belongs in `identity.md`, `discovery.md`, `search.md`, and `privacy.md`.

## User Search

Search may allow one User to locate another User according to identity and privacy rules.

Search must not expose private account attributes merely because those attributes are useful internally for authentication or account recovery.

For example, an email address used to sign in should not automatically become a public search identifier.

## User Activity

A User may perform activities such as:

- creating Moments;
- correcting Moments;
- commenting;
- reacting;
- establishing social relationships;
- changing privacy settings;
- navigating history;
- searching;
- viewing;
- reporting; and
- managing account preferences.

Not all activity should become public social information.

Chronologity should not assume:

```text
User did something
        ↓
Other users should know
```

Activity visibility must be explicitly defined.

## User Activity Versus History

Chronologity must preserve the distinction between a User's current product activity and the historical occurrence represented by a Moment.

```text
User creates Moment in 2026
Moment occurred in 2010
```

The User's creation activity occurred in 2026.

The represented experience occurred in 2010.

These timestamps answer different questions and must not be collapsed.

## User History Versus Activity Log

A Timeline is not an account activity log.

```text
Timeline
    → What happened in represented history?

Activity log
    → What actions did the User perform in the product?
```

Chronologity may need operational or security activity records, but those records should not become Timeline Moments automatically.

## Multiple Devices

A User may access Chronologity from multiple devices.

Device identity must not become User identity.

```text
One User
 ├── Phone
 ├── Tablet
 └── Future device
```

Sessions, push tokens, local caches, upload jobs, and device preferences may be associated with devices, but the account remains the stable User.

## Multiple Sessions

A User may have multiple valid sessions subject to security policy.

Signing out of one session does not inherently delete or alter the User.

The product should eventually provide appropriate account-security controls for session management, but those mechanisms belong in authentication/security specifications.

## Account Recovery

Account recovery exists to restore access to the same User identity.

```text
Lost credentials
      ↓
Recovery
      ↓
Same User
```

Recovery must not create a replacement User whose historical relationships are copied from the old account.

The detailed recovery model belongs in authentication and security documentation.

## Multiple Accounts

Chronologity should not assume that two accounts belonging to the same real-world person are automatically the same User.

Automatically merging accounts based on inferred identity would be dangerous.

If account merging is ever supported, it should be an explicit product capability with carefully defined ownership, identity, social, historical, and security semantics.

## Impersonation

Chronologity should distinguish ordinary identity representation from impersonation.

A User should not be permitted to misrepresent themselves as another person in ways prohibited by product policy.

The exact authenticity, parody, public-figure, and impersonation rules belong in `identity.md` and `moderation.md`.

## Users Who Are Minors

Chronologity's historical and media model can contain sensitive information about children even when the account holder is an adult.

The minimum age for account creation and the treatment of minors require explicit legal and product decisions before launch.

The User model should not silently assume that every person appearing in a Moment is an eligible Chronologity User.

## Deceased People

Chronologity's historical purpose means Moments may naturally include people who are deceased.

A deceased person may appear extensively in history without ever having been a Chronologity User.

This reinforces:

```text
Person ≠ User
```

If Chronologity eventually supports memorialization or posthumous account handling, that should be introduced as a deliberate product model rather than inferred from ordinary account inactivity.

## Inactive Accounts

Lack of recent activity does not automatically mean an account should be deleted, hidden, memorialized, or considered abandoned.

Chronologity is designed around long-lived history. Extended periods of inactivity may be normal.

Any inactivity policy must therefore be deliberate and compatible with the product's long-term historical purpose.

## User-Generated Historical Record

A User may create many Moments over years or decades.

The product should not assume that a User's history is small enough to load, export, delete, index, or process synchronously in one operation.

This follows naturally from:

```text
Long-lived User
      ×
Many Moments
      ×
Unlimited media per Moment
      =
Potentially very large personal history
```

Architecture must support this scale without weakening the product model.

## Data Portability

A User should eventually be able to obtain a meaningful export of applicable Chronologity data.

Export is an account capability, but the exported information may include several independently authored or shared relationships that require careful semantics.

The export model should preserve useful historical context without exposing information the User is not entitled to export.

## Administrative Actors

Chronologity may require internal administrative or moderation capabilities.

Internal operators should not be modeled as omnipotent ordinary Users.

If administrative roles exist, their elevated capabilities should be explicit, least-privileged, auditable, and separated from normal product authorization.

```text
User capability
        ≠
Administrative capability
```

The detailed model belongs in architecture and security documentation.

## Automated Actors

Chronologity may use automated systems for media processing, projections, notifications, moderation assistance, search indexing, or AI features.

Automated systems are not Users merely because they perform actions.

System actors should be represented explicitly where provenance requires them.

For example:

```text
Causal relationship suggested by AI
        ≠
Causal relationship asserted by User
```

Actor provenance must not be erased by pretending every system operation was performed by a User.

## User Provenance

Where the identity of the actor matters historically or socially, Chronologity should preserve appropriate provenance.

Examples include:

- who created a Moment;
- who authored a comment;
- who added a reaction;
- who asserted a causal relationship;
- who corrected historical information;
- who changed applicable sharing settings; and
- whether an action originated from a User or automated system.

The degree to which provenance is publicly visible may differ from the degree to which it must be retained internally.

## User Privacy

A User's account may contain information that should never automatically become public profile information.

Potentially sensitive account data includes:

- authentication identifiers;
- recovery information;
- device information;
- security activity;
- private preferences;
- precise location;
- private Moments;
- hidden social relationships; and
- moderation or enforcement information.

Public identity must be deliberately derived from allowed profile information rather than exposing the User record wholesale.

## User Authorization

A User's ability to perform an action depends on context.

```text
User
  +
Resource
  +
Relationship
  +
Privacy state
  +
Enforcement state
  +
Action
  =
Authorization decision
```

Being the creator of a resource may grant significant control, but creator status should not automatically bypass every privacy, safety, legal, or shared-content constraint.

## User Notifications

Notifications are delivered to a User according to product rules and preferences.

Notification state belongs to the recipient's experience and should not be confused with the historical content that triggered the notification.

A User may have notifications about Moments that occurred long ago.

## User Product Invariants

1.  A User is a person with a Chronologity account who can act within the product.
2.  A User is not the same concept as a Person represented in history.
3.  A person may appear in Chronologity history without having an account.
4.  A User is distinct from their profile, credentials, sessions, devices, Timeline, and social relationships.
5.  Authentication establishes that an actor may act as a User; it does not define the User.
6.  A User has a stable account identity across ordinary profile, credential, device, and session changes.
7.  Users create Moments; they do not own independently persisted Timeline containers by default.
8.  The creator of a Moment is not necessarily the only person represented by that Moment.
9.  Creator, contributor, depicted person, participant, tagged person, commenter, reactor, and viewer are distinct relationships.
10. Account activity and represented historical occurrence are different temporal concepts.
11. A Timeline is not a User activity log.
12. User preferences may affect presentation and behavior but must not rewrite historical facts.
13. Changing a privacy default should not silently rewrite historical Moment visibility.
14. Device identity must not become User identity.
15. Account recovery restores access to the same User rather than creating a replacement historical identity.
16. Multiple accounts must not be automatically merged merely because Chronologity infers that they represent the same real-world person.
17. Account suspension and account deletion are different concepts.
18. Deleting one User must not automatically delete historical records created by other Users.
19. A generic ownership relationship is insufficient for all User-associated data.
20. User existence does not imply universal public discoverability.
21. User activity should not automatically become public social activity.
22. Internal administrative actors must not gain implicit unrestricted access merely by being modeled as Users.
23. Automated systems are not Users and should preserve distinct provenance where relevant.
24. Public profile information must be deliberately derived rather than exposing private account information.
25. Authorization is contextual; authentication does not imply universal access.
26. Extended inactivity does not automatically imply abandonment or deletion.
27. Chronologity must support Users whose historical records may become very large over time.

## Day-One User Requirements

Before launch, Chronologity must have explicit product behavior for at least:

- account creation;
- stable User identity;
- authentication;
- basic profile representation;
- account preferences required by day-one features;
- privacy defaults;
- social participation required by the initial Feed;
- blocking behavior;
- account restrictions and suspension;
- account deletion;
- User search/discoverability;
- authorization boundaries;
- notification preferences required by the initial notification model;
- multi-device/session expectations;
- account recovery;
- treatment of private account information;
- minimum account age requirements; and
- distinction between Users and non-User people represented in Moments.

Not every advanced account-management feature must ship on day one, but the underlying semantics must not prevent them.

## Established Account Decisions

These were open questions. Implementation settled them, and they are requirements now rather than possibilities. Each names where it was decided so the decision can be revisited deliberately rather than rediscovered.

**Creating an account requires a handle, a display name, and a date of birth.** A biography is optional. Nothing else is asked for (`packages/contracts/src/users.ts`).

**The minimum age is thirteen, and it is configuration rather than a constant.** The threshold in force when an account was created is stored alongside the birthdate, because without it nobody can say afterwards which rule an account was admitted under (`user_restricted_data.minimum_age_at_creation`, `USER_MINIMUM_AGE_YEARS`).

**Three authentication methods ship: a magic link sent to an email address, a password, and a code sent to a phone number.** All three resolve to the same Identity.

**An email address is required.** It is how an Identity is established and how a returning person is recognised as the same one, not merely one mechanism among several (`identity_emails`).

**A phone number is a third way to sign in** (ADR-110). An account holds one, it is proven by a six-digit code sent to it, and it may be replaced or removed at any time. An email address is still required: it is the fallback that makes everything else about phone sign-in safe.

**A number unused for sixty days stops working for sign-in until its holder confirms it again.** This is the answer to numbers changing hands. Carriers lease numbers rather than sell them, and a disconnected number is eventually given to somebody else — who could then receive a code sent to it. Reassignment only happens after the original holder stops using the number, so silence is the signal, and confirming again runs through the account's email address, which whoever received the number does not have.

When somebody asks for a code for a number that has gone quiet, no text is sent and the account's address receives a notice explaining what to do. The caller learns nothing either way, which the account-existence rule requires; the account holder learns exactly what happened.

**Every phone sign-in sends a notice to the account's email address.** Prevention can fail, and the holder should find out the same minute.

**This does not stop SIM swapping**, where somebody persuades a carrier to move a live number to their own device. Nothing Chronologity can build without carrier data does. Detecting it needs a provider that can report a recent swap, and that check belongs where a code is sent.

**Nothing reaches a real phone yet.** There is no messaging provider, so codes are recorded rather than delivered, exactly as local email goes to a local mail server. That is a credentials problem, not a design one.

**Signing in with Google or Apple will be supported, and is deferred.** Neither is implemented. The obstacle is not design but access: both require registered applications and provider credentials that do not exist yet, and Apple's additionally requires a paid developer account. Building against credentials nobody holds would produce a path nobody could sign in through.

What is settled is that a provider identity resolves to the same Identity as everything else, rather than creating a parallel kind of account. An Identity already resolves through a separate table rather than through a column, so a provider subject identifier fits the shape that exists — the same reason phone numbers will fit.

What remains undecided is the substance: whether a provider address that is already registered joins the existing Identity or is refused, what happens when a provider stops asserting an address it previously asserted (Apple's private relay makes this ordinary rather than exotic), whether a provider identity alone can hold an account with no password and no verified address of its own, and whether unlinking a provider is permitted when it is the only way in.

One obligation is inherited rather than open. ADR-081 requires that no authentication surface disclose whether an address is registered, and a provider path must not become the exception that undoes it everywhere else.

**Registering does not prove an address; redeeming a link sent to it does.** Password sign-in is refused until the address is verified, because anyone can type an address that is not theirs. Magic-link sign-in proves the address by definition.

**A handle is required, globally unique, and may be changed.** Uniqueness is decided by the database on the normalised form, so two people claiming one name at the same moment cannot both succeed. A released handle is reserved for a cooldown period and may be reclaimed by its previous holder within it. A User holds one current handle at a time, enforced by a partial unique index rather than by application code.

**Five preferences ship: autoplay video, autoplay sound, locale, time zone, and reduced motion.** Autoplay is on with sound by default and can be turned off, which `docs/product/vision.md` requires. Preferences are written when the account is created rather than on first change, so reading them never has to decide what a missing row means.

**Someone may list the sessions they have open, end one, or end all of them.** The session being used is marked as such. Revocation takes effect on the next request rather than at the next expiry (ADR-094).

**Account recovery is a password reset by emailed link, and magic-link sign-in.** Both prove control of the address before granting anything.

**An account is `active`, `deactivated`, or `suspended`, and the three are not interchangeable** (ADR-116). Deactivation is the person's own decision and suspension is not, which is why they are separate values rather than one "inactive": moderation must never quietly overwrite somebody's own choice, and reinstating an account must not undo it. Suspending a deactivated account is refused.

**Moderation can restrict content without restricting an account.** This answers what restrictions exist short of suspension: the seven moderation states apply to Moments, comments, and individual media, and there is no partial account state that may read but not write. Account tiers would multiply the states every future feature has to reason about, and no product document asks for them.

**A suspended account's contributions are hidden and nothing is deleted.** Their Moments and comments disappear for everybody else, their reactions stop counting, and reinstatement restores all of it exactly. Follows, blocks, and relationships are untouched throughout, because the account may come back and the history it was part of has to be there when it does.

**A suspended person still reads their own history, and may appeal.** They are restricted, not erased. Every other write is refused; signing in is not, because somebody who could not sign in could not read the explanation or answer it.

**Somebody is told when their own account is suspended, and only they are.** The public view of a User carries no status, and a suspended profile is simply absent to everybody else.

## Open Product Questions

The following questions require deliberate resolution:

- Does signing in with a provider whose address is already registered join that Identity, or is it refused?
- What happens when a provider stops asserting an address it previously asserted, as Apple's private relay allows?
- May an Identity exist with only a provider, holding no password and no address of its own?
- Can a provider be unlinked when it is the only way into an account?
- Should an account be able to hold more than one phone number?
- Should a number that has gone quiet also stop receiving notifications, or only stop signing anybody in?
- What account attributes are searchable?
- Can a User opt out of User search or recommendations?
- What privacy defaults are configured at account creation?
- Are multiple accounts per person permitted?
- Should account merging ever be supported?
- What exactly happens to a User's Moments when their account is deleted?
- What happens to comments authored on other Users' Moments after account deletion?
- What happens to reactions after account deletion?
- What happens to social relationships after account deletion?
- What happens to tags and identity associations after account deletion?
- What happens to causal assertions authored by a deleted User?
- What account information must be retained for security, abuse prevention, or legal reasons after deletion?
- What restrictions can moderation impose without full suspension?
- What content remains visible while a User is suspended?
- How does blocking affect search, discovery, Feed, comments, reactions, shared Events, and historical context?
- How should Chronologity handle accounts belonging to deceased Users?
- Should memorialization ever be supported?
- What data portability capabilities belong in the initial release?
- What account-level security activity should Users be able to review?
- Which User actions require durable provenance?
- Which provenance should be visible to other Users?

These questions should be answered in the appropriate product specifications before implementation choices make them difficult to change.

## Guiding Principle

When deciding whether information belongs to the User model, ask:

> **Does this describe the account-level person who can act in Chronologity, or does it describe how that person is represented, authenticated, connected, or recorded in history?**

Keep the User stable.

Model the surrounding relationships explicitly.
