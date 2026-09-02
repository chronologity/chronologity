-- Explicit relationships between Moments.
--
-- A relationship is a claim somebody made, never something derived from
-- chronology. `causality.md:103` is the rule the whole table exists to honour:
-- "If Moment A occurred before Moment B, Chronologity knows only that A
-- preceded B." Nothing here is ever written by observing order.
--
-- A row rather than an array of identifiers on a Moment, for four reasons that
-- an array cannot answer: what the connection means, who asserted it, how to
-- read it from the far end without a scan, and how somebody relates their own
-- Moment to yours without writing into your row.
CREATE TABLE moment_relationships (
    relationship_id     uuid        PRIMARY KEY,

    source_moment_id    uuid        NOT NULL,
    target_moment_id    uuid        NOT NULL,

    -- Two causal kinds and three that deliberately are not.
    -- `causality.md:415` requires that contextual relationships never imply
    -- causal ones, and without a non-causal option every connection somebody
    -- wants to draw gets forced into causal language.
    kind                text        NOT NULL,

    -- How the claim came to exist. Only `asserted` is producible today; the
    -- others are named so that a suggestion engine is additive, and so that
    -- what it produces can never be mistaken for what a person said
    -- (`causality.md:187`).
    origin              text        NOT NULL DEFAULT 'asserted',

    -- Whose perspective this is. `causality.md:520` asks that the product
    -- "preserve whose perspective the relationship represents", which matters
    -- most where two people read the same history differently.
    asserted_by_user_id uuid        NOT NULL,

    created_at          timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT moment_relationships_source_fk
        FOREIGN KEY (source_moment_id) REFERENCES moments (moment_id) ON DELETE CASCADE,

    CONSTRAINT moment_relationships_target_fk
        FOREIGN KEY (target_moment_id) REFERENCES moments (moment_id) ON DELETE CASCADE,

    -- Restricting, like every other reference to a person: the record of who
    -- made a claim must not lose the claimant.
    CONSTRAINT moment_relationships_asserter_fk
        FOREIGN KEY (asserted_by_user_id) REFERENCES users (user_id) ON DELETE RESTRICT,

    CONSTRAINT moment_relationships_kind_is_known CHECK (
        kind IN ('led_to', 'contributed_to', 'related_to', 'alternate_perspective', 'contradicts')
    ),

    CONSTRAINT moment_relationships_origin_is_known CHECK (
        origin IN ('asserted', 'derived', 'suggested')
    ),

    -- Nothing leads to itself.
    CONSTRAINT moment_relationships_is_not_reflexive CHECK (
        source_moment_id <> target_moment_id
    )
);

-- One claim of a kind between an ordered pair.
CREATE UNIQUE INDEX moment_relationships_pair_idx
    ON moment_relationships (source_moment_id, target_moment_id, kind);

-- The symmetric kinds again, unordered.
--
-- "A is another account of B" and "B is another account of A" are one claim. A
-- plain unique index on the ordered pair would let both rows exist and report
-- the same relationship twice, from each end.
CREATE UNIQUE INDEX moment_relationships_unordered_idx
    ON moment_relationships (
        LEAST(source_moment_id, target_moment_id),
        GREATEST(source_moment_id, target_moment_id),
        kind
    )
    WHERE kind IN ('related_to', 'alternate_perspective', 'contradicts');

-- Read from either end: a Moment's relationships are those where it is the
-- source and those where it is the target.
CREATE INDEX moment_relationships_source_idx
    ON moment_relationships (source_moment_id, created_at DESC);

CREATE INDEX moment_relationships_target_idx
    ON moment_relationships (target_moment_id, created_at DESC);
