-- add-context-following
--
-- Applied in filename order, once, inside a transaction. Editing this file
-- after it has been applied anywhere changes nothing: write a new migration.
--
-- Following a historical context: a place, or an occurrence.

-- Somebody following a real-world Event.
--
-- What an interface may present as "follow this Timeline". A Timeline is
-- derived and has nothing to follow (`timelines.md`); what is followed is the
-- context it is derived from.
--
-- No approval, unlike following a person. An Event is shared history whose
-- creator holds provenance rather than authority (ADR-100), so there is nobody
-- to ask.
CREATE TABLE real_world_event_follows (
    follower_user_id    uuid        NOT NULL,
    real_world_event_id uuid        NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (follower_user_id, real_world_event_id),

    CONSTRAINT real_world_event_follows_follower_fk
        FOREIGN KEY (follower_user_id) REFERENCES users (user_id),

    -- RESTRICT: an Event that people are still following should not vanish
    -- from under them. Nothing deletes an Event today, so this blocks nothing
    -- and obliges whatever eventually does to decide what happens to its
    -- followers first.
    CONSTRAINT real_world_event_follows_event_fk
        FOREIGN KEY (real_world_event_id) REFERENCES real_world_events (real_world_event_id)
);

-- The direction the primary key cannot serve: who follows this occurrence.
-- Notifications will read it this way round.
CREATE INDEX real_world_event_follows_event_idx
    ON real_world_event_follows (real_world_event_id);

-- Reading somebody's own list, newest first, with the identifier settling ties
-- so a page boundary cannot skip or repeat a row.
CREATE INDEX real_world_event_follows_follower_idx
    ON real_world_event_follows (follower_user_id, created_at DESC, real_world_event_id DESC);

-- Somebody following a Location.
--
-- The same idea in space: tell me what happens at this place. A Location is
-- shared reference data (ADR-098), so again there is nobody to ask.
CREATE TABLE location_follows (
    follower_user_id uuid        NOT NULL,
    location_id      uuid        NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (follower_user_id, location_id),

    CONSTRAINT location_follows_follower_fk
        FOREIGN KEY (follower_user_id) REFERENCES users (user_id),

    CONSTRAINT location_follows_location_fk
        FOREIGN KEY (location_id) REFERENCES locations (location_id)
);

CREATE INDEX location_follows_location_idx
    ON location_follows (location_id);

CREATE INDEX location_follows_follower_idx
    ON location_follows (follower_user_id, created_at DESC, location_id DESC);

-- The equivalent index for following people, which 5I-1 keyed on the moment
-- alone.
--
-- A cursor over a timestamp cannot page correctly when two rows share it, and
-- two follows created in the same millisecond are ordinary rather than
-- exotic — somebody following several people in quick succession produces
-- exactly that. The identifier settles the tie, as it already does for Moments.
-- Both directions gain the identifier, because both are paged.
DROP INDEX user_follows_followed_idx;

CREATE INDEX user_follows_followed_idx
    ON user_follows (followed_user_id, created_at DESC, follower_user_id DESC);

CREATE INDEX user_follows_follower_idx
    ON user_follows (follower_user_id, created_at DESC, followed_user_id DESC);
