-- Somebody was part of an experience they did not record.
--
-- `participation.md` builds exactly one of the six relationships `identity.md`
-- and `privacy.md` name, and this is it. A creator proposes; only the person
-- named may establish it; a rejection or a withdrawal ends the matter for that
-- Moment for good.
--
-- Participation is a claim about history, never about access. Nothing here
-- grants sight of anything: `moment_audience` records who may see a Moment and
-- this records who was there, and the two must not be read as one.

CREATE TABLE moment_participations (
    participation_id uuid        PRIMARY KEY,
    moment_id        uuid        NOT NULL,
    user_id          uuid        NOT NULL,
    status           text        NOT NULL DEFAULT 'proposed',
    proposed_at      timestamptz NOT NULL DEFAULT now(),
    resolved_at      timestamptz,

    -- One row per person per Moment, forever, and deliberately *not* partial.
    --
    -- `20260822202629-add-following.sql` makes the opposite choice for
    -- `follow_requests`, whose unique index covers only `status = 'pending'` so
    -- that repeated asks accumulate as history. This is not that. A rejected or
    -- withdrawn row is the thing that refuses the next proposal, so the rule
    -- `participation.md` states — "a refusal that can be repeated is not a
    -- refusal, it is a delay" — is enforced by the constraint rather than by a
    -- check somebody can forget to write.
    --
    -- A creator cancelling a proposal nobody answered deletes the row instead,
    -- which is what leaves them free to ask again.
    CONSTRAINT moment_participations_once UNIQUE (moment_id, user_id),

    CONSTRAINT moment_participations_status_is_known CHECK (
        status IN ('proposed', 'accepted', 'rejected', 'withdrawn')
    ),

    -- An unanswered proposal has no resolution and an answered one has nothing
    -- else. The same shape `follow_requests` uses, for the same reason: a
    -- status and a timestamp that disagree are a bug nobody can see.
    CONSTRAINT moment_participations_resolution_matches_status CHECK (
        (status = 'proposed' AND resolved_at IS NULL)
        OR (status <> 'proposed' AND resolved_at IS NOT NULL)
    ),

    -- Cascading, as `moment_audience` does and for the reason it gives: a
    -- record of who was in a Moment is a record that the Moment existed, so it
    -- cannot outlive one.
    CONSTRAINT moment_participations_moment_fk
        FOREIGN KEY (moment_id) REFERENCES moments (moment_id) ON DELETE CASCADE,

    -- Restricting, like every other reference to a person. The account row is
    -- tombstoned rather than deleted, so nothing cascades here and every
    -- participation must be named in the account sweep.
    CONSTRAINT moment_participations_user_fk
        FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE RESTRICT
);

-- There is no `proposed_by_user_id`. Only a Moment's creator may propose, so it
-- would always equal `moments.author_user_id` — and nothing in the database
-- could enforce that, which means the two could disagree and the copy would
-- win. Reading the proposer through the Moment is one join on a path that has
-- already loaded the Moment.

-- Everything proposed to somebody, or by them, newest first. The identifier
-- breaks ties because the cursor is a `(timestamp, id)` tuple, as everywhere.
CREATE INDEX moment_participations_user_idx
    ON moment_participations (user_id, proposed_at DESC, participation_id DESC);

-- A Moment's participants. Partial, because the list is only ever of people who
-- accepted: a proposal is visible to the two people in it and to nobody else,
-- so it must never be reachable from the Moment.
CREATE INDEX moment_participations_accepted_idx
    ON moment_participations (moment_id, proposed_at DESC)
    WHERE status = 'accepted';

-- Somebody who may not ask.
--
-- A Block severs interaction in both directions and covers the severe case.
-- This covers the ordinary one, where a person is not blocked but is not
-- welcome to keep asking either — without it, consent is a stream of requests
-- somebody must keep answering, which is a way to reach a person who does not
-- want to be reached.
CREATE TABLE participation_refusals (
    refusing_user_id uuid        NOT NULL,
    refused_user_id  uuid        NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (refusing_user_id, refused_user_id),

    CONSTRAINT participation_refusals_is_not_reflexive CHECK (
        refusing_user_id <> refused_user_id
    ),

    CONSTRAINT participation_refusals_refusing_fk
        FOREIGN KEY (refusing_user_id) REFERENCES users (user_id) ON DELETE RESTRICT,

    CONSTRAINT participation_refusals_refused_fk
        FOREIGN KEY (refused_user_id) REFERENCES users (user_id) ON DELETE RESTRICT
);

-- Read one way only: whether this person has refused that one. The reverse is
-- deliberately not indexed, because nothing may ask who has refused them.
CREATE INDEX participation_refusals_refusing_idx
    ON participation_refusals (refusing_user_id, created_at DESC, refused_user_id DESC);

-- A notification may now point at a participation.
--
-- It cannot point at the Moment. `NotificationService.stillVisible` re-checks a
-- Moment's visibility for anything whose source is one, and the person being
-- asked to confirm they were somewhere frequently cannot read it — so a
-- proposal notification stored against the Moment would be written and then
-- never render for the one person who has to see it. Pointing at the
-- participation also gives every notification its own aggregation key, so a
-- second proposal is not folded into an unread first.
ALTER TABLE notifications
    DROP CONSTRAINT notifications_source_type_check;

ALTER TABLE notifications
    ADD CONSTRAINT notifications_source_type_check
        CHECK (source_type IN ('moment', 'comment', 'user', 'upload', 'participation'));

-- Notifications about being named in somebody's history are their own kind.
--
-- Not social: a person may reasonably silence reactions and follows while still
-- needing to hear that somebody has claimed they were somewhere. Answering such
-- a claim is the consent model working, and a category that can be switched off
-- alongside likes would make the one notification the model depends on the
-- easiest to lose.
ALTER TABLE notifications
    DROP CONSTRAINT notifications_category_check;

ALTER TABLE notifications
    ADD CONSTRAINT notifications_category_check
        CHECK (category IN ('social', 'media', 'moderation', 'security', 'participation'));

-- And the preferences table, which carries its own copy of the vocabulary. A
-- category the notifications table accepts but preferences reject is one nobody
-- can turn off, which for this category would defeat the point of separating it.
ALTER TABLE notification_preferences
    DROP CONSTRAINT notification_preferences_category_check;

ALTER TABLE notification_preferences
    ADD CONSTRAINT notification_preferences_category_check
        CHECK (category IN ('social', 'media', 'moderation', 'security', 'participation'));
