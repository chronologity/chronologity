-- Taking your history with you.
--
-- 5R-2 shipped account deletion. Until this exists beside it, the only way out
-- of Chronologity is to destroy everything — the opposite of what a product
-- built to preserve decades of personal history should offer.
--
-- `product/privacy.md:784` is the constraint that shapes this table: a Moment
-- may hold an unlimited number of images and videos, so an export cannot be a
-- response body. It is prepared asynchronously, written in parts, and described
-- by a manifest — which means there has to be a record of the preparation, and
-- this is it.
--
-- The parts hold data and never media. Media is presigned from the originals
-- the account already owns, at the moment somebody downloads, so this table
-- describes the only new copy of anybody's history that exists — and describes
-- when it stops existing.

CREATE TABLE export_requests (
    request_id     uuid        PRIMARY KEY,

    user_id        uuid        NOT NULL,

    state          text        NOT NULL DEFAULT 'pending',

    attempts       integer     NOT NULL DEFAULT 0,

    -- When to try, and the lease while trying. A worker claims a due request,
    -- pushes this forward, and commits before writing anything — so a process
    -- that dies mid-build leaves a request that becomes due again rather than
    -- one stuck in a state nobody clears.
    due_at         timestamptz NOT NULL DEFAULT now(),

    -- Where the parts were written, and how many there are. Null until the
    -- build succeeds: a request that has not finished has nothing to describe.
    storage_prefix text,
    part_count     integer,

    -- When this copy stops being available.
    --
    -- Not a nicety. A prepared export is a second copy of somebody's entire
    -- history sitting in object storage, and the only thing that stops it being
    -- permanent is something deciding it should not be.
    expires_at     timestamptz,

    error_category text,
    last_error     text,

    requested_at   timestamptz NOT NULL DEFAULT now(),
    completed_at   timestamptz,

    -- `ready` is the only state with anything to download. `expired` is reached
    -- by the sweep once the objects are gone, and is kept distinct from
    -- `failed` so that somebody asking why they cannot download is told the
    -- truth rather than that something went wrong.
    CONSTRAINT export_requests_state_check
        CHECK (state IN ('pending', 'ready', 'failed', 'abandoned', 'expired')),

    -- Anything not pending is finished, and a finished request says when.
    CONSTRAINT export_requests_completed_check
        CHECK ((state = 'pending') = (completed_at IS NULL)),

    -- Only a ready export has parts to describe and a life to run out.
    CONSTRAINT export_requests_ready_has_parts_check
        CHECK (
            state <> 'ready'
            OR (storage_prefix IS NOT NULL AND part_count IS NOT NULL AND expires_at IS NOT NULL)
        ),

    CONSTRAINT export_requests_part_count_check
        CHECK (part_count IS NULL OR part_count >= 1),

    CONSTRAINT export_requests_error_category_check
        CHECK (error_category IS NULL OR error_category IN ('transient', 'permanent')),

    CONSTRAINT export_requests_user_fk
        FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
);

-- One export being prepared at a time, per account.
--
-- Partial, over unfinished requests, so somebody may prepare a new export once
-- the last one is ready or has expired. It exists because preparing is
-- expensive and a double-click should not produce two builds of the same
-- history — and because two builds racing would each sweep the other's objects.
CREATE UNIQUE INDEX export_requests_one_in_progress
    ON export_requests (user_id)
    WHERE state = 'pending';

-- What the worker claims, and the only query it runs to find work.
CREATE INDEX export_requests_due_idx
    ON export_requests (due_at, request_id)
    WHERE state = 'pending';

-- What the sweep claims: exports whose life has run out.
CREATE INDEX export_requests_expiring_idx
    ON export_requests (expires_at)
    WHERE state = 'ready';
