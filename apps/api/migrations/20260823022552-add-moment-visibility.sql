-- A Moment gains an audience.
--
-- Until now `visibility` permitted one value, because there was no social graph
-- to have an audience within (`moments.md:585`). There is one now, and the
-- three values here are exactly those `privacy.md:92` names: private, restricted
-- to explicitly permitted people, and public.
ALTER TABLE moments
    DROP CONSTRAINT moments_visibility_is_known;

ALTER TABLE moments
    ADD CONSTRAINT moments_visibility_is_known CHECK (
        visibility IN ('private', 'restricted', 'public')
    );

-- New Moments are public unless their author says otherwise. This is the
-- decision `privacy.md:80` reserves explicitly rather than one inherited from
-- whatever the column happened to say.
--
-- Deliberately no backfill. Every existing row stores 'private' explicitly and
-- keeps it: those Moments were recorded under a documented promise that they
-- were private, and a changed default is not consent.
ALTER TABLE moments
    ALTER COLUMN visibility SET DEFAULT 'public';

-- Who may see a restricted Moment.
--
-- A list per Moment rather than a reusable group. `privacy.md:98` warns against
-- reproducing a matrix of social-network privacy controls, and a shared group
-- would silently change the audience of every Moment already pointing at it.
CREATE TABLE moment_audience (
    moment_id uuid        NOT NULL,
    user_id   uuid        NOT NULL,
    added_at  timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (moment_id, user_id),

    -- Cascading, unlike most references here: an audience is part of the
    -- Moment rather than a fact about the world that outlives it.
    CONSTRAINT moment_audience_moment_fk
        FOREIGN KEY (moment_id) REFERENCES moments (moment_id) ON DELETE CASCADE,

    -- Restricting, like every other reference to a person. An account that
    -- somebody granted sight of their history cannot vanish out from under the
    -- record of that grant.
    CONSTRAINT moment_audience_user_fk
        FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE RESTRICT
);

-- "Which of these Moments may this person see", which is how the audience is
-- read on every page of somebody else's history. The primary key already serves
-- the other direction.
CREATE INDEX moment_audience_user_idx
    ON moment_audience (user_id, moment_id);
