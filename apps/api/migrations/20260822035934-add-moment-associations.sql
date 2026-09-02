-- add-moment-associations
--
-- Applied in filename order, once, inside a transaction. Editing this file
-- after it has been applied anywhere changes nothing: write a new migration.
--
-- Where a Moment happened, and what larger occurrence it was part of.

-- Where the experience happened.
--
-- One per Moment. `locations.md:433` asks that "the Moment-level historical
-- Location should represent the experience as a whole", and says media pointing
-- at several distinct places "may indicate the User has created a Moment whose
-- historical boundaries should be reconsidered". Several places is usually
-- several Moments.
--
-- A table rather than a column on `moments`, because an association is an
-- assertion with a provenance of its own rather than a property of the Moment.
CREATE TABLE moment_locations (
    -- The primary key is what limits a Moment to one place. Allowing several
    -- later means widening this key; a nullable column on `moments` would have
    -- meant migrating data into a table instead.
    moment_id   uuid        PRIMARY KEY,
    location_id uuid        NOT NULL,

    -- How the association came to be.
    --
    -- One value today. `locations.md:420` requires that inference "remain
    -- distinguishable from explicit User assertion or reliable embedded
    -- metadata", so the distinction is structural rather than assumed — but
    -- only what something can actually produce is named, because a value
    -- nothing can produce only invites rows to be labelled with it wrongly.
    origin      text        NOT NULL DEFAULT 'user-asserted',

    created_at  timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT moment_locations_moment_fk
        FOREIGN KEY (moment_id) REFERENCES moments (moment_id)
        ON DELETE CASCADE,

    -- RESTRICT: a Location is shared reference data (ADR-098) that outlives any
    -- one Moment's use of it. Removing a place Moments still point at should be
    -- refused rather than quietly unpick somebody's history.
    CONSTRAINT moment_locations_location_fk
        FOREIGN KEY (location_id) REFERENCES locations (location_id),

    CONSTRAINT moment_locations_origin_is_known CHECK (origin IN ('user-asserted'))
);

CREATE INDEX moment_locations_location_idx
    ON moment_locations (location_id);

-- The larger occurrences a Moment was part of.
--
-- Several are permitted: a photograph at a wedding that is also part of a
-- family reunion is genuinely both, and the two Events do not conflict
-- (`real-world-events.md:480-516`).
--
-- The asymmetry with Locations is deliberate rather than an oversight. An Event
-- is a shared occurrence that may span a route or three cities; a Moment is one
-- person's experience of somewhere.
CREATE TABLE moment_real_world_events (
    moment_id           uuid        NOT NULL,
    real_world_event_id uuid        NOT NULL,

    -- As above. `real-world-events.md:508` requires that an association record
    -- whether it was established by a person, suggested, inferred, or
    -- imported; only the first can happen yet.
    origin              text        NOT NULL DEFAULT 'user-asserted',

    created_at          timestamptz NOT NULL DEFAULT now(),

    -- Associating the same Event twice is the same claim made twice, which is
    -- one association.
    PRIMARY KEY (moment_id, real_world_event_id),

    CONSTRAINT moment_real_world_events_moment_fk
        FOREIGN KEY (moment_id) REFERENCES moments (moment_id)
        ON DELETE CASCADE,

    -- RESTRICT for the same reason as Locations: an Event is shared history,
    -- and removing one Moments still point at should be a deliberate act.
    CONSTRAINT moment_real_world_events_event_fk
        FOREIGN KEY (real_world_event_id) REFERENCES real_world_events (real_world_event_id),

    CONSTRAINT moment_real_world_events_origin_is_known CHECK (origin IN ('user-asserted'))
);

-- Reading an Event's Moments is the direction this table will mostly be read
-- in once Timeline derivation exists.
CREATE INDEX moment_real_world_events_event_idx
    ON moment_real_world_events (real_world_event_id);
