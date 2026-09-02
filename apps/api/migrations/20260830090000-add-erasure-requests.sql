-- Finishing what deleting something starts.
--
-- Deleting a Moment has, until now, set a column. Everything derived converged
-- on that correctly — the reading indexer dropped its document, the visibility
-- predicate stopped matching, notifications about it stopped rendering — so from
-- the outside it looked finished.
--
-- Nothing was erased. The caption was still in the row, the comments other
-- people wrote were still in theirs, and the photographs and videos were still
-- in object storage along with every thumbnail and transcode made from them.
-- `product/privacy.md:646` is blunt about what that last one means: a product
-- cannot truthfully claim a video was deleted while continuing to serve a
-- transcoded copy.
--
-- This table is the record of work still owed. It exists because erasure cannot
-- happen inside the request that asks for it: a Moment may hold an unlimited
-- number of images and videos, so deleting one would do unbounded
-- object-storage work in an HTTP handler, and a Moment with two hundred videos
-- would time out half-erased with no record of how far it got.
-- `architecture/privacy.md:1136` separately requires that cross-store deletion
-- be retryable, idempotent, and have observable completion — which is a ledger
-- and a worker by another name.

CREATE TABLE erasure_requests (
    request_id     uuid        PRIMARY KEY,

    -- What is being erased. Only Moments today; account erasure widens this
    -- constraint when it is built, rather than the constraint being widened now
    -- for something no worker knows how to do. A vocabulary that admits values
    -- nothing handles is a vocabulary that silently accepts work and drops it.
    subject_type   text        NOT NULL,
    subject_id     uuid        NOT NULL,

    state          text        NOT NULL DEFAULT 'pending',

    attempts       integer     NOT NULL DEFAULT 0,

    -- When to try, and the lease while trying.
    --
    -- A worker claims a due request, pushes this forward, and commits before
    -- doing any of the slow work — so a process that dies mid-erasure leaves a
    -- request that becomes due again rather than one stuck in a state nobody
    -- clears. `architecture/privacy.md:1136` asks for "partially completed" to
    -- be observable, and this is it: pending with attempts above zero.
    due_at         timestamptz NOT NULL DEFAULT now(),

    -- Why it last failed, in this system's vocabulary rather than a store's.
    -- `transient` is retried and `permanent` is not.
    error_category text,
    last_error     text,

    requested_at   timestamptz NOT NULL DEFAULT now(),
    completed_at   timestamptz,

    CONSTRAINT erasure_requests_subject_type_check
        CHECK (subject_type IN ('moment')),

    -- `abandoned` is the retry ceiling and `failed` is a refusal that will not
    -- change on its own. Kept apart so that an operator can tell a store that
    -- was unreachable for a day from one that said no.
    CONSTRAINT erasure_requests_state_check
        CHECK (state IN ('pending', 'completed', 'failed', 'abandoned')),

    -- Anything not pending is finished, and a finished request says when.
    CONSTRAINT erasure_requests_completed_check
        CHECK ((state = 'pending') = (completed_at IS NULL)),

    CONSTRAINT erasure_requests_error_category_check
        CHECK (error_category IS NULL OR error_category IN ('transient', 'permanent'))
);

-- One unfinished request per thing.
--
-- Partial, so a subject erased once and somehow needing it again is not blocked
-- by the completed record of the first. Enforced here rather than remembered,
-- because deleting the same Moment twice is an ordinary double-click.
CREATE UNIQUE INDEX erasure_requests_one_unfinished
    ON erasure_requests (subject_type, subject_id)
    WHERE state = 'pending';

-- What the worker claims, and the only query it runs to find work.
CREATE INDEX erasure_requests_due_idx
    ON erasure_requests (due_at, request_id)
    WHERE state = 'pending';

-- Note what this table deliberately does not hold.
--
-- There is no column for who asked. For a Moment the author is the only person
-- who can ask, and once the Moment is erased this row would otherwise be the
-- one remaining record that a particular person had recorded something — which
-- is exactly the kind of trace erasure is supposed to remove. What survives is
-- an opaque identifier for something that no longer exists and the fact that it
-- was erased, which is what ADR-095 permits anywhere unerasable.
--
-- The audit of who deleted what lives in `moment_edits`, which cascades away
-- with the Moment. That is the intended behaviour rather than an oversight: the
-- record of the deletion goes with the thing deleted.
