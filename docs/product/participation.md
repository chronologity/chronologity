# Chronologity Participation

## Purpose

This document defines the product semantics, consent model, visibility, control,
and historical boundaries of **Participation** in Chronologity: the relationship
recording that a person was part of an experience somebody else recorded.

The central question is:

> **How can Chronologity record that somebody was there, without letting one
> person make an assertion about another person's history?**

A Moment is created by one person and may involve several. `moments.md` already
says a Moment "may involve people other than the creator", and `privacy.md`
already says tagging "must not automatically imply universal consent". Neither
says what the relationship is or how it comes about, and three documents defer
the question to a fourth that did not exist. This is that document.

This document defines product behavior rather than database schemas, API routes,
event contracts, projection structures, or storage technology.

## Definition

**Participation** records that a User was part of the experience a Moment
represents.

```text
Creator records Moment
        │
        │ proposes participation
        ▼
   Another User
        │
        │ accepts
        ▼
Participation exists
```

Participation is a claim about history, not about access. A participant is
somebody who was there. Whether they may read the Moment, whether their name
appears on it, and whether it reaches their Timeline are separate questions,
each answered below.

## One Relationship, Not Six

`identity.md` and `privacy.md` both list six relationships a person may have to
a Moment — creator, depicted person, participant, tagged person, contributor,
viewer — and both insist they are distinct and must not be collapsed.

Chronologity builds **one** of them: participant.

The others are deliberately not built, and each for its own reason.

**Depicted person** is a claim about what a camera captured. Establishing it at
any scale means recognising faces, which `privacy.md` rules out as a default
extension of media processing. A person may be depicted without participating,
and may participate without appearing.

**Contributor** implies a share in the Moment itself — some right to change what
it says. That is a co-authorship model, and a Moment has one author by design.

**Tagged person** is the word most products use, and it is avoided here on
purpose. "Tagging" describes an act performed on somebody. Participation
describes a fact about them, which they confirm. The distinction is the whole
model, and a word that implies otherwise would erode it.

**Viewer** is access, which the audience already records.

```text
participant     ✓  built
depicted        ✗  requires recognising faces
contributor     ✗  implies rights over another's Moment
tagged          ✗  the word asserts rather than asks
viewer          ✓  already the audience
```

Adding another relationship later is an addition. Collapsing two of them
together is not reversible, because the record no longer says which was meant.

## Proposing, Accepting, Declining

A creator **proposes** participation. Only the person named can establish it.

```text
proposed ──accept──▶ accepted
    │
    └────decline───▶ declined
```

`identity.md` requires that the model "support the conceptual distinction between
a proposed and accepted association", and this is that distinction with nothing
in between. A proposal is a question. Until it is answered it asserts nothing.

**A proposal is visible only to the two people in it.** The creator, who made it,
and the person named, who must answer it. Nobody else — not the Moment's
audience, not the creator's followers, not anybody reading the Moment.

This is the decision the model rests on, and it costs something real. Tagging
somebody feels unrewarding when nothing appears until they agree, and other
products make it appear immediately and offer removal afterwards.

Removal afterwards is not consent. `privacy.md` sets out precisely what a
participation claim discloses — where somebody was, who they were with, what
they were doing, when, and relationships they may not wish to expose — and a
claim that is published first and retracted later has already disclosed all of
it. The quiet proposal is the price of the guarantee.

## Withdrawal Is Permanent

A participant may withdraw at any time, and withdrawal ends the matter for that
Moment: the creator may not propose again.

A refusal that can be repeated is not a refusal, it is a delay. Somebody who
declines and is asked again each week has no control, only a recurring task.

```text
declined  ──▶  cannot be proposed again
withdrawn ──▶  cannot be proposed again
```

A creator who believes they have a reason to ask again has one recourse, which
is to ask the person outside Chronologity. The product does not carry that
conversation.

## Refusing Proposals Altogether

A User may refuse participation proposals from a specific account.

Without it, consent is a stream of requests somebody must keep answering, which
is a way to reach a person who does not want to be reached. A Block already
severs interaction in both directions and covers the severe case; this covers
the ordinary one, where somebody is not blocked but is not welcome to keep
asking either.

## Participation and the Timeline

An accepted participation places the Moment on the participant's Timeline.
`timelines.md` defines a person's Timeline as their accessible history rather
than what they authored, and history somebody took part in is theirs as much as
history they recorded.

**It reaches a Viewer's reading of that Timeline only if the Viewer could see
the Moment anyway.**

```text
Moment's own audience
        │
        ▼
   still governs
        │
        ▼
appears on participant's Timeline, to those already admitted
```

`privacy.md` requires that Chronologity "must never use a visible relationship to
reveal an inaccessible Moment", and a Timeline is a visible relationship. If
accepting a participation could show a private Moment to the participant's
followers, then accepting would widen somebody else's audience — and the author,
who chose that audience, would not have agreed to it.

Two consequences follow, and both are intended.

A participant's Timeline **shows them a Moment they may not read** if they
accepted participation in one. They see that they were part of something, on the
date it happened, and no more. Their own history should not have a hole in it
that they cannot even see the shape of.

A participant's Timeline **looks different to different people**, which is
already true of every Timeline: `timelines.md` establishes that two Viewers see
different chronologies of the same history, and this is that rule applying
rather than a new one.

## Being Named in What You Cannot See

A creator may propose participation in a Moment the named person cannot read.

The proposal names the creator, the occurrence time, and nothing else. Not the
caption, not the media, not the place, not who else was there.

This is the least comfortable decision in this document, and the alternatives are
worse. Requiring the creator to admit somebody to a private Moment before asking
them makes over-sharing the price of consent. Granting access on acceptance turns
participation into a second permission system running beside the audience, and
two systems that grant access will eventually disagree.

**Accepting does not grant access.** A participant who has not been admitted to a
Moment still cannot read it. If they want to see it they ask the author, which is
where that decision belongs.

## Non-User People

A Moment may involve somebody who has no Chronologity account.

They may be **named within the creator's own history**, and they are never
participants.

Participation requires consent, consent requires an account, and inventing one
would be exactly the "discoverable shadow profile" `identity.md` forbids.
A named non-User is descriptive text belonging to the Moment, not a relationship
between two accounts: it does not reach anybody's Timeline, it is not
discoverable, and it confers nothing.

If that person later joins Chronologity, nothing links automatically. A name
written by somebody else is not an identity claim, and matching them would be an
inference nobody consented to.

## Erasure

Participation records belong to the participant.

```text
account deleted
      │
      ├── their participation records  ──▶ erased
      └── the Moments they were in     ──▶ remain
```

When a User deletes their account, every participation naming them is erased,
including proposals nobody answered. The Moments remain, because they are other
people's history and were never this person's to delete — the same rule 5R
applies to comments and reactions somebody left elsewhere.

Nothing is left in place of an erased participation. A Moment does not record
that somebody unnamed was once a participant: a marker saying "one person was
here and is now gone" is a record of the association, which is the thing erasure
removed.

When a **Moment** is erased, its participations go with it. They describe a
Moment that no longer exists, and a record of who was in it is a record that it
existed.

A creator deleting their account does not erase participations others accepted;
those belong to the participants. What becomes of the Moments themselves is the
account-deletion rule, which this does not change.

## Participation Does Not Move History

A participation never changes a Moment's occurrence time, its position in
chronology, or its historical significance.

Accepting one adds the Moment to a Timeline. It does not make the Moment more
important, does not reorder anything, and is not an engagement signal. `feed.md`
and `historical-significance.md` both keep engagement out of chronology, and a
participation count would be engagement wearing a different name.

## Invariants

1. Participation records that somebody was part of an experience, never that
   they may see it.
2. Only the person named may establish their own participation.
3. A proposal is visible to the creator and the named person, and to nobody else.
4. A declined or withdrawn participation cannot be proposed again for that
   Moment.
5. Participation never widens a Moment's audience.
6. Accepting participation never grants access to a Moment.
7. A participation is erased with the participant's account, and with the
   Moment.
8. Nothing is left in place of an erased participation.
9. Participation does not affect chronological order or historical significance.
10. A non-User person is never a participant.
11. Participant, depicted person, contributor, creator and viewer remain distinct
    concepts, and one is not evidence of another.

## Open Questions

- Should a participant be able to add a note to their participation — "I took
  this photograph", "I was there for the first half" — or is the relationship
  binary?
- Should a creator see that a proposal was declined, or only that it was not
  accepted? Declining is information about the person declining.
- May a participant propose that somebody else participated, or only the
  creator?
- Should participation be limited in number per Moment, as the audience is?
- What should a participant see of a Moment they cannot read — the occurrence
  time alone, or also who else accepted?
- Should accepting participation in a Moment that is later made private remove
  it from the participant's Timeline, or leave it visible to them alone?
