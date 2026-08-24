-- Lightweight response to a Moment.
--
-- Social activity, not historical occurrence (`reactions.md:43`). A Reaction
-- says something about whoever left it; it makes no claim about whether the
-- Moment happened as represented, which is why none of the four kinds could be
-- read as corroboration.
CREATE TABLE moment_reactions (
    -- The pair is the key, and the key is the rule. `reactions.md:111` requires
    -- at most one active Reaction per person per Moment; enforcing it here
    -- means changing a Reaction is an update, so reaction inflation is
    -- impossible by construction rather than by policy.
    moment_id  uuid        NOT NULL,
    user_id    uuid        NOT NULL,

    -- Stored as a name, never a glyph. `reactions.md:101` requires that
    -- changing an icon must not silently transform the meaning of what is
    -- stored: a stored heart would mean restyling could redefine years of
    -- history, while a stored `loved` lets the artwork change and the meaning
    -- not at all.
    kind       text        NOT NULL,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (moment_id, user_id),

    -- Cascading from the Moment: a Reaction is a response to something, and
    -- outliving what it responded to would leave a count attached to nothing.
    CONSTRAINT moment_reactions_moment_fk
        FOREIGN KEY (moment_id) REFERENCES moments (moment_id) ON DELETE CASCADE,

    -- Restricting, like every other reference to a person.
    CONSTRAINT moment_reactions_user_fk
        FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE RESTRICT,

    CONSTRAINT moment_reactions_kind_is_known CHECK (
        kind IN ('loved', 'amused', 'astonished', 'saddened')
    )
);

-- Counting, grouped by kind.
--
-- Deliberately no counter column on `moments`: the roadmap forbids serialising
-- high-volume interactions through a single contended row, and a running total
-- is exactly that — every reaction on a popular Moment queueing behind one
-- lock. Counts are aggregated over this index instead, which `reactions.md:214`
-- anticipates by calling them derived and permitting eventual consistency.
CREATE INDEX moment_reactions_counting_idx ON moment_reactions (moment_id, kind);

-- Severing what two people left on each other's Moments when a Block is made.
CREATE INDEX moment_reactions_user_idx ON moment_reactions (user_id);

-- Whether a Moment accepts new Reactions.
--
-- Disabling hides the existing ones rather than deleting them, so re-enabling
-- brings the same counts back. `reactions.md:280` makes creator control of
-- interaction the recommended first step.
ALTER TABLE moments
    ADD COLUMN reactions_enabled boolean NOT NULL DEFAULT true;
