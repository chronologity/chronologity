-- add-moments
--
-- Applied in filename order, once, inside a transaction. Editing this file
-- after it has been applied anywhere changes nothing: write a new migration.
--
-- Moments: the fundamental unit of represented history.

-- Something that happened, at a time, recorded by one person.
--
-- Not a media file and not a container. Media is evidence of an experience;
-- this row is the experience (`moments.md:54`).
CREATE TABLE moments (
    moment_id        uuid        PRIMARY KEY,

    -- Who recorded it. Authorship, and for now also audience: every Moment is
    -- private to its author until the social graph exists. RESTRICT per
    -- ADR-097 — what becomes of someone's history when they leave is for the
    -- deletion service to decide deliberately.
    author_user_id   uuid        NOT NULL,

    -- What happened, in words. Required: media and a timestamp alone are a
    -- photograph with a date on it, and a Moment is meant to be an experience.
    caption          text        NOT NULL,

    -- When it happened, as an interval at the precision it is actually known
    -- at. The same three columns real-world Events use.
    --
    -- This is historical position. It is not `created_at`, and it may precede
    -- it by decades: a Moment recorded today for 2014 belongs in 2014.
    occurrence_start timestamptz NOT NULL,
    occurrence_end   timestamptz NOT NULL,
    occurrence_precision text    NOT NULL,

    -- How far from UTC the person was, in minutes.
    --
    -- A timestamptz keeps the instant and discards the offset, and the offset
    -- is what "half past seven in the evening" means. Without this a Moment at
    -- 19:30 in New York and one at 19:30 in Tokyo are indistinguishable from
    -- each other's local meaning (`moments.md:263`).
    occurrence_offset_minutes integer NOT NULL,

    -- One value today. A column rather than an assumption, so that adding
    -- audiences later is a widened constraint rather than a new concept.
    visibility       text        NOT NULL DEFAULT 'private',

    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),

    -- Set when a Moment is removed from ordinary access. Nothing writes it
    -- yet: deletion is 5H-3, and the column exists now so that work is
    -- additive. Erasing the stored media is separate again, and deliberately
    -- unresolved (`moments.md:451`).
    deleted_at       timestamptz,

    CONSTRAINT moments_author_fk
        FOREIGN KEY (author_user_id) REFERENCES users (user_id),

    CONSTRAINT moments_occurrence_precision_is_known CHECK (
        occurrence_precision IN ('instant', 'day', 'month', 'year')
    ),

    -- An occurrence cannot end before it starts. Equal is correct: an instant.
    CONSTRAINT moments_occurrence_is_ordered CHECK (
        occurrence_end >= occurrence_start
    ),

    -- The real span of world offsets, from -12:00 to +14:00.
    CONSTRAINT moments_offset_is_plausible CHECK (
        occurrence_offset_minutes BETWEEN -720 AND 840
    ),

    CONSTRAINT moments_visibility_is_known CHECK (visibility IN ('private'))
);

-- Chronological position, and the tie-break that makes it deterministic.
--
-- Two Moments may genuinely share an occurrence time, and `moments.md:284`
-- requires a stable order anyway. The identifier settles it: arbitrary, but
-- the same on every read, which is what "deterministic" asks for. It does not
-- claim to know which actually happened first.
CREATE INDEX moments_occurrence_idx
    ON moments (occurrence_start DESC, moment_id DESC)
    WHERE deleted_at IS NULL;

CREATE INDEX moments_author_idx
    ON moments (author_user_id, occurrence_start DESC, moment_id DESC)
    WHERE deleted_at IS NULL;

-- The media representing a Moment, in the order it should be shown.
--
-- Presentation order only. It says nothing about when anything happened, and
-- changing it never moves the Moment through chronology.
CREATE TABLE moment_media (
    moment_id  uuid        NOT NULL,
    upload_id  uuid        NOT NULL,

    -- Dense and zero-based. Unique per Moment so the order is total rather
    -- than nearly so — two media sharing a position would leave the display
    -- order to whatever the database happened to return.
    position   integer     NOT NULL,

    created_at timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (moment_id, upload_id),

    CONSTRAINT moment_media_position_is_ordinal CHECK (position >= 0),

    CONSTRAINT moment_media_moment_fk
        FOREIGN KEY (moment_id) REFERENCES moments (moment_id)
        ON DELETE CASCADE,

    -- RESTRICT, unlike the Moment side. An upload is the file itself; removing
    -- one that a Moment still shows should be refused rather than silently
    -- emptying somebody's history.
    CONSTRAINT moment_media_upload_fk
        FOREIGN KEY (upload_id) REFERENCES uploads (upload_id)
);

-- What makes the order total.
CREATE UNIQUE INDEX moment_media_position_idx
    ON moment_media (moment_id, position);

-- Deliberately not unique. Whether one upload may appear in two Moments is not
-- something `moments.md` or `media.md` decides, and a unique index here would
-- decide it silently. The primary key already prevents the same file appearing
-- twice within one Moment, which is the case that is actually incoherent.
CREATE INDEX moment_media_upload_idx
    ON moment_media (upload_id);
