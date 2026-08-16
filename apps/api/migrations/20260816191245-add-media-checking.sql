-- add-media-checking
--
-- Applied in filename order, once, inside a transaction. Editing this file
-- after it has been applied anywhere changes nothing: write a new migration.
--
-- What the decoder found, and how the checking went.

-- What opening the file established.
--
-- Distinct from the declared_* columns beside them, which record what the
-- uploader claimed. Keeping both is the point: a mismatch between them is
-- evidence, and discarding the claim would leave nothing to compare against.
ALTER TABLE uploads
    ADD COLUMN media_kind      text,
    ADD COLUMN codec           text,
    ADD COLUMN container       text,
    ADD COLUMN width           integer,
    ADD COLUMN height          integer,
    -- Null for a photograph, which has no duration. Fractional because
    -- videos rarely land on whole seconds and the limit is checked against
    -- the real value.
    ADD COLUMN duration_seconds numeric(10, 3),
    ADD COLUMN has_audio       boolean,
    ADD COLUMN checked_at      timestamptz;

-- How the checking went.
--
-- Delivery is at-least-once and failures repeat, so an upload needs to
-- remember how often it has been tried. Without this a permanently broken
-- file would be retried forever, and a briefly unreachable storage service
-- would be indistinguishable from one.
ALTER TABLE uploads
    ADD COLUMN attempts         integer     NOT NULL DEFAULT 0,
    -- 'transient' may be retried; 'permanent' may not. Recorded rather than
    -- inferred, so the decision is auditable after the fact.
    ADD COLUMN failure_category text,
    ADD COLUMN last_attempt_at  timestamptz;

-- Finding uploads that arrived but were never checked — a checker that
-- crashed mid-batch, or a note that never reached the queue.
CREATE INDEX uploads_awaiting_check_idx
    ON uploads (received_at)
    WHERE state = 'received';
