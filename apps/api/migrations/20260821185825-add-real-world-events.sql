-- add-real-world-events
--
-- Applied in filename order, once, inside a transaction. Editing this file
-- after it has been applied anywhere changes nothing: write a new migration.
--
-- Real-world Events: the shared occurrences that give Moments common context.
--
-- Not software events. `auth_audit_events`, `authorization_audit_events`, and
-- `projection_processed_events` all use that word for something else, which is
-- why the full term is spelled out here (`docs/glossary.md`).

-- An occurrence in the world.
--
-- A convention, a wedding, an election. The Event is what several people's
-- Moments have in common; it does not contain them, and grouping Moments under
-- one must never move them from their own place in chronology
-- (`real-world-events.md:1016`).
CREATE TABLE real_world_events (
    real_world_event_id uuid        PRIMARY KEY,

    -- Provenance, never ownership.
    --
    -- Whoever first recorded a concert, election, or ceremony here does not
    -- thereby gain authority over everyone else's history of it
    -- (`real-world-events.md:549-563`). Read this as "who told us", not as
    -- "whose Event this is". RESTRICT rather than CASCADE, per ADR-097: what
    -- happens to shared history when its recorder leaves is a decision for the
    -- deletion service to make deliberately.
    created_by_user_id  uuid        NOT NULL,

    -- The name it was recorded under.
    --
    -- Deliberately NOT unique, and deliberately not part of identity. Two
    -- Events may legitimately carry the same name — every night of a tour is
    -- called the same thing and each is a distinct occurrence
    -- (`real-world-events.md:99-121`). Duplicates are expected before
    -- reconciliation exists, and a unique constraint here would refuse real
    -- history to protect a guess.
    name                text        NOT NULL,

    -- When it happened, as an interval with the precision it is actually known
    -- at. The same three columns a Moment's occurrence will use.
    --
    -- The interval carries approximation: "sometime in 1969" is the whole of
    -- 1969 at year precision, and a concert is two instants hours apart. That
    -- is what stops an unknown clock time being invented to make storage
    -- tidier (`time.ts`, `real-world-events.md:154-188`).
    occurrence_start    timestamptz NOT NULL,
    occurrence_end      timestamptz NOT NULL,
    occurrence_precision text       NOT NULL,

    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT real_world_events_created_by_fk
        FOREIGN KEY (created_by_user_id) REFERENCES users (user_id),

    CONSTRAINT real_world_events_occurrence_precision_is_known CHECK (
        occurrence_precision IN ('instant', 'day', 'month', 'year')
    ),

    -- An occurrence cannot end before it starts. Equal is correct: an instant.
    CONSTRAINT real_world_events_occurrence_is_ordered CHECK (
        occurrence_end >= occurrence_start
    )
);

-- Events are found by when they happened far more often than by anything else,
-- and a Timeline reads a period rather than a point.
CREATE INDEX real_world_events_occurrence_idx
    ON real_world_events (occurrence_start, occurrence_end);

CREATE INDEX real_world_events_created_by_idx
    ON real_world_events (created_by_user_id, created_at DESC);

-- Other names the same occurrence goes by.
--
-- A local name, a former name, an official name nobody uses. None of them is
-- more the Event's identity than another, and none of them is identity at all:
-- `real_world_event_id` is (`real-world-events.md:249-268`).
CREATE TABLE real_world_event_aliases (
    real_world_event_id uuid        NOT NULL,
    alias               text        NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),

    -- One Event should not carry the same alias twice. Two Events carrying the
    -- same alias is fine, and expected.
    PRIMARY KEY (real_world_event_id, alias),

    CONSTRAINT real_world_event_aliases_event_fk
        FOREIGN KEY (real_world_event_id) REFERENCES real_world_events (real_world_event_id)
        ON DELETE CASCADE
);

-- Where an Event happened.
--
-- Many rather than one, because the specification refuses to assume a single
-- geographic point (`real-world-events.md:211-247`): a marathon is a route, a
-- product launch happens in three cities at once.
--
-- No ordering column. Ordering would describe a route, and how routes are
-- represented is still an open product question — a position column added now
-- would be filled in with guesses and read later as fact.
CREATE TABLE real_world_event_locations (
    real_world_event_id uuid        NOT NULL,
    location_id         uuid        NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (real_world_event_id, location_id),

    CONSTRAINT real_world_event_locations_event_fk
        FOREIGN KEY (real_world_event_id) REFERENCES real_world_events (real_world_event_id)
        ON DELETE CASCADE,

    -- RESTRICT, unlike the Event side. A Location is shared reference data
    -- (ADR-098) and outlives any one Event's use of it; removing a place that
    -- Events still point at should be refused rather than quietly unpick
    -- history.
    CONSTRAINT real_world_event_locations_location_fk
        FOREIGN KEY (location_id) REFERENCES locations (location_id)
);

CREATE INDEX real_world_event_locations_location_idx
    ON real_world_event_locations (location_id);
