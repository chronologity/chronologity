-- add-saved-view-awareness
--
-- Telling somebody their saved view has grown.
--
-- Two things, deliberately kept apart. When somebody last looked is a fact about
-- them, authoritative and unrecoverable if lost. How much is new since then is
-- derived from the Timeline projection and can be recomputed from scratch at any
-- time. Storing them in one row would make the derived half look as though it
-- had to be preserved.

-- When they last looked.
--
-- Null means never, and "new" then means everything since they saved it, which is
-- what a badge on a view somebody has never opened should say.
ALTER TABLE saved_views
    ADD COLUMN IF NOT EXISTS last_visited_at timestamptz;

-- What was new when it was last counted.
--
-- One row per view, created with the view rather than lazily by the sweep, so
-- that finding the stalest is one index scan rather than a join against every
-- view that has none. The significance sweep cannot do this — a Moment exists
-- before anybody decides to assess it — but a saved view can.
CREATE TABLE saved_view_awareness (
    saved_view_id    uuid PRIMARY KEY,

    -- Bounded by the counter, not by the history. Past the ceiling the exact
    -- number stops being something anybody can act on, and counting further
    -- costs more the busier the view is.
    new_moment_count integer NOT NULL DEFAULT 0,
    capped           boolean NOT NULL DEFAULT false,

    -- Which visit the count was computed against.
    --
    -- Load-bearing for a race rather than for bookkeeping: the sweep reads the
    -- mark, spends time in ClickHouse, then writes. A visit landing in between
    -- has already zeroed this row, and its zero must win — so the sweep's write
    -- is conditional on the mark it actually counted from.
    visited_through  timestamptz,

    -- Null means never counted, and sorts first.
    --
    -- Also set back to null by a visit: the zero a visit writes was asserted
    -- rather than counted, so the view goes to the head of the queue instead of
    -- waiting a full cycle to find out what arrived while somebody was reading.
    computed_at      timestamptz,

    CONSTRAINT saved_view_awareness_count_is_not_negative CHECK (new_moment_count >= 0),

    -- Cascading, as the shares do. A count of what is new in a view that no
    -- longer exists is not a record of anything, and erasing an account deletes
    -- its views outright rather than tombstoning them, so this goes with them.
    CONSTRAINT saved_view_awareness_view_fk
        FOREIGN KEY (saved_view_id) REFERENCES saved_views (saved_view_id) ON DELETE CASCADE
);

-- Stalest first, nulls before all.
CREATE INDEX saved_view_awareness_staleness_idx
    ON saved_view_awareness (computed_at NULLS FIRST);

-- Every view that already exists, so the sweep finds them.
INSERT INTO saved_view_awareness (saved_view_id)
SELECT saved_view_id FROM saved_views
ON CONFLICT DO NOTHING;
