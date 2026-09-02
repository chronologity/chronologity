-- The Timeline read model.
--
-- One row per Moment, derived from PostgreSQL and authoritative for nothing.
-- Losing this table costs a rebuild rather than any history (ADR-055), which is
-- what allows a projection version to be dropped and another built beside it.
--
-- `ReplacingMergeTree` rather than `MergeTree`, keyed on the sort tuple and
-- versioned by `projected_at`. At-least-once delivery means the projector will
-- eventually apply the same message twice, and this makes that collapse to one
-- row by construction — which matters because no transaction spans PostgreSQL
-- and ClickHouse, so the idempotency the Search index gets from a shared commit
-- has to come from the engine here instead.
--
-- Deduplication happens when parts merge, which is to say at a time nobody
-- controls. Reads must therefore run with `final = 1`; the client sets it as a
-- session setting so no call site has to remember. Measured before relying on
-- it: two inserts of one Moment leave two rows plainly and one under `FINAL`.
CREATE TABLE IF NOT EXISTS timeline_moments (
    -- The sort tuple, and the whole reason this table exists.
    --
    -- `timeline.md:244` names `(occurrenceTime, momentId)` as the canonical
    -- ordering, and requires the same tuple in ClickHouse sort keys, cursor
    -- encoding, historical jump anchoring and neighbouring-slice queries. It is
    -- settled here because everything in 7B has to agree with it.
    --
    -- Occurrence time, never insertion time. A photograph uploaded today may
    -- belong to 1969, and putting it in 1969 is the product.
    occurred_at         DateTime64(3),
    -- `String`, not `UUID`, and the difference is not cosmetic.
    --
    -- ClickHouse stores a `UUID` as two 64-bit integers and orders by those, so
    -- its sort bears no relation to the text. Measured: of two identifiers,
    -- ClickHouse put `78c3aa60…` before `624f836e…` while every string sort
    -- puts them the other way round.
    --
    -- `timeline.md:252` requires this exact tuple to appear in the sort key,
    -- in cursor encoding, in historical jump anchoring and in neighbouring
    -- slices. A cursor is built and compared outside ClickHouse, so if the two
    -- disagree then paging across Moments that share an occurrence skips some
    -- and repeats others — quietly, and only where two Moments happen to
    -- collide. Storing the text costs twenty extra bytes a row and buys one
    -- ordering that everything can agree on.
    moment_id           String,

    -- Whose history it is.
    -- Text for the same reason, so filtering and ordering agree with callers.
    author_user_id      String,

    -- When the row was projected, and the version `ReplacingMergeTree` keeps.
    -- A later projection of the same Moment wins, which is what makes replay
    -- and live projection agree.
    projected_at        DateTime64(3),

    -- What the occurrence actually claims. A Moment placed in "summer 1998"
    -- knows only the month, and a Timeline must not present that as a day.
    occurrence_end      DateTime64(3),
    occurrence_precision LowCardinality(String),
    -- The offset the author was at, so a Moment reads in the time it happened
    -- in rather than the reader's.
    occurrence_offset_minutes Int16,

    -- Eligibility, carried from the first migration rather than added later.
    --
    -- A row without these cannot be filtered for a Viewer, and a Timeline that
    -- cannot filter is a privacy failure rather than a feature gap. Adding them
    -- afterwards would mean rebuilding every row, so they are here from the
    -- start. The vocabulary mirrors `SearchDocumentFields`, which models the
    -- same thing for Search: one set of names for one concept.
    visibility          LowCardinality(String),
    moderation_state    LowCardinality(String),
    -- Whether it may be offered to somebody who did not ask for it. Distinct
    -- from whether somebody who asks may see it.
    discoverable        UInt8,

    -- Which projection version wrote this row, so a rebuild can populate a new
    -- version beside the live one and readers can cut over when it is ready.
    projection_version  LowCardinality(String)
)
ENGINE = ReplacingMergeTree(projected_at)
-- Partitioned by year of occurrence rather than of insertion. Timeline reads
-- are bounded by when things happened, so this is what lets a query for 1998
-- skip everything else — and backfilling a decade touches one partition per
-- year rather than rewriting the newest.
PARTITION BY toYear(occurred_at)
ORDER BY (occurred_at, moment_id, projection_version);
