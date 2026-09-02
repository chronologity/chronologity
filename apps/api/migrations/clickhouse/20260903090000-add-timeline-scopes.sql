-- What a Moment belongs to, and who may not be seen.
--
-- Both tables exist because ClickHouse cannot join PostgreSQL. A Timeline read
-- has to answer "which Moments are at this Location" and "is this author
-- suspended" in the same query that orders and pages, because filtering after
-- the fact leaks through page sizes: a page of twenty returning four says
-- sixteen things exist.

-- Which scopes a Moment belongs to.
--
-- One row per membership: a Moment has at most one Location and any number of
-- real-world Events, so a Moment with two Events has two rows here.
--
-- Derived, like everything in this database. Written by the projector from
-- authoritative state, removed when the Moment is erased, and rebuildable.
CREATE TABLE IF NOT EXISTS timeline_moment_contexts (
    -- `location` or `real_world_event`. Text rather than an enum so a third
    -- kind of context is a projector change rather than a migration.
    context_type       LowCardinality(String),
    context_id         String,

    -- Repeated from `timeline_moments` rather than joined to it. A scope query
    -- orders by occurrence and pages by the same tuple 7B settled, and reaching
    -- across tables to sort would make every page a join. The projector writes
    -- both together, so they cannot disagree.
    occurred_at        DateTime64(3),
    moment_id          String,
    author_user_id     String,

    -- Carried for the same reason: eligibility is decided in this query.
    visibility         LowCardinality(String),
    moderation_state   LowCardinality(String),

    projected_at       DateTime64(3),
    projection_version LowCardinality(String)
)
ENGINE = ReplacingMergeTree(projected_at)
PARTITION BY toYear(occurred_at)
-- Ordered so a scope's history is contiguous, then by the tuple `timeline.md`
-- requires everywhere: occurrence, then identifier. A cursor built for
-- `timeline_moments` therefore works here unchanged.
ORDER BY (context_type, context_id, occurred_at, moment_id, projection_version);

-- Accounts whose history is withheld.
--
-- One row per suspended account rather than a flag on every Moment, which is
-- the distinction 7A drew and this keeps. Suspending somebody who recorded ten
-- thousand Moments writes one row here; stamping their status onto each Moment
-- would rewrite ten thousand and leave the Timeline wrong until it finished.
--
-- The table therefore grows with moderation decisions and not with history: a
-- million more Moments adds nothing to it.
--
-- `search.eligibility.ts` resolves the same fact at query time against
-- PostgreSQL, which a single-author read can afford. A Location with a hundred
-- contributors cannot, which is why this exists.
CREATE TABLE IF NOT EXISTS timeline_suspended_authors (
    user_id      String,
    -- When it was recorded, and the version `ReplacingMergeTree` keeps.
    -- A later decision about the same account wins.
    decided_at   DateTime64(3),
    -- Whether they are currently suspended. Rows are kept rather than deleted
    -- on reinstatement, so that a message arriving out of order cannot
    -- resurrect a suspension: the newest `decided_at` decides, which a delete
    -- could not express.
    suspended    UInt8
)
ENGINE = ReplacingMergeTree(decided_at)
ORDER BY user_id;
