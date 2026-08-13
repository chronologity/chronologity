# Chronologity Identity

## Purpose

This document defines how Chronologity represents the identity of Users and other people who appear in historical records.

Identity answers questions such as: Who is this person? How are they represented in Chronologity? How can other Users find or distinguish them? What happens when the person represented in history does not have a Chronologity account?

Identity is related to accounts, profiles, social relationships, tagging, privacy, and historical context, but it is not synonymous with any of them.

This document defines product semantics rather than database schemas, authentication mechanisms, identity-provider integrations, authorization rules, or service boundaries.

## Core Principle

Chronologity must distinguish **account identity** from **historical human identity**.

The world represented by Chronologity contains people who have accounts, do not have accounts, had no account when a historical event occurred but joined later, may never join, may be deceased, or may be unidentified.

```text
Person ≠ User
Identity ≠ Account
Identity ≠ Profile
Identity ≠ Authentication
```

Chronologity should not require an account before a person can be represented as part of history.

## User Identity

Every Chronologity User has a stable internal account identity that survives ordinary changes to display name, profile image, biography, handle, authentication credentials, email address, phone number, authentication provider, devices, and sessions.

```text
Stable User identity
        │
        ├── mutable profile
        ├── mutable credentials
        ├── mutable preferences
        └── mutable public representation
```

The stable identity must not depend on any single public-facing attribute.

## Internal Identity Versus Public Identity

Internal identity gives the system a stable reference. Public identity gives people a human-facing representation.

```text
Internal identity → stable system reference
Public identity   → human-facing representation
```

A public handle or display name must not become the authoritative internal identity merely because it is convenient in URLs or interfaces.

## Profile

A **Profile** is the user-facing representation of a User. Potential profile information includes display name, handle, profile image, biography, selected identity information, discoverability state, and other deliberately exposed attributes.

A Profile is not the User itself. Changing the Profile does not create a new User.

## Display Name

A display name is a human-readable name chosen for presentation. Display names need not be globally unique.

```text
Alex Smith
Alex Smith
Alex Smith
```

may represent three different Users.

Chronologity should not force artificial uniqueness into ordinary human names.

## Handles

Chronologity should support a stable human-usable identifier for finding and distinguishing Users. A **handle** is the preferred product concept.

```text
Display name: Richard Bumbury
Handle:       @richard
```

Display names provide human presentation; handles provide unique user-facing references.

### Handle Uniqueness

Handles should be globally unique among active assignable handles. Case variants should not create confusingly distinct identities.

```text
@Richard
@richard
@RICHARD
```

should not represent three different Users.

### Handle Mutability

Handles should be **changeable**.

A permanent handle creates unnecessary long-term consequences for a name selected early in an account's life. Stable User identity must therefore exist independently of the current handle.

A handle change must not create a new User, break Moment provenance, change social relationships, alter comments or reactions, or create a different historical identity.

### Previous Handles

Chronologity should not automatically expose a permanent public history of every handle a User has used.

Limited internal retention may be necessary for abuse prevention, redirects, cooldowns, or security. Internal retention does not imply public disclosure.

### Handle Reuse

Previous handles should not be released immediately for unrestricted reassignment because that creates impersonation and broken-reference risks.

The exact reservation or cooldown policy remains open.

### Handle Changes and Links

Public links should resolve through stable identity rather than relying exclusively on mutable handles.

If handle-based URLs are supported, Chronologity must define how old links behave after a handle change.

## Profile Image and Biography

A User may select a profile image and, if included in the product, a short biography.

Neither is proof of identity. Both are mutable profile representation and must not alter stable User identity or historical provenance.

## Real Names

Chronologity should **not require Users to publicly use their legal names** as a general product rule.

Preferred names, professional names, stage names, pseudonyms, and other consistent public identities should be permitted.

Any legal identity information required for a future legal, financial, safety, or verification purpose must remain distinct from ordinary public profile identity unless explicitly intended otherwise.

## Pseudonymity

Chronologity should permit pseudonymous public identity.

```text
Pseudonym     → non-legal public identity
Impersonation → deceptive representation as another person
```

The former should be permitted; the latter should be prohibited under moderation rules.

## Verification

Verification should not be required for ordinary participation.

If introduced later, verification should establish a narrow claim that the account is controlled by or legitimately represents an identified party according to the applicable process.

```text
Verified identity ≠ Verified content
```

Verification must not create privileged historical truth.

## Person

A **Person** is a human being represented in Chronologity's historical model. A Person may or may not correspond to a User.

Chronologity must support non-User people without creating fake accounts for them.

```text
Moment: Family reunion, 1998

People:
 ├── User A
 ├── User B
 ├── Grandmother — no account
 └── Uncle — no account
```

Representing someone in history does not imply account creation, acceptance of terms, consent to public discoverability, or control of a Profile.

## Unidentified People

Chronologity must not require every person appearing in media to be identified.

A Moment may include a known User, a known non-User Person, an unknown person, or a bystander.

Unknown people should be allowed to remain unknown. Chronologity should not create pressure to identify every face or participant.

## Identity Association

Chronologity may associate a historical Person representation with a User account when there is an appropriate basis.

If a User joins in 2026 and is identified as the person appearing in a 2005 Moment:

```text
Person existed in Moment: 2005
User account created:     2026
Association established:  2026
```

The historical occurrence remains in 2005.

## Claiming Historical Identity

Chronologity may eventually allow a User to claim or confirm that a historical Person representation refers to them.

Such a claim is privacy- and abuse-sensitive. A matching name, face, location, or social relationship is not sufficient by itself to establish identity.

```text
"This is me" assertion
        ≠
Confirmed identity association
```

The exact confirmation model remains open.

## Tagging

Tagging connects a User or Person identity to a Moment.

It is an identity assertion tied to historical context and can reveal where someone was, when they were there, and with whom.

```text
Tagging = Identity assertion + Historical context
```

Tagging therefore requires explicit privacy semantics.

### Tagging a User

A creator may propose an association between a Moment and another User.

The creator's assertion alone should not grant unlimited public visibility to that association. A tagged User should have meaningful control over whether their account identity is publicly associated with another User's Moment.

The exact day-one consent workflow remains open, but the model should support the conceptual distinction between a proposed and accepted association.

### Tagging a Non-User Person

Associating a named non-User Person with a Moment requires additional restraint because that person has no account through which to manage the association.

Chronologity should avoid turning private historical references into broadly discoverable shadow profiles.

### Removing Identity Association

Removing a tag or identity association does not automatically delete the Moment.

```text
Remove identity association ≠ Delete Moment
```

Removing an account association also does not necessarily erase the fact that an unidentified person appears in the underlying media.

## Depicted Person, Tagged Person, Participant, Creator, and Subject

These roles are distinct.

```text
Depicted    → appears visually or audibly
Tagged      → explicit identity association
Participant → took part in the experience
Creator     → committed the Moment
Subject     → person represented by or central to the Moment
```

A participant may not appear in media. A background person may not be a participant. A creator may record a Moment about someone else.

Chronologity should not collapse these relationships.

## Historical Provenance

Historical provenance must continue to refer to the same User even if public identity changes later.

A comment authored by a User remains authored by that User after display-name or handle changes.

The interface may eventually choose between current public identity, historical identity-at-action, or another presentation, but underlying authorship must remain stable.

## Current Identity Versus Historical Identity

People's names and identity presentation can change over time.

Chronologity must not accidentally decide whether historical content should display current identity or identity as it appeared at the historical time merely through denormalized storage.

This is a sensitive balance among historical accuracy, privacy, personal autonomy, and context and remains an open product decision.

## Identity Changes

Users may update their current public identity without creating a new User.

Profile changes must not alter Moment occurrence time, creation provenance, social relationships, comment authorship, reaction authorship, causal assertions, or stable internal identity.

## Search and Discoverability

Chronologity should allow Users to find other Users through appropriate public identity information such as current handle and display name.

Private authentication attributes must not automatically become searchable.

```text
Used for login ≠ Public identity
```

A User should have meaningful control over discoverability, but Chronologity should avoid creating an incomprehensible settings matrix.

Search, recommendations, shared Event context, comments, reactions, social relationships, tags, and public Moments may each expose identity differently.

## Identity Through Shared History

Shared historical context may reveal relationships among people even when no explicit social relationship is published.

Identity associated with Events, locations, time, or causal relationships must therefore remain privacy-sensitive.

```text
Identity + Location + Time
```

may be substantially more revealing than any of those fields independently.

## Facial Recognition

Chronologity should not require facial recognition for identity.

```text
Face detected ≠ Identity established
```

If facial recognition is ever considered, it requires a separate product, privacy, legal, security, and consent decision. It must not emerge merely as a convenient tagging implementation.

## AI and Identity

AI may eventually suggest possible identity relationships but must not become an unreviewed identity authority.

```text
Identity suggestion ≠ Identity fact
```

AI confidence must not silently create identity associations.

## Impersonation

Chronologity must prohibit deceptive impersonation according to its moderation policy.

Pseudonymity is not impersonation. Shared names are not impersonation.

Fan, parody, archival, or representative accounts, if ever supported, require explicit semantics rather than being automatically treated as authentic or deceptive.

## Reserved and Protected Handles

Chronologity may reserve handles needed to reduce impersonation, confusion, abuse, or system conflicts.

The policy should remain minimal and principled.

## Organizations

The initial identity model should be designed primarily around people.

If Chronologity later supports organizations, venues, institutions, entertainment properties, or communities as account-bearing identities, those should not be forced into the Person model.

```text
Person identity ≠ Organization identity
```

## Deceased People

Historical records naturally include deceased people. They do not need accounts to be represented.

If a deceased person previously had a User account, memorialization or legacy-management semantics may eventually be needed.

Chronologity must not infer death from inactivity.

```text
Inactive User ≠ Deceased person
```

## Minors

Identity information involving minors requires heightened privacy consideration.

A minor may appear in another User's historical records without being eligible for an account. Tagging and discoverability cannot therefore assume that every represented person can consent through an account.

Minimum account age and child-safety requirements must be resolved before launch.

## Sensitive Identity Attributes

Chronologity should avoid requiring or publicly categorizing sensitive personal identity attributes unless necessary for a clearly defined product capability.

```text
Can infer ≠ Should store as profile attribute
```

The platform should not create unnecessary structured identity dossiers from historical information.

## Identity Privacy

Identity privacy extends beyond Profile visibility.

Chronologity must consider leakage through tags, comments, reactions, shared Events, locations, search, discovery, social relationships, notifications, causal relationships, media, temporal aggregates, and historical jumps.

A hidden Profile provides little privacy if all other surfaces expose the same identity.

## Identity Deletion

Account deletion must distinguish among deleting the account, removing the Profile, releasing the handle, removing identity associations, removing authored content, deleting media, and erasing internal records.

These are not automatically the same operation.

Historical content created by other Users may continue to contain some representation of the person even after account deletion, subject to privacy, moderation, and legal rules.

## Identity Product Invariants

1.  Person, User, Profile, authentication identity, and public identity are distinct concepts.
2.  A Person may exist in Chronologity history without being a User.
3.  Chronologity must not create fake User accounts to represent non-User people.
4.  A User has stable internal identity independent of mutable public attributes.
5.  Display names need not be globally unique.
6.  Chronologity should provide a globally unique user-facing handle.
7.  Handle uniqueness should prevent confusing case variants.
8.  Handles should be changeable without changing User identity.
9.  Handle changes must not alter historical provenance, social relationships, or Moment identity.
10. Previous handles should not automatically become a permanent public identity history.
11. Previous handles should not become immediately reusable without a deliberate anti-impersonation policy.
12. Public links must not depend exclusively on mutable identity attributes.
13. Chronologity should not require legal names as ordinary public identity.
14. Pseudonymity is permitted; deceptive impersonation is not.
15. Verification, if introduced, verifies identity control rather than historical truth.
16. A non-User Person representation must not imply account creation, consent, or platform-wide discoverability.
17. Unknown people may remain unidentified.
18. Tagging is an identity assertion tied to historical context and requires privacy semantics.
19. Depicted person, tagged person, participant, creator, and subject are distinct concepts.
20. Removing an identity association does not automatically delete the underlying Moment.
21. A User joining later does not change when historical events involving that person occurred.
22. Identity changes must not create a new User or rewrite historical occurrence.
23. Authentication attributes must not automatically become public identity or search attributes.
24. Identity-location-time combinations must respect privacy and consent.
25. Facial recognition is not required for Chronologity's identity model.
26. AI identity suggestions must not silently become established identity facts.
27. Inactivity must not be interpreted as death.
28. Person and organization identity should not be collapsed into one model.
29. Chronologity should avoid collecting structured sensitive identity attributes merely because they can be inferred.
30. Account deletion and historical identity references require distinct semantics.

## Day-One Identity Requirements

Before launch, Chronologity must have explicit product behavior for:

- stable internal User identity;
- display names;
- unique handles;
- handle normalization;
- handle changes;
- handling of previous handles;
- public profile representation;
- profile images;
- User search identity;
- profile discoverability;
- pseudonymous identity;
- impersonation rules;
- tagging Users in Moments;
- removing or declining identity associations;
- representing people who do not have accounts;
- distinguishing unidentified people from known people;
- identity privacy in shared historical context;
- account deletion effects on public identity; and
- minimum-age implications for identity and tagging.

Facial recognition, identity verification, organization accounts, memorialization, and automated identity matching are not required for the initial release.

## Open Product Questions

The following questions require deliberate resolution:

- What characters are permitted in handles?
- What are the minimum and maximum handle lengths?
- Which Unicode normalization rules apply?
- Which handles are reserved?
- How often may a User change their handle?
- How long should a previous handle remain reserved?
- Should old handle URLs redirect to the current Profile, and for how long?
- Should a User be able to prevent an old handle from revealing their new handle?
- What display-name length and content rules apply?
- Can a User omit a profile image?
- What profile fields exist on day one beyond display name, handle, image, and potentially biography?
- Is biography part of the initial Profile?
- Which Profile fields are publicly visible by default?
- Can a User make their Profile non-discoverable in direct search?
- Can a User opt out of recommendations while remaining searchable?
- What identity information appears beside comments and reactions?
- What identity information appears in shared Event contexts?
- What is the exact consent workflow when another User tags someone in a Moment?
- Is a proposed tag visible to anyone before the tagged User accepts it?
- Can a tagged User remove their association permanently?
- Can the creator re-propose a declined tag?
- Can a User block future tag requests from another User?
- How are non-User people named within private personal history?
- Can non-User Person representations ever be shared publicly?
- Can multiple Users independently create representations of the same non-User person?
- Should Chronologity ever reconcile those representations?
- If a non-User later joins, how can historical Person representations be claimed safely?
- What evidence is required to confirm such an association?
- How should disputed identity claims be handled?
- Should current identity appear on old comments and Moments, or should historical identity be preserved in some cases?
- How should name changes balance historical accuracy and privacy?
- Should Chronologity ever offer identity verification?
- What happens to a handle when an account is deleted?
- What identity remains on comments after account deletion?
- How should identity associations involving minors differ from ordinary tagging?
- Should organization accounts ever exist?
- Should memorialized accounts ever exist?
- Which identity changes require security notifications or reauthentication?

## Relationship to Architecture

This product model does not require separate User, Person, Profile, or Identity microservices.

It does require the architecture to preserve semantic distinctions among them.

Architecture must not assume:

```text
user_id = handle
user_id = email
Person = User
Profile = User
tagged person = User
```

Stable internal identifiers should anchor relationships that must survive public identity changes. Mutable public identity should be resolved appropriately rather than copied into authoritative historical relationships as though permanent.

## Guiding Principle

When modeling identity, ask:

> **Are we identifying the person, representing the person, authenticating the account, or describing the person's role in history?**

Those are different problems.

Chronologity should preserve the distinction.
