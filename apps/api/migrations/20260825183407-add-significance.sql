-- Why a Moment matters within the history being examined.
--
-- Not how much attention it received. `historical-significance.md` separates
-- the two throughout, and invariant 19 is explicit: reactions, comments, views,
-- and follower counts must never define historical significance. Nothing in
-- these tables is fed by any of them.
--
-- Significance exists to make temporal zoom principled. Zoom a decade into one
-- screen and something must choose which Moments survive; without this, whatever
-- a query happened to return first would become Chronologity's definition of
-- what matters.

-- Somebody saying a Moment matters to them.
--
-- The only thing here a person touches, and the one signal that cannot be
-- derived: invariant 11 requires personal significance to exist without social
-- engagement or graph-derived importance. A photograph with no reactions, no
-- comments, and no causal relationships may still be the most important Moment
-- in somebody's life.
--
-- Private, always. Which Moments matter to somebody is closer to a diary than
-- to a reaction, so no read anywhere returns anybody else's mark.
CREATE TABLE moment_personal_significance (
    moment_id uuid        NOT NULL,
    user_id   uuid        NOT NULL,
    marked_at timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (moment_id, user_id),

    CONSTRAINT moment_personal_significance_moment_fk
        FOREIGN KEY (moment_id) REFERENCES moments (moment_id) ON DELETE CASCADE,

    CONSTRAINT moment_personal_significance_user_fk
        FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE RESTRICT
);

-- Anybody may mark any Moment they can see, so this is read by whose mark it is.
CREATE INDEX moment_personal_significance_user_idx
    ON moment_personal_significance (user_id, marked_at DESC);

-- Derived significance, per Moment, per scope, per dimension.
--
-- Keyed on scope because `Significance(Moment)` is the wrong model
-- (`historical-significance.md:76`). A family's first photograph after
-- immigrating may be among the most consequential Moments in that family's
-- history and globally unremarkable; one value per Moment could not hold both.
CREATE TABLE moment_significance (
    moment_id         uuid        NOT NULL,

    -- The history being examined. `subject` is deliberately absent: that context
    -- still does not exist, which `timeline-first-curation-and-discovery.md`
    -- also records.
    scope_type        text        NOT NULL,

    -- Which person, Event, or place. Zero-UUID for the global scope, so the key
    -- stays uniform rather than nullable.
    scope_id          uuid        NOT NULL,

    dimension         text        NOT NULL,

    value             integer     NOT NULL DEFAULT 0,

    -- What this dimension scored the first time it was ever assessed.
    --
    -- What makes retrospective significance observable: "later causal history
    -- may increase the significance of earlier Moments" is a property of
    -- recomputing, not a separate graph walk, and it can only be seen by
    -- remembering where a Moment started.
    baseline_value    integer     NOT NULL DEFAULT 0,

    -- Where the value came from. The architecture constraints require this
    -- distinction be preserved as the system grows more sophisticated, so that
    -- an explicit human attribution is never mistaken for an inference.
    -- `ai` is named there and nothing produces it.
    provenance        text        NOT NULL,

    -- So algorithm evolution can be told from historical change.
    algorithm_version text        NOT NULL,

    computed_at       timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (moment_id, scope_type, scope_id, dimension),

    CONSTRAINT moment_significance_moment_fk
        FOREIGN KEY (moment_id) REFERENCES moments (moment_id) ON DELETE CASCADE,

    CONSTRAINT moment_significance_scope_is_known CHECK (
        scope_type IN ('person', 'real_world_event', 'location', 'global')
    ),

    CONSTRAINT moment_significance_dimension_is_known CHECK (
        dimension IN (
            'causal', 'structural', 'temporal', 'personal',
            'collective', 'event', 'evidentiary', 'retrospective'
        )
    ),

    CONSTRAINT moment_significance_provenance_is_known CHECK (
        provenance IN ('human', 'graph', 'rule', 'ai')
    ),

    CONSTRAINT moment_significance_value_is_not_negative CHECK (
        value >= 0 AND baseline_value >= 0
    )
);

-- The worker sweeps stalest first, so this is how it finds what to do next.
CREATE INDEX moment_significance_staleness_idx ON moment_significance (computed_at);

-- Reading a Moment's whole profile at once.
CREATE INDEX moment_significance_moment_idx ON moment_significance (moment_id, dimension);
